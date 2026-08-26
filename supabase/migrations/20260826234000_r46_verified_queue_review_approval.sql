-- CRM - Vinsansi Studio v2.4.0-R46
-- Aprovação da Revisão só retorna sucesso depois de comprovar, na mesma transação,
-- que a revisão foi trancada e o queue_item canônico existe com snapshot utilizável.

BEGIN;

CREATE OR REPLACE FUNCTION public.approve_queue_review_item(
  p_review_item_id bigint,
  p_template_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog,public
AS $$
DECLARE
  v_org bigint:=public.current_organization_id();
  v_user bigint:=public.ensure_current_user();
  v_item record;
  v_capacity record;
  v_result record;
  v_queue_item record;
  v_pre_send_status bigint;
  v_validated_status bigint;
  v_effective_phone text;
  v_snapshot_phone text;
  v_snapshot_message_1 text;
BEGIN
  PERFORM public.require_organization_permission('queues.prepare');
  IF v_org IS NULL OR v_user IS NULL THEN RAISE EXCEPTION 'organization_context_required'; END IF;
  IF p_review_item_id IS NULL OR p_review_item_id<=0 THEN RAISE EXCEPTION 'queue_review_item_required'; END IF;
  IF p_template_id IS NULL OR p_template_id<=0 THEN RAISE EXCEPTION 'queue_review_template_required'; END IF;

  SELECT ls.lead_status_id INTO v_pre_send_status
  FROM public.lead_status ls
  WHERE regexp_replace(lower(public.unaccent(trim(ls.lead_status_name))), '[^a-z0-9]+', '', 'g') IN
    ('preenvio','presend','emrevisao','revisao')
  ORDER BY CASE WHEN ls.lead_status_id=3 THEN 0 ELSE 1 END,ls.lead_status_id
  LIMIT 1;

  SELECT ls.lead_status_id INTO v_validated_status
  FROM public.lead_status ls
  WHERE regexp_replace(lower(public.unaccent(trim(ls.lead_status_name))), '[^a-z0-9]+', '', 'g') IN
    ('validado','validated','aprovado','approved')
  ORDER BY CASE WHEN ls.lead_status_id=2 THEN 0 ELSE 1 END,ls.lead_status_id
  LIMIT 1;

  -- Compatibilidade com o catálogo histórico do CRM, cujos IDs canônicos são 3/2.
  v_pre_send_status:=coalesce(v_pre_send_status,3);
  v_validated_status:=coalesce(v_validated_status,2);

  SELECT
    i.queue_review_items_id,
    i.leads_id,
    b.queue_review_batches_id,
    b.channel_key,
    b.resource_id,
    b.scheduled_date,
    b.channels_id
  INTO v_item
  FROM public.queue_review_items i
  JOIN public.queue_review_batches b ON b.queue_review_batches_id=i.queue_review_batches_id
  WHERE i.queue_review_items_id=p_review_item_id
    AND i.organizations_id=v_org
    AND i.review_status='open'
    AND b.organizations_id=v_org
    AND b.users_id=v_user
    AND b.review_status='open';

  IF NOT FOUND THEN RAISE EXCEPTION 'queue_review_item_not_open'; END IF;

  -- Mesma ordem de trava da puxada/preparação para impedir corrida entre cliques.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(format('queue-review:%s:%s:%s:%s',v_org,v_item.channel_key,v_item.resource_id,v_item.scheduled_date),0)
  );

  SELECT
    i.queue_review_items_id,
    i.leads_id,
    b.queue_review_batches_id,
    b.channel_key,
    b.resource_id,
    b.scheduled_date,
    b.channels_id
  INTO v_item
  FROM public.queue_review_items i
  JOIN public.queue_review_batches b ON b.queue_review_batches_id=i.queue_review_batches_id
  WHERE i.queue_review_items_id=p_review_item_id
    AND i.organizations_id=v_org
    AND i.review_status='open'
    AND b.organizations_id=v_org
    AND b.users_id=v_user
    AND b.review_status='open'
  FOR UPDATE OF i,b;

  IF NOT FOUND THEN RAISE EXCEPTION 'queue_review_item_not_open'; END IF;

  SELECT * INTO v_capacity
  FROM public.queue_review_resource_capacity(v_item.channel_key,v_item.resource_id,v_item.scheduled_date);
  IF coalesce(v_capacity.available,0)<=0 THEN
    RAISE EXCEPTION 'queue_review_resource_capacity_reached';
  END IF;

  UPDATE public.leads l
  SET lead_status_id=v_validated_status,
      channels_id=v_item.channels_id,
      leads_updated_at=now()
  WHERE l.leads_id=v_item.leads_id
    AND l.organizations_id=v_org
    AND l.users_id=v_user
    AND l.lead_status_id=v_pre_send_status;
  IF NOT FOUND THEN RAISE EXCEPTION 'queue_review_lead_changed'; END IF;

  SELECT * INTO v_result
  FROM public.prepare_queue_items(
    v_item.channel_key,
    v_item.resource_id,
    v_item.scheduled_date,
    jsonb_build_array(jsonb_build_object('lead_id',v_item.leads_id,'template_id',p_template_id))
  );

  IF v_result.queue_item_id IS NULL OR v_result.outcome NOT IN ('queued','reconciled') THEN
    RAISE EXCEPTION 'queue_review_approval_failed:%',coalesce(v_result.reason,v_result.outcome,'unknown');
  END IF;

  UPDATE public.queue_review_items
  SET review_status='locked',
      queue_items_id=v_result.queue_item_id,
      updated_at=now()
  WHERE queue_review_items_id=p_review_item_id
    AND organizations_id=v_org
    AND review_status='open';
  IF NOT FOUND THEN RAISE EXCEPTION 'queue_review_item_changed'; END IF;

  -- Pós-condição R46: não existe "sucesso visual" sem item canônico persistido.
  SELECT
    qi.queue_items_id,
    qi.leads_id,
    qi.chips_id,
    qi.socials_id,
    qi.queue_items_payload_snapshot,
    (coalesce(qi.queue_items_scheduled_at,q.queues_scheduled_at) AT TIME ZONE 'UTC')::date AS scheduled_date
  INTO v_queue_item
  FROM public.queue_items qi
  JOIN public.queues q ON q.queues_id=qi.queues_id AND q.users_id=qi.users_id
  WHERE qi.queue_items_id=v_result.queue_item_id
    AND qi.organizations_id=v_org
    AND qi.users_id=v_user
    AND qi.leads_id=v_item.leads_id
    AND q.channels_id=v_item.channels_id
  LIMIT 1;

  IF NOT FOUND THEN RAISE EXCEPTION 'queue_review_queue_item_not_persisted'; END IF;
  IF v_queue_item.scheduled_date IS DISTINCT FROM v_item.scheduled_date THEN
    RAISE EXCEPTION 'queue_review_queue_item_wrong_date';
  END IF;
  IF v_item.channel_key='whatsapp' AND v_queue_item.chips_id IS DISTINCT FROM v_item.resource_id THEN
    RAISE EXCEPTION 'queue_review_queue_item_wrong_chip';
  END IF;
  IF v_item.channel_key='instagram' AND v_queue_item.socials_id IS DISTINCT FROM v_item.resource_id THEN
    RAISE EXCEPTION 'queue_review_queue_item_wrong_profile';
  END IF;

  v_snapshot_message_1:=trim(coalesce(v_queue_item.queue_items_payload_snapshot#>>'{messages,message_1}',''));
  IF v_snapshot_message_1='' THEN RAISE EXCEPTION 'queue_review_snapshot_message_1_missing'; END IF;

  IF v_item.channel_key='whatsapp' THEN
    SELECT public.effective_whatsapp_phone(l.leads_whatsapp,l.leads_phone)
      INTO v_effective_phone
    FROM public.leads l
    WHERE l.organizations_id=v_org AND l.users_id=v_user AND l.leads_id=v_item.leads_id;

    v_snapshot_phone:=coalesce(v_queue_item.queue_items_payload_snapshot#>>'{recipient,phone}','');
    IF regexp_replace(coalesce(v_snapshot_phone,''),'[^0-9]+','','g')=''
       OR regexp_replace(coalesce(v_snapshot_phone,''),'[^0-9]+','','g')
          IS DISTINCT FROM regexp_replace(coalesce(v_effective_phone,''),'[^0-9]+','','g') THEN
      RAISE EXCEPTION 'queue_review_snapshot_whatsapp_recipient_mismatch';
    END IF;
  END IF;

  -- Confirma a própria transição da revisão dentro da transação.
  IF NOT EXISTS(
    SELECT 1 FROM public.queue_review_items i
    WHERE i.queue_review_items_id=p_review_item_id
      AND i.organizations_id=v_org
      AND i.review_status='locked'
      AND i.queue_items_id=v_result.queue_item_id
  ) THEN
    RAISE EXCEPTION 'queue_review_lock_not_persisted';
  END IF;

  SELECT * INTO v_capacity
  FROM public.queue_review_resource_capacity(v_item.channel_key,v_item.resource_id,v_item.scheduled_date);
  UPDATE public.queue_review_batches
  SET target_count=v_capacity.available,updated_at=now()
  WHERE queue_review_batches_id=v_item.queue_review_batches_id
    AND organizations_id=v_org;

  RETURN jsonb_build_object(
    'contractVersion','R46',
    'persisted',true,
    'reviewItemId',p_review_item_id,
    'leadId',v_item.leads_id,
    'queueItemId',v_result.queue_item_id,
    'outcome',v_result.outcome,
    'reviewStatus','locked'
  );
END
$$;

REVOKE ALL ON FUNCTION public.approve_queue_review_item(bigint,bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.approve_queue_review_item(bigint,bigint) TO authenticated;

-- Diagnóstico leve usado pelo frontend e pelo suporte para conferir uma aprovação
-- já concluída sem expor dados de outro tenant.
CREATE OR REPLACE FUNCTION public.queue_review_approval_state(p_review_item_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path TO pg_catalog,public
AS $$
DECLARE
  v_org bigint:=public.current_organization_id();
  v_user bigint:=public.ensure_current_user();
  v_row record;
BEGIN
  PERFORM public.require_organization_permission('queues.view');
  SELECT i.review_status,i.queue_items_id,i.leads_id,b.channel_key,b.resource_id,b.scheduled_date,
         qi.queue_items_payload_snapshot
    INTO v_row
  FROM public.queue_review_items i
  JOIN public.queue_review_batches b ON b.queue_review_batches_id=i.queue_review_batches_id
  LEFT JOIN public.queue_items qi ON qi.queue_items_id=i.queue_items_id
    AND qi.organizations_id=v_org AND qi.users_id=v_user
  WHERE i.queue_review_items_id=p_review_item_id
    AND i.organizations_id=v_org
    AND b.organizations_id=v_org
    AND b.users_id=v_user
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('contractVersion','R46','persisted',false,'reason','review_item_not_found');
  END IF;

  RETURN jsonb_build_object(
    'contractVersion','R46',
    'persisted',v_row.review_status='locked' AND v_row.queue_items_id IS NOT NULL AND v_row.queue_items_payload_snapshot IS NOT NULL,
    'reviewStatus',v_row.review_status,
    'queueItemId',v_row.queue_items_id,
    'leadId',v_row.leads_id,
    'channel',v_row.channel_key,
    'resourceId',v_row.resource_id,
    'scheduledDate',v_row.scheduled_date
  );
END
$$;

REVOKE ALL ON FUNCTION public.queue_review_approval_state(bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.queue_review_approval_state(bigint) TO authenticated,service_role;

COMMIT;
