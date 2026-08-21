BEGIN;

-- Etapa 4: contexto organizacional dos executores. Tokens brutos nunca são
-- persistidos; apenas SHA-256. A tabela de pareamentos é deliberadamente
-- mínima e existe porque o código descartável não pode ser armazenado nas
-- tabelas de credencial/sessão nem no bridge legado do Maps.
CREATE TABLE IF NOT EXISTS public.tool_executor_pairings (
  tool_executor_pairings_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_id text NOT NULL REFERENCES public.platform_tools(tool_id) ON DELETE RESTRICT,
  external_installation_id text NOT NULL CHECK(length(trim(external_installation_id)) BETWEEN 1 AND 200),
  pairing_code_hash text NOT NULL UNIQUE CHECK(length(pairing_code_hash)=64),
  auth_users_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  users_id bigint NOT NULL REFERENCES public.users(users_id) ON DELETE CASCADE,
  organizations_id bigint NOT NULL REFERENCES public.organizations(organizations_id) ON DELETE CASCADE,
  organization_members_id bigint NOT NULL REFERENCES public.organization_members(organization_members_id) ON DELETE CASCADE,
  requested_version text,
  requested_capabilities text[] NOT NULL DEFAULT '{}',
  expires_at timestamptz NOT NULL,
  exchanged_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(expires_at<=created_at+interval '10 minutes'),
  CHECK(public.tool_semver_is_valid(requested_version))
);

CREATE TABLE IF NOT EXISTS public.tool_installation_credentials (
  tool_installation_credentials_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_tool_installations_id uuid NOT NULL REFERENCES public.organization_tool_installations(organization_tool_installations_id) ON DELETE CASCADE,
  credential_hash text NOT NULL UNIQUE CHECK(length(credential_hash)=64),
  issued_to_external_installation_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  replaced_by_id uuid REFERENCES public.tool_installation_credentials(tool_installation_credentials_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.tool_user_sessions (
  tool_user_sessions_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_tool_installations_id uuid NOT NULL REFERENCES public.organization_tool_installations(organization_tool_installations_id) ON DELETE CASCADE,
  auth_users_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  users_id bigint NOT NULL REFERENCES public.users(users_id) ON DELETE CASCADE,
  session_hash text NOT NULL UNIQUE CHECK(length(session_hash)=64),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  logout_reason text,
  CHECK(last_used_at>=created_at)
);

CREATE INDEX IF NOT EXISTS tool_pairings_expiry_idx ON public.tool_executor_pairings(expires_at) WHERE exchanged_at IS NULL AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS tool_credentials_installation_idx ON public.tool_installation_credentials(organization_tool_installations_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS tool_sessions_lookup_idx ON public.tool_user_sessions(auth_users_id,last_used_at DESC) WHERE revoked_at IS NULL;

CREATE OR REPLACE FUNCTION public.seed_executor_tools_for_organization()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
BEGIN
  INSERT INTO public.organization_tools(organizations_id,tool_id,enabled)
  SELECT NEW.organizations_id,pt.tool_id,true FROM public.platform_tools pt WHERE pt.catalog_status='active'
  ON CONFLICT(organizations_id,tool_id) DO NOTHING;
  INSERT INTO public.organization_tool_settings(organizations_id,tool_id,settings,settings_schema_version)
  SELECT NEW.organizations_id,pt.tool_id,pt.default_settings,pt.settings_schema_version FROM public.platform_tools pt WHERE pt.catalog_status='active'
  ON CONFLICT(organizations_id,tool_id) DO NOTHING;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS seed_executor_tools_for_organization ON public.organizations;
CREATE TRIGGER seed_executor_tools_for_organization AFTER INSERT ON public.organizations FOR EACH ROW EXECUTE FUNCTION public.seed_executor_tools_for_organization();
INSERT INTO public.organization_tools(organizations_id,tool_id,enabled)
SELECT o.organizations_id,pt.tool_id,true FROM public.organizations o CROSS JOIN public.platform_tools pt WHERE o.status_id=1 AND pt.catalog_status='active'
ON CONFLICT(organizations_id,tool_id) DO NOTHING;
INSERT INTO public.organization_tool_settings(organizations_id,tool_id,settings,settings_schema_version)
SELECT o.organizations_id,pt.tool_id,pt.default_settings,pt.settings_schema_version FROM public.organizations o CROSS JOIN public.platform_tools pt WHERE o.status_id=1 AND pt.catalog_status='active'
ON CONFLICT(organizations_id,tool_id) DO NOTHING;

ALTER TABLE public.tool_executor_pairings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tool_installation_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tool_user_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tool_executor_pairings,public.tool_installation_credentials,public.tool_user_sessions FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.tool_executor_pairings,public.tool_installation_credentials,public.tool_user_sessions TO service_role;

CREATE OR REPLACE FUNCTION public.service_executor_member_context(
  p_auth_users_id uuid,p_organizations_id bigint,p_tool_id text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO pg_catalog,public,auth AS $$
DECLARE v_user bigint; v_member public.organization_members%ROWTYPE; v_org public.organizations%ROWTYPE; v_permissions text[]; v_required text;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  SELECT users_id INTO v_user FROM public.users WHERE auth_user_id=p_auth_users_id AND coalesce(users_is_scope,false)=false;
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
    'memberId',v_member.organization_members_id,'accessLevel',v_member.access_level,
    'permissions',to_jsonb(v_permissions),'requiredPermission',v_required
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.service_executor_eligible_organizations(p_auth_users_id uuid,p_tool_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO pg_catalog,public,auth AS $$
DECLARE v_user bigint; v_result jsonb;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  SELECT users_id INTO v_user FROM public.users WHERE auth_user_id=p_auth_users_id AND coalesce(users_is_scope,false)=false;
  SELECT coalesce(jsonb_agg(jsonb_build_object('organizationId',m.organizations_id,'organizationName',o.organizations_name,'memberId',m.organization_members_id,'accessLevel',m.access_level) ORDER BY o.organizations_name),'[]'::jsonb)
    INTO v_result
    FROM public.organization_members m
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

CREATE OR REPLACE FUNCTION public.service_exchange_executor_pairing(p_pairing_code_hash text,p_credential_hash text,p_session_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public,auth AS $$
DECLARE p public.tool_executor_pairings%ROWTYPE; installation uuid; credential uuid; session_id uuid;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  IF length(p_credential_hash)<>64 OR length(p_session_hash)<>64 THEN RAISE EXCEPTION 'executor_token_hash_invalid'; END IF;
  SELECT * INTO p FROM public.tool_executor_pairings WHERE pairing_code_hash=p_pairing_code_hash AND exchanged_at IS NULL AND revoked_at IS NULL AND expires_at>now() FOR UPDATE;
  IF p.tool_executor_pairings_id IS NULL THEN RAISE EXCEPTION 'pairing_invalid_or_expired'; END IF;
  PERFORM public.service_executor_member_context(p.auth_users_id,p.organizations_id,p.tool_id);
  installation:=public.service_register_tool_installation(p.organizations_id,p.tool_id,p.external_installation_id,p.requested_version,p.requested_capabilities,p.organization_members_id,jsonb_build_object('pairing','stage4'));
  INSERT INTO public.tool_installation_credentials(organization_tool_installations_id,credential_hash,issued_to_external_installation_id)
  VALUES(installation,p_credential_hash,p.external_installation_id) RETURNING tool_installation_credentials_id INTO credential;
  INSERT INTO public.tool_user_sessions(organization_tool_installations_id,auth_users_id,users_id,session_hash)
  VALUES(installation,p.auth_users_id,p.users_id,p_session_hash) RETURNING tool_user_sessions_id INTO session_id;
  UPDATE public.tool_executor_pairings SET exchanged_at=now() WHERE tool_executor_pairings_id=p.tool_executor_pairings_id;
  RETURN jsonb_build_object('toolId',p.tool_id,'organizationId',p.organizations_id,'memberId',p.organization_members_id,'organizationToolInstallationId',installation,'credentialId',credential,'sessionId',session_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_executor_sessions_on_installation_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
BEGIN
  IF NEW.registration_status IN ('disabled','revoked') AND OLD.registration_status IS DISTINCT FROM NEW.registration_status THEN
    UPDATE public.tool_user_sessions SET revoked_at=coalesce(revoked_at,now()),logout_reason='installation_'||NEW.registration_status
     WHERE organization_tool_installations_id=NEW.organization_tool_installations_id AND revoked_at IS NULL;
    IF NEW.registration_status='revoked' THEN
      UPDATE public.tool_installation_credentials SET revoked_at=coalesce(revoked_at,now())
       WHERE organization_tool_installations_id=NEW.organization_tool_installations_id AND revoked_at IS NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS revoke_executor_sessions_on_installation_change ON public.organization_tool_installations;
CREATE TRIGGER revoke_executor_sessions_on_installation_change AFTER UPDATE OF registration_status ON public.organization_tool_installations
FOR EACH ROW EXECUTE FUNCTION public.revoke_executor_sessions_on_installation_change();

-- Pinagem de autoria disponível nos contratos já existentes.
DO $pin$
BEGIN
  IF to_regclass('public.maps_extension_pairings') IS NOT NULL THEN
    ALTER TABLE public.maps_extension_pairings ADD COLUMN IF NOT EXISTS authorized_auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
    ALTER TABLE public.maps_extension_pairings ADD COLUMN IF NOT EXISTS authorized_actor_users_id bigint REFERENCES public.users(users_id) ON DELETE SET NULL;
  END IF;
  IF to_regclass('public.maps_search_executions') IS NOT NULL THEN
    ALTER TABLE public.maps_search_executions ADD COLUMN IF NOT EXISTS initiated_by_member_id bigint REFERENCES public.organization_members(organization_members_id) ON DELETE SET NULL;
    ALTER TABLE public.maps_search_executions ADD COLUMN IF NOT EXISTS source_installation_id uuid REFERENCES public.organization_tool_installations(organization_tool_installations_id) ON DELETE SET NULL;
  END IF;
END $pin$;

DROP FUNCTION IF EXISTS public.service_get_operational_settings(bigint);

UPDATE public.platform_tools SET latest_version=CASE tool_id WHEN 'vinsansi_capture' THEN '0.18.0' WHEN 'vinsansi_instagram' THEN '1.7.0' WHEN 'vinsansi_whatsapp_manager' THEN '1.1.0' ELSE latest_version END,updated_at=now()
WHERE tool_id IN ('vinsansi_capture','vinsansi_instagram','vinsansi_whatsapp_manager');

-- Heartbeat técnico continua aceito em estado administrativo disabled; atividade
-- comercial continua restrita a instalações registered.
CREATE OR REPLACE FUNCTION public.service_touch_tool_installation(
  p_organizations_id bigint,p_tool_id text,p_external_installation_id text,p_seen boolean DEFAULT true,p_meaningful_activity boolean DEFAULT false,
  p_installed_version text DEFAULT NULL,p_reported_capabilities text[] DEFAULT NULL,p_last_seen_member_id bigint DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_id uuid;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  IF NOT public.tool_semver_is_valid(p_installed_version) THEN RAISE EXCEPTION 'tool_semver_invalid'; END IF;
  UPDATE public.organization_tool_installations SET last_seen_at=CASE WHEN p_seen THEN now() ELSE last_seen_at END,
    last_activity_at=CASE WHEN p_meaningful_activity THEN now() ELSE last_activity_at END,installed_version=coalesce(p_installed_version,installed_version),
    reported_capabilities=coalesce(p_reported_capabilities,reported_capabilities),last_seen_member_id=coalesce(p_last_seen_member_id,last_seen_member_id)
  WHERE organizations_id=p_organizations_id AND tool_id=p_tool_id AND external_installation_id=p_external_installation_id
    AND (registration_status='registered' OR (registration_status='disabled' AND NOT p_meaningful_activity))
  RETURNING organization_tool_installations_id INTO v_id;
  IF v_id IS NULL THEN RAISE EXCEPTION 'tool_installation_not_registered'; END IF;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.service_executor_member_context(uuid,bigint,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.service_executor_eligible_organizations(uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.service_exchange_executor_pairing(text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.service_executor_member_context(uuid,bigint,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.service_executor_eligible_organizations(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.service_exchange_executor_pairing(text,text,text) TO service_role;

COMMIT;


