BEGIN;

-- Hotfix para bancos que ja receberam as Etapas 2 e 3.
-- auth.users.email e character varying(255), enquanto o contrato publico e text.
CREATE OR REPLACE FUNCTION public.list_platform_organizations_admin()
RETURNS TABLE(
  organization_id bigint,
  name text,
  status_id bigint,
  owner_member_id bigint,
  owner_name text,
  owner_email text,
  member_count bigint,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path TO pg_catalog, public, auth
AS $$
BEGIN
  IF NOT public.is_platform_owner() THEN RAISE EXCEPTION 'platform_owner_required'; END IF;
  RETURN QUERY
  SELECT o.organizations_id::bigint,o.organizations_name::text,o.status_id::bigint,
         owner_m.organization_members_id::bigint,
         coalesce(nullif(owner_u.users_name,''),split_part(coalesce(owner_auth.email,''),'@',1))::text,
         coalesce(owner_auth.email,'')::text,
         (SELECT count(*)::bigint FROM public.organization_members m WHERE m.organizations_id=o.organizations_id AND m.status_id=1),
         o.organizations_created_at::timestamptz
    FROM public.organizations o
    LEFT JOIN public.organization_members owner_m ON owner_m.organizations_id=o.organizations_id AND owner_m.access_level='owner' AND owner_m.status_id=1
    LEFT JOIN public.users owner_u ON owner_u.users_id=owner_m.users_id
    LEFT JOIN auth.users owner_auth ON owner_auth.id=owner_u.auth_user_id
   ORDER BY o.status_id,o.organizations_name,o.organizations_id;
END;
$$;

-- O mesmo varchar x text ocorria na listagem de membros da organizacao.
CREATE OR REPLACE FUNCTION public.list_organization_members_admin()
RETURNS TABLE(
  member_id bigint,
  users_id bigint,
  name text,
  email text,
  access_level text,
  role_id bigint,
  role_name text,
  status_id bigint,
  joined_at timestamptz,
  deactivated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path TO pg_catalog, public, auth
AS $$
BEGIN
  IF NOT (public.has_organization_permission('members.view') OR public.current_access_level()='owner') THEN
    RAISE EXCEPTION 'permission_denied:members.view';
  END IF;
  RETURN QUERY
  SELECT m.organization_members_id::bigint,u.users_id::bigint,
         coalesce(nullif(u.users_name,''),split_part(coalesce(au.email,''),'@',1))::text,
         coalesce(au.email,'')::text,
         m.access_level::text,m.organization_roles_id::bigint,r.organization_roles_name::text,
         m.status_id::bigint,m.joined_at::timestamptz,m.deactivated_at::timestamptz
    FROM public.organization_members m
    JOIN public.users u ON u.users_id=m.users_id
    LEFT JOIN auth.users au ON au.id=u.auth_user_id
    LEFT JOIN public.organization_roles r ON r.organization_roles_id=m.organization_roles_id
   WHERE m.organizations_id=public.current_organization_id()
   ORDER BY CASE m.access_level WHEN 'owner' THEN 1 WHEN 'manager' THEN 2 ELSE 3 END,
            lower(coalesce(u.users_name,au.email,''));
END;
$$;

-- Contrato tabular unico da Etapa 3, com ordem/tipos explicitos e defaults nao nulos.
CREATE OR REPLACE FUNCTION public.get_user_operational_settings()
RETURNS TABLE(dispatch_settings jsonb,import_settings jsonb,extension_runtime_config jsonb,operational_timezone text,operational_cutoff_hour smallint,settings_version integer,updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO pg_catalog,public AS $$
DECLARE
  v_org bigint:=public.current_organization_id();
  wa jsonb; ig jsonb; cap jsonb;
  wa_v bigint; ig_v bigint; cap_v bigint;
  wa_at timestamptz; ig_at timestamptz; cap_at timestamptz;
BEGIN
  PERFORM public.require_organization_permission('settings.view');
  SELECT ots.settings,ots.settings_version,ots.updated_at INTO wa,wa_v,wa_at FROM public.organization_tool_settings ots WHERE ots.organizations_id=v_org AND ots.tool_id='vinsansi_whatsapp_manager';
  SELECT ots.settings,ots.settings_version,ots.updated_at INTO ig,ig_v,ig_at FROM public.organization_tool_settings ots WHERE ots.organizations_id=v_org AND ots.tool_id='vinsansi_instagram';
  SELECT ots.settings,ots.settings_version,ots.updated_at INTO cap,cap_v,cap_at FROM public.organization_tool_settings ots WHERE ots.organizations_id=v_org AND ots.tool_id='vinsansi_capture';
  RETURN QUERY SELECT
    jsonb_build_object('whatsapp',wa->'whatsapp','instagram',ig->'instagram','chipLevels',wa->'chipLevels')::jsonb,
    coalesce(cap,'{}'::jsonb)::jsonb,
    jsonb_build_object('version',1,'source','platform','generatedAt',clock_timestamp(),'instagram',jsonb_build_object('dispatch',ig->'instagram'),'whatsapp',jsonb_build_object('dispatch',wa->'whatsapp'))::jsonb,
    coalesce(nullif(wa->>'operationalTimezone',''),'America/Sao_Paulo')::text,
    coalesce((wa->>'operationalCutoffHour')::smallint,22::smallint)::smallint,
    greatest(coalesce(wa_v,0::bigint),coalesce(ig_v,0::bigint),coalesce(cap_v,0::bigint))::integer,
    coalesce(nullif(greatest(coalesce(wa_at,'-infinity'::timestamptz),coalesce(ig_at,'-infinity'::timestamptz),coalesce(cap_at,'-infinity'::timestamptz)),'-infinity'::timestamptz),statement_timestamp())::timestamptz;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_platform_organizations_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_organization_members_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_operational_settings() TO authenticated;

COMMIT;
