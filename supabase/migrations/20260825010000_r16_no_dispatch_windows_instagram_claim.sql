BEGIN;

-- R16: canais de disparo nao possuem janela de horario/dias ativos.
-- Limites diarios, lotes e delays permanecem ativos.
CREATE OR REPLACE FUNCTION public.validate_tool_settings(p_tool_id text,p_settings jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE v_dispatch jsonb;
BEGIN
  IF jsonb_typeof(p_settings)<>'object' OR public.tool_json_contains_secret(p_settings) THEN RETURN false; END IF;
  IF p_tool_id='vinsansi_capture' THEN
    RETURN jsonb_typeof(p_settings->'safeMode')='object'
       AND jsonb_typeof(p_settings->'instagramLowRating')='object'
       AND jsonb_typeof(p_settings->'branchRules')='array'
       AND jsonb_typeof(p_settings->'deduplication')='object'
       AND jsonb_typeof(p_settings->'routes')='object'
       AND jsonb_typeof(p_settings->'logs')='object'
       AND jsonb_typeof(p_settings->'minRating')='number'
       AND jsonb_typeof(p_settings->'minReviews')='number'
       AND jsonb_typeof(p_settings->'safeMode'->'simulationMode')='boolean'
       AND jsonb_typeof(p_settings->'instagramLowRating'->'enabled')='boolean'
       AND jsonb_typeof(p_settings->'instagramLowRating'->'minRating')='number'
       AND jsonb_typeof(p_settings->'instagramLowRating'->'maxRatingExclusive')='number'
       AND jsonb_typeof(p_settings->'instagramLowRating'->'minReviews')='number'
       AND jsonb_typeof(p_settings->'deduplication'->'enabled')='boolean'
       AND jsonb_typeof(p_settings->'routes'->'whatsapp')='boolean'
       AND jsonb_typeof(p_settings->'logs'->'enabled')='boolean';
  ELSIF p_tool_id='vinsansi_instagram' THEN
    v_dispatch:=p_settings->'instagram';
    RETURN jsonb_typeof(v_dispatch)='object'
       AND jsonb_typeof(v_dispatch->'profiles')='array'
       AND jsonb_typeof(v_dispatch->'profile')='string'
       AND jsonb_typeof(v_dispatch->'delayMinSeconds')='number'
       AND jsonb_typeof(v_dispatch->'delayMaxSeconds')='number'
       AND jsonb_typeof(v_dispatch->'perBatch')='number'
       AND jsonb_typeof(v_dispatch->'batches')='number'
       AND jsonb_typeof(v_dispatch->'batchDelayMinutes')='number'
       AND jsonb_typeof(v_dispatch->'delayMinutes')='number'
       AND jsonb_typeof(v_dispatch->'dailyLimit')='number'
       AND jsonb_typeof(v_dispatch->'batchBehavior')='string';
  ELSIF p_tool_id='vinsansi_whatsapp_manager' THEN
    v_dispatch:=p_settings->'whatsapp';
    RETURN jsonb_typeof(v_dispatch)='object'
       AND jsonb_typeof(v_dispatch->'delayMinSeconds')='number'
       AND jsonb_typeof(v_dispatch->'delayMaxSeconds')='number'
       AND jsonb_typeof(v_dispatch->'perBatch')='number'
       AND jsonb_typeof(v_dispatch->'batches')='number'
       AND jsonb_typeof(v_dispatch->'batchDelayMinutes')='number'
       AND jsonb_typeof(v_dispatch->'dailyLimit')='number'
       AND jsonb_typeof(v_dispatch->'batchBehavior')='string'
       AND jsonb_typeof(p_settings->'chipLevels')='object';
  END IF;
  RETURN false;
EXCEPTION WHEN others THEN
  RETURN false;
END;
$$;

-- Atualiza o contrato de configuracao: sem campos de horario/dias ativos.
UPDATE public.platform_tools
SET settings_schema_version=2,
    settings_schema='{"type":"object","required":["instagram"]}'::jsonb,
    latest_version='2.0.4',
    minimum_supported_version='2.0.4'
WHERE tool_id='vinsansi_instagram';

UPDATE public.platform_tools
SET settings_schema_version=2,
    settings_schema='{"type":"object","required":["whatsapp","chipLevels"]}'::jsonb,
    latest_version='1.3.2',
    minimum_supported_version='1.3.2'
WHERE tool_id='vinsansi_whatsapp_manager';

-- Remove configuracoes antigas de horario dos defaults oficiais.
UPDATE public.platform_tools
SET default_settings = jsonb_set(
  default_settings,
  '{instagram}',
  ((coalesce(default_settings->'instagram','{}'::jsonb) - 'startTime' - 'endTime' - 'activeDays')
    || jsonb_build_object('batchBehavior','Respeitar lotes e limites')),
  true
)
WHERE tool_id='vinsansi_instagram';

UPDATE public.platform_tools
SET default_settings = (jsonb_set(
  default_settings,
  '{whatsapp}',
  ((coalesce(default_settings->'whatsapp','{}'::jsonb) - 'startTime' - 'endTime' - 'activeDays')
    || jsonb_build_object('batchBehavior','Respeitar lotes e limites')),
  true
) - 'operationalCutoffHour')
WHERE tool_id='vinsansi_whatsapp_manager';

-- Remove as mesmas chaves das configuracoes ja salvas por organizacao.
UPDATE public.organization_tool_settings
SET settings = jsonb_set(
  settings,
  '{instagram}',
  ((coalesce(settings->'instagram','{}'::jsonb) - 'startTime' - 'endTime' - 'activeDays')
    || jsonb_build_object('batchBehavior','Respeitar lotes e limites')),
  true
)
WHERE tool_id='vinsansi_instagram';

UPDATE public.organization_tool_settings
SET settings = (jsonb_set(
  settings,
  '{whatsapp}',
  ((coalesce(settings->'whatsapp','{}'::jsonb) - 'startTime' - 'endTime' - 'activeDays')
    || jsonb_build_object('batchBehavior','Respeitar lotes e limites')),
  true
) - 'operationalCutoffHour')
WHERE tool_id='vinsansi_whatsapp_manager';

-- Capacidade Instagram passa a considerar apenas limite diario, nunca horario/dia da semana.
CREATE OR REPLACE FUNCTION public.instagram_profile_capacity(
 p_organizations_id bigint,p_socials_id bigint,p_now timestamptz DEFAULT now()
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO pg_catalog,public AS $$
DECLARE
  v_settings jsonb;
  v_cfg jsonb;
  v_limit integer;
  v_sent integer;
  v_profile text;
  v_date date;
  v_timezone text:='America/Sao_Paulo';
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
 SELECT s.socials_username INTO v_profile
 FROM public.socials s
 WHERE s.socials_id=p_socials_id AND s.organizations_id=p_organizations_id AND s.status_id=1;
 IF v_profile IS NULL THEN RAISE EXCEPTION 'instagram_profile_not_available'; END IF;
 SELECT coalesce(ots.settings,pt.default_settings) INTO v_settings
 FROM public.platform_tools pt
 LEFT JOIN public.organization_tool_settings ots
   ON ots.organizations_id=p_organizations_id AND ots.tool_id=pt.tool_id
 WHERE pt.tool_id='vinsansi_instagram';
 v_cfg:=coalesce(v_settings->'instagram','{}'::jsonb);
 v_limit:=greatest(0,coalesce((v_cfg->>'dailyLimit')::integer,60));
 v_date:=(p_now AT TIME ZONE v_timezone)::date;
 SELECT coalesce(r.sent_count,0) INTO v_sent
 FROM public.instagram_profile_runtime r
 WHERE r.organizations_id=p_organizations_id AND r.socials_id=p_socials_id AND r.operational_date=v_date;
 RETURN jsonb_build_object(
   'allowed',true,
   'withinWindow',true,
   'dailyLimit',v_limit,
   'sentToday',coalesce(v_sent,0),
   'remaining',greatest(v_limit-coalesce(v_sent,0),0),
   'profile',v_profile,
   'operationalDate',v_date
 );
END; $$;
REVOKE ALL ON FUNCTION public.instagram_profile_capacity(bigint,bigint,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.instagram_profile_capacity(bigint,bigint,timestamptz) TO service_role;

-- Claim Instagram: sem janela operacional e sem ambiguidade de queue_items_id.
CREATE OR REPLACE FUNCTION public.instagram_claim_queue_item_v2(
 p_organizations_id bigint,p_queue_item_id bigint,p_socials_id bigint,p_consumer_id text,p_installation_id uuid,p_member_id bigint
) RETURNS TABLE(queue_items_id bigint,claim_token uuid,step text,attempts integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE
  v_item public.queue_items%ROWTYPE;
  v_existing public.instagram_queue_progress%ROWTYPE;
  v_token uuid:=gen_random_uuid();
  v_attempts integer;
  v_users bigint;
  v_profile text;
  v_capacity jsonb;
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
 IF nullif(trim(coalesce(p_consumer_id,'')),'') IS NULL THEN RAISE EXCEPTION 'consumer_id_required'; END IF;
 SELECT qi.* INTO v_item
 FROM public.queue_items qi
 WHERE qi.queue_items_id=p_queue_item_id
   AND qi.organizations_id=p_organizations_id
   AND qi.socials_id=p_socials_id
 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'instagram_queue_item_not_found'; END IF;
 v_users:=v_item.users_id;
 IF NOT EXISTS(
   SELECT 1 FROM public.organization_tool_installations i
   WHERE i.organization_tool_installations_id=p_installation_id
     AND i.organizations_id=p_organizations_id
     AND i.tool_id='vinsansi_instagram'
     AND i.registration_status='registered'
 ) THEN RAISE EXCEPTION 'instagram_installation_invalid'; END IF;
 IF p_member_id IS NOT NULL AND NOT EXISTS(
   SELECT 1 FROM public.organization_members m
   WHERE m.organization_members_id=p_member_id
     AND m.organizations_id=p_organizations_id
     AND m.status_id=1
 ) THEN RAISE EXCEPTION 'instagram_member_invalid'; END IF;
 SELECT s.socials_username INTO v_profile
 FROM public.socials s
 WHERE s.socials_id=p_socials_id AND s.organizations_id=p_organizations_id AND s.status_id=1;
 IF v_profile IS NULL THEN RAISE EXCEPTION 'instagram_profile_not_available'; END IF;
 v_capacity:=public.instagram_profile_capacity(p_organizations_id,p_socials_id,now());
 IF coalesce((v_capacity->>'remaining')::integer,0)<=0 THEN RAISE EXCEPTION 'instagram_daily_limit_reached'; END IF;
 SELECT p.* INTO v_existing
 FROM public.instagram_queue_progress p
 WHERE p.queue_items_id=p_queue_item_id
 FOR UPDATE;
 IF FOUND AND public.instagram_canonical_step(v_existing.step) IN ('completed','reconciliation_required') THEN
   RAISE EXCEPTION 'instagram_item_not_claimable:%',v_existing.step;
 END IF;
 IF v_item.status_id NOT IN(3,6) THEN RAISE EXCEPTION 'instagram_item_not_pending:%',v_item.status_id; END IF;
 v_attempts:=coalesce(v_existing.attempts,0)+1;
 INSERT INTO public.instagram_queue_progress(
   users_id,organizations_id,queue_items_id,socials_id,step,canonical_step,claim_token,claimed_by,attempts,
   last_heartbeat_at,started_at,finished_at,error_message,metadata,organization_tool_installations_id,
   dispatched_by_member_id,profile_username,frozen_payload_hash
 ) VALUES(
   v_users,p_organizations_id,p_queue_item_id,p_socials_id,'claimed','claimed',v_token,trim(p_consumer_id),v_attempts,
   now(),coalesce(v_existing.started_at,now()),NULL,NULL,'{}',p_installation_id,p_member_id,v_profile,v_item.queue_items_payload_hash
 )
 ON CONFLICT ON CONSTRAINT instagram_queue_progress_queue_items_id_key
 DO UPDATE SET
   organizations_id=excluded.organizations_id,
   socials_id=excluded.socials_id,
   step='claimed',canonical_step='claimed',claim_token=excluded.claim_token,claimed_by=excluded.claimed_by,
   attempts=excluded.attempts,last_heartbeat_at=now(),
   started_at=coalesce(public.instagram_queue_progress.started_at,now()),finished_at=NULL,error_message=NULL,
   organization_tool_installations_id=excluded.organization_tool_installations_id,
   dispatched_by_member_id=excluded.dispatched_by_member_id,profile_username=excluded.profile_username,
   frozen_payload_hash=excluded.frozen_payload_hash,instagram_queue_progress_updated_at=now()
 RETURNING public.instagram_queue_progress.claim_token,public.instagram_queue_progress.attempts INTO v_token,v_attempts;
 UPDATE public.queue_items qi
 SET status_id=4,
     dispatched_by_member_id=coalesce(qi.dispatched_by_member_id,p_member_id),
     queue_items_started_at=coalesce(qi.queue_items_started_at,now()),
     queue_items_finished_at=NULL,queue_items_error_message=NULL,queue_items_updated_at=now()
 WHERE qi.queue_items_id=p_queue_item_id;
 INSERT INTO public.instagram_profile_runtime(
   organizations_id,socials_id,organization_tool_installations_id,profile_username,operational_date,claimed_count,last_claim_at,last_heartbeat_at
 ) VALUES(
   p_organizations_id,p_socials_id,p_installation_id,v_profile,(now() AT TIME ZONE 'America/Sao_Paulo')::date,1,now(),now()
 ) ON CONFLICT(organizations_id,socials_id,operational_date)
 DO UPDATE SET claimed_count=public.instagram_profile_runtime.claimed_count+1,last_claim_at=now(),last_heartbeat_at=now(),
   organization_tool_installations_id=excluded.organization_tool_installations_id,updated_at=now();
 INSERT INTO public.instagram_dispatch_events(
   users_id,organizations_id,queue_items_id,socials_id,from_step,to_step,claim_token,actor,metadata,
   organization_tool_installations_id,organization_members_id
 ) VALUES(
   v_users,p_organizations_id,p_queue_item_id,p_socials_id,coalesce(v_existing.step,'queued'),'claimed',v_token,p_consumer_id,
   jsonb_build_object('attempt',v_attempts,'profile',v_profile),p_installation_id,p_member_id
 );
 RETURN QUERY SELECT p_queue_item_id,v_token,'claimed'::text,v_attempts;
END; $$;
REVOKE ALL ON FUNCTION public.instagram_claim_queue_item_v2(bigint,bigint,bigint,text,uuid,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.instagram_claim_queue_item_v2(bigint,bigint,bigint,text,uuid,bigint) TO service_role;

-- Progresso Instagram: qualifica colunas que colidiam com nomes de saida RETURNS TABLE.
CREATE OR REPLACE FUNCTION public.instagram_update_queue_progress_v2(
 p_organizations_id bigint,p_queue_item_id bigint,p_claim_token uuid,p_step text,p_message text DEFAULT NULL,p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS TABLE(queue_items_id bigint,step text,queue_status_id bigint,lead_status_id bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE
  v_progress public.instagram_queue_progress%ROWTYPE;
  v_item public.queue_items%ROWTYPE;
  v_canonical text:=public.instagram_canonical_step(p_step);
  v_queue bigint:=4;
  v_lead bigint;
  v_final boolean:=false;
  v_previous text;
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
 IF NOT v_canonical=ANY(ARRAY['claimed','opening_profile','following','followed','opening_dm','sending','completed','error','reconciliation_required']) THEN
   RAISE EXCEPTION 'instagram_step_invalid:%',p_step;
 END IF;
 SELECT p.* INTO v_progress
 FROM public.instagram_queue_progress p
 WHERE p.queue_items_id=p_queue_item_id AND p.organizations_id=p_organizations_id
 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'instagram_progress_not_found'; END IF;
 IF v_progress.claim_token IS DISTINCT FROM p_claim_token THEN RAISE EXCEPTION 'instagram_claim_token_invalid'; END IF;
 v_previous:=v_progress.step;
 IF public.instagram_canonical_step(v_progress.step) IN('completed','reconciliation_required')
    AND public.instagram_canonical_step(v_progress.step)<>v_canonical THEN
   RAISE EXCEPTION 'instagram_progress_final:%',v_progress.step;
 END IF;
 SELECT qi.* INTO v_item
 FROM public.queue_items qi
 WHERE qi.queue_items_id=p_queue_item_id AND qi.organizations_id=p_organizations_id
 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'instagram_queue_item_not_found'; END IF;
 IF v_canonical='completed' THEN
   v_queue:=5;v_lead:=5;v_final:=true;
 ELSIF v_canonical='error' THEN
   v_queue:=6;v_lead:=CASE WHEN p_step='invalid' THEN 6 ELSE NULL END;v_final:=true;
 ELSIF v_canonical='reconciliation_required' THEN
   v_queue:=6;v_final:=true;
 END IF;
 UPDATE public.instagram_queue_progress p
 SET step=p_step,canonical_step=v_canonical,last_heartbeat_at=now(),
     finished_at=CASE WHEN v_final THEN now() ELSE NULL END,
     error_message=CASE WHEN v_canonical IN('error','reconciliation_required') THEN nullif(trim(coalesce(p_message,'')),'') ELSE NULL END,
     metadata=coalesce(p.metadata,'{}')||coalesce(p_metadata,'{}'),instagram_queue_progress_updated_at=now()
 WHERE p.instagram_queue_progress_id=v_progress.instagram_queue_progress_id;
 UPDATE public.queue_items qi
 SET status_id=v_queue,queue_items_updated_at=now(),
     queue_items_finished_at=CASE WHEN v_final THEN now() ELSE NULL END,
     queue_items_error_message=CASE WHEN v_canonical IN('error','reconciliation_required') THEN nullif(trim(coalesce(p_message,'')),'') ELSE NULL END
 WHERE qi.queue_items_id=p_queue_item_id;
 IF v_lead IS NOT NULL THEN
   UPDATE public.leads l SET lead_status_id=v_lead,leads_updated_at=now()
   WHERE l.leads_id=v_item.leads_id AND l.organizations_id=p_organizations_id AND l.lead_status_id=4;
 END IF;
 INSERT INTO public.instagram_dispatch_events(
   users_id,organizations_id,queue_items_id,socials_id,from_step,to_step,claim_token,actor,message,metadata,
   organization_tool_installations_id,organization_members_id
 ) VALUES(
   v_item.users_id,p_organizations_id,p_queue_item_id,v_progress.socials_id,v_previous,p_step,p_claim_token,
   v_progress.claimed_by,p_message,coalesce(p_metadata,'{}'),v_progress.organization_tool_installations_id,v_progress.dispatched_by_member_id
 );
 IF v_final THEN
   INSERT INTO public.instagram_profile_runtime(
     organizations_id,socials_id,organization_tool_installations_id,profile_username,operational_date,
     sent_count,invalid_count,error_count,last_send_at,last_heartbeat_at
   ) VALUES(
     p_organizations_id,v_progress.socials_id,v_progress.organization_tool_installations_id,coalesce(v_progress.profile_username,''),
     (now() AT TIME ZONE 'America/Sao_Paulo')::date,
     CASE WHEN v_canonical='completed' THEN 1 ELSE 0 END,
     CASE WHEN p_step='invalid' THEN 1 ELSE 0 END,
     CASE WHEN v_canonical IN('error','reconciliation_required') AND p_step<>'invalid' THEN 1 ELSE 0 END,
     CASE WHEN v_canonical='completed' THEN now() ELSE NULL END,now()
   ) ON CONFLICT(organizations_id,socials_id,operational_date)
   DO UPDATE SET sent_count=public.instagram_profile_runtime.sent_count+excluded.sent_count,
     invalid_count=public.instagram_profile_runtime.invalid_count+excluded.invalid_count,
     error_count=public.instagram_profile_runtime.error_count+excluded.error_count,
     last_send_at=coalesce(excluded.last_send_at,public.instagram_profile_runtime.last_send_at),last_heartbeat_at=now(),updated_at=now();
 END IF;
 RETURN QUERY SELECT p_queue_item_id,p_step,v_queue,coalesce(v_lead,4::bigint);
END; $$;
REVOKE ALL ON FUNCTION public.instagram_update_queue_progress_v2(bigint,bigint,uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.instagram_update_queue_progress_v2(bigint,bigint,uuid,text,text,jsonb) TO service_role;

-- Matriz de artefatos alinhada ao R16.
UPDATE public.platform_release_channels SET latest_version='1.3.2',minimum_supported_version='1.3.2',updated_at=now() WHERE component_key='manager';
UPDATE public.platform_release_channels SET latest_version='3.13.2',minimum_supported_version='3.13.2',updated_at=now() WHERE component_key='worker';
UPDATE public.platform_release_channels SET latest_version='2.0.4',minimum_supported_version='2.0.4',updated_at=now() WHERE component_key='instagram';
UPDATE public.platform_release_channels SET latest_version='1.0.10',minimum_supported_version='1.0.10',updated_at=now() WHERE component_key='capture';

COMMIT;
