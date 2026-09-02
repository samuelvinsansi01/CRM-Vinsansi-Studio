BEGIN;

-- CRM R59 BUILD FIX 20 (CUMULATIVO AO FIX 19)
-- 1) Paginação 10/20/50/100 realmente respeitada no backend.
-- 2) Filtro multi-ramos na puxada/preview.
-- 3) Lotes previstos de disparo expostos pela Fila final conforme levels_queues.
-- 4) Capacidade da puxada usa available já líquido de Fila final + Revisão.
-- 5) Downgrade de nível protegido por ocupação real de hoje + datas futuras.
--    Banco bloqueia chips/perfis e também redução direta de levels_daily_limit.

CREATE OR REPLACE FUNCTION public.list_queue_review_branches_r59()
RETURNS TABLE(branch_id bigint, branch_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE v_user bigint:=public.ensure_current_user(); v_active bigint;
BEGIN
  PERFORM public.require_organization_permission('queues.prepare');
  SELECT s.status_id INTO v_active FROM public.status s
  WHERE regexp_replace(lower(public.unaccent(trim(s.status_name))), '[^a-z0-9]+','','g') IN ('ativo','active')
  ORDER BY s.status_id LIMIT 1;
  RETURN QUERY
  SELECT b.branches_id,b.branches_name
  FROM public.branches b
  WHERE b.users_id=v_user AND (v_active IS NULL OR b.status_id=v_active)
  ORDER BY public.unaccent(b.branches_name),b.branches_id;
END;$function$;

DROP FUNCTION IF EXISTS public.pull_queue_review_to_capacity(text,text,date,text,text);
DROP FUNCTION IF EXISTS public.pull_queue_review_to_capacity(text,text,date,text,text,bigint[]);
CREATE FUNCTION public.pull_queue_review_to_capacity(
  p_channel text,
  p_resource_key text,
  p_scheduled_date date DEFAULT CURRENT_DATE,
  p_site_filter text DEFAULT 'any',
  p_instagram_filter text DEFAULT 'any',
  p_branch_ids bigint[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_org bigint:=public.current_organization_id();
  v_user bigint:=public.ensure_current_user();
  v_channel text:=lower(trim(coalesce(p_channel,'')));
  v_key text:=lower(trim(coalesce(p_resource_key,'')));
  v_date date:=coalesce(p_scheduled_date,current_date);
  v_site_filter text:=lower(trim(coalesce(p_site_filter,'any')));
  v_instagram_filter text:=lower(trim(coalesce(p_instagram_filter,'any')));
  v_branch_ids bigint[]:=coalesce(p_branch_ids,'{}'::bigint[]);
  v_local_today date;
  v_tz text:='America/Sao_Paulo';
  v_active bigint;
  v_channel_id bigint;
  v_sem_destino_id bigint;
  v_resource_id bigint;
  v_resource_label text;
  v_provider_key text;
  v_capacity record;
  v_batch bigint;
  v_review_open_before integer:=0;
  v_review_open_after integer:=0;
  v_pos integer:=0;
  v_wanted integer:=0;
  v_reserved jsonb:='[]'::jsonb;
  v_reserved_count integer:=0;
  v_review_item_id bigint;
  v_lead record;
  v_available_after integer:=0;
BEGIN
  PERFORM public.require_organization_permission('queues.prepare');

  IF v_channel NOT IN ('whatsapp','instagram') THEN RAISE EXCEPTION 'queue_review_invalid_channel'; END IF;
  IF v_key='' THEN RAISE EXCEPTION 'queue_review_resource_required'; END IF;
  IF v_site_filter NOT IN ('any','with','without') THEN RAISE EXCEPTION 'queue_review_invalid_site_filter'; END IF;
  IF v_instagram_filter NOT IN ('any','with','without') THEN RAISE EXCEPTION 'queue_review_invalid_instagram_filter'; END IF;

  SELECT coalesce(nullif(ots.settings->>'operationalTimezone',''),'America/Sao_Paulo')
  INTO v_tz
  FROM public.organization_tool_settings ots
  WHERE ots.organizations_id=v_org AND ots.tool_id='vinsansi_whatsapp_manager';
  v_tz:=coalesce(nullif(v_tz,''),'America/Sao_Paulo');
  v_local_today:=(now() AT TIME ZONE v_tz)::date;
  IF v_date<v_local_today OR v_date>v_local_today+366 THEN RAISE EXCEPTION 'queue_review_scheduled_date_invalid'; END IF;

  v_channel_id:=public.queue_review_channel_id(v_channel);
  SELECT c.channels_id INTO v_sem_destino_id
  FROM public.channels c
  WHERE regexp_replace(lower(public.unaccent(trim(c.channels_name))), '[^a-z0-9]+', '', 'g')='semdestino'
  ORDER BY c.channels_id LIMIT 1;
  IF v_channel_id IS NULL OR v_sem_destino_id IS NULL THEN RAISE EXCEPTION 'queue_review_channel_catalog_incomplete'; END IF;

  SELECT s.status_id INTO v_active
  FROM public.status s
  WHERE regexp_replace(lower(public.unaccent(trim(s.status_name))), '[^a-z0-9]+', '', 'g') IN ('ativo','active')
  ORDER BY s.status_id LIMIT 1;

  IF v_channel='whatsapp' THEN
    SELECT c.chips_id,
           coalesce(nullif(btrim(c.chips_name),''),i.instances_name,c.chips_id::text),
           coalesce(i.instances_name,'')
    INTO v_resource_id,v_resource_label,v_provider_key
    FROM public.chips c
    JOIN public.instances i ON i.instances_id=c.instances_id AND i.users_id=c.users_id
    JOIN public.levels l ON l.levels_id=c.levels_id AND l.users_id=c.users_id
    JOIN public.instance_runtime_states rs ON rs.instances_id=i.instances_id AND rs.users_id=i.users_id
    WHERE c.users_id=v_user
      AND c.status_id=v_active AND i.status_id=v_active AND l.status_id=v_active
      AND l.channels_id=v_channel_id
      AND rs.operational_state='online' AND rs.session_saved IS TRUE AND rs.socket_connected IS TRUE
      AND (c.chips_id::text=v_key OR lower(btrim(coalesce(c.chips_name,'')))=v_key OR lower(btrim(coalesce(i.instances_name,'')))=v_key)
    ORDER BY c.chips_id LIMIT 1;
  ELSE
    SELECT so.socials_id,
           coalesce(nullif(btrim(so.socials_name),''),concat('@',regexp_replace(coalesce(so.socials_username,''),'^@','','g')),so.socials_id::text),
           regexp_replace(coalesce(so.socials_username,''),'^@','','g')
    INTO v_resource_id,v_resource_label,v_provider_key
    FROM public.socials so
    JOIN public.levels l ON l.levels_id=so.levels_id AND l.users_id=so.users_id
    WHERE so.users_id=v_user AND so.status_id=v_active AND l.status_id=v_active AND l.channels_id=v_channel_id
      AND length(btrim(coalesce(so.socials_username,'')))>0
      AND (so.socials_id::text=v_key OR lower(btrim(coalesce(so.socials_name,'')))=v_key
        OR lower(regexp_replace(btrim(coalesce(so.socials_username,'')),'^@','','g'))=regexp_replace(v_key,'^@','','g'))
    ORDER BY so.socials_id LIMIT 1;
  END IF;

  IF v_resource_id IS NULL THEN RAISE EXCEPTION 'queue_review_resource_not_operational'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(format('queue-review:%s:%s:%s:%s',v_org,v_channel,v_resource_id,v_date),0));
  SELECT * INTO v_capacity FROM public.queue_review_resource_capacity(v_channel,v_resource_id,v_date);

  SELECT b.queue_review_batches_id INTO v_batch
  FROM public.queue_review_batches b
  WHERE b.organizations_id=v_org AND b.users_id=v_user AND b.channel_key=v_channel
    AND b.resource_id=v_resource_id AND b.scheduled_date=v_date AND b.review_status='open'
  FOR UPDATE;

  IF v_batch IS NULL THEN
    INSERT INTO public.queue_review_batches(organizations_id,users_id,channels_id,channel_key,resource_id,scheduled_date,target_count)
    VALUES(v_org,v_user,v_channel_id,v_channel,v_resource_id,v_date,greatest(0,coalesce(v_capacity.available,0)))
    RETURNING queue_review_batches_id INTO v_batch;
  ELSE
    UPDATE public.queue_review_batches
    SET target_count=greatest(0,coalesce(v_capacity.available,0)),updated_at=now()
    WHERE queue_review_batches_id=v_batch;
  END IF;

  SELECT count(*)::integer INTO v_review_open_before
  FROM public.queue_review_items i
  WHERE i.queue_review_batches_id=v_batch AND i.review_status='open';

  SELECT coalesce(max(i.review_position),0) INTO v_pos
  FROM public.queue_review_items i
  WHERE i.queue_review_batches_id=v_batch;

  v_wanted:=greatest(0,coalesce(v_capacity.available,0));

  IF v_wanted>0 AND v_channel='whatsapp' THEN
    FOR v_lead IN
      SELECT l.leads_id,l.leads_name,
             public.effective_whatsapp_phone(l.leads_whatsapp,l.leads_phone) AS effective_phone,
             regexp_replace(public.effective_whatsapp_phone(l.leads_whatsapp,l.leads_phone),'[^0-9]+','','g') AS normalized_phone,
             coalesce(l.leads_instagram,'') AS instagram
      FROM public.leads l
      WHERE l.organizations_id=v_org AND l.users_id=v_user
        AND l.lead_status_id=1
        AND l.channels_id IN (v_channel_id,v_sem_destino_id)
        AND (coalesce(array_length(v_branch_ids,1),0)=0 OR l.branches_id=ANY(v_branch_ids))
        AND length(regexp_replace(public.effective_whatsapp_phone(l.leads_whatsapp,l.leads_phone),'[^0-9]+','','g'))>=10
        AND (v_site_filter='any'
          OR (v_site_filter='with' AND length(btrim(coalesce(l.leads_website,'')))>0)
          OR (v_site_filter='without' AND length(btrim(coalesce(l.leads_website,'')))=0))
        AND (v_instagram_filter='any'
          OR (v_instagram_filter='with' AND length(btrim(coalesce(l.leads_instagram,'')))>0)
          OR (v_instagram_filter='without' AND length(btrim(coalesce(l.leads_instagram,'')))=0))
        AND NOT EXISTS(SELECT 1 FROM public.queue_review_items ri WHERE ri.organizations_id=v_org AND ri.leads_id=l.leads_id AND ri.review_status='open')
        AND NOT EXISTS(SELECT 1 FROM public.queue_review_items ri WHERE ri.queue_review_batches_id=v_batch AND ri.leads_id=l.leads_id AND ri.review_status IN ('invalidated','locked'))
      ORDER BY coalesce(l.leads_score,0) DESC,coalesce(l.leads_reviews_count,0) DESC,l.leads_id ASC
      LIMIT v_wanted
      FOR UPDATE OF l SKIP LOCKED
    LOOP
      v_pos:=v_pos+1;
      INSERT INTO public.queue_review_items(organizations_id,queue_review_batches_id,leads_id,review_position)
      VALUES(v_org,v_batch,v_lead.leads_id,v_pos)
      RETURNING queue_review_items_id INTO v_review_item_id;

      UPDATE public.leads
      SET lead_status_id=2,channels_id=v_channel_id,leads_updated_at=now()
      WHERE leads_id=v_lead.leads_id AND organizations_id=v_org AND users_id=v_user
        AND lead_status_id=1 AND channels_id IN (v_channel_id,v_sem_destino_id);
      IF NOT FOUND THEN RAISE EXCEPTION 'queue_review_lead_changed'; END IF;

      v_reserved:=v_reserved || jsonb_build_array(jsonb_build_object(
        'leadId',v_lead.leads_id,'reviewItemId',v_review_item_id,'company',v_lead.leads_name,
        'phone',coalesce(v_lead.effective_phone,''),'normalizedPhone',coalesce(v_lead.normalized_phone,''),'instagram',coalesce(v_lead.instagram,'')));
    END LOOP;
  ELSIF v_wanted>0 AND v_channel='instagram' THEN
    FOR v_lead IN
      SELECT l.leads_id,l.leads_name,coalesce(l.leads_instagram,'') AS instagram
      FROM public.leads l
      WHERE l.organizations_id=v_org AND l.users_id=v_user
        AND l.lead_status_id=1
        AND l.channels_id IN (v_channel_id,v_sem_destino_id)
        AND (coalesce(array_length(v_branch_ids,1),0)=0 OR l.branches_id=ANY(v_branch_ids))
        AND length(btrim(coalesce(l.leads_instagram,'')))>0
        AND (v_site_filter='any'
          OR (v_site_filter='with' AND length(btrim(coalesce(l.leads_website,'')))>0)
          OR (v_site_filter='without' AND length(btrim(coalesce(l.leads_website,'')))=0))
        AND NOT EXISTS(SELECT 1 FROM public.queue_review_items ri WHERE ri.organizations_id=v_org AND ri.leads_id=l.leads_id AND ri.review_status='open')
        AND NOT EXISTS(SELECT 1 FROM public.queue_review_items ri WHERE ri.queue_review_batches_id=v_batch AND ri.leads_id=l.leads_id AND ri.review_status IN ('invalidated','locked'))
      ORDER BY coalesce(l.leads_score,0) DESC,coalesce(l.leads_reviews_count,0) DESC,l.leads_id ASC
      LIMIT v_wanted
      FOR UPDATE OF l SKIP LOCKED
    LOOP
      v_pos:=v_pos+1;
      INSERT INTO public.queue_review_items(organizations_id,queue_review_batches_id,leads_id,review_position)
      VALUES(v_org,v_batch,v_lead.leads_id,v_pos)
      RETURNING queue_review_items_id INTO v_review_item_id;

      UPDATE public.leads
      SET lead_status_id=2,channels_id=v_channel_id,leads_updated_at=now()
      WHERE leads_id=v_lead.leads_id AND organizations_id=v_org AND users_id=v_user
        AND lead_status_id=1 AND channels_id IN (v_channel_id,v_sem_destino_id);
      IF NOT FOUND THEN RAISE EXCEPTION 'queue_review_lead_changed'; END IF;

      v_reserved:=v_reserved || jsonb_build_array(jsonb_build_object(
        'leadId',v_lead.leads_id,'reviewItemId',v_review_item_id,'company',v_lead.leads_name,
        'phone','','normalizedPhone','','instagram',coalesce(v_lead.instagram,'')));
    END LOOP;
  END IF;

  v_reserved_count:=jsonb_array_length(v_reserved);
  v_review_open_after:=v_review_open_before+v_reserved_count;
  v_available_after:=greatest(0,coalesce(v_capacity.available,0)-v_reserved_count);

  UPDATE public.queue_review_batches
  SET target_count=greatest(0,coalesce(v_capacity.available,0)),updated_at=now()
  WHERE queue_review_batches_id=v_batch;

  RETURN jsonb_build_object(
    'contractVersion','R59','batchId',v_batch,'resourceId',v_resource_id,'resourceLabel',v_resource_label,
    'providerKey',v_provider_key,'selectionKey',CASE WHEN v_channel='whatsapp' THEN v_resource_label ELSE v_provider_key END,'scheduledDate',v_date,'dailyLimit',greatest(0,coalesce(v_capacity.daily_limit,0)),
    'available',v_available_after,'capacityToFill',v_wanted,'siteFilter',v_site_filter,
    'branchIds',to_jsonb(v_branch_ids),
    'instagramFilter',CASE WHEN v_channel='instagram' THEN 'with' ELSE v_instagram_filter END,'reserved',v_reserved
  );
END;
$function$;

DROP FUNCTION IF EXISTS public.preview_queue_review_pull(text,text,date,text,text);
DROP FUNCTION IF EXISTS public.preview_queue_review_pull(text,text,date,text,text,bigint[]);
CREATE OR REPLACE FUNCTION public.preview_queue_review_pull(
  p_channel text,
  p_resource_key text,
  p_scheduled_date date DEFAULT CURRENT_DATE,
  p_site_filter text DEFAULT 'any',
  p_instagram_filter text DEFAULT 'any',
  p_branch_ids bigint[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_org bigint:=public.current_organization_id();
  v_user bigint:=public.ensure_current_user();
  v_channel text:=lower(trim(coalesce(p_channel,'')));
  v_key text:=trim(coalesce(p_resource_key,''));
  v_date date:=coalesce(p_scheduled_date,current_date);
  v_site_filter text:=lower(trim(coalesce(p_site_filter,'any')));
  v_instagram_filter text:=lower(trim(coalesce(p_instagram_filter,'any')));
  v_branch_ids bigint[]:=coalesce(p_branch_ids,'{}'::bigint[]);
  v_channel_id bigint;
  v_sem_destino_id bigint;
  v_resource record;
  v_batch bigint;
  v_eligible integer:=0;
  v_will_pull integer:=0;
BEGIN
  PERFORM public.require_organization_permission('queues.prepare');
  IF v_channel NOT IN ('whatsapp','instagram') THEN RAISE EXCEPTION 'queue_review_invalid_channel'; END IF;
  IF v_key='' THEN RAISE EXCEPTION 'queue_review_resource_required'; END IF;
  IF v_site_filter NOT IN ('any','with','without') THEN RAISE EXCEPTION 'queue_review_invalid_site_filter'; END IF;
  IF v_instagram_filter NOT IN ('any','with','without') THEN RAISE EXCEPTION 'queue_review_invalid_instagram_filter'; END IF;

  SELECT * INTO v_resource
  FROM public.list_queue_review_resources(v_channel,v_date) r
  WHERE r.resource_id::text=v_key
  LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'queue_review_resource_not_operational'; END IF;

  v_channel_id:=public.queue_review_channel_id(v_channel);
  SELECT c.channels_id INTO v_sem_destino_id
  FROM public.channels c
  WHERE regexp_replace(lower(public.unaccent(trim(c.channels_name))), '[^a-z0-9]+', '', 'g')='semdestino'
  ORDER BY c.channels_id LIMIT 1;
  IF v_channel_id IS NULL OR v_sem_destino_id IS NULL THEN RAISE EXCEPTION 'queue_review_channel_catalog_incomplete'; END IF;

  SELECT b.queue_review_batches_id INTO v_batch
  FROM public.queue_review_batches b
  WHERE b.organizations_id=v_org AND b.users_id=v_user AND b.channel_key=v_channel
    AND b.resource_id=v_resource.resource_id AND b.scheduled_date=v_date AND b.review_status='open'
  ORDER BY b.queue_review_batches_id DESC LIMIT 1;

  IF v_channel='whatsapp' THEN
    SELECT count(*)::integer INTO v_eligible
    FROM public.leads l
    WHERE l.organizations_id=v_org AND l.users_id=v_user
      AND l.lead_status_id=1
      AND l.channels_id IN (v_channel_id,v_sem_destino_id)
      AND (coalesce(array_length(v_branch_ids,1),0)=0 OR l.branches_id=ANY(v_branch_ids))
      AND length(regexp_replace(public.effective_whatsapp_phone(l.leads_whatsapp,l.leads_phone),'[^0-9]+','','g'))>=10
      AND (v_site_filter='any'
        OR (v_site_filter='with' AND length(btrim(coalesce(l.leads_website,'')))>0)
        OR (v_site_filter='without' AND length(btrim(coalesce(l.leads_website,'')))=0))
      AND (v_instagram_filter='any'
        OR (v_instagram_filter='with' AND length(btrim(coalesce(l.leads_instagram,'')))>0)
        OR (v_instagram_filter='without' AND length(btrim(coalesce(l.leads_instagram,'')))=0))
      AND NOT EXISTS(SELECT 1 FROM public.queue_review_items ri WHERE ri.organizations_id=v_org AND ri.leads_id=l.leads_id AND ri.review_status='open')
      AND NOT EXISTS(SELECT 1 FROM public.queue_review_items ri WHERE ri.queue_review_batches_id=v_batch AND ri.leads_id=l.leads_id AND ri.review_status IN ('invalidated','locked'));
  ELSE
    SELECT count(*)::integer INTO v_eligible
    FROM public.leads l
    WHERE l.organizations_id=v_org AND l.users_id=v_user
      AND l.lead_status_id=1
      AND l.channels_id IN (v_channel_id,v_sem_destino_id)
      AND (coalesce(array_length(v_branch_ids,1),0)=0 OR l.branches_id=ANY(v_branch_ids))
      AND length(btrim(coalesce(l.leads_instagram,'')))>0
      AND (v_site_filter='any'
        OR (v_site_filter='with' AND length(btrim(coalesce(l.leads_website,'')))>0)
        OR (v_site_filter='without' AND length(btrim(coalesce(l.leads_website,'')))=0))
      AND NOT EXISTS(SELECT 1 FROM public.queue_review_items ri WHERE ri.organizations_id=v_org AND ri.leads_id=l.leads_id AND ri.review_status='open')
      AND NOT EXISTS(SELECT 1 FROM public.queue_review_items ri WHERE ri.queue_review_batches_id=v_batch AND ri.leads_id=l.leads_id AND ri.review_status IN ('invalidated','locked'));
  END IF;

  v_will_pull:=least(greatest(0,coalesce(v_resource.available,0)),greatest(0,v_eligible));

  RETURN jsonb_build_object(
    'contractVersion','R59',
    'scheduledDate',v_date,
    'resourceId',v_resource.resource_id,
    'resourceLabel',v_resource.resource_label,
    'dailyLimit',v_resource.daily_limit,
    'finalUsed',v_resource.final_used,
    'reviewOpen',v_resource.review_open,
    'used',v_resource.used,
    'available',v_resource.available,
    'eligible',v_eligible,
    'willPull',v_will_pull,
    'siteFilter',v_site_filter,
    'branchIds',to_jsonb(v_branch_ids),
    'instagramFilter',CASE WHEN v_channel='instagram' THEN 'with' ELSE v_instagram_filter END
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_imported_leads_page_r59(
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 20,
  p_search text DEFAULT NULL,
  p_branch_id bigint DEFAULT NULL,
  p_state text DEFAULT NULL,
  p_site_filter text DEFAULT 'Todos',
  p_instagram_filter text DEFAULT 'Todos'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_org bigint := public.current_organization_id();
  v_user bigint := public.ensure_current_user();
  v_page integer := greatest(1, coalesce(p_page, 1));
  v_page_size integer := CASE WHEN p_page_size IN (10,20,50,100) THEN p_page_size ELSE 20 END;
  v_offset integer;
  v_search text := nullif(btrim(coalesce(p_search,'')), '');
  v_state text := nullif(btrim(coalesce(p_state,'')), '');
  v_site text := lower(btrim(coalesce(p_site_filter,'Todos')));
  v_instagram text := lower(btrim(coalesce(p_instagram_filter,'Todos')));
  v_whatsapp bigint;
  v_instagram_channel bigint;
  v_no_destination bigint;
  v_total integer := 0;
  v_items jsonb := '[]'::jsonb;
  v_summary jsonb := '{}'::jsonb;
BEGIN
  PERFORM public.require_organization_permission('leads.view');
  IF v_org IS NULL OR v_user IS NULL THEN RAISE EXCEPTION 'organization_context_required'; END IF;
  v_offset := (v_page - 1) * v_page_size;
  v_whatsapp := public.queue_review_channel_id('whatsapp');
  v_instagram_channel := public.queue_review_channel_id('instagram');
  SELECT c.channels_id INTO v_no_destination
  FROM public.channels c
  WHERE regexp_replace(lower(public.unaccent(trim(c.channels_name))), '[^a-z0-9]+', '', 'g') = 'semdestino'
  ORDER BY c.channels_id LIMIT 1;

  SELECT jsonb_build_object(
    'total', count(*)::integer,
    'noDestination', count(*) FILTER (WHERE l.channels_id = v_no_destination)::integer,
    'whatsapp', count(*) FILTER (WHERE l.channels_id = v_whatsapp)::integer,
    'instagram', count(*) FILTER (WHERE l.channels_id = v_instagram_channel)::integer
  )
  INTO v_summary
  FROM public.leads l
  WHERE l.organizations_id = v_org AND l.users_id = v_user AND l.lead_status_id = 1;

  WITH filtered AS (
    SELECT
      l.leads_id, l.branches_id, l.channels_id, l.contact_sources_id, l.lead_status_id,
      l.leads_name, l.leads_alternative_name, l.leads_phone, l.leads_whatsapp, l.leads_instagram,
      l.leads_website, l.leads_maps, l.leads_created_at, l.leads_updated_at, l.leads_score, l.leads_reviews_count,
      coalesce(br.branches_name,'') AS branch_name,
      coalesce(st.states_code,st.states_name,'') AS state_name,
      coalesce(ci.cities_name,'') AS city_name,
      coalesce(cs.contact_sources_name,'') AS contact_source_name,
      coalesce(ls.lead_status_name,'Importado') AS lead_status_name,
      CASE WHEN l.channels_id = v_instagram_channel THEN 'Instagram'
           WHEN l.channels_id = v_no_destination THEN 'Sem destino'
           WHEN l.channels_id = v_whatsapp THEN 'WhatsApp'
           ELSE '' END AS channel_name
    FROM public.leads l
    LEFT JOIN public.branches br ON br.branches_id=l.branches_id AND br.users_id=l.users_id
    LEFT JOIN public.states st ON st.states_id=l.states_id
    LEFT JOIN public.cities ci ON ci.cities_id=l.cities_id
    LEFT JOIN public.contact_sources cs ON cs.contact_sources_id=l.contact_sources_id
    LEFT JOIN public.lead_status ls ON ls.lead_status_id=l.lead_status_id
    WHERE l.organizations_id=v_org AND l.users_id=v_user AND l.lead_status_id=1
      AND (p_branch_id IS NULL OR l.branches_id=p_branch_id)
      AND (v_state IS NULL OR upper(coalesce(st.states_code,''))=upper(v_state) OR lower(public.unaccent(coalesce(st.states_name,'')))=lower(public.unaccent(v_state)))
      AND (v_site NOT IN ('com site','sem site') OR (v_site='com site' AND length(btrim(coalesce(l.leads_website,'')))>0) OR (v_site='sem site' AND length(btrim(coalesce(l.leads_website,'')))=0))
      AND (v_instagram NOT IN ('com instagram','sem instagram') OR (v_instagram='com instagram' AND length(btrim(coalesce(l.leads_instagram,'')))>0) OR (v_instagram='sem instagram' AND length(btrim(coalesce(l.leads_instagram,'')))=0))
      AND (v_search IS NULL OR lower(public.unaccent(concat_ws(' ',l.leads_name,l.leads_phone,l.leads_whatsapp,l.leads_instagram))) LIKE '%'||lower(public.unaccent(v_search))||'%')
  ), counted AS (
    SELECT count(*)::integer AS total FROM filtered
  ), page_rows AS (
    SELECT * FROM filtered
    ORDER BY coalesce(leads_score,0) DESC, coalesce(leads_reviews_count,0) DESC, leads_id ASC
    LIMIT v_page_size OFFSET v_offset
  )
  SELECT c.total,
         coalesce(jsonb_agg(jsonb_build_object(
           'id',p.leads_id,'company',p.leads_name,'alternative_name',coalesce(p.leads_alternative_name,''),
           'branch_id',p.branches_id,'branch',p.branch_name,'state',p.state_name,'city',p.city_name,
           'phone',public.effective_whatsapp_phone(p.leads_whatsapp,p.leads_phone),'raw_phone',coalesce(p.leads_phone,''),'whatsapp',coalesce(p.leads_whatsapp,''),
           'instagram',coalesce(p.leads_instagram,''),'website',coalesce(p.leads_website,''),'maps_url',coalesce(p.leads_maps,''),
           'channel_id',p.channels_id,'channel',p.channel_name,'contact_source_id',p.contact_sources_id,'contact_source',p.contact_source_name,
           'status_id',p.lead_status_id,'status',p.lead_status_name,'created_at',p.leads_created_at,'updated_at',p.leads_updated_at,
           'rating',coalesce(p.leads_score,0),'reviews',coalesce(p.leads_reviews_count,0)
         ) ORDER BY coalesce(p.leads_score,0) DESC,coalesce(p.leads_reviews_count,0) DESC,p.leads_id ASC) FILTER (WHERE p.leads_id IS NOT NULL),'[]'::jsonb)
  INTO v_total,v_items
  FROM counted c LEFT JOIN page_rows p ON true
  GROUP BY c.total;

  RETURN jsonb_build_object('contractVersion','R59','page',v_page,'pageSize',v_page_size,'total',coalesce(v_total,0),'items',coalesce(v_items,'[]'::jsonb),'summary',coalesce(v_summary,'{}'::jsonb));
END;
$function$;
CREATE OR REPLACE FUNCTION public.list_base_permanent_page_r59(
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 20,
  p_search text DEFAULT NULL,
  p_origin text DEFAULT NULL,
  p_status text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_org bigint:=public.current_organization_id(); v_user bigint:=public.ensure_current_user();
  v_page integer:=greatest(1,coalesce(p_page,1)); v_page_size integer:=CASE WHEN p_page_size IN(10,20,50,100) THEN p_page_size ELSE 20 END;
  v_offset integer; v_search text:=nullif(btrim(coalesce(p_search,'')),''); v_origin text:=nullif(btrim(coalesce(p_origin,'')),''); v_status text:=nullif(btrim(coalesce(p_status,'')),'');
  v_whatsapp bigint; v_instagram bigint;
  v_total integer:=0; v_items jsonb:='[]'::jsonb; v_summary jsonb:='{}'::jsonb;
BEGIN
  PERFORM public.require_organization_permission('leads.view');
  IF v_org IS NULL OR v_user IS NULL THEN RAISE EXCEPTION 'organization_context_required'; END IF;
  v_offset:=(v_page-1)*v_page_size;
  v_whatsapp:=public.queue_review_channel_id('whatsapp');
  v_instagram:=public.queue_review_channel_id('instagram');

  -- Cards globais: somente agregação. Para registros legados sem canal no lead,
  -- o último envio conhecido resolve o canal sem assumir IDs fixos do catálogo.
  WITH finals AS (
    SELECT l.lead_status_id,
           CASE WHEN l.channels_id=v_whatsapp THEN 'WhatsApp'
                WHEN l.channels_id=v_instagram THEN 'Instagram'
                WHEN sent.channels_id=v_whatsapp THEN 'WhatsApp'
                WHEN sent.channels_id=v_instagram THEN 'Instagram'
                ELSE 'Sem canal' END AS origin_name
    FROM public.leads l
    LEFT JOIN LATERAL (
      SELECT s.channels_id
      FROM public.sents s
      WHERE s.users_id=v_user AND s.leads_id=l.leads_id AND s.sents_sent_at IS NOT NULL
      ORDER BY s.sents_sent_at DESC,s.sents_id DESC LIMIT 1
    ) sent ON l.channels_id IS DISTINCT FROM v_whatsapp AND l.channels_id IS DISTINCT FROM v_instagram
    WHERE l.organizations_id=v_org AND l.users_id=v_user AND l.lead_status_id IN(3,5,6,7)
  )
  SELECT jsonb_build_object(
    'total',count(*)::integer,'sent',count(*) FILTER(WHERE lead_status_id=5)::integer,
    'sentWhatsApp',count(*) FILTER(WHERE lead_status_id=5 AND origin_name='WhatsApp')::integer,
    'sentInstagram',count(*) FILTER(WHERE lead_status_id=5 AND origin_name='Instagram')::integer,
    'noContact',count(*) FILTER(WHERE lead_status_id=3)::integer,'invalid',count(*) FILTER(WHERE lead_status_id=6)::integer,'duplicates',count(*) FILTER(WHERE lead_status_id=7)::integer
  ) INTO v_summary FROM finals;

  WITH candidates AS (
    SELECT l.leads_id,l.branches_id,l.lead_status_id,l.leads_name,l.leads_phone,l.leads_whatsapp,l.leads_instagram,l.leads_website,l.leads_maps,l.leads_updated_at,l.leads_created_at,
           coalesce(br.branches_name,'') branch_name,coalesce(st.states_code,st.states_name,'') state_name,coalesce(ci.cities_name,'') city_name,
           regexp_replace(lower(public.unaccent(trim(ls.lead_status_name))), '[^a-z0-9]+','','g') status_key,
           CASE WHEN l.channels_id=v_whatsapp THEN 'WhatsApp'
                WHEN l.channels_id=v_instagram THEN 'Instagram'
                WHEN sent.channels_id=v_whatsapp THEN 'WhatsApp'
                WHEN sent.channels_id=v_instagram THEN 'Instagram'
                ELSE 'Sem canal' END AS origin_name,
           sent.sents_sent_at AS last_sent_at
    FROM public.leads l
    JOIN public.lead_status ls ON ls.lead_status_id=l.lead_status_id
    LEFT JOIN public.branches br ON br.branches_id=l.branches_id AND br.users_id=l.users_id
    LEFT JOIN public.states st ON st.states_id=l.states_id
    LEFT JOIN public.cities ci ON ci.cities_id=l.cities_id
    LEFT JOIN LATERAL(
      SELECT s.sents_sent_at,s.channels_id
      FROM public.sents s
      WHERE s.users_id=v_user AND s.leads_id=l.leads_id AND s.sents_sent_at IS NOT NULL
      ORDER BY s.sents_sent_at DESC,s.sents_id DESC LIMIT 1
    ) sent ON true
    WHERE l.organizations_id=v_org AND l.users_id=v_user AND l.lead_status_id IN(3,5,6,7)
  ), filtered AS (
    SELECT * FROM candidates c
    WHERE (v_origin IS NULL OR v_origin='Todos' OR c.origin_name=v_origin)
      AND (v_status IS NULL OR v_status='Todos' OR c.status_key=regexp_replace(lower(public.unaccent(v_status)),'[^a-z0-9]+','','g'))
      AND (v_search IS NULL OR lower(public.unaccent(concat_ws(' ',c.leads_name,c.leads_phone,c.leads_whatsapp,c.leads_instagram,c.leads_website,c.city_name,c.state_name,c.branch_name))) LIKE '%'||lower(public.unaccent(v_search))||'%')
  ), counted AS (
    SELECT count(*)::integer total FROM filtered
  ), page_rows AS (
    SELECT * FROM filtered ORDER BY leads_updated_at DESC NULLS LAST,leads_id DESC LIMIT v_page_size OFFSET v_offset
  )
  SELECT c.total,coalesce(jsonb_agg(jsonb_build_object(
    'id',e.leads_id,'company',e.leads_name,'branch_id',e.branches_id,'branch',e.branch_name,'state',e.state_name,'city',e.city_name,
    'phone',public.effective_whatsapp_phone(e.leads_whatsapp,e.leads_phone),'instagram',coalesce(e.leads_instagram,''),'site',coalesce(e.leads_website,''),'maps_url',coalesce(e.leads_maps,''),
    'origin',e.origin_name,'status_id',e.lead_status_id,'finalized_at',coalesce(e.leads_updated_at,e.leads_created_at),
    'last_sent_at',coalesce(e.last_sent_at,CASE WHEN e.lead_status_id=5 THEN coalesce(e.leads_updated_at,e.leads_created_at) END),
    'total_dispatches',CASE WHEN e.last_sent_at IS NULL THEN 0 ELSE 1 END
  ) ORDER BY e.leads_updated_at DESC NULLS LAST,e.leads_id DESC) FILTER(WHERE e.leads_id IS NOT NULL),'[]'::jsonb)
  INTO v_total,v_items FROM counted c LEFT JOIN page_rows e ON true GROUP BY c.total;

  RETURN jsonb_build_object('contractVersion','R59','page',v_page,'pageSize',v_page_size,'total',coalesce(v_total,0),'items',coalesce(v_items,'[]'::jsonb),'summary',coalesce(v_summary,'{}'::jsonb));
END;
$function$;
CREATE OR REPLACE FUNCTION public.list_queue_review_page_r59(p_channel text,p_resource_key text,p_scheduled_date date,p_page integer DEFAULT 1,p_page_size integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog','public' AS $function$
DECLARE
 v_org bigint:=public.current_organization_id();v_user bigint:=public.ensure_current_user();v_channel text:=lower(trim(coalesce(p_channel,'')));v_key text:=lower(trim(coalesce(p_resource_key,'')));v_resource_id bigint;v_resource_label text;
 v_page integer:=greatest(1,coalesce(p_page,1));v_page_size integer:=CASE WHEN p_page_size IN(10,20,50,100) THEN p_page_size ELSE 20 END;v_offset integer;v_total integer:=0;v_items jsonb:='[]'::jsonb;
BEGIN
 PERFORM public.require_organization_permission('queues.view'); IF v_channel NOT IN('whatsapp','instagram') OR v_key='' OR p_scheduled_date IS NULL THEN RETURN jsonb_build_object('page',v_page,'pageSize',v_page_size,'total',0,'items','[]'::jsonb); END IF;
 v_offset:=(v_page-1)*v_page_size;
 IF v_channel='whatsapp' THEN SELECT c.chips_id,coalesce(nullif(btrim(c.chips_name),''),i.instances_name,c.chips_id::text) INTO v_resource_id,v_resource_label FROM public.chips c JOIN public.instances i ON i.instances_id=c.instances_id AND i.users_id=c.users_id WHERE c.users_id=v_user AND(c.chips_id::text=v_key OR lower(btrim(coalesce(c.chips_name,'')))=v_key OR lower(btrim(coalesce(i.instances_name,'')))=v_key) ORDER BY c.chips_id LIMIT 1;
 ELSE SELECT so.socials_id,coalesce(nullif(btrim(so.socials_name),''),concat('@',regexp_replace(coalesce(so.socials_username,''),'^@','','g')),so.socials_id::text) INTO v_resource_id,v_resource_label FROM public.socials so WHERE so.users_id=v_user AND(so.socials_id::text=v_key OR lower(btrim(coalesce(so.socials_name,'')))=v_key OR lower(regexp_replace(btrim(coalesce(so.socials_username,'')),'^@','','g'))=regexp_replace(v_key,'^@','','g')) ORDER BY so.socials_id LIMIT 1; END IF;
 IF v_resource_id IS NULL THEN RETURN jsonb_build_object('page',v_page,'pageSize',v_page_size,'total',0,'items','[]'::jsonb); END IF;
 WITH ranked AS(
   SELECT b.queue_review_batches_id batch_id,i.queue_review_items_id review_item_id,b.channel_key,b.resource_id,v_resource_label resource_label,b.scheduled_date,b.target_count,l.leads_id lead_id,
          row_number() OVER(ORDER BY b.queue_review_batches_id,i.review_position,i.queue_review_items_id)::integer position,
          l.leads_name company,l.branches_id branch_id,coalesce(br.branches_name,'') branch_name,coalesce(ci.cities_name,'') city,coalesce(st.states_code,st.states_name,'') state,
          coalesce(l.leads_phone,'') phone,coalesce(l.leads_whatsapp,'') whatsapp,coalesce(l.leads_instagram,'') instagram,coalesce(l.leads_website,'') website,coalesce(l.leads_maps,'') maps_url,coalesce(l.leads_score,0)::numeric rating,coalesce(l.leads_reviews_count,0)::integer reviews
   FROM public.queue_review_batches b JOIN public.queue_review_items i ON i.queue_review_batches_id=b.queue_review_batches_id AND i.review_status='open'
   JOIN public.leads l ON l.leads_id=i.leads_id AND l.organizations_id=b.organizations_id AND l.users_id=b.users_id AND l.lead_status_id=2 AND l.channels_id=b.channels_id
   LEFT JOIN public.branches br ON br.branches_id=l.branches_id LEFT JOIN public.cities ci ON ci.cities_id=l.cities_id LEFT JOIN public.states st ON st.states_id=l.states_id
   WHERE b.organizations_id=v_org AND b.users_id=v_user AND b.review_status='open' AND b.channel_key=v_channel AND b.resource_id=v_resource_id AND b.scheduled_date=p_scheduled_date
 ), counted AS(SELECT count(*)::integer total FROM ranked), page_rows AS(SELECT * FROM ranked ORDER BY position LIMIT v_page_size OFFSET v_offset)
 SELECT c.total,coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.position) FILTER(WHERE p.review_item_id IS NOT NULL),'[]'::jsonb) INTO v_total,v_items FROM counted c LEFT JOIN page_rows p ON true GROUP BY c.total;
 RETURN jsonb_build_object('contractVersion','R59','page',v_page,'pageSize',v_page_size,'total',coalesce(v_total,0),'items',coalesce(v_items,'[]'::jsonb));
END;$function$;
CREATE OR REPLACE FUNCTION public.list_queue_final_page_r59(p_channel text,p_resource_key text,p_scheduled_date date,p_page integer DEFAULT 1,p_page_size integer DEFAULT 20,p_search text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog','public' AS $function$
DECLARE
 v_org bigint:=public.current_organization_id();v_user bigint:=public.ensure_current_user();v_channel text:=lower(trim(coalesce(p_channel,'')));v_key text:=lower(trim(coalesce(p_resource_key,'')));v_channel_id bigint;v_resource_id bigint;v_resource_label text;v_instance_name text;v_profile_username text;v_daily_limit integer:=1;v_batch_count integer:=1;v_batch_size integer:=1;
 v_page integer:=greatest(1,coalesce(p_page,1));v_page_size integer:=CASE WHEN p_page_size IN(10,20,50,100) THEN p_page_size ELSE 20 END;v_offset integer;v_search text:=nullif(btrim(coalesce(p_search,'')),'');v_total integer:=0;v_items jsonb:='[]'::jsonb;v_summary jsonb:='{}'::jsonb;
BEGIN
 PERFORM public.require_organization_permission('queues.view'); IF v_channel NOT IN('whatsapp','instagram') OR v_key='' OR p_scheduled_date IS NULL THEN RETURN jsonb_build_object('page',v_page,'pageSize',v_page_size,'total',0,'items','[]'::jsonb,'summary','{}'::jsonb); END IF;
 v_offset:=(v_page-1)*v_page_size;v_channel_id:=public.queue_review_channel_id(v_channel);
 IF v_channel='whatsapp' THEN SELECT c.chips_id,coalesce(nullif(btrim(c.chips_name),''),i.instances_name,c.chips_id::text),coalesce(i.instances_name,''),greatest(1,coalesce(l.levels_daily_limit,1)),greatest(1,coalesce(l.levels_queues,1)) INTO v_resource_id,v_resource_label,v_instance_name,v_daily_limit,v_batch_count FROM public.chips c JOIN public.instances i ON i.instances_id=c.instances_id AND i.users_id=c.users_id LEFT JOIN public.levels l ON l.levels_id=c.levels_id AND l.users_id=c.users_id WHERE c.users_id=v_user AND(c.chips_id::text=v_key OR lower(btrim(coalesce(c.chips_name,'')))=v_key OR lower(btrim(coalesce(i.instances_name,'')))=v_key) ORDER BY c.chips_id LIMIT 1;
 ELSE SELECT so.socials_id,coalesce(nullif(btrim(so.socials_name),''),concat('@',regexp_replace(coalesce(so.socials_username,''),'^@','','g')),so.socials_id::text),regexp_replace(coalesce(so.socials_username,''),'^@','','g'),greatest(1,coalesce(l.levels_daily_limit,1)),greatest(1,coalesce(l.levels_queues,1)) INTO v_resource_id,v_resource_label,v_profile_username,v_daily_limit,v_batch_count FROM public.socials so LEFT JOIN public.levels l ON l.levels_id=so.levels_id AND l.users_id=so.users_id WHERE so.users_id=v_user AND(so.socials_id::text=v_key OR lower(btrim(coalesce(so.socials_name,'')))=v_key OR lower(regexp_replace(btrim(coalesce(so.socials_username,'')),'^@','','g'))=regexp_replace(v_key,'^@','','g')) ORDER BY so.socials_id LIMIT 1; END IF;
 v_batch_size:=greatest(1,floor(v_daily_limit::numeric/v_batch_count)::integer);
 IF v_resource_id IS NULL THEN RETURN jsonb_build_object('page',v_page,'pageSize',v_page_size,'total',0,'items','[]'::jsonb,'summary','{}'::jsonb); END IF;
 WITH raw AS(
   SELECT qi.queue_items_id id,qi.leads_id lead_id,qi.queue_items_position position,qi.queues_id queue_id,CASE WHEN v_channel='whatsapp' THEN qi.chips_id ELSE qi.socials_id END resource_id,
          v_resource_label resource_label,v_instance_name instance_name,v_profile_username profile_username,(coalesce(qi.queue_items_scheduled_at,q.queues_scheduled_at) AT TIME ZONE 'UTC')::date scheduled_date,
          qi.templates_id template_id,qi.queue_items_payload_snapshot payload_snapshot,s.status_name,
          l.leads_name company,l.leads_alternative_name alternative_name,l.leads_phone phone,l.leads_whatsapp whatsapp,l.leads_instagram instagram,l.leads_website website,l.leads_maps maps_url,l.branches_id branch_id,
          coalesce(br.branches_name,'') branch,coalesce(ci.cities_name,'') city,coalesce(st.states_code,st.states_name,'') state,coalesce(l.leads_score,0) rating,coalesce(l.leads_reviews_count,0) reviews,
          qi.queue_items_attempts retry_count,coalesce(qi.queue_items_error_message,'') error_message,qi.queue_items_finished_at finished_at,qi.queue_items_created_at created_at,qi.queue_items_updated_at updated_at,
          coalesce(t.templates_message_1,'') message_1,coalesce(t.templates_message_2,'') message_2,coalesce(t.templates_message_3,'') message_3,coalesce(t.templates_message_4,'') message_4,
          coalesce(ip.step,'') progress_step,coalesce(ip.attempts,qi.queue_items_attempts) progress_attempts,coalesce(ip.error_message,qi.queue_items_error_message,'') progress_error,
          regexp_replace(lower(public.unaccent(trim(s.status_name))), '[^a-z0-9]+','','g') status_key
   FROM public.queue_items qi JOIN public.queues q ON q.queues_id=qi.queues_id AND q.users_id=qi.users_id JOIN public.status s ON s.status_id=qi.status_id JOIN public.leads l ON l.leads_id=qi.leads_id AND l.users_id=qi.users_id
   LEFT JOIN public.templates t ON t.templates_id=qi.templates_id AND t.users_id=qi.users_id LEFT JOIN public.branches br ON br.branches_id=l.branches_id LEFT JOIN public.cities ci ON ci.cities_id=l.cities_id LEFT JOIN public.states st ON st.states_id=l.states_id
   LEFT JOIN public.instagram_queue_progress ip ON v_channel='instagram' AND ip.queue_items_id=qi.queue_items_id
   WHERE qi.organizations_id=v_org AND qi.users_id=v_user AND q.organizations_id=v_org AND q.channels_id=v_channel_id
     AND CASE WHEN v_channel='whatsapp' THEN qi.chips_id ELSE qi.socials_id END=v_resource_id
     AND (coalesce(qi.queue_items_scheduled_at,q.queues_scheduled_at) AT TIME ZONE 'UTC')::date=p_scheduled_date
     AND regexp_replace(lower(public.unaccent(trim(s.status_name))), '[^a-z0-9]+','','g') NOT IN('cancelado','cancelled','canceled')
     AND (v_search IS NULL OR lower(public.unaccent(concat_ws(' ',l.leads_name,l.leads_phone,l.leads_whatsapp,l.leads_instagram,br.branches_name,s.status_name))) LIKE '%'||lower(public.unaccent(v_search))||'%')
 ), effective AS(
   SELECT r.*,
     CASE WHEN v_channel='instagram' THEN
       CASE WHEN r.status_key IN('concluido','completed','sent') THEN 'sent' WHEN r.status_key IN('erro','error','failed') THEN 'error' WHEN r.status_key IN('pausado','paused') THEN 'paused'
            WHEN r.progress_step='reconciliation_required' THEN 'reconciliation_required' WHEN r.progress_step='sent' THEN 'sent' WHEN r.progress_step='invalid' THEN 'invalid'
            WHEN r.progress_step='error' AND r.status_key NOT IN('pendente','pending','queued') THEN 'error' WHEN r.progress_step IN('claimed','profile_opened','following','followed') THEN 'following'
            WHEN r.progress_step IN('dm_opened','messages_sending','media_sending') THEN 'dm_opened' ELSE 'queued' END
       ELSE CASE WHEN r.status_key IN('concluido','completed','sent') THEN 'sent' WHEN r.status_key IN('erro','error','failed') THEN 'error' WHEN r.status_key IN('pausado','paused') THEN 'paused' WHEN r.status_key IN('processando','processing','sending') THEN 'sending' ELSE 'queued' END END AS effective_status
   FROM raw r
 ), ranked AS(
   SELECT e.*,row_number() OVER(ORDER BY e.position,e.id)::integer AS display_position FROM effective e
 ), batched AS(
   SELECT r.*,v_batch_count AS dispatch_batch_count,v_batch_size AS dispatch_batch_size,
          least(v_batch_count,((r.display_position-1)/v_batch_size)+1)::integer AS dispatch_batch_number,
          CASE
            WHEN r.display_position > (v_batch_size * greatest(0,v_batch_count-1))
              THEN (r.display_position - (v_batch_size * greatest(0,v_batch_count-1)))::integer
            ELSE (((r.display_position-1)%v_batch_size)+1)::integer
          END AS dispatch_batch_position
   FROM ranked r
 ), counted AS(SELECT count(*)::integer total FROM batched), page_rows AS(SELECT * FROM batched ORDER BY display_position,id LIMIT v_page_size OFFSET v_offset)
 SELECT c.total,coalesce(jsonb_agg(to_jsonb(p)-'status_key'-'effective_status' ORDER BY p.display_position,p.id) FILTER(WHERE p.id IS NOT NULL),'[]'::jsonb),
        (SELECT CASE WHEN v_channel='whatsapp' THEN jsonb_build_object('total',count(*)::integer,'queued',count(*) FILTER(WHERE effective_status IN('queued','paused','sending'))::integer,'sent',count(*) FILTER(WHERE effective_status='sent')::integer,'finished',count(*) FILTER(WHERE effective_status IN('sent','invalid'))::integer,'errors',count(*) FILTER(WHERE effective_status='error')::integer)
                     ELSE jsonb_build_object('total',count(*)::integer,'queued',count(*) FILTER(WHERE effective_status IN('queued','paused','following','dm_opened'))::integer,'sent',count(*) FILTER(WHERE effective_status='sent')::integer,'errors',count(*) FILTER(WHERE effective_status IN('error','reconciliation_required'))::integer,'invalid',count(*) FILTER(WHERE effective_status='invalid')::integer) END FROM batched)
 INTO v_total,v_items,v_summary FROM counted c LEFT JOIN page_rows p ON true GROUP BY c.total;
 RETURN jsonb_build_object('contractVersion','R59','page',v_page,'pageSize',v_page_size,'total',coalesce(v_total,0),'items',coalesce(v_items,'[]'::jsonb),'summary',coalesce(v_summary,'{}'::jsonb));
END;$function$;


-- ============================================================================
-- FIX 20 — PROTEÇÃO CANÔNICA DE DOWNGRADE DE NÍVEL
-- Ocupação = queue_items que consomem capacidade + queue_review_items abertos.
-- Datas anteriores à data operacional local não bloqueiam a mudança.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.queue_operational_today_r59()
RETURNS date
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE
  v_org bigint;
  v_tz text := 'America/Sao_Paulo';
BEGIN
  BEGIN
    v_org := public.current_organization_id();
  EXCEPTION WHEN OTHERS THEN
    v_org := NULL;
  END;

  IF v_org IS NOT NULL THEN
    SELECT coalesce(nullif(ots.settings->>'operationalTimezone',''),'America/Sao_Paulo')
      INTO v_tz
    FROM public.organization_tool_settings ots
    WHERE ots.organizations_id=v_org
      AND ots.tool_id='vinsansi_whatsapp_manager'
    LIMIT 1;
  END IF;

  v_tz := coalesce(nullif(v_tz,''),'America/Sao_Paulo');
  RETURN (now() AT TIME ZONE v_tz)::date;
END;
$function$;

CREATE OR REPLACE FUNCTION public._resource_capacity_conflict_r59(
  p_users_id bigint,
  p_channel text,
  p_resource_id bigint,
  p_new_limit integer,
  p_from_date date
)
RETURNS TABLE(conflict_date date, occupied integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
WITH channel_ref AS (
  SELECT c.channels_id
  FROM public.channels c
  WHERE regexp_replace(lower(public.unaccent(trim(c.channels_name))), '[^a-z0-9]+','','g')
        = lower(trim(coalesce(p_channel,'')))
  ORDER BY c.channels_id
  LIMIT 1
), capacity_status AS (
  SELECT s.status_id
  FROM public.status s
  WHERE regexp_replace(lower(public.unaccent(trim(s.status_name))), '[^a-z0-9]+','','g') IN (
    'pendente','pending','queued',
    'processando','processing','sending',
    'concluido','completed','sent',
    'pausado','paused'
  )
), final_counts AS (
  SELECT
    (coalesce(qi.queue_items_scheduled_at,q.queues_scheduled_at) AT TIME ZONE 'UTC')::date AS scheduled_date,
    count(*)::integer AS total
  FROM public.queue_items qi
  JOIN public.queues q
    ON q.queues_id=qi.queues_id
   AND q.users_id=qi.users_id
  CROSS JOIN channel_ref cr
  WHERE qi.users_id=p_users_id
    AND q.channels_id=cr.channels_id
    AND qi.status_id IN (SELECT status_id FROM capacity_status)
    AND CASE
          WHEN lower(trim(coalesce(p_channel,'')))='whatsapp' THEN qi.chips_id=p_resource_id
          ELSE qi.socials_id=p_resource_id
        END
    AND (coalesce(qi.queue_items_scheduled_at,q.queues_scheduled_at) AT TIME ZONE 'UTC')::date >= p_from_date
  GROUP BY 1
), review_counts AS (
  SELECT b.scheduled_date, count(*)::integer AS total
  FROM public.queue_review_batches b
  JOIN public.queue_review_items i
    ON i.queue_review_batches_id=b.queue_review_batches_id
   AND i.review_status='open'
  WHERE b.users_id=p_users_id
    AND b.channel_key=lower(trim(coalesce(p_channel,'')))
    AND b.resource_id=p_resource_id
    AND b.review_status='open'
    AND b.scheduled_date>=p_from_date
  GROUP BY b.scheduled_date
), dates AS (
  SELECT scheduled_date FROM final_counts
  UNION
  SELECT scheduled_date FROM review_counts
), occupancy AS (
  SELECT d.scheduled_date,
         coalesce(f.total,0)+coalesce(r.total,0) AS total
  FROM dates d
  LEFT JOIN final_counts f USING(scheduled_date)
  LEFT JOIN review_counts r USING(scheduled_date)
)
SELECT o.scheduled_date, o.total::integer
FROM occupancy o
WHERE o.total > greatest(0,coalesce(p_new_limit,0))
ORDER BY o.scheduled_date
LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public._resource_capacity_conflict_r59(bigint,text,bigint,integer,date) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.validate_resource_level_change_r59(
  p_resource_type text,
  p_resource_id bigint,
  p_new_level_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE
  v_user bigint:=public.ensure_current_user();
  v_type text:=lower(trim(coalesce(p_resource_type,'')));
  v_expected_channel text;
  v_current_level_id bigint;
  v_current_limit integer;
  v_new_limit integer;
  v_new_channel text;
  v_new_status text;
  v_resource_label text;
  v_conflict record;
  v_today date:=public.queue_operational_today_r59();
BEGIN
  IF v_type IN ('chip','chips','whatsapp') THEN
    v_type:='whatsapp';
    v_expected_channel:='whatsapp';
    PERFORM public.require_organization_permission('whatsapp.instances.manage');

    SELECT c.levels_id,
           coalesce(l.levels_daily_limit,0),
           coalesce(nullif(btrim(c.chips_name),''),c.chips_phone,c.chips_id::text)
      INTO v_current_level_id,v_current_limit,v_resource_label
    FROM public.chips c
    LEFT JOIN public.levels l ON l.levels_id=c.levels_id AND l.users_id=c.users_id
    WHERE c.chips_id=p_resource_id AND c.users_id=v_user;
  ELSIF v_type IN ('social','socials','instagram') THEN
    v_type:='instagram';
    v_expected_channel:='instagram';
    PERFORM public.require_organization_permission('instagram.settings');

    SELECT so.levels_id,
           coalesce(l.levels_daily_limit,0),
           coalesce(nullif(btrim(so.socials_name),''),concat('@',regexp_replace(coalesce(so.socials_username,''),'^@','','g')),so.socials_id::text)
      INTO v_current_level_id,v_current_limit,v_resource_label
    FROM public.socials so
    LEFT JOIN public.levels l ON l.levels_id=so.levels_id AND l.users_id=so.users_id
    WHERE so.socials_id=p_resource_id AND so.users_id=v_user;
  ELSE
    RAISE EXCEPTION 'Tipo de recurso inválido para alteração de nível.' USING ERRCODE='22023';
  END IF;

  IF v_current_level_id IS NULL THEN
    RAISE EXCEPTION 'Recurso não encontrado ou sem permissão de acesso.' USING ERRCODE='P0001';
  END IF;

  SELECT l.levels_daily_limit,
         regexp_replace(lower(public.unaccent(trim(c.channels_name))), '[^a-z0-9]+','','g'),
         regexp_replace(lower(public.unaccent(trim(s.status_name))), '[^a-z0-9]+','','g')
    INTO v_new_limit,v_new_channel,v_new_status
  FROM public.levels l
  JOIN public.channels c ON c.channels_id=l.channels_id
  JOIN public.status s ON s.status_id=l.status_id
  WHERE l.levels_id=p_new_level_id
    AND l.users_id=v_user
  LIMIT 1;

  IF v_new_limit IS NULL THEN
    RETURN jsonb_build_object('allowed',false,'reason','level_not_found','message','O nível selecionado não foi encontrado.');
  END IF;
  IF v_new_status NOT IN ('ativo','active') THEN
    RETURN jsonb_build_object('allowed',false,'reason','level_inactive','message','O nível selecionado não está ativo.');
  END IF;
  IF v_new_channel<>v_expected_channel THEN
    RETURN jsonb_build_object('allowed',false,'reason','channel_mismatch','message','O nível selecionado não pertence ao canal deste recurso.');
  END IF;

  -- Aumento ou manutenção do limite nunca é bloqueado por ocupação pré-existente.
  IF v_new_limit>=coalesce(v_current_limit,0) THEN
    RETURN jsonb_build_object(
      'allowed',true,'currentLimit',coalesce(v_current_limit,0),'newLimit',v_new_limit,
      'resourceLabel',v_resource_label
    );
  END IF;

  SELECT * INTO v_conflict
  FROM public._resource_capacity_conflict_r59(v_user,v_type,p_resource_id,v_new_limit,v_today);

  IF v_conflict.conflict_date IS NOT NULL THEN
    RETURN jsonb_build_object(
      'allowed',false,
      'reason','capacity_conflict',
      'resourceLabel',v_resource_label,
      'currentLimit',coalesce(v_current_limit,0),
      'newLimit',v_new_limit,
      'conflictDate',v_conflict.conflict_date,
      'occupied',v_conflict.occupied,
      'message',format(
        'Não é possível alterar para este nível. %s possui %s posições ocupadas em %s e o novo nível permite apenas %s por dia.',
        v_resource_label,v_conflict.occupied,to_char(v_conflict.conflict_date,'DD/MM/YYYY'),v_new_limit
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'allowed',true,'currentLimit',coalesce(v_current_limit,0),'newLimit',v_new_limit,
    'resourceLabel',v_resource_label
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.validate_resource_level_change_r59(text,bigint,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_resource_level_change_r59(text,bigint,bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.validate_level_daily_limit_change_r59(
  p_level_id bigint,
  p_new_daily_limit integer
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE
  v_user bigint:=public.ensure_current_user();
  v_old_limit integer;
  v_channel text;
  v_resource record;
  v_conflict record;
  v_today date:=public.queue_operational_today_r59();
BEGIN
  IF coalesce(p_new_daily_limit,0)<=0 THEN
    RETURN jsonb_build_object('allowed',false,'reason','invalid_limit','message','O limite diário deve ser maior que zero.');
  END IF;

  SELECT l.levels_daily_limit,
         regexp_replace(lower(public.unaccent(trim(c.channels_name))), '[^a-z0-9]+','','g')
    INTO v_old_limit,v_channel
  FROM public.levels l
  JOIN public.channels c ON c.channels_id=l.channels_id
  WHERE l.levels_id=p_level_id AND l.users_id=v_user;

  IF v_old_limit IS NULL THEN
    RETURN jsonb_build_object('allowed',false,'reason','level_not_found','message','Nível não encontrado.');
  END IF;

  IF p_new_daily_limit>=v_old_limit OR v_channel NOT IN ('whatsapp','instagram') THEN
    RETURN jsonb_build_object('allowed',true,'currentLimit',v_old_limit,'newLimit',p_new_daily_limit);
  END IF;

  IF v_channel='whatsapp' THEN
    FOR v_resource IN
      SELECT c.chips_id AS resource_id,
             coalesce(nullif(btrim(c.chips_name),''),c.chips_phone,c.chips_id::text) AS resource_label
      FROM public.chips c
      WHERE c.users_id=v_user AND c.levels_id=p_level_id
      ORDER BY c.chips_id
    LOOP
      SELECT * INTO v_conflict
      FROM public._resource_capacity_conflict_r59(v_user,'whatsapp',v_resource.resource_id,p_new_daily_limit,v_today);
      IF v_conflict.conflict_date IS NOT NULL THEN
        RETURN jsonb_build_object(
          'allowed',false,'reason','capacity_conflict','resourceLabel',v_resource.resource_label,
          'currentLimit',v_old_limit,'newLimit',p_new_daily_limit,
          'conflictDate',v_conflict.conflict_date,'occupied',v_conflict.occupied,
          'message',format(
            'Não é possível reduzir este nível para %s leads/dia. %s possui %s posições ocupadas em %s.',
            p_new_daily_limit,v_resource.resource_label,v_conflict.occupied,to_char(v_conflict.conflict_date,'DD/MM/YYYY')
          )
        );
      END IF;
    END LOOP;
  ELSE
    FOR v_resource IN
      SELECT so.socials_id AS resource_id,
             coalesce(nullif(btrim(so.socials_name),''),concat('@',regexp_replace(coalesce(so.socials_username,''),'^@','','g')),so.socials_id::text) AS resource_label
      FROM public.socials so
      WHERE so.users_id=v_user AND so.levels_id=p_level_id
      ORDER BY so.socials_id
    LOOP
      SELECT * INTO v_conflict
      FROM public._resource_capacity_conflict_r59(v_user,'instagram',v_resource.resource_id,p_new_daily_limit,v_today);
      IF v_conflict.conflict_date IS NOT NULL THEN
        RETURN jsonb_build_object(
          'allowed',false,'reason','capacity_conflict','resourceLabel',v_resource.resource_label,
          'currentLimit',v_old_limit,'newLimit',p_new_daily_limit,
          'conflictDate',v_conflict.conflict_date,'occupied',v_conflict.occupied,
          'message',format(
            'Não é possível reduzir este nível para %s leads/dia. %s possui %s posições ocupadas em %s.',
            p_new_daily_limit,v_resource.resource_label,v_conflict.occupied,to_char(v_conflict.conflict_date,'DD/MM/YYYY')
          )
        );
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('allowed',true,'currentLimit',v_old_limit,'newLimit',p_new_daily_limit);
END;
$function$;

REVOKE ALL ON FUNCTION public.validate_level_daily_limit_change_r59(bigint,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_level_daily_limit_change_r59(bigint,integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_resource_level_capacity_r59()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE
  v_channel text;
  v_current_limit integer:=0;
  v_new_limit integer;
  v_new_channel text;
  v_new_status text;
  v_resource_id bigint;
  v_resource_label text;
  v_conflict record;
  v_today date:=public.queue_operational_today_r59();
BEGIN
  IF NEW.levels_id IS NOT DISTINCT FROM OLD.levels_id THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME='chips' THEN
    v_channel:='whatsapp';
    v_resource_id:=NEW.chips_id;
    v_resource_label:=coalesce(nullif(btrim(NEW.chips_name),''),NEW.chips_phone,NEW.chips_id::text);
  ELSIF TG_TABLE_NAME='socials' THEN
    v_channel:='instagram';
    v_resource_id:=NEW.socials_id;
    v_resource_label:=coalesce(nullif(btrim(NEW.socials_name),''),concat('@',regexp_replace(coalesce(NEW.socials_username,''),'^@','','g')),NEW.socials_id::text);
  ELSE
    RETURN NEW;
  END IF;

  SELECT coalesce(l.levels_daily_limit,0)
    INTO v_current_limit
  FROM public.levels l
  WHERE l.levels_id=OLD.levels_id AND l.users_id=OLD.users_id;

  SELECT l.levels_daily_limit,
         regexp_replace(lower(public.unaccent(trim(c.channels_name))), '[^a-z0-9]+','','g'),
         regexp_replace(lower(public.unaccent(trim(s.status_name))), '[^a-z0-9]+','','g')
    INTO v_new_limit,v_new_channel,v_new_status
  FROM public.levels l
  JOIN public.channels c ON c.channels_id=l.channels_id
  JOIN public.status s ON s.status_id=l.status_id
  WHERE l.levels_id=NEW.levels_id AND l.users_id=NEW.users_id;

  IF v_new_limit IS NULL THEN
    RAISE EXCEPTION 'O nível selecionado não foi encontrado para este usuário.' USING ERRCODE='P0001';
  END IF;
  IF v_new_status NOT IN ('ativo','active') THEN
    RAISE EXCEPTION 'O nível selecionado não está ativo.' USING ERRCODE='P0001';
  END IF;
  IF v_new_channel<>v_channel THEN
    RAISE EXCEPTION 'O nível selecionado não pertence ao canal deste recurso.' USING ERRCODE='P0001';
  END IF;

  IF v_new_limit<coalesce(v_current_limit,0) THEN
    SELECT * INTO v_conflict
    FROM public._resource_capacity_conflict_r59(NEW.users_id,v_channel,v_resource_id,v_new_limit,v_today);

    IF v_conflict.conflict_date IS NOT NULL THEN
      RAISE EXCEPTION '%',format(
        'Não é possível alterar para este nível. %s possui %s posições ocupadas em %s e o novo nível permite apenas %s por dia.',
        v_resource_label,v_conflict.occupied,to_char(v_conflict.conflict_date,'DD/MM/YYYY'),v_new_limit
      ) USING ERRCODE='P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_chips_level_capacity_r59 ON public.chips;
CREATE TRIGGER trg_chips_level_capacity_r59
BEFORE UPDATE OF levels_id ON public.chips
FOR EACH ROW
EXECUTE FUNCTION public.enforce_resource_level_capacity_r59();

DROP TRIGGER IF EXISTS trg_socials_level_capacity_r59 ON public.socials;
CREATE TRIGGER trg_socials_level_capacity_r59
BEFORE UPDATE OF levels_id ON public.socials
FOR EACH ROW
EXECUTE FUNCTION public.enforce_resource_level_capacity_r59();

CREATE OR REPLACE FUNCTION public.enforce_level_daily_limit_capacity_r59()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE
  v_channel text;
  v_resource record;
  v_conflict record;
  v_today date:=public.queue_operational_today_r59();
BEGIN
  IF NEW.levels_daily_limit>=OLD.levels_daily_limit THEN
    RETURN NEW;
  END IF;

  SELECT regexp_replace(lower(public.unaccent(trim(c.channels_name))), '[^a-z0-9]+','','g')
    INTO v_channel
  FROM public.channels c
  WHERE c.channels_id=OLD.channels_id;

  IF v_channel='whatsapp' THEN
    FOR v_resource IN
      SELECT c.chips_id AS resource_id,
             coalesce(nullif(btrim(c.chips_name),''),c.chips_phone,c.chips_id::text) AS resource_label
      FROM public.chips c
      WHERE c.users_id=OLD.users_id AND c.levels_id=OLD.levels_id
      ORDER BY c.chips_id
    LOOP
      SELECT * INTO v_conflict
      FROM public._resource_capacity_conflict_r59(OLD.users_id,'whatsapp',v_resource.resource_id,NEW.levels_daily_limit,v_today);
      IF v_conflict.conflict_date IS NOT NULL THEN
        RAISE EXCEPTION '%',format(
          'Não é possível reduzir este nível para %s leads/dia. %s possui %s posições ocupadas em %s.',
          NEW.levels_daily_limit,v_resource.resource_label,v_conflict.occupied,to_char(v_conflict.conflict_date,'DD/MM/YYYY')
        ) USING ERRCODE='P0001';
      END IF;
    END LOOP;
  ELSIF v_channel='instagram' THEN
    FOR v_resource IN
      SELECT so.socials_id AS resource_id,
             coalesce(nullif(btrim(so.socials_name),''),concat('@',regexp_replace(coalesce(so.socials_username,''),'^@','','g')),so.socials_id::text) AS resource_label
      FROM public.socials so
      WHERE so.users_id=OLD.users_id AND so.levels_id=OLD.levels_id
      ORDER BY so.socials_id
    LOOP
      SELECT * INTO v_conflict
      FROM public._resource_capacity_conflict_r59(OLD.users_id,'instagram',v_resource.resource_id,NEW.levels_daily_limit,v_today);
      IF v_conflict.conflict_date IS NOT NULL THEN
        RAISE EXCEPTION '%',format(
          'Não é possível reduzir este nível para %s leads/dia. %s possui %s posições ocupadas em %s.',
          NEW.levels_daily_limit,v_resource.resource_label,v_conflict.occupied,to_char(v_conflict.conflict_date,'DD/MM/YYYY')
        ) USING ERRCODE='P0001';
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_levels_daily_limit_capacity_r59 ON public.levels;
CREATE TRIGGER trg_levels_daily_limit_capacity_r59
BEFORE UPDATE OF levels_daily_limit ON public.levels
FOR EACH ROW
EXECUTE FUNCTION public.enforce_level_daily_limit_capacity_r59();

COMMIT;
