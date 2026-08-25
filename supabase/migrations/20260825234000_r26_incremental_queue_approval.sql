-- CRM - Vinsansi Studio v2.4.0-R26
-- Aprovação individual da revisão, capacidade estrita por recurso e invalidação da fila final.

BEGIN;

CREATE OR REPLACE FUNCTION public.queue_review_resource_capacity(
  p_channel text,
  p_resource_id bigint,
  p_scheduled_date date
)
RETURNS TABLE(daily_limit integer,used integer,available integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog,public
AS $$
DECLARE
  v_user bigint:=public.ensure_current_user();
  v_channel text:=lower(trim(coalesce(p_channel,'')));
  v_channel_id bigint;
  v_active bigint;
  v_invalid_status_ids bigint[];
  v_limit integer;
  v_used integer:=0;
BEGIN
  IF v_channel NOT IN ('whatsapp','instagram') THEN RAISE EXCEPTION 'queue_review_invalid_channel'; END IF;
  v_channel_id:=public.queue_review_channel_id(v_channel);

  SELECT s.status_id INTO v_active
  FROM public.status s
  WHERE regexp_replace(lower(public.unaccent(trim(s.status_name))), '[^a-z0-9]+', '', 'g') IN ('ativo','active')
  ORDER BY s.status_id LIMIT 1;

  SELECT coalesce(array_agg(s.status_id ORDER BY s.status_id),'{}'::bigint[]) INTO v_invalid_status_ids
  FROM public.status s
  WHERE regexp_replace(lower(public.unaccent(trim(s.status_name))), '[^a-z0-9]+', '', 'g') IN
    ('invalido','invalid','cancelado','cancelled','canceled');

  IF v_channel='whatsapp' THEN
    SELECT l.levels_daily_limit INTO v_limit
    FROM public.chips c
    JOIN public.instances i ON i.instances_id=c.instances_id AND i.users_id=c.users_id
    JOIN public.levels l ON l.levels_id=c.levels_id AND l.users_id=c.users_id
    WHERE c.chips_id=p_resource_id AND c.users_id=v_user AND c.status_id=v_active
      AND i.status_id=v_active AND l.status_id=v_active AND l.channels_id=v_channel_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'queue_review_resource_not_operational'; END IF;

    SELECT count(*)::integer INTO v_used
    FROM public.queue_items qi
    JOIN public.queues q ON q.queues_id=qi.queues_id AND q.users_id=qi.users_id
    WHERE qi.users_id=v_user AND q.channels_id=v_channel_id AND qi.chips_id=p_resource_id
      AND NOT (qi.status_id=ANY(v_invalid_status_ids))
      AND (coalesce(qi.queue_items_scheduled_at,q.queues_scheduled_at) AT TIME ZONE 'UTC')::date=p_scheduled_date;
  ELSE
    SELECT l.levels_daily_limit INTO v_limit
    FROM public.socials so
    JOIN public.levels l ON l.levels_id=so.levels_id AND l.users_id=so.users_id
    WHERE so.socials_id=p_resource_id AND so.users_id=v_user AND so.status_id=v_active
      AND l.status_id=v_active AND l.channels_id=v_channel_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'queue_review_resource_not_operational'; END IF;

    SELECT count(*)::integer INTO v_used
    FROM public.queue_items qi
    JOIN public.queues q ON q.queues_id=qi.queues_id AND q.users_id=qi.users_id
    WHERE qi.users_id=v_user AND q.channels_id=v_channel_id AND qi.socials_id=p_resource_id
      AND NOT (qi.status_id=ANY(v_invalid_status_ids))
      AND (coalesce(qi.queue_items_scheduled_at,q.queues_scheduled_at) AT TIME ZONE 'UTC')::date=p_scheduled_date;
  END IF;

  daily_limit:=greatest(0,coalesce(v_limit,0));
  used:=greatest(0,coalesce(v_used,0));
  available:=greatest(0,daily_limit-used);
  RETURN NEXT;
END
$$;
REVOKE ALL ON FUNCTION public.queue_review_resource_capacity(text,bigint,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.queue_review_resource_capacity(text,bigint,date) TO authenticated,service_role;


CREATE OR REPLACE FUNCTION public.open_queue_review_batch(
  p_channel text,
  p_resource_id bigint,
  p_scheduled_date date DEFAULT current_date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog,public
AS $$
DECLARE
  v_org bigint:=public.current_organization_id();
  v_user bigint:=public.ensure_current_user();
  v_channel text:=lower(trim(coalesce(p_channel,'')));
  v_channel_id bigint;
  v_capacity record;
  v_batch bigint;
  v_open integer;
  v_date date:=coalesce(p_scheduled_date,current_date);
BEGIN
  PERFORM public.require_organization_permission('queues.prepare');
  IF v_channel NOT IN ('whatsapp','instagram') THEN RAISE EXCEPTION 'queue_review_invalid_channel'; END IF;
  IF p_resource_id IS NULL OR p_resource_id<=0 THEN RAISE EXCEPTION 'queue_review_resource_required'; END IF;
  v_channel_id:=public.queue_review_channel_id(v_channel);
  IF v_channel_id IS NULL THEN RAISE EXCEPTION 'queue_review_channel_not_found'; END IF;

  -- Serializa puxadas/aprovações do mesmo recurso e data antes de calcular capacidade.
  PERFORM pg_advisory_xact_lock(hashtextextended(format('queue-review:%s:%s:%s:%s',v_org,v_channel,p_resource_id,v_date),0));
  SELECT * INTO v_capacity FROM public.queue_review_resource_capacity(v_channel,p_resource_id,v_date);

  SELECT b.queue_review_batches_id INTO v_batch
  FROM public.queue_review_batches b
  WHERE b.organizations_id=v_org AND b.channel_key=v_channel AND b.resource_id=p_resource_id
    AND b.scheduled_date=v_date AND b.review_status='open'
  FOR UPDATE;

  IF v_batch IS NULL THEN
    INSERT INTO public.queue_review_batches(organizations_id,users_id,channels_id,channel_key,resource_id,scheduled_date,target_count)
    VALUES(v_org,v_user,v_channel_id,v_channel,p_resource_id,v_date,v_capacity.available)
    RETURNING queue_review_batches_id INTO v_batch;
  ELSE
    UPDATE public.queue_review_batches
    SET target_count=v_capacity.available,updated_at=now()
    WHERE queue_review_batches_id=v_batch;
  END IF;

  SELECT count(*)::integer INTO v_open FROM public.queue_review_items i
  WHERE i.queue_review_batches_id=v_batch AND i.review_status='open';

  RETURN jsonb_build_object(
    'batchId',v_batch,'channel',v_channel,'resourceId',p_resource_id,'scheduledDate',v_date,
    'dailyLimit',v_capacity.daily_limit,'used',v_capacity.used,'targetCount',v_capacity.available,'openCount',v_open,
    'missingCount',greatest(0,v_capacity.available-v_open)
  );
END
$$;
REVOKE ALL ON FUNCTION public.open_queue_review_batch(text,bigint,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.open_queue_review_batch(text,bigint,date) TO authenticated;


CREATE OR REPLACE FUNCTION public.reserve_queue_review_items(p_batch_id bigint,p_lead_ids bigint[])
RETURNS TABLE(lead_id bigint,review_item_id bigint,outcome text,reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog,public
AS $$
DECLARE
  v_org bigint:=public.current_organization_id();
  v_user bigint:=public.ensure_current_user();
  v_batch public.queue_review_batches%ROWTYPE;
  v_lead public.leads%ROWTYPE;
  v_capacity record;
  v_id bigint;
  v_open integer;
  v_pos integer;
BEGIN
  PERFORM public.require_organization_permission('queues.prepare');

  -- Descobre a chave antes de travar; depois serializa o recurso/data e relê o lote FOR UPDATE.
  SELECT * INTO v_batch FROM public.queue_review_batches b
  WHERE b.queue_review_batches_id=p_batch_id AND b.organizations_id=v_org AND b.users_id=v_user AND b.review_status='open';
  IF NOT FOUND THEN RAISE EXCEPTION 'queue_review_batch_not_open'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(format('queue-review:%s:%s:%s:%s',v_org,v_batch.channel_key,v_batch.resource_id,v_batch.scheduled_date),0));
  SELECT * INTO v_batch FROM public.queue_review_batches b
  WHERE b.queue_review_batches_id=p_batch_id AND b.organizations_id=v_org AND b.users_id=v_user AND b.review_status='open'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'queue_review_batch_not_open'; END IF;

  SELECT * INTO v_capacity
  FROM public.queue_review_resource_capacity(v_batch.channel_key,v_batch.resource_id,v_batch.scheduled_date);
  UPDATE public.queue_review_batches
  SET target_count=v_capacity.available,updated_at=now()
  WHERE queue_review_batches_id=p_batch_id;
  v_batch.target_count:=v_capacity.available;

  SELECT count(*)::integer INTO v_open FROM public.queue_review_items i
  WHERE i.queue_review_batches_id=p_batch_id AND i.review_status='open';
  SELECT coalesce(max(i.review_position),0) INTO v_pos FROM public.queue_review_items i WHERE i.queue_review_batches_id=p_batch_id;

  FOREACH v_id IN ARRAY coalesce(p_lead_ids,'{}'::bigint[]) LOOP
    lead_id:=v_id;review_item_id:=NULL;outcome:='skipped';reason:=NULL;
    IF v_open>=v_batch.target_count THEN outcome:='capacity';reason:='A revisão já atingiu a capacidade disponível.';RETURN NEXT;CONTINUE;END IF;
    SELECT * INTO v_lead FROM public.leads l
    WHERE l.leads_id=v_id AND l.organizations_id=v_org AND l.users_id=v_user FOR UPDATE;
    IF NOT FOUND THEN outcome:='conflict';reason:='Lead não encontrado.';RETURN NEXT;CONTINUE;END IF;
    IF v_lead.lead_status_id<>1 THEN outcome:='conflict';reason:='O lead não está mais como Importado.';RETURN NEXT;CONTINUE;END IF;
    IF EXISTS(SELECT 1 FROM public.permanent_records pr WHERE pr.organizations_id=v_org AND pr.canonical_lead_id=coalesce(v_lead.canonical_lead_id,v_lead.leads_id)) THEN
      outcome:='blocked';reason:='Empresa já está na Base Permanente.';RETURN NEXT;CONTINUE;
    END IF;
    IF v_batch.channel_key='whatsapp' AND length(regexp_replace(coalesce(nullif(trim(v_lead.leads_whatsapp),''),v_lead.leads_phone,''),'[^0-9]+','','g'))<10 THEN
      outcome:='blocked';reason:='Lead sem telefone/WhatsApp válido.';RETURN NEXT;CONTINUE;
    END IF;
    IF v_batch.channel_key='instagram' AND length(trim(coalesce(v_lead.leads_instagram,'')))=0 THEN
      outcome:='blocked';reason:='Lead sem Instagram.';RETURN NEXT;CONTINUE;
    END IF;
    BEGIN
      v_pos:=v_pos+1;
      INSERT INTO public.queue_review_items(organizations_id,queue_review_batches_id,leads_id,review_position)
      VALUES(v_org,p_batch_id,v_id,v_pos) RETURNING queue_review_items_id INTO review_item_id;
      UPDATE public.leads SET lead_status_id=3,channels_id=v_batch.channels_id,leads_updated_at=now()
      WHERE leads_id=v_id AND organizations_id=v_org AND users_id=v_user AND lead_status_id=1;
      IF NOT FOUND THEN RAISE EXCEPTION 'lead_changed'; END IF;
      v_open:=v_open+1;outcome:='reserved';reason:=NULL;RETURN NEXT;
    EXCEPTION WHEN unique_violation THEN
      outcome:='conflict';reason:='O lead já está reservado em outra revisão.';RETURN NEXT;
    END;
  END LOOP;
  UPDATE public.queue_review_batches SET updated_at=now() WHERE queue_review_batches_id=p_batch_id;
END
$$;
REVOKE ALL ON FUNCTION public.reserve_queue_review_items(bigint,bigint[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.reserve_queue_review_items(bigint,bigint[]) TO authenticated;

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
BEGIN
  PERFORM public.require_organization_permission('queues.prepare');

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
  IF p_template_id IS NULL OR p_template_id<=0 THEN RAISE EXCEPTION 'queue_review_template_required'; END IF;

  -- Mesma ordem de trava da puxada: recurso/data primeiro, linhas depois.
  PERFORM pg_advisory_xact_lock(hashtextextended(format('queue-review:%s:%s:%s:%s',v_org,v_item.channel_key,v_item.resource_id,v_item.scheduled_date),0));
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
  SET lead_status_id=2,channels_id=v_item.channels_id,leads_updated_at=now()
  WHERE l.leads_id=v_item.leads_id
    AND l.organizations_id=v_org
    AND l.users_id=v_user
    AND l.lead_status_id=3;
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
  SET review_status='locked',queue_items_id=v_result.queue_item_id,updated_at=now()
  WHERE queue_review_items_id=p_review_item_id AND review_status='open';
  IF NOT FOUND THEN RAISE EXCEPTION 'queue_review_item_changed'; END IF;

  -- Depois de criar o queue_item, a capacidade restante da Revisão diminui em uma vaga.
  -- Recalcular evita exibir 59/60 quando 1 já está aprovado na Fila final.
  SELECT * INTO v_capacity
  FROM public.queue_review_resource_capacity(v_item.channel_key,v_item.resource_id,v_item.scheduled_date);
  UPDATE public.queue_review_batches
  SET target_count=v_capacity.available,updated_at=now()
  WHERE queue_review_batches_id=v_item.queue_review_batches_id;

  RETURN jsonb_build_object(
    'reviewItemId',p_review_item_id,
    'leadId',v_item.leads_id,
    'queueItemId',v_result.queue_item_id,
    'outcome',v_result.outcome
  );
END
$$;
REVOKE ALL ON FUNCTION public.approve_queue_review_item(bigint,bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.approve_queue_review_item(bigint,bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_open_queue_review(p_channel text)
RETURNS TABLE(
  batch_id bigint,review_item_id bigint,channel_key text,resource_id bigint,scheduled_date date,target_count integer,
  lead_id bigint,"position" integer,company text,branch_id bigint,branch_name text,city text,state text,phone text,whatsapp text,instagram text,website text,
  rating numeric,reviews integer
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path TO pg_catalog,public
AS $$
DECLARE v_org bigint:=public.current_organization_id();v_user bigint:=public.ensure_current_user();v_channel text:=lower(trim(coalesce(p_channel,'')));
BEGIN
  PERFORM public.require_organization_permission('queues.view');
  RETURN QUERY
  SELECT
    b.queue_review_batches_id,
    i.queue_review_items_id,
    b.channel_key,
    b.resource_id,
    b.scheduled_date,
    b.target_count,
    l.leads_id,
    row_number() OVER (PARTITION BY b.queue_review_batches_id ORDER BY i.review_position,i.queue_review_items_id)::integer,
    l.leads_name,
    l.branches_id,
    coalesce(br.branches_name,''),
    coalesce(ci.cities_name,''),
    coalesce(st.states_code,st.states_name,''),
    coalesce(l.leads_phone,''),
    coalesce(l.leads_whatsapp,''),
    coalesce(l.leads_instagram,''),
    coalesce(l.leads_website,''),
    coalesce(l.leads_score,0)::numeric,
    coalesce(l.leads_reviews_count,0)::integer
  FROM public.queue_review_batches b
  JOIN public.queue_review_items i ON i.queue_review_batches_id=b.queue_review_batches_id AND i.review_status='open'
  JOIN public.leads l ON l.leads_id=i.leads_id AND l.organizations_id=b.organizations_id
  LEFT JOIN public.branches br ON br.branches_id=l.branches_id
  LEFT JOIN public.cities ci ON ci.cities_id=l.cities_id
  LEFT JOIN public.states st ON st.states_id=l.states_id
  WHERE b.organizations_id=v_org AND b.users_id=v_user AND b.review_status='open' AND b.channel_key=v_channel
  ORDER BY b.created_at,b.queue_review_batches_id,i.review_position;
END
$$;
REVOKE ALL ON FUNCTION public.list_open_queue_review(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_open_queue_review(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.invalidate_final_queue_item(
  p_queue_item_id bigint,
  p_reason text DEFAULT 'invalidado pelo operador'
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
  v_status_key text;
  v_invalid_status bigint;
  v_invalid_lead_status bigint;
BEGIN
  PERFORM public.require_organization_permission('leads.validate');

  SELECT qi.queue_items_id,qi.leads_id,qi.status_id,q.channels_id
  INTO v_item
  FROM public.queue_items qi
  JOIN public.queues q ON q.queues_id=qi.queues_id AND q.users_id=qi.users_id
  JOIN public.leads l ON l.leads_id=qi.leads_id AND l.users_id=qi.users_id
  WHERE qi.queue_items_id=p_queue_item_id
    AND qi.users_id=v_user
    AND l.organizations_id=v_org
  FOR UPDATE OF qi,l;
  IF NOT FOUND THEN RAISE EXCEPTION 'queue_item_not_found'; END IF;

  SELECT regexp_replace(lower(public.unaccent(trim(s.status_name))), '[^a-z0-9]+', '', 'g')
  INTO v_status_key FROM public.status s WHERE s.status_id=v_item.status_id;
  IF v_status_key IN ('concluido','completed','sent','enviado') THEN RAISE EXCEPTION 'queue_item_already_sent'; END IF;

  SELECT s.status_id INTO v_invalid_status FROM public.status s
  WHERE regexp_replace(lower(public.unaccent(trim(s.status_name))), '[^a-z0-9]+', '', 'g') IN ('invalido','invalid')
  ORDER BY s.status_id LIMIT 1;
  SELECT ls.lead_status_id INTO v_invalid_lead_status FROM public.lead_status ls
  WHERE regexp_replace(lower(public.unaccent(trim(ls.lead_status_name))), '[^a-z0-9]+', '', 'g') IN ('invalido','invalid')
  ORDER BY ls.lead_status_id LIMIT 1;
  IF v_invalid_status IS NULL OR v_invalid_lead_status IS NULL THEN RAISE EXCEPTION 'invalid_status_catalog_missing'; END IF;

  UPDATE public.queue_items
  SET status_id=v_invalid_status,
      queue_items_error_message=nullif(trim(coalesce(p_reason,'')),''),
      queue_items_finished_at=now(),
      queue_items_updated_at=now()
  WHERE queue_items_id=p_queue_item_id AND users_id=v_user;

  UPDATE public.leads
  SET lead_status_id=v_invalid_lead_status,leads_updated_at=now()
  WHERE leads_id=v_item.leads_id AND users_id=v_user AND organizations_id=v_org;

  UPDATE public.instagram_queue_progress
  SET step='invalid',canonical_step='invalid',finished_at=now(),error_message=nullif(trim(coalesce(p_reason,'')),''),instagram_queue_progress_updated_at=now()
  WHERE queue_items_id=p_queue_item_id AND organizations_id=v_org;

  RETURN jsonb_build_object('queueItemId',p_queue_item_id,'leadId',v_item.leads_id,'invalidated',true);
END
$$;
REVOKE ALL ON FUNCTION public.invalidate_final_queue_item(bigint,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.invalidate_final_queue_item(bigint,text) TO authenticated;

COMMIT;
