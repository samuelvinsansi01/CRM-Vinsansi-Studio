BEGIN;

-- Correção de homologação da Etapa 4: a sessão humana passa a pinçar o mesmo
-- organization_id + member_id já validado no pairing. Sessões antigas sem uma
-- cadeia canônica completa são revogadas, nunca reaproveitadas por inferência.
ALTER TABLE public.tool_user_sessions
  ADD COLUMN IF NOT EXISTS organizations_id bigint REFERENCES public.organizations(organizations_id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS organization_members_id bigint REFERENCES public.organization_members(organization_members_id) ON DELETE CASCADE;

UPDATE public.tool_user_sessions s
   SET organizations_id=i.organizations_id
  FROM public.organization_tool_installations i
 WHERE i.organization_tool_installations_id=s.organization_tool_installations_id
   AND s.organizations_id IS NULL;

UPDATE public.tool_user_sessions s
   SET organization_members_id=m.organization_members_id
  FROM public.organization_members m
  JOIN public.users u ON u.users_id=m.users_id AND coalesce(u.users_is_scope,false)=false
 WHERE s.organization_members_id IS NULL
   AND m.organizations_id=s.organizations_id
   AND m.users_id=s.users_id
   AND u.auth_user_id=s.auth_users_id;

UPDATE public.tool_user_sessions s
   SET revoked_at=coalesce(s.revoked_at,now()),logout_reason=coalesce(s.logout_reason,'context_incomplete')
 WHERE s.revoked_at IS NULL
   AND (
     s.organizations_id IS NULL OR s.organization_members_id IS NULL OR
     NOT EXISTS(
       SELECT 1
         FROM public.organization_tool_installations i
         JOIN public.organization_members m ON m.organization_members_id=s.organization_members_id
         JOIN public.users u ON u.users_id=s.users_id
        WHERE i.organization_tool_installations_id=s.organization_tool_installations_id
          AND i.organizations_id=s.organizations_id
          AND m.organizations_id=s.organizations_id
          AND m.users_id=s.users_id
          AND m.status_id=1
          AND u.auth_user_id=s.auth_users_id
          AND coalesce(u.users_is_scope,false)=false
     )
   );

ALTER TABLE public.tool_user_sessions DROP CONSTRAINT IF EXISTS tool_user_sessions_active_context_check;
ALTER TABLE public.tool_user_sessions ADD CONSTRAINT tool_user_sessions_active_context_check
  CHECK(revoked_at IS NOT NULL OR (organizations_id IS NOT NULL AND organization_members_id IS NOT NULL));
CREATE INDEX IF NOT EXISTS tool_sessions_context_idx
  ON public.tool_user_sessions(organizations_id,organization_members_id,last_used_at DESC) WHERE revoked_at IS NULL;

CREATE OR REPLACE FUNCTION public.service_executor_member_context(
  p_auth_users_id uuid,p_organizations_id bigint,p_tool_id text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO pg_catalog,public,auth AS $$
DECLARE v_user bigint; v_member_name text; v_member public.organization_members%ROWTYPE; v_org public.organizations%ROWTYPE; v_permissions text[]; v_required text;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  SELECT users_id,coalesce(nullif(trim(users_name),''),'Usuário') INTO v_user,v_member_name FROM public.users
   WHERE auth_user_id=p_auth_users_id AND coalesce(users_is_scope,false)=false;
  IF v_user IS NULL THEN RAISE EXCEPTION 'executor_user_not_found'; END IF;
  SELECT * INTO v_member FROM public.organization_members
   WHERE organizations_id=p_organizations_id AND users_id=v_user AND status_id=1;
  IF v_member.organization_members_id IS NULL THEN RAISE EXCEPTION 'executor_active_membership_required'; END IF;
  SELECT * INTO v_org FROM public.organizations WHERE organizations_id=p_organizations_id AND status_id=1;
  IF v_org.organizations_id IS NULL THEN RAISE EXCEPTION 'executor_organization_inactive'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.organization_tools WHERE organizations_id=p_organizations_id AND tool_id=p_tool_id AND enabled) THEN
    RAISE EXCEPTION 'executor_tool_not_enabled';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.platform_tools WHERE tool_id=p_tool_id AND catalog_status='active') THEN
    RAISE EXCEPTION 'executor_tool_not_available';
  END IF;
  IF v_member.access_level='owner' THEN
    SELECT coalesce(array_agg(permissions_key ORDER BY permissions_key),'{}') INTO v_permissions
      FROM public.permissions WHERE permissions_sensitivity<>'platform_only';
  ELSE
    SELECT coalesce(array_agg(DISTINCT p.permissions_key ORDER BY p.permissions_key),'{}') INTO v_permissions
      FROM public.organization_role_permissions rp
      JOIN public.permissions p ON p.permissions_id=rp.permissions_id
     WHERE rp.organization_roles_id=v_member.organization_roles_id
       AND p.permissions_sensitivity='delegable';
    IF v_member.access_level='manager' THEN
      v_permissions:=v_permissions||ARRAY['members.view','members.invite','members.edit','members.deactivate','roles.view','tools.view'];
    END IF;
  END IF;
  v_required:=CASE p_tool_id WHEN 'vinsansi_capture' THEN 'capture.use' WHEN 'vinsansi_instagram' THEN 'instagram.use' ELSE 'whatsapp.view' END;
  IF NOT (v_required=ANY(v_permissions)) THEN RAISE EXCEPTION 'executor_tool_permission_denied'; END IF;
  RETURN jsonb_build_object(
    'authUserId',p_auth_users_id,'userId',v_user,'organizationId',v_org.organizations_id,
    'organizationName',v_org.organizations_name,'legacyScopeUsersId',v_org.legacy_scope_users_id,
    'memberId',v_member.organization_members_id,'memberName',v_member_name,'accessLevel',v_member.access_level,
    'membershipStatusId',v_member.status_id,
    'permissions',to_jsonb(v_permissions),'requiredPermission',v_required
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.service_exchange_executor_pairing(p_pairing_code_hash text,p_credential_hash text,p_session_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public,auth AS $$
DECLARE p public.tool_executor_pairings%ROWTYPE; installation uuid; credential uuid; session_id uuid; v_context jsonb;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  IF length(p_credential_hash)<>64 OR length(p_session_hash)<>64 THEN RAISE EXCEPTION 'executor_token_hash_invalid'; END IF;
  SELECT * INTO p FROM public.tool_executor_pairings
   WHERE pairing_code_hash=p_pairing_code_hash AND exchanged_at IS NULL AND revoked_at IS NULL AND expires_at>now() FOR UPDATE;
  IF p.tool_executor_pairings_id IS NULL THEN RAISE EXCEPTION 'pairing_invalid_or_expired'; END IF;
  v_context:=public.service_executor_member_context(p.auth_users_id,p.organizations_id,p.tool_id);
  IF (v_context->>'userId')::bigint<>p.users_id OR (v_context->>'memberId')::bigint<>p.organization_members_id THEN
    RAISE EXCEPTION 'pairing_context_divergent';
  END IF;
  installation:=public.service_register_tool_installation(p.organizations_id,p.tool_id,p.external_installation_id,p.requested_version,p.requested_capabilities,p.organization_members_id,jsonb_build_object('pairing','stage4'));
  INSERT INTO public.tool_installation_credentials(organization_tool_installations_id,credential_hash,issued_to_external_installation_id)
  VALUES(installation,p_credential_hash,p.external_installation_id) RETURNING tool_installation_credentials_id INTO credential;
  INSERT INTO public.tool_user_sessions(organization_tool_installations_id,auth_users_id,users_id,organizations_id,organization_members_id,session_hash)
  VALUES(installation,p.auth_users_id,p.users_id,p.organizations_id,p.organization_members_id,p_session_hash)
  RETURNING tool_user_sessions_id INTO session_id;
  UPDATE public.tool_executor_pairings SET exchanged_at=now() WHERE tool_executor_pairings_id=p.tool_executor_pairings_id;
  RETURN jsonb_build_object('toolId',p.tool_id,'organizationId',p.organizations_id,'memberId',p.organization_members_id,'organizationToolInstallationId',installation,'credentialId',credential,'sessionId',session_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_tool_user_session_context()
RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog,public AS $$
DECLARE v_installation_org bigint; v_member public.organization_members%ROWTYPE; v_auth_user bigint;
BEGIN
  SELECT organizations_id INTO v_installation_org FROM public.organization_tool_installations
   WHERE organization_tool_installations_id=NEW.organization_tool_installations_id;
  SELECT * INTO v_member FROM public.organization_members WHERE organization_members_id=NEW.organization_members_id;
  SELECT users_id INTO v_auth_user FROM public.users
   WHERE auth_user_id=NEW.auth_users_id AND coalesce(users_is_scope,false)=false;
  IF v_installation_org IS NULL OR v_installation_org<>NEW.organizations_id
     OR v_auth_user IS NULL OR v_auth_user<>NEW.users_id
     OR v_member.organization_members_id IS NULL OR v_member.organizations_id<>NEW.organizations_id
     OR v_member.users_id<>NEW.users_id OR v_member.status_id<>1 THEN
    RAISE EXCEPTION 'tool_user_session_context_divergent';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS validate_tool_user_session_context_trigger ON public.tool_user_sessions;
CREATE TRIGGER validate_tool_user_session_context_trigger
BEFORE INSERT OR UPDATE OF organization_tool_installations_id,auth_users_id,users_id,organizations_id,organization_members_id ON public.tool_user_sessions
FOR EACH ROW EXECUTE FUNCTION public.validate_tool_user_session_context();

CREATE OR REPLACE FUNCTION public.revoke_executor_sessions_on_member_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
BEGIN
  IF NEW.status_id<>1 AND OLD.status_id IS DISTINCT FROM NEW.status_id THEN
    UPDATE public.tool_user_sessions
       SET revoked_at=coalesce(revoked_at,now()),logout_reason=coalesce(logout_reason,'membership_inactive')
     WHERE organization_members_id=NEW.organization_members_id AND revoked_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS revoke_executor_sessions_on_member_change_trigger ON public.organization_members;
CREATE TRIGGER revoke_executor_sessions_on_member_change_trigger
AFTER UPDATE OF status_id ON public.organization_members
FOR EACH ROW EXECUTE FUNCTION public.revoke_executor_sessions_on_member_change();

REVOKE ALL ON FUNCTION public.service_executor_member_context(uuid,bigint,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.service_exchange_executor_pairing(text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.service_executor_member_context(uuid,bigint,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.service_exchange_executor_pairing(text,text,text) TO service_role;

COMMIT;
