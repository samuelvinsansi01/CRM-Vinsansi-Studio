BEGIN;

CREATE TABLE IF NOT EXISTS public.mobile_push_devices (
  mobile_push_devices_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organizations_id bigint NOT NULL REFERENCES public.organizations(organizations_id) ON DELETE CASCADE,
  organization_members_id bigint NOT NULL REFERENCES public.organization_members(organization_members_id) ON DELETE CASCADE,
  users_id bigint NOT NULL REFERENCES public.users(users_id) ON DELETE CASCADE,
  device_id uuid NOT NULL,
  expo_push_token text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('ios','android')),
  app_version text NOT NULL DEFAULT '',
  enabled boolean NOT NULL DEFAULT true,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organizations_id, organization_members_id, device_id),
  UNIQUE (expo_push_token)
);

CREATE INDEX IF NOT EXISTS mobile_push_devices_org_enabled_idx ON public.mobile_push_devices(organizations_id,enabled,organization_members_id);
ALTER TABLE public.mobile_push_devices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mobile_push_devices FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.register_mobile_push_device_v1(p_device_id uuid,p_expo_push_token text,p_platform text,p_app_version text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog','public' AS $function$
DECLARE v_org bigint:=public.current_organization_id();v_user bigint:=public.ensure_current_user();v_member bigint:=public.current_organization_member_id();v_row public.mobile_push_devices%ROWTYPE;
BEGIN
  PERFORM public.require_organization_permission('whatsapp.view');
  IF v_org IS NULL OR v_user IS NULL OR v_member IS NULL THEN RAISE EXCEPTION 'organization_context_required'; END IF;
  IF p_device_id IS NULL OR nullif(trim(coalesce(p_expo_push_token,'')),'') IS NULL THEN RAISE EXCEPTION 'push_device_invalid'; END IF;
  IF lower(trim(coalesce(p_platform,''))) NOT IN ('ios','android') THEN RAISE EXCEPTION 'push_platform_invalid'; END IF;
  DELETE FROM public.mobile_push_devices WHERE expo_push_token=trim(p_expo_push_token) AND (organizations_id<>v_org OR organization_members_id<>v_member OR device_id<>p_device_id);
  INSERT INTO public.mobile_push_devices(organizations_id,organization_members_id,users_id,device_id,expo_push_token,platform,app_version,enabled,last_seen_at,updated_at)
  VALUES(v_org,v_member,v_user,p_device_id,trim(p_expo_push_token),lower(trim(p_platform)),coalesce(p_app_version,''),true,now(),now())
  ON CONFLICT(organizations_id,organization_members_id,device_id) DO UPDATE SET expo_push_token=excluded.expo_push_token,platform=excluded.platform,app_version=excluded.app_version,enabled=true,last_seen_at=now(),updated_at=now()
  RETURNING * INTO v_row;
  RETURN jsonb_build_object('deviceId',v_row.device_id,'enabled',v_row.enabled,'lastSeenAt',v_row.last_seen_at);
END;$function$;
REVOKE ALL ON FUNCTION public.register_mobile_push_device_v1(uuid,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.register_mobile_push_device_v1(uuid,text,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.disable_mobile_push_device_v1(p_device_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog','public' AS $function$
DECLARE v_org bigint:=public.current_organization_id();v_member bigint:=public.current_organization_member_id();
BEGIN
  IF v_org IS NULL OR v_member IS NULL THEN RETURN false; END IF;
  UPDATE public.mobile_push_devices SET enabled=false,updated_at=now() WHERE organizations_id=v_org AND organization_members_id=v_member AND device_id=p_device_id;
  RETURN FOUND;
END;$function$;
REVOKE ALL ON FUNCTION public.disable_mobile_push_device_v1(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.disable_mobile_push_device_v1(uuid) TO authenticated;


-- O estágio comercial precisa propagar em tempo real entre CRM, Gerenciador e Mobile.
DO $block$
BEGIN
  IF to_regclass('public.lead_commercial') IS NOT NULL
     AND EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'lead_commercial'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.lead_commercial;
  END IF;
END;
$block$;

COMMIT;
