DO $$ BEGIN
 IF to_regclass('public.tool_installation_credentials') IS NULL OR to_regclass('public.tool_user_sessions') IS NULL OR to_regclass('public.tool_executor_pairings') IS NULL THEN RAISE EXCEPTION 'stage4_tables_missing'; END IF;
 IF to_regprocedure('public.service_executor_member_context(uuid,bigint,text)') IS NULL THEN RAISE EXCEPTION 'stage4_context_rpc_missing'; END IF;
 IF to_regprocedure('public.service_get_operational_settings(bigint)') IS NOT NULL THEN RAISE EXCEPTION 'stage3_worker_bridge_not_removed'; END IF;
END $$;

DO $$
DECLARE ctx jsonb; installation uuid; session_id uuid; credential_id uuid; rejected boolean:=false;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.permissions WHERE permissions_key='capture.use') THEN
  INSERT INTO public.permissions(permissions_id,permissions_key,permissions_name,permissions_category,permissions_description,permissions_sensitivity)
  VALUES(2001,'capture.use','Usar captura','Captura','Smoke','delegable');
 END IF;
 ctx:=public.service_executor_member_context('00000000-0000-0000-0000-000000000001',10,'vinsansi_capture');
 IF (ctx->>'memberId')::bigint<>100 OR (ctx->>'organizationId')::bigint<>10 THEN RAISE EXCEPTION 'real_member_context_invalid'; END IF;

 INSERT INTO auth.users(id,email) VALUES('00000000-0000-0000-0000-000000000003','platform@example.com');
 INSERT INTO public.users(users_id,users_name,auth_user_id,users_is_scope) VALUES(999,'Platform','00000000-0000-0000-0000-000000000003',false);
 IF to_regclass('public.platform_owners') IS NULL THEN EXECUTE 'CREATE TABLE public.platform_owners(users_id bigint PRIMARY KEY REFERENCES public.users(users_id))'; END IF;
 INSERT INTO public.platform_owners(users_id) VALUES(999);
 BEGIN PERFORM public.service_executor_member_context('00000000-0000-0000-0000-000000000003',10,'vinsansi_capture');
 EXCEPTION WHEN OTHERS THEN rejected:=SQLERRM LIKE '%executor_active_membership_required%'; END;
 IF NOT rejected THEN RAISE EXCEPTION 'platform_owner_without_membership_was_accepted'; END IF;

 UPDATE public.organization_members SET status_id=2 WHERE organization_members_id=100; rejected:=false;
 BEGIN PERFORM public.service_executor_member_context('00000000-0000-0000-0000-000000000001',10,'vinsansi_capture');
 EXCEPTION WHEN OTHERS THEN rejected:=SQLERRM LIKE '%executor_active_membership_required%'; END;
 IF NOT rejected THEN RAISE EXCEPTION 'inactive_member_was_accepted'; END IF;
 UPDATE public.organization_members SET status_id=1 WHERE organization_members_id=100;

 installation:=public.service_register_tool_installation(10,'vinsansi_capture','stage4-smoke','0.18.0',ARRAY['capture.maps'],100,'{}');
 INSERT INTO public.tool_installation_credentials(organization_tool_installations_id,credential_hash,issued_to_external_installation_id)
 VALUES(installation,repeat('a',64),'stage4-smoke') RETURNING tool_installation_credentials_id INTO credential_id;
 INSERT INTO public.tool_user_sessions(organization_tool_installations_id,auth_users_id,users_id,session_hash)
 VALUES(installation,'00000000-0000-0000-0000-000000000001',2,repeat('b',64)) RETURNING tool_user_sessions_id INTO session_id;
 UPDATE public.organization_tool_installations SET registration_status='disabled' WHERE organization_tool_installations_id=installation;
 IF NOT EXISTS(SELECT 1 FROM public.tool_user_sessions WHERE tool_user_sessions_id=session_id AND revoked_at IS NOT NULL) THEN RAISE EXCEPTION 'session_not_revoked_on_disable'; END IF;
 IF EXISTS(SELECT 1 FROM public.tool_installation_credentials WHERE tool_installation_credentials_id=credential_id AND revoked_at IS NOT NULL) THEN RAISE EXCEPTION 'technical_credential_revoked_on_disable'; END IF;

 rejected:=false;
 BEGIN INSERT INTO public.tool_executor_pairings(tool_id,external_installation_id,pairing_code_hash,auth_users_id,users_id,organizations_id,organization_members_id,expires_at)
 VALUES('vinsansi_capture','invalid-expiry',repeat('c',64),'00000000-0000-0000-0000-000000000001',2,10,100,now()+interval '11 minutes');
 EXCEPTION WHEN check_violation THEN rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'pairing_longer_than_ten_minutes_was_accepted'; END IF;
END $$;
