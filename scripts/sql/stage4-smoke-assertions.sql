DO $$ BEGIN
 IF to_regclass('public.tool_installation_credentials') IS NULL OR to_regclass('public.tool_user_sessions') IS NULL OR to_regclass('public.tool_executor_pairings') IS NULL THEN RAISE EXCEPTION 'stage4_tables_missing'; END IF;
 IF to_regprocedure('public.service_executor_member_context(uuid,bigint,text)') IS NULL THEN RAISE EXCEPTION 'stage4_context_rpc_missing'; END IF;
 IF to_regprocedure('public.service_get_operational_settings(bigint)') IS NOT NULL THEN RAISE EXCEPTION 'stage3_worker_bridge_not_removed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='tool_user_sessions' AND column_name='organizations_id' AND is_nullable='NO') THEN RAISE EXCEPTION 'session_organization_pin_missing'; END IF;
 IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='tool_user_sessions' AND column_name='organization_members_id' AND is_nullable='NO') THEN RAISE EXCEPTION 'session_member_pin_missing'; END IF;
END $$;

DO $$
DECLARE ctx jsonb; eligible jsonb; exchanged jsonb; installation uuid; session_id uuid; credential_id uuid; rejected boolean:=false;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.permissions WHERE permissions_key='capture.use') THEN
  INSERT INTO public.permissions(permissions_id,permissions_key,permissions_name,permissions_category,permissions_description,permissions_sensitivity)
  VALUES(2001,'capture.use','Usar captura','Captura','Smoke','delegable');
 END IF;
 INSERT INTO public.organization_role_permissions(organization_roles_id,permissions_id)
 SELECT 1000,permissions_id FROM public.permissions WHERE permissions_key='capture.use' ON CONFLICT DO NOTHING;

 IF to_regclass('public.platform_owners') IS NULL THEN CREATE TABLE public.platform_owners(users_id bigint PRIMARY KEY REFERENCES public.users(users_id)); END IF;
 CREATE OR REPLACE FUNCTION public.is_platform_owner(p_users_id bigint DEFAULT NULL)
 RETURNS boolean LANGUAGE sql STABLE AS $function$
  SELECT EXISTS(SELECT 1 FROM public.platform_owners WHERE users_id=p_users_id)
 $function$;

 -- 1) Usuário comum + membership ativa: permitido via auth.users.id -> public.users.users_id.
 ctx:=public.service_executor_member_context('00000000-0000-0000-0000-000000000001',10,'vinsansi_capture');
 IF (ctx->>'userId')::bigint<>2 OR (ctx->>'organizationId')::bigint<>10 OR (ctx->>'memberId')::bigint<>100 OR (ctx->>'membershipStatusId')::bigint<>1 THEN RAISE EXCEPTION 'common_active_membership_context_invalid:%',ctx; END IF;

 -- 2) Platform Owner + membership ativa: permitido pela membership, não pelo privilégio global.
 INSERT INTO auth.users(id,email) VALUES('00000000-0000-0000-0000-000000000003','platform-member@example.com');
 INSERT INTO public.users(users_id,users_name,auth_user_id,users_is_scope) VALUES(999,'Platform Member','00000000-0000-0000-0000-000000000003',false);
 INSERT INTO public.platform_owners(users_id) VALUES(999);
 INSERT INTO public.organization_members(organization_members_id,organizations_id,users_id,access_level,organization_roles_id,status_id) VALUES(199,10,999,'member',1000,1);
 ctx:=public.service_executor_member_context('00000000-0000-0000-0000-000000000003',10,'vinsansi_capture');
 IF (ctx->>'memberId')::bigint<>199 OR (ctx->>'userId')::bigint<>999 THEN RAISE EXCEPTION 'platform_owner_active_membership_context_invalid:%',ctx; END IF;

 -- 3) Platform Owner sem membership: recusado.
 INSERT INTO auth.users(id,email) VALUES('00000000-0000-0000-0000-000000000004','platform-only@example.com');
 INSERT INTO public.users(users_id,users_name,auth_user_id,users_is_scope) VALUES(998,'Platform Only','00000000-0000-0000-0000-000000000004',false);
 INSERT INTO public.platform_owners(users_id) VALUES(998);
 BEGIN PERFORM public.service_executor_member_context('00000000-0000-0000-0000-000000000004',10,'vinsansi_capture'); EXCEPTION WHEN OTHERS THEN rejected:=SQLERRM LIKE '%executor_active_membership_required%'; END;
 IF NOT rejected THEN RAISE EXCEPTION 'platform_owner_without_membership_was_accepted'; END IF;

 -- 4) Membership desativada: recusada pelo status_id=1 persistido na Etapa 2.
 UPDATE public.organization_members SET status_id=2 WHERE organization_members_id=100; rejected:=false;
 BEGIN PERFORM public.service_executor_member_context('00000000-0000-0000-0000-000000000001',10,'vinsansi_capture'); EXCEPTION WHEN OTHERS THEN rejected:=SQLERRM LIKE '%executor_active_membership_required%'; END;
 IF NOT rejected THEN RAISE EXCEPTION 'inactive_member_was_accepted'; END IF;
 UPDATE public.organization_members SET status_id=1 WHERE organization_members_id=100;

 -- 5) Membro de A tentando operar B: recusado antes de instalação/sessão.
 rejected:=false;
 BEGIN PERFORM public.service_executor_member_context('00000000-0000-0000-0000-000000000001',11,'vinsansi_capture'); EXCEPTION WHEN OTHERS THEN rejected:=SQLERRM LIKE '%executor_active_membership_required%'; END;
 IF NOT rejected THEN RAISE EXCEPTION 'organization_a_member_operated_organization_b'; END IF;

 -- 6/7) Membro de A e B: pairing pinado exatamente em B, com o member_id de B.
 INSERT INTO public.organization_roles(organization_roles_id,organizations_id,organization_roles_name,organization_roles_key,status_id) VALUES(1001,11,'Captura','capture',1);
 INSERT INTO public.organization_role_permissions(organization_roles_id,permissions_id) SELECT 1001,permissions_id FROM public.permissions WHERE permissions_key='capture.use';
 INSERT INTO public.organization_members(organization_members_id,organizations_id,users_id,access_level,organization_roles_id,status_id) VALUES(102,11,2,'member',1001,1);
 eligible:=public.service_executor_eligible_organizations('00000000-0000-0000-0000-000000000001','vinsansi_capture');
 IF jsonb_array_length(eligible)<>2 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(eligible) x WHERE (x->>'organizationId')::bigint=11 AND (x->>'memberId')::bigint=102) THEN RAISE EXCEPTION 'multi_organization_eligibility_invalid:%',eligible; END IF;
 ctx:=public.service_executor_member_context('00000000-0000-0000-0000-000000000001',11,'vinsansi_capture');
 IF (ctx->>'organizationId')::bigint<>11 OR (ctx->>'memberId')::bigint<>102 OR (ctx->>'userId')::bigint<>2 THEN RAISE EXCEPTION 'selected_organization_context_invalid:%',ctx; END IF;

 -- Fluxo Maps persistido: initiate sem tenant, authorize pinando exatamente B.
 INSERT INTO public.maps_extension_pairings(maps_extension_pairings_id,installation_id,pairing_secret_hash,status,expires_at)
 VALUES('30000000-0000-0000-0000-000000000001','maps-persisted-regression',repeat('3',64),'pending',now()+interval '5 minutes');
 UPDATE public.maps_extension_pairings
    SET users_id=3,organizations_id=11,authorized_by_member_id=102,
        authorized_auth_user_id='00000000-0000-0000-0000-000000000001',authorized_actor_users_id=2,
        status='authorized',authorized_at=now()
  WHERE maps_extension_pairings_id='30000000-0000-0000-0000-000000000001';
 IF NOT EXISTS(
  SELECT 1 FROM public.maps_extension_pairings
   WHERE maps_extension_pairings_id='30000000-0000-0000-0000-000000000001'
     AND users_id=3 AND organizations_id=11 AND authorized_actor_users_id=2
     AND authorized_by_member_id=102 AND authorized_auth_user_id='00000000-0000-0000-0000-000000000001'
 ) THEN RAISE EXCEPTION 'maps_authorized_context_not_persisted'; END IF;

 -- Emissão canônica persistida: exchange -> context -> config -> heartbeat.
 INSERT INTO public.tool_executor_pairings(tool_id,external_installation_id,pairing_code_hash,auth_users_id,users_id,organizations_id,organization_members_id,requested_version,requested_capabilities,expires_at)
 VALUES('vinsansi_capture','maps-persisted-regression',repeat('c',64),'00000000-0000-0000-0000-000000000001',2,11,102,'0.18.0',ARRAY['capture.maps'],now()+interval '5 minutes');
 exchanged:=public.service_exchange_executor_pairing(repeat('c',64),repeat('d',64),repeat('e',64));
 IF (exchanged->>'organizationId')::bigint<>11 OR (exchanged->>'memberId')::bigint<>102 THEN RAISE EXCEPTION 'pairing_exchange_context_invalid:%',exchanged; END IF;
 SELECT tool_user_sessions_id INTO session_id FROM public.tool_user_sessions WHERE session_hash=repeat('e',64);
 IF NOT EXISTS(SELECT 1 FROM public.tool_user_sessions WHERE tool_user_sessions_id=session_id AND auth_users_id='00000000-0000-0000-0000-000000000001' AND users_id=2 AND organizations_id=11 AND organization_members_id=102 AND revoked_at IS NULL) THEN RAISE EXCEPTION 'human_session_context_not_persisted'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.organization_tool_settings WHERE organizations_id=11 AND tool_id='vinsansi_capture') THEN RAISE EXCEPTION 'maps_config_not_available'; END IF;
 PERFORM public.service_touch_tool_installation(11,'vinsansi_capture','maps-persisted-regression',true,false,'0.18.0',ARRAY['capture.maps'],102);
 IF NOT EXISTS(SELECT 1 FROM public.organization_tool_installations WHERE organizations_id=11 AND tool_id='vinsansi_capture' AND external_installation_id='maps-persisted-regression' AND last_seen_at IS NOT NULL) THEN RAISE EXCEPTION 'maps_heartbeat_not_persisted'; END IF;
 UPDATE public.maps_extension_pairings SET status='consumed',consumed_at=now()
  WHERE maps_extension_pairings_id='30000000-0000-0000-0000-000000000001' AND status='authorized';
 IF NOT EXISTS(SELECT 1 FROM public.maps_extension_pairings WHERE maps_extension_pairings_id='30000000-0000-0000-0000-000000000001' AND status='consumed' AND consumed_at IS NOT NULL) THEN RAISE EXCEPTION 'maps_pairing_not_consumed'; END IF;

 -- Pairing com member_id divergente é recusado sem consumir o código.
 INSERT INTO public.tool_executor_pairings(tool_id,external_installation_id,pairing_code_hash,auth_users_id,users_id,organizations_id,organization_members_id,expires_at)
 VALUES('vinsansi_capture','divergent-pairing',repeat('f',64),'00000000-0000-0000-0000-000000000001',2,11,101,now()+interval '5 minutes');
 rejected:=false;
 BEGIN PERFORM public.service_exchange_executor_pairing(repeat('f',64),repeat('1',64),repeat('2',64)); EXCEPTION WHEN OTHERS THEN rejected:=SQLERRM LIKE '%pairing_context_divergent%'; END;
 IF NOT rejected OR EXISTS(SELECT 1 FROM public.tool_executor_pairings WHERE pairing_code_hash=repeat('f',64) AND exchanged_at IS NOT NULL) THEN RAISE EXCEPTION 'divergent_pairing_was_consumed'; END IF;

 -- Membership desativada revoga imediatamente a sessão humana pinada.
 UPDATE public.organization_members SET status_id=2 WHERE organization_members_id=102;
 IF NOT EXISTS(SELECT 1 FROM public.tool_user_sessions WHERE tool_user_sessions_id=session_id AND revoked_at IS NOT NULL AND logout_reason='membership_inactive') THEN RAISE EXCEPTION 'session_not_revoked_on_membership_deactivation'; END IF;
 UPDATE public.organization_members SET status_id=1 WHERE organization_members_id=102;

 -- Instalação disabled revoga a sessão humana, preservando a credencial técnica.
 installation:=public.service_register_tool_installation(10,'vinsansi_capture','stage4-smoke','0.18.0',ARRAY['capture.maps'],100,'{}');
 INSERT INTO public.tool_installation_credentials(organization_tool_installations_id,credential_hash,issued_to_external_installation_id) VALUES(installation,repeat('a',64),'stage4-smoke') RETURNING tool_installation_credentials_id INTO credential_id;
 INSERT INTO public.tool_user_sessions(organization_tool_installations_id,auth_users_id,users_id,organizations_id,organization_members_id,session_hash) VALUES(installation,'00000000-0000-0000-0000-000000000001',2,10,100,repeat('b',64)) RETURNING tool_user_sessions_id INTO session_id;
 UPDATE public.organization_tool_installations SET registration_status='disabled' WHERE organization_tool_installations_id=installation;
 IF NOT EXISTS(SELECT 1 FROM public.tool_user_sessions WHERE tool_user_sessions_id=session_id AND revoked_at IS NOT NULL) THEN RAISE EXCEPTION 'session_not_revoked_on_disable'; END IF;
 IF EXISTS(SELECT 1 FROM public.tool_installation_credentials WHERE tool_installation_credentials_id=credential_id AND revoked_at IS NOT NULL) THEN RAISE EXCEPTION 'technical_credential_revoked_on_disable'; END IF;

 rejected:=false;
 BEGIN INSERT INTO public.tool_executor_pairings(tool_id,external_installation_id,pairing_code_hash,auth_users_id,users_id,organizations_id,organization_members_id,expires_at) VALUES('vinsansi_capture','invalid-expiry',repeat('9',64),'00000000-0000-0000-0000-000000000001',2,10,100,now()+interval '11 minutes'); EXCEPTION WHEN check_violation THEN rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'pairing_longer_than_ten_minutes_was_accepted'; END IF;
END $$;
