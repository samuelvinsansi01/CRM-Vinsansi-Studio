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
