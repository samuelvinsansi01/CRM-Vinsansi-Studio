CREATE OR REPLACE FUNCTION public.stage3_assert(p_ok boolean,p_message text)
RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF NOT coalesce(p_ok,false) THEN RAISE EXCEPTION 'stage3_assertion_failed:%',p_message; END IF; END $$;

SELECT public.stage3_assert((SELECT count(*)=3 FROM public.platform_tools),'catalog_exactly_three');
SELECT public.stage3_assert((SELECT array_agg(tool_id ORDER BY tool_id)=ARRAY['vinsansi_capture','vinsansi_instagram','vinsansi_whatsapp_manager'] FROM public.platform_tools),'canonical_ids');
SELECT public.stage3_assert(NOT EXISTS(SELECT 1 FROM public.platform_tools WHERE tool_id~'(worker|apify|website)'),'forbidden_tools_absent');
SELECT public.stage3_assert(public.tool_semver_compare('1.10.0','1.9.0')=1,'semver_numeric_order');
SELECT public.stage3_assert(public.tool_compatibility_status('1.8.0','1.9.0','1.10.0')='incompatible','compatibility_below_minimum');
SELECT public.stage3_assert(public.tool_compatibility_status('1.9.0','1.9.0','1.10.0')='update_available','compatibility_update');
SELECT public.stage3_assert(public.tool_compatibility_status('1.10.0','1.9.0','1.10.0')='compatible','compatibility_current');
SELECT public.stage3_assert(public.tool_presence_status(ARRAY['capture.maps'],NULL)='not_supported','presence_not_supported');
SELECT public.stage3_assert(public.tool_presence_status(ARRAY['presence.heartbeat'],NULL)='never_seen','presence_never_seen');
SELECT public.stage3_assert(public.tool_presence_status(ARRAY['presence.heartbeat'],now()-interval '60 seconds')='online','presence_online');
SELECT public.stage3_assert(public.tool_presence_status(ARRAY['presence.heartbeat'],now()-interval '181 seconds')='offline','presence_offline');
SELECT public.stage3_assert((SELECT default_entitlements->>'maxConcurrentActivitiesPerMember'='5' FROM public.platform_tools WHERE tool_id='vinsansi_capture'),'capture_entitlement_five');

SELECT public.stage3_assert(to_regclass('public.user_operational_settings') IS NULL,'legacy_settings_table_removed');
SELECT public.stage3_assert(to_regprocedure('public.save_extension_runtime_config(jsonb)') IS NULL,'runtime_blob_writer_removed');
SELECT public.stage3_assert((SELECT settings->>'operationalTimezone'='America/Fortaleza' AND settings->>'operationalCutoffHour'='21' FROM public.organization_tool_settings WHERE organizations_id=10 AND tool_id='vinsansi_whatsapp_manager'),'whatsapp_migration_preserved');
SELECT public.stage3_assert((SELECT settings->'instagram'->>'startTime'='10:00' FROM public.organization_tool_settings WHERE organizations_id=10 AND tool_id='vinsansi_instagram'),'instagram_migration_preserved');
SELECT public.stage3_assert((SELECT settings->>'minRating'='4.5' FROM public.organization_tool_settings WHERE organizations_id=10 AND tool_id='vinsansi_capture'),'capture_migration_preserved');
SELECT public.stage3_assert((SELECT organization_tool_installations_id IS NOT NULL FROM public.maps_extension_installations WHERE installation_id='gmaps-smoke-installation-0001'),'maps_canonical_link');
SELECT public.stage3_assert((SELECT metadata->>'legacyBridge'='maps_extension_installations' FROM public.organization_tool_installations WHERE external_installation_id='gmaps-smoke-installation-0001'),'maps_bridge_metadata');

SELECT public.stage3_assert((SELECT relrowsecurity FROM pg_class WHERE oid='public.platform_tools'::regclass),'platform_tools_rls');
SELECT public.stage3_assert((SELECT relrowsecurity FROM pg_class WHERE oid='public.organization_tools'::regclass),'organization_tools_rls');
SELECT public.stage3_assert((SELECT relrowsecurity FROM pg_class WHERE oid='public.organization_tool_installations'::regclass),'installations_rls');
SELECT public.stage3_assert((SELECT relrowsecurity FROM pg_class WHERE oid='public.organization_tool_settings'::regclass),'settings_rls');
SELECT public.stage3_assert((SELECT relrowsecurity FROM pg_class WHERE oid='public.organization_tool_entitlements'::regclass),'entitlements_rls');
SELECT public.stage3_assert(public.tool_json_contains_secret('{"nested":{"serviceRoleKey":"forbidden"}}'::jsonb),'secret_detection');
SELECT public.stage3_assert(NOT public.validate_tool_settings('vinsansi_capture','{"apiKey":"forbidden"}'::jsonb),'secret_settings_rejected');
SELECT public.stage3_assert(NOT has_table_privilege('authenticated','public.organization_tool_settings','INSERT'),'settings_no_direct_insert');
SELECT public.stage3_assert(NOT has_table_privilege('authenticated','public.organization_tool_installations','UPDATE'),'installation_no_direct_update');
SELECT public.stage3_assert(NOT has_table_privilege('authenticated','public.organization_tool_entitlements','UPDATE'),'entitlement_no_organization_write');

INSERT INTO public.users VALUES(3,'Outra Scope',NULL,true),(4,'Outro Dono',gen_random_uuid(),false);
INSERT INTO public.organizations VALUES(11,'Outra Organização',3,1);
INSERT INTO public.organization_members VALUES(101,11,4,'owner',1);
INSERT INTO public.organization_tools(organizations_id,tool_id,enabled) VALUES(11,'vinsansi_capture',true);
INSERT INTO public.organization_tool_settings(organizations_id,tool_id,settings,settings_schema_version)
SELECT 11,tool_id,default_settings,settings_schema_version FROM public.platform_tools WHERE tool_id='vinsansi_capture';
SET ROLE authenticated;
SELECT public.stage3_assert((SELECT count(*)=0 FROM public.organization_tool_settings WHERE organizations_id=11),'organization_b_isolated');
SELECT public.stage3_assert((SELECT count(*)=3 FROM public.organization_tool_settings WHERE organizations_id=10),'organization_a_visible');
RESET ROLE;

DO $optimistic_concurrency$
DECLARE current_settings jsonb; before_version bigint; after_version bigint; conflict_seen boolean:=false;
BEGIN
  SELECT settings,settings_version INTO current_settings,before_version FROM public.organization_tool_settings WHERE organizations_id=10 AND tool_id='vinsansi_capture';
  PERFORM public.save_organization_tool_settings('vinsansi_capture',current_settings || '{"minRating":4.7}'::jsonb,before_version);
  SELECT settings_version INTO after_version FROM public.organization_tool_settings WHERE organizations_id=10 AND tool_id='vinsansi_capture';
  PERFORM public.stage3_assert(after_version=before_version+1,'settings_version_increment');
  BEGIN
    PERFORM public.save_organization_tool_settings('vinsansi_capture',current_settings,before_version);
  EXCEPTION WHEN others THEN
    conflict_seen:=position('tool_settings_version_conflict' in SQLERRM)>0;
  END;
  PERFORM public.stage3_assert(conflict_seen,'optimistic_conflict_rejected');
END
$optimistic_concurrency$;

SELECT 'stage3_sql_smoke_passed' AS result;
