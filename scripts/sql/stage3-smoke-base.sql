CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT '00000000-0000-0000-0000-000000000001'::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'service_role'::text $$;

CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;

CREATE TABLE public.users (
  users_id bigint PRIMARY KEY,
  users_name text,
  auth_user_id uuid,
  users_is_scope boolean DEFAULT false
);
CREATE TABLE public.organizations (
  organizations_id bigint PRIMARY KEY,
  organizations_name text,
  legacy_scope_users_id bigint NOT NULL REFERENCES public.users(users_id),
  status_id integer NOT NULL DEFAULT 1
);
CREATE TABLE public.organization_members (
  organization_members_id bigint PRIMARY KEY,
  organizations_id bigint NOT NULL REFERENCES public.organizations(organizations_id),
  users_id bigint NOT NULL REFERENCES public.users(users_id),
  access_level text NOT NULL,
  status_id integer NOT NULL DEFAULT 1
);

INSERT INTO public.users VALUES(1,'Vinsansi Scope',NULL,true),(2,'Drew','00000000-0000-0000-0000-000000000001',false);
INSERT INTO public.organizations VALUES(10,'Vinsansi Studio',1,1);
INSERT INTO public.organization_members VALUES(100,10,2,'owner',1);

CREATE TABLE public.user_operational_settings (
  user_operational_settings_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  users_id bigint NOT NULL,
  organizations_id bigint NOT NULL,
  dispatch_settings jsonb NOT NULL,
  import_settings jsonb NOT NULL,
  extension_runtime_config jsonb,
  operational_timezone text,
  operational_cutoff_hour smallint,
  settings_version integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.user_operational_settings(
  users_id,organizations_id,dispatch_settings,import_settings,extension_runtime_config,
  operational_timezone,operational_cutoff_hour,settings_version
) VALUES(
  1,10,
  '{"whatsapp":{"startTime":"09:00","endTime":"17:00","delayMinSeconds":30,"delayMaxSeconds":60,"perBatch":20,"batches":2,"batchDelayMinutes":30,"dailyLimit":40,"activeDays":["Segunda"],"batchBehavior":"Teste"},"instagram":{"profile":"Todos","profiles":["Todos"],"startTime":"10:00","endTime":"16:00","delayMinSeconds":40,"delayMaxSeconds":80,"perBatch":10,"batches":3,"batchDelayMinutes":45,"delayMinutes":45,"dailyLimit":30,"activeDays":["Terca"],"batchBehavior":"Teste"},"chipLevels":{"iniciante":{"dailyLimit":10}}}'::jsonb,
  '{"minRating":4.5,"minReviews":20,"safeMode":{"simulationMode":false},"instagramLowRating":{"enabled":true,"minRating":3.8,"maxRatingExclusive":4.5,"minReviews":8},"branchRules":[],"deduplication":{"enabled":true,"byPhone":true,"bySite":true,"blockBasePermanent":true,"allowSmartReimport":false,"incrementalImport":true},"routes":{"whatsapp":true,"instagram":true,"ownSite":true,"aggregators":false,"blockFacebookAsSite":true,"requireConfiguredCategory":true,"rejectOutOfProfile":true},"logs":{"enabled":true,"logRejected":true,"logRejectionReason":true}}'::jsonb,
  '{"obsolete":true}'::jsonb,'America/Fortaleza',21,7
);

CREATE TABLE public.maps_extension_installations (
  maps_extension_installations_id uuid PRIMARY KEY,
  users_id bigint NOT NULL,
  organizations_id bigint NOT NULL,
  extension_type text NOT NULL,
  installation_id text NOT NULL,
  scopes text[] NOT NULL DEFAULT '{}',
  status text NOT NULL,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(users_id,extension_type,installation_id)
);
CREATE TABLE public.maps_extension_pairings (
  maps_extension_pairings_id uuid PRIMARY KEY,
  users_id bigint,
  organizations_id bigint NOT NULL,
  installation_id text NOT NULL
);
INSERT INTO public.maps_extension_installations VALUES(
  '10000000-0000-0000-0000-000000000001',1,10,'google_maps','gmaps-smoke-installation-0001',ARRAY['maps:catalogs:read'],'active',now()-interval '2 minutes',NULL,now()-interval '1 day',now()
);

CREATE FUNCTION public.current_actor_user_id() RETURNS bigint LANGUAGE sql STABLE AS $$ SELECT 2::bigint $$;
CREATE FUNCTION public.is_platform_owner(p_users_id bigint DEFAULT NULL) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
CREATE FUNCTION public.current_organization_id() RETURNS bigint LANGUAGE sql STABLE AS $$ SELECT 10::bigint $$;
CREATE FUNCTION public.current_organization_member_id() RETURNS bigint LANGUAGE sql STABLE AS $$ SELECT 100::bigint $$;
CREATE FUNCTION public.has_organization_permission(p_permission_key text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
CREATE FUNCTION public.require_organization_permission(p_permission_key text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF p_permission_key IS NULL THEN RAISE EXCEPTION 'permission_required'; END IF; END $$;
CREATE FUNCTION public.append_audit_event(
  p_source text,p_action text,p_entity_type text,p_entity_id text DEFAULT NULL,p_lead_id bigint DEFAULT NULL,
  p_queue_item_id bigint DEFAULT NULL,p_channel_id bigint DEFAULT NULL,p_previous_status_id bigint DEFAULT NULL,
  p_target_status_id bigint DEFAULT NULL,p_message text DEFAULT NULL,p_metadata jsonb DEFAULT '{}'::jsonb,p_users_id bigint DEFAULT NULL
) RETURNS bigint LANGUAGE sql AS $$ SELECT 1::bigint $$;

