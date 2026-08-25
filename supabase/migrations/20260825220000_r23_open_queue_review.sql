-- CRM - Vinsansi Studio v2.4.0-R23
-- Revisão de fila antes do snapshot.
-- Importado -> revisão aberta -> trancar -> queue_items/snapshot.
-- A Base Permanente é somente consultada como bloqueio e nunca é alterada aqui.

BEGIN;

CREATE TABLE IF NOT EXISTS public.queue_review_batches (
  queue_review_batches_id bigserial PRIMARY KEY,
  organizations_id bigint NOT NULL REFERENCES public.organizations(organizations_id) ON DELETE CASCADE,
  users_id bigint NOT NULL REFERENCES public.users(users_id) ON DELETE CASCADE,
  channels_id bigint NOT NULL REFERENCES public.channels(channels_id),
  channel_key text NOT NULL CHECK (channel_key IN ('whatsapp','instagram')),
  resource_id bigint NOT NULL,
  scheduled_date date NOT NULL,
  target_count integer NOT NULL DEFAULT 0 CHECK (target_count >= 0),
  review_status text NOT NULL DEFAULT 'open' CHECK (review_status IN ('open','locked','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS queue_review_batches_one_open_resource
  ON public.queue_review_batches(organizations_id,channel_key,resource_id,scheduled_date)
  WHERE review_status='open';

CREATE TABLE IF NOT EXISTS public.queue_review_items (
  queue_review_items_id bigserial PRIMARY KEY,
  organizations_id bigint NOT NULL REFERENCES public.organizations(organizations_id) ON DELETE CASCADE,
  queue_review_batches_id bigint NOT NULL REFERENCES public.queue_review_batches(queue_review_batches_id) ON DELETE CASCADE,
  leads_id bigint NOT NULL REFERENCES public.leads(leads_id) ON DELETE CASCADE,
  review_position integer NOT NULL,
  review_status text NOT NULL DEFAULT 'open' CHECK (review_status IN ('open','invalidated','released','locked')),
  queue_items_id bigint REFERENCES public.queue_items(queue_items_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS queue_review_items_one_open_lead
  ON public.queue_review_items(organizations_id,leads_id)
  WHERE review_status='open';
CREATE UNIQUE INDEX IF NOT EXISTS queue_review_items_position_unique
  ON public.queue_review_items(queue_review_batches_id,review_position)
  WHERE review_status='open';
CREATE INDEX IF NOT EXISTS queue_review_items_batch_status_idx
  ON public.queue_review_items(queue_review_batches_id,review_status,review_position);

ALTER TABLE public.queue_review_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.queue_review_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.queue_review_batches,public.queue_review_items FROM anon,authenticated;
REVOKE ALL ON SEQUENCE public.queue_review_batches_queue_review_batches_id_seq,public.queue_review_items_queue_review_items_id_seq FROM anon,authenticated;

CREATE OR REPLACE FUNCTION public.queue_review_channel_id(p_channel text)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO pg_catalog,public
AS $$
  SELECT c.channels_id
  FROM public.channels c
  WHERE regexp_replace(lower(public.unaccent(trim(c.channels_name))), '[^a-z0-9]+', '', 'g') =
        CASE WHEN lower(trim(coalesce(p_channel,'')))='instagram' THEN 'instagram' ELSE 'whatsapp' END
  ORDER BY c.channels_id
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.queue_review_channel_id(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.queue_review_channel_id(text) TO service_role;

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
  v_capacity_status_ids bigint[];
  v_limit integer;
  v_used integer:=0;
BEGIN
  IF v_channel NOT IN ('whatsapp','instagram') THEN RAISE EXCEPTION 'queue_review_invalid_channel'; END IF;
  v_channel_id:=public.queue_review_channel_id(v_channel);
  SELECT s.status_id INTO v_active FROM public.status s
  WHERE regexp_replace(lower(public.unaccent(trim(s.status_name))), '[^a-z0-9]+', '', 'g') IN ('ativo','active')
  ORDER BY s.status_id LIMIT 1;
  SELECT array_agg(s.status_id ORDER BY s.status_id) INTO v_capacity_status_ids
  FROM public.status s
  WHERE regexp_replace(lower(public.unaccent(trim(s.status_name))), '[^a-z0-9]+', '', 'g') IN
    ('pendente','pending','queued','processando','processing','sending','concluido','completed','sent','pausado','paused');

  IF v_channel='whatsapp' THEN
    SELECT l.levels_daily_limit INTO v_limit
    FROM public.chips c
    JOIN public.instances i ON i.instances_id=c.instances_id AND i.users_id=c.users_id
    JOIN public.levels l ON l.levels_id=c.levels_id AND l.users_id=c.users_id
    WHERE c.chips_id=p_resource_id AND c.users_id=v_user AND c.status_id=v_active
      AND i.status_id=v_active AND l.status_id=v_active AND l.channels_id=v_channel_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'queue_review_resource_not_operational'; END IF;
    SELECT count(*)::integer INTO v_used
    FROM public.queue_items qi JOIN public.queues q ON q.queues_id=qi.queues_id AND q.users_id=qi.users_id
    WHERE qi.users_id=v_user AND q.channels_id=v_channel_id AND qi.chips_id=p_resource_id
      AND qi.status_id=ANY(v_capacity_status_ids)
      AND (coalesce(qi.queue_items_scheduled_at,q.queues_scheduled_at) AT TIME ZONE 'UTC')::date=p_scheduled_date;
  ELSE
    SELECT l.levels_daily_limit INTO v_limit
    FROM public.socials so
    JOIN public.levels l ON l.levels_id=so.levels_id AND l.users_id=so.users_id
    WHERE so.socials_id=p_resource_id AND so.users_id=v_user AND so.status_id=v_active
      AND l.status_id=v_active AND l.channels_id=v_channel_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'queue_review_resource_not_operational'; END IF;
    SELECT count(*)::integer INTO v_used
    FROM public.queue_items qi JOIN public.queues q ON q.queues_id=qi.queues_id AND q.users_id=qi.users_id
    WHERE qi.users_id=v_user AND q.channels_id=v_channel_id AND qi.socials_id=p_resource_id
      AND qi.status_id=ANY(v_capacity_status_ids)
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
BEGIN
  PERFORM public.require_organization_permission('queues.prepare');
  IF v_channel NOT IN ('whatsapp','instagram') THEN RAISE EXCEPTION 'queue_review_invalid_channel'; END IF;
  IF p_resource_id IS NULL OR p_resource_id<=0 THEN RAISE EXCEPTION 'queue_review_resource_required'; END IF;
  v_channel_id:=public.queue_review_channel_id(v_channel);
  IF v_channel_id IS NULL THEN RAISE EXCEPTION 'queue_review_channel_not_found'; END IF;
  SELECT * INTO v_capacity FROM public.queue_review_resource_capacity(v_channel,p_resource_id,coalesce(p_scheduled_date,current_date));

  PERFORM pg_advisory_xact_lock(hashtextextended(format('queue-review:%s:%s:%s:%s',v_org,v_channel,p_resource_id,p_scheduled_date),0));
  SELECT b.queue_review_batches_id INTO v_batch
  FROM public.queue_review_batches b
  WHERE b.organizations_id=v_org AND b.channel_key=v_channel AND b.resource_id=p_resource_id
    AND b.scheduled_date=coalesce(p_scheduled_date,current_date) AND b.review_status='open'
  FOR UPDATE;

  IF v_batch IS NULL THEN
    INSERT INTO public.queue_review_batches(organizations_id,users_id,channels_id,channel_key,resource_id,scheduled_date,target_count)
    VALUES(v_org,v_user,v_channel_id,v_channel,p_resource_id,coalesce(p_scheduled_date,current_date),v_capacity.available)
    RETURNING queue_review_batches_id INTO v_batch;
  ELSE
    UPDATE public.queue_review_batches
    SET target_count=v_capacity.available,updated_at=now()
    WHERE queue_review_batches_id=v_batch;
  END IF;

  SELECT count(*)::integer INTO v_open FROM public.queue_review_items i
  WHERE i.queue_review_batches_id=v_batch AND i.review_status='open';

  RETURN jsonb_build_object(
    'batchId',v_batch,'channel',v_channel,'resourceId',p_resource_id,'scheduledDate',coalesce(p_scheduled_date,current_date),
    'dailyLimit',v_capacity.daily_limit,'used',v_capacity.used,'targetCount',v_capacity.available,'openCount',v_open,
    'missingCount',greatest(0,v_capacity.available-v_open)
  );
END
$$;
REVOKE ALL ON FUNCTION public.open_queue_review_batch(text,bigint,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.open_queue_review_batch(text,bigint,date) TO authenticated;

CREATE OR REPLACE FUNCTION public.queue_review_candidate_ids(p_batch_id bigint,p_limit integer DEFAULT 100)
RETURNS TABLE(lead_id bigint)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path TO pg_catalog,public
AS $$
DECLARE
  v_org bigint:=public.current_organization_id();
  v_user bigint:=public.ensure_current_user();
  v_channel text;
BEGIN
  PERFORM public.require_organization_permission('queues.prepare');
  SELECT b.channel_key INTO v_channel FROM public.queue_review_batches b
  WHERE b.queue_review_batches_id=p_batch_id AND b.organizations_id=v_org AND b.users_id=v_user AND b.review_status='open';
  IF v_channel IS NULL THEN RAISE EXCEPTION 'queue_review_batch_not_open'; END IF;

  RETURN QUERY
  SELECT l.leads_id
  FROM public.leads l
  WHERE l.organizations_id=v_org AND l.users_id=v_user AND l.lead_status_id=1
    AND NOT EXISTS(
      SELECT 1 FROM public.queue_review_items ri
      WHERE ri.organizations_id=v_org AND ri.leads_id=l.leads_id
        AND (ri.review_status='open' OR ri.queue_review_batches_id=p_batch_id)
    )
    AND NOT EXISTS(
      SELECT 1 FROM public.permanent_records pr
      WHERE pr.organizations_id=v_org AND pr.canonical_lead_id=coalesce(l.canonical_lead_id,l.leads_id)
    )
    AND CASE WHEN v_channel='whatsapp'
      THEN length(regexp_replace(coalesce(nullif(trim(l.leads_whatsapp),''),l.leads_phone,''),'[^0-9]+','','g'))>=10
      ELSE length(trim(coalesce(l.leads_instagram,'')))>0
    END
  ORDER BY coalesce(l.leads_score,0) DESC,coalesce(l.leads_reviews_count,0) DESC,l.leads_id ASC
  LIMIT greatest(0,least(coalesce(p_limit,100),500));
END
$$;
REVOKE ALL ON FUNCTION public.queue_review_candidate_ids(bigint,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.queue_review_candidate_ids(bigint,integer) TO authenticated;

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
  v_id bigint;
  v_open integer;
  v_pos integer;
BEGIN
  PERFORM public.require_organization_permission('queues.prepare');
  SELECT * INTO v_batch FROM public.queue_review_batches b
  WHERE b.queue_review_batches_id=p_batch_id AND b.organizations_id=v_org AND b.users_id=v_user AND b.review_status='open'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'queue_review_batch_not_open'; END IF;

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

CREATE OR REPLACE FUNCTION public.release_queue_review_items(p_batch_id bigint,p_lead_ids bigint[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog,public
AS $$
DECLARE v_org bigint:=public.current_organization_id();v_user bigint:=public.ensure_current_user();v_count integer;
BEGIN
  PERFORM public.require_organization_permission('queues.prepare');
  IF NOT EXISTS(
    SELECT 1 FROM public.queue_review_batches b
    WHERE b.queue_review_batches_id=p_batch_id AND b.organizations_id=v_org AND b.users_id=v_user AND b.review_status='open'
  ) THEN RAISE EXCEPTION 'queue_review_batch_not_open'; END IF;

  UPDATE public.leads l SET lead_status_id=1,channels_id=NULL,leads_updated_at=now()
  WHERE l.organizations_id=v_org AND l.users_id=v_user AND l.lead_status_id=3
    AND l.leads_id=ANY(coalesce(p_lead_ids,'{}'::bigint[]))
    AND EXISTS(
      SELECT 1 FROM public.queue_review_items i
      WHERE i.queue_review_batches_id=p_batch_id AND i.leads_id=l.leads_id AND i.review_status='open'
    );

  UPDATE public.queue_review_items i SET review_status='released',updated_at=now()
  WHERE i.queue_review_batches_id=p_batch_id AND i.organizations_id=v_org AND i.review_status='open'
    AND i.leads_id=ANY(coalesce(p_lead_ids,'{}'::bigint[]));
  GET DIAGNOSTICS v_count=ROW_COUNT;
  RETURN v_count;
END
$$;
REVOKE ALL ON FUNCTION public.release_queue_review_items(bigint,bigint[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.release_queue_review_items(bigint,bigint[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.restore_queue_review_whatsapp_valid(p_batch_id bigint,p_lead_ids bigint[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog,public
AS $$
DECLARE v_org bigint:=public.current_organization_id();v_user bigint:=public.ensure_current_user();v_channel bigint;v_count integer;
BEGIN
  PERFORM public.require_organization_permission('queues.prepare');
  SELECT b.channels_id INTO v_channel FROM public.queue_review_batches b
  WHERE b.queue_review_batches_id=p_batch_id AND b.organizations_id=v_org AND b.users_id=v_user AND b.channel_key='whatsapp' AND b.review_status='open';
  IF v_channel IS NULL THEN RAISE EXCEPTION 'queue_review_batch_not_open'; END IF;
  UPDATE public.leads l SET lead_status_id=3,channels_id=v_channel,leads_updated_at=now()
  WHERE l.organizations_id=v_org AND l.users_id=v_user AND l.lead_status_id=2 AND l.leads_id=ANY(coalesce(p_lead_ids,'{}'::bigint[]))
    AND EXISTS(SELECT 1 FROM public.queue_review_items i WHERE i.queue_review_batches_id=p_batch_id AND i.leads_id=l.leads_id AND i.review_status='open');
  GET DIAGNOSTICS v_count=ROW_COUNT;RETURN v_count;
END
$$;
REVOKE ALL ON FUNCTION public.restore_queue_review_whatsapp_valid(bigint,bigint[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.restore_queue_review_whatsapp_valid(bigint,bigint[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.prune_queue_review_items(p_batch_id bigint)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog,public
AS $$
DECLARE v_org bigint:=public.current_organization_id();v_user bigint:=public.ensure_current_user();v_count integer;
BEGIN
  PERFORM public.require_organization_permission('queues.prepare');
  UPDATE public.queue_review_items i SET review_status='released',updated_at=now()
  FROM public.leads l,public.queue_review_batches b
  WHERE i.queue_review_batches_id=p_batch_id AND i.review_status='open' AND l.leads_id=i.leads_id
    AND b.queue_review_batches_id=i.queue_review_batches_id AND b.organizations_id=v_org AND b.users_id=v_user
    AND (l.lead_status_id<>3 OR l.channels_id IS DISTINCT FROM b.channels_id);
  GET DIAGNOSTICS v_count=ROW_COUNT;

  -- Lead que voltou a Importado continua sem destino operacional no R23.
  UPDATE public.leads l SET channels_id=NULL,leads_updated_at=now()
  WHERE l.organizations_id=v_org AND l.users_id=v_user AND l.lead_status_id=1
    AND EXISTS(
      SELECT 1 FROM public.queue_review_items i
      WHERE i.queue_review_batches_id=p_batch_id AND i.leads_id=l.leads_id AND i.review_status='released'
    );
  RETURN v_count;
END
$$;
REVOKE ALL ON FUNCTION public.prune_queue_review_items(bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.prune_queue_review_items(bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.invalidate_queue_review_item(p_review_item_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog,public
AS $$
DECLARE v_org bigint:=public.current_organization_id();v_user bigint:=public.ensure_current_user();v_item record;
BEGIN
  PERFORM public.require_organization_permission('leads.validate');
  SELECT i.queue_review_items_id,i.queue_review_batches_id,i.leads_id INTO v_item
  FROM public.queue_review_items i JOIN public.queue_review_batches b ON b.queue_review_batches_id=i.queue_review_batches_id
  WHERE i.queue_review_items_id=p_review_item_id AND i.organizations_id=v_org AND i.review_status='open'
    AND b.organizations_id=v_org AND b.users_id=v_user AND b.review_status='open'
  FOR UPDATE OF i;
  IF NOT FOUND THEN RAISE EXCEPTION 'queue_review_item_not_open'; END IF;
  UPDATE public.leads SET lead_status_id=6,leads_updated_at=now()
  WHERE leads_id=v_item.leads_id AND organizations_id=v_org AND users_id=v_user AND lead_status_id IN (1,2,3);
  UPDATE public.queue_review_items SET review_status='invalidated',updated_at=now() WHERE queue_review_items_id=p_review_item_id;
  UPDATE public.queue_review_batches SET updated_at=now() WHERE queue_review_batches_id=v_item.queue_review_batches_id;
  RETURN jsonb_build_object('batchId',v_item.queue_review_batches_id,'leadId',v_item.leads_id);
END
$$;
REVOKE ALL ON FUNCTION public.invalidate_queue_review_item(bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.invalidate_queue_review_item(bigint) TO authenticated;

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
  SELECT b.queue_review_batches_id,i.queue_review_items_id,b.channel_key,b.resource_id,b.scheduled_date,b.target_count,
    l.leads_id,i.review_position,l.leads_name,l.branches_id,coalesce(br.branches_name,''),coalesce(ci.cities_name,''),coalesce(st.states_code,st.states_name,''),
    coalesce(l.leads_phone,''),coalesce(l.leads_whatsapp,''),coalesce(l.leads_instagram,''),coalesce(l.leads_website,''),
    coalesce(l.leads_score,0)::numeric,coalesce(l.leads_reviews_count,0)::integer
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

CREATE OR REPLACE FUNCTION public.lock_queue_review_batch(p_batch_id bigint,p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog,public
AS $$
DECLARE
  v_org bigint:=public.current_organization_id();v_user bigint:=public.ensure_current_user();v_batch public.queue_review_batches%ROWTYPE;
  v_open integer;v_input integer;v_result record;v_done integer:=0;v_results jsonb:='[]'::jsonb;
BEGIN
  PERFORM public.require_organization_permission('queues.prepare');
  SELECT * INTO v_batch FROM public.queue_review_batches b
  WHERE b.queue_review_batches_id=p_batch_id AND b.organizations_id=v_org AND b.users_id=v_user AND b.review_status='open' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'queue_review_batch_not_open'; END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items)=0 THEN RAISE EXCEPTION 'queue_review_empty'; END IF;
  SELECT count(*)::integer INTO v_open FROM public.queue_review_items i WHERE i.queue_review_batches_id=p_batch_id AND i.review_status='open';
  v_input:=jsonb_array_length(p_items);
  IF v_open<>v_input THEN RAISE EXCEPTION 'queue_review_changed: expected %, got %',v_open,v_input; END IF;
  IF EXISTS(
    SELECT 1 FROM public.queue_review_items i
    WHERE i.queue_review_batches_id=p_batch_id AND i.review_status='open'
      AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) e WHERE (e->>'lead_id')~'^[0-9]+$' AND (e->>'lead_id')::bigint=i.leads_id)
  ) THEN RAISE EXCEPTION 'queue_review_items_mismatch'; END IF;

  UPDATE public.leads l SET lead_status_id=2,channels_id=v_batch.channels_id,leads_updated_at=now()
  WHERE l.organizations_id=v_org AND l.users_id=v_user AND l.lead_status_id=3
    AND EXISTS(SELECT 1 FROM public.queue_review_items i WHERE i.queue_review_batches_id=p_batch_id AND i.review_status='open' AND i.leads_id=l.leads_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'queue_review_no_leads_promoted'; END IF;

  FOR v_result IN SELECT * FROM public.prepare_queue_items(v_batch.channel_key,v_batch.resource_id,v_batch.scheduled_date,p_items) LOOP
    IF v_result.outcome NOT IN ('queued','reconciled') OR v_result.queue_item_id IS NULL THEN
      RAISE EXCEPTION 'queue_review_lock_failed:%:%',coalesce(v_result.lead_id,0),coalesce(v_result.reason,v_result.outcome);
    END IF;
    UPDATE public.queue_review_items SET review_status='locked',queue_items_id=v_result.queue_item_id,updated_at=now()
    WHERE queue_review_batches_id=p_batch_id AND leads_id=v_result.lead_id AND review_status='open';
    v_done:=v_done+1;
    v_results:=v_results||jsonb_build_array(jsonb_build_object('leadId',v_result.lead_id,'queueItemId',v_result.queue_item_id));
  END LOOP;
  IF v_done<>v_open THEN RAISE EXCEPTION 'queue_review_lock_incomplete:%/%',v_done,v_open; END IF;
  UPDATE public.queue_review_batches SET review_status='locked',locked_at=now(),updated_at=now() WHERE queue_review_batches_id=p_batch_id;
  RETURN jsonb_build_object('batchId',p_batch_id,'locked',v_done,'items',v_results);
END
$$;
REVOKE ALL ON FUNCTION public.lock_queue_review_batch(bigint,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.lock_queue_review_batch(bigint,jsonb) TO authenticated;

-- O core legado R15 ainda validava somente leads_phone. A operação atual usa
-- leads_whatsapp como destino preferencial e leads_phone como fallback.
DO $patch_core$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef('public.prepare_queue_items_rbac_inner(text,bigint,date,jsonb)'::regprocedure) INTO v_def;
  IF position('coalesce(v_lead.leads_phone, '''')' IN v_def)>0 THEN
    v_def:=replace(v_def,
      'coalesce(v_lead.leads_phone, '''')',
      'coalesce(nullif(v_lead.leads_whatsapp, ''''), v_lead.leads_phone, '''')');
    EXECUTE v_def;
  END IF;
END
$patch_core$;

COMMIT;
