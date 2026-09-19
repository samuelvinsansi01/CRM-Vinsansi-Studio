BEGIN;

CREATE OR REPLACE FUNCTION public.service_homologation_smoke_r60(p_organizations_id bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE checks jsonb:='{}'::jsonb; caught boolean:=false; org bigint; machine_acl_ok boolean; vault_safe boolean; ingest_def text; status_def text; resolve_def text; actor_def text; arm_def text; register_def text; promote_def text;
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
 PERFORM public.service_schema_gate_r60();
 org:=p_organizations_id; IF org IS NULL THEN SELECT organizations_id INTO org FROM public.organizations ORDER BY organizations_id LIMIT 1; END IF;
 SELECT pg_get_functiondef(p.oid) INTO ingest_def FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='service_ingest_evolution_message' LIMIT 1;
 SELECT pg_get_functiondef(p.oid) INTO status_def FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='service_update_evolution_message_status' LIMIT 1;
 SELECT pg_get_functiondef(p.oid) INTO resolve_def FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='r60_resolve_whatsapp_contact' LIMIT 1;
 SELECT pg_get_functiondef(p.oid) INTO actor_def FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='r60_require_actor' LIMIT 1;
 SELECT pg_get_functiondef(p.oid) INTO arm_def FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='service_arm_messaging_resume_gate_r60' LIMIT 1;
 SELECT pg_get_functiondef(p.oid) INTO register_def FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='service_register_release_candidate_r60' LIMIT 1;
 SELECT pg_get_functiondef(p.oid) INTO promote_def FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='service_promote_release_candidate_r60' LIMIT 1;

 checks:=checks||jsonb_build_object(
   'groupDrop',NOT public.r60_is_direct_whatsapp_alias('120363000000000000@g.us'),
   'broadcastDrop',NOT public.r60_is_direct_whatsapp_alias('123@broadcast'),
   'statusDrop',NOT public.r60_is_direct_whatsapp_alias('status@broadcast'),
   'newsletterDrop',NOT public.r60_is_direct_whatsapp_alias('123@newsletter'),
   'jidAccepted',public.r60_is_direct_whatsapp_alias('5511999999999@s.whatsapp.net'),
   'lidAccepted',public.r60_is_direct_whatsapp_alias('123456789@lid'),
   'jidNormalization',public.r60_normalize_provider_alias('5511999999999@c.us')='5511999999999@s.whatsapp.net',
   'jidLidSameCanonicalResolver',resolve_def ILIKE '%p_remote_jid_alt%' AND resolve_def ILIKE '%alias_value=ANY(aliases)%',
   'unknownState',resolve_def ILIKE '%contact_state%' AND resolve_def ILIKE '%unknown%' AND ingest_def ILIKE '%contactState%',
   'leadLink',resolve_def ILIKE '%leads_normalized_phone%' AND resolve_def ILIKE '%contact_state%',
   'ignoredDrop',ingest_def ILIKE '%contact_ignored%',
   'restore',EXISTS(SELECT 1 FROM pg_proc WHERE proname='service_stage5_restore_contact'),
   'promotion',pg_get_functiondef((SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='service_stage5_promote_unknown_contact_v2' LIMIT 1)) ILIKE '%leads.create%' AND pg_get_functiondef((SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='service_stage5_promote_unknown_contact_v2' LIMIT 1)) ILIKE '%leads_instagram%' AND pg_get_functiondef((SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='service_stage5_promote_unknown_contact_v2' LIMIT 1)) ILIKE '%whatsapp_phone_required%',
   'duplicateNoop',ingest_def ILIKE '%duplicate%' AND EXISTS(SELECT 1 FROM pg_indexes WHERE indexname='conversation_message_provider_unique'),
   'sameStatusNoop',status_def ILIKE '%<=public.chat_message_status_rank%',
   'statusMonotonic',public.chat_message_status_rank('read')>public.chat_message_status_rank('delivered') AND public.chat_message_status_rank('delivered')>public.chat_message_status_rank('sent'),
   'textFirst',ingest_def ILIKE '%[Imagem]%' AND ingest_def ILIKE '%[Áudio]%' AND ingest_def ILIKE '%[Figurinha]%' AND ingest_def ILIKE '%[Documento]%' AND ingest_def ILIKE '%raw_payload%' AND ingest_def ILIKE '%{}%::jsonb%',
   'cursorConversations',pg_get_functiondef((SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='service_stage5_list_conversations' LIMIT 1)) ILIKE '%p_cursor_id%',
   'cursorMessages',pg_get_functiondef((SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='service_stage5_list_messages' LIMIT 1)) ILIKE '%p_before_id%',
   'presenceRealtime',pg_get_functiondef((SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='service_stage5_presence' LIMIT 1)) ILIKE '%realtime_presence%',
   'crossTenantScoped',actor_def ~* 'm\.organizations_id[[:space:]]*=[[:space:]]*p_organizations_id' AND actor_def ILIKE '%auth.uid()%',
   'memberImpersonationBlocked',actor_def ILIKE '%auth.uid()%'
 );

 IF org IS NOT NULL THEN
   BEGIN UPDATE public.organization_messaging_state SET maintenance=false,resume_allowed=true WHERE organizations_id=org;
   EXCEPTION WHEN OTHERS THEN caught:=position('resume_allowed_requires_service_arm_messaging_resume_gate_r60' in SQLERRM)>0; END;
   checks:=checks||jsonb_build_object('resumeGuard',caught);
 END IF;

 SELECT NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND (p.proname LIKE 'worker\_%' ESCAPE '\' OR p.proname IN('service_ingest_evolution_message','service_update_evolution_message_status','service_arm_messaging_resume_gate_r60','service_exchange_executor_pairing')) AND (has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE'))) INTO machine_acl_ok;
 checks:=checks||jsonb_build_object('machineOnlyAcl',machine_acl_ok);
 SELECT NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'service_stage5_%' AND pg_get_functiondef(p.oid) ILIKE '%decrypted_secrets%') INTO vault_safe;
 checks:=checks||jsonb_build_object('vaultNotBrowserExposed',vault_safe);
 checks:=checks||jsonb_build_object(
   'candidateCannotArmResume',NOT EXISTS(SELECT 1 FROM public.platform_release_candidates c WHERE c.production_ready=false AND c.resume_allowed=true),
   'wrongSequenceBlocked',arm_def ILIKE '%release_sequence<>p_expected_release_sequence%' AND arm_def ILIKE '%release_sequence<>60%',
   'productionRequiresVerifiedSignature',arm_def ILIKE '%signature_verified_at%',
   'authorizedResumePathOnly',arm_def ILIKE '%vinsansi.r60_resume_gate%' AND arm_def ILIKE '%platform_release_promotions%',
   'replayProtected',register_def ILIKE '%release_downgrade_rejected%' AND register_def ILIKE '%ON CONFLICT%',
   'immutablePromotion',promote_def ILIKE '%immutable_promotion_mismatch%' AND promote_def ILIKE '%mobile%' AND promote_def ILIKE '%distribution%' AND promote_def ILIKE '%component_hashes%' AND promote_def ILIKE '%docker_digests%',
   'idempotentPromotion',promote_def ILIKE '%idempotent%' AND promote_def ILIKE '%release_sequence_already_promoted%' AND promote_def ILIKE '%platform_release_promotions%',
   'mobilePushContract',to_regclass('public.mobile_push_devices') IS NOT NULL AND EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.mobile_push_devices'::regclass AND attname='last_error' AND attnum>0 AND NOT attisdropped) AND to_regprocedure('public.mobile_register_push_device_r60(bigint,uuid,text,text,text)') IS NOT NULL AND to_regprocedure('public.mobile_disable_push_device_r60(bigint,uuid)') IS NOT NULL,
   'materializedCommercialDeadline',to_regclass('public.lead_commercial_response_deadline_r60_idx') IS NOT NULL AND to_regprocedure('public.r60_refresh_response_deadline_from_message()') IS NOT NULL,
   'productionPromotionPath',promote_def ILIKE '%production_ready%' AND promote_def ILIKE '%resume_allowed%' AND promote_def ILIKE '%signature_verified_at%'
 );

 IF EXISTS(SELECT 1 FROM jsonb_each_text(checks) x WHERE x.value='false') THEN RAISE EXCEPTION 'r60_homologation_smoke_failed:%',checks::text; END IF;
 RETURN jsonb_build_object('ok',true,'checks',checks,'note','Execute em homologação dentro de BEGIN/ROLLBACK. Este smoke valida invariantes e guards; cenários stateful usam a instância/chip de homologação e não devem deixar dados.');
END $$;

REVOKE ALL ON FUNCTION public.service_homologation_smoke_r60(bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.service_homologation_smoke_r60(bigint) TO service_role;

COMMIT;
