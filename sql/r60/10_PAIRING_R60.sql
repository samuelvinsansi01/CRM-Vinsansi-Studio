BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS tool_executor_pairings_pending_installation_unique
ON public.tool_executor_pairings(tool_id,external_installation_id)
WHERE exchanged_at IS NULL AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS tool_executor_pairings_expiry_idx ON public.tool_executor_pairings(expires_at) WHERE exchanged_at IS NULL AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS tool_browser_pairings_expiry_idx ON public.tool_browser_pairings(expires_at) WHERE consumed_at IS NULL AND revoked_at IS NULL;

CREATE OR REPLACE FUNCTION public.service_exchange_executor_pairing(p_pairing_code_hash text,p_credential_hash text,p_session_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE p public.tool_executor_pairings%ROWTYPE; inst uuid;
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
 IF p_pairing_code_hash !~ '^[0-9a-f]{64}$' OR p_credential_hash !~ '^[0-9a-f]{64}$' OR p_session_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'pairing_hash_invalid'; END IF;
 SELECT * INTO p FROM public.tool_executor_pairings WHERE pairing_code_hash=p_pairing_code_hash FOR UPDATE;
 IF p.tool_executor_pairings_id IS NULL THEN RAISE EXCEPTION 'pairing_invalid'; END IF;
 IF p.exchanged_at IS NOT NULL OR p.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'pairing_already_consumed'; END IF;
 IF p.expires_at<=now() THEN UPDATE public.tool_executor_pairings SET revoked_at=now() WHERE tool_executor_pairings_id=p.tool_executor_pairings_id; RAISE EXCEPTION 'pairing_expired'; END IF;
 SELECT organization_tool_installations_id INTO inst FROM public.organization_tool_installations
 WHERE organizations_id=p.organizations_id AND tool_id=p.tool_id AND external_installation_id=p.external_installation_id AND is_current=true FOR UPDATE;
 IF inst IS NULL THEN
   INSERT INTO public.organization_tool_installations(organizations_id,tool_id,external_installation_id,registration_status,installed_version,reported_capabilities,registered_by_member_id,last_seen_member_id,last_seen_at,last_activity_at,metadata)
   VALUES(p.organizations_id,p.tool_id,p.external_installation_id,'registered',p.requested_version,p.requested_capabilities,p.organization_members_id,p.organization_members_id,now(),now(),jsonb_build_object('pairing','r60'))
   RETURNING organization_tool_installations_id INTO inst;
 END IF;
 INSERT INTO public.tool_installation_credentials(organization_tool_installations_id,credential_hash,issued_to_external_installation_id)
 VALUES(inst,p_credential_hash,p.external_installation_id);
 INSERT INTO public.tool_user_sessions(organization_tool_installations_id,auth_users_id,users_id,organizations_id,organization_members_id,session_hash)
 VALUES(inst,p.auth_users_id,p.users_id,p.organizations_id,p.organization_members_id,p_session_hash);
 UPDATE public.tool_executor_pairings SET exchanged_at=now() WHERE tool_executor_pairings_id=p.tool_executor_pairings_id AND exchanged_at IS NULL;
 RETURN jsonb_build_object('toolId',p.tool_id,'organizationId',p.organizations_id,'memberId',p.organization_members_id,'organizationToolInstallationId',inst);
END $$;

CREATE OR REPLACE FUNCTION public.service_cleanup_pairings_r60()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE a integer;b integer;
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
 UPDATE public.tool_executor_pairings SET revoked_at=coalesce(revoked_at,now()) WHERE exchanged_at IS NULL AND revoked_at IS NULL AND expires_at<=now(); GET DIAGNOSTICS a=ROW_COUNT;
 UPDATE public.tool_browser_pairings SET status='expired',revoked_at=coalesce(revoked_at,now()),updated_at=now() WHERE consumed_at IS NULL AND revoked_at IS NULL AND expires_at<=now(); GET DIAGNOSTICS b=ROW_COUNT;
 RETURN jsonb_build_object('executorExpired',a,'browserExpired',b);
END $$;

REVOKE ALL ON FUNCTION public.service_exchange_executor_pairing(text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.service_exchange_executor_pairing(text,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.service_cleanup_pairings_r60() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.service_cleanup_pairings_r60() TO service_role;

COMMIT;
