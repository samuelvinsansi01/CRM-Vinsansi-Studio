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
