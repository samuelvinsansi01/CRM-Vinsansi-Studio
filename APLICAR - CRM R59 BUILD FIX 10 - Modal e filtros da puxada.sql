-- CRM R59 BUILD FIX 10
-- Puxada filtrada para Revisao + preview de capacidade/elegibilidade.
-- Nao altera tabelas, colunas, triggers ou catalogos.

BEGIN;

DROP FUNCTION IF EXISTS public.pull_queue_review_to_capacity(text,text,date);
DROP FUNCTION IF EXISTS public.pull_queue_review_to_capacity(text,text,date,text,text);

CREATE FUNCTION public.pull_queue_review_to_capacity(
  p_channel text,
  p_resource_key text,
  p_scheduled_date date DEFAULT CURRENT_DATE,
  p_site_filter text DEFAULT 'any',
  p_instagram_filter text DEFAULT 'any'
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

  v_wanted:=greatest(0,coalesce(v_capacity.available,0)-coalesce(v_review_open_before,0));

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
  v_available_after:=greatest(0,coalesce(v_capacity.available,0)-v_review_open_after);

  UPDATE public.queue_review_batches
  SET target_count=greatest(0,coalesce(v_capacity.available,0)),updated_at=now()
  WHERE queue_review_batches_id=v_batch;

  RETURN jsonb_build_object(
    'contractVersion','R59','batchId',v_batch,'resourceId',v_resource_id,'resourceLabel',v_resource_label,
    'providerKey',v_provider_key,'selectionKey',CASE WHEN v_channel='whatsapp' THEN v_resource_label ELSE v_provider_key END,'scheduledDate',v_date,'dailyLimit',greatest(0,coalesce(v_capacity.daily_limit,0)),
    'available',v_available_after,'capacityToFill',v_wanted,'siteFilter',v_site_filter,
    'instagramFilter',CASE WHEN v_channel='instagram' THEN 'with' ELSE v_instagram_filter END,'reserved',v_reserved
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.preview_queue_review_pull(
  p_channel text,
  p_resource_key text,
  p_scheduled_date date DEFAULT CURRENT_DATE,
  p_site_filter text DEFAULT 'any',
  p_instagram_filter text DEFAULT 'any'
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
    'instagramFilter',CASE WHEN v_channel='instagram' THEN 'with' ELSE v_instagram_filter END
  );
END;
$function$;

COMMIT;
