BEGIN;

CREATE OR REPLACE FUNCTION public.service_schema_gate_r60()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE missing text[]:=ARRAY[]::text[]; bad_acl text[]:=ARRAY[]::text[]; not_forced text[]:=ARRAY[]::text[]; legacy text[]:=ARRAY[]::text[]; n text;
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;

 FOREACH n IN ARRAY ARRAY[
   'organization_messaging_state','platform_release_candidates','platform_release_promotions',
   'whatsapp_contacts','whatsapp_contact_aliases','conversations','conversation_messages','conversation_member_states',
   'queue_item_dispatch_parts','tool_executor_pairings','tool_browser_pairings','tool_installation_credentials','tool_user_sessions',
   'evolution_webhook_receipts','platform_runtime_heartbeats','recovery_requests'
 ] LOOP
   IF to_regclass('public.'||n) IS NULL THEN missing:=array_append(missing,'table:'||n); END IF;
 END LOOP;

 FOREACH n IN ARRAY ARRAY[
   'r60_require_actor','r60_resolve_whatsapp_contact','r60_is_direct_whatsapp_alias',
   'service_ingest_evolution_message','service_update_evolution_message_status','service_update_evolution_connection_state_r60',
   'service_stage5_list_conversations','service_stage5_list_messages','service_stage5_ignore_contact','service_stage5_restore_contact','service_stage5_promote_unknown_contact','service_stage5_presence','service_stage5_converge_automatic_message',
   'worker_claim_dispatch_job','worker_claim_dispatch_part','worker_complete_dispatch_part','worker_finalize_whatsapp_queue_item','worker_fail_whatsapp_queue_item','worker_move_dispatch_to_dlq','worker_start_whatsapp_batch','worker_set_whatsapp_batch_state','worker_claim_next_batch_item','worker_complete_batch_item','worker_recover_stale_whatsapp_v2',
   'service_exchange_executor_pairing','service_cleanup_pairings_r60','service_retention_r60',
   'service_register_release_candidate_r60','service_mark_release_signature_verified_r60','service_mark_release_candidate_homologated_r60','service_promote_release_candidate_r60','service_arm_messaging_resume_gate_r60'
 ] LOOP
   IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND p.proname=n) THEN missing:=array_append(missing,'function:'||n); END IF;
 END LOOP;

 IF NOT EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid='public.conversations'::regclass AND a.attname='whatsapp_contacts_id' AND a.attnotnull AND NOT a.attisdropped) THEN missing:=array_append(missing,'column:conversations.whatsapp_contacts_id:not_null'); END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='conversations_org_chip_contact_unique') THEN missing:=array_append(missing,'index:conversations_org_chip_contact_unique'); END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='conversation_message_provider_unique') THEN missing:=array_append(missing,'index:conversation_message_provider_unique'); END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='whatsapp_contact_aliases_org_alias_unique') THEN missing:=array_append(missing,'index:whatsapp_contact_aliases_org_alias_unique'); END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='tool_executor_pairings_pending_installation_unique') THEN missing:=array_append(missing,'index:pairing_one_pending_per_installation'); END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid='public.platform_release_candidates'::regclass AND a.attname='signature_verified_at' AND NOT a.attisdropped) THEN missing:=array_append(missing,'column:platform_release_candidates.signature_verified_at'); END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='organization_messaging_state_guard_r60' AND NOT tgisinternal) THEN missing:=array_append(missing,'trigger:organization_messaging_state_guard_r60'); END IF;

 FOREACH n IN ARRAY ARRAY['organization_messaging_state','platform_release_candidates','platform_release_promotions','whatsapp_contacts','whatsapp_contact_aliases','conversations','conversation_messages','conversation_member_states'] LOOP
   IF NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace WHERE ns.nspname='public' AND c.relname=n AND c.relrowsecurity AND c.relforcerowsecurity) THEN not_forced:=array_append(not_forced,n); END IF;
 END LOOP;

 SELECT coalesce(array_agg(p.proname ORDER BY p.proname),ARRAY[]::text[]) INTO bad_acl
 FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
 WHERE ns.nspname='public' AND (
   p.proname LIKE 'worker\_%' ESCAPE '\' OR
   p.proname IN('service_ingest_evolution_message','service_update_evolution_message_status','service_update_evolution_connection_state_r60','service_upsert_evolution_chat','service_stage5_converge_automatic_message','service_arm_messaging_resume_gate_r60','service_exchange_executor_pairing','service_cleanup_pairings_r60','service_retention_r60','service_register_release_candidate_r60','service_mark_release_signature_verified_r60','service_mark_release_candidate_homologated_r60','service_promote_release_candidate_r60')
 ) AND (has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE'));

 IF EXISTS(SELECT 1 FROM pg_policy pol JOIN pg_class t ON t.oid=pol.polrelid JOIN pg_namespace ns ON ns.oid=t.relnamespace WHERE ns.nspname='public' AND t.relname IN('whatsapp_contacts','whatsapp_contact_aliases','conversations','conversation_messages','conversation_member_states') AND pol.polname NOT LIKE '%r60_select') THEN legacy:=array_append(legacy,'legacy_inbox_rls_policy'); END IF;
 IF EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname IN ('conversation_identity_org_chip_jid_unique','conversations_users_id_chips_id_remote_jid_key')) THEN legacy:=array_append(legacy,'remote_jid_conversation_uniqueness'); END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND p.proname='service_stage5_presence' AND pg_get_functiondef(p.oid) ILIKE '%INSERT INTO public.conversation_presence%') THEN legacy:=array_append(legacy,'persistent_presence_writer'); END IF;
 IF EXISTS(SELECT 1 FROM public.platform_release_candidates WHERE production_ready=false AND resume_allowed=true) THEN legacy:=array_append(legacy,'candidate_resume_allowed'); END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND p.proname='service_arm_messaging_resume_gate_r60' AND pg_get_functiondef(p.oid) ILIKE '%signature_verified_at%' AND pg_get_functiondef(p.oid) ILIKE '%release_sequence<>60%') THEN missing:=array_append(missing,'resume_gate:sequence_signature'); END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND p.proname='service_retention_r60' AND pg_get_functiondef(p.oid) ILIKE '%evolution_webhook_receipts%' AND pg_get_functiondef(p.oid) ILIKE '%platform_runtime_heartbeats%') THEN missing:=array_append(missing,'retention:r60'); END IF;

 IF array_length(missing,1) IS NOT NULL OR array_length(bad_acl,1) IS NOT NULL OR array_length(not_forced,1) IS NOT NULL OR array_length(legacy,1) IS NOT NULL THEN
   RAISE EXCEPTION 'r60_schema_gate_failed:%',jsonb_build_object('missing',missing,'badAcl',bad_acl,'notForceRls',not_forced,'legacy',legacy)::text;
 END IF;
 RETURN jsonb_build_object('ok',true,'schema','r60','securityBaseline','r60-security-baseline-v1','releaseSequence',60,'machineAcl','closed','forceRls',true,'pairing','r60','retention','r60','presence','realtime');
END $$;

REVOKE ALL ON FUNCTION public.service_schema_gate_r60() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.service_schema_gate_r60() TO service_role;

COMMIT;
