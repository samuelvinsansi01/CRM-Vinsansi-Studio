BEGIN;

-- ETAPA 9 — Vinsansi Instagram executor oficial.

DO $stage_preflight$
DECLARE v_missing text[]:=ARRAY[]::text[]; v_name text;
BEGIN
  FOREACH v_name IN ARRAY ARRAY['tool_browser_pairings','instagram_queue_progress','organization_tool_installations'] LOOP IF to_regclass('public.'||v_name) IS NULL THEN v_missing:=array_append(v_missing,'table:'||v_name);END IF;END LOOP;
  IF cardinality(v_missing)>0 THEN RAISE EXCEPTION 'stage_preflight_failed:%',array_to_string(v_missing,',');END IF;
END
$stage_preflight$;

UPDATE public.platform_tools
SET display_name='Vinsansi Instagram',
    description='Executor oficial outbound Instagram com fila canonica, claim transacional, progresso por etapa, idempotencia, limites e recuperacao segura.',
    latest_version='2.0.2',minimum_supported_version='2.0.0',settings_schema_version=2,
    capability_catalog=ARRAY['settings.read','presence.heartbeat','activity.report','organization.context','member.context','instagram.queue.execute','instagram.dm.send','instagram.media.send','instagram.result.report','instagram.checkpoint','instagram.profile.bound'],
    settings_schema='{"type":"object","required":["instagram"]}'::jsonb,
    updated_at=now()
WHERE tool_id='vinsansi_instagram';
UPDATE public.organization_tool_settings SET settings_schema_version=2,settings_version=settings_version+1,updated_at=now() WHERE tool_id='vinsansi_instagram';

ALTER TABLE public.instagram_queue_progress
  ADD COLUMN IF NOT EXISTS organizations_id bigint,
  ADD COLUMN IF NOT EXISTS organization_tool_installations_id uuid REFERENCES public.organization_tool_installations(organization_tool_installations_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS dispatched_by_member_id bigint REFERENCES public.organization_members(organization_members_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS profile_username text,
  ADD COLUMN IF NOT EXISTS frozen_payload_hash text,
  ADD COLUMN IF NOT EXISTS canonical_step text;
ALTER TABLE public.instagram_queue_progress DROP CONSTRAINT IF EXISTS instagram_queue_progress_step_check;
ALTER TABLE public.instagram_queue_progress ADD CONSTRAINT instagram_queue_progress_step_check CHECK(step IN ('queued','claimed','profile_opened','opening_profile','following','followed','dm_opened','opening_dm','messages_sending','media_sending','sending','sent','completed','invalid','error','reconciliation_required'));

ALTER TABLE public.instagram_dispatch_events
  ADD COLUMN IF NOT EXISTS organizations_id bigint,
  ADD COLUMN IF NOT EXISTS organization_tool_installations_id uuid REFERENCES public.organization_tool_installations(organization_tool_installations_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS organization_members_id bigint REFERENCES public.organization_members(organization_members_id) ON DELETE SET NULL;

UPDATE public.instagram_queue_progress p SET organizations_id=qi.organizations_id FROM public.queue_items qi WHERE p.organizations_id IS NULL AND qi.queue_items_id=p.queue_items_id;
UPDATE public.instagram_dispatch_events e SET organizations_id=qi.organizations_id FROM public.queue_items qi WHERE e.organizations_id IS NULL AND qi.queue_items_id=e.queue_items_id;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.instagram_queue_progress WHERE organizations_id IS NULL) THEN RAISE EXCEPTION 'instagram_progress_organization_backfill_incomplete'; END IF;
 IF EXISTS(SELECT 1 FROM public.instagram_dispatch_events WHERE organizations_id IS NULL) THEN RAISE EXCEPTION 'instagram_events_organization_backfill_incomplete'; END IF;
END $$;
ALTER TABLE public.instagram_queue_progress ALTER COLUMN organizations_id SET NOT NULL;
ALTER TABLE public.instagram_dispatch_events ALTER COLUMN organizations_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS instagram_progress_org_profile_idx ON public.instagram_queue_progress(organizations_id,profile_username,step,instagram_queue_progress_updated_at DESC);
CREATE INDEX IF NOT EXISTS instagram_events_org_item_idx ON public.instagram_dispatch_events(organizations_id,queue_items_id,created_at DESC);

-- Alias canônico de etapas, preservando leitura de releases anteriores.
UPDATE public.instagram_queue_progress SET canonical_step=CASE step
 WHEN 'profile_opened' THEN 'opening_profile' WHEN 'dm_opened' THEN 'opening_dm'
 WHEN 'messages_sending' THEN 'sending' WHEN 'media_sending' THEN 'sending'
 WHEN 'sent' THEN 'completed' WHEN 'invalid' THEN 'error' ELSE step END
WHERE canonical_step IS NULL;

CREATE OR REPLACE FUNCTION public.instagram_canonical_step(p_step text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE lower(trim(coalesce(p_step,'')))
  WHEN 'profile_opened' THEN 'opening_profile' WHEN 'opening_profile' THEN 'opening_profile'
  WHEN 'dm_opened' THEN 'opening_dm' WHEN 'opening_dm' THEN 'opening_dm'
  WHEN 'messages_sending' THEN 'sending' WHEN 'media_sending' THEN 'sending' WHEN 'sending' THEN 'sending'
  WHEN 'sent' THEN 'completed' WHEN 'completed' THEN 'completed'
  WHEN 'invalid' THEN 'error' ELSE lower(trim(coalesce(p_step,''))) END;
$$;

-- Estado diario por perfil: limites nao se misturam entre contas.
CREATE TABLE IF NOT EXISTS public.instagram_profile_runtime (
 instagram_profile_runtime_id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
 organizations_id bigint NOT NULL REFERENCES public.organizations(organizations_id) ON DELETE RESTRICT,
 socials_id bigint NOT NULL REFERENCES public.socials(socials_id) ON DELETE CASCADE,
 organization_tool_installations_id uuid REFERENCES public.organization_tool_installations(organization_tool_installations_id) ON DELETE SET NULL,
 profile_username text NOT NULL,
 operational_date date NOT NULL,
 claimed_count integer NOT NULL DEFAULT 0 CHECK(claimed_count>=0),
 sent_count integer NOT NULL DEFAULT 0 CHECK(sent_count>=0),
 invalid_count integer NOT NULL DEFAULT 0 CHECK(invalid_count>=0),
 error_count integer NOT NULL DEFAULT 0 CHECK(error_count>=0),
 last_claim_at timestamptz,last_send_at timestamptz,last_heartbeat_at timestamptz,
 runtime_status text NOT NULL DEFAULT 'online' CHECK(runtime_status IN ('online','paused','offline','error','limit_reached')),
 metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organizations_id,socials_id,operational_date)
);
CREATE INDEX IF NOT EXISTS instagram_profile_runtime_health_idx ON public.instagram_profile_runtime(organizations_id,operational_date,last_heartbeat_at DESC);
ALTER TABLE public.instagram_profile_runtime ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS instagram_profile_runtime_org_select ON public.instagram_profile_runtime;
CREATE POLICY instagram_profile_runtime_org_select ON public.instagram_profile_runtime FOR SELECT TO authenticated USING(organizations_id=public.current_organization_id() AND public.has_organization_permission('instagram.view'));
REVOKE INSERT,UPDATE,DELETE ON public.instagram_profile_runtime FROM anon,authenticated;
GRANT SELECT ON public.instagram_profile_runtime TO authenticated;
GRANT ALL ON public.instagram_profile_runtime TO service_role;

CREATE OR REPLACE FUNCTION public.instagram_profile_capacity(
 p_organizations_id bigint,p_socials_id bigint,p_now timestamptz DEFAULT now()
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO pg_catalog,public AS $$
DECLARE v_settings jsonb;v_cfg jsonb;v_limit integer;v_sent integer;v_profile text;v_date date;v_timezone text:='America/Sao_Paulo';v_start time;v_end time;v_local timestamp;v_day text;v_days jsonb;
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
 SELECT s.socials_username INTO v_profile FROM public.socials s WHERE s.socials_id=p_socials_id AND s.organizations_id=p_organizations_id AND s.status_id=1;
 IF v_profile IS NULL THEN RAISE EXCEPTION 'instagram_profile_not_available'; END IF;
 SELECT coalesce(ots.settings,pt.default_settings) INTO v_settings FROM public.platform_tools pt LEFT JOIN public.organization_tool_settings ots ON ots.organizations_id=p_organizations_id AND ots.tool_id=pt.tool_id WHERE pt.tool_id='vinsansi_instagram';
 v_cfg:=coalesce(v_settings->'instagram','{}'::jsonb);v_limit:=greatest(0,coalesce((v_cfg->>'dailyLimit')::integer,60));v_start:=coalesce(nullif(v_cfg->>'startTime','')::time,'00:00'::time);v_end:=coalesce(nullif(v_cfg->>'endTime','')::time,'23:59:59'::time);v_days:=coalesce(v_cfg->'activeDays','[]'::jsonb);
 v_local:=p_now AT TIME ZONE v_timezone;v_date:=v_local::date;v_day:=CASE extract(isodow from v_local)::int WHEN 1 THEN 'Segunda' WHEN 2 THEN 'Terca' WHEN 3 THEN 'Quarta' WHEN 4 THEN 'Quinta' WHEN 5 THEN 'Sexta' WHEN 6 THEN 'Sabado' ELSE 'Domingo' END;
 SELECT coalesce(r.sent_count,0) INTO v_sent FROM public.instagram_profile_runtime r WHERE r.organizations_id=p_organizations_id AND r.socials_id=p_socials_id AND r.operational_date=v_date;
 RETURN jsonb_build_object('allowed',coalesce(v_days?'Todos',false) OR coalesce(v_days?v_day,false),'withinWindow',v_local::time BETWEEN v_start AND v_end,'dailyLimit',v_limit,'sentToday',coalesce(v_sent,0),'remaining',greatest(v_limit-coalesce(v_sent,0),0),'profile',v_profile,'operationalDate',v_date);
END; $$;
REVOKE ALL ON FUNCTION public.instagram_profile_capacity(bigint,bigint,timestamptz) FROM PUBLIC,anon,authenticated;GRANT EXECUTE ON FUNCTION public.instagram_profile_capacity(bigint,bigint,timestamptz) TO service_role;

-- Claim tenant-aware e vinculado à instalação/perfil.
CREATE OR REPLACE FUNCTION public.instagram_claim_queue_item_v2(
 p_organizations_id bigint,p_queue_item_id bigint,p_socials_id bigint,p_consumer_id text,p_installation_id uuid,p_member_id bigint
) RETURNS TABLE(queue_items_id bigint,claim_token uuid,step text,attempts integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_item public.queue_items%ROWTYPE;v_existing public.instagram_queue_progress%ROWTYPE;v_token uuid:=gen_random_uuid();v_attempts integer;v_users bigint;v_profile text;v_capacity jsonb;
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
 IF nullif(trim(coalesce(p_consumer_id,'')),'') IS NULL THEN RAISE EXCEPTION 'consumer_id_required'; END IF;
 SELECT * INTO v_item FROM public.queue_items qi WHERE qi.queue_items_id=p_queue_item_id AND qi.organizations_id=p_organizations_id AND qi.socials_id=p_socials_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'instagram_queue_item_not_found'; END IF;v_users:=v_item.users_id;
 IF NOT EXISTS(SELECT 1 FROM public.organization_tool_installations i WHERE i.organization_tool_installations_id=p_installation_id AND i.organizations_id=p_organizations_id AND i.tool_id='vinsansi_instagram' AND i.registration_status='registered') THEN RAISE EXCEPTION 'instagram_installation_invalid'; END IF;
 IF p_member_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.organization_members m WHERE m.organization_members_id=p_member_id AND m.organizations_id=p_organizations_id AND m.status_id=1) THEN RAISE EXCEPTION 'instagram_member_invalid'; END IF;
 SELECT socials_username INTO v_profile FROM public.socials WHERE socials_id=p_socials_id AND organizations_id=p_organizations_id AND status_id=1;IF v_profile IS NULL THEN RAISE EXCEPTION 'instagram_profile_not_available'; END IF;
 v_capacity:=public.instagram_profile_capacity(p_organizations_id,p_socials_id,now());IF coalesce((v_capacity->>'allowed')::boolean,false)=false OR coalesce((v_capacity->>'withinWindow')::boolean,false)=false THEN RAISE EXCEPTION 'instagram_outside_operational_window'; END IF;IF coalesce((v_capacity->>'remaining')::integer,0)<=0 THEN RAISE EXCEPTION 'instagram_daily_limit_reached'; END IF;
 SELECT * INTO v_existing FROM public.instagram_queue_progress p WHERE p.queue_items_id=p_queue_item_id FOR UPDATE;
 IF FOUND AND public.instagram_canonical_step(v_existing.step) IN ('completed','reconciliation_required') THEN RAISE EXCEPTION 'instagram_item_not_claimable:%',v_existing.step; END IF;
 IF v_item.status_id NOT IN(3,6) THEN RAISE EXCEPTION 'instagram_item_not_pending:%',v_item.status_id; END IF;
 v_attempts:=coalesce(v_existing.attempts,0)+1;
 INSERT INTO public.instagram_queue_progress(users_id,organizations_id,queue_items_id,socials_id,step,canonical_step,claim_token,claimed_by,attempts,last_heartbeat_at,started_at,finished_at,error_message,metadata,organization_tool_installations_id,dispatched_by_member_id,profile_username,frozen_payload_hash)
 VALUES(v_users,p_organizations_id,p_queue_item_id,p_socials_id,'claimed','claimed',v_token,trim(p_consumer_id),v_attempts,now(),coalesce(v_existing.started_at,now()),NULL,NULL,'{}',p_installation_id,p_member_id,v_profile,v_item.queue_items_payload_hash)
 ON CONFLICT(queue_items_id) DO UPDATE SET organizations_id=excluded.organizations_id,socials_id=excluded.socials_id,step='claimed',canonical_step='claimed',claim_token=excluded.claim_token,claimed_by=excluded.claimed_by,attempts=excluded.attempts,last_heartbeat_at=now(),started_at=coalesce(public.instagram_queue_progress.started_at,now()),finished_at=NULL,error_message=NULL,organization_tool_installations_id=excluded.organization_tool_installations_id,dispatched_by_member_id=excluded.dispatched_by_member_id,profile_username=excluded.profile_username,frozen_payload_hash=excluded.frozen_payload_hash,instagram_queue_progress_updated_at=now()
 RETURNING public.instagram_queue_progress.claim_token,public.instagram_queue_progress.attempts INTO v_token,v_attempts;
 UPDATE public.queue_items SET status_id=4,dispatched_by_member_id=coalesce(dispatched_by_member_id,p_member_id),queue_items_started_at=coalesce(queue_items_started_at,now()),queue_items_finished_at=NULL,queue_items_error_message=NULL,queue_items_updated_at=now() WHERE public.queue_items.queue_items_id=p_queue_item_id;
 INSERT INTO public.instagram_profile_runtime(organizations_id,socials_id,organization_tool_installations_id,profile_username,operational_date,claimed_count,last_claim_at,last_heartbeat_at) VALUES(p_organizations_id,p_socials_id,p_installation_id,v_profile,(now() AT TIME ZONE 'America/Sao_Paulo')::date,1,now(),now()) ON CONFLICT(organizations_id,socials_id,operational_date) DO UPDATE SET claimed_count=public.instagram_profile_runtime.claimed_count+1,last_claim_at=now(),last_heartbeat_at=now(),organization_tool_installations_id=excluded.organization_tool_installations_id,updated_at=now();
 INSERT INTO public.instagram_dispatch_events(users_id,organizations_id,queue_items_id,socials_id,from_step,to_step,claim_token,actor,metadata,organization_tool_installations_id,organization_members_id) VALUES(v_users,p_organizations_id,p_queue_item_id,p_socials_id,coalesce(v_existing.step,'queued'),'claimed',v_token,p_consumer_id,jsonb_build_object('attempt',v_attempts,'profile',v_profile),p_installation_id,p_member_id);
 RETURN QUERY SELECT p_queue_item_id,v_token,'claimed'::text,v_attempts;
END; $$;

CREATE OR REPLACE FUNCTION public.instagram_update_queue_progress_v2(
 p_organizations_id bigint,p_queue_item_id bigint,p_claim_token uuid,p_step text,p_message text DEFAULT NULL,p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS TABLE(queue_items_id bigint,step text,queue_status_id bigint,lead_status_id bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_progress public.instagram_queue_progress%ROWTYPE;v_item public.queue_items%ROWTYPE;v_canonical text:=public.instagram_canonical_step(p_step);v_queue bigint:=4;v_lead bigint;v_final boolean:=false;v_previous text;
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
 IF NOT v_canonical=ANY(ARRAY['claimed','opening_profile','following','followed','opening_dm','sending','completed','error','reconciliation_required']) THEN RAISE EXCEPTION 'instagram_step_invalid:%',p_step; END IF;
 SELECT * INTO v_progress FROM public.instagram_queue_progress WHERE queue_items_id=p_queue_item_id AND organizations_id=p_organizations_id FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'instagram_progress_not_found';END IF;IF v_progress.claim_token IS DISTINCT FROM p_claim_token THEN RAISE EXCEPTION 'instagram_claim_token_invalid';END IF;v_previous:=v_progress.step;
 IF public.instagram_canonical_step(v_progress.step) IN('completed','reconciliation_required') AND public.instagram_canonical_step(v_progress.step)<>v_canonical THEN RAISE EXCEPTION 'instagram_progress_final:%',v_progress.step; END IF;
 SELECT * INTO v_item FROM public.queue_items WHERE queue_items_id=p_queue_item_id AND organizations_id=p_organizations_id FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'instagram_queue_item_not_found';END IF;
 IF v_canonical='completed' THEN v_queue:=5;v_lead:=5;v_final:=true;ELSIF v_canonical='error' THEN v_queue:=6;v_lead:=CASE WHEN p_step='invalid' THEN 6 ELSE NULL END;v_final:=true;ELSIF v_canonical='reconciliation_required' THEN v_queue:=6;v_final:=true;END IF;
 UPDATE public.instagram_queue_progress SET step=p_step,canonical_step=v_canonical,last_heartbeat_at=now(),finished_at=CASE WHEN v_final THEN now() ELSE NULL END,error_message=CASE WHEN v_canonical IN('error','reconciliation_required') THEN nullif(trim(coalesce(p_message,'')),'') ELSE NULL END,metadata=coalesce(metadata,'{}')||coalesce(p_metadata,'{}'),instagram_queue_progress_updated_at=now() WHERE instagram_queue_progress_id=v_progress.instagram_queue_progress_id;
 UPDATE public.queue_items SET status_id=v_queue,queue_items_updated_at=now(),queue_items_finished_at=CASE WHEN v_final THEN now() ELSE NULL END,queue_items_error_message=CASE WHEN v_canonical IN('error','reconciliation_required') THEN nullif(trim(coalesce(p_message,'')),'') ELSE NULL END WHERE public.queue_items.queue_items_id=p_queue_item_id;
 IF v_lead IS NOT NULL THEN UPDATE public.leads SET lead_status_id=v_lead,leads_updated_at=now() WHERE leads_id=v_item.leads_id AND organizations_id=p_organizations_id AND lead_status_id=4; END IF;
 INSERT INTO public.instagram_dispatch_events(users_id,organizations_id,queue_items_id,socials_id,from_step,to_step,claim_token,actor,message,metadata,organization_tool_installations_id,organization_members_id) VALUES(v_item.users_id,p_organizations_id,p_queue_item_id,v_progress.socials_id,v_previous,p_step,p_claim_token,v_progress.claimed_by,p_message,coalesce(p_metadata,'{}'),v_progress.organization_tool_installations_id,v_progress.dispatched_by_member_id);
 IF v_final THEN INSERT INTO public.instagram_profile_runtime(organizations_id,socials_id,organization_tool_installations_id,profile_username,operational_date,sent_count,invalid_count,error_count,last_send_at,last_heartbeat_at) VALUES(p_organizations_id,v_progress.socials_id,v_progress.organization_tool_installations_id,coalesce(v_progress.profile_username,''),(now() AT TIME ZONE 'America/Sao_Paulo')::date,CASE WHEN v_canonical='completed' THEN 1 ELSE 0 END,CASE WHEN p_step='invalid' THEN 1 ELSE 0 END,CASE WHEN v_canonical IN('error','reconciliation_required') AND p_step<>'invalid' THEN 1 ELSE 0 END,CASE WHEN v_canonical='completed' THEN now() ELSE NULL END,now()) ON CONFLICT(organizations_id,socials_id,operational_date) DO UPDATE SET sent_count=public.instagram_profile_runtime.sent_count+excluded.sent_count,invalid_count=public.instagram_profile_runtime.invalid_count+excluded.invalid_count,error_count=public.instagram_profile_runtime.error_count+excluded.error_count,last_send_at=coalesce(excluded.last_send_at,public.instagram_profile_runtime.last_send_at),last_heartbeat_at=now(),updated_at=now(); END IF;
 RETURN QUERY SELECT p_queue_item_id,p_step,v_queue,coalesce(v_lead,4::bigint);
END; $$;
REVOKE ALL ON FUNCTION public.instagram_claim_queue_item_v2(bigint,bigint,bigint,text,uuid,bigint) FROM PUBLIC,anon,authenticated;GRANT EXECUTE ON FUNCTION public.instagram_claim_queue_item_v2(bigint,bigint,bigint,text,uuid,bigint) TO service_role;
REVOKE ALL ON FUNCTION public.instagram_update_queue_progress_v2(bigint,bigint,uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated;GRANT EXECUTE ON FUNCTION public.instagram_update_queue_progress_v2(bigint,bigint,uuid,text,text,jsonb) TO service_role;

-- RLS por tenant nas tabelas de progresso.
ALTER TABLE public.instagram_queue_progress ENABLE ROW LEVEL SECURITY;ALTER TABLE public.instagram_dispatch_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS instagram_queue_progress_own_select ON public.instagram_queue_progress;DROP POLICY IF EXISTS instagram_queue_progress_org_select ON public.instagram_queue_progress;CREATE POLICY instagram_queue_progress_org_select ON public.instagram_queue_progress FOR SELECT TO authenticated USING(organizations_id=public.current_organization_id() AND public.has_organization_permission('instagram.view'));
DROP POLICY IF EXISTS instagram_dispatch_events_own_select ON public.instagram_dispatch_events;DROP POLICY IF EXISTS instagram_dispatch_events_org_select ON public.instagram_dispatch_events;CREATE POLICY instagram_dispatch_events_org_select ON public.instagram_dispatch_events FOR SELECT TO authenticated USING(organizations_id=public.current_organization_id() AND public.has_organization_permission('instagram.view'));

COMMIT;
