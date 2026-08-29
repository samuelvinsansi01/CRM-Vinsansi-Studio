-- CRM - Vinsansi Studio R59 BUILD FIX 8
-- CORRECAO CIRURGICA: nome alternativo e snapshot da fila.
-- Nao cria tabelas, colunas, status ou triggers.
-- Contrato R59:
--   leads_name             = nome original exibido nas tabelas
--   leads_alternative_name = nome opcional usado apenas na personalizacao do envio
--   snapshot.lead.company_name = nome efetivo usado no envio
--   snapshot.lead.original_company_name = nome original preservado
-- Ao editar o nome alternativo antes do inicio, o snapshot e o hash sao regenerados.

BEGIN;

CREATE OR REPLACE FUNCTION public.update_lead_alternative_name(
  p_lead_id bigint,
  p_alternative_name text,
  p_queue_item_id bigint DEFAULT NULL::bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
DECLARE
  v_org bigint := public.current_organization_id();
  v_user bigint := public.ensure_current_user();
  v_alt text := nullif(btrim(coalesce(p_alternative_name, '')), '');
  v_original_name text := '';
  v_item public.queue_items%ROWTYPE;
  v_snapshot jsonb;
  v_frozen timestamptz := now();
  v_send_company_name text := '';
BEGIN
  PERFORM public.require_organization_permission('leads.edit');

  IF p_lead_id IS NULL OR p_lead_id <= 0 THEN
    RAISE EXCEPTION 'lead_id_invalid';
  END IF;

  IF v_alt IS NOT NULL AND char_length(v_alt) > 160 THEN
    RAISE EXCEPTION 'alternative_name_too_long';
  END IF;

  UPDATE public.leads
  SET leads_alternative_name = v_alt,
      leads_updated_at = now()
  WHERE leads_id = p_lead_id
    AND organizations_id = v_org
    AND users_id = v_user
  RETURNING coalesce(leads_name, '') INTO v_original_name;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'lead_not_found_or_forbidden';
  END IF;

  v_send_company_name := coalesce(v_alt, v_original_name, '');

  IF p_queue_item_id IS NOT NULL THEN
    SELECT qi.*
    INTO v_item
    FROM public.queue_items qi
    WHERE qi.queue_items_id = p_queue_item_id
      AND qi.organizations_id = v_org
      AND qi.users_id = v_user
      AND qi.leads_id = p_lead_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'queue_item_not_found_or_forbidden';
    END IF;

    IF v_item.queue_items_started_at IS NOT NULL
       OR v_item.queue_items_finished_at IS NOT NULL THEN
      RAISE EXCEPTION 'queue_item_already_started';
    END IF;

    IF v_item.templates_id IS NULL THEN
      RAISE EXCEPTION 'queue_item_template_required';
    END IF;

    v_snapshot := public.build_queue_item_payload_snapshot(
      v_item.users_id,
      v_item.queues_id,
      v_item.leads_id,
      v_item.templates_id,
      v_frozen
    );

    v_original_name := coalesce(
      nullif(v_snapshot #>> '{lead,original_company_name}', ''),
      v_original_name,
      ''
    );
    v_send_company_name := coalesce(
      nullif(v_snapshot #>> '{lead,company_name}', ''),
      v_alt,
      v_original_name,
      ''
    );

    PERFORM set_config('vinsansi.allow_queue_snapshot_refresh', 'on', true);

    UPDATE public.queue_items
    SET queue_items_payload_snapshot = v_snapshot,
        queue_items_payload_hash = encode(
          extensions.digest(convert_to(v_snapshot::text, 'UTF8'), 'sha256'),
          'hex'
        ),
        queue_items_payload_created_at = v_frozen,
        queue_items_updated_at = now()
    WHERE queue_items_id = v_item.queue_items_id
      AND organizations_id = v_org;

    PERFORM set_config('vinsansi.allow_queue_snapshot_refresh', 'off', true);
  END IF;

  RETURN jsonb_build_object(
    'contractVersion', 'R59',
    'leadId', p_lead_id,
    'alternativeName', coalesce(v_alt, ''),
    'originalCompanyName', coalesce(v_original_name, ''),
    'sendCompanyName', coalesce(v_send_company_name, ''),
    'queueItemId', p_queue_item_id,
    'snapshotRefreshed', p_queue_item_id IS NOT NULL,
    'messages', coalesce(v_snapshot -> 'messages', '{}'::jsonb)
  );
END;
$function$;

-- A aprovacao ja estava funcional, mas ainda declarava um contrato de versao anterior.
-- Mantemos a implementacao canonica e removemos esse residuo de versao.
CREATE OR REPLACE FUNCTION public.approve_queue_review_item(
  p_review_item_id bigint,
  p_template_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_org bigint := public.current_organization_id();
  v_user bigint := public.ensure_current_user();
  v_item record;
  v_capacity record;
  v_result record;
  v_queue_item record;
  v_effective_phone text;
  v_snapshot_phone text;
  v_snapshot_message_1 text;
BEGIN
  PERFORM public.require_organization_permission('queues.prepare');
  IF v_org IS NULL OR v_user IS NULL THEN RAISE EXCEPTION 'organization_context_required'; END IF;
  IF p_review_item_id IS NULL OR p_review_item_id <= 0 THEN RAISE EXCEPTION 'queue_review_item_required'; END IF;
  IF p_template_id IS NULL OR p_template_id <= 0 THEN RAISE EXCEPTION 'queue_review_template_required'; END IF;

  SELECT i.queue_review_items_id, i.leads_id, b.queue_review_batches_id, b.channel_key, b.resource_id, b.scheduled_date, b.channels_id
  INTO v_item
  FROM public.queue_review_items i
  JOIN public.queue_review_batches b ON b.queue_review_batches_id = i.queue_review_batches_id
  WHERE i.queue_review_items_id = p_review_item_id
    AND i.organizations_id = v_org
    AND i.review_status = 'open'
    AND b.organizations_id = v_org
    AND b.users_id = v_user
    AND b.review_status = 'open';
  IF NOT FOUND THEN RAISE EXCEPTION 'queue_review_item_not_open'; END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(format('queue-review:%s:%s:%s:%s', v_org, v_item.channel_key, v_item.resource_id, v_item.scheduled_date), 0)
  );

  SELECT i.queue_review_items_id, i.leads_id, b.queue_review_batches_id, b.channel_key, b.resource_id, b.scheduled_date, b.channels_id
  INTO v_item
  FROM public.queue_review_items i
  JOIN public.queue_review_batches b ON b.queue_review_batches_id = i.queue_review_batches_id
  WHERE i.queue_review_items_id = p_review_item_id
    AND i.organizations_id = v_org
    AND i.review_status = 'open'
    AND b.organizations_id = v_org
    AND b.users_id = v_user
    AND b.review_status = 'open'
  FOR UPDATE OF i, b;
  IF NOT FOUND THEN RAISE EXCEPTION 'queue_review_item_not_open'; END IF;

  SELECT * INTO v_capacity
  FROM public.queue_review_resource_capacity(v_item.channel_key, v_item.resource_id, v_item.scheduled_date);
  IF coalesce(v_capacity.available, 0) <= 0 THEN RAISE EXCEPTION 'queue_review_resource_capacity_reached'; END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.leads l
    WHERE l.leads_id = v_item.leads_id
      AND l.organizations_id = v_org
      AND l.users_id = v_user
      AND l.lead_status_id = 2
      AND l.channels_id = v_item.channels_id
  ) THEN
    RAISE EXCEPTION 'queue_review_lead_changed';
  END IF;

  SELECT * INTO v_result
  FROM public.prepare_queue_items(
    v_item.channel_key,
    v_item.resource_id,
    v_item.scheduled_date,
    jsonb_build_array(jsonb_build_object('lead_id', v_item.leads_id, 'template_id', p_template_id))
  );

  IF v_result.queue_item_id IS NULL OR v_result.outcome NOT IN ('queued', 'reconciled') THEN
    RAISE EXCEPTION 'queue_review_approval_failed:%', coalesce(v_result.reason, v_result.outcome, 'unknown');
  END IF;

  UPDATE public.queue_review_items
  SET review_status = 'locked',
      queue_items_id = v_result.queue_item_id,
      updated_at = now()
  WHERE queue_review_items_id = p_review_item_id
    AND organizations_id = v_org
    AND review_status = 'open';
  IF NOT FOUND THEN RAISE EXCEPTION 'queue_review_item_changed'; END IF;

  SELECT qi.queue_items_id, qi.leads_id, qi.chips_id, qi.socials_id, qi.queue_items_payload_snapshot,
         (coalesce(qi.queue_items_scheduled_at, q.queues_scheduled_at) AT TIME ZONE 'UTC')::date AS scheduled_date
  INTO v_queue_item
  FROM public.queue_items qi
  JOIN public.queues q ON q.queues_id = qi.queues_id AND q.users_id = qi.users_id
  WHERE qi.queue_items_id = v_result.queue_item_id
    AND qi.organizations_id = v_org
    AND qi.users_id = v_user
    AND qi.leads_id = v_item.leads_id
    AND q.channels_id = v_item.channels_id
  LIMIT 1;

  IF NOT FOUND THEN RAISE EXCEPTION 'queue_review_queue_item_not_persisted'; END IF;
  IF v_queue_item.scheduled_date IS DISTINCT FROM v_item.scheduled_date THEN RAISE EXCEPTION 'queue_review_queue_item_wrong_date'; END IF;
  IF v_item.channel_key = 'whatsapp' AND v_queue_item.chips_id IS DISTINCT FROM v_item.resource_id THEN RAISE EXCEPTION 'queue_review_queue_item_wrong_chip'; END IF;
  IF v_item.channel_key = 'instagram' AND v_queue_item.socials_id IS DISTINCT FROM v_item.resource_id THEN RAISE EXCEPTION 'queue_review_queue_item_wrong_profile'; END IF;

  v_snapshot_message_1 := trim(coalesce(v_queue_item.queue_items_payload_snapshot #>> '{messages,message_1}', ''));
  IF v_snapshot_message_1 = '' THEN RAISE EXCEPTION 'queue_review_snapshot_message_1_missing'; END IF;

  IF v_item.channel_key = 'whatsapp' THEN
    SELECT public.effective_whatsapp_phone(l.leads_whatsapp, l.leads_phone)
    INTO v_effective_phone
    FROM public.leads l
    WHERE l.organizations_id = v_org
      AND l.users_id = v_user
      AND l.leads_id = v_item.leads_id;

    v_snapshot_phone := coalesce(v_queue_item.queue_items_payload_snapshot #>> '{recipient,phone}', '');
    IF regexp_replace(coalesce(v_snapshot_phone, ''), '[^0-9]+', '', 'g') = ''
       OR regexp_replace(coalesce(v_snapshot_phone, ''), '[^0-9]+', '', 'g')
          IS DISTINCT FROM regexp_replace(coalesce(v_effective_phone, ''), '[^0-9]+', '', 'g') THEN
      RAISE EXCEPTION 'queue_review_snapshot_whatsapp_recipient_mismatch';
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.queue_review_items i
    WHERE i.queue_review_items_id = p_review_item_id
      AND i.organizations_id = v_org
      AND i.review_status = 'locked'
      AND i.queue_items_id = v_result.queue_item_id
  ) THEN
    RAISE EXCEPTION 'queue_review_lock_not_persisted';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.leads l
    WHERE l.leads_id = v_item.leads_id
      AND l.organizations_id = v_org
      AND l.users_id = v_user
      AND l.lead_status_id = 4
      AND l.channels_id = v_item.channels_id
  ) THEN
    RAISE EXCEPTION 'queue_review_lead_not_queued';
  END IF;

  SELECT * INTO v_capacity
  FROM public.queue_review_resource_capacity(v_item.channel_key, v_item.resource_id, v_item.scheduled_date);

  UPDATE public.queue_review_batches
  SET target_count = v_capacity.available,
      updated_at = now()
  WHERE queue_review_batches_id = v_item.queue_review_batches_id
    AND organizations_id = v_org;

  RETURN jsonb_build_object(
    'contractVersion', 'R59',
    'persisted', true,
    'reviewItemId', p_review_item_id,
    'leadId', v_item.leads_id,
    'queueItemId', v_result.queue_item_id,
    'outcome', v_result.outcome,
    'reviewStatus', 'locked'
  );
END;
$function$;

COMMIT;
