BEGIN;

-- CRM R59 BUILD FIX 17
-- 1) Rollover canônico no banco: Fila final + Revisão consomem a mesma capacidade.
-- 2) Reconciliador de excesso criado pelo rollover antigo sem deslocar enviados/erros.
-- 3) Aprovação usa template canônico do mesmo branch/type/channel e não cria uma nova vaga.

CREATE OR REPLACE FUNCTION public.rollover_queue_items_to_capacity(
  p_channel text,
  p_target_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_org bigint := public.current_organization_id();
  v_user bigint := public.ensure_current_user();
  v_channel text := lower(trim(coalesce(p_channel, '')));
  v_target_date date := coalesce(p_target_date, current_date);
  v_channel_id bigint;
  v_move_status_ids bigint[];
  v_resource record;
  v_capacity record;
  v_item record;
  v_next_date date;
  v_next_position integer;
  v_excess integer;
  v_hops integer;
  v_moved integer := 0;
  v_reconciled integer := 0;
  v_unresolved integer := 0;
BEGIN
  PERFORM public.require_organization_permission('queues.prepare');
  IF v_org IS NULL OR v_user IS NULL THEN RAISE EXCEPTION 'organization_context_required'; END IF;
  IF v_channel NOT IN ('whatsapp', 'instagram') THEN RAISE EXCEPTION 'queue_rollover_invalid_channel'; END IF;
  IF v_target_date IS NULL THEN RAISE EXCEPTION 'queue_rollover_target_date_required'; END IF;

  v_channel_id := public.queue_review_channel_id(v_channel);

  SELECT coalesce(array_agg(s.status_id ORDER BY s.status_id), '{}'::bigint[])
  INTO v_move_status_ids
  FROM public.status s
  WHERE regexp_replace(lower(public.unaccent(trim(s.status_name))), '[^a-z0-9]+', '', 'g') IN
    ('pendente', 'pending', 'queued', 'pausado', 'paused');

  IF coalesce(array_length(v_move_status_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'queue_rollover_status_catalog_incomplete';
  END IF;

  -- Um único rollover por organização/canal/data pode redistribuir posições.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(format('queue-rollover:%s:%s:%s', v_org, v_channel, v_target_date), 0)
  );

  FOR v_resource IN
    SELECT * FROM public.list_queue_review_resources(v_channel, v_target_date)
    ORDER BY resource_id
  LOOP
    -- FIX 17: excesso já criado pelo rollover antigo. Só itens pendentes/pausados
    -- que vieram de uma queue de data anterior podem ser empurrados. Enviados,
    -- erros e itens nativos do dia não são alterados por reconciliação automática.
    v_excess := greatest(0, coalesce(v_resource.used, 0) - coalesce(v_resource.daily_limit, 0));

    IF v_excess > 0 THEN
      FOR v_item IN
        SELECT
          qi.queue_items_id,
          qi.queue_items_position,
          CASE
            WHEN right(coalesce(q.queues_name, ''), 10) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
              THEN right(q.queues_name, 10)::date
            ELSE NULL
          END AS source_date
        FROM public.queue_items qi
        JOIN public.queues q
          ON q.queues_id = qi.queues_id
         AND q.users_id = qi.users_id
        WHERE qi.organizations_id = v_org
          AND qi.users_id = v_user
          AND q.organizations_id = v_org
          AND q.channels_id = v_channel_id
          AND qi.status_id = ANY(v_move_status_ids)
          AND (coalesce(qi.queue_items_scheduled_at, q.queues_scheduled_at) AT TIME ZONE 'UTC')::date = v_target_date
          AND CASE WHEN v_channel = 'whatsapp' THEN qi.chips_id ELSE qi.socials_id END = v_resource.resource_id
          AND CASE
                WHEN right(coalesce(q.queues_name, ''), 10) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                  THEN right(q.queues_name, 10)::date < v_target_date
                ELSE false
              END
        ORDER BY source_date, qi.queue_items_position, qi.queue_items_created_at, qi.queue_items_id
        LIMIT v_excess
        FOR UPDATE OF qi
      LOOP
        v_next_date := v_target_date + 1;
        v_hops := 0;

        LOOP
          v_hops := v_hops + 1;
          IF v_hops > 370 THEN RAISE EXCEPTION 'queue_rollover_capacity_horizon_exceeded'; END IF;

          SELECT * INTO v_capacity
          FROM public.list_queue_review_resources(v_channel, v_next_date)
          WHERE resource_id = v_resource.resource_id;

          IF FOUND AND coalesce(v_capacity.available, 0) > 0 THEN EXIT; END IF;
          v_next_date := v_next_date + 1;
        END LOOP;

        SELECT coalesce(max(qi.queue_items_position), 0) + 1
        INTO v_next_position
        FROM public.queue_items qi
        JOIN public.queues q
          ON q.queues_id = qi.queues_id
         AND q.users_id = qi.users_id
        WHERE qi.organizations_id = v_org
          AND qi.users_id = v_user
          AND q.organizations_id = v_org
          AND q.channels_id = v_channel_id
          AND CASE WHEN v_channel = 'whatsapp' THEN qi.chips_id ELSE qi.socials_id END = v_resource.resource_id
          AND (coalesce(qi.queue_items_scheduled_at, q.queues_scheduled_at) AT TIME ZONE 'UTC')::date = v_next_date;

        UPDATE public.queue_items
        SET queue_items_scheduled_at = (v_next_date::timestamp + time '12:00:00') AT TIME ZONE 'UTC',
            queue_items_position = v_next_position,
            queue_items_updated_at = now()
        WHERE queue_items_id = v_item.queue_items_id
          AND organizations_id = v_org
          AND users_id = v_user;

        v_reconciled := v_reconciled + 1;
      END LOOP;

      SELECT * INTO v_capacity
      FROM public.list_queue_review_resources(v_channel, v_target_date)
      WHERE resource_id = v_resource.resource_id;
      v_unresolved := v_unresolved + greatest(0, coalesce(v_capacity.used, 0) - coalesce(v_capacity.daily_limit, 0));
    END IF;

    -- Virada normal: somente Em fila/Pausado de datas anteriores. A primeira
    -- data possível é hoje; se Revisão + Fila final já ocuparam o limite, avança.
    FOR v_item IN
      SELECT
        qi.queue_items_id,
        (coalesce(qi.queue_items_scheduled_at, q.queues_scheduled_at) AT TIME ZONE 'UTC')::date AS scheduled_date,
        qi.queue_items_position,
        qi.queue_items_created_at
      FROM public.queue_items qi
      JOIN public.queues q
        ON q.queues_id = qi.queues_id
       AND q.users_id = qi.users_id
      WHERE qi.organizations_id = v_org
        AND qi.users_id = v_user
        AND q.organizations_id = v_org
        AND q.channels_id = v_channel_id
        AND qi.status_id = ANY(v_move_status_ids)
        AND CASE WHEN v_channel = 'whatsapp' THEN qi.chips_id ELSE qi.socials_id END = v_resource.resource_id
        AND (coalesce(qi.queue_items_scheduled_at, q.queues_scheduled_at) AT TIME ZONE 'UTC')::date < v_target_date
      ORDER BY scheduled_date, qi.queue_items_position, qi.queue_items_created_at, qi.queue_items_id
      FOR UPDATE OF qi
    LOOP
      v_next_date := v_target_date;
      v_hops := 0;

      LOOP
        v_hops := v_hops + 1;
        IF v_hops > 370 THEN RAISE EXCEPTION 'queue_rollover_capacity_horizon_exceeded'; END IF;

        SELECT * INTO v_capacity
        FROM public.list_queue_review_resources(v_channel, v_next_date)
        WHERE resource_id = v_resource.resource_id;

        IF FOUND AND coalesce(v_capacity.available, 0) > 0 THEN EXIT; END IF;
        v_next_date := v_next_date + 1;
      END LOOP;

      SELECT coalesce(max(qi.queue_items_position), 0) + 1
      INTO v_next_position
      FROM public.queue_items qi
      JOIN public.queues q
        ON q.queues_id = qi.queues_id
       AND q.users_id = qi.users_id
      WHERE qi.organizations_id = v_org
        AND qi.users_id = v_user
        AND q.organizations_id = v_org
        AND q.channels_id = v_channel_id
        AND CASE WHEN v_channel = 'whatsapp' THEN qi.chips_id ELSE qi.socials_id END = v_resource.resource_id
        AND (coalesce(qi.queue_items_scheduled_at, q.queues_scheduled_at) AT TIME ZONE 'UTC')::date = v_next_date;

      UPDATE public.queue_items
      SET queue_items_scheduled_at = (v_next_date::timestamp + time '12:00:00') AT TIME ZONE 'UTC',
          queue_items_position = v_next_position,
          queue_items_updated_at = now()
      WHERE queue_items_id = v_item.queue_items_id
        AND organizations_id = v_org
        AND users_id = v_user;

      v_moved := v_moved + 1;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'contractVersion', 'R59',
    'channel', v_channel,
    'targetDate', v_target_date,
    'moved', v_moved,
    'reconciled', v_reconciled,
    'unresolvedOverflow', v_unresolved
  );
END;
$function$;

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
  v_requested_template_type_id bigint;
  v_template_id bigint;
  v_template_fallback boolean := false;
  v_lead_branch_id bigint;
  v_expected_type_key text;
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

  -- A Revisão já possui a vaga. Aprovar converte review_open -> fila_final e
  -- portanto não exige uma segunda vaga disponível antes da conversão.
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

  SELECT l.branches_id,
         CASE
           WHEN length(btrim(coalesce(l.leads_website, ''))) > 0
            AND lower(btrim(l.leads_website)) !~ '(instagram[.]com|facebook[.]com|fb[.]com|wa[.]me|whatsapp[.]com)'
             THEN 'comsite'
           ELSE 'semsite'
         END
  INTO v_lead_branch_id, v_expected_type_key
  FROM public.leads l
  WHERE l.leads_id = v_item.leads_id
    AND l.organizations_id = v_org
    AND l.users_id = v_user;

  -- O tipo solicitado é usado apenas como diagnóstico/fallback legado; o branch,
  -- canal, status e tipo efetivo do lead são validados novamente no banco.
  SELECT t.template_types_id
  INTO v_requested_template_type_id
  FROM public.templates t
  WHERE t.templates_id = p_template_id
    AND t.users_id = v_user
  LIMIT 1;

  IF v_requested_template_type_id IS NULL THEN
    RAISE EXCEPTION 'queue_review_template_not_found:lead=%:template=%', v_item.leads_id, p_template_id;
  END IF;

  SELECT t.templates_id
  INTO v_template_id
  FROM public.templates t
  JOIN public.template_channels tc
    ON tc.template_channels_id = t.template_channels_id
   AND tc.users_id = t.users_id
  JOIN public.template_types tt
    ON tt.template_types_id = t.template_types_id
   AND tt.users_id = t.users_id
  JOIN public.status ts
    ON ts.status_id = t.status_id
  JOIN public.status tcs
    ON tcs.status_id = tc.status_id
  WHERE t.templates_id = p_template_id
    AND t.users_id = v_user
    AND t.branches_id = v_lead_branch_id
    AND regexp_replace(lower(public.unaccent(trim(ts.status_name))), '[^a-z0-9]+', '', 'g') IN ('ativo', 'active')
    AND regexp_replace(lower(public.unaccent(trim(tcs.status_name))), '[^a-z0-9]+', '', 'g') IN ('ativo', 'active')
    AND regexp_replace(lower(public.unaccent(trim(tt.template_types_name))), '[^a-z0-9]+', '', 'g') = v_expected_type_key
    AND NOT (v_item.channels_id = ANY(coalesce(tc.template_channels_blocked_channels, ARRAY[]::bigint[])))
    AND (
      regexp_replace(lower(public.unaccent(trim(tc.template_channels_name))), '[^a-z0-9]+', '', 'g') = v_item.channel_key
      OR regexp_replace(lower(public.unaccent(trim(tc.template_channels_name))), '[^a-z0-9]+', '', 'g') IN ('geral', 'general')
    )
    AND length(trim(coalesce(t.templates_message_1, ''))) > 0
    AND NOT (
      length(trim(coalesce(t.templates_message_2, ''))) = 0
      AND (length(trim(coalesce(t.templates_message_3, ''))) > 0 OR length(trim(coalesce(t.templates_message_4, ''))) > 0)
    )
    AND NOT (
      length(trim(coalesce(t.templates_message_3, ''))) = 0
      AND length(trim(coalesce(t.templates_message_4, ''))) > 0
    )
  LIMIT 1;

  -- Se o template pedido pelo frontend divergir, o banco resolve um candidato
  -- canônico do mesmo branch/tipo. Isso elimina dependência de sorteio duplicado.
  IF v_template_id IS NULL THEN
    SELECT t.templates_id
    INTO v_template_id
    FROM public.templates t
    JOIN public.template_channels tc
      ON tc.template_channels_id = t.template_channels_id
     AND tc.users_id = t.users_id
    JOIN public.template_types tt
      ON tt.template_types_id = t.template_types_id
     AND tt.users_id = t.users_id
    JOIN public.status ts
      ON ts.status_id = t.status_id
    JOIN public.status tcs
      ON tcs.status_id = tc.status_id
    WHERE t.users_id = v_user
      AND t.branches_id = v_lead_branch_id
      AND regexp_replace(lower(public.unaccent(trim(ts.status_name))), '[^a-z0-9]+', '', 'g') IN ('ativo', 'active')
      AND regexp_replace(lower(public.unaccent(trim(tcs.status_name))), '[^a-z0-9]+', '', 'g') IN ('ativo', 'active')
      AND regexp_replace(lower(public.unaccent(trim(tt.template_types_name))), '[^a-z0-9]+', '', 'g') = v_expected_type_key
      AND NOT (v_item.channels_id = ANY(coalesce(tc.template_channels_blocked_channels, ARRAY[]::bigint[])))
      AND (
        regexp_replace(lower(public.unaccent(trim(tc.template_channels_name))), '[^a-z0-9]+', '', 'g') = v_item.channel_key
        OR regexp_replace(lower(public.unaccent(trim(tc.template_channels_name))), '[^a-z0-9]+', '', 'g') IN ('geral', 'general')
      )
      AND length(trim(coalesce(t.templates_message_1, ''))) > 0
      AND NOT (
        length(trim(coalesce(t.templates_message_2, ''))) = 0
        AND (length(trim(coalesce(t.templates_message_3, ''))) > 0 OR length(trim(coalesce(t.templates_message_4, ''))) > 0)
      )
      AND NOT (
        length(trim(coalesce(t.templates_message_3, ''))) = 0
        AND length(trim(coalesce(t.templates_message_4, ''))) > 0
      )
    ORDER BY
      CASE
        WHEN regexp_replace(lower(public.unaccent(trim(tc.template_channels_name))), '[^a-z0-9]+', '', 'g') = v_item.channel_key THEN 0
        ELSE 1
      END,
      hashtextextended(format('queue-template:%s:%s:%s', v_item.leads_id, t.templates_id, v_item.scheduled_date), 0),
      t.templates_id
    LIMIT 1;
    v_template_fallback := v_template_id IS NOT NULL;
  END IF;

  IF v_template_id IS NULL THEN
    RAISE EXCEPTION 'queue_review_template_unavailable:lead=%:requested_template=%:branch=%:channel=%:type=%',
      v_item.leads_id, p_template_id, v_lead_branch_id, v_item.channel_key, v_expected_type_key;
  END IF;

  SELECT * INTO v_result
  FROM public.prepare_queue_items(
    v_item.channel_key,
    v_item.resource_id,
    v_item.scheduled_date,
    jsonb_build_array(jsonb_build_object('lead_id', v_item.leads_id, 'template_id', v_template_id))
  );

  IF v_result.queue_item_id IS NULL OR v_result.outcome NOT IN ('queued', 'reconciled') THEN
    RAISE EXCEPTION 'queue_review_approval_failed:lead=%:template=%:%',
      v_item.leads_id, v_template_id, coalesce(v_result.reason, v_result.outcome, 'unknown');
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
    'reviewStatus', 'locked',
    'requestedTemplateId', p_template_id,
    'templateId', v_template_id,
    'templateFallbackUsed', v_template_fallback
  );
END;
$function$;

COMMIT;
