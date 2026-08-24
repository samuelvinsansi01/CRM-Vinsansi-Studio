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
