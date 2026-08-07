BEGIN;

-- Prova persistida de validação WhatsApp. O histórico existente é preservado e
-- validation_rules_id permanece nulo porque a configuração legada não é fonte
-- operacional desta decisão.

DO $block$
DECLARE
  v_expected record;
BEGIN
  FOR v_expected IN
    SELECT *
    FROM (VALUES
      (1::bigint, 'valido'::text, 'Válido'::text),
      (2::bigint, 'nao_encontrado'::text, 'Não encontrado'::text),
      (3::bigint, 'erro_tecnico'::text, 'Erro técnico'::text)
    ) AS expected(result_id, result_key, result_name)
  LOOP
    IF EXISTS (
      SELECT 1
      FROM public.lead_validation_results AS result
      WHERE result.lead_validation_results_id = v_expected.result_id
        AND result.lead_validation_results_key <> v_expected.result_key
    ) OR EXISTS (
      SELECT 1
      FROM public.lead_validation_results AS result
      WHERE result.lead_validation_results_key = v_expected.result_key
        AND result.lead_validation_results_id <> v_expected.result_id
    ) THEN
      RAISE EXCEPTION 'lead_validation_result_catalog_conflict:%', v_expected.result_key;
    END IF;

    INSERT INTO public.lead_validation_results (
      lead_validation_results_id,
      lead_validation_results_key,
      lead_validation_results_name,
      status_id,
      lead_validation_results_created_at,
      lead_validation_results_updated_at
    ) VALUES (
      v_expected.result_id,
      v_expected.result_key,
      v_expected.result_name,
      1,
      now(),
      now()
    )
    ON CONFLICT (lead_validation_results_id) DO UPDATE SET
      lead_validation_results_name = EXCLUDED.lead_validation_results_name,
      status_id = EXCLUDED.status_id,
      lead_validation_results_updated_at = now();
  END LOOP;
END;
$block$;

SELECT setval(
  pg_get_serial_sequence('public.lead_validation_results', 'lead_validation_results_id'),
  greatest((SELECT coalesce(max(lead_validation_results_id), 1) FROM public.lead_validation_results), 1),
  true
);

ALTER TABLE public.lead_validation_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_validation_results ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.lead_validation_attempts
FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON TABLE public.lead_validation_results
FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON TABLE public.lead_validation_attempts TO authenticated;
GRANT SELECT ON TABLE public.lead_validation_results TO authenticated;
GRANT SELECT, INSERT ON TABLE public.lead_validation_attempts TO service_role;
GRANT SELECT ON TABLE public.lead_validation_results TO service_role;

CREATE OR REPLACE FUNCTION public.has_current_whatsapp_validation_proof(
  p_users_id bigint,
  p_lead_id bigint
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.leads AS lead
    JOIN public.channels AS channel
      ON channel.channels_id = lead.channels_id
    CROSS JOIN LATERAL (
      SELECT
        result.lead_validation_results_key AS result_key,
        attempt.lead_validation_attempts_input_value AS validated_phone
      FROM public.lead_validation_attempts AS attempt
      JOIN public.lead_validation_results AS result
        ON result.lead_validation_results_id = attempt.lead_validation_results_id
      WHERE attempt.users_id = lead.users_id
        AND attempt.leads_id = lead.leads_id
        AND attempt.channels_id = lead.channels_id
        AND attempt.status_id = 5
        AND attempt.lead_validation_attempts_finished_at IS NOT NULL
        AND lower(trim(coalesce(attempt.lead_validation_attempts_provider, ''))) = 'evolution'
        AND result.lead_validation_results_key IN ('valido', 'nao_encontrado')
      ORDER BY
        attempt.lead_validation_attempts_finished_at DESC,
        attempt.lead_validation_attempts_id DESC
      LIMIT 1
    ) AS latest_definitive
    WHERE lead.users_id = p_users_id
      AND lead.leads_id = p_lead_id
      AND lower(regexp_replace(public.unaccent(trim(channel.channels_name)), '[^a-z0-9]+', '', 'g')) = 'whatsapp'
      AND public.normalize_identity_phone(lead.leads_phone) <> ''
      AND latest_definitive.result_key = 'valido'
      AND latest_definitive.validated_phone = public.normalize_identity_phone(lead.leads_phone)
  );
$function$;

COMMENT ON FUNCTION public.has_current_whatsapp_validation_proof(bigint, bigint)
IS 'Confirma que o último resultado definitivo do lead/canal é válido e corresponde exatamente ao telefone WhatsApp atual.';

REVOKE ALL ON FUNCTION public.has_current_whatsapp_validation_proof(bigint, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_current_whatsapp_validation_proof(bigint, bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.current_user_whatsapp_validation_proofs(
  p_lead_ids bigint[]
)
RETURNS TABLE (
  lead_id bigint,
  has_valid_proof boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $function$
  WITH current_user_record AS (
    SELECT public.ensure_current_user() AS users_id
  )
  SELECT
    lead.leads_id,
    public.has_current_whatsapp_validation_proof(current_user_record.users_id, lead.leads_id)
  FROM current_user_record
  JOIN public.leads AS lead
    ON lead.users_id = current_user_record.users_id
  WHERE lead.leads_id = ANY(coalesce(p_lead_ids, ARRAY[]::bigint[]));
$function$;

REVOKE ALL ON FUNCTION public.current_user_whatsapp_validation_proofs(bigint[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_whatsapp_validation_proofs(bigint[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_whatsapp_validation_result(
  p_users_id bigint,
  p_lead_id bigint,
  p_validated_phone text,
  p_mode text,
  p_outcome text,
  p_provider text DEFAULT 'evolution',
  p_provider_reference text DEFAULT NULL,
  p_http_status integer DEFAULT NULL,
  p_error_code text DEFAULT NULL,
  p_error_message text DEFAULT NULL,
  p_response_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  lead_id bigint,
  lead_status_id bigint,
  channels_id bigint,
  outcome text,
  proof_valid boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $function$
DECLARE
  v_lead public.leads%ROWTYPE;
  v_whatsapp_channel_id bigint;
  v_instagram_channel_id bigint;
  v_result_id bigint;
  v_result_key text;
  v_attempt_status_id bigint;
  v_current_phone text;
  v_validated_phone text;
  v_instagram text;
  v_target_status_id bigint;
  v_target_channel_id bigint;
  v_outcome text;
  v_now timestamptz := now();
  v_audit_action text;
BEGIN
  IF p_users_id IS NULL OR p_lead_id IS NULL THEN
    RAISE EXCEPTION 'whatsapp_validation_identity_required';
  END IF;
  IF p_mode NOT IN ('initial', 'revalidation') THEN
    RAISE EXCEPTION 'whatsapp_validation_mode_invalid';
  END IF;
  IF p_outcome NOT IN ('valid', 'invalid', 'technical_error') THEN
    RAISE EXCEPTION 'whatsapp_validation_outcome_invalid';
  END IF;
  IF lower(trim(coalesce(p_provider, ''))) <> 'evolution' THEN
    RAISE EXCEPTION 'whatsapp_validation_provider_invalid';
  END IF;
  IF p_http_status IS NOT NULL AND (p_http_status < 100 OR p_http_status > 599) THEN
    RAISE EXCEPTION 'whatsapp_validation_http_status_invalid';
  END IF;
  IF p_response_metadata IS NULL OR jsonb_typeof(p_response_metadata) <> 'object' THEN
    RAISE EXCEPTION 'whatsapp_validation_metadata_invalid';
  END IF;

  SELECT channel.channels_id
    INTO v_whatsapp_channel_id
  FROM public.channels AS channel
  WHERE lower(regexp_replace(public.unaccent(trim(channel.channels_name)), '[^a-z0-9]+', '', 'g')) = 'whatsapp'
  ORDER BY channel.channels_id
  LIMIT 1;

  SELECT channel.channels_id
    INTO v_instagram_channel_id
  FROM public.channels AS channel
  WHERE lower(regexp_replace(public.unaccent(trim(channel.channels_name)), '[^a-z0-9]+', '', 'g')) = 'instagram'
  ORDER BY channel.channels_id
  LIMIT 1;

  IF v_whatsapp_channel_id IS NULL OR v_instagram_channel_id IS NULL THEN
    RAISE EXCEPTION 'whatsapp_validation_channel_catalog_incomplete';
  END IF;

  SELECT lead.*
    INTO v_lead
  FROM public.leads AS lead
  WHERE lead.users_id = p_users_id
    AND lead.leads_id = p_lead_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'whatsapp_validation_lead_not_found';
  END IF;
  IF v_lead.channels_id IS DISTINCT FROM v_whatsapp_channel_id THEN
    RAISE EXCEPTION 'whatsapp_validation_channel_changed';
  END IF;
  IF (p_mode = 'initial' AND v_lead.lead_status_id <> 3)
     OR (p_mode = 'revalidation' AND v_lead.lead_status_id <> 2) THEN
    RAISE EXCEPTION 'whatsapp_validation_status_changed';
  END IF;

  v_current_phone := public.normalize_identity_phone(v_lead.leads_phone);
  v_validated_phone := public.normalize_identity_phone(p_validated_phone);
  IF v_current_phone = '' OR v_validated_phone = '' OR v_current_phone <> v_validated_phone THEN
    RAISE EXCEPTION 'whatsapp_validation_phone_changed';
  END IF;

  IF p_outcome = 'valid' THEN
    v_result_key := 'valido';
    v_attempt_status_id := 5;
    v_target_status_id := 2;
    v_target_channel_id := v_whatsapp_channel_id;
    v_outcome := CASE WHEN p_mode = 'initial' THEN 'approved' ELSE 'revalidated' END;
    v_audit_action := CASE WHEN p_mode = 'initial' THEN 'whatsapp_validation_approved' ELSE 'whatsapp_revalidation_approved' END;
  ELSIF p_outcome = 'invalid' THEN
    v_result_key := 'nao_encontrado';
    v_attempt_status_id := 5;
    v_instagram := public.normalize_identity_instagram(v_lead.leads_instagram);
    IF v_instagram <> ''
       AND v_instagram ~ '^[a-z0-9._]{1,30}$'
       AND v_instagram <> ALL(ARRAY[
         'about','accounts','api','challenge','contact','developer','direct','directory',
         'download','emails','explore','graphql','invites','legal','oauth','p','press',
         'reel','reels','stories','tv','web'
       ]) THEN
      v_target_status_id := 2;
      v_target_channel_id := v_instagram_channel_id;
      v_outcome := 'redirected';
      v_audit_action := 'whatsapp_invalid_redirected_to_instagram';
    ELSE
      v_target_status_id := 6;
      v_target_channel_id := v_whatsapp_channel_id;
      v_outcome := 'invalidated';
      v_audit_action := 'whatsapp_invalid_without_instagram';
    END IF;
  ELSE
    v_result_key := 'erro_tecnico';
    v_attempt_status_id := 6;
    v_target_status_id := v_lead.lead_status_id;
    v_target_channel_id := v_lead.channels_id;
    v_outcome := 'error';
    v_audit_action := CASE WHEN p_mode = 'initial' THEN 'whatsapp_validation_error' ELSE 'whatsapp_revalidation_error' END;
  END IF;

  SELECT result.lead_validation_results_id
    INTO v_result_id
  FROM public.lead_validation_results AS result
  WHERE result.lead_validation_results_key = v_result_key
  LIMIT 1;

  IF v_result_id IS NULL THEN
    RAISE EXCEPTION 'whatsapp_validation_result_catalog_missing:%', v_result_key;
  END IF;

  INSERT INTO public.lead_validation_attempts (
    users_id,
    leads_id,
    channels_id,
    chips_id,
    queue_items_id,
    validation_rules_id,
    lead_validation_results_id,
    status_id,
    lead_validation_attempts_input_value,
    lead_validation_attempts_provider,
    lead_validation_attempts_provider_reference,
    lead_validation_attempts_http_status,
    lead_validation_attempts_error_code,
    lead_validation_attempts_error_message,
    lead_validation_attempts_response_metadata,
    lead_validation_attempts_rules_snapshot,
    lead_validation_attempts_started_at,
    lead_validation_attempts_finished_at,
    lead_validation_attempts_created_at,
    lead_validation_attempts_updated_at
  ) VALUES (
    p_users_id,
    p_lead_id,
    v_whatsapp_channel_id,
    NULL,
    NULL,
    NULL,
    v_result_id,
    v_attempt_status_id,
    v_validated_phone,
    'evolution',
    nullif(trim(coalesce(p_provider_reference, '')), ''),
    p_http_status,
    nullif(trim(coalesce(p_error_code, '')), ''),
    nullif(trim(coalesce(p_error_message, '')), ''),
    p_response_metadata || jsonb_build_object('mode', p_mode, 'outcome', p_outcome),
    '{}'::jsonb,
    v_now,
    v_now,
    v_now,
    v_now
  );

  IF p_outcome <> 'technical_error' THEN
    UPDATE public.leads AS lead
    SET
      lead_status_id = v_target_status_id,
      channels_id = v_target_channel_id,
      leads_updated_at = v_now
    WHERE lead.users_id = p_users_id
      AND lead.leads_id = p_lead_id;
  END IF;

  PERFORM public.append_audit_event(
    'whatsapp-validation',
    v_audit_action,
    'lead',
    p_lead_id::text,
    p_lead_id,
    NULL,
    v_target_channel_id,
    v_lead.lead_status_id,
    v_target_status_id,
    coalesce(nullif(trim(coalesce(p_error_message, '')), ''), CASE WHEN p_outcome = 'valid' THEN 'WhatsApp confirmado pelo provedor.' WHEN p_outcome = 'invalid' THEN 'WhatsApp não encontrado pelo provedor.' ELSE 'Erro técnico durante a validação WhatsApp.' END),
    p_response_metadata || jsonb_build_object(
      'mode', p_mode,
      'provider', 'evolution',
      'validated_phone', v_validated_phone,
      'proof_valid', p_outcome = 'valid'
    ),
    p_users_id
  );

  RETURN QUERY SELECT
    p_lead_id,
    v_target_status_id,
    v_target_channel_id,
    v_outcome,
    public.has_current_whatsapp_validation_proof(p_users_id, p_lead_id);
END;
$function$;

COMMENT ON FUNCTION public.record_whatsapp_validation_result(bigint, bigint, text, text, text, text, text, integer, text, text, jsonb)
IS 'Registra resultado Evolution, preserva snapshot do telefone e aplica a transição canônica do lead; exclusiva de service_role.';

REVOKE ALL ON FUNCTION public.record_whatsapp_validation_result(bigint, bigint, text, text, text, text, text, integer, text, text, jsonb)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_whatsapp_validation_result(bigint, bigint, text, text, text, text, text, integer, text, text, jsonb)
TO service_role;

-- Preserva integralmente a implementação atômica anterior como núcleo privado e
-- restaura a assinatura pública com uma barreira de prova anterior ao commit.
ALTER FUNCTION public.prepare_queue_items(text, bigint, date, jsonb)
RENAME TO prepare_queue_items_without_whatsapp_validation_proof;

REVOKE ALL ON FUNCTION public.prepare_queue_items_without_whatsapp_validation_proof(text, bigint, date, jsonb)
FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.prepare_queue_items(
  p_channel text,
  p_resource_id bigint,
  p_scheduled_date date,
  p_items jsonb
)
RETURNS TABLE (
  lead_id bigint,
  queue_item_id bigint,
  outcome text,
  reason text,
  queue_id bigint,
  queue_position integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_users_id bigint;
  v_channel_name text;
  v_item jsonb;
  v_lead_id bigint;
  v_allowed_items jsonb := '[]'::jsonb;
BEGIN
  v_channel_name := lower(trim(coalesce(p_channel, '')));

  IF v_channel_name <> 'whatsapp' THEN
    RETURN QUERY
    SELECT *
    FROM public.prepare_queue_items_without_whatsapp_validation_proof(
      p_channel,
      p_resource_id,
      p_scheduled_date,
      p_items
    );
    RETURN;
  END IF;

  v_users_id := public.ensure_current_user();

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RETURN QUERY
    SELECT *
    FROM public.prepare_queue_items_without_whatsapp_validation_proof(
      p_channel,
      p_resource_id,
      p_scheduled_date,
      p_items
    );
    RETURN;
  END IF;

  -- Congela o telefone/status de todos os leads próprios em ordem determinística
  -- durante a decisão e o commit da fila, evitando corrida com edição do contato.
  PERFORM lead.leads_id
  FROM public.leads AS lead
  JOIN jsonb_array_elements(p_items) AS entry(value)
    ON coalesce(entry.value ->> 'lead_id', '') ~ '^[0-9]+$'
   AND lead.leads_id = (entry.value ->> 'lead_id')::bigint
  WHERE lead.users_id = v_users_id
  ORDER BY lead.leads_id
  FOR UPDATE OF lead;

  FOR v_item IN
    SELECT entry.value
    FROM jsonb_array_elements(p_items) WITH ORDINALITY AS entry(value, ordinal)
    ORDER BY entry.ordinal
  LOOP
    IF coalesce(v_item ->> 'lead_id', '') !~ '^[0-9]+$' THEN
      v_allowed_items := v_allowed_items || jsonb_build_array(v_item);
      CONTINUE;
    END IF;

    v_lead_id := (v_item ->> 'lead_id')::bigint;
    IF NOT EXISTS (
      SELECT 1 FROM public.leads AS lead
      WHERE lead.users_id = v_users_id AND lead.leads_id = v_lead_id
    ) THEN
      v_allowed_items := v_allowed_items || jsonb_build_array(v_item);
      CONTINUE;
    END IF;

    IF public.has_current_whatsapp_validation_proof(v_users_id, v_lead_id) THEN
      v_allowed_items := v_allowed_items || jsonb_build_array(v_item);
    ELSE
      lead_id := v_lead_id;
      queue_item_id := NULL;
      outcome := 'blocked';
      reason := 'whatsapp_validation_required';
      queue_id := NULL;
      queue_position := NULL;
      RETURN NEXT;
    END IF;
  END LOOP;

  IF jsonb_array_length(v_allowed_items) > 0 THEN
    RETURN QUERY
    SELECT *
    FROM public.prepare_queue_items_without_whatsapp_validation_proof(
      p_channel,
      p_resource_id,
      p_scheduled_date,
      v_allowed_items
    );
  END IF;
END;
$function$;

COMMENT ON FUNCTION public.prepare_queue_items(text, bigint, date, jsonb)
IS 'Reserva fila atomicamente; WhatsApp exige prova persistida atual da Evolution, Instagram preserva o fluxo anterior.';

REVOKE ALL ON FUNCTION public.prepare_queue_items(text, bigint, date, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prepare_queue_items(text, bigint, date, jsonb) TO authenticated;

COMMIT;
