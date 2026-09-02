BEGIN;

-- CRM R59 BUILD FIX 18
-- Camada canônica de leitura paginada para as tabelas operacionais.
-- Regra: filtros/ordenação/contagens no PostgreSQL; frontend recebe somente a página visível.

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
  v_page_size integer := CASE WHEN p_page_size IN (20,50,100) THEN p_page_size ELSE 20 END;
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
  v_page integer:=greatest(1,coalesce(p_page,1)); v_page_size integer:=CASE WHEN p_page_size IN(20,50,100) THEN p_page_size ELSE 20 END;
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
 v_page integer:=greatest(1,coalesce(p_page,1));v_page_size integer:=CASE WHEN p_page_size IN(20,50,100) THEN p_page_size ELSE 20 END;v_offset integer;v_total integer:=0;v_items jsonb:='[]'::jsonb;
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

CREATE OR REPLACE FUNCTION public.queue_review_count_r59(p_channel text,p_resource_key text,p_scheduled_date date)
RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog','public' AS $function$
DECLARE v_org bigint:=public.current_organization_id();v_user bigint:=public.ensure_current_user();v_channel text:=lower(trim(coalesce(p_channel,'')));v_key text:=lower(trim(coalesce(p_resource_key,'')));v_resource_id bigint;v_count integer:=0;
BEGIN
 PERFORM public.require_organization_permission('queues.view'); IF v_channel NOT IN('whatsapp','instagram') OR v_key='' OR p_scheduled_date IS NULL THEN RETURN 0; END IF;
 IF v_channel='whatsapp' THEN SELECT c.chips_id INTO v_resource_id FROM public.chips c JOIN public.instances i ON i.instances_id=c.instances_id AND i.users_id=c.users_id WHERE c.users_id=v_user AND(c.chips_id::text=v_key OR lower(btrim(coalesce(c.chips_name,'')))=v_key OR lower(btrim(coalesce(i.instances_name,'')))=v_key) ORDER BY c.chips_id LIMIT 1;
 ELSE SELECT so.socials_id INTO v_resource_id FROM public.socials so WHERE so.users_id=v_user AND(so.socials_id::text=v_key OR lower(btrim(coalesce(so.socials_name,'')))=v_key OR lower(regexp_replace(btrim(coalesce(so.socials_username,'')),'^@','','g'))=regexp_replace(v_key,'^@','','g')) ORDER BY so.socials_id LIMIT 1; END IF;
 IF v_resource_id IS NULL THEN RETURN 0; END IF;
 SELECT count(*)::integer INTO v_count FROM public.queue_review_batches b JOIN public.queue_review_items i ON i.queue_review_batches_id=b.queue_review_batches_id AND i.review_status='open'
 JOIN public.leads l ON l.leads_id=i.leads_id AND l.organizations_id=b.organizations_id AND l.users_id=b.users_id AND l.lead_status_id=2 AND l.channels_id=b.channels_id
 WHERE b.organizations_id=v_org AND b.users_id=v_user AND b.review_status='open' AND b.channel_key=v_channel AND b.resource_id=v_resource_id AND b.scheduled_date=p_scheduled_date;
 RETURN coalesce(v_count,0);
END;$function$;

CREATE OR REPLACE FUNCTION public.list_queue_final_page_r59(p_channel text,p_resource_key text,p_scheduled_date date,p_page integer DEFAULT 1,p_page_size integer DEFAULT 20,p_search text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog','public' AS $function$
DECLARE
 v_org bigint:=public.current_organization_id();v_user bigint:=public.ensure_current_user();v_channel text:=lower(trim(coalesce(p_channel,'')));v_key text:=lower(trim(coalesce(p_resource_key,'')));v_channel_id bigint;v_resource_id bigint;v_resource_label text;v_instance_name text;v_profile_username text;
 v_page integer:=greatest(1,coalesce(p_page,1));v_page_size integer:=CASE WHEN p_page_size IN(20,50,100) THEN p_page_size ELSE 20 END;v_offset integer;v_search text:=nullif(btrim(coalesce(p_search,'')),'');v_total integer:=0;v_items jsonb:='[]'::jsonb;v_summary jsonb:='{}'::jsonb;
BEGIN
 PERFORM public.require_organization_permission('queues.view'); IF v_channel NOT IN('whatsapp','instagram') OR v_key='' OR p_scheduled_date IS NULL THEN RETURN jsonb_build_object('page',v_page,'pageSize',v_page_size,'total',0,'items','[]'::jsonb,'summary','{}'::jsonb); END IF;
 v_offset:=(v_page-1)*v_page_size;v_channel_id:=public.queue_review_channel_id(v_channel);
 IF v_channel='whatsapp' THEN SELECT c.chips_id,coalesce(nullif(btrim(c.chips_name),''),i.instances_name,c.chips_id::text),coalesce(i.instances_name,'') INTO v_resource_id,v_resource_label,v_instance_name FROM public.chips c JOIN public.instances i ON i.instances_id=c.instances_id AND i.users_id=c.users_id WHERE c.users_id=v_user AND(c.chips_id::text=v_key OR lower(btrim(coalesce(c.chips_name,'')))=v_key OR lower(btrim(coalesce(i.instances_name,'')))=v_key) ORDER BY c.chips_id LIMIT 1;
 ELSE SELECT so.socials_id,coalesce(nullif(btrim(so.socials_name),''),concat('@',regexp_replace(coalesce(so.socials_username,''),'^@','','g')),so.socials_id::text),regexp_replace(coalesce(so.socials_username,''),'^@','','g') INTO v_resource_id,v_resource_label,v_profile_username FROM public.socials so WHERE so.users_id=v_user AND(so.socials_id::text=v_key OR lower(btrim(coalesce(so.socials_name,'')))=v_key OR lower(regexp_replace(btrim(coalesce(so.socials_username,'')),'^@','','g'))=regexp_replace(v_key,'^@','','g')) ORDER BY so.socials_id LIMIT 1; END IF;
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
 ), counted AS(SELECT count(*)::integer total FROM effective), page_rows AS(SELECT * FROM effective ORDER BY position,id LIMIT v_page_size OFFSET v_offset)
 SELECT c.total,coalesce(jsonb_agg(to_jsonb(p)-'status_key'-'effective_status' ORDER BY p.position,p.id) FILTER(WHERE p.id IS NOT NULL),'[]'::jsonb),
        (SELECT CASE WHEN v_channel='whatsapp' THEN jsonb_build_object('total',count(*)::integer,'queued',count(*) FILTER(WHERE effective_status IN('queued','paused','sending'))::integer,'sent',count(*) FILTER(WHERE effective_status='sent')::integer,'finished',count(*) FILTER(WHERE effective_status IN('sent','invalid'))::integer,'errors',count(*) FILTER(WHERE effective_status='error')::integer)
                     ELSE jsonb_build_object('total',count(*)::integer,'queued',count(*) FILTER(WHERE effective_status IN('queued','paused','following','dm_opened'))::integer,'sent',count(*) FILTER(WHERE effective_status='sent')::integer,'errors',count(*) FILTER(WHERE effective_status IN('error','reconciliation_required'))::integer,'invalid',count(*) FILTER(WHERE effective_status='invalid')::integer) END FROM effective)
 INTO v_total,v_items,v_summary FROM counted c LEFT JOIN page_rows p ON true GROUP BY c.total;
 RETURN jsonb_build_object('contractVersion','R59','page',v_page,'pageSize',v_page_size,'total',coalesce(v_total,0),'items',coalesce(v_items,'[]'::jsonb),'summary',coalesce(v_summary,'{}'::jsonb));
END;$function$;

CREATE OR REPLACE FUNCTION public.queue_final_retryable_ids_r59(p_channel text,p_resource_key text,p_scheduled_date date)
RETURNS bigint[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog','public' AS $function$
DECLARE v_org bigint:=public.current_organization_id();v_user bigint:=public.ensure_current_user();v_channel text:=lower(trim(coalesce(p_channel,'')));v_key text:=lower(trim(coalesce(p_resource_key,'')));v_channel_id bigint;v_resource_id bigint;v_ids bigint[]:='{}'::bigint[];
BEGIN
 PERFORM public.require_organization_permission('queues.control'); IF v_channel NOT IN('whatsapp','instagram') OR v_key='' OR p_scheduled_date IS NULL THEN RETURN v_ids; END IF;v_channel_id:=public.queue_review_channel_id(v_channel);
 IF v_channel='whatsapp' THEN SELECT c.chips_id INTO v_resource_id FROM public.chips c JOIN public.instances i ON i.instances_id=c.instances_id AND i.users_id=c.users_id WHERE c.users_id=v_user AND(c.chips_id::text=v_key OR lower(btrim(coalesce(c.chips_name,'')))=v_key OR lower(btrim(coalesce(i.instances_name,'')))=v_key) ORDER BY c.chips_id LIMIT 1;
 ELSE SELECT so.socials_id INTO v_resource_id FROM public.socials so WHERE so.users_id=v_user AND(so.socials_id::text=v_key OR lower(btrim(coalesce(so.socials_name,'')))=v_key OR lower(regexp_replace(btrim(coalesce(so.socials_username,'')),'^@','','g'))=regexp_replace(v_key,'^@','','g')) ORDER BY so.socials_id LIMIT 1; END IF;
 IF v_resource_id IS NULL THEN RETURN v_ids; END IF;
 SELECT coalesce(array_agg(qi.queue_items_id ORDER BY qi.queue_items_position,qi.queue_items_id),'{}'::bigint[]) INTO v_ids
 FROM public.queue_items qi JOIN public.queues q ON q.queues_id=qi.queues_id AND q.users_id=qi.users_id JOIN public.status s ON s.status_id=qi.status_id
 LEFT JOIN public.instagram_queue_progress ip ON v_channel='instagram' AND ip.queue_items_id=qi.queue_items_id
 WHERE qi.organizations_id=v_org AND qi.users_id=v_user AND q.organizations_id=v_org AND q.channels_id=v_channel_id AND CASE WHEN v_channel='whatsapp' THEN qi.chips_id ELSE qi.socials_id END=v_resource_id
   AND(coalesce(qi.queue_items_scheduled_at,q.queues_scheduled_at) AT TIME ZONE 'UTC')::date=p_scheduled_date
   AND (regexp_replace(lower(public.unaccent(trim(s.status_name))), '[^a-z0-9]+','','g') IN('erro','error','failed')
        OR (v_channel='instagram' AND coalesce(ip.step,'')='reconciliation_required'));
 RETURN coalesce(v_ids,'{}'::bigint[]);
END;$function$;

COMMIT;
