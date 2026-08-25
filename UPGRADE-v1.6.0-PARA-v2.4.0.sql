-- UPGRADE CRM Vinsansi Studio v1.6.0 -> v2.4.0 Release Candidate
-- Cada etapa possui sua própria transação. Em caso de falha, pare e corrija antes de continuar.

-- ======================================================================
-- ETAPA 8
-- ======================================================================
BEGIN;

-- ETAPA 8 — Vinsansi Captura oficial.
-- Remove a ponte Google Maps legada, centraliza pairing/configuracao e garante
-- gate de identidade/supressao antes da promocao de candidatos para leads.

DO $stage_preflight$
DECLARE v_missing text[]:=ARRAY[]::text[]; v_name text;
BEGIN
  FOREACH v_name IN ARRAY ARRAY['lead_identity_registry','contact_suppressions'] LOOP IF to_regclass('public.'||v_name) IS NULL THEN v_missing:=array_append(v_missing,'table:'||v_name);END IF;END LOOP;
  FOREACH v_name IN ARRAY ARRAY['check_lead_identity'] LOOP IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=v_name) THEN v_missing:=array_append(v_missing,'function:'||v_name);END IF;END LOOP;
  IF cardinality(v_missing)>0 THEN RAISE EXCEPTION 'stage_preflight_failed:%',array_to_string(v_missing,',');END IF;
END
$stage_preflight$;

CREATE TABLE IF NOT EXISTS public.tool_browser_pairings (
  tool_browser_pairings_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_id text NOT NULL REFERENCES public.platform_tools(tool_id) ON DELETE RESTRICT,
  external_installation_id text NOT NULL CHECK(length(trim(external_installation_id)) BETWEEN 1 AND 200),
  pairing_secret_hash text NOT NULL CHECK(length(pairing_secret_hash)=64),
  requested_version text,
  requested_capabilities text[] NOT NULL DEFAULT '{}',
  requested_metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(requested_metadata)='object'),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','authorized','consumed','expired','revoked')),
  organizations_id bigint REFERENCES public.organizations(organizations_id) ON DELETE RESTRICT,
  auth_users_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  users_id bigint REFERENCES public.users(users_id) ON DELETE SET NULL,
  organization_members_id bigint REFERENCES public.organization_members(organization_members_id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  authorized_at timestamptz,
  consumed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tool_browser_pairings_version_semver CHECK(public.tool_semver_is_valid(requested_version))
);
CREATE INDEX IF NOT EXISTS tool_browser_pairings_pending_idx ON public.tool_browser_pairings(status,expires_at);
CREATE INDEX IF NOT EXISTS tool_browser_pairings_org_idx ON public.tool_browser_pairings(organizations_id,tool_id,created_at DESC);
ALTER TABLE public.tool_browser_pairings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tool_browser_pairings FROM anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.tool_browser_pairings TO service_role;

DROP TRIGGER IF EXISTS tool_touch_updated_at ON public.tool_browser_pairings;
CREATE TRIGGER tool_touch_updated_at BEFORE UPDATE ON public.tool_browser_pairings
FOR EACH ROW EXECUTE FUNCTION public.tool_touch_updated_at();

-- Contrato oficial da Captura 1.0.0. O antigo 0.x deixa de ser suportado para
-- evitar que uma extensao ainda dependente das tabelas maps_extension_* continue operando.
UPDATE public.platform_tools
SET display_name='Vinsansi Captura',
    description='Executor oficial de aquisicao Google Maps com execucoes persistentes, checkpoint, identidade canonica, supressao e importacao incremental.',
    latest_version='1.0.0', minimum_supported_version='1.0.0', settings_schema_version=2,
    capability_catalog=ARRAY['settings.read','presence.heartbeat','activity.report','organization.context','member.context','capture.maps','capture.website_review','capture.multi_activity','capture.batch_ingestion','capture.checkpoint','capture.diagnostics','capture.incremental_import'],
    settings_schema='{"type":"object","required":["minRating","minReviews","safeMode","instagramLowRating","branchRules","deduplication","routes","logs","checkpoint","diagnostics"]}'::jsonb,
    default_settings=(default_settings || jsonb_build_object(
      'checkpoint',jsonb_build_object('enabled',true,'intervalSeconds',20,'resumeOnRestart',true),
      'diagnostics',jsonb_build_object('heartbeatSeconds',60,'persistDomErrors',true,'maxRecentErrors',50),
      'sourcePolicy',jsonb_build_object('incrementalImport',true,'csvIsBackupOnly',true,'rejectSuppressed',true,'rejectDuplicates',true)
    )),
    updated_at=now()
WHERE tool_id='vinsansi_capture';

UPDATE public.organization_tool_settings s
SET settings=s.settings || jsonb_build_object(
      'checkpoint',coalesce(s.settings->'checkpoint',jsonb_build_object('enabled',true,'intervalSeconds',20,'resumeOnRestart',true)),
      'diagnostics',coalesce(s.settings->'diagnostics',jsonb_build_object('heartbeatSeconds',60,'persistDomErrors',true,'maxRecentErrors',50)),
      'sourcePolicy',coalesce(s.settings->'sourcePolicy',jsonb_build_object('incrementalImport',true,'csvIsBackupOnly',true,'rejectSuppressed',true,'rejectDuplicates',true))
    ), settings_schema_version=2, settings_version=settings_version+1, updated_at=now()
WHERE tool_id='vinsansi_capture';

-- Tabelas de execucao ja existem na base operacional. Garantimos as colunas que
-- materializam o contrato oficial da Captura e a propriedade da organizacao.
DO $capture_tables$
DECLARE t text; v_nulls bigint;
BEGIN
  FOREACH t IN ARRAY ARRAY['maps_search_executions','maps_search_coverage','maps_search_candidates','maps_search_snapshots'] LOOP
    IF to_regclass('public.'||t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS organizations_id bigint',t);
      IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=t AND column_name='users_id') THEN
        EXECUTE format('UPDATE public.%I x SET organizations_id=o.organizations_id FROM public.organizations o WHERE x.organizations_id IS NULL AND o.legacy_scope_users_id=x.users_id',t);
      END IF;
      EXECUTE format('SELECT count(*) FROM public.%I WHERE organizations_id IS NULL',t) INTO v_nulls;
      IF v_nulls>0 THEN RAISE EXCEPTION 'capture_organization_backfill_incomplete:%:%',t,v_nulls; END IF;
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN organizations_id SET NOT NULL',t);
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I(organizations_id)',left(t||'_org_idx',63),t);
    END IF;
  END LOOP;
END
$capture_tables$;

DO $capture_columns$
BEGIN
 IF to_regclass('public.maps_search_executions') IS NOT NULL THEN
   ALTER TABLE public.maps_search_executions
     ADD COLUMN IF NOT EXISTS source_installation_id uuid REFERENCES public.organization_tool_installations(organization_tool_installations_id) ON DELETE SET NULL,
     ADD COLUMN IF NOT EXISTS initiated_by_member_id bigint REFERENCES public.organization_members(organization_members_id) ON DELETE SET NULL,
     ADD COLUMN IF NOT EXISTS processed_count integer NOT NULL DEFAULT 0,
     ADD COLUMN IF NOT EXISTS accepted_count integer NOT NULL DEFAULT 0,
     ADD COLUMN IF NOT EXISTS suppressed_count integer NOT NULL DEFAULT 0,
     ADD COLUMN IF NOT EXISTS error_count integer NOT NULL DEFAULT 0,
     ADD COLUMN IF NOT EXISTS last_checkpoint_at timestamptz,
     ADD COLUMN IF NOT EXISTS diagnostic_status text NOT NULL DEFAULT 'ok' CHECK(diagnostic_status IN ('ok','degraded','error')),
     ADD COLUMN IF NOT EXISTS last_diagnostic jsonb NOT NULL DEFAULT '{}'::jsonb;
   CREATE INDEX IF NOT EXISTS maps_search_executions_org_status_idx ON public.maps_search_executions(organizations_id,status,created_at DESC);
 END IF;
 IF to_regclass('public.maps_search_candidates') IS NOT NULL THEN
   ALTER TABLE public.maps_search_candidates
     ADD COLUMN IF NOT EXISTS data_provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
     ADD COLUMN IF NOT EXISTS identity_decision text,
     ADD COLUMN IF NOT EXISTS suppression_match boolean NOT NULL DEFAULT false,
     ADD COLUMN IF NOT EXISTS dedup_match_leads_id bigint REFERENCES public.leads(leads_id) ON DELETE SET NULL;
 END IF;
END
$capture_columns$;

-- Gate canonico de Captura. Nao confia na extensao para decidir se um contato
-- pode ser importado; a decisao e refeita no servidor pelo tenant.
CREATE OR REPLACE FUNCTION public.service_capture_identity_gate(
  p_organizations_id bigint,
  p_phone text DEFAULT NULL,
  p_instagram text DEFAULT NULL,
  p_domain text DEFAULT NULL,
  p_maps text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO pg_catalog,public AS $$
DECLARE
  v_phone text:=public.normalize_identity_phone(p_phone);
  v_instagram text:=public.normalize_identity_instagram(p_instagram);
  v_domain text:=public.normalize_identity_domain(p_domain);
  v_maps text:=public.normalize_identity_maps(p_maps);
  v_suppression bigint; v_lead bigint; v_type text; v_value text;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.organizations WHERE organizations_id=p_organizations_id AND status_id=1) THEN RAISE EXCEPTION 'organization_not_found'; END IF;

  SELECT cs.contact_suppressions_id,cs.identity_type,cs.identity_value
    INTO v_suppression,v_type,v_value
  FROM public.contact_suppressions cs
  WHERE cs.organizations_id=p_organizations_id AND cs.is_active
    AND (cs.expires_at IS NULL OR cs.expires_at>now())
    AND ((v_phone<>'' AND cs.identity_type='phone' AND cs.identity_value=v_phone)
      OR (v_instagram<>'' AND cs.identity_type='instagram' AND cs.identity_value=v_instagram)
      OR (v_domain<>'' AND cs.identity_type='domain' AND cs.identity_value=v_domain)
      OR (v_maps<>'' AND cs.identity_type='maps' AND cs.identity_value=v_maps))
  ORDER BY cs.contact_suppressions_id LIMIT 1;
  IF v_suppression IS NOT NULL THEN
    RETURN jsonb_build_object('decision','suppressed','suppressed',true,'duplicate',false,'suppressionId',v_suppression,'identityType',v_type,'identityValue',v_value);
  END IF;

  SELECT r.canonical_lead_id,r.identity_type,r.identity_value
    INTO v_lead,v_type,v_value
  FROM public.lead_identity_registry r
  WHERE r.organizations_id=p_organizations_id
    AND ((v_phone<>'' AND r.identity_type='phone' AND r.identity_value=v_phone)
      OR (v_instagram<>'' AND r.identity_type='instagram' AND r.identity_value=v_instagram)
      OR (v_domain<>'' AND r.identity_type='domain' AND r.identity_value=v_domain)
      OR (v_maps<>'' AND r.identity_type='maps' AND r.identity_value=v_maps))
  ORDER BY r.lead_identity_registry_id LIMIT 1;
  IF v_lead IS NOT NULL THEN
    RETURN jsonb_build_object('decision','duplicate','suppressed',false,'duplicate',true,'canonicalLeadId',v_lead,'identityType',v_type,'identityValue',v_value);
  END IF;
  RETURN jsonb_build_object('decision','accept','suppressed',false,'duplicate',false);
END; $$;
REVOKE ALL ON FUNCTION public.service_capture_identity_gate(bigint,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.service_capture_identity_gate(bigint,text,text,text,text) TO service_role;

-- Checkpoint/diagnostico persistente de uma execucao, usado pelo executor local.
CREATE TABLE IF NOT EXISTS public.capture_execution_events (
  capture_execution_events_id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  organizations_id bigint NOT NULL REFERENCES public.organizations(organizations_id) ON DELETE RESTRICT,
  maps_search_executions_id uuid NOT NULL,
  organization_tool_installations_id uuid REFERENCES public.organization_tool_installations(organization_tool_installations_id) ON DELETE SET NULL,
  organization_members_id bigint REFERENCES public.organization_members(organization_members_id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK(event_type IN ('started','checkpoint','paused','resumed','completed','failed','diagnostic','imported','rejected','duplicate','suppressed')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS capture_execution_events_exec_idx ON public.capture_execution_events(organizations_id,maps_search_executions_id,created_at DESC);
ALTER TABLE public.capture_execution_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS capture_execution_events_org_select ON public.capture_execution_events;
CREATE POLICY capture_execution_events_org_select ON public.capture_execution_events FOR SELECT TO authenticated
USING(organizations_id=public.current_organization_id() AND public.has_organization_permission('capture.use'));
REVOKE INSERT,UPDATE,DELETE ON public.capture_execution_events FROM anon,authenticated;
GRANT SELECT ON public.capture_execution_events TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.capture_execution_events TO service_role;

-- Migra metadata de instalacoes antigas para a instalacao canonica antes de remover a ponte.
DO $maps_legacy_migrate$
DECLARE r record; v_org bigint;
BEGIN
 IF to_regclass('public.maps_extension_installations') IS NOT NULL THEN
   FOR r IN EXECUTE 'SELECT to_jsonb(x) j FROM public.maps_extension_installations x' LOOP
     v_org:=NULLIF(r.j->>'organizations_id','')::bigint;
     IF v_org IS NULL THEN SELECT organizations_id INTO v_org FROM public.organizations WHERE legacy_scope_users_id=NULLIF(r.j->>'users_id','')::bigint LIMIT 1; END IF;
     IF v_org IS NULL OR nullif(r.j->>'installation_id','') IS NULL THEN CONTINUE; END IF;
     INSERT INTO public.organization_tools(organizations_id,tool_id,enabled) VALUES(v_org,'vinsansi_capture',true) ON CONFLICT(organizations_id,tool_id) DO NOTHING;
     INSERT INTO public.organization_tool_installations(organizations_id,tool_id,external_installation_id,registration_status,installed_version,reported_capabilities,last_seen_at,metadata)
     VALUES(v_org,'vinsansi_capture',r.j->>'installation_id',CASE WHEN lower(coalesce(r.j->>'status','active'))='revoked' THEN 'revoked' ELSE 'registered' END,NULL,ARRAY['capture.maps'],NULLIF(r.j->>'last_seen_at','')::timestamptz,jsonb_build_object('migratedFrom','maps_extension_installations','migratedAt',now()))
     ON CONFLICT(organizations_id,tool_id,external_installation_id) DO UPDATE SET
       last_seen_at=coalesce(excluded.last_seen_at,organization_tool_installations.last_seen_at),
       metadata=organization_tool_installations.metadata||excluded.metadata;
   END LOOP;
 END IF;
END
$maps_legacy_migrate$;

DROP TABLE IF EXISTS public.maps_extension_pairings CASCADE;
DROP TABLE IF EXISTS public.maps_extension_installations CASCADE;

-- RLS explicita para tabelas da Captura agora que o tenant e canonico.
DO $capture_rls$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['maps_search_executions','maps_search_coverage','maps_search_candidates','maps_search_snapshots'] LOOP
   IF to_regclass('public.'||t) IS NOT NULL THEN
     EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
     EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',left(t||'_org_select',63),t);
     EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (organizations_id=public.current_organization_id() AND public.has_organization_permission(''capture.use''))',left(t||'_org_select',63),t);
   END IF;
 END LOOP;
END
$capture_rls$;

-- Auditoria de migration não é emitida sem ator; a própria migration é a fonte canônica de versão.

COMMIT;

-- ======================================================================
-- ETAPA 9
-- ======================================================================
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

-- ======================================================================
-- ETAPA 10
-- ======================================================================
BEGIN;

-- ETAPA 10 — Base Permanente como memória comercial canônica por organização.

DO $stage_preflight$
DECLARE v_missing text[]:=ARRAY[]::text[]; v_name text;
BEGIN
  FOREACH v_name IN ARRAY ARRAY['lead_identity_registry','contact_suppressions','permanent_records'] LOOP IF to_regclass('public.'||v_name) IS NULL THEN v_missing:=array_append(v_missing,'table:'||v_name);END IF;END LOOP;
  IF cardinality(v_missing)>0 THEN RAISE EXCEPTION 'stage_preflight_failed:%',array_to_string(v_missing,',');END IF;
END
$stage_preflight$;

ALTER TABLE public.permanent_records
 ADD COLUMN IF NOT EXISTS organizations_id bigint,
 ADD COLUMN IF NOT EXISTS first_capture_at timestamptz,
 ADD COLUMN IF NOT EXISTS last_capture_at timestamptz,
 ADD COLUMN IF NOT EXISTS capture_occurrences integer NOT NULL DEFAULT 0 CHECK(capture_occurrences>=0),
 ADD COLUMN IF NOT EXISTS contact_channels text[] NOT NULL DEFAULT '{}',
 ADD COLUMN IF NOT EXISTS last_contact_at timestamptz,
 ADD COLUMN IF NOT EXISTS last_contact_result text,
 ADD COLUMN IF NOT EXISTS outcome_updated_at timestamptz,
 ADD COLUMN IF NOT EXISTS outcome_updated_by_member_id bigint REFERENCES public.organization_members(organization_members_id) ON DELETE SET NULL;
ALTER TABLE public.permanent_record_snapshots ADD COLUMN IF NOT EXISTS organizations_id bigint;
UPDATE public.permanent_records p SET organizations_id=l.organizations_id FROM public.leads l WHERE p.organizations_id IS NULL AND l.leads_id=p.canonical_lead_id;
UPDATE public.permanent_record_snapshots s SET organizations_id=p.organizations_id FROM public.permanent_records p WHERE s.organizations_id IS NULL AND p.permanent_records_id=s.permanent_records_id;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.permanent_records WHERE organizations_id IS NULL) THEN RAISE EXCEPTION 'permanent_records_organization_backfill_incomplete'; END IF;
 IF EXISTS(SELECT 1 FROM public.permanent_record_snapshots WHERE organizations_id IS NULL) THEN RAISE EXCEPTION 'permanent_snapshots_organization_backfill_incomplete'; END IF;
END $$;
ALTER TABLE public.permanent_records ALTER COLUMN organizations_id SET NOT NULL;
ALTER TABLE public.permanent_record_snapshots ALTER COLUMN organizations_id SET NOT NULL;
ALTER TABLE public.permanent_records DROP CONSTRAINT IF EXISTS permanent_records_users_id_canonical_lead_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS permanent_records_org_canonical_uidx ON public.permanent_records(organizations_id,canonical_lead_id);
CREATE INDEX IF NOT EXISTS permanent_records_org_identity_idx ON public.permanent_records(organizations_id,normalized_phone,normalized_instagram,normalized_domain,normalized_maps);
CREATE INDEX IF NOT EXISTS permanent_records_org_outcome_idx ON public.permanent_records(organizations_id,commercial_outcome,last_activity_at DESC);

CREATE TABLE IF NOT EXISTS public.commercial_outcomes (
 commercial_outcome_key text PRIMARY KEY,
 display_name text NOT NULL,
 suppress_contact boolean NOT NULL DEFAULT false,
 allow_reentry boolean NOT NULL DEFAULT true,
 minimum_reentry_days integer CHECK(minimum_reentry_days IS NULL OR minimum_reentry_days>=0),
 sort_order integer NOT NULL,
 status_id bigint NOT NULL DEFAULT 1 REFERENCES public.status(status_id)
);
INSERT INTO public.commercial_outcomes(commercial_outcome_key,display_name,suppress_contact,allow_reentry,minimum_reentry_days,sort_order) VALUES
 ('no_response','Sem resposta',false,true,30,10),
 ('responded','Respondeu',false,true,14,20),
 ('interested','Interessado',false,true,7,30),
 ('not_interested','Não interessado',false,true,90,40),
 ('client','Cliente',true,false,NULL,50),
 ('wrong_contact','Contato incorreto',true,false,NULL,60),
 ('closed_business','Empresa fechada',true,false,NULL,70),
 ('do_not_contact','Não contatar',true,false,NULL,80)
ON CONFLICT(commercial_outcome_key) DO UPDATE SET display_name=excluded.display_name,suppress_contact=excluded.suppress_contact,allow_reentry=excluded.allow_reentry,minimum_reentry_days=excluded.minimum_reentry_days,sort_order=excluded.sort_order;
GRANT SELECT ON public.commercial_outcomes TO authenticated,service_role;

CREATE TABLE IF NOT EXISTS public.permanent_record_events (
 permanent_record_events_id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
 organizations_id bigint NOT NULL REFERENCES public.organizations(organizations_id) ON DELETE RESTRICT,
 permanent_records_id bigint NOT NULL REFERENCES public.permanent_records(permanent_records_id) ON DELETE CASCADE,
 canonical_lead_id bigint NOT NULL REFERENCES public.leads(leads_id) ON DELETE RESTRICT,
 organization_members_id bigint REFERENCES public.organization_members(organization_members_id) ON DELETE SET NULL,
 event_type text NOT NULL CHECK(event_type IN ('capture_seen','lead_finalized','dispatch','conversation','outcome_changed','suppressed','unsuppressed','archived','reentry_allowed','reentry_blocked','metadata_changed')),
 channel text,
 result text,
 payload jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS permanent_record_events_record_idx ON public.permanent_record_events(organizations_id,permanent_records_id,created_at DESC);
ALTER TABLE public.permanent_record_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS permanent_record_events_org_select ON public.permanent_record_events;
CREATE POLICY permanent_record_events_org_select ON public.permanent_record_events FOR SELECT TO authenticated USING(organizations_id=public.current_organization_id() AND public.has_organization_permission('leads.view'));
REVOKE INSERT,UPDATE,DELETE ON public.permanent_record_events FROM anon,authenticated;GRANT SELECT ON public.permanent_record_events TO authenticated;GRANT ALL ON public.permanent_record_events TO service_role;

-- Memória de captura agrega ocorrências da Captura oficial sem criar novo lead.
CREATE OR REPLACE FUNCTION public.service_record_capture_memory(p_organizations_id bigint,p_canonical_lead_id bigint,p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_id bigint;
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required';END IF;
 SELECT permanent_records_id INTO v_id FROM public.permanent_records WHERE organizations_id=p_organizations_id AND canonical_lead_id=p_canonical_lead_id FOR UPDATE;
 IF v_id IS NULL THEN PERFORM public.refresh_permanent_record(p_canonical_lead_id,'capture_memory');SELECT permanent_records_id INTO v_id FROM public.permanent_records WHERE organizations_id=p_organizations_id AND canonical_lead_id=p_canonical_lead_id;END IF;
 IF v_id IS NULL THEN RETURN NULL; END IF;
 UPDATE public.permanent_records SET first_capture_at=coalesce(first_capture_at,now()),last_capture_at=now(),capture_occurrences=capture_occurrences+1,last_activity_at=greatest(last_activity_at,now()),permanent_records_updated_at=now() WHERE permanent_records_id=v_id;
 INSERT INTO public.permanent_record_events(organizations_id,permanent_records_id,canonical_lead_id,event_type,payload) VALUES(p_organizations_id,v_id,p_canonical_lead_id,'capture_seen',coalesce(p_payload,'{}'));
 RETURN v_id;
END; $$;
REVOKE ALL ON FUNCTION public.service_record_capture_memory(bigint,bigint,jsonb) FROM PUBLIC,anon,authenticated;GRANT EXECUTE ON FUNCTION public.service_record_capture_memory(bigint,bigint,jsonb) TO service_role;

-- Atualiza o refresh legado para respeitar tenant e registrar snapshot/evento.
CREATE OR REPLACE FUNCTION public.refresh_permanent_record(p_lead_id bigint,p_reason text DEFAULT 'refresh')
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_lead public.leads%ROWTYPE;v_canonical bigint;v_base public.leads%ROWTYPE;v_status bigint;v_total integer;v_dispatch integer;v_first timestamptz;v_last timestamptz;v_last_sent timestamptz;v_suppressed boolean;v_id bigint;v_snapshot jsonb;v_channels text[];
BEGIN
 SELECT * INTO v_lead FROM public.leads WHERE leads_id=p_lead_id;IF NOT FOUND THEN RETURN NULL;END IF;v_canonical:=coalesce(v_lead.canonical_lead_id,v_lead.leads_id);
 SELECT * INTO v_base FROM public.leads WHERE leads_id=v_canonical AND organizations_id=v_lead.organizations_id;IF NOT FOUND THEN v_base:=v_lead;v_canonical:=v_lead.leads_id;END IF;
 IF NOT EXISTS(SELECT 1 FROM public.leads l WHERE l.organizations_id=v_lead.organizations_id AND (l.leads_id=v_canonical OR l.canonical_lead_id=v_canonical) AND l.lead_status_id IN(5,6,7,8)) THEN RETURN NULL;END IF;
 SELECT l.lead_status_id,l.leads_updated_at INTO v_status,v_last FROM public.leads l WHERE l.organizations_id=v_lead.organizations_id AND (l.leads_id=v_canonical OR l.canonical_lead_id=v_canonical) AND l.lead_status_id IN(5,6,7,8) ORDER BY l.leads_updated_at DESC,l.leads_id DESC LIMIT 1;
 SELECT count(*)::integer,min(l.leads_created_at),max(l.leads_updated_at) INTO v_total,v_first,v_last FROM public.leads l WHERE l.organizations_id=v_lead.organizations_id AND (l.leads_id=v_canonical OR l.canonical_lead_id=v_canonical);
 SELECT count(*)::integer,max(s.sents_sent_at),coalesce(array_agg(DISTINCT c.channels_name) FILTER(WHERE c.channels_name IS NOT NULL),'{}') INTO v_dispatch,v_last_sent,v_channels FROM public.sents s JOIN public.leads l ON l.leads_id=s.leads_id LEFT JOIN public.channels c ON c.channels_id=s.channels_id WHERE l.organizations_id=v_lead.organizations_id AND (l.leads_id=v_canonical OR l.canonical_lead_id=v_canonical) AND s.sents_sent_at IS NOT NULL;
 SELECT EXISTS(SELECT 1 FROM public.contact_suppressions cs WHERE cs.organizations_id=v_lead.organizations_id AND cs.is_active AND (cs.expires_at IS NULL OR cs.expires_at>now()) AND ((cs.identity_type='phone' AND cs.identity_value=v_base.leads_normalized_phone) OR (cs.identity_type='instagram' AND cs.identity_value=v_base.leads_normalized_instagram) OR (cs.identity_type='domain' AND cs.identity_value=v_base.leads_normalized_domain) OR (cs.identity_type='maps' AND cs.identity_value=v_base.leads_normalized_maps))) INTO v_suppressed;
 INSERT INTO public.permanent_records(users_id,organizations_id,canonical_lead_id,branches_id,states_id,cities_id,channels_id,last_lead_status_id,company_name,normalized_phone,normalized_instagram,normalized_domain,normalized_maps,total_leads,total_dispatches,first_seen_at,last_activity_at,last_sent_at,last_contact_at,contact_channels,is_suppressed)
 VALUES(v_lead.users_id,v_lead.organizations_id,v_canonical,v_base.branches_id,v_base.states_id,v_base.cities_id,v_base.channels_id,v_status,v_base.leads_name,v_base.leads_normalized_phone,v_base.leads_normalized_instagram,v_base.leads_normalized_domain,v_base.leads_normalized_maps,greatest(v_total,1),coalesce(v_dispatch,0),coalesce(v_first,now()),coalesce(v_last,now()),v_last_sent,v_last_sent,coalesce(v_channels,'{}'),coalesce(v_suppressed,false))
 ON CONFLICT(organizations_id,canonical_lead_id) DO UPDATE SET branches_id=excluded.branches_id,states_id=excluded.states_id,cities_id=excluded.cities_id,channels_id=excluded.channels_id,last_lead_status_id=CASE WHEN public.permanent_records.record_status='archived' THEN 8 ELSE excluded.last_lead_status_id END,company_name=excluded.company_name,normalized_phone=excluded.normalized_phone,normalized_instagram=excluded.normalized_instagram,normalized_domain=excluded.normalized_domain,normalized_maps=excluded.normalized_maps,total_leads=excluded.total_leads,total_dispatches=excluded.total_dispatches,first_seen_at=excluded.first_seen_at,last_activity_at=excluded.last_activity_at,last_sent_at=excluded.last_sent_at,last_contact_at=excluded.last_contact_at,contact_channels=excluded.contact_channels,is_suppressed=excluded.is_suppressed,permanent_records_updated_at=now()
 RETURNING permanent_records_id INTO v_id;
 SELECT to_jsonb(pr) INTO v_snapshot FROM public.permanent_records pr WHERE pr.permanent_records_id=v_id;
 INSERT INTO public.permanent_record_snapshots(users_id,organizations_id,permanent_records_id,reason,snapshot) VALUES(v_lead.users_id,v_lead.organizations_id,v_id,p_reason,v_snapshot);
 INSERT INTO public.permanent_record_events(organizations_id,permanent_records_id,canonical_lead_id,event_type,payload) VALUES(v_lead.organizations_id,v_id,v_canonical,CASE WHEN p_reason='dispatch_changed' THEN 'dispatch' ELSE 'lead_finalized' END,jsonb_build_object('reason',p_reason,'statusId',v_status)) ON CONFLICT DO NOTHING;
 RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.update_permanent_record_metadata(p_canonical_lead_id bigint,p_commercial_outcome text,p_operator_notes text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_org bigint:=public.current_organization_id();v_member bigint:=public.current_organization_member_id();v_id bigint;v_old text;v_users bigint;v_suppress boolean;
BEGIN
 PERFORM public.require_organization_permission('leads.edit');
 IF nullif(trim(coalesce(p_commercial_outcome,'')),'') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.commercial_outcomes WHERE commercial_outcome_key=trim(p_commercial_outcome) AND status_id=1) THEN RAISE EXCEPTION 'commercial_outcome_invalid';END IF;
 SELECT permanent_records_id,commercial_outcome,users_id INTO v_id,v_old,v_users FROM public.permanent_records WHERE organizations_id=v_org AND canonical_lead_id=p_canonical_lead_id FOR UPDATE;IF v_id IS NULL THEN RAISE EXCEPTION 'permanent_record_not_found';END IF;
 UPDATE public.permanent_records SET commercial_outcome=nullif(trim(p_commercial_outcome),''),operator_notes=nullif(trim(p_operator_notes),''),outcome_updated_at=now(),outcome_updated_by_member_id=v_member,permanent_records_updated_at=now() WHERE permanent_records_id=v_id;
 INSERT INTO public.permanent_record_events(organizations_id,permanent_records_id,canonical_lead_id,organization_members_id,event_type,result,payload) VALUES(v_org,v_id,p_canonical_lead_id,v_member,'outcome_changed',nullif(trim(p_commercial_outcome),''),jsonb_build_object('previous',v_old,'notesChanged',true));
 SELECT suppress_contact INTO v_suppress FROM public.commercial_outcomes WHERE commercial_outcome_key=trim(p_commercial_outcome);
 IF coalesce(v_suppress,false) THEN
   INSERT INTO public.contact_suppressions(users_id,organizations_id,identity_type,identity_value,reason,is_active,source_lead_id)
   SELECT v_users,v_org,x.identity_type,x.identity_value,'commercial_outcome:'||trim(p_commercial_outcome),true,p_canonical_lead_id FROM (VALUES('phone',(SELECT normalized_phone FROM public.permanent_records WHERE permanent_records_id=v_id)),('instagram',(SELECT normalized_instagram FROM public.permanent_records WHERE permanent_records_id=v_id)),('domain',(SELECT normalized_domain FROM public.permanent_records WHERE permanent_records_id=v_id)),('maps',(SELECT normalized_maps FROM public.permanent_records WHERE permanent_records_id=v_id))) x(identity_type,identity_value) WHERE nullif(x.identity_value,'') IS NOT NULL ON CONFLICT(organizations_id,identity_type,identity_value) DO UPDATE SET is_active=true,reason=excluded.reason,expires_at=NULL,updated_at=now();
 END IF;
END; $$;
GRANT EXECUTE ON FUNCTION public.update_permanent_record_metadata(bigint,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.commercial_reentry_decision(p_organizations_id bigint,p_canonical_lead_id bigint,p_at timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO pg_catalog,public AS $$
DECLARE r public.permanent_records%ROWTYPE;o public.commercial_outcomes%ROWTYPE;v_age integer;
BEGIN
 IF auth.role()<>'service_role' AND p_organizations_id<>public.current_organization_id() THEN RAISE EXCEPTION 'organization_access_denied';END IF;
 SELECT * INTO r FROM public.permanent_records WHERE organizations_id=p_organizations_id AND canonical_lead_id=p_canonical_lead_id;IF NOT FOUND THEN RETURN jsonb_build_object('allowed',true,'reason','not_seen');END IF;
 IF r.is_suppressed THEN RETURN jsonb_build_object('allowed',false,'reason','suppressed','outcome',r.commercial_outcome);END IF;
 IF r.commercial_outcome IS NULL THEN RETURN jsonb_build_object('allowed',true,'reason','no_outcome');END IF;
 SELECT * INTO o FROM public.commercial_outcomes WHERE commercial_outcome_key=r.commercial_outcome AND status_id=1;IF NOT FOUND THEN RETURN jsonb_build_object('allowed',true,'reason','unknown_outcome');END IF;
 IF NOT o.allow_reentry THEN RETURN jsonb_build_object('allowed',false,'reason','outcome_blocks_reentry','outcome',o.commercial_outcome_key);END IF;
 v_age:=floor(extract(epoch from (p_at-coalesce(r.last_contact_at,r.last_activity_at)))/86400)::integer;
 RETURN jsonb_build_object('allowed',o.minimum_reentry_days IS NULL OR v_age>=o.minimum_reentry_days,'reason',CASE WHEN o.minimum_reentry_days IS NULL OR v_age>=o.minimum_reentry_days THEN 'cooldown_completed' ELSE 'cooldown_active' END,'daysSinceContact',v_age,'minimumDays',o.minimum_reentry_days,'outcome',o.commercial_outcome_key);
END; $$;
GRANT EXECUTE ON FUNCTION public.commercial_reentry_decision(bigint,bigint,timestamptz) TO authenticated,service_role;


CREATE OR REPLACE FUNCTION public.archive_permanent_record(p_canonical_lead_id bigint,p_expected_status_id bigint)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_org bigint:=public.current_organization_id();v_user bigint:=public.ensure_current_user();v_member bigint:=public.current_organization_member_id();v_id bigint;
BEGIN
 PERFORM public.require_organization_permission('leads.delete');
 UPDATE public.permanent_records SET record_status='archived',last_lead_status_id=8,archived_at=now(),permanent_records_updated_at=now()
 WHERE organizations_id=v_org AND canonical_lead_id=p_canonical_lead_id AND last_lead_status_id=p_expected_status_id AND record_status<>'archived' RETURNING permanent_records_id INTO v_id;
 IF v_id IS NOT NULL THEN
   INSERT INTO public.permanent_record_events(organizations_id,permanent_records_id,canonical_lead_id,organization_members_id,event_type,payload) VALUES(v_org,v_id,p_canonical_lead_id,v_member,'archived',jsonb_build_object('expectedStatusId',p_expected_status_id));
   PERFORM public.append_audit_event('base-permanente','archive_permanent_record','permanent_record',v_id::text,p_canonical_lead_id,NULL,NULL,p_expected_status_id,8,NULL,jsonb_build_object('organization_id',v_org),v_user);
 END IF;
 RETURN v_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.archive_permanent_record(bigint,bigint) TO authenticated;

-- RLS tenant-aware.
ALTER TABLE public.permanent_records ENABLE ROW LEVEL SECURITY;ALTER TABLE public.permanent_record_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS permanent_records_own_select ON public.permanent_records;DROP POLICY IF EXISTS permanent_records_org_select ON public.permanent_records;CREATE POLICY permanent_records_org_select ON public.permanent_records FOR SELECT TO authenticated USING(organizations_id=public.current_organization_id() AND public.has_organization_permission('leads.view'));
DROP POLICY IF EXISTS permanent_record_snapshots_own_select ON public.permanent_record_snapshots;DROP POLICY IF EXISTS permanent_record_snapshots_org_select ON public.permanent_record_snapshots;CREATE POLICY permanent_record_snapshots_org_select ON public.permanent_record_snapshots FOR SELECT TO authenticated USING(organizations_id=public.current_organization_id() AND public.has_organization_permission('leads.view'));

DO $$ DECLARE r record; BEGIN FOR r IN SELECT DISTINCT coalesce(canonical_lead_id,leads_id) lead_id FROM public.leads WHERE lead_status_id IN(5,6,7,8) LOOP PERFORM public.refresh_permanent_record(r.lead_id,'stage10_backfill'); END LOOP; END $$;

COMMIT;

-- ======================================================================
-- ETAPA 11
-- ======================================================================
BEGIN;

-- ETAPA 11 — observabilidade tenant-aware, saúde, alertas e recuperação controlada.

DO $stage_preflight$
DECLARE v_missing text[]:=ARRAY[]::text[]; v_name text;
BEGIN
  FOREACH v_name IN ARRAY ARRAY['organization_tool_installations','worker_heartbeats'] LOOP IF to_regclass('public.'||v_name) IS NULL THEN v_missing:=array_append(v_missing,'table:'||v_name);END IF;END LOOP;
  FOREACH v_name IN ARRAY ARRAY['append_audit_event'] LOOP IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=v_name) THEN v_missing:=array_append(v_missing,'function:'||v_name);END IF;END LOOP;
  IF cardinality(v_missing)>0 THEN RAISE EXCEPTION 'stage_preflight_failed:%',array_to_string(v_missing,',');END IF;
END
$stage_preflight$;

CREATE TABLE IF NOT EXISTS public.platform_runtime_heartbeats (
  platform_runtime_heartbeats_id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  organizations_id bigint NOT NULL REFERENCES public.organizations(organizations_id) ON DELETE CASCADE,
  organization_tool_installations_id uuid REFERENCES public.organization_tool_installations(organization_tool_installations_id) ON DELETE SET NULL,
  component_type text NOT NULL CHECK(component_type IN ('worker','manager','gateway','evolution','capture','instagram','realtime')),
  component_key text NOT NULL,
  component_version text,
  runtime_status text NOT NULL DEFAULT 'online' CHECK(runtime_status IN ('online','degraded','stopping','offline','error','incompatible')),
  started_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_meaningful_activity_at timestamptz,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(organizations_id,component_type,component_key)
);
CREATE INDEX IF NOT EXISTS platform_runtime_heartbeats_seen_idx ON public.platform_runtime_heartbeats(organizations_id,last_seen_at DESC);
CREATE INDEX IF NOT EXISTS platform_runtime_heartbeats_component_idx ON public.platform_runtime_heartbeats(organizations_id,component_type,runtime_status,last_seen_at DESC);
ALTER TABLE public.platform_runtime_heartbeats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS platform_runtime_heartbeats_org_select ON public.platform_runtime_heartbeats;
CREATE POLICY platform_runtime_heartbeats_org_select ON public.platform_runtime_heartbeats FOR SELECT TO authenticated
USING(organizations_id=public.current_organization_id() AND public.has_organization_permission('monitoring.view'));
REVOKE INSERT,UPDATE,DELETE ON public.platform_runtime_heartbeats FROM anon,authenticated;
GRANT SELECT ON public.platform_runtime_heartbeats TO authenticated;
GRANT ALL ON public.platform_runtime_heartbeats TO service_role;

-- Heartbeat legado do Worker passa a ser tenant-aware. Registros antigos sem tenant são efêmeros e podem ser descartados.
ALTER TABLE public.worker_heartbeats ADD COLUMN IF NOT EXISTS organizations_id bigint REFERENCES public.organizations(organizations_id) ON DELETE CASCADE;
DELETE FROM public.worker_heartbeats WHERE organizations_id IS NULL;
ALTER TABLE public.worker_heartbeats ALTER COLUMN organizations_id SET NOT NULL;
ALTER TABLE public.worker_heartbeats DROP CONSTRAINT IF EXISTS worker_heartbeats_worker_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS worker_heartbeats_org_worker_uidx ON public.worker_heartbeats(organizations_id,worker_id);
ALTER TABLE public.worker_heartbeats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS worker_heartbeats_authenticated_read ON public.worker_heartbeats;
DROP POLICY IF EXISTS worker_heartbeats_org_select ON public.worker_heartbeats;
CREATE POLICY worker_heartbeats_org_select ON public.worker_heartbeats FOR SELECT TO authenticated
USING(organizations_id=public.current_organization_id() AND public.has_organization_permission('monitoring.view'));
REVOKE INSERT,UPDATE,DELETE ON public.worker_heartbeats FROM anon,authenticated;
GRANT SELECT ON public.worker_heartbeats TO authenticated;
GRANT ALL ON public.worker_heartbeats TO service_role;

-- Tabelas antigas de alerta/recovery já recebem organizations_id na Etapa 2; reforça índices e RLS por tenant.
CREATE UNIQUE INDEX IF NOT EXISTS operational_alerts_org_key_uidx ON public.operational_alerts(organizations_id,alert_key);
CREATE INDEX IF NOT EXISTS operational_alerts_org_open_idx ON public.operational_alerts(organizations_id,severity,last_detected_at DESC) WHERE status<>'resolved';
CREATE INDEX IF NOT EXISTS recovery_requests_org_pending_idx ON public.recovery_requests(organizations_id,status,requested_at) WHERE status IN ('pending','running');
ALTER TABLE public.operational_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recovery_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS operational_alerts_own_select ON public.operational_alerts;
DROP POLICY IF EXISTS operational_alerts_org_select ON public.operational_alerts;
CREATE POLICY operational_alerts_org_select ON public.operational_alerts FOR SELECT TO authenticated
USING(organizations_id=public.current_organization_id() AND public.has_organization_permission('monitoring.view'));
DROP POLICY IF EXISTS recovery_requests_own_select ON public.recovery_requests;
DROP POLICY IF EXISTS recovery_requests_org_select ON public.recovery_requests;
CREATE POLICY recovery_requests_org_select ON public.recovery_requests FOR SELECT TO authenticated
USING(organizations_id=public.current_organization_id() AND public.has_organization_permission('monitoring.view'));

-- Registro canônico de qualquer componente. O servidor fixa a organização a partir da credencial da instalação.
CREATE OR REPLACE FUNCTION public.service_runtime_heartbeat(
  p_organizations_id bigint,
  p_component_type text,
  p_component_key text,
  p_component_version text DEFAULT NULL,
  p_status text DEFAULT 'online',
  p_installation_id uuid DEFAULT NULL,
  p_metrics jsonb DEFAULT '{}'::jsonb,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_meaningful_activity boolean DEFAULT false
) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_id bigint; v_type text:=lower(trim(coalesce(p_component_type,''))); v_status text:=lower(trim(coalesce(p_status,'online')));
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.organizations WHERE organizations_id=p_organizations_id AND status_id=1) THEN RAISE EXCEPTION 'organization_not_active'; END IF;
  IF v_type NOT IN ('worker','manager','gateway','evolution','capture','instagram','realtime') THEN RAISE EXCEPTION 'runtime_component_invalid'; END IF;
  IF v_status NOT IN ('online','degraded','stopping','offline','error','incompatible') THEN RAISE EXCEPTION 'runtime_status_invalid'; END IF;
  IF nullif(trim(coalesce(p_component_key,'')),'') IS NULL THEN RAISE EXCEPTION 'runtime_component_key_required'; END IF;
  IF p_installation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.organization_tool_installations i WHERE i.organization_tool_installations_id=p_installation_id AND i.organizations_id=p_organizations_id AND i.registration_status='registered') THEN RAISE EXCEPTION 'runtime_installation_scope_mismatch'; END IF;
  INSERT INTO public.platform_runtime_heartbeats(organizations_id,organization_tool_installations_id,component_type,component_key,component_version,runtime_status,last_meaningful_activity_at,metrics,metadata)
  VALUES(p_organizations_id,p_installation_id,v_type,trim(p_component_key),nullif(trim(coalesce(p_component_version,'')),''),v_status,CASE WHEN p_meaningful_activity THEN now() ELSE NULL END,coalesce(p_metrics,'{}'::jsonb),coalesce(p_metadata,'{}'::jsonb))
  ON CONFLICT(organizations_id,component_type,component_key) DO UPDATE SET
    organization_tool_installations_id=coalesce(excluded.organization_tool_installations_id,public.platform_runtime_heartbeats.organization_tool_installations_id),
    component_version=coalesce(excluded.component_version,public.platform_runtime_heartbeats.component_version),
    runtime_status=excluded.runtime_status,last_seen_at=now(),
    last_meaningful_activity_at=CASE WHEN p_meaningful_activity THEN now() ELSE public.platform_runtime_heartbeats.last_meaningful_activity_at END,
    metrics=excluded.metrics,metadata=public.platform_runtime_heartbeats.metadata||excluded.metadata
  RETURNING platform_runtime_heartbeats_id INTO v_id;
  RETURN v_id;
END; $$;
REVOKE ALL ON FUNCTION public.service_runtime_heartbeat(bigint,text,text,text,text,uuid,jsonb,jsonb,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.service_runtime_heartbeat(bigint,text,text,text,text,uuid,jsonb,jsonb,boolean) TO service_role;

-- Substitui o heartbeat legado do Worker por uma assinatura com tenant explícito.
DROP FUNCTION IF EXISTS public.service_worker_heartbeat(text,text,text,jsonb,jsonb);
CREATE OR REPLACE FUNCTION public.service_worker_heartbeat(
  p_organizations_id bigint,p_worker_id text,p_worker_version text,p_status text DEFAULT 'online',p_metrics jsonb DEFAULT '{}'::jsonb,p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  INSERT INTO public.worker_heartbeats(organizations_id,worker_id,worker_version,worker_status,metrics,metadata)
  VALUES(p_organizations_id,trim(p_worker_id),trim(p_worker_version),p_status,coalesce(p_metrics,'{}'::jsonb),coalesce(p_metadata,'{}'::jsonb))
  ON CONFLICT(organizations_id,worker_id) DO UPDATE SET worker_version=excluded.worker_version,worker_status=excluded.worker_status,last_seen_at=now(),metrics=excluded.metrics,metadata=excluded.metadata;
  PERFORM public.service_runtime_heartbeat(p_organizations_id,'worker',trim(p_worker_id),p_worker_version,p_status,NULL,p_metrics,p_metadata,false);
END; $$;
REVOKE ALL ON FUNCTION public.service_worker_heartbeat(bigint,text,text,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.service_worker_heartbeat(bigint,text,text,text,jsonb,jsonb) TO service_role;

-- Recovery por organização. Nenhum Worker pode reclamar pedido de outro tenant.
CREATE OR REPLACE FUNCTION public.request_operational_recovery(p_scope text DEFAULT 'all')
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_org bigint:=public.current_organization_id(); v_user bigint:=public.ensure_current_user(); v_id bigint; v_scope text:=lower(trim(coalesce(p_scope,'all')));
BEGIN
  PERFORM public.require_organization_permission('monitoring.manage');
  IF v_scope NOT IN('all','whatsapp','instagram','capture','realtime','tools') THEN RAISE EXCEPTION 'recovery_scope_invalid'; END IF;
  SELECT recovery_requests_id INTO v_id FROM public.recovery_requests WHERE organizations_id=v_org AND status IN('pending','running') ORDER BY requested_at DESC LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  INSERT INTO public.recovery_requests(users_id,organizations_id,requested_by,scope) VALUES(v_user,v_org,auth.uid(),v_scope) RETURNING recovery_requests_id INTO v_id;
  PERFORM public.append_audit_event('monitoring','recovery_requested','recovery_request',v_id::text,NULL,NULL,NULL,NULL,NULL,NULL,jsonb_build_object('scope',v_scope,'organization_id',v_org),v_user);
  RETURN v_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.request_operational_recovery(text) TO authenticated;

DROP FUNCTION IF EXISTS public.service_claim_recovery_request(text);
CREATE OR REPLACE FUNCTION public.service_claim_recovery_request(p_organizations_id bigint,p_worker_id text)
RETURNS TABLE(recovery_requests_id bigint,organizations_id bigint,users_id bigint,scope text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_id bigint;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  SELECT r.recovery_requests_id INTO v_id FROM public.recovery_requests r WHERE r.organizations_id=p_organizations_id AND r.status='pending' ORDER BY r.requested_at FOR UPDATE SKIP LOCKED LIMIT 1;
  IF v_id IS NULL THEN RETURN; END IF;
  UPDATE public.recovery_requests SET status='running',worker_id=p_worker_id,started_at=now() WHERE public.recovery_requests.recovery_requests_id=v_id;
  RETURN QUERY SELECT r.recovery_requests_id,r.organizations_id,r.users_id,r.scope FROM public.recovery_requests r WHERE r.recovery_requests_id=v_id;
END; $$;
REVOKE ALL ON FUNCTION public.service_claim_recovery_request(bigint,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.service_claim_recovery_request(bigint,text) TO service_role;

DROP FUNCTION IF EXISTS public.service_complete_recovery_request(bigint,jsonb,text);
CREATE OR REPLACE FUNCTION public.service_complete_recovery_request(p_organizations_id bigint,p_request_id bigint,p_result jsonb,p_error text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  UPDATE public.recovery_requests SET status=CASE WHEN p_error IS NULL THEN 'completed' ELSE 'failed' END,result=coalesce(p_result,'{}'::jsonb),error_message=p_error,finished_at=now()
  WHERE recovery_requests_id=p_request_id AND organizations_id=p_organizations_id AND status='running';
END; $$;
REVOKE ALL ON FUNCTION public.service_complete_recovery_request(bigint,bigint,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.service_complete_recovery_request(bigint,bigint,jsonb,text) TO service_role;

-- Alertas derivados da verdade operacional. Idempotente: abre/atualiza e resolve quando a condição some.
-- Contrato legado possuía o mesmo tipo bigint com nome de parâmetro p_users_id.
-- PostgreSQL não permite alterar nome de parâmetro via CREATE OR REPLACE;
-- removemos a função antiga e recriamos o contrato tenant-aware explicitamente.
DROP FUNCTION IF EXISTS public.refresh_operational_alerts(bigint);
CREATE OR REPLACE FUNCTION public.refresh_operational_alerts(p_organizations_id bigint)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_user bigint; v_count integer:=0; v_value bigint; v_now timestamptz:=now();
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  SELECT legacy_scope_users_id INTO v_user FROM public.organizations WHERE organizations_id=p_organizations_id;
  IF v_user IS NULL THEN RAISE EXCEPTION 'organization_not_found'; END IF;

  SELECT count(*) INTO v_value FROM public.queue_items WHERE organizations_id=p_organizations_id AND status_id=4 AND queue_items_updated_at<v_now-interval '15 minutes';
  IF v_value>0 THEN
    INSERT INTO public.operational_alerts(users_id,organizations_id,alert_key,source,severity,title,message,metadata)
    VALUES(v_user,p_organizations_id,'stale_queue_items','queues','critical','Itens travados em processamento',v_value||' item(ns) estão processando há mais de 15 minutos.',jsonb_build_object('count',v_value))
    ON CONFLICT(organizations_id,alert_key) DO UPDATE SET status='open',last_detected_at=v_now,message=excluded.message,metadata=excluded.metadata,resolved_at=NULL;
    v_count:=v_count+1;
  ELSE UPDATE public.operational_alerts SET status='resolved',resolved_at=v_now WHERE organizations_id=p_organizations_id AND alert_key='stale_queue_items' AND status<>'resolved'; END IF;

  SELECT count(*) INTO v_value FROM public.queue_item_dispatch_parts WHERE organizations_id=p_organizations_id AND queue_item_dispatch_parts_state='reconciliation_required';
  IF v_value>0 THEN
    INSERT INTO public.operational_alerts(users_id,organizations_id,alert_key,source,severity,title,message,metadata)
    VALUES(v_user,p_organizations_id,'whatsapp_reconciliation','worker','warning','WhatsApp requer reconciliação',v_value||' parte(s) possuem resultado incerto.',jsonb_build_object('count',v_value))
    ON CONFLICT(organizations_id,alert_key) DO UPDATE SET status='open',last_detected_at=v_now,message=excluded.message,metadata=excluded.metadata,resolved_at=NULL;
    v_count:=v_count+1;
  ELSE UPDATE public.operational_alerts SET status='resolved',resolved_at=v_now WHERE organizations_id=p_organizations_id AND alert_key='whatsapp_reconciliation' AND status<>'resolved'; END IF;

  SELECT count(*) INTO v_value FROM public.instagram_queue_progress WHERE organizations_id=p_organizations_id AND canonical_step='reconciliation_required';
  IF v_value>0 THEN
    INSERT INTO public.operational_alerts(users_id,organizations_id,alert_key,source,severity,title,message,metadata)
    VALUES(v_user,p_organizations_id,'instagram_reconciliation','instagram','warning','Instagram requer reconciliação',v_value||' item(ns) possuem resultado incerto.',jsonb_build_object('count',v_value))
    ON CONFLICT(organizations_id,alert_key) DO UPDATE SET status='open',last_detected_at=v_now,message=excluded.message,metadata=excluded.metadata,resolved_at=NULL;
    v_count:=v_count+1;
  ELSE UPDATE public.operational_alerts SET status='resolved',resolved_at=v_now WHERE organizations_id=p_organizations_id AND alert_key='instagram_reconciliation' AND status<>'resolved'; END IF;

  -- Worker é obrigatório quando o WhatsApp Manager está habilitado.
  IF EXISTS(SELECT 1 FROM public.organization_tools WHERE organizations_id=p_organizations_id AND tool_id='vinsansi_whatsapp_manager' AND enabled) THEN
    SELECT count(*) INTO v_value FROM public.platform_runtime_heartbeats WHERE organizations_id=p_organizations_id AND component_type='worker' AND last_seen_at>v_now-interval '2 minutes' AND runtime_status IN('online','degraded');
    IF v_value=0 THEN
      INSERT INTO public.operational_alerts(users_id,organizations_id,alert_key,source,severity,title,message,metadata)
      VALUES(v_user,p_organizations_id,'worker_heartbeat_missing','worker','critical','Worker sem heartbeat','Nenhum Worker da organização comunicou nos últimos 2 minutos.','{}'::jsonb)
      ON CONFLICT(organizations_id,alert_key) DO UPDATE SET status='open',last_detected_at=v_now,message=excluded.message,resolved_at=NULL;
      v_count:=v_count+1;
    ELSE UPDATE public.operational_alerts SET status='resolved',resolved_at=v_now WHERE organizations_id=p_organizations_id AND alert_key='worker_heartbeat_missing' AND status<>'resolved'; END IF;
  END IF;

  -- Instalações registradas das ferramentas locais devem reportar presença.
  SELECT count(*) INTO v_value FROM public.organization_tool_installations i
  WHERE i.organizations_id=p_organizations_id AND i.registration_status='registered' AND i.tool_id IN('vinsansi_capture','vinsansi_instagram')
    AND (i.last_seen_at IS NULL OR i.last_seen_at<v_now-interval '3 minutes');
  IF v_value>0 THEN
    INSERT INTO public.operational_alerts(users_id,organizations_id,alert_key,source,severity,title,message,metadata)
    VALUES(v_user,p_organizations_id,'tool_installation_stale','tools','warning','Ferramenta local sem comunicação',v_value||' instalação(ões) não comunicaram nos últimos 3 minutos.',jsonb_build_object('count',v_value))
    ON CONFLICT(organizations_id,alert_key) DO UPDATE SET status='open',last_detected_at=v_now,message=excluded.message,metadata=excluded.metadata,resolved_at=NULL;
    v_count:=v_count+1;
  ELSE UPDATE public.operational_alerts SET status='resolved',resolved_at=v_now WHERE organizations_id=p_organizations_id AND alert_key='tool_installation_stale' AND status<>'resolved'; END IF;

  RETURN v_count;
END; $$;
REVOKE ALL ON FUNCTION public.refresh_operational_alerts(bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_operational_alerts(bigint) TO service_role;


-- Recuperação stale com escopo por organização; nunca toca execução de outro tenant.
CREATE OR REPLACE FUNCTION public.worker_recover_stale_whatsapp_v2(p_organizations_id bigint,p_stale_before timestamptz DEFAULT now()-interval '15 minutes')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE r record;v_recovered integer:=0;v_reconciliation integer:=0;
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required';END IF;
 FOR r IN SELECT qi.queue_items_id FROM public.queue_items qi WHERE qi.organizations_id=p_organizations_id AND qi.status_id=4 AND coalesce(qi.queue_items_started_at,qi.queue_items_updated_at)<p_stale_before FOR UPDATE OF qi SKIP LOCKED LOOP
   IF EXISTS(SELECT 1 FROM public.queue_item_dispatch_parts p WHERE p.organizations_id=p_organizations_id AND p.queue_items_id=r.queue_items_id AND p.queue_item_dispatch_parts_state='processing') THEN
     UPDATE public.queue_item_dispatch_parts SET queue_item_dispatch_parts_state='reconciliation_required',queue_item_dispatch_parts_claim_token=NULL,queue_item_dispatch_parts_error_message='worker_restart_after_provider_claim',queue_item_dispatch_parts_updated_at=now() WHERE organizations_id=p_organizations_id AND queue_items_id=r.queue_items_id AND queue_item_dispatch_parts_state='processing';
     UPDATE public.queue_items SET status_id=6,queue_items_error_message='reconciliation_required_after_worker_restart',queue_items_finished_at=now(),queue_items_updated_at=now() WHERE organizations_id=p_organizations_id AND queue_items_id=r.queue_items_id;
     UPDATE public.worker_batch_items SET status_id=6,worker_batch_items_error_message='reconciliation_required_after_worker_restart',worker_batch_items_finished_at=now(),worker_batch_items_updated_at=now() WHERE organizations_id=p_organizations_id AND queue_items_id=r.queue_items_id AND status_id=4;
     v_reconciliation:=v_reconciliation+1;
   ELSE
     UPDATE public.queue_items SET status_id=3,queue_items_error_message=NULL,queue_items_started_at=NULL,queue_items_finished_at=NULL,queue_items_updated_at=now() WHERE organizations_id=p_organizations_id AND queue_items_id=r.queue_items_id;
     UPDATE public.worker_batch_items SET status_id=3,worker_batch_items_started_at=NULL,worker_batch_items_finished_at=NULL,worker_batch_items_error_message=NULL,worker_batch_items_updated_at=now() WHERE organizations_id=p_organizations_id AND queue_items_id=r.queue_items_id AND status_id=4;
     v_recovered:=v_recovered+1;
   END IF;
 END LOOP;
 UPDATE public.worker_batches SET worker_batches_next_run_at=now(),worker_batches_heartbeat_at=now(),worker_batches_updated_at=now() WHERE organizations_id=p_organizations_id AND status_id=4 AND worker_batches_heartbeat_at<p_stale_before;
 RETURN jsonb_build_object('recovered_items',v_recovered,'reconciliation_items',v_reconciliation);
END; $$;
REVOKE ALL ON FUNCTION public.worker_recover_stale_whatsapp_v2(bigint,timestamptz) FROM PUBLIC,anon,authenticated;GRANT EXECUTE ON FUNCTION public.worker_recover_stale_whatsapp_v2(bigint,timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.instagram_recover_stale_items_v2(p_organizations_id bigint,p_stale_before timestamptz DEFAULT now()-interval '15 minutes')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE r record;v_requeued integer:=0;v_reconciliation integer:=0;v_next text;
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required';END IF;
 FOR r IN SELECT p.instagram_queue_progress_id,p.queue_items_id,p.socials_id,p.canonical_step,p.claim_token FROM public.instagram_queue_progress p WHERE p.organizations_id=p_organizations_id AND p.canonical_step IN('claimed','opening_profile','following','followed','opening_dm','sending') AND coalesce(p.last_heartbeat_at,p.instagram_queue_progress_updated_at)<p_stale_before FOR UPDATE OF p SKIP LOCKED LOOP
   IF r.canonical_step='sending' THEN
     v_next:='reconciliation_required';v_reconciliation:=v_reconciliation+1;
     UPDATE public.instagram_queue_progress SET canonical_step=v_next,step=v_next,error_message='stale_after_possible_dispatch',finished_at=now(),instagram_queue_progress_updated_at=now() WHERE instagram_queue_progress_id=r.instagram_queue_progress_id;
     UPDATE public.queue_items SET status_id=6,queue_items_error_message='instagram_reconciliation_required',queue_items_finished_at=now(),queue_items_updated_at=now() WHERE organizations_id=p_organizations_id AND queue_items_id=r.queue_items_id;
   ELSE
     v_next:='queued';v_requeued:=v_requeued+1;
     UPDATE public.instagram_queue_progress SET canonical_step='queued',step='queued',claim_token=NULL,claimed_by=NULL,error_message='recovered_stale_claim',instagram_queue_progress_updated_at=now() WHERE instagram_queue_progress_id=r.instagram_queue_progress_id;
     UPDATE public.queue_items SET status_id=3,queue_items_started_at=NULL,queue_items_error_message=NULL,queue_items_finished_at=NULL,queue_items_updated_at=now() WHERE organizations_id=p_organizations_id AND queue_items_id=r.queue_items_id;
   END IF;
   INSERT INTO public.instagram_dispatch_events(users_id,organizations_id,queue_items_id,socials_id,from_step,to_step,actor,message) SELECT qi.users_id,p_organizations_id,r.queue_items_id,r.socials_id,r.canonical_step,v_next,'recovery','stale_execution_recovered' FROM public.queue_items qi WHERE qi.queue_items_id=r.queue_items_id;
 END LOOP;
 RETURN jsonb_build_object('requeued',v_requeued,'reconciliation',v_reconciliation);
END; $$;
REVOKE ALL ON FUNCTION public.instagram_recover_stale_items_v2(bigint,timestamptz) FROM PUBLIC,anon,authenticated;GRANT EXECUTE ON FUNCTION public.instagram_recover_stale_items_v2(bigint,timestamptz) TO service_role;

-- Saúde operacional completa e tenant-aware.
CREATE OR REPLACE FUNCTION public.get_operational_health()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO pg_catalog,public AS $$
DECLARE v_org bigint:=public.current_organization_id(); v_result jsonb;
BEGIN
  PERFORM public.require_organization_permission('monitoring.view');
  SELECT jsonb_build_object(
    'checkedAt',now(),
    'organizationId',v_org,
    'workers',jsonb_build_object(
      'online',(SELECT count(*) FROM public.platform_runtime_heartbeats WHERE organizations_id=v_org AND component_type='worker' AND last_seen_at>now()-interval '2 minutes' AND runtime_status='online'),
      'stale',(SELECT count(*) FROM public.platform_runtime_heartbeats WHERE organizations_id=v_org AND component_type='worker' AND last_seen_at<=now()-interval '2 minutes')
    ),
    'components',coalesce((SELECT jsonb_agg(jsonb_build_object('type',component_type,'key',component_key,'version',component_version,'status',CASE WHEN last_seen_at<=now()-interval '3 minutes' THEN 'offline' ELSE runtime_status END,'lastSeenAt',last_seen_at,'lastActivityAt',last_meaningful_activity_at,'metrics',metrics,'metadata',metadata) ORDER BY component_type,component_key) FROM public.platform_runtime_heartbeats WHERE organizations_id=v_org),'[]'::jsonb),
    'queues',jsonb_build_object(
      'pending',(SELECT count(*) FROM public.queue_items WHERE organizations_id=v_org AND status_id=3),
      'processing',(SELECT count(*) FROM public.queue_items WHERE organizations_id=v_org AND status_id=4),
      'staleProcessing',(SELECT count(*) FROM public.queue_items WHERE organizations_id=v_org AND status_id=4 AND queue_items_updated_at<now()-interval '15 minutes'),
      'errors',(SELECT count(*) FROM public.queue_items WHERE organizations_id=v_org AND status_id=6)
    ),
    'reconciliation',jsonb_build_object(
      'whatsapp',(SELECT count(*) FROM public.queue_item_dispatch_parts WHERE organizations_id=v_org AND queue_item_dispatch_parts_state='reconciliation_required'),
      'instagram',(SELECT count(*) FROM public.instagram_queue_progress WHERE organizations_id=v_org AND canonical_step='reconciliation_required')
    ),
    'batches',jsonb_build_object(
      'active',(SELECT count(*) FROM public.worker_batches WHERE organizations_id=v_org AND status_id IN(3,4,8)),
      'stale',(SELECT count(*) FROM public.worker_batches WHERE organizations_id=v_org AND status_id=4 AND worker_batches_heartbeat_at<now()-interval '15 minutes')
    ),
    'tools',jsonb_build_object(
      'registered',(SELECT count(*) FROM public.organization_tool_installations WHERE organizations_id=v_org AND registration_status='registered'),
      'stale',(SELECT count(*) FROM public.organization_tool_installations WHERE organizations_id=v_org AND registration_status='registered' AND (last_seen_at IS NULL OR last_seen_at<now()-interval '3 minutes'))
    ),
    'alerts',jsonb_build_object(
      'open',(SELECT count(*) FROM public.operational_alerts WHERE organizations_id=v_org AND status<>'resolved'),
      'critical',(SELECT count(*) FROM public.operational_alerts WHERE organizations_id=v_org AND status<>'resolved' AND severity='critical')
    ),
    'latestRecovery',(SELECT to_jsonb(r) FROM public.recovery_requests r WHERE r.organizations_id=v_org ORDER BY r.requested_at DESC LIMIT 1)
  ) INTO v_result;
  RETURN v_result;
END; $$;
GRANT EXECUTE ON FUNCTION public.get_operational_health() TO authenticated;

COMMIT;

-- ======================================================================
-- ETAPA 12
-- ======================================================================
BEGIN;

-- ETAPA 12 — consolidação estrutural, manifesto de schema e remoção de bridges obsoletas.

DO $stage_preflight$
DECLARE v_missing text[]:=ARRAY[]::text[]; v_name text;
BEGIN
  FOREACH v_name IN ARRAY ARRAY['platform_schema_releases','operational_alerts'] LOOP IF to_regclass('public.'||v_name) IS NULL THEN v_missing:=array_append(v_missing,'table:'||v_name);END IF;END LOOP;
  FOREACH v_name IN ARRAY ARRAY['get_operational_health'] LOOP IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=v_name) THEN v_missing:=array_append(v_missing,'function:'||v_name);END IF;END LOOP;
  IF cardinality(v_missing)>0 THEN RAISE EXCEPTION 'stage_preflight_failed:%',array_to_string(v_missing,',');END IF;
END
$stage_preflight$;

ALTER TABLE public.platform_schema_releases
  ADD COLUMN IF NOT EXISTS schema_contract_version text,
  ADD COLUMN IF NOT EXISTS minimum_application_version text,
  ADD COLUMN IF NOT EXISTS is_stable boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.platform_schema_contracts (
  schema_contract_version text PRIMARY KEY,
  application_version text NOT NULL,
  required_tables text[] NOT NULL,
  required_functions text[] NOT NULL,
  retired_objects text[] NOT NULL DEFAULT '{}',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.platform_schema_contracts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS platform_schema_contracts_read ON public.platform_schema_contracts;
CREATE POLICY platform_schema_contracts_read ON public.platform_schema_contracts FOR SELECT TO authenticated USING(true);
REVOKE INSERT,UPDATE,DELETE ON public.platform_schema_contracts FROM anon,authenticated;
GRANT SELECT ON public.platform_schema_contracts TO authenticated;
GRANT ALL ON public.platform_schema_contracts TO service_role;

INSERT INTO public.platform_schema_contracts(schema_contract_version,application_version,required_tables,required_functions,retired_objects,notes)
VALUES('2026.08.23.12','2.1.0',
 ARRAY['organizations','organization_members','platform_tools','organization_tools','organization_tool_installations','tool_user_sessions','leads','lead_identity_registry','contact_suppressions','queues','queue_items','sents','conversations','conversation_messages','maps_search_executions','maps_search_candidates','capture_execution_events','instagram_queue_progress','instagram_profile_runtime','permanent_records','permanent_record_events','platform_runtime_heartbeats','operational_alerts','recovery_requests','audit_events'],
 ARRAY['current_organization_id','require_organization_permission','append_audit_event','service_capture_identity_gate','instagram_claim_queue_item_v2','instagram_update_queue_progress_v2','commercial_reentry_decision','service_runtime_heartbeat','get_operational_health'],
 ARRAY['maps_extension_installations','maps_extension_pairings','instagram_claim_queue_item','instagram_update_queue_progress','get_operational_health_rbac_inner'],
 'Contrato consolidado das Etapas 2–12; bridges de Maps/Instagram antigas deixam de ser contratos oficiais.')
ON CONFLICT(schema_contract_version) DO UPDATE SET application_version=excluded.application_version,required_tables=excluded.required_tables,required_functions=excluded.required_functions,retired_objects=excluded.retired_objects,notes=excluded.notes;

INSERT INTO public.platform_schema_releases(release_key,application_version,migration_count,base_schema_sha256,notes,schema_contract_version,minimum_application_version,is_stable,metadata)
VALUES('stage-12-consolidation-20260823','2.1.0',18,encode(extensions.digest('stage-12-consolidation-20260823','sha256'),'hex'),'Schema oficial multi-organização consolidado até a Etapa 12.','2026.08.23.12','2.1.0',false,jsonb_build_object('stages',jsonb_build_array(1,2,3,4,5,6,7,8,9,10,11,12)))
ON CONFLICT(release_key) DO UPDATE SET application_version=excluded.application_version,migration_count=excluded.migration_count,base_schema_sha256=excluded.base_schema_sha256,notes=excluded.notes,schema_contract_version=excluded.schema_contract_version,minimum_application_version=excluded.minimum_application_version,metadata=excluded.metadata,applied_at=now();

-- Diagnóstico verificável de contrato atual.
CREATE OR REPLACE FUNCTION public.platform_schema_health()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO pg_catalog,public AS $$
DECLARE v_contract public.platform_schema_contracts%ROWTYPE;v_missing_tables text[]:=ARRAY[]::text[];v_missing_functions text[]:=ARRAY[]::text[];v_retired_present text[]:=ARRAY[]::text[];v_name text;
BEGIN
 SELECT * INTO v_contract FROM public.platform_schema_contracts ORDER BY created_at DESC,schema_contract_version DESC LIMIT 1;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','schema_contract_not_found','checkedAt',now());END IF;
 FOREACH v_name IN ARRAY v_contract.required_tables LOOP IF to_regclass('public.'||v_name) IS NULL THEN v_missing_tables:=array_append(v_missing_tables,v_name);END IF;END LOOP;
 FOREACH v_name IN ARRAY v_contract.required_functions LOOP IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=v_name) THEN v_missing_functions:=array_append(v_missing_functions,v_name);END IF;END LOOP;
 FOREACH v_name IN ARRAY v_contract.retired_objects LOOP IF to_regclass('public.'||v_name) IS NOT NULL OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=v_name) THEN v_retired_present:=array_append(v_retired_present,v_name);END IF;END LOOP;
 RETURN jsonb_build_object('ok',cardinality(v_missing_tables)=0 AND cardinality(v_missing_functions)=0,'contractVersion',v_contract.schema_contract_version,'applicationVersion',v_contract.application_version,'missingTables',to_jsonb(v_missing_tables),'missingFunctions',to_jsonb(v_missing_functions),'retiredObjectsStillPresent',to_jsonb(v_retired_present),'checkedAt',now());
END; $$;
GRANT EXECUTE ON FUNCTION public.platform_schema_health() TO authenticated,service_role;

-- Contratos antigos que já possuem substitutos oficiais. CASCADE não é usado para evitar remover dependências ocultas.
DROP FUNCTION IF EXISTS public.instagram_claim_queue_item(bigint,bigint,bigint,text);
DROP FUNCTION IF EXISTS public.instagram_update_queue_progress(bigint,bigint,uuid,text,text,jsonb);
DROP FUNCTION IF EXISTS public.get_operational_health_rbac_inner();
DROP FUNCTION IF EXISTS public.request_operational_recovery_rbac_inner(text);

-- RLS sanity: objetos de negócio tenant-aware permanecem sem escrita direta authenticated.
DO $rls_sanity$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['lead_identity_registry','contact_suppressions','permanent_records','permanent_record_events','capture_execution_events','instagram_queue_progress','instagram_dispatch_events','platform_runtime_heartbeats','operational_alerts','recovery_requests'] LOOP
  IF to_regclass('public.'||t) IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE INSERT,UPDATE,DELETE ON public.%I FROM anon,authenticated',t);
  END IF;
 END LOOP;
END
$rls_sanity$;

COMMIT;

-- ======================================================================
-- ETAPA 13
-- ======================================================================
BEGIN;

-- ETAPA 13 — orquestração ponta a ponta da operação.

DO $stage_preflight$
DECLARE v_missing text[]:=ARRAY[]::text[]; v_name text;
BEGIN
  FOREACH v_name IN ARRAY ARRAY['platform_schema_contracts','permanent_records'] LOOP IF to_regclass('public.'||v_name) IS NULL THEN v_missing:=array_append(v_missing,'table:'||v_name);END IF;END LOOP;
  FOREACH v_name IN ARRAY ARRAY['platform_schema_health'] LOOP IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=v_name) THEN v_missing:=array_append(v_missing,'function:'||v_name);END IF;END LOOP;
  IF cardinality(v_missing)>0 THEN RAISE EXCEPTION 'stage_preflight_failed:%',array_to_string(v_missing,',');END IF;
END
$stage_preflight$;

CREATE TABLE IF NOT EXISTS public.lead_orchestration_state (
  lead_orchestration_state_id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  organizations_id bigint NOT NULL REFERENCES public.organizations(organizations_id) ON DELETE CASCADE,
  leads_id bigint NOT NULL REFERENCES public.leads(leads_id) ON DELETE CASCADE,
  orchestration_state text NOT NULL DEFAULT 'waiting_validation' CHECK(orchestration_state IN ('waiting_validation','eligible','blocked','capacity_wait','queued','dispatching','sent','responded','finalized','reconciliation_required','error')),
  routed_channel text CHECK(routed_channel IS NULL OR routed_channel IN ('whatsapp','instagram')),
  resource_id bigint,
  templates_id bigint REFERENCES public.templates(templates_id) ON DELETE SET NULL,
  queue_items_id bigint REFERENCES public.queue_items(queue_items_id) ON DELETE SET NULL,
  block_reason text,
  next_attempt_at timestamptz,
  last_evaluated_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organizations_id,leads_id)
);
CREATE INDEX IF NOT EXISTS lead_orchestration_state_pending_idx ON public.lead_orchestration_state(organizations_id,orchestration_state,next_attempt_at,last_evaluated_at);
ALTER TABLE public.lead_orchestration_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lead_orchestration_state_org_select ON public.lead_orchestration_state;
CREATE POLICY lead_orchestration_state_org_select ON public.lead_orchestration_state FOR SELECT TO authenticated USING(organizations_id=public.current_organization_id() AND public.has_organization_permission('leads.view'));
REVOKE INSERT,UPDATE,DELETE ON public.lead_orchestration_state FROM anon,authenticated;GRANT SELECT ON public.lead_orchestration_state TO authenticated;GRANT ALL ON public.lead_orchestration_state TO service_role;

CREATE TABLE IF NOT EXISTS public.lead_lifecycle_events (
  lead_lifecycle_events_id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  organizations_id bigint NOT NULL REFERENCES public.organizations(organizations_id) ON DELETE CASCADE,
  leads_id bigint NOT NULL REFERENCES public.leads(leads_id) ON DELETE CASCADE,
  event_type text NOT NULL,
  channel text,
  entity_type text,
  entity_id text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lead_lifecycle_events_lead_idx ON public.lead_lifecycle_events(organizations_id,leads_id,created_at,lead_lifecycle_events_id);
ALTER TABLE public.lead_lifecycle_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lead_lifecycle_events_org_select ON public.lead_lifecycle_events;
CREATE POLICY lead_lifecycle_events_org_select ON public.lead_lifecycle_events FOR SELECT TO authenticated USING(organizations_id=public.current_organization_id() AND public.has_organization_permission('leads.view'));
REVOKE INSERT,UPDATE,DELETE ON public.lead_lifecycle_events FROM anon,authenticated;GRANT SELECT ON public.lead_lifecycle_events TO authenticated;GRANT ALL ON public.lead_lifecycle_events TO service_role;

CREATE OR REPLACE FUNCTION public.service_set_orchestration_state(p_organizations_id bigint,p_leads_id bigint,p_state text,p_channel text DEFAULT NULL,p_resource_id bigint DEFAULT NULL,p_templates_id bigint DEFAULT NULL,p_queue_items_id bigint DEFAULT NULL,p_reason text DEFAULT NULL,p_metadata jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required';END IF;
 INSERT INTO public.lead_orchestration_state(organizations_id,leads_id,orchestration_state,routed_channel,resource_id,templates_id,queue_items_id,block_reason,next_attempt_at,last_evaluated_at,metadata)
 VALUES(p_organizations_id,p_leads_id,p_state,p_channel,p_resource_id,p_templates_id,p_queue_items_id,p_reason,CASE WHEN p_state='capacity_wait' THEN now()+interval '10 minutes' ELSE NULL END,now(),coalesce(p_metadata,'{}'))
 ON CONFLICT(organizations_id,leads_id) DO UPDATE SET orchestration_state=excluded.orchestration_state,routed_channel=excluded.routed_channel,resource_id=excluded.resource_id,templates_id=excluded.templates_id,queue_items_id=excluded.queue_items_id,block_reason=excluded.block_reason,next_attempt_at=excluded.next_attempt_at,last_evaluated_at=now(),metadata=public.lead_orchestration_state.metadata||excluded.metadata,updated_at=now();
 INSERT INTO public.lead_lifecycle_events(organizations_id,leads_id,event_type,channel,entity_type,entity_id,payload) VALUES(p_organizations_id,p_leads_id,'orchestration:'||p_state,p_channel,'lead',p_leads_id::text,jsonb_build_object('reason',p_reason,'resourceId',p_resource_id,'templateId',p_templates_id,'queueItemId',p_queue_items_id)||coalesce(p_metadata,'{}'));
END; $$;
REVOKE ALL ON FUNCTION public.service_set_orchestration_state(bigint,bigint,text,text,bigint,bigint,bigint,text,jsonb) FROM PUBLIC,anon,authenticated;GRANT EXECUTE ON FUNCTION public.service_set_orchestration_state(bigint,bigint,text,text,bigint,bigint,bigint,text,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.service_orchestrate_lead(p_organizations_id bigint,p_leads_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE l public.leads%ROWTYPE;v_channel text;v_channel_id bigint;v_resource bigint;v_template bigint;v_queue bigint;v_item bigint;v_user bigint;v_name text;v_usage integer;v_limit integer;v_reentry jsonb;v_capacity jsonb;v_existing bigint;v_has_phone boolean;v_has_instagram boolean;
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required';END IF;
 SELECT * INTO l FROM public.leads WHERE organizations_id=p_organizations_id AND leads_id=p_leads_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('outcome','not_found');END IF;
 v_user:=l.users_id;v_has_phone:=length(regexp_replace(coalesce(l.leads_whatsapp,l.leads_phone,''),'\\D','','g'))>=10;v_has_instagram:=nullif(trim(coalesce(l.leads_instagram,'')),'') IS NOT NULL;
 IF l.lead_status_id=5 THEN PERFORM public.service_set_orchestration_state(p_organizations_id,p_leads_id,'sent',NULL,NULL,NULL,NULL,NULL,'{}');RETURN jsonb_build_object('outcome','sent');END IF;
 IF l.lead_status_id IN(6,7,8) THEN PERFORM public.service_set_orchestration_state(p_organizations_id,p_leads_id,'finalized',NULL,NULL,NULL,NULL,'lead_finalized','{}');RETURN jsonb_build_object('outcome','finalized');END IF;
 IF l.lead_status_id<>2 THEN PERFORM public.service_set_orchestration_state(p_organizations_id,p_leads_id,'waiting_validation',NULL,NULL,NULL,NULL,'lead_not_validated',jsonb_build_object('statusId',l.lead_status_id));RETURN jsonb_build_object('outcome','waiting_validation');END IF;
 IF EXISTS(SELECT 1 FROM public.contact_suppressions s WHERE s.organizations_id=p_organizations_id AND s.is_active AND (s.expires_at IS NULL OR s.expires_at>now()) AND ((s.identity_type='phone' AND s.identity_value=l.leads_normalized_phone) OR (s.identity_type='instagram' AND s.identity_value=l.leads_normalized_instagram) OR (s.identity_type='domain' AND s.identity_value=l.leads_normalized_domain) OR (s.identity_type='maps' AND s.identity_value=l.leads_normalized_maps))) THEN
   PERFORM public.service_set_orchestration_state(p_organizations_id,p_leads_id,'blocked',NULL,NULL,NULL,NULL,'contact_suppressed','{}');RETURN jsonb_build_object('outcome','blocked','reason','contact_suppressed');
 END IF;
 IF EXISTS(SELECT 1 FROM public.permanent_records pr WHERE pr.organizations_id=p_organizations_id AND pr.canonical_lead_id=coalesce(l.canonical_lead_id,l.leads_id)) THEN
   v_reentry:=public.commercial_reentry_decision(p_organizations_id,coalesce(l.canonical_lead_id,l.leads_id),now());
   IF coalesce((v_reentry->>'allowed')::boolean,false)=false THEN PERFORM public.service_set_orchestration_state(p_organizations_id,p_leads_id,'blocked',NULL,NULL,NULL,NULL,'commercial_reentry_blocked',v_reentry);RETURN jsonb_build_object('outcome','blocked','reason','commercial_reentry_blocked','decision',v_reentry);END IF;
 END IF;
 -- O canal já validado é soberano. Fallback só é usado se o registro legado não tiver canal.
 IF l.channels_id=1 AND v_has_phone THEN v_channel:='whatsapp';v_channel_id:=1;
 ELSIF l.channels_id=2 AND v_has_instagram THEN v_channel:='instagram';v_channel_id:=2;
 ELSIF v_has_phone THEN v_channel:='whatsapp';v_channel_id:=1;
 ELSIF v_has_instagram THEN v_channel:='instagram';v_channel_id:=2;
 ELSE PERFORM public.service_set_orchestration_state(p_organizations_id,p_leads_id,'blocked',NULL,NULL,NULL,NULL,'no_supported_contact','{}');RETURN jsonb_build_object('outcome','blocked','reason','no_supported_contact');END IF;

 -- Item ativo existente vence qualquer nova preparação.
 SELECT qi.queue_items_id INTO v_existing FROM public.queue_items qi JOIN public.queues q ON q.queues_id=qi.queues_id WHERE qi.organizations_id=p_organizations_id AND qi.leads_id=p_leads_id AND q.channels_id=v_channel_id AND qi.status_id IN(3,4,5,8) ORDER BY qi.queue_items_created_at DESC LIMIT 1;
 IF v_existing IS NOT NULL THEN PERFORM public.service_set_orchestration_state(p_organizations_id,p_leads_id,CASE WHEN EXISTS(SELECT 1 FROM public.queue_items WHERE queue_items_id=v_existing AND status_id=5) THEN 'sent' ELSE 'queued' END,v_channel,NULL,NULL,v_existing,NULL,'{}');RETURN jsonb_build_object('outcome','already_queued','queueItemId',v_existing,'channel',v_channel);END IF;

 IF v_channel='whatsapp' THEN
   SELECT c.chips_id,lv.levels_daily_limit INTO v_resource,v_limit FROM public.chips c JOIN public.instances i ON i.instances_id=c.instances_id AND i.organizations_id=p_organizations_id JOIN public.levels lv ON lv.levels_id=c.levels_id AND lv.organizations_id=p_organizations_id
   WHERE c.organizations_id=p_organizations_id AND c.status_id=1 AND i.status_id=1 AND lv.status_id=1
   ORDER BY (SELECT count(*) FROM public.queue_items qi WHERE qi.organizations_id=p_organizations_id AND qi.chips_id=c.chips_id AND qi.status_id IN(3,4,5,8) AND coalesce(qi.queue_items_scheduled_at,qi.queue_items_created_at)::date=current_date),c.chips_id LIMIT 1;
   IF v_resource IS NOT NULL THEN SELECT count(*) INTO v_usage FROM public.queue_items qi WHERE qi.organizations_id=p_organizations_id AND qi.chips_id=v_resource AND qi.status_id IN(3,4,5,8) AND coalesce(qi.queue_items_scheduled_at,qi.queue_items_created_at)::date=current_date;END IF;
   IF v_resource IS NULL OR coalesce(v_usage,0)>=coalesce(v_limit,0) THEN PERFORM public.service_set_orchestration_state(p_organizations_id,p_leads_id,'capacity_wait',v_channel,NULL,NULL,NULL,'whatsapp_capacity_unavailable','{}');RETURN jsonb_build_object('outcome','capacity_wait','channel',v_channel);END IF;
 ELSE
   SELECT s.socials_id,public.instagram_profile_capacity(p_organizations_id,s.socials_id,now()) INTO v_resource,v_capacity FROM public.socials s WHERE s.organizations_id=p_organizations_id AND s.status_id=1 ORDER BY s.socials_id LIMIT 1;
   IF v_resource IS NULL OR coalesce((v_capacity->>'allowed')::boolean,false)=false OR coalesce((v_capacity->>'withinWindow')::boolean,false)=false OR coalesce((v_capacity->>'remaining')::integer,0)<=0 THEN PERFORM public.service_set_orchestration_state(p_organizations_id,p_leads_id,'capacity_wait',v_channel,NULL,NULL,NULL,'instagram_capacity_unavailable',coalesce(v_capacity,'{}'));RETURN jsonb_build_object('outcome','capacity_wait','channel',v_channel);END IF;
 END IF;

 -- Template ativo do mesmo ramo. Priorizamos template explicitamente rotulado para o canal.
 SELECT t.templates_id INTO v_template FROM public.templates t LEFT JOIN public.template_channels tc ON tc.template_channels_id=t.template_channels_id WHERE t.organizations_id=p_organizations_id AND t.status_id=1 AND t.branches_id=l.branches_id ORDER BY CASE WHEN lower(coalesce(tc.template_channels_name,'')) LIKE '%'||v_channel||'%' THEN 0 ELSE 1 END,t.templates_id LIMIT 1;
 IF v_template IS NULL THEN PERFORM public.service_set_orchestration_state(p_organizations_id,p_leads_id,'blocked',v_channel,v_resource,NULL,NULL,'template_missing','{}');RETURN jsonb_build_object('outcome','blocked','reason','template_missing','channel',v_channel);END IF;

 PERFORM pg_advisory_xact_lock(hashtextextended(format('orchestrate:%s:%s:%s:%s',p_organizations_id,v_channel,v_resource,current_date),0));
 v_name:=format('Orquestração %s %s #%s',initcap(v_channel),to_char(current_date,'YYYY-MM-DD'),v_resource);
 SELECT queues_id INTO v_queue FROM public.queues WHERE organizations_id=p_organizations_id AND queues_name=v_name LIMIT 1;
 IF v_queue IS NULL THEN INSERT INTO public.queues(users_id,organizations_id,channels_id,status_id,queues_name,queues_scheduled_at) VALUES(v_user,p_organizations_id,v_channel_id,3,v_name,current_date::timestamptz) RETURNING queues_id INTO v_queue;END IF;
 INSERT INTO public.queue_items(users_id,organizations_id,queues_id,leads_id,chips_id,socials_id,templates_id,status_id,queue_items_position,queue_items_attempts,queue_items_scheduled_at)
 VALUES(v_user,p_organizations_id,v_queue,p_leads_id,CASE WHEN v_channel='whatsapp' THEN v_resource ELSE NULL END,CASE WHEN v_channel='instagram' THEN v_resource ELSE NULL END,v_template,3,(SELECT coalesce(max(queue_items_position),0)+1 FROM public.queue_items WHERE queues_id=v_queue),0,current_date::timestamptz)
 ON CONFLICT(queues_id,leads_id) DO UPDATE SET templates_id=excluded.templates_id RETURNING queue_items_id INTO v_item;
 UPDATE public.leads SET channels_id=v_channel_id,lead_status_id=4,leads_updated_at=now() WHERE leads_id=p_leads_id AND organizations_id=p_organizations_id AND lead_status_id=2;
 PERFORM public.service_set_orchestration_state(p_organizations_id,p_leads_id,'queued',v_channel,v_resource,v_template,v_item,NULL,jsonb_build_object('queueId',v_queue));
 RETURN jsonb_build_object('outcome','queued','channel',v_channel,'resourceId',v_resource,'templateId',v_template,'queueId',v_queue,'queueItemId',v_item);
EXCEPTION WHEN OTHERS THEN
 PERFORM public.service_set_orchestration_state(p_organizations_id,p_leads_id,'error',v_channel,v_resource,v_template,v_item,SQLERRM,'{}');
 RETURN jsonb_build_object('outcome','error','error',SQLERRM);
END; $$;
REVOKE ALL ON FUNCTION public.service_orchestrate_lead(bigint,bigint) FROM PUBLIC,anon,authenticated;GRANT EXECUTE ON FUNCTION public.service_orchestrate_lead(bigint,bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.service_orchestrate_ready_leads(p_organizations_id bigint,p_limit integer DEFAULT 25)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE r record;v_results jsonb:='[]'::jsonb;v_result jsonb;v_limit integer:=least(greatest(coalesce(p_limit,25),1),100);
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required';END IF;
 FOR r IN SELECT l.leads_id FROM public.leads l LEFT JOIN public.lead_orchestration_state os ON os.organizations_id=l.organizations_id AND os.leads_id=l.leads_id WHERE l.organizations_id=p_organizations_id AND l.lead_status_id=2 AND (os.leads_id IS NULL OR os.orchestration_state IN('eligible','capacity_wait','error','waiting_validation') AND (os.next_attempt_at IS NULL OR os.next_attempt_at<=now())) ORDER BY l.leads_priority_score DESC NULLS LAST,l.leads_created_at,l.leads_id LIMIT v_limit FOR UPDATE OF l SKIP LOCKED LOOP
   v_result:=public.service_orchestrate_lead(p_organizations_id,r.leads_id);v_results:=v_results||jsonb_build_array(jsonb_build_object('leadId',r.leads_id)||v_result);
 END LOOP;
 RETURN jsonb_build_object('processed',jsonb_array_length(v_results),'results',v_results);
END; $$;
REVOKE ALL ON FUNCTION public.service_orchestrate_ready_leads(bigint,integer) FROM PUBLIC,anon,authenticated;GRANT EXECUTE ON FUNCTION public.service_orchestrate_ready_leads(bigint,integer) TO service_role;

-- Timeline automática para os principais estados do ciclo.
CREATE OR REPLACE FUNCTION public.record_lead_lifecycle_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_lead bigint;v_org bigint;v_event text;v_channel text;v_entity_id text;
BEGIN
 IF TG_TABLE_NAME='leads' THEN v_lead:=NEW.leads_id;v_org:=NEW.organizations_id;v_event:=CASE WHEN TG_OP='INSERT' THEN 'lead:captured' ELSE 'lead:status_changed' END;v_channel:=CASE NEW.channels_id WHEN 1 THEN 'whatsapp' WHEN 2 THEN 'instagram' ELSE NULL END;v_entity_id:=NEW.leads_id::text;
 ELSIF TG_TABLE_NAME='queue_items' THEN v_lead:=NEW.leads_id;v_org:=NEW.organizations_id;v_event:=CASE NEW.status_id WHEN 3 THEN 'queue:queued' WHEN 4 THEN 'queue:processing' WHEN 5 THEN 'queue:completed' WHEN 6 THEN 'queue:error' ELSE 'queue:changed' END;v_entity_id:=NEW.queue_items_id::text;
 ELSIF TG_TABLE_NAME='sents' THEN v_lead:=NEW.leads_id;v_org:=NEW.organizations_id;v_event:=CASE WHEN NEW.sents_sent_at IS NOT NULL THEN 'dispatch:sent' WHEN NEW.status_id=6 THEN 'dispatch:error' ELSE 'dispatch:changed' END;v_channel:=CASE NEW.channels_id WHEN 1 THEN 'whatsapp' WHEN 2 THEN 'instagram' ELSE NULL END;v_entity_id:=NEW.sents_id::text;
 ELSIF TG_TABLE_NAME='conversation_messages' THEN v_lead:=NEW.leads_id;v_org:=NEW.organizations_id;v_event:=CASE WHEN NEW.direction='inbound' THEN 'conversation:inbound' ELSE 'conversation:outbound' END;v_channel:='whatsapp';v_entity_id:=NEW.conversation_messages_id::text;
 END IF;
 IF v_lead IS NOT NULL AND v_org IS NOT NULL THEN INSERT INTO public.lead_lifecycle_events(organizations_id,leads_id,event_type,channel,entity_type,entity_id,payload) VALUES(v_org,v_lead,v_event,v_channel,TG_TABLE_NAME,v_entity_id,to_jsonb(NEW));END IF;
 RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS lead_lifecycle_leads ON public.leads;CREATE TRIGGER lead_lifecycle_leads AFTER INSERT OR UPDATE OF lead_status_id,channels_id ON public.leads FOR EACH ROW EXECUTE FUNCTION public.record_lead_lifecycle_event();
DROP TRIGGER IF EXISTS lead_lifecycle_queue_items ON public.queue_items;CREATE TRIGGER lead_lifecycle_queue_items AFTER INSERT OR UPDATE OF status_id ON public.queue_items FOR EACH ROW EXECUTE FUNCTION public.record_lead_lifecycle_event();
DROP TRIGGER IF EXISTS lead_lifecycle_sents ON public.sents;CREATE TRIGGER lead_lifecycle_sents AFTER INSERT OR UPDATE OF status_id,sents_sent_at ON public.sents FOR EACH ROW EXECUTE FUNCTION public.record_lead_lifecycle_event();
DROP TRIGGER IF EXISTS lead_lifecycle_conversation_messages ON public.conversation_messages;CREATE TRIGGER lead_lifecycle_conversation_messages AFTER INSERT ON public.conversation_messages FOR EACH ROW WHEN(NEW.leads_id IS NOT NULL) EXECUTE FUNCTION public.record_lead_lifecycle_event();

COMMIT;

-- ======================================================================
-- ETAPA 14
-- ======================================================================
BEGIN;

-- ETAPA 14 — instalação, atualização, backup e portabilidade.
-- O backup físico dos volumes é executado pelo Gerenciador Desktop; o banco mantém
-- a matriz oficial de compatibilidade para impedir combinações silenciosamente incompatíveis.

DO $stage_preflight$
DECLARE v_missing text[]:=ARRAY[]::text[]; v_name text;
BEGIN
  FOREACH v_name IN ARRAY ARRAY['platform_schema_contracts'] LOOP IF to_regclass('public.'||v_name) IS NULL THEN v_missing:=array_append(v_missing,'table:'||v_name);END IF;END LOOP;
  FOREACH v_name IN ARRAY ARRAY['service_orchestrate_ready_leads','tool_semver_is_valid'] LOOP IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=v_name) THEN v_missing:=array_append(v_missing,'function:'||v_name);END IF;END LOOP;
  IF cardinality(v_missing)>0 THEN RAISE EXCEPTION 'stage_preflight_failed:%',array_to_string(v_missing,',');END IF;
END
$stage_preflight$;

CREATE TABLE IF NOT EXISTS public.platform_release_channels (
  component_key text PRIMARY KEY,
  display_name text NOT NULL,
  latest_version text NOT NULL,
  minimum_supported_version text NOT NULL,
  stable_version text,
  release_channel text NOT NULL DEFAULT 'stable' CHECK(release_channel IN ('stable','preview','legacy')),
  update_required boolean NOT NULL DEFAULT false,
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(metadata)='object'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_release_latest_semver CHECK(public.tool_semver_is_valid(latest_version)),
  CONSTRAINT platform_release_minimum_semver CHECK(public.tool_semver_is_valid(minimum_supported_version)),
  CONSTRAINT platform_release_stable_semver CHECK(stable_version IS NULL OR public.tool_semver_is_valid(stable_version))
);
ALTER TABLE public.platform_release_channels ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS platform_release_channels_read ON public.platform_release_channels;
CREATE POLICY platform_release_channels_read ON public.platform_release_channels FOR SELECT TO authenticated USING(true);
REVOKE INSERT,UPDATE,DELETE ON public.platform_release_channels FROM anon,authenticated;
GRANT SELECT ON public.platform_release_channels TO authenticated;
GRANT ALL ON public.platform_release_channels TO service_role;

INSERT INTO public.platform_release_channels(component_key,display_name,latest_version,minimum_supported_version,stable_version,release_channel,update_required,notes,metadata)
VALUES
 ('crm','CRM - Vinsansi Studio','2.3.0','2.3.0',NULL,'preview',true,'Release da Etapa 14; a Stable é promovida somente na Etapa 15.',jsonb_build_object('stage',14)),
 ('manager','CRM - Gerenciador de Disparos','1.3.1','1.3.0',NULL,'preview',true,'Inclui instalador NSIS, atualização gerenciada e backup/restore portátil com volumes Docker.',jsonb_build_object('stage',14)),
 ('worker','Worker WhatsApp','3.13.1','3.13.0',NULL,'preview',true,'Worker organizacional com observabilidade e orquestração.',jsonb_build_object('stage',13)),
 ('gateway','Vinsansi WhatsApp Gateway','1.2.7','1.2.7','1.2.7','stable',false,'Gateway texto-only homologado na Etapa 5.',jsonb_build_object('stage',5)),
 ('evolution','Evolution Go','0.7.2','0.7.2','0.7.2','stable',false,'Provider WhatsApp fixado; nunca usar latest.',jsonb_build_object('stage',5)),
 ('capture','Vinsansi Captura','1.0.0','1.0.0',NULL,'preview',true,'Executor Google Maps oficial da Etapa 8.',jsonb_build_object('stage',8)),
 ('instagram','Vinsansi Instagram','2.0.2','2.0.0',NULL,'preview',true,'Executor outbound Instagram oficial da Etapa 9.',jsonb_build_object('stage',9))
ON CONFLICT(component_key) DO UPDATE SET display_name=excluded.display_name,latest_version=excluded.latest_version,minimum_supported_version=excluded.minimum_supported_version,stable_version=excluded.stable_version,release_channel=excluded.release_channel,update_required=excluded.update_required,notes=excluded.notes,metadata=excluded.metadata,updated_at=now();

CREATE OR REPLACE FUNCTION public.platform_semver_parts(p_version text)
RETURNS integer[] LANGUAGE plpgsql IMMUTABLE STRICT SET search_path TO pg_catalog,public AS $$
DECLARE v text:=trim(p_version);m text[];
BEGIN
 m:=regexp_match(v,'^([0-9]+)\.([0-9]+)\.([0-9]+)(?:[-+].*)?$');
 IF m IS NULL THEN RETURN NULL;END IF;
 RETURN ARRAY[m[1]::integer,m[2]::integer,m[3]::integer];
END; $$;

CREATE OR REPLACE FUNCTION public.platform_semver_compare(p_left text,p_right text)
RETURNS integer LANGUAGE plpgsql IMMUTABLE STRICT SET search_path TO pg_catalog,public AS $$
DECLARE a integer[]:=public.platform_semver_parts(p_left);b integer[]:=public.platform_semver_parts(p_right);i integer;
BEGIN
 IF a IS NULL OR b IS NULL THEN RAISE EXCEPTION 'invalid_semver';END IF;
 FOR i IN 1..3 LOOP IF a[i]<b[i] THEN RETURN -1;ELSIF a[i]>b[i] THEN RETURN 1;END IF;END LOOP;RETURN 0;
END; $$;

CREATE OR REPLACE FUNCTION public.platform_component_compatibility(p_component_key text,p_version text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO pg_catalog,public AS $$
DECLARE r public.platform_release_channels%ROWTYPE;v_cmp integer;
BEGIN
 SELECT * INTO r FROM public.platform_release_channels WHERE component_key=lower(trim(p_component_key));
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'compatible',false,'error','component_unknown','component',p_component_key);END IF;
 IF NOT public.tool_semver_is_valid(p_version) THEN RETURN jsonb_build_object('ok',false,'compatible',false,'error','version_invalid','component',r.component_key,'version',p_version);END IF;
 v_cmp:=public.platform_semver_compare(p_version,r.minimum_supported_version);
 RETURN jsonb_build_object('ok',true,'compatible',v_cmp>=0,'component',r.component_key,'version',p_version,'minimumSupportedVersion',r.minimum_supported_version,'latestVersion',r.latest_version,'stableVersion',r.stable_version,'releaseChannel',r.release_channel,'updateRequired',v_cmp<0 OR (r.update_required AND public.platform_semver_compare(p_version,r.latest_version)<0));
END; $$;
GRANT EXECUTE ON FUNCTION public.platform_component_compatibility(text,text) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.platform_release_matrix()
RETURNS jsonb LANGUAGE sql SECURITY DEFINER STABLE SET search_path TO pg_catalog,public AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('component',component_key,'name',display_name,'latestVersion',latest_version,'minimumSupportedVersion',minimum_supported_version,'stableVersion',stable_version,'channel',release_channel,'updateRequired',update_required,'notes',notes) ORDER BY component_key),'[]'::jsonb) FROM public.platform_release_channels;
$$;
GRANT EXECUTE ON FUNCTION public.platform_release_matrix() TO authenticated,service_role;

-- Contrato de schema da Etapa 14 já inclui toda a orquestração da Etapa 13 e a matriz de releases.
INSERT INTO public.platform_schema_contracts(schema_contract_version,application_version,required_tables,required_functions,retired_objects,notes)
VALUES('2026.08.24.14','2.3.0',
 ARRAY['organizations','organization_members','platform_tools','organization_tool_installations','tool_browser_pairings','leads','lead_identity_registry','contact_suppressions','queues','queue_items','sents','conversations','conversation_messages','capture_execution_events','instagram_queue_progress','permanent_records','platform_runtime_heartbeats','operational_alerts','lead_orchestration_state','lead_lifecycle_events','platform_release_channels'],
 ARRAY['append_audit_event','service_capture_identity_gate','instagram_claim_queue_item_v2','commercial_reentry_decision','service_runtime_heartbeat','platform_schema_health','service_orchestrate_ready_leads','platform_component_compatibility','platform_release_matrix'],
 ARRAY['maps_extension_installations','maps_extension_pairings','instagram_claim_queue_item','instagram_update_queue_progress','get_operational_health_rbac_inner'],
 'Contrato completo até a Etapa 14, incluindo portabilidade do Desktop e matriz de compatibilidade de versões.')
ON CONFLICT(schema_contract_version) DO UPDATE SET application_version=excluded.application_version,required_tables=excluded.required_tables,required_functions=excluded.required_functions,retired_objects=excluded.retired_objects,notes=excluded.notes;

INSERT INTO public.platform_schema_releases(release_key,application_version,migration_count,base_schema_sha256,notes,schema_contract_version,minimum_application_version,is_stable,metadata)
VALUES('stage-14-portability-20260824','2.3.0',20,encode(extensions.digest('stage-14-portability-20260824','sha256'),'hex'),'Etapa 14: instalação, atualização, backup e portabilidade.','2026.08.24.14','2.3.0',false,jsonb_build_object('stages',jsonb_build_array(1,2,3,4,5,6,7,8,9,10,11,12,13,14),'portableBackupFormat',1))
ON CONFLICT(release_key) DO UPDATE SET application_version=excluded.application_version,migration_count=excluded.migration_count,base_schema_sha256=excluded.base_schema_sha256,notes=excluded.notes,schema_contract_version=excluded.schema_contract_version,minimum_application_version=excluded.minimum_application_version,is_stable=false,metadata=excluded.metadata,applied_at=now();

COMMIT;

-- ======================================================================
-- ETAPA 15
-- ======================================================================
BEGIN;

-- ETAPA 15 — homologação final, readiness verificável e promoção Stable.

DO $stage_preflight$
DECLARE v_missing text[]:=ARRAY[]::text[]; v_name text;
BEGIN
  FOREACH v_name IN ARRAY ARRAY['platform_release_channels','lead_lifecycle_events'] LOOP IF to_regclass('public.'||v_name) IS NULL THEN v_missing:=array_append(v_missing,'table:'||v_name);END IF;END LOOP;
  FOREACH v_name IN ARRAY ARRAY['platform_release_matrix'] LOOP IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=v_name) THEN v_missing:=array_append(v_missing,'function:'||v_name);END IF;END LOOP;
  IF cardinality(v_missing)>0 THEN RAISE EXCEPTION 'stage_preflight_failed:%',array_to_string(v_missing,',');END IF;
END
$stage_preflight$;

CREATE TABLE IF NOT EXISTS public.production_homologation_runs (
  production_homologation_runs_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizations_id bigint NOT NULL REFERENCES public.organizations(organizations_id) ON DELETE CASCADE,
  started_by_member_id bigint REFERENCES public.organization_members(organization_members_id) ON DELETE SET NULL,
  release_version text NOT NULL,
  status text NOT NULL DEFAULT 'running' CHECK(status IN ('running','passed','failed','cancelled')),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  notes text,
  UNIQUE(organizations_id,production_homologation_runs_id)
);
CREATE INDEX IF NOT EXISTS production_homologation_runs_org_idx ON public.production_homologation_runs(organizations_id,started_at DESC);

CREATE TABLE IF NOT EXISTS public.production_homologation_checks (
  production_homologation_checks_id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  organizations_id bigint NOT NULL REFERENCES public.organizations(organizations_id) ON DELETE CASCADE,
  production_homologation_runs_id uuid NOT NULL REFERENCES public.production_homologation_runs(production_homologation_runs_id) ON DELETE CASCADE,
  check_key text NOT NULL,
  section text NOT NULL,
  label text NOT NULL,
  required boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','passed','failed','not_applicable')),
  evidence text,
  checked_by_member_id bigint REFERENCES public.organization_members(organization_members_id) ON DELETE SET NULL,
  checked_at timestamptz,
  sort_order integer NOT NULL DEFAULT 0,
  UNIQUE(production_homologation_runs_id,check_key)
);
CREATE INDEX IF NOT EXISTS production_homologation_checks_run_idx ON public.production_homologation_checks(organizations_id,production_homologation_runs_id,sort_order);

ALTER TABLE public.production_homologation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_homologation_checks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS production_homologation_runs_org_select ON public.production_homologation_runs;
CREATE POLICY production_homologation_runs_org_select ON public.production_homologation_runs FOR SELECT TO authenticated USING(organizations_id=public.current_organization_id() AND public.has_organization_permission('monitoring.view'));
DROP POLICY IF EXISTS production_homologation_checks_org_select ON public.production_homologation_checks;
CREATE POLICY production_homologation_checks_org_select ON public.production_homologation_checks FOR SELECT TO authenticated USING(organizations_id=public.current_organization_id() AND public.has_organization_permission('monitoring.view'));
REVOKE INSERT,UPDATE,DELETE ON public.production_homologation_runs FROM anon,authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.production_homologation_checks FROM anon,authenticated;
GRANT SELECT ON public.production_homologation_runs,public.production_homologation_checks TO authenticated;
GRANT ALL ON public.production_homologation_runs,public.production_homologation_checks TO service_role;

CREATE OR REPLACE FUNCTION public.start_production_homologation(p_notes text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_org bigint:=public.current_organization_id();v_member bigint:=public.current_organization_member_id();v_run uuid:=gen_random_uuid();
BEGIN
 PERFORM public.require_organization_permission('monitoring.manage');
 INSERT INTO public.production_homologation_runs(production_homologation_runs_id,organizations_id,started_by_member_id,release_version,notes) VALUES(v_run,v_org,v_member,'2.4.0',nullif(trim(coalesce(p_notes,'')),''));
 INSERT INTO public.production_homologation_checks(organizations_id,production_homologation_runs_id,check_key,section,label,sort_order) VALUES
 (v_org,v_run,'organization_isolation','Organizações','Isolamento entre organizações e permissões/RBAC validado',10),
 (v_org,v_run,'capture_pairing','Vinsansi Captura','Pairing por organização, configuração central e heartbeat funcionando',20),
 (v_org,v_run,'capture_resume','Vinsansi Captura','Captura real pausa/retoma sem duplicar e importa incrementalmente',30),
 (v_org,v_run,'capture_dedup','Vinsansi Captura','Duplicados e suprimidos são bloqueados antes da reentrada',40),
 (v_org,v_run,'instagram_pairing','Vinsansi Instagram','Perfil vinculado à organização e fila canônica carregada',50),
 (v_org,v_run,'instagram_resume','Vinsansi Instagram','Pausa/restart continua do checkpoint sem repetir DM',60),
 (v_org,v_run,'instagram_limits','Vinsansi Instagram','Limites, janela e capacidade por perfil respeitados',70),
 (v_org,v_run,'permanent_memory','Base Permanente','Uma identidade comercial concentra histórico, canais e resultado',80),
 (v_org,v_run,'suppression_reentry','Base Permanente','Supressão e cooldown de reentrada validados',90),
 (v_org,v_run,'whatsapp_text','WhatsApp','Envio/recebimento texto, realtime e status entregue/lido validados',100),
 (v_org,v_run,'whatsapp_identity','WhatsApp','LID/telefone converge no mesmo chip e não cruza chips',110),
 (v_org,v_run,'whatsapp_reconnect','WhatsApp','Reinício/reconexão preserva sessões e conversas',120),
 (v_org,v_run,'observability','Observabilidade','Heartbeats, alertas e diagnóstico detectam componente parado',130),
 (v_org,v_run,'recovery','Observabilidade','Recuperação controlada libera stale sem duplicar envio',140),
 (v_org,v_run,'audit_append_only','Auditoria','Auditoria append-only registra ator, organização, antes/depois',150),
 (v_org,v_run,'state_machine','Auditoria','Transições inválidas são bloqueadas pelo PostgreSQL',160),
 (v_org,v_run,'orchestration_e2e','Orquestração','Lead real percorre captura → validação → fila → envio → memória sem SQL manual',170),
 (v_org,v_run,'backup_restore','Portabilidade','Backup portátil restaurado em ambiente limpo com volumes e credenciais',180),
 (v_org,v_run,'clean_install','Portabilidade','Instalação do zero concluída sem editar código/usar terminal na operação normal',190),
 (v_org,v_run,'upgrade_existing','Portabilidade','Upgrade da base existente chega ao mesmo contrato do banco limpo',200),
 (v_org,v_run,'failure_matrix','Resiliência','Quedas de internet/processos/webhook repetido não corrompem estado nem duplicam envio',210),
 (v_org,v_run,'security_review','Segurança','RLS, service_role, secrets, CORS e rotas públicas revisados',220),
 (v_org,v_run,'performance','Performance','Volume realista de leads, filas, conversas e auditoria permanece operacional',230);
 PERFORM public.append_audit_event('production','start_homologation','production_homologation_run',v_run::text,NULL,NULL,NULL,NULL,NULL,NULL,jsonb_build_object('release','2.4.0'),NULL);
 RETURN v_run;
END; $$;
GRANT EXECUTE ON FUNCTION public.start_production_homologation(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_production_homologation_check(p_run_id uuid,p_check_key text,p_status text,p_evidence text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_org bigint:=public.current_organization_id();v_member bigint:=public.current_organization_member_id();v_status text:=lower(trim(p_status));v_required_pending integer;v_required_failed integer;
BEGIN
 PERFORM public.require_organization_permission('monitoring.manage');
 IF v_status NOT IN ('pending','passed','failed','not_applicable') THEN RAISE EXCEPTION 'homologation_status_invalid';END IF;
 UPDATE public.production_homologation_checks SET status=v_status,evidence=nullif(trim(coalesce(p_evidence,'')),''),checked_by_member_id=CASE WHEN v_status='pending' THEN NULL ELSE v_member END,checked_at=CASE WHEN v_status='pending' THEN NULL ELSE now() END WHERE organizations_id=v_org AND production_homologation_runs_id=p_run_id AND check_key=p_check_key;
 IF NOT FOUND THEN RAISE EXCEPTION 'homologation_check_not_found';END IF;
 SELECT count(*) FILTER(WHERE required AND status='pending'),count(*) FILTER(WHERE required AND status='failed') INTO v_required_pending,v_required_failed FROM public.production_homologation_checks WHERE organizations_id=v_org AND production_homologation_runs_id=p_run_id;
 UPDATE public.production_homologation_runs SET status=CASE WHEN v_required_failed>0 THEN 'failed' WHEN v_required_pending=0 THEN 'passed' ELSE 'running' END,completed_at=CASE WHEN v_required_pending=0 OR v_required_failed>0 THEN now() ELSE NULL END WHERE organizations_id=v_org AND production_homologation_runs_id=p_run_id;
 RETURN jsonb_build_object('runId',p_run_id,'pending',v_required_pending,'failed',v_required_failed,'status',CASE WHEN v_required_failed>0 THEN 'failed' WHEN v_required_pending=0 THEN 'passed' ELSE 'running' END);
END; $$;
GRANT EXECUTE ON FUNCTION public.set_production_homologation_check(uuid,text,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_production_homologation_snapshot(p_run_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO pg_catalog,public AS $$
DECLARE v_org bigint:=public.current_organization_id();v_run public.production_homologation_runs%ROWTYPE;v_checks jsonb;
BEGIN
 PERFORM public.require_organization_permission('monitoring.view');
 IF p_run_id IS NULL THEN SELECT * INTO v_run FROM public.production_homologation_runs WHERE organizations_id=v_org ORDER BY started_at DESC LIMIT 1;ELSE SELECT * INTO v_run FROM public.production_homologation_runs WHERE organizations_id=v_org AND production_homologation_runs_id=p_run_id;END IF;
 IF NOT FOUND THEN RETURN jsonb_build_object('run',NULL,'checks','[]'::jsonb);END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('key',check_key,'section',section,'label',label,'required',required,'status',status,'evidence',evidence,'checkedAt',checked_at,'checkedByMemberId',checked_by_member_id) ORDER BY sort_order,production_homologation_checks_id),'[]'::jsonb) INTO v_checks FROM public.production_homologation_checks WHERE organizations_id=v_org AND production_homologation_runs_id=v_run.production_homologation_runs_id;
 RETURN jsonb_build_object('run',jsonb_build_object('id',v_run.production_homologation_runs_id,'releaseVersion',v_run.release_version,'status',v_run.status,'startedAt',v_run.started_at,'completedAt',v_run.completed_at,'notes',v_run.notes),'checks',v_checks);
END; $$;
GRANT EXECUTE ON FUNCTION public.get_production_homologation_snapshot(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.platform_production_readiness()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO pg_catalog,public AS $$
DECLARE v_org bigint:=public.current_organization_id();v_schema jsonb;v_health jsonb;v_release jsonb;v_critical integer;v_homologation jsonb;v_hstatus text;
BEGIN
 PERFORM public.require_organization_permission('monitoring.view');
 v_schema:=public.platform_schema_health();v_health:=public.get_operational_health();v_release:=public.platform_release_matrix();v_homologation:=public.get_production_homologation_snapshot(NULL);v_hstatus:=coalesce(v_homologation->'run'->>'status','not_started');
 SELECT count(*) INTO v_critical FROM public.operational_alerts WHERE organizations_id=v_org AND status<>'resolved' AND severity='critical';
 RETURN jsonb_build_object('ok',coalesce((v_schema->>'ok')::boolean,false) AND v_critical=0 AND v_hstatus='passed','schema',v_schema,'health',v_health,'releases',v_release,'homologation',v_homologation,'criticalAlerts',v_critical,'checkedAt',now());
END; $$;
GRANT EXECUTE ON FUNCTION public.platform_production_readiness() TO authenticated;

-- A Etapa 15 instala a homologação, mas NÃO promove Stable automaticamente.
-- A promoção só acontece depois de uma rodada obrigatória aprovada e readiness saudável.
UPDATE public.platform_release_channels
SET latest_version='2.4.0',
    release_channel='preview',
    update_required=CASE WHEN component_key='crm' THEN true ELSE update_required END,
    updated_at=now(),
    notes=CASE WHEN component_key='crm' THEN 'Release candidate 2.4.0 aguardando homologação final.' ELSE notes END
WHERE component_key='crm';

CREATE OR REPLACE FUNCTION public.promote_platform_stable_release()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog,public
AS $$
DECLARE
  v_org bigint:=public.current_organization_id();
  v_run public.production_homologation_runs%ROWTYPE;
  v_schema jsonb;
  v_critical integer:=0;
  v_release_key text:='stable-'||to_char(current_date,'YYYYMMDD');
BEGIN
  PERFORM public.require_organization_permission('monitoring.manage');
  IF NOT public.is_platform_owner(public.current_actor_user_id()) THEN RAISE EXCEPTION 'platform_owner_required_for_stable_promotion'; END IF;
  SELECT * INTO v_run
  FROM public.production_homologation_runs
  WHERE organizations_id=v_org
  ORDER BY started_at DESC
  LIMIT 1;
  IF NOT FOUND OR v_run.status<>'passed' THEN
    RAISE EXCEPTION 'production_homologation_not_passed';
  END IF;

  v_schema:=public.platform_schema_health();
  IF NOT coalesce((v_schema->>'ok')::boolean,false) THEN
    RAISE EXCEPTION 'platform_schema_not_ready';
  END IF;

  SELECT count(*) INTO v_critical
  FROM public.operational_alerts
  WHERE organizations_id=v_org
    AND status<>'resolved'
    AND severity='critical';
  IF v_critical>0 THEN
    RAISE EXCEPTION 'critical_operational_alerts:%',v_critical;
  END IF;

  UPDATE public.platform_release_channels
  SET stable_version=latest_version,
      release_channel='stable',
      update_required=false,
      updated_at=now()
  WHERE component_key IN ('manager','worker','capture','instagram','gateway','evolution');

  UPDATE public.platform_release_channels
  SET latest_version='2.4.0',
      minimum_supported_version='2.4.0',
      stable_version='2.4.0',
      release_channel='stable',
      update_required=false,
      updated_at=now(),
      notes='Vinsansi Studio Stable após homologação das Etapas 1–15.'
  WHERE component_key='crm';

  INSERT INTO public.platform_schema_releases(
    release_key,application_version,migration_count,base_schema_sha256,notes,
    schema_contract_version,minimum_application_version,is_stable,metadata
  ) VALUES(
    v_release_key,'2.4.0',21,encode(extensions.digest(v_release_key,'sha256'),'hex'),
    'Vinsansi Studio Stable — Etapas 1–15.','2026.08.24.15','2.4.0',true,
    jsonb_build_object('stages',jsonb_build_array(1,2,3,4,5,6,7,8,9,10,11,12,13,14,15),'release','stable','textOnlyWhatsapp',true,'homologationRunId',v_run.production_homologation_runs_id,'organizationId',v_org)
  )
  ON CONFLICT(release_key) DO UPDATE
  SET application_version=excluded.application_version,
      migration_count=excluded.migration_count,
      base_schema_sha256=excluded.base_schema_sha256,
      notes=excluded.notes,
      schema_contract_version=excluded.schema_contract_version,
      minimum_application_version=excluded.minimum_application_version,
      is_stable=true,
      metadata=excluded.metadata,
      applied_at=now();

  PERFORM public.append_audit_event(
    'production','promote_stable_release','platform_schema_release',v_release_key,
    NULL,NULL,NULL,NULL,NULL,'Release promovida a Stable após homologação.',
    jsonb_build_object('release','2.4.0','run_id',v_run.production_homologation_runs_id,'organization_id',v_org),NULL
  );

  RETURN jsonb_build_object('ok',true,'release','2.4.0','releaseKey',v_release_key,'runId',v_run.production_homologation_runs_id,'promotedAt',now());
END;
$$;
GRANT EXECUTE ON FUNCTION public.promote_platform_stable_release() TO authenticated;

INSERT INTO public.platform_schema_contracts(schema_contract_version,application_version,required_tables,required_functions,retired_objects,notes)
VALUES('2026.08.24.15','2.4.0',
 ARRAY['organizations','organization_members','platform_tools','organization_tool_installations','tool_browser_pairings','leads','lead_identity_registry','contact_suppressions','queues','queue_items','sents','conversations','conversation_messages','capture_execution_events','instagram_queue_progress','permanent_records','permanent_record_events','platform_runtime_heartbeats','operational_alerts','recovery_requests','lead_orchestration_state','lead_lifecycle_events','platform_release_channels','production_homologation_runs','production_homologation_checks'],
 ARRAY['append_audit_event','service_capture_identity_gate','instagram_claim_queue_item_v2','commercial_reentry_decision','service_runtime_heartbeat','platform_schema_health','service_orchestrate_ready_leads','platform_component_compatibility','platform_release_matrix','platform_production_readiness','start_production_homologation','set_production_homologation_check','promote_platform_stable_release'],
 ARRAY['maps_extension_installations','maps_extension_pairings','instagram_claim_queue_item','instagram_update_queue_progress','get_operational_health_rbac_inner'],
 'Contrato final das Etapas 1–15. A promoção Stable depende de homologação aprovada; instalar esta migration sozinho não congela a release.')
ON CONFLICT(schema_contract_version) DO UPDATE SET application_version=excluded.application_version,required_tables=excluded.required_tables,required_functions=excluded.required_functions,retired_objects=excluded.retired_objects,notes=excluded.notes;

INSERT INTO public.platform_schema_releases(release_key,application_version,migration_count,base_schema_sha256,notes,schema_contract_version,minimum_application_version,is_stable,metadata)
VALUES('stage-15-homologation-20260824','2.4.0',21,encode(extensions.digest('stage-15-homologation-20260824','sha256'),'hex'),'Release candidate para homologação final das Etapas 1–15.','2026.08.24.15','2.4.0',false,jsonb_build_object('stages',jsonb_build_array(1,2,3,4,5,6,7,8,9,10,11,12,13,14,15),'release','preview','textOnlyWhatsapp',true))
ON CONFLICT(release_key) DO UPDATE SET application_version=excluded.application_version,migration_count=excluded.migration_count,base_schema_sha256=excluded.base_schema_sha256,notes=excluded.notes,schema_contract_version=excluded.schema_contract_version,minimum_application_version=excluded.minimum_application_version,is_stable=false,metadata=excluded.metadata,applied_at=now();

COMMIT;

BEGIN;

-- R15: restaura a preparação atômica multicanal no núcleo RBAC.
-- O banco do ambiente podia manter uma versão legada WhatsApp-only do inner.
-- Esta implementação aceita WhatsApp e Instagram e mantém o wrapper público RBAC.

CREATE OR REPLACE FUNCTION public.prepare_queue_items_rbac_inner(
  p_channel text,
  p_resource_id bigint,
  p_scheduled_date date,
  p_items jsonb
)
RETURNS TABLE (
  lead_id bigint,
  queue_item_id bigint,
  outcome text,
  reason text,
  queue_id bigint,
  queue_position integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_users_id bigint;
  v_channel_name text;
  v_channel_id bigint;
  v_active_status_id bigint;
  v_pending_status_id bigint;
  v_validated_lead_status_id bigint;
  v_queued_lead_status_id bigint;
  v_capacity_status_ids bigint[];
  v_daily_limit integer;
  v_used integer;
  v_queue_name text;
  v_queue_id bigint;
  v_next_position integer;
  v_item jsonb;
  v_lead_id bigint;
  v_template_id bigint;
  v_existing_item_id bigint;
  v_existing_queue_id bigint;
  v_existing_position integer;
  v_lead public.leads%ROWTYPE;
  v_resource_found boolean := false;
  v_template_found boolean;
BEGIN
  v_users_id := public.ensure_current_user();
  v_channel_name := lower(trim(coalesce(p_channel, '')));

  IF v_channel_name NOT IN ('whatsapp', 'instagram') THEN
    RAISE EXCEPTION 'Canal inválido. Use WhatsApp ou Instagram.'
      USING ERRCODE = '22023';
  END IF;

  IF p_resource_id IS NULL OR p_resource_id <= 0 THEN
    RAISE EXCEPTION 'Recurso operacional inválido.'
      USING ERRCODE = '22023';
  END IF;

  IF p_scheduled_date IS NULL THEN
    RAISE EXCEPTION 'Data de agendamento obrigatória.'
      USING ERRCODE = '22023';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Informe ao menos um lead para preparação.'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_array_length(p_items) > 500 THEN
    RAISE EXCEPTION 'O lote excede o limite de 500 leads por operação.'
      USING ERRCODE = '22023';
  END IF;

  SELECT c.channels_id
    INTO v_channel_id
  FROM public.channels AS c
  WHERE regexp_replace(lower(public.unaccent(trim(c.channels_name))), '[^a-z0-9]+', '', 'g') = v_channel_name
  ORDER BY c.channels_id
  LIMIT 1;

  IF v_channel_id IS NULL THEN
    RAISE EXCEPTION 'Canal % não encontrado no catálogo.', p_channel;
  END IF;

  SELECT s.status_id
    INTO v_active_status_id
  FROM public.status AS s
  WHERE regexp_replace(lower(public.unaccent(trim(s.status_name))), '[^a-z0-9]+', '', 'g') IN ('ativo', 'active')
  ORDER BY CASE WHEN regexp_replace(lower(public.unaccent(trim(s.status_name))), '[^a-z0-9]+', '', 'g') = 'ativo' THEN 0 ELSE 1 END,
           s.status_id
  LIMIT 1;

  SELECT s.status_id
    INTO v_pending_status_id
  FROM public.status AS s
  WHERE regexp_replace(lower(public.unaccent(trim(s.status_name))), '[^a-z0-9]+', '', 'g') IN ('pendente', 'pending', 'queued')
  ORDER BY CASE WHEN regexp_replace(lower(public.unaccent(trim(s.status_name))), '[^a-z0-9]+', '', 'g') = 'pendente' THEN 0 ELSE 1 END,
           s.status_id
  LIMIT 1;

  SELECT ls.lead_status_id
    INTO v_validated_lead_status_id
  FROM public.lead_status AS ls
  WHERE regexp_replace(lower(public.unaccent(trim(ls.lead_status_name))), '[^a-z0-9]+', '', 'g') IN ('validado', 'validated')
  ORDER BY ls.lead_status_id
  LIMIT 1;

  SELECT ls.lead_status_id
    INTO v_queued_lead_status_id
  FROM public.lead_status AS ls
  WHERE regexp_replace(lower(public.unaccent(trim(ls.lead_status_name))), '[^a-z0-9]+', '', 'g') IN ('nafila', 'queued')
  ORDER BY ls.lead_status_id
  LIMIT 1;

  SELECT array_agg(s.status_id ORDER BY s.status_id)
    INTO v_capacity_status_ids
  FROM public.status AS s
  WHERE regexp_replace(lower(public.unaccent(trim(s.status_name))), '[^a-z0-9]+', '', 'g') IN (
    'pendente', 'pending', 'queued',
    'processando', 'processing', 'sending',
    'concluido', 'completed', 'sent',
    'pausado', 'paused'
  );

  IF v_active_status_id IS NULL
     OR v_pending_status_id IS NULL
     OR v_validated_lead_status_id IS NULL
     OR v_queued_lead_status_id IS NULL
     OR coalesce(array_length(v_capacity_status_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Catálogos operacionais incompletos para preparar a fila.';
  END IF;

  -- Serializa a reserva por usuário, canal, recurso e data. O lock é liberado
  -- automaticamente no commit ou rollback da chamada.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      format('queue-preparation:%s:%s:%s:%s', v_users_id, v_channel_id, p_resource_id, p_scheduled_date),
      0
    )
  );

  IF v_channel_name = 'whatsapp' THEN
    SELECT l.levels_daily_limit
      INTO v_daily_limit
    FROM public.chips AS c
    JOIN public.instances AS i
      ON i.instances_id = c.instances_id
     AND i.users_id = c.users_id
    JOIN public.levels AS l
      ON l.levels_id = c.levels_id
     AND l.users_id = c.users_id
    WHERE c.chips_id = p_resource_id
      AND c.users_id = v_users_id
      AND c.status_id = v_active_status_id
      AND i.status_id = v_active_status_id
      AND l.status_id = v_active_status_id
      AND l.channels_id = v_channel_id
    FOR UPDATE OF c;

    v_resource_found := FOUND;
  ELSE
    SELECT l.levels_daily_limit
      INTO v_daily_limit
    FROM public.socials AS so
    JOIN public.levels AS l
      ON l.levels_id = so.levels_id
     AND l.users_id = so.users_id
    WHERE so.socials_id = p_resource_id
      AND so.users_id = v_users_id
      AND so.status_id = v_active_status_id
      AND l.status_id = v_active_status_id
      AND l.channels_id = v_channel_id
    FOR UPDATE OF so;

    v_resource_found := FOUND;
  END IF;

  IF NOT v_resource_found THEN
    RAISE EXCEPTION 'O recurso selecionado não está ativo, pertence a outro usuário ou não corresponde ao canal.';
  END IF;

  IF coalesce(v_daily_limit, 0) <= 0 THEN
    RAISE EXCEPTION 'O recurso selecionado não possui limite diário válido.';
  END IF;

  IF v_channel_name = 'whatsapp' THEN
    SELECT count(*)::integer
      INTO v_used
    FROM public.queue_items AS qi
    JOIN public.queues AS q
      ON q.queues_id = qi.queues_id
     AND q.users_id = qi.users_id
    WHERE qi.users_id = v_users_id
      AND q.channels_id = v_channel_id
      AND qi.chips_id = p_resource_id
      AND qi.status_id = ANY(v_capacity_status_ids)
      AND (coalesce(qi.queue_items_scheduled_at, q.queues_scheduled_at) AT TIME ZONE 'UTC')::date = p_scheduled_date;
  ELSE
    SELECT count(*)::integer
      INTO v_used
    FROM public.queue_items AS qi
    JOIN public.queues AS q
      ON q.queues_id = qi.queues_id
     AND q.users_id = qi.users_id
    WHERE qi.users_id = v_users_id
      AND q.channels_id = v_channel_id
      AND qi.socials_id = p_resource_id
      AND qi.status_id = ANY(v_capacity_status_ids)
      AND (coalesce(qi.queue_items_scheduled_at, q.queues_scheduled_at) AT TIME ZONE 'UTC')::date = p_scheduled_date;
  END IF;

  v_queue_name := format('%s:%s:%s', v_channel_name, p_resource_id, p_scheduled_date);

  -- Bloqueia todos os leads válidos em ordem determinística para evitar
  -- deadlocks quando operações concorrentes contêm conjuntos sobrepostos.
  PERFORM l.leads_id
  FROM public.leads AS l
  WHERE l.users_id = v_users_id
    AND l.leads_id IN (
      SELECT DISTINCT (entry.value ->> 'lead_id')::bigint
      FROM jsonb_array_elements(p_items) AS entry(value)
      WHERE coalesce(entry.value ->> 'lead_id', '') ~ '^[0-9]+$'
    )
  ORDER BY l.leads_id
  FOR UPDATE;

  FOR v_item IN
    SELECT entry.value
    FROM jsonb_array_elements(p_items) WITH ORDINALITY AS entry(value, ordinal)
    ORDER BY entry.ordinal
  LOOP
    lead_id := NULL;
    queue_item_id := NULL;
    outcome := NULL;
    reason := NULL;
    queue_id := NULL;
    queue_position := NULL;
    v_existing_item_id := NULL;
    v_existing_queue_id := NULL;
    v_existing_position := NULL;
    v_template_found := false;

    IF coalesce(v_item ->> 'lead_id', '') !~ '^[0-9]+$' THEN
      outcome := 'failed';
      reason := 'Identificador de lead inválido.';
      RETURN NEXT;
      CONTINUE;
    END IF;

    v_lead_id := (v_item ->> 'lead_id')::bigint;
    lead_id := v_lead_id;

    SELECT l.*
      INTO v_lead
    FROM public.leads AS l
    WHERE l.leads_id = v_lead_id
      AND l.users_id = v_users_id;

    IF NOT FOUND THEN
      outcome := 'failed';
      reason := 'Lead não encontrado ou sem permissão de acesso.';
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- Uma fila ativa existente é a fonte canônica. Se o lead ainda aparece
    -- como validado, a função reconcilia o status sem criar outro item.
    SELECT qi.queue_items_id, qi.queues_id, qi.queue_items_position
      INTO v_existing_item_id, v_existing_queue_id, v_existing_position
    FROM public.queue_items AS qi
    JOIN public.queues AS q
      ON q.queues_id = qi.queues_id
     AND q.users_id = qi.users_id
    WHERE qi.users_id = v_users_id
      AND qi.leads_id = v_lead_id
      AND qi.status_id = ANY(v_capacity_status_ids)
    ORDER BY qi.queue_items_created_at DESC, qi.queue_items_id DESC
    LIMIT 1;

    IF v_existing_item_id IS NOT NULL THEN
      IF v_lead.lead_status_id = v_validated_lead_status_id THEN
        UPDATE public.leads AS l
        SET
          lead_status_id = v_queued_lead_status_id,
          leads_updated_at = now()
        WHERE l.leads_id = v_lead_id
          AND l.users_id = v_users_id
          AND l.lead_status_id = v_validated_lead_status_id;
      END IF;

      queue_item_id := v_existing_item_id;
      queue_id := v_existing_queue_id;
      queue_position := v_existing_position;
      outcome := 'reconciled';
      reason := 'O lead já possuía um item ativo; o estado canônico foi preservado.';
      RETURN NEXT;
      CONTINUE;
    END IF;

    SELECT qi.queue_items_id, qi.queues_id, qi.queue_items_position
      INTO v_existing_item_id, v_existing_queue_id, v_existing_position
    FROM public.queue_items AS qi
    JOIN public.queues AS q
      ON q.queues_id = qi.queues_id
     AND q.users_id = qi.users_id
    WHERE qi.users_id = v_users_id
      AND qi.leads_id = v_lead_id
      AND q.queues_name = v_queue_name
    ORDER BY qi.queue_items_created_at DESC, qi.queue_items_id DESC
    LIMIT 1;

    IF v_existing_item_id IS NOT NULL THEN
      queue_item_id := v_existing_item_id;
      queue_id := v_existing_queue_id;
      queue_position := v_existing_position;
      outcome := 'conflict';
      reason := 'O lead já possui uma tentativa registrada para este recurso e esta data.';
      RETURN NEXT;
      CONTINUE;
    END IF;

    IF v_lead.lead_status_id <> v_validated_lead_status_id THEN
      outcome := 'conflict';
      reason := 'O lead não está mais no status Validado.';
      RETURN NEXT;
      CONTINUE;
    END IF;

    IF v_lead.channels_id IS DISTINCT FROM v_channel_id THEN
      outcome := 'conflict';
      reason := 'O canal do lead foi alterado antes da preparação.';
      RETURN NEXT;
      CONTINUE;
    END IF;

    IF v_channel_name = 'whatsapp'
       AND length(regexp_replace(coalesce(v_lead.leads_phone, ''), '[^0-9]+', '', 'g')) < 10 THEN
      outcome := 'blocked';
      reason := 'Telefone inválido para WhatsApp.';
      RETURN NEXT;
      CONTINUE;
    END IF;

    IF v_channel_name = 'instagram'
       AND length(trim(coalesce(v_lead.leads_instagram, ''))) = 0 THEN
      outcome := 'blocked';
      reason := 'Instagram inválido ou ausente.';
      RETURN NEXT;
      CONTINUE;
    END IF;

    IF coalesce(v_item ->> 'template_id', '') !~ '^[0-9]+$' THEN
      outcome := 'blocked';
      reason := 'Template obrigatório ou inválido.';
      RETURN NEXT;
      CONTINUE;
    END IF;

    v_template_id := (v_item ->> 'template_id')::bigint;

    SELECT true
      INTO v_template_found
    FROM public.templates AS t
    JOIN public.template_channels AS tc
      ON tc.template_channels_id = t.template_channels_id
     AND tc.users_id = t.users_id
    WHERE t.templates_id = v_template_id
      AND t.users_id = v_users_id
      AND t.branches_id = v_lead.branches_id
      AND t.status_id = v_active_status_id
      AND tc.status_id = v_active_status_id
      AND NOT (v_channel_id = ANY(coalesce(tc.template_channels_blocked_channels, ARRAY[]::bigint[])))
      AND (
        regexp_replace(lower(public.unaccent(trim(tc.template_channels_name))), '[^a-z0-9]+', '', 'g') = v_channel_name
        OR regexp_replace(lower(public.unaccent(trim(tc.template_channels_name))), '[^a-z0-9]+', '', 'g') IN ('geral', 'general')
      )
      AND length(trim(coalesce(t.templates_message_1, ''))) > 0
      AND NOT (
        length(trim(coalesce(t.templates_message_2, ''))) = 0
        AND (
          length(trim(coalesce(t.templates_message_3, ''))) > 0
          OR length(trim(coalesce(t.templates_message_4, ''))) > 0
        )
      )
      AND NOT (
        length(trim(coalesce(t.templates_message_3, ''))) = 0
        AND length(trim(coalesce(t.templates_message_4, ''))) > 0
      )
    LIMIT 1;

    IF NOT coalesce(v_template_found, false) THEN
      outcome := 'blocked';
      reason := 'O template não está ativo, não pertence ao ramo ou não é compatível com o canal.';
      RETURN NEXT;
      CONTINUE;
    END IF;

    IF v_used >= v_daily_limit THEN
      outcome := 'blocked';
      reason := 'Sem capacidade diária disponível para este recurso.';
      RETURN NEXT;
      CONTINUE;
    END IF;

    IF v_queue_id IS NULL THEN
      INSERT INTO public.queues (
        users_id,
        channels_id,
        status_id,
        queues_name,
        queues_scheduled_at,
        queues_created_at,
        queues_updated_at
      )
      VALUES (
        v_users_id,
        v_channel_id,
        v_pending_status_id,
        v_queue_name,
        (p_scheduled_date::timestamp + time '12:00:00') AT TIME ZONE 'UTC',
        now(),
        now()
      )
      ON CONFLICT (users_id, queues_name)
      DO UPDATE SET
        status_id = EXCLUDED.status_id,
        queues_scheduled_at = EXCLUDED.queues_scheduled_at,
        queues_finished_at = NULL,
        queues_updated_at = now()
      RETURNING queues_id INTO v_queue_id;

      PERFORM q.queues_id
      FROM public.queues AS q
      WHERE q.queues_id = v_queue_id
        AND q.users_id = v_users_id
      FOR UPDATE;
    END IF;

    IF v_channel_name = 'whatsapp' THEN
      SELECT coalesce(max(qi.queue_items_position), 0) + 1
        INTO v_next_position
      FROM public.queue_items AS qi
      WHERE qi.users_id = v_users_id
        AND qi.chips_id = p_resource_id
        AND (qi.queue_items_scheduled_at AT TIME ZONE 'UTC')::date = p_scheduled_date;
    ELSE
      SELECT coalesce(max(qi.queue_items_position), 0) + 1
        INTO v_next_position
      FROM public.queue_items AS qi
      WHERE qi.users_id = v_users_id
        AND qi.socials_id = p_resource_id
        AND (qi.queue_items_scheduled_at AT TIME ZONE 'UTC')::date = p_scheduled_date;
    END IF;

    INSERT INTO public.queue_items (
      users_id,
      queues_id,
      leads_id,
      chips_id,
      socials_id,
      templates_id,
      status_id,
      queue_items_position,
      queue_items_attempts,
      queue_items_scheduled_at,
      queue_items_created_at,
      queue_items_updated_at
    )
    VALUES (
      v_users_id,
      v_queue_id,
      v_lead_id,
      CASE WHEN v_channel_name = 'whatsapp' THEN p_resource_id ELSE NULL END,
      CASE WHEN v_channel_name = 'instagram' THEN p_resource_id ELSE NULL END,
      v_template_id,
      v_pending_status_id,
      v_next_position,
      0,
      p_scheduled_date + time '12:00:00',
      now(),
      now()
    )
    RETURNING queue_items_id INTO queue_item_id;

    UPDATE public.leads AS l
    SET
      lead_status_id = v_queued_lead_status_id,
      leads_updated_at = now()
    WHERE l.leads_id = v_lead_id
      AND l.users_id = v_users_id
      AND l.lead_status_id = v_validated_lead_status_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Conflito inesperado ao alterar o lead % após reservar a fila.', v_lead_id;
    END IF;

    v_used := v_used + 1;
    lead_id := v_lead_id;
    outcome := 'queued';
    reason := NULL;
    queue_id := v_queue_id;
    queue_position := v_next_position;
    RETURN NEXT;
  END LOOP;
END;
$function$;



REVOKE ALL ON FUNCTION public.prepare_queue_items_rbac_inner(text,bigint,date,jsonb) FROM PUBLIC, anon, authenticated;

-- A assinatura pública continua sendo a única executável pelo frontend autenticado.
GRANT EXECUTE ON FUNCTION public.prepare_queue_items(text,bigint,date,jsonb) TO authenticated;

COMMIT;



-- R16 FINAL OVERRIDE: sem janelas operacionais + claim Instagram corrigido
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

COMMIT;

-- R16 SETTINGS SCHEMA/VERSIONS
UPDATE public.platform_tools SET settings_schema_version=2,settings_schema='{"type":"object","required":["instagram"]}'::jsonb,latest_version='2.0.4',minimum_supported_version='2.0.4' WHERE tool_id='vinsansi_instagram';
UPDATE public.platform_tools SET settings_schema_version=2,settings_schema='{"type":"object","required":["whatsapp","chipLevels"]}'::jsonb,latest_version='1.3.2',minimum_supported_version='1.3.2' WHERE tool_id='vinsansi_whatsapp_manager';


-- ===== R17: Instagram -> sents -> Base Permanente =====
-- CRM - Vinsansi Studio v2.4.0-R17
-- Etapa 10: integra o fechamento Instagram ao log canônico `sents`
-- e garante refresh idempotente da Base Permanente.

BEGIN;

-- Toda gravação canônica de envio concluído atualiza a memória comercial.
CREATE OR REPLACE FUNCTION public.refresh_permanent_record_from_sent_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $$
BEGIN
  IF NEW.leads_id IS NOT NULL
     AND NEW.sents_sent_at IS NOT NULL
     AND (
       TG_OP = 'INSERT'
       OR OLD.sents_sent_at IS DISTINCT FROM NEW.sents_sent_at
       OR OLD.status_id IS DISTINCT FROM NEW.status_id
     ) THEN
    PERFORM public.refresh_permanent_record(NEW.leads_id, 'dispatch_changed');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS refresh_permanent_record_sent_trigger ON public.sents;
CREATE TRIGGER refresh_permanent_record_sent_trigger
AFTER INSERT OR UPDATE OF status_id, sents_sent_at ON public.sents
FOR EACH ROW
EXECUTE FUNCTION public.refresh_permanent_record_from_sent_trigger();

-- O fechamento Instagram agora grava um único `sents` por queue_item.
-- Repetir a mesma confirmação final é no-op para evitar contadores/eventos duplicados.
CREATE OR REPLACE FUNCTION public.instagram_update_queue_progress_v2(
 p_organizations_id bigint,
 p_queue_item_id bigint,
 p_claim_token uuid,
 p_step text,
 p_message text DEFAULT NULL,
 p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS TABLE(queue_items_id bigint,step text,queue_status_id bigint,lead_status_id bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog,public
AS $$
DECLARE
  v_progress public.instagram_queue_progress%ROWTYPE;
  v_item public.queue_items%ROWTYPE;
  v_canonical text:=public.instagram_canonical_step(p_step);
  v_queue bigint:=4;
  v_lead bigint;
  v_final boolean:=false;
  v_previous text;
  v_current_lead_status bigint;
  v_recipient text;
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

 SELECT qi.* INTO v_item
 FROM public.queue_items qi
 WHERE qi.queue_items_id=p_queue_item_id AND qi.organizations_id=p_organizations_id
 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'instagram_queue_item_not_found'; END IF;

 SELECT l.lead_status_id INTO v_current_lead_status
 FROM public.leads l
 WHERE l.leads_id=v_item.leads_id AND l.organizations_id=p_organizations_id;

 v_previous:=v_progress.step;

 -- Finalizações são idempotentes: retry da mesma transição não gera novo sent/evento/contador.
 IF public.instagram_canonical_step(v_progress.step) IN('completed','error','reconciliation_required') THEN
   IF public.instagram_canonical_step(v_progress.step)<>v_canonical THEN
     RAISE EXCEPTION 'instagram_progress_final:%',v_progress.step;
   END IF;
   RETURN QUERY SELECT p_queue_item_id,p_step,v_item.status_id,coalesce(v_current_lead_status,4::bigint);
   RETURN;
 END IF;

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

 IF v_canonical='completed' THEN
   v_recipient:=nullif(trim(coalesce(
     v_item.queue_items_payload_snapshot #>> '{recipient,instagram}',
     v_item.queue_items_payload_snapshot #>> '{lead,instagram}',
     (SELECT l.leads_instagram FROM public.leads l WHERE l.leads_id=v_item.leads_id),
     ''
   )), '');

   INSERT INTO public.sents(
     users_id,organizations_id,queue_items_id,leads_id,channels_id,socials_id,templates_id,status_id,
     sents_recipient,sents_body,sents_attempt,sents_sent_at,sent_by_member_id,executed_by
   )
   SELECT
     v_item.users_id,p_organizations_id,p_queue_item_id,v_item.leads_id,2,v_progress.socials_id,v_item.templates_id,5,
     v_recipient,
     jsonb_build_object(
       'channel','instagram',
       'queueItemId',p_queue_item_id,
       'messages',coalesce(v_item.queue_items_payload_snapshot->'messages','{}'::jsonb),
       'metadata',coalesce(p_metadata,'{}'::jsonb)
     )::text,
     greatest(coalesce(v_progress.attempts,0),1),now(),v_progress.dispatched_by_member_id,'system'
   WHERE NOT EXISTS(
     SELECT 1 FROM public.sents s
     WHERE s.organizations_id=p_organizations_id
       AND s.queue_items_id=p_queue_item_id
       AND s.channels_id=2
       AND s.sents_sent_at IS NOT NULL
   );
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

 RETURN QUERY SELECT p_queue_item_id,p_step,v_queue,coalesce(v_lead,v_current_lead_status,4::bigint);
END;
$$;

REVOKE ALL ON FUNCTION public.instagram_update_queue_progress_v2(bigint,bigint,uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.instagram_update_queue_progress_v2(bigint,bigint,uuid,text,text,jsonb) TO service_role;

-- Backfill dos envios Instagram já concluídos antes do R17.
-- Não reenvia nada; apenas cria o registro canônico faltante em `sents`.
INSERT INTO public.sents(
  users_id,organizations_id,queue_items_id,leads_id,channels_id,socials_id,templates_id,status_id,
  sents_recipient,sents_body,sents_attempt,sents_sent_at,sent_by_member_id,executed_by
)
SELECT
  qi.users_id,qi.organizations_id,qi.queue_items_id,qi.leads_id,2,p.socials_id,qi.templates_id,5,
  nullif(trim(coalesce(
    qi.queue_items_payload_snapshot #>> '{recipient,instagram}',
    qi.queue_items_payload_snapshot #>> '{lead,instagram}',
    l.leads_instagram,
    ''
  )),''),
  jsonb_build_object(
    'channel','instagram',
    'queueItemId',qi.queue_items_id,
    'messages',coalesce(qi.queue_items_payload_snapshot->'messages','{}'::jsonb),
    'metadata',coalesce(p.metadata,'{}'::jsonb),
    'backfill','R17'
  )::text,
  greatest(coalesce(p.attempts,0),1),
  coalesce(p.finished_at,qi.queue_items_finished_at,now()),
  p.dispatched_by_member_id,
  'system'
FROM public.instagram_queue_progress p
JOIN public.queue_items qi
  ON qi.queue_items_id=p.queue_items_id
 AND qi.organizations_id=p.organizations_id
LEFT JOIN public.leads l
  ON l.leads_id=qi.leads_id
WHERE public.instagram_canonical_step(p.step)='completed'
  AND NOT EXISTS(
    SELECT 1 FROM public.sents s
    WHERE s.organizations_id=qi.organizations_id
      AND s.queue_items_id=qi.queue_items_id
      AND s.channels_id=2
      AND s.sents_sent_at IS NOT NULL
  );

COMMIT;


-- ===== R18: Base Permanente terminal — nunca contatar novamente =====
-- CRM - Vinsansi Studio v2.4.0-R18
-- Etapa 10: Base Permanente é terminal para prospecção.
-- Uma empresa presente em permanent_records nunca volta a ser elegível para disparo.

BEGIN;

-- Compatibilidade: mantemos as colunas legadas, mas nenhuma classificação comercial
-- pode liberar reentrada. Resultado comercial passa a ser apenas memória/analytics.
UPDATE public.commercial_outcomes
SET allow_reentry = false,
    minimum_reentry_days = NULL;

-- A função pública/legada de decisão continua existindo para não quebrar consumidores,
-- mas a semântica agora é definitiva: existe na Base Permanente => não contatar novamente.
CREATE OR REPLACE FUNCTION public.commercial_reentry_decision(
  p_organizations_id bigint,
  p_canonical_lead_id bigint,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path TO pg_catalog,public
AS $$
DECLARE
  v_record public.permanent_records%ROWTYPE;
BEGIN
  IF auth.role()<>'service_role' AND p_organizations_id<>public.current_organization_id() THEN
    RAISE EXCEPTION 'organization_access_denied';
  END IF;

  SELECT pr.*
    INTO v_record
  FROM public.permanent_records pr
  WHERE pr.organizations_id=p_organizations_id
    AND pr.canonical_lead_id=p_canonical_lead_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'allowed', true,
      'reason', 'not_in_permanent_base'
    );
  END IF;

  RETURN jsonb_build_object(
    'allowed', false,
    'reason', 'permanent_record_blocks_contact',
    'permanentRecordId', v_record.permanent_records_id,
    'outcome', v_record.commercial_outcome,
    'recordStatus', v_record.record_status,
    'lastContactAt', v_record.last_contact_at,
    'lastSentAt', v_record.last_sent_at
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.commercial_reentry_decision(bigint,bigint,timestamptz) TO authenticated,service_role;

-- A preparação manual da fila também respeita a Base Permanente. Itens bloqueados
-- retornam como "blocked" sem impedir que outros leads elegíveis do mesmo lote avancem.
CREATE OR REPLACE FUNCTION public.prepare_queue_items(
  p_channel text,
  p_resource_id bigint,
  p_scheduled_date date,
  p_items jsonb
)
RETURNS TABLE(
  lead_id bigint,
  queue_item_id bigint,
  outcome text,
  reason text,
  queue_id bigint,
  queue_position integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog,public
AS $$
DECLARE
  v_org bigint:=public.current_organization_id();
  v_allowed jsonb;
  v_row record;
BEGIN
  PERFORM public.require_organization_permission('queues.prepare');

  -- Preserva as validações e mensagens do contrato interno para payloads inválidos.
  IF p_items IS NULL OR jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items)=0 THEN
    RETURN QUERY
    SELECT * FROM public.prepare_queue_items_rbac_inner(p_channel,p_resource_id,p_scheduled_date,p_items);
    RETURN;
  END IF;

  FOR v_row IN
    WITH parsed AS (
      SELECT
        e.value,
        e.ordinal,
        CASE
          WHEN coalesce(e.value->>'lead_id','') ~ '^[0-9]+$' THEN (e.value->>'lead_id')::bigint
          ELSE NULL
        END AS parsed_lead_id
      FROM jsonb_array_elements(p_items) WITH ORDINALITY AS e(value,ordinal)
    )
    SELECT p.parsed_lead_id AS blocked_lead_id
    FROM parsed p
    JOIN public.leads l
      ON l.leads_id=p.parsed_lead_id
     AND l.organizations_id=v_org
    WHERE EXISTS(
      SELECT 1
      FROM public.permanent_records pr
      WHERE pr.organizations_id=v_org
        AND pr.canonical_lead_id=coalesce(l.canonical_lead_id,l.leads_id)
    )
    ORDER BY p.ordinal
  LOOP
    lead_id:=v_row.blocked_lead_id;
    queue_item_id:=NULL;
    outcome:='blocked';
    reason:='Empresa já está na Base Permanente e não pode ser contatada novamente.';
    queue_id:=NULL;
    queue_position:=NULL;
    RETURN NEXT;
  END LOOP;

  WITH parsed AS (
    SELECT
      e.value,
      e.ordinal,
      CASE
        WHEN coalesce(e.value->>'lead_id','') ~ '^[0-9]+$' THEN (e.value->>'lead_id')::bigint
        ELSE NULL
      END AS parsed_lead_id
    FROM jsonb_array_elements(p_items) WITH ORDINALITY AS e(value,ordinal)
  )
  SELECT coalesce(jsonb_agg(p.value ORDER BY p.ordinal),'[]'::jsonb)
    INTO v_allowed
  FROM parsed p
  LEFT JOIN public.leads l
    ON l.leads_id=p.parsed_lead_id
   AND l.organizations_id=v_org
  WHERE l.leads_id IS NULL
     OR NOT EXISTS(
       SELECT 1
       FROM public.permanent_records pr
       WHERE pr.organizations_id=v_org
         AND pr.canonical_lead_id=coalesce(l.canonical_lead_id,l.leads_id)
     );

  IF jsonb_array_length(coalesce(v_allowed,'[]'::jsonb))>0 THEN
    RETURN QUERY
    SELECT *
    FROM public.prepare_queue_items_rbac_inner(p_channel,p_resource_id,p_scheduled_date,v_allowed);
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.prepare_queue_items(text,bigint,date,jsonb) TO authenticated;

-- Defesa em profundidade para executores. Mesmo que exista um queue_item antigo,
-- qualquer tentativa de colocá-lo em processamento é recusada se a empresa já entrou
-- na Base Permanente. O trigger cobre Instagram e o Worker WhatsApp.
CREATE OR REPLACE FUNCTION public.block_permanent_record_dispatch_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog,public
AS $$
DECLARE
  v_status_key text;
  v_org bigint;
  v_canonical bigint;
  v_record_id bigint;
BEGIN
  IF NEW.leads_id IS NULL OR NEW.status_id IS NOT DISTINCT FROM OLD.status_id THEN
    RETURN NEW;
  END IF;

  SELECT regexp_replace(lower(public.unaccent(trim(s.status_name))), '[^a-z0-9]+', '', 'g')
    INTO v_status_key
  FROM public.status s
  WHERE s.status_id=NEW.status_id;

  IF coalesce(v_status_key,'') NOT IN ('processando','processing','sending') THEN
    RETURN NEW;
  END IF;

  SELECT l.organizations_id,coalesce(l.canonical_lead_id,l.leads_id)
    INTO v_org,v_canonical
  FROM public.leads l
  WHERE l.leads_id=NEW.leads_id;

  IF v_org IS NULL OR v_canonical IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT pr.permanent_records_id
    INTO v_record_id
  FROM public.permanent_records pr
  WHERE pr.organizations_id=v_org
    AND pr.canonical_lead_id=v_canonical
  LIMIT 1;

  IF v_record_id IS NOT NULL THEN
    RAISE EXCEPTION 'permanent_record_blocks_contact:%',v_record_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS block_permanent_record_dispatch ON public.queue_items;
CREATE TRIGGER block_permanent_record_dispatch
BEFORE UPDATE OF status_id ON public.queue_items
FOR EACH ROW
EXECUTE FUNCTION public.block_permanent_record_dispatch_trigger();

-- Atualiza evidências de homologação já criadas para refletir a regra definitiva.
UPDATE public.production_homologation_checks
SET label='Base Permanente bloqueia definitivamente nova prospecção e novo disparo'
WHERE check_key='suppression_reentry';

COMMIT;
