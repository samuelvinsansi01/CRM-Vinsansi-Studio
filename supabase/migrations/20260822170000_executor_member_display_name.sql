BEGIN;

-- Correção final de homologação da Etapa 4. O nome humano é resolvido no
-- usuário canônico ligado à membership autenticada; nenhum executor envia
-- livremente o nome exibido.
CREATE OR REPLACE FUNCTION public.service_executor_member_context(
  p_auth_users_id uuid,p_organizations_id bigint,p_tool_id text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO pg_catalog,public,auth AS $$
DECLARE v_user bigint; v_member_name text; v_member public.organization_members%ROWTYPE; v_org public.organizations%ROWTYPE; v_permissions text[]; v_required text;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  SELECT users_id,coalesce(nullif(trim(users_name),''),'Usuário') INTO v_user,v_member_name
    FROM public.users WHERE auth_user_id=p_auth_users_id AND coalesce(users_is_scope,false)=false;
  IF v_user IS NULL THEN RAISE EXCEPTION 'executor_user_not_found'; END IF;
  SELECT * INTO v_member FROM public.organization_members
   WHERE organizations_id=p_organizations_id AND users_id=v_user AND status_id=1;
  IF v_member.organization_members_id IS NULL THEN RAISE EXCEPTION 'executor_active_membership_required'; END IF;
  SELECT * INTO v_org FROM public.organizations WHERE organizations_id=p_organizations_id AND status_id=1;
  IF v_org.organizations_id IS NULL THEN RAISE EXCEPTION 'executor_organization_inactive'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.organization_tools WHERE organizations_id=p_organizations_id AND tool_id=p_tool_id AND enabled) THEN RAISE EXCEPTION 'executor_tool_not_enabled'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.platform_tools WHERE tool_id=p_tool_id AND catalog_status='active') THEN RAISE EXCEPTION 'executor_tool_not_available'; END IF;
  IF v_member.access_level='owner' THEN
    SELECT coalesce(array_agg(permissions_key ORDER BY permissions_key),'{}') INTO v_permissions FROM public.permissions WHERE permissions_sensitivity<>'platform_only';
  ELSE
    SELECT coalesce(array_agg(DISTINCT p.permissions_key ORDER BY p.permissions_key),'{}') INTO v_permissions
      FROM public.organization_role_permissions rp JOIN public.permissions p ON p.permissions_id=rp.permissions_id
     WHERE rp.organization_roles_id=v_member.organization_roles_id AND p.permissions_sensitivity='delegable';
    IF v_member.access_level='manager' THEN v_permissions:=v_permissions||ARRAY['members.view','members.invite','members.edit','members.deactivate','roles.view','tools.view']; END IF;
  END IF;
  v_required:=CASE p_tool_id WHEN 'vinsansi_capture' THEN 'capture.use' WHEN 'vinsansi_instagram' THEN 'instagram.use' ELSE 'whatsapp.view' END;
  IF NOT (v_required=ANY(v_permissions)) THEN RAISE EXCEPTION 'executor_tool_permission_denied'; END IF;
  RETURN jsonb_build_object(
    'authUserId',p_auth_users_id,'userId',v_user,'organizationId',v_org.organizations_id,
    'organizationName',v_org.organizations_name,'legacyScopeUsersId',v_org.legacy_scope_users_id,
    'memberId',v_member.organization_members_id,'memberName',v_member_name,'accessLevel',v_member.access_level,
    'membershipStatusId',v_member.status_id,'permissions',to_jsonb(v_permissions),'requiredPermission',v_required
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.service_executor_eligible_organizations(p_auth_users_id uuid,p_tool_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO pg_catalog,public,auth AS $$
DECLARE v_user bigint; v_member_name text; v_result jsonb;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  SELECT users_id,coalesce(nullif(trim(users_name),''),'Usuário') INTO v_user,v_member_name
    FROM public.users WHERE auth_user_id=p_auth_users_id AND coalesce(users_is_scope,false)=false;
  SELECT coalesce(jsonb_agg(jsonb_build_object('organizationId',m.organizations_id,'organizationName',o.organizations_name,'memberId',m.organization_members_id,'memberName',v_member_name,'accessLevel',m.access_level) ORDER BY o.organizations_name),'[]'::jsonb)
    INTO v_result FROM public.organization_members m
    JOIN public.organizations o ON o.organizations_id=m.organizations_id AND o.status_id=1
    JOIN public.organization_tools ot ON ot.organizations_id=m.organizations_id AND ot.tool_id=p_tool_id AND ot.enabled
    JOIN public.platform_tools pt ON pt.tool_id=ot.tool_id AND pt.catalog_status='active'
   WHERE m.users_id=v_user AND m.status_id=1
     AND (m.access_level='owner' OR EXISTS(
       SELECT 1 FROM public.organization_role_permissions rp JOIN public.permissions p ON p.permissions_id=rp.permissions_id
        WHERE rp.organization_roles_id=m.organization_roles_id
          AND p.permissions_key=CASE p_tool_id WHEN 'vinsansi_capture' THEN 'capture.use' WHEN 'vinsansi_instagram' THEN 'instagram.use' ELSE 'whatsapp.view' END));
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_organization_context()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO pg_catalog,public AS $$
DECLARE
  v_actor bigint:=public.current_actor_user_id(); v_org bigint:=public.current_organization_id();
  v_member public.organization_members%ROWTYPE; v_org_row public.organizations%ROWTYPE;
  v_member_name text; v_role_name text; v_permissions jsonb; v_orgs jsonb;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF v_org IS NULL THEN RETURN jsonb_build_object('actorUsersId',v_actor,'organization',NULL,'organizations','[]'::jsonb,'permissions','[]'::jsonb,'isPlatformOwner',public.is_platform_owner(v_actor)); END IF;
  SELECT * INTO v_org_row FROM public.organizations WHERE organizations_id=v_org;
  SELECT * INTO v_member FROM public.organization_members WHERE organizations_id=v_org AND users_id=v_actor AND status_id=1 LIMIT 1;
  SELECT coalesce(nullif(trim(users_name),''),'Usuário') INTO v_member_name FROM public.users WHERE users_id=v_actor;
  IF v_member.organization_roles_id IS NOT NULL THEN SELECT organization_roles_name INTO v_role_name FROM public.organization_roles WHERE organization_roles_id=v_member.organization_roles_id; END IF;
  SELECT coalesce(jsonb_agg(p.permissions_key ORDER BY p.permissions_key),'[]'::jsonb) INTO v_permissions FROM public.permissions p WHERE public.has_organization_permission(p.permissions_key);
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id',x.organizations_id::text,'name',x.organizations_name,'accessLevel',x.access_level,
      'memberId',CASE WHEN x.organization_members_id IS NULL THEN NULL ELSE x.organization_members_id::text END,
      'roleName',x.role_name,'active',x.is_active_context
    ) ORDER BY x.organizations_name),'[]'::jsonb) INTO v_orgs FROM public.list_my_organizations() x;
  RETURN jsonb_build_object(
    'actorUsersId',v_actor::text,'isPlatformOwner',public.is_platform_owner(v_actor),
    'organization',jsonb_build_object('id',v_org_row.organizations_id::text,'name',v_org_row.organizations_name,'slug',to_jsonb(v_org_row)->>'organizations_slug','legacyScopeUsersId',to_jsonb(v_org_row)->>'legacy_scope_users_id'),
    'member',CASE WHEN v_member.organization_members_id IS NULL THEN NULL ELSE jsonb_build_object(
      'id',v_member.organization_members_id::text,'name',v_member_name,'accessLevel',v_member.access_level,
      'roleId',CASE WHEN v_member.organization_roles_id IS NULL THEN NULL ELSE v_member.organization_roles_id::text END,'roleName',v_role_name
    ) END,'permissions',v_permissions,'organizations',v_orgs
  );
END;
$$;

REVOKE ALL ON FUNCTION public.service_executor_member_context(uuid,bigint,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.service_executor_eligible_organizations(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.service_executor_member_context(uuid,bigint,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.service_executor_eligible_organizations(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_organization_context() TO authenticated;

COMMIT;
