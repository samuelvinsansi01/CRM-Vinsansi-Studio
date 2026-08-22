BEGIN;

-- Etapa 3: Central de Ferramentas e Configuracoes.
-- CRM/Supabase passa a ser o control plane canonico. Os executores continuam
-- com seus contratos atuais ate a Etapa 4.

CREATE OR REPLACE FUNCTION public.tool_semver_is_valid(p_version text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT p_version IS NULL OR p_version ~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$';
$$;

CREATE OR REPLACE FUNCTION public.tool_semver_compare(p_left text,p_right text)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
  l bigint[];
  r bigint[];
  i integer;
BEGIN
  IF NOT public.tool_semver_is_valid(p_left) OR NOT public.tool_semver_is_valid(p_right)
     OR p_left IS NULL OR p_right IS NULL THEN
    RAISE EXCEPTION 'tool_semver_invalid';
  END IF;
  l:=string_to_array(p_left,'.')::bigint[];
  r:=string_to_array(p_right,'.')::bigint[];
  FOR i IN 1..3 LOOP
    IF l[i]<r[i] THEN RETURN -1; END IF;
    IF l[i]>r[i] THEN RETURN 1; END IF;
  END LOOP;
  RETURN 0;
END;
$$;

CREATE TABLE IF NOT EXISTS public.platform_tools (
  tool_id text PRIMARY KEY,
  display_name text NOT NULL,
  description text,
  category text NOT NULL CHECK(category IN ('acquisition','executor','desktop_executor')),
  catalog_status text NOT NULL CHECK(catalog_status IN ('active','disabled','deprecated')),
  latest_version text,
  minimum_supported_version text,
  settings_schema_version integer NOT NULL CHECK(settings_schema_version>0),
  settings_schema jsonb NOT NULL CHECK(jsonb_typeof(settings_schema)='object'),
  default_settings jsonb NOT NULL CHECK(jsonb_typeof(default_settings)='object'),
  default_entitlements jsonb NOT NULL CHECK(jsonb_typeof(default_entitlements)='object'),
  capability_catalog text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_tools_latest_semver CHECK(public.tool_semver_is_valid(latest_version)),
  CONSTRAINT platform_tools_minimum_semver CHECK(public.tool_semver_is_valid(minimum_supported_version)),
  CONSTRAINT platform_tools_version_order CHECK(
    latest_version IS NULL OR minimum_supported_version IS NULL
    OR public.tool_semver_compare(latest_version,minimum_supported_version)>=0
  )
);

CREATE TABLE IF NOT EXISTS public.organization_tools (
  organization_tools_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizations_id bigint NOT NULL REFERENCES public.organizations(organizations_id) ON DELETE RESTRICT,
  tool_id text NOT NULL REFERENCES public.platform_tools(tool_id) ON DELETE RESTRICT,
  enabled boolean NOT NULL DEFAULT true,
  registered_at timestamptz NOT NULL DEFAULT now(),
  registered_by_member_id bigint REFERENCES public.organization_members(organization_members_id) ON DELETE SET NULL,
  disabled_at timestamptz,
  disabled_by_member_id bigint REFERENCES public.organization_members(organization_members_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organizations_id,tool_id)
);

CREATE TABLE IF NOT EXISTS public.organization_tool_installations (
  organization_tool_installations_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizations_id bigint NOT NULL,
  tool_id text NOT NULL,
  external_installation_id text NOT NULL CHECK(length(trim(external_installation_id)) BETWEEN 1 AND 200),
  registration_status text NOT NULL CHECK(registration_status IN ('registered','disabled','revoked')),
  installed_version text,
  reported_capabilities text[] NOT NULL DEFAULT '{}',
  registered_by_member_id bigint REFERENCES public.organization_members(organization_members_id) ON DELETE SET NULL,
  last_seen_member_id bigint REFERENCES public.organization_members(organization_members_id) ON DELETE SET NULL,
  last_seen_at timestamptz,
  last_activity_at timestamptz,
  registered_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz,
  revoked_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(metadata)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organizations_id,tool_id,external_installation_id),
  FOREIGN KEY(organizations_id,tool_id) REFERENCES public.organization_tools(organizations_id,tool_id) ON DELETE RESTRICT,
  CONSTRAINT organization_tool_installations_semver CHECK(public.tool_semver_is_valid(installed_version))
);

CREATE TABLE IF NOT EXISTS public.organization_tool_settings (
  organization_tool_settings_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizations_id bigint NOT NULL REFERENCES public.organizations(organizations_id) ON DELETE RESTRICT,
  tool_id text NOT NULL REFERENCES public.platform_tools(tool_id) ON DELETE RESTRICT,
  settings jsonb NOT NULL CHECK(jsonb_typeof(settings)='object'),
  settings_schema_version integer NOT NULL CHECK(settings_schema_version>0),
  settings_version bigint NOT NULL DEFAULT 1 CHECK(settings_version>0),
  updated_by_member_id bigint REFERENCES public.organization_members(organization_members_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organizations_id,tool_id)
);

CREATE TABLE IF NOT EXISTS public.organization_tool_entitlements (
  organization_tool_entitlements_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizations_id bigint NOT NULL REFERENCES public.organizations(organizations_id) ON DELETE RESTRICT,
  tool_id text NOT NULL REFERENCES public.platform_tools(tool_id) ON DELETE RESTRICT,
  entitlements jsonb NOT NULL CHECK(jsonb_typeof(entitlements)='object'),
  entitlements_version bigint NOT NULL DEFAULT 1 CHECK(entitlements_version>0),
  updated_by_platform_owner_users_id bigint REFERENCES public.users(users_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organizations_id,tool_id)
);

CREATE INDEX IF NOT EXISTS organization_tools_organization_idx ON public.organization_tools(organizations_id);
CREATE INDEX IF NOT EXISTS organization_tool_installations_organization_idx ON public.organization_tool_installations(organizations_id,tool_id);
CREATE INDEX IF NOT EXISTS organization_tool_installations_seen_idx ON public.organization_tool_installations(last_seen_at DESC);
CREATE INDEX IF NOT EXISTS organization_tool_settings_organization_idx ON public.organization_tool_settings(organizations_id,tool_id);
CREATE INDEX IF NOT EXISTS organization_tool_entitlements_organization_idx ON public.organization_tool_entitlements(organizations_id,tool_id);

CREATE OR REPLACE FUNCTION public.tool_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at:=now(); RETURN NEW; END;
$$;

DO $triggers$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['platform_tools','organization_tools','organization_tool_installations','organization_tool_settings','organization_tool_entitlements'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS tool_touch_updated_at ON public.%I',t);
    EXECUTE format('CREATE TRIGGER tool_touch_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.tool_touch_updated_at()',t);
  END LOOP;
END
$triggers$;

CREATE OR REPLACE FUNCTION public.tool_json_contains_secret(p_value jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE item record;
BEGIN
  IF p_value IS NULL THEN RETURN false; END IF;
  IF jsonb_typeof(p_value)='object' THEN
    FOR item IN SELECT key,value FROM jsonb_each(p_value) LOOP
      IF lower(item.key) ~ '(password|passwd|secret|service.?role|api.?key|access.?token|refresh.?token|signing.?key|private.?key|credential)' THEN
        RETURN true;
      END IF;
      IF public.tool_json_contains_secret(item.value) THEN RETURN true; END IF;
    END LOOP;
  ELSIF jsonb_typeof(p_value)='array' THEN
    FOR item IN SELECT value FROM jsonb_array_elements(p_value) LOOP
      IF public.tool_json_contains_secret(item.value) THEN RETURN true; END IF;
    END LOOP;
  END IF;
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_tool_settings(p_tool_id text,p_settings jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE v_dispatch jsonb;
BEGIN
  IF jsonb_typeof(p_settings)<>'object' OR public.tool_json_contains_secret(p_settings) THEN RETURN false; END IF;
  IF p_tool_id='vinsansi_capture' THEN
    RETURN jsonb_typeof(p_settings->'safeMode')='object'
       AND jsonb_typeof(p_settings->'instagramLowRating')='object'
       AND jsonb_typeof(p_settings->'branchRules')='array'
       AND jsonb_typeof(p_settings->'deduplication')='object'
       AND jsonb_typeof(p_settings->'routes')='object'
       AND jsonb_typeof(p_settings->'logs')='object'
       AND jsonb_typeof(p_settings->'minRating')='number'
       AND jsonb_typeof(p_settings->'minReviews')='number'
       AND jsonb_typeof(p_settings->'safeMode'->'simulationMode')='boolean'
       AND jsonb_typeof(p_settings->'instagramLowRating'->'enabled')='boolean'
       AND jsonb_typeof(p_settings->'instagramLowRating'->'minRating')='number'
       AND jsonb_typeof(p_settings->'instagramLowRating'->'maxRatingExclusive')='number'
       AND jsonb_typeof(p_settings->'instagramLowRating'->'minReviews')='number'
       AND jsonb_typeof(p_settings->'deduplication'->'enabled')='boolean'
       AND jsonb_typeof(p_settings->'routes'->'whatsapp')='boolean'
       AND jsonb_typeof(p_settings->'logs'->'enabled')='boolean';
  ELSIF p_tool_id='vinsansi_instagram' THEN
    v_dispatch:=p_settings->'instagram';
    RETURN jsonb_typeof(v_dispatch)='object'
       AND jsonb_typeof(v_dispatch->'activeDays')='array'
       AND jsonb_typeof(v_dispatch->'profiles')='array'
       AND jsonb_typeof(v_dispatch->'profile')='string'
       AND jsonb_typeof(v_dispatch->'startTime')='string'
       AND jsonb_typeof(v_dispatch->'endTime')='string'
       AND jsonb_typeof(v_dispatch->'delayMinSeconds')='number'
       AND jsonb_typeof(v_dispatch->'delayMaxSeconds')='number'
       AND jsonb_typeof(v_dispatch->'perBatch')='number'
       AND jsonb_typeof(v_dispatch->'batches')='number'
       AND jsonb_typeof(v_dispatch->'batchDelayMinutes')='number'
       AND jsonb_typeof(v_dispatch->'delayMinutes')='number'
       AND jsonb_typeof(v_dispatch->'dailyLimit')='number'
       AND jsonb_typeof(v_dispatch->'batchBehavior')='string';
  ELSIF p_tool_id='vinsansi_whatsapp_manager' THEN
    v_dispatch:=p_settings->'whatsapp';
    RETURN jsonb_typeof(v_dispatch)='object'
       AND jsonb_typeof(v_dispatch->'activeDays')='array'
       AND jsonb_typeof(v_dispatch->'startTime')='string'
       AND jsonb_typeof(v_dispatch->'endTime')='string'
       AND jsonb_typeof(v_dispatch->'delayMinSeconds')='number'
       AND jsonb_typeof(v_dispatch->'delayMaxSeconds')='number'
       AND jsonb_typeof(v_dispatch->'perBatch')='number'
       AND jsonb_typeof(v_dispatch->'batches')='number'
       AND jsonb_typeof(v_dispatch->'batchDelayMinutes')='number'
       AND jsonb_typeof(v_dispatch->'dailyLimit')='number'
       AND jsonb_typeof(v_dispatch->'batchBehavior')='string'
       AND jsonb_typeof(p_settings->'chipLevels')='object'
       AND jsonb_typeof(p_settings->'operationalTimezone')='string'
       AND jsonb_typeof(p_settings->'operationalCutoffHour')='number'
       AND (p_settings->>'operationalCutoffHour')::integer BETWEEN 0 AND 23;
  END IF;
  RETURN false;
EXCEPTION WHEN others THEN
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_tool_installation_capabilities()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE v_catalog text[];
BEGIN
  SELECT capability_catalog INTO v_catalog FROM public.platform_tools WHERE tool_id=NEW.tool_id;
  IF EXISTS(SELECT 1 FROM unnest(NEW.reported_capabilities) c WHERE NOT c=ANY(coalesce(v_catalog,'{}'::text[]))) THEN
    RAISE EXCEPTION 'tool_capability_invalid';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS validate_tool_installation_capabilities ON public.organization_tool_installations;
CREATE TRIGGER validate_tool_installation_capabilities BEFORE INSERT OR UPDATE OF tool_id,reported_capabilities
ON public.organization_tool_installations FOR EACH ROW EXECUTE FUNCTION public.validate_tool_installation_capabilities();

-- Catalogo canonico. Os schemas sao contratos de validacao/publicacao, enquanto
-- os componentes do CRM oferecem a experiencia especifica de cada ferramenta.
INSERT INTO public.platform_tools(
  tool_id,display_name,description,category,catalog_status,latest_version,minimum_supported_version,
  settings_schema_version,settings_schema,default_settings,default_entitlements,capability_catalog
) VALUES
(
  'vinsansi_capture','Vinsansi Captura','Aquisicao e pre-qualificacao; nesta etapa preserva o contrato atual do Google Maps Extractor.','acquisition','active','0.17.1','0.17.1',1,
  '{"type":"object","required":["minRating","minReviews","safeMode","instagramLowRating","branchRules","deduplication","routes","logs"]}'::jsonb,
  '{"minRating":4,"minReviews":10,"safeMode":{"simulationMode":true},"instagramLowRating":{"enabled":true,"minRating":3.7,"maxRatingExclusive":4,"minReviews":5},"branchRules":[],"deduplication":{"enabled":true,"byPhone":true,"bySite":true,"blockBasePermanent":true,"allowSmartReimport":false,"incrementalImport":true},"routes":{"whatsapp":true,"instagram":true,"ownSite":true,"aggregators":true,"blockFacebookAsSite":true,"requireConfiguredCategory":true,"rejectOutOfProfile":true},"logs":{"enabled":true,"logRejected":true,"logRejectionReason":true}}'::jsonb,
  '{"maxConcurrentActivitiesPerMember":5}'::jsonb,
  ARRAY['settings.read','presence.heartbeat','activity.report','organization.context','member.context','capture.maps','capture.website_review','capture.multi_activity','capture.batch_ingestion']
),
(
  'vinsansi_instagram','Vinsansi Instagram','Executor da fila canonica do canal Instagram.','executor','active','1.6.1','1.6.1',1,
  '{"type":"object","required":["instagram"]}'::jsonb,
  '{"instagram":{"profile":"Todos","profiles":["Todos"],"startTime":"13:00","endTime":"18:00","delayMinSeconds":120,"delayMaxSeconds":120,"perBatch":15,"batches":4,"batchDelayMinutes":120,"delayMinutes":120,"dailyLimit":60,"activeDays":["Segunda","Terca","Quarta","Quinta","Sexta"],"batchBehavior":"Respeitar lotes e janela"}}'::jsonb,
  '{}'::jsonb,
  ARRAY['settings.read','presence.heartbeat','activity.report','organization.context','member.context','instagram.queue.execute','instagram.dm.send','instagram.media.send','instagram.result.report']
),
(
  'vinsansi_whatsapp_manager','Gerenciador de Disparos','Aplicacao desktop WhatsApp com Worker oficial embarcado.','desktop_executor','active','1.0.2','1.0.2',1,
  '{"type":"object","required":["whatsapp","chipLevels","operationalTimezone","operationalCutoffHour"]}'::jsonb,
  '{"whatsapp":{"startTime":"13:00","endTime":"18:00","delayMinSeconds":120,"delayMaxSeconds":120,"perBatch":60,"batches":2,"batchDelayMinutes":60,"dailyLimit":120,"activeDays":["Segunda","Terca","Quarta","Quinta","Sexta"],"batchBehavior":"Respeitar lotes e janela"},"chipLevels":{},"operationalTimezone":"America/Sao_Paulo","operationalCutoffHour":22}'::jsonb,
  '{}'::jsonb,
  ARRAY['settings.read','presence.heartbeat','activity.report','organization.context','member.context','whatsapp.instances.manage','whatsapp.queue.execute','whatsapp.conversations','whatsapp.messages.manual']
)
ON CONFLICT(tool_id) DO UPDATE SET
  display_name=excluded.display_name,description=excluded.description,category=excluded.category,catalog_status=excluded.catalog_status,
  latest_version=excluded.latest_version,minimum_supported_version=excluded.minimum_supported_version,
  settings_schema_version=excluded.settings_schema_version,settings_schema=excluded.settings_schema,
  default_settings=excluded.default_settings,default_entitlements=excluded.default_entitlements,
  capability_catalog=excluded.capability_catalog,updated_at=now();

-- As tres ferramentas eram aplicaveis a organizacao real antes desta migration.
-- Registros futuros permanecem opt-in: ausencia de linha significa not_registered.
INSERT INTO public.organization_tools(organizations_id,tool_id,enabled)
SELECT o.organizations_id,t.tool_id,true
FROM public.organizations o
CROSS JOIN public.platform_tools t
WHERE o.status_id=1 AND t.tool_id IN ('vinsansi_capture','vinsansi_instagram','vinsansi_whatsapp_manager')
ON CONFLICT(organizations_id,tool_id) DO NOTHING;

-- Migra o modelo antigo por usuario antes de remove-lo. to_jsonb torna o
-- backfill tolerante as colunas opcionais de releases antigas.
DO $settings_backfill$
DECLARE
  r record;
  j jsonb;
  v_org bigint;
  v_dispatch jsonb;
  v_import jsonb;
  v_whatsapp jsonb;
  v_instagram jsonb;
  v_default jsonb;
BEGIN
  IF to_regclass('public.user_operational_settings') IS NOT NULL THEN
    FOR r IN EXECUTE 'SELECT to_jsonb(s) AS data FROM public.user_operational_settings s' LOOP
      j:=r.data;
      v_org:=NULLIF(j->>'organizations_id','')::bigint;
      IF v_org IS NULL THEN
        SELECT organizations_id INTO v_org FROM public.organizations
        WHERE legacy_scope_users_id=NULLIF(j->>'users_id','')::bigint LIMIT 1;
      END IF;
      IF v_org IS NULL THEN RAISE EXCEPTION 'tool_settings_organization_backfill_failed'; END IF;
      v_dispatch:=coalesce(j->'dispatch_settings','{}'::jsonb);
      v_import:=j->'import_settings';

      SELECT default_settings INTO v_default FROM public.platform_tools WHERE tool_id='vinsansi_whatsapp_manager';
      v_whatsapp:=v_default || jsonb_build_object(
        'whatsapp',coalesce(v_dispatch->'whatsapp',v_default->'whatsapp'),
        'chipLevels',coalesce(v_dispatch->'chipLevels',v_default->'chipLevels'),
        'operationalTimezone',coalesce(nullif(j->>'operational_timezone',''),'America/Sao_Paulo'),
        'operationalCutoffHour',coalesce(NULLIF(j->>'operational_cutoff_hour','')::integer,22)
      );
      INSERT INTO public.organization_tool_settings(organizations_id,tool_id,settings,settings_schema_version,settings_version,created_at,updated_at)
      VALUES(v_org,'vinsansi_whatsapp_manager',v_whatsapp,1,greatest(coalesce(NULLIF(j->>'settings_version','')::bigint,1),1),
             coalesce(NULLIF(j->>'created_at','')::timestamptz,now()),coalesce(NULLIF(j->>'updated_at','')::timestamptz,now()))
      ON CONFLICT(organizations_id,tool_id) DO UPDATE SET settings=excluded.settings,settings_version=excluded.settings_version,updated_at=excluded.updated_at;

      SELECT default_settings INTO v_default FROM public.platform_tools WHERE tool_id='vinsansi_instagram';
      v_instagram:=jsonb_build_object('instagram',coalesce(v_dispatch->'instagram',v_default->'instagram'));
      INSERT INTO public.organization_tool_settings(organizations_id,tool_id,settings,settings_schema_version,settings_version,created_at,updated_at)
      VALUES(v_org,'vinsansi_instagram',v_instagram,1,greatest(coalesce(NULLIF(j->>'settings_version','')::bigint,1),1),
             coalesce(NULLIF(j->>'created_at','')::timestamptz,now()),coalesce(NULLIF(j->>'updated_at','')::timestamptz,now()))
      ON CONFLICT(organizations_id,tool_id) DO UPDATE SET settings=excluded.settings,settings_version=excluded.settings_version,updated_at=excluded.updated_at;

      SELECT default_settings INTO v_default FROM public.platform_tools WHERE tool_id='vinsansi_capture';
      INSERT INTO public.organization_tool_settings(organizations_id,tool_id,settings,settings_schema_version,settings_version,created_at,updated_at)
      VALUES(v_org,'vinsansi_capture',coalesce(v_import,v_default),1,greatest(coalesce(NULLIF(j->>'settings_version','')::bigint,1),1),
             coalesce(NULLIF(j->>'created_at','')::timestamptz,now()),coalesce(NULLIF(j->>'updated_at','')::timestamptz,now()))
      ON CONFLICT(organizations_id,tool_id) DO UPDATE SET settings=excluded.settings,settings_version=excluded.settings_version,updated_at=excluded.updated_at;
    END LOOP;
  END IF;
END
$settings_backfill$;

INSERT INTO public.organization_tool_settings(organizations_id,tool_id,settings,settings_schema_version)
SELECT ot.organizations_id,ot.tool_id,pt.default_settings,pt.settings_schema_version
FROM public.organization_tools ot JOIN public.platform_tools pt USING(tool_id)
ON CONFLICT(organizations_id,tool_id) DO NOTHING;

-- Maps continua operacional na estrutura antiga, mas toda instalacao ganha um
-- vinculo explicito e um registro canonico de vinsansi_capture.
DO $maps_link_column$
BEGIN
  IF to_regclass('public.maps_extension_installations') IS NOT NULL THEN
    ALTER TABLE public.maps_extension_installations ADD COLUMN IF NOT EXISTS organization_tool_installations_id uuid;
    IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.maps_extension_installations'::regclass AND conname='maps_extension_installations_canonical_fkey') THEN
      ALTER TABLE public.maps_extension_installations ADD CONSTRAINT maps_extension_installations_canonical_fkey
      FOREIGN KEY(organization_tool_installations_id) REFERENCES public.organization_tool_installations(organization_tool_installations_id) ON DELETE RESTRICT;
    END IF;
  END IF;
  IF to_regclass('public.maps_extension_pairings') IS NOT NULL
     AND EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='maps_extension_pairings' AND column_name='organizations_id') THEN
    ALTER TABLE public.maps_extension_pairings ALTER COLUMN organizations_id DROP NOT NULL;
    ALTER TABLE public.maps_extension_pairings ADD COLUMN IF NOT EXISTS authorized_by_member_id bigint REFERENCES public.organization_members(organization_members_id) ON DELETE SET NULL;
  END IF;
END
$maps_link_column$;

DO $maps_backfill$
DECLARE r record; j jsonb; v_id uuid; v_org bigint;
BEGIN
  IF to_regclass('public.maps_extension_installations') IS NULL THEN RETURN; END IF;
  FOR r IN EXECUTE 'SELECT to_jsonb(m) data FROM public.maps_extension_installations m' LOOP
    j:=r.data;
    v_org:=NULLIF(j->>'organizations_id','')::bigint;
    IF v_org IS NULL THEN
      SELECT organizations_id INTO v_org FROM public.organizations WHERE legacy_scope_users_id=NULLIF(j->>'users_id','')::bigint LIMIT 1;
    END IF;
    IF v_org IS NULL OR nullif(j->>'installation_id','') IS NULL THEN CONTINUE; END IF;
    INSERT INTO public.organization_tools(organizations_id,tool_id,enabled)
    VALUES(v_org,'vinsansi_capture',true) ON CONFLICT(organizations_id,tool_id) DO NOTHING;
    INSERT INTO public.organization_tool_installations(
      organizations_id,tool_id,external_installation_id,registration_status,reported_capabilities,last_seen_at,registered_at,metadata
    ) VALUES(
      v_org,'vinsansi_capture',j->>'installation_id',
      CASE WHEN lower(coalesce(j->>'status','active'))='revoked' THEN 'revoked' ELSE 'registered' END,
      ARRAY['capture.maps'],NULLIF(j->>'last_seen_at','')::timestamptz,
      coalesce(NULLIF(j->>'created_at','')::timestamptz,now()),
      jsonb_build_object('legacyMapsInstallationId',j->>'maps_extension_installations_id','legacyBridge','maps_extension_installations','removeInStage',8)
    ) ON CONFLICT(organizations_id,tool_id,external_installation_id) DO UPDATE SET
      registration_status=CASE WHEN organization_tool_installations.registration_status IN ('disabled','revoked') THEN organization_tool_installations.registration_status ELSE excluded.registration_status END,
      last_seen_at=coalesce(excluded.last_seen_at,organization_tool_installations.last_seen_at),
      metadata=organization_tool_installations.metadata || excluded.metadata
    RETURNING organization_tool_installations_id INTO v_id;
    EXECUTE 'UPDATE public.maps_extension_installations SET organization_tool_installations_id=$1 WHERE maps_extension_installations_id=$2'
      USING v_id,(j->>'maps_extension_installations_id')::uuid;
  END LOOP;
END
$maps_backfill$;

-- A tabela antiga deixa de ser fonte. DROP CASCADE remove somente as funcoes
-- antigas que a referenciavam; os contratos comprovadamente usados sao recriados abaixo.
DROP TABLE IF EXISTS public.user_operational_settings CASCADE;
DROP FUNCTION IF EXISTS public.save_extension_runtime_config(jsonb);
DROP FUNCTION IF EXISTS public.save_extension_runtime_config_rbac_inner(jsonb);

CREATE OR REPLACE FUNCTION public.tool_presence_status(p_capabilities text[],p_last_seen_at timestamptz,p_now timestamptz DEFAULT now())
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN NOT ('presence.heartbeat'=ANY(coalesce(p_capabilities,'{}'::text[]))) THEN 'not_supported'
    WHEN p_last_seen_at IS NULL THEN 'never_seen'
    WHEN p_last_seen_at>=p_now-interval '180 seconds' THEN 'online'
    ELSE 'offline'
  END;
$$;

CREATE OR REPLACE FUNCTION public.tool_compatibility_status(p_installed text,p_minimum text,p_latest text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p_installed IS NULL OR NOT public.tool_semver_is_valid(p_installed) THEN RETURN 'unknown'; END IF;
  IF p_minimum IS NOT NULL AND public.tool_semver_compare(p_installed,p_minimum)<0 THEN RETURN 'incompatible'; END IF;
  IF p_latest IS NOT NULL AND public.tool_semver_compare(p_installed,p_latest)<0 THEN RETURN 'update_available'; END IF;
  RETURN 'compatible';
END;
$$;

CREATE OR REPLACE FUNCTION public.tool_settings_permission(p_tool_id text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_tool_id WHEN 'vinsansi_capture' THEN 'capture.settings' WHEN 'vinsansi_instagram' THEN 'instagram.settings' WHEN 'vinsansi_whatsapp_manager' THEN 'whatsapp.settings' END;
$$;

CREATE OR REPLACE FUNCTION public.tool_runtime_permission(p_tool_id text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_tool_id WHEN 'vinsansi_capture' THEN 'capture.use' WHEN 'vinsansi_instagram' THEN 'instagram.use' WHEN 'vinsansi_whatsapp_manager' THEN 'whatsapp.view' END;
$$;

CREATE OR REPLACE FUNCTION public.list_organization_tools()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO pg_catalog,public
AS $$
DECLARE v_org bigint:=public.current_organization_id(); result jsonb;
BEGIN
  PERFORM public.require_organization_permission('tools.view');
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'toolId',pt.tool_id,'displayName',pt.display_name,'description',pt.description,'category',pt.category,'catalogStatus',pt.catalog_status,
    'latestVersion',pt.latest_version,'minimumSupportedVersion',pt.minimum_supported_version,
    'administrativeStatus',CASE WHEN ot.organization_tools_id IS NULL THEN 'not_registered' WHEN NOT ot.enabled THEN 'disabled' ELSE 'registered' END,
    'enabled',coalesce(ot.enabled,false),'installationCount',coalesce(i.installation_count,0),
    'presence',coalesce(i.presence,'not_supported'),'compatibility',coalesce(i.compatibility,'unknown'),
    'installedVersion',i.installed_version,'lastSeenAt',i.last_seen_at,'lastActivityAt',i.last_activity_at,
    'entitlements',coalesce(e.entitlements,pt.default_entitlements)
  ) ORDER BY CASE pt.tool_id WHEN 'vinsansi_capture' THEN 1 WHEN 'vinsansi_instagram' THEN 2 ELSE 3 END),'[]'::jsonb) INTO result
  FROM public.platform_tools pt
  LEFT JOIN public.organization_tools ot ON ot.organizations_id=v_org AND ot.tool_id=pt.tool_id
  LEFT JOIN public.organization_tool_entitlements e ON e.organizations_id=v_org AND e.tool_id=pt.tool_id
  LEFT JOIN LATERAL(
    SELECT count(*)::integer installation_count,(array_agg(x.installed_version ORDER BY x.registered_at DESC) FILTER(WHERE x.installed_version IS NOT NULL))[1] installed_version,max(x.last_seen_at) last_seen_at,max(x.last_activity_at) last_activity_at,
      CASE WHEN bool_or(public.tool_presence_status(x.reported_capabilities,x.last_seen_at)='online') THEN 'online'
           WHEN bool_or(public.tool_presence_status(x.reported_capabilities,x.last_seen_at)='offline') THEN 'offline'
           WHEN bool_or(public.tool_presence_status(x.reported_capabilities,x.last_seen_at)='never_seen') THEN 'never_seen' ELSE 'not_supported' END presence,
      CASE WHEN bool_or(public.tool_compatibility_status(x.installed_version,pt.minimum_supported_version,pt.latest_version)='incompatible') THEN 'incompatible'
           WHEN bool_or(public.tool_compatibility_status(x.installed_version,pt.minimum_supported_version,pt.latest_version)='update_available') THEN 'update_available'
           WHEN bool_or(public.tool_compatibility_status(x.installed_version,pt.minimum_supported_version,pt.latest_version)='compatible') THEN 'compatible' ELSE 'unknown' END compatibility
    FROM public.organization_tool_installations x WHERE x.organizations_id=v_org AND x.tool_id=pt.tool_id
  ) i ON true
  WHERE pt.tool_id IN ('vinsansi_capture','vinsansi_instagram','vinsansi_whatsapp_manager');
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_organization_tool_details(p_tool_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO pg_catalog,public AS $$
DECLARE v_org bigint:=public.current_organization_id(); result jsonb;
BEGIN
  PERFORM public.require_organization_permission('tools.view');
  IF NOT EXISTS(SELECT 1 FROM public.platform_tools WHERE tool_id=p_tool_id) THEN RAISE EXCEPTION 'tool_not_found'; END IF;
  SELECT jsonb_build_object(
    'toolId',pt.tool_id,'displayName',pt.display_name,'description',pt.description,'category',pt.category,
    'latestVersion',pt.latest_version,'minimumSupportedVersion',pt.minimum_supported_version,
    'administrativeStatus',CASE WHEN ot.organization_tools_id IS NULL THEN 'not_registered' WHEN NOT ot.enabled THEN 'disabled' ELSE 'registered' END,
    'enabled',coalesce(ot.enabled,false),'entitlements',coalesce(e.entitlements,pt.default_entitlements),
    'installations',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id',i.organization_tool_installations_id,'externalInstallationId',i.external_installation_id,'registrationStatus',i.registration_status,
      'installedVersion',i.installed_version,'reportedCapabilities',i.reported_capabilities,
      'presence',public.tool_presence_status(i.reported_capabilities,i.last_seen_at),
      'compatibility',public.tool_compatibility_status(i.installed_version,pt.minimum_supported_version,pt.latest_version),
      'registeredByMemberId',i.registered_by_member_id,'lastSeenAt',i.last_seen_at,'lastActivityAt',i.last_activity_at,'registeredAt',i.registered_at,
      'metadata',i.metadata
    ) ORDER BY i.registered_at DESC) FROM public.organization_tool_installations i WHERE i.organizations_id=v_org AND i.tool_id=pt.tool_id),'[]'::jsonb)
  ) INTO result
  FROM public.platform_tools pt
  LEFT JOIN public.organization_tools ot ON ot.organizations_id=v_org AND ot.tool_id=pt.tool_id
  LEFT JOIN public.organization_tool_entitlements e ON e.organizations_id=v_org AND e.tool_id=pt.tool_id
  WHERE pt.tool_id=p_tool_id;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_organization_tool_settings(p_tool_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO pg_catalog,public AS $$
DECLARE v_org bigint:=public.current_organization_id(); result jsonb;
BEGIN
  PERFORM public.require_organization_permission('tools.view');
  PERFORM public.require_organization_permission('settings.view');
  SELECT jsonb_build_object('toolId',pt.tool_id,'settings',coalesce(s.settings,pt.default_settings),'settingsVersion',coalesce(s.settings_version,0),
    'settingsSchemaVersion',pt.settings_schema_version,'settingsSchema',pt.settings_schema,'defaultSettings',pt.default_settings,'updatedAt',s.updated_at)
    INTO result FROM public.platform_tools pt LEFT JOIN public.organization_tool_settings s ON s.organizations_id=v_org AND s.tool_id=pt.tool_id WHERE pt.tool_id=p_tool_id;
  IF result IS NULL THEN RAISE EXCEPTION 'tool_not_found'; END IF;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_organization_tool_settings(p_tool_id text,p_settings jsonb,p_expected_settings_version bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_org bigint:=public.current_organization_id(); v_member bigint:=public.current_organization_member_id(); current_row public.organization_tool_settings%ROWTYPE; v_schema integer; result jsonb;
BEGIN
  PERFORM public.require_organization_permission(public.tool_settings_permission(p_tool_id));
  IF NOT public.validate_tool_settings(p_tool_id,p_settings) THEN RAISE EXCEPTION 'tool_settings_invalid'; END IF;
  SELECT settings_schema_version INTO v_schema FROM public.platform_tools WHERE tool_id=p_tool_id AND catalog_status<>'disabled';
  IF v_schema IS NULL THEN RAISE EXCEPTION 'tool_not_found_or_disabled'; END IF;
  SELECT * INTO current_row FROM public.organization_tool_settings WHERE organizations_id=v_org AND tool_id=p_tool_id FOR UPDATE;
  IF current_row.organization_tool_settings_id IS NULL THEN RAISE EXCEPTION 'tool_settings_not_initialized'; END IF;
  IF current_row.settings_version<>p_expected_settings_version THEN RAISE EXCEPTION 'tool_settings_version_conflict'; END IF;
  UPDATE public.organization_tool_settings SET settings=p_settings,settings_schema_version=v_schema,settings_version=settings_version+1,updated_by_member_id=v_member
  WHERE organization_tool_settings_id=current_row.organization_tool_settings_id
  RETURNING jsonb_build_object('toolId',tool_id,'settings',settings,'settingsVersion',settings_version,'settingsSchemaVersion',settings_schema_version,'updatedAt',updated_at) INTO result;
  PERFORM public.append_audit_event('tools','tool.settings.updated','organization_tool_settings',current_row.organization_tool_settings_id::text,NULL,NULL,NULL,NULL,NULL,
    'Configuracoes da ferramenta atualizadas',jsonb_build_object('tool_id',p_tool_id,'before',current_row.settings,'after',p_settings,'settings_version',current_row.settings_version+1,'schema_version',v_schema),NULL);
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.reset_organization_tool_settings(p_tool_id text,p_expected_settings_version bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_org bigint:=public.current_organization_id(); v_member bigint:=public.current_organization_member_id(); current_row public.organization_tool_settings%ROWTYPE; v_default jsonb; v_schema integer; result jsonb;
BEGIN
  PERFORM public.require_organization_permission(public.tool_settings_permission(p_tool_id));
  SELECT default_settings,settings_schema_version INTO v_default,v_schema FROM public.platform_tools WHERE tool_id=p_tool_id;
  IF v_default IS NULL THEN RAISE EXCEPTION 'tool_not_found'; END IF;
  SELECT * INTO current_row FROM public.organization_tool_settings WHERE organizations_id=v_org AND tool_id=p_tool_id FOR UPDATE;
  IF current_row.organization_tool_settings_id IS NULL THEN RAISE EXCEPTION 'tool_settings_not_initialized'; END IF;
  IF current_row.settings_version<>p_expected_settings_version THEN RAISE EXCEPTION 'tool_settings_version_conflict'; END IF;
  UPDATE public.organization_tool_settings SET settings=v_default,settings_schema_version=v_schema,settings_version=settings_version+1,updated_by_member_id=v_member
  WHERE organization_tool_settings_id=current_row.organization_tool_settings_id
  RETURNING jsonb_build_object('toolId',tool_id,'settings',settings,'settingsVersion',settings_version,'settingsSchemaVersion',settings_schema_version,'updatedAt',updated_at) INTO result;
  PERFORM public.append_audit_event('tools','tool.settings.reset','organization_tool_settings',current_row.organization_tool_settings_id::text,NULL,NULL,NULL,NULL,NULL,
    'Configuracoes da ferramenta restauradas',jsonb_build_object('tool_id',p_tool_id,'before',current_row.settings,'after',v_default,'settings_version',current_row.settings_version+1,'schema_version',v_schema),NULL);
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_organization_tool_enabled(p_tool_id text,p_enabled boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_org bigint:=public.current_organization_id(); v_member bigint:=public.current_organization_member_id(); before_row public.organization_tools%ROWTYPE; after_row public.organization_tools%ROWTYPE;
BEGIN
  PERFORM public.require_organization_permission('tools.manage');
  IF NOT EXISTS(SELECT 1 FROM public.platform_tools WHERE tool_id=p_tool_id) THEN RAISE EXCEPTION 'tool_not_found'; END IF;
  SELECT * INTO before_row FROM public.organization_tools WHERE organizations_id=v_org AND tool_id=p_tool_id FOR UPDATE;
  INSERT INTO public.organization_tools(organizations_id,tool_id,enabled,registered_by_member_id,disabled_at,disabled_by_member_id)
  VALUES(v_org,p_tool_id,p_enabled,v_member,CASE WHEN p_enabled THEN NULL ELSE now() END,CASE WHEN p_enabled THEN NULL ELSE v_member END)
  ON CONFLICT(organizations_id,tool_id) DO UPDATE SET enabled=excluded.enabled,disabled_at=excluded.disabled_at,disabled_by_member_id=excluded.disabled_by_member_id
  RETURNING * INTO after_row;
  INSERT INTO public.organization_tool_settings(organizations_id,tool_id,settings,settings_schema_version)
  SELECT v_org,pt.tool_id,pt.default_settings,pt.settings_schema_version FROM public.platform_tools pt WHERE pt.tool_id=p_tool_id
  ON CONFLICT(organizations_id,tool_id) DO NOTHING;
  PERFORM public.append_audit_event('tools',CASE WHEN p_enabled THEN 'tool.organization.enabled' ELSE 'tool.organization.disabled' END,'organization_tools',after_row.organization_tools_id::text,NULL,NULL,NULL,NULL,NULL,
    CASE WHEN p_enabled THEN 'Ferramenta habilitada' ELSE 'Ferramenta desabilitada' END,jsonb_build_object('tool_id',p_tool_id,'before',CASE WHEN before_row.organization_tools_id IS NULL THEN NULL ELSE to_jsonb(before_row) END,'after',to_jsonb(after_row)),NULL);
  RETURN jsonb_build_object('toolId',p_tool_id,'enabled',after_row.enabled,'administrativeStatus',CASE WHEN after_row.enabled THEN 'registered' ELSE 'disabled' END);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_tool_installation_status(p_installation_id uuid,p_status text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_org bigint:=public.current_organization_id(); before_row public.organization_tool_installations%ROWTYPE; after_row public.organization_tool_installations%ROWTYPE;
BEGIN
  PERFORM public.require_organization_permission('tools.manage');
  IF p_status NOT IN ('disabled','revoked') THEN RAISE EXCEPTION 'tool_installation_status_invalid'; END IF;
  SELECT * INTO before_row FROM public.organization_tool_installations WHERE organization_tool_installations_id=p_installation_id AND organizations_id=v_org FOR UPDATE;
  IF before_row.organization_tool_installations_id IS NULL THEN RAISE EXCEPTION 'tool_installation_not_found'; END IF;
  UPDATE public.organization_tool_installations SET registration_status=p_status,disabled_at=CASE WHEN p_status='disabled' THEN now() ELSE disabled_at END,revoked_at=CASE WHEN p_status='revoked' THEN now() ELSE revoked_at END
  WHERE organization_tool_installations_id=p_installation_id RETURNING * INTO after_row;
  PERFORM public.append_audit_event('tools',CASE WHEN p_status='disabled' THEN 'tool.installation.disabled' ELSE 'tool.installation.revoked' END,'organization_tool_installations',p_installation_id::text,NULL,NULL,NULL,NULL,NULL,
    'Estado administrativo da instalacao alterado',jsonb_build_object('tool_id',after_row.tool_id,'organization_tool_installation_id',p_installation_id,'before',to_jsonb(before_row),'after',to_jsonb(after_row)),NULL);
  RETURN to_jsonb(after_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_effective_tool_config(p_tool_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO pg_catalog,public AS $$
DECLARE v_org bigint:=public.current_organization_id(); v_use text:=public.tool_runtime_permission(p_tool_id); result jsonb;
BEGIN
  IF NOT ((public.has_organization_permission('tools.view') AND public.has_organization_permission('settings.view')) OR public.has_organization_permission(v_use)) THEN
    RAISE EXCEPTION 'tool_effective_config_forbidden';
  END IF;
  SELECT jsonb_build_object('toolId',pt.tool_id,'organizationId',v_org,'settings',coalesce(s.settings,pt.default_settings),
    'entitlements',coalesce(e.entitlements,pt.default_entitlements),'settingsVersion',coalesce(s.settings_version,0),
    'settingsSchemaVersion',pt.settings_schema_version,'generatedAt',to_char(clock_timestamp(),'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) INTO result
  FROM public.platform_tools pt
  JOIN public.organization_tools ot ON ot.organizations_id=v_org AND ot.tool_id=pt.tool_id AND ot.enabled
  LEFT JOIN public.organization_tool_settings s ON s.organizations_id=v_org AND s.tool_id=pt.tool_id
  LEFT JOIN public.organization_tool_entitlements e ON e.organizations_id=v_org AND e.tool_id=pt.tool_id
  WHERE pt.tool_id=p_tool_id AND pt.catalog_status='active';
  IF result IS NULL THEN RAISE EXCEPTION 'tool_not_enabled'; END IF;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_platform_tool_catalog(p_tool_id text,p_patch jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE before_row public.platform_tools%ROWTYPE; after_row public.platform_tools%ROWTYPE;
BEGIN
  IF NOT public.is_platform_owner() OR NOT public.has_organization_permission('platform.tools.manage') THEN RAISE EXCEPTION 'platform_tool_manage_forbidden'; END IF;
  IF public.tool_json_contains_secret(p_patch) THEN RAISE EXCEPTION 'tool_catalog_secret_forbidden'; END IF;
  SELECT * INTO before_row FROM public.platform_tools WHERE tool_id=p_tool_id FOR UPDATE;
  IF before_row.tool_id IS NULL THEN RAISE EXCEPTION 'tool_not_found'; END IF;
  UPDATE public.platform_tools SET
    display_name=coalesce(p_patch->>'displayName',display_name),description=coalesce(p_patch->>'description',description),
    catalog_status=coalesce(p_patch->>'catalogStatus',catalog_status),latest_version=coalesce(p_patch->>'latestVersion',latest_version),
    minimum_supported_version=coalesce(p_patch->>'minimumSupportedVersion',minimum_supported_version),
    settings_schema=coalesce(p_patch->'settingsSchema',settings_schema),default_settings=coalesce(p_patch->'defaultSettings',default_settings),
    default_entitlements=coalesce(p_patch->'defaultEntitlements',default_entitlements)
  WHERE tool_id=p_tool_id RETURNING * INTO after_row;
  PERFORM public.append_audit_event('tools','tool.catalog.updated','platform_tools',p_tool_id,NULL,NULL,NULL,NULL,NULL,'Catalogo da ferramenta atualizado',
    jsonb_build_object('tool_id',p_tool_id,'before',to_jsonb(before_row),'after',to_jsonb(after_row)),NULL);
  RETURN to_jsonb(after_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_organization_tool_entitlements(p_organization_id bigint,p_tool_id text,p_entitlements jsonb,p_expected_version bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE before_row public.organization_tool_entitlements%ROWTYPE; after_row public.organization_tool_entitlements%ROWTYPE; v_actor bigint:=public.current_actor_user_id();
BEGIN
  IF NOT public.is_platform_owner() OR NOT public.has_organization_permission('platform.settings.manage') THEN RAISE EXCEPTION 'platform_entitlements_manage_forbidden'; END IF;
  IF jsonb_typeof(p_entitlements)<>'object' OR public.tool_json_contains_secret(p_entitlements) THEN RAISE EXCEPTION 'tool_entitlements_invalid'; END IF;
  SELECT * INTO before_row FROM public.organization_tool_entitlements WHERE organizations_id=p_organization_id AND tool_id=p_tool_id FOR UPDATE;
  IF before_row.organization_tool_entitlements_id IS NOT NULL AND p_expected_version IS NOT NULL AND before_row.entitlements_version<>p_expected_version THEN RAISE EXCEPTION 'tool_entitlements_version_conflict'; END IF;
  INSERT INTO public.organization_tool_entitlements(organizations_id,tool_id,entitlements,updated_by_platform_owner_users_id)
  VALUES(p_organization_id,p_tool_id,p_entitlements,v_actor)
  ON CONFLICT(organizations_id,tool_id) DO UPDATE SET entitlements=excluded.entitlements,entitlements_version=organization_tool_entitlements.entitlements_version+1,updated_by_platform_owner_users_id=excluded.updated_by_platform_owner_users_id
  RETURNING * INTO after_row;
  PERFORM public.append_audit_event('tools','tool.entitlements.updated','organization_tool_entitlements',after_row.organization_tool_entitlements_id::text,NULL,NULL,NULL,NULL,NULL,'Entitlements da ferramenta atualizados',
    jsonb_build_object('tool_id',p_tool_id,'before',CASE WHEN before_row.organization_tool_entitlements_id IS NULL THEN NULL ELSE to_jsonb(before_row) END,'after',to_jsonb(after_row)),NULL);
  RETURN to_jsonb(after_row);
END;
$$;

-- Servicos internos. Somente service_role registra/toca instalacoes; nenhum
-- frontend/extensao recebe UPDATE direto nessas tabelas.
CREATE OR REPLACE FUNCTION public.service_register_tool_installation(
  p_organizations_id bigint,p_tool_id text,p_external_installation_id text,p_installed_version text DEFAULT NULL,
  p_reported_capabilities text[] DEFAULT '{}',p_registered_by_member_id bigint DEFAULT NULL,p_metadata jsonb DEFAULT '{}'
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_id uuid; v_new boolean:=false; v_scope bigint;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  IF NOT public.tool_semver_is_valid(p_installed_version) OR public.tool_json_contains_secret(p_metadata) THEN RAISE EXCEPTION 'tool_installation_contract_invalid'; END IF;
  INSERT INTO public.organization_tools(organizations_id,tool_id,enabled,registered_by_member_id)
  VALUES(p_organizations_id,p_tool_id,true,p_registered_by_member_id) ON CONFLICT(organizations_id,tool_id) DO NOTHING;
  INSERT INTO public.organization_tool_settings(organizations_id,tool_id,settings,settings_schema_version)
  SELECT p_organizations_id,pt.tool_id,pt.default_settings,pt.settings_schema_version FROM public.platform_tools pt WHERE pt.tool_id=p_tool_id
  ON CONFLICT(organizations_id,tool_id) DO NOTHING;
  SELECT organization_tool_installations_id INTO v_id FROM public.organization_tool_installations
  WHERE organizations_id=p_organizations_id AND tool_id=p_tool_id AND external_installation_id=p_external_installation_id;
  v_new:=v_id IS NULL;
  INSERT INTO public.organization_tool_installations(organizations_id,tool_id,external_installation_id,registration_status,installed_version,reported_capabilities,registered_by_member_id,metadata)
  VALUES(p_organizations_id,p_tool_id,p_external_installation_id,'registered',p_installed_version,coalesce(p_reported_capabilities,'{}'),p_registered_by_member_id,coalesce(p_metadata,'{}'))
  ON CONFLICT(organizations_id,tool_id,external_installation_id) DO UPDATE SET
    registration_status='registered',installed_version=coalesce(excluded.installed_version,organization_tool_installations.installed_version),
    reported_capabilities=excluded.reported_capabilities,registered_by_member_id=coalesce(organization_tool_installations.registered_by_member_id,excluded.registered_by_member_id),
    metadata=organization_tool_installations.metadata || excluded.metadata,disabled_at=NULL,revoked_at=NULL
  RETURNING organization_tool_installations_id INTO v_id;
  IF v_new THEN
    SELECT legacy_scope_users_id INTO v_scope FROM public.organizations WHERE organizations_id=p_organizations_id;
    PERFORM public.append_audit_event('tools','tool.installation.registered','organization_tool_installations',v_id::text,NULL,NULL,NULL,NULL,NULL,'Instalacao registrada',
      jsonb_build_object('tool_id',p_tool_id,'organization_tool_installation_id',v_id,'registered_by_member_id',p_registered_by_member_id),v_scope);
  END IF;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.service_touch_tool_installation(
  p_organizations_id bigint,p_tool_id text,p_external_installation_id text,p_seen boolean DEFAULT true,p_meaningful_activity boolean DEFAULT false,
  p_installed_version text DEFAULT NULL,p_reported_capabilities text[] DEFAULT NULL,p_last_seen_member_id bigint DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_id uuid;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  IF NOT public.tool_semver_is_valid(p_installed_version) THEN RAISE EXCEPTION 'tool_semver_invalid'; END IF;
  UPDATE public.organization_tool_installations SET
    last_seen_at=CASE WHEN p_seen THEN now() ELSE last_seen_at END,
    last_activity_at=CASE WHEN p_meaningful_activity THEN now() ELSE last_activity_at END,
    installed_version=coalesce(p_installed_version,installed_version),
    reported_capabilities=coalesce(p_reported_capabilities,reported_capabilities),
    last_seen_member_id=coalesce(p_last_seen_member_id,last_seen_member_id)
  WHERE organizations_id=p_organizations_id AND tool_id=p_tool_id AND external_installation_id=p_external_installation_id AND registration_status='registered'
  RETURNING organization_tool_installations_id INTO v_id;
  IF v_id IS NULL THEN RAISE EXCEPTION 'tool_installation_not_registered'; END IF;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.service_set_tool_installation_status(
  p_organizations_id bigint,p_tool_id text,p_external_installation_id text,p_status text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE before_row public.organization_tool_installations%ROWTYPE; after_row public.organization_tool_installations%ROWTYPE; v_scope bigint;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  IF p_status NOT IN ('disabled','revoked') THEN RAISE EXCEPTION 'tool_installation_status_invalid'; END IF;
  SELECT * INTO before_row FROM public.organization_tool_installations
  WHERE organizations_id=p_organizations_id AND tool_id=p_tool_id AND external_installation_id=p_external_installation_id FOR UPDATE;
  IF before_row.organization_tool_installations_id IS NULL THEN RAISE EXCEPTION 'tool_installation_not_registered'; END IF;
  UPDATE public.organization_tool_installations SET registration_status=p_status,
    disabled_at=CASE WHEN p_status='disabled' THEN now() ELSE disabled_at END,
    revoked_at=CASE WHEN p_status='revoked' THEN now() ELSE revoked_at END
  WHERE organization_tool_installations_id=before_row.organization_tool_installations_id RETURNING * INTO after_row;
  SELECT legacy_scope_users_id INTO v_scope FROM public.organizations WHERE organizations_id=p_organizations_id;
  PERFORM public.append_audit_event('tools',CASE WHEN p_status='disabled' THEN 'tool.installation.disabled' ELSE 'tool.installation.revoked' END,
    'organization_tool_installations',after_row.organization_tool_installations_id::text,NULL,NULL,NULL,NULL,NULL,'Estado administrativo da instalacao alterado',
    jsonb_build_object('tool_id',p_tool_id,'organization_tool_installation_id',after_row.organization_tool_installations_id,'before',to_jsonb(before_row),'after',to_jsonb(after_row)),v_scope);
  RETURN after_row.organization_tool_installations_id;
END;
$$;

-- Bridges usados pelo CRM atual. Leem/escrevem exclusivamente as tabelas
-- canonicas; nao existe blob runtime persistido.
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

CREATE OR REPLACE FUNCTION public.save_dispatch_settings(p_settings jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE wa jsonb; ig jsonb; wa_v bigint; ig_v bigint;
BEGIN
  SELECT settings,settings_version INTO wa,wa_v FROM public.organization_tool_settings WHERE organizations_id=public.current_organization_id() AND tool_id='vinsansi_whatsapp_manager';
  SELECT settings,settings_version INTO ig,ig_v FROM public.organization_tool_settings WHERE organizations_id=public.current_organization_id() AND tool_id='vinsansi_instagram';
  wa:=wa || jsonb_build_object('whatsapp',p_settings->'whatsapp','chipLevels',p_settings->'chipLevels');
  ig:=jsonb_build_object('instagram',p_settings->'instagram');
  PERFORM public.save_organization_tool_settings('vinsansi_whatsapp_manager',wa,wa_v);
  PERFORM public.save_organization_tool_settings('vinsansi_instagram',ig,ig_v);
  RETURN p_settings;
END;
$$;

CREATE OR REPLACE FUNCTION public.reset_dispatch_settings()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE wa_v bigint; ig_v bigint; wa jsonb; ig jsonb;
BEGIN
  SELECT settings_version INTO wa_v FROM public.organization_tool_settings WHERE organizations_id=public.current_organization_id() AND tool_id='vinsansi_whatsapp_manager';
  SELECT settings_version INTO ig_v FROM public.organization_tool_settings WHERE organizations_id=public.current_organization_id() AND tool_id='vinsansi_instagram';
  wa:=public.reset_organization_tool_settings('vinsansi_whatsapp_manager',wa_v)->'settings';
  ig:=public.reset_organization_tool_settings('vinsansi_instagram',ig_v)->'settings';
  RETURN jsonb_build_object('whatsapp',wa->'whatsapp','instagram',ig->'instagram','chipLevels',wa->'chipLevels');
END;
$$;

CREATE OR REPLACE FUNCTION public.save_import_settings(p_settings jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v bigint;
BEGIN
  SELECT settings_version INTO v FROM public.organization_tool_settings WHERE organizations_id=public.current_organization_id() AND tool_id='vinsansi_capture';
  RETURN public.save_organization_tool_settings('vinsansi_capture',p_settings,v)->'settings';
END;
$$;

CREATE OR REPLACE FUNCTION public.reset_import_settings()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v bigint;
BEGIN
  SELECT settings_version INTO v FROM public.organization_tool_settings WHERE organizations_id=public.current_organization_id() AND tool_id='vinsansi_capture';
  RETURN public.reset_organization_tool_settings('vinsansi_capture',v)->'settings';
END;
$$;

-- Correcao retroativa dos contratos tabulares de Organizacoes da Etapa 2.
-- PL/pgSQL exige correspondencia exata (inclusive varchar x text) no RETURN QUERY.
CREATE OR REPLACE FUNCTION public.list_my_organizations()
RETURNS TABLE(organizations_id bigint,organizations_name text,access_level text,organization_members_id bigint,role_name text,is_active_context boolean)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path TO pg_catalog,public AS $$
  WITH actor AS (SELECT public.current_actor_user_id() users_id),
  active_ctx AS (
    SELECT a.organizations_id FROM public.user_active_organizations a,actor
     WHERE a.users_id=actor.users_id
  )
  SELECT o.organizations_id::bigint,o.organizations_name::text,
         (CASE WHEN m.organization_members_id IS NULL AND public.is_platform_owner() THEN 'platform_owner' ELSE m.access_level END)::text,
         m.organization_members_id::bigint,r.organization_roles_name::text,
         EXISTS(SELECT 1 FROM active_ctx a WHERE a.organizations_id=o.organizations_id)::boolean
    FROM public.organizations o
    LEFT JOIN public.organization_members m
      ON m.organizations_id=o.organizations_id AND m.users_id=(SELECT users_id FROM actor) AND m.status_id=1
    LEFT JOIN public.organization_roles r ON r.organization_roles_id=m.organization_roles_id
   WHERE o.status_id=1 AND (m.organization_members_id IS NOT NULL OR public.is_platform_owner())
   ORDER BY o.organizations_name,o.organizations_id;
$$;

CREATE OR REPLACE FUNCTION public.list_organization_members_admin()
RETURNS TABLE(member_id bigint,users_id bigint,name text,email text,access_level text,role_id bigint,role_name text,status_id bigint,joined_at timestamptz,deactivated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO pg_catalog,public,auth AS $$
BEGIN
  IF NOT (public.has_organization_permission('members.view') OR public.current_access_level()='owner') THEN RAISE EXCEPTION 'permission_denied:members.view'; END IF;
  RETURN QUERY
  SELECT m.organization_members_id::bigint,u.users_id::bigint,
         coalesce(nullif(u.users_name,''),split_part(coalesce(au.email,''),'@',1))::text,
         coalesce(au.email,'')::text,m.access_level::text,m.organization_roles_id::bigint,
         r.organization_roles_name::text,m.status_id::bigint,m.joined_at::timestamptz,m.deactivated_at::timestamptz
    FROM public.organization_members m
    JOIN public.users u ON u.users_id=m.users_id
    LEFT JOIN auth.users au ON au.id=u.auth_user_id
    LEFT JOIN public.organization_roles r ON r.organization_roles_id=m.organization_roles_id
   WHERE m.organizations_id=public.current_organization_id()
   ORDER BY CASE m.access_level WHEN 'owner' THEN 1 WHEN 'manager' THEN 2 ELSE 3 END,lower(coalesce(u.users_name,au.email,''));
END;
$$;

CREATE OR REPLACE FUNCTION public.list_organization_roles_admin()
RETURNS TABLE(role_id bigint,name text,role_key text,description text,is_system_template boolean,is_editable boolean,status_id bigint,member_count bigint,permission_keys text[],can_assign boolean)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO pg_catalog,public AS $$
BEGIN
  IF NOT (public.has_organization_permission('roles.view') OR public.current_access_level()='owner') THEN RAISE EXCEPTION 'permission_denied:roles.view'; END IF;
  RETURN QUERY
  SELECT r.organization_roles_id::bigint,r.organization_roles_name::text,r.organization_roles_key::text,r.organization_roles_description::text,
         r.is_system_template::boolean,r.is_editable::boolean,r.status_id::bigint,
         (SELECT count(*)::bigint FROM public.organization_members m WHERE m.organization_roles_id=r.organization_roles_id AND m.status_id=1),
         coalesce((SELECT array_agg(p.permissions_key ORDER BY p.permissions_key) FROM public.organization_role_permissions rp JOIN public.permissions p ON p.permissions_id=rp.permissions_id WHERE rp.organization_roles_id=r.organization_roles_id),ARRAY[]::text[])::text[],
         public.can_assign_organization_role(r.organization_roles_id)::boolean
    FROM public.organization_roles r
   WHERE r.organizations_id=public.current_organization_id()
   ORDER BY r.is_system_template DESC,lower(r.organization_roles_name);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_delegable_permissions()
RETURNS TABLE(permission_key text,name text,category text,description text)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO pg_catalog,public AS $$
BEGIN
  IF NOT (public.has_organization_permission('roles.view') OR public.current_access_level()='owner') THEN RAISE EXCEPTION 'permission_denied:roles.view'; END IF;
  RETURN QUERY SELECT p.permissions_key::text,p.permissions_name::text,p.permissions_category::text,p.permissions_description::text
    FROM public.permissions p WHERE p.permissions_sensitivity='delegable' ORDER BY p.permissions_category,p.permissions_name;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_organization_invitations()
RETURNS TABLE(invitation_id uuid,email text,access_level text,role_id bigint,role_name text,status text,expires_at timestamptz,created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO pg_catalog,public AS $$
BEGIN
  IF NOT (public.has_organization_permission('members.view') OR public.current_access_level()='owner') THEN RAISE EXCEPTION 'permission_denied:members.view'; END IF;
  RETURN QUERY
  SELECT i.organization_invitations_id::uuid,i.invite_email::text,i.access_level::text,i.organization_roles_id::bigint,
         r.organization_roles_name::text,(CASE WHEN i.invitation_status='pending' AND i.expires_at<=now() THEN 'expired' ELSE i.invitation_status END)::text,
         i.expires_at::timestamptz,i.organization_invitations_created_at::timestamptz
    FROM public.organization_invitations i
    LEFT JOIN public.organization_roles r ON r.organization_roles_id=i.organization_roles_id
   WHERE i.organizations_id=public.current_organization_id()
   ORDER BY i.organization_invitations_created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_platform_organizations_admin()
RETURNS TABLE(organization_id bigint,name text,status_id bigint,owner_member_id bigint,owner_name text,owner_email text,member_count bigint,created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO pg_catalog,public,auth AS $$
BEGIN
  IF NOT public.is_platform_owner() THEN RAISE EXCEPTION 'platform_owner_required'; END IF;
  RETURN QUERY
  SELECT o.organizations_id::bigint,o.organizations_name::text,o.status_id::bigint,owner_m.organization_members_id::bigint,
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

-- Bridge comprovado: Worker oficial embarcado no Gerenciador. Remocao na Etapa 4.
DROP FUNCTION IF EXISTS public.service_get_operational_settings(bigint);
CREATE FUNCTION public.service_get_operational_settings(p_users_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO pg_catalog,public AS $$
DECLARE v_org bigint; wa jsonb;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  SELECT organizations_id INTO v_org FROM public.organizations WHERE legacy_scope_users_id=p_users_id LIMIT 1;
  SELECT settings INTO wa FROM public.organization_tool_settings WHERE organizations_id=v_org AND tool_id='vinsansi_whatsapp_manager';
  RETURN jsonb_build_object('dispatch',jsonb_build_object('whatsapp',wa->'whatsapp','chipLevels',wa->'chipLevels'),
    'timezone',coalesce(wa->>'operationalTimezone','America/Sao_Paulo'),'cutoffHour',coalesce((wa->>'operationalCutoffHour')::integer,22));
END;
$$;

-- RLS organizacional. DML administrativo ocorre apenas pelas RPCs acima.
ALTER TABLE public.platform_tools ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_tools ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_tool_installations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_tool_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_tool_entitlements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS platform_tools_read ON public.platform_tools;
CREATE POLICY platform_tools_read ON public.platform_tools FOR SELECT TO authenticated USING(true);
DROP POLICY IF EXISTS platform_tools_platform_write ON public.platform_tools;
CREATE POLICY platform_tools_platform_write ON public.platform_tools FOR ALL TO authenticated USING(public.is_platform_owner() AND public.has_organization_permission('platform.tools.manage')) WITH CHECK(public.is_platform_owner() AND public.has_organization_permission('platform.tools.manage'));

DROP POLICY IF EXISTS organization_tools_read ON public.organization_tools;
CREATE POLICY organization_tools_read ON public.organization_tools FOR SELECT TO authenticated USING(organizations_id=public.current_organization_id() AND public.has_organization_permission('tools.view'));
DROP POLICY IF EXISTS organization_tool_installations_read ON public.organization_tool_installations;
CREATE POLICY organization_tool_installations_read ON public.organization_tool_installations FOR SELECT TO authenticated USING(organizations_id=public.current_organization_id() AND public.has_organization_permission('tools.view'));
DROP POLICY IF EXISTS organization_tool_settings_read ON public.organization_tool_settings;
CREATE POLICY organization_tool_settings_read ON public.organization_tool_settings FOR SELECT TO authenticated USING(organizations_id=public.current_organization_id() AND public.has_organization_permission('tools.view') AND public.has_organization_permission('settings.view'));
DROP POLICY IF EXISTS organization_tool_entitlements_read ON public.organization_tool_entitlements;
CREATE POLICY organization_tool_entitlements_read ON public.organization_tool_entitlements FOR SELECT TO authenticated USING(organizations_id=public.current_organization_id() AND public.has_organization_permission('tools.view'));

REVOKE ALL ON public.platform_tools,public.organization_tools,public.organization_tool_installations,public.organization_tool_settings,public.organization_tool_entitlements FROM PUBLIC,anon;
REVOKE INSERT,UPDATE,DELETE ON public.organization_tools,public.organization_tool_installations,public.organization_tool_settings,public.organization_tool_entitlements FROM authenticated;
GRANT SELECT ON public.platform_tools,public.organization_tools,public.organization_tool_installations,public.organization_tool_settings,public.organization_tool_entitlements TO authenticated;

REVOKE ALL ON FUNCTION public.service_register_tool_installation(bigint,text,text,text,text[],bigint,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.service_touch_tool_installation(bigint,text,text,boolean,boolean,text,text[],bigint) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.service_set_tool_installation_status(bigint,text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.service_get_operational_settings(bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.service_register_tool_installation(bigint,text,text,text,text[],bigint,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.service_touch_tool_installation(bigint,text,text,boolean,boolean,text,text[],bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.service_set_tool_installation_status(bigint,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.service_get_operational_settings(bigint) TO service_role;

GRANT EXECUTE ON FUNCTION public.list_organization_tools() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_organization_tool_details(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_organization_tool_settings(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_organization_tool_settings(text,jsonb,bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reset_organization_tool_settings(text,bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_organization_tool_enabled(text,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_tool_installation_status(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_effective_tool_config(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_platform_tool_catalog(text,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_organization_tool_entitlements(bigint,text,jsonb,bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_operational_settings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_dispatch_settings(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reset_dispatch_settings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_import_settings(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reset_import_settings() TO authenticated;

COMMIT;


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
  organizations_id bigint NOT NULL REFERENCES public.organizations(organizations_id) ON DELETE CASCADE,
  organization_members_id bigint NOT NULL REFERENCES public.organization_members(organization_members_id) ON DELETE CASCADE,
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
CREATE INDEX IF NOT EXISTS tool_sessions_context_idx ON public.tool_user_sessions(organizations_id,organization_members_id,last_used_at DESC) WHERE revoked_at IS NULL;

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
DECLARE v_user bigint; v_member_name text; v_member public.organization_members%ROWTYPE; v_org public.organizations%ROWTYPE; v_permissions text[]; v_required text;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  SELECT users_id,coalesce(nullif(trim(users_name),''),'Usuário') INTO v_user,v_member_name FROM public.users WHERE auth_user_id=p_auth_users_id AND coalesce(users_is_scope,false)=false;
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

CREATE OR REPLACE FUNCTION public.service_executor_eligible_organizations(p_auth_users_id uuid,p_tool_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO pg_catalog,public,auth AS $$
DECLARE v_user bigint; v_member_name text; v_result jsonb;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  SELECT users_id,coalesce(nullif(trim(users_name),''),'Usuário') INTO v_user,v_member_name FROM public.users WHERE auth_user_id=p_auth_users_id AND coalesce(users_is_scope,false)=false;
  SELECT coalesce(jsonb_agg(jsonb_build_object('organizationId',m.organizations_id,'organizationName',o.organizations_name,'memberId',m.organization_members_id,'memberName',v_member_name,'accessLevel',m.access_level) ORDER BY o.organizations_name),'[]'::jsonb)
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

CREATE OR REPLACE FUNCTION public.get_organization_context()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO pg_catalog,public AS $$
DECLARE v_actor bigint:=public.current_actor_user_id(); v_org bigint:=public.current_organization_id(); v_member public.organization_members%ROWTYPE; v_org_row public.organizations%ROWTYPE; v_member_name text; v_role_name text; v_permissions jsonb; v_orgs jsonb;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF v_org IS NULL THEN RETURN jsonb_build_object('actorUsersId',v_actor,'organization',NULL,'organizations','[]'::jsonb,'permissions','[]'::jsonb,'isPlatformOwner',public.is_platform_owner(v_actor)); END IF;
  SELECT * INTO v_org_row FROM public.organizations WHERE organizations_id=v_org;
  SELECT * INTO v_member FROM public.organization_members WHERE organizations_id=v_org AND users_id=v_actor AND status_id=1 LIMIT 1;
  SELECT coalesce(nullif(trim(users_name),''),'Usuário') INTO v_member_name FROM public.users WHERE users_id=v_actor;
  IF v_member.organization_roles_id IS NOT NULL THEN SELECT organization_roles_name INTO v_role_name FROM public.organization_roles WHERE organization_roles_id=v_member.organization_roles_id; END IF;
  SELECT coalesce(jsonb_agg(p.permissions_key ORDER BY p.permissions_key),'[]'::jsonb) INTO v_permissions FROM public.permissions p WHERE public.has_organization_permission(p.permissions_key);
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',x.organizations_id::text,'name',x.organizations_name,'accessLevel',x.access_level,'memberId',CASE WHEN x.organization_members_id IS NULL THEN NULL ELSE x.organization_members_id::text END,'roleName',x.role_name,'active',x.is_active_context) ORDER BY x.organizations_name),'[]'::jsonb) INTO v_orgs FROM public.list_my_organizations() x;
  RETURN jsonb_build_object('actorUsersId',v_actor::text,'isPlatformOwner',public.is_platform_owner(v_actor),'organization',jsonb_build_object('id',v_org_row.organizations_id::text,'name',v_org_row.organizations_name,'slug',to_jsonb(v_org_row)->>'organizations_slug','legacyScopeUsersId',to_jsonb(v_org_row)->>'legacy_scope_users_id'),'member',CASE WHEN v_member.organization_members_id IS NULL THEN NULL ELSE jsonb_build_object('id',v_member.organization_members_id::text,'name',v_member_name,'accessLevel',v_member.access_level,'roleId',CASE WHEN v_member.organization_roles_id IS NULL THEN NULL ELSE v_member.organization_roles_id::text END,'roleName',v_role_name) END,'permissions',v_permissions,'organizations',v_orgs);
END;
$$;

CREATE OR REPLACE FUNCTION public.service_exchange_executor_pairing(p_pairing_code_hash text,p_credential_hash text,p_session_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public,auth AS $$
DECLARE p public.tool_executor_pairings%ROWTYPE; installation uuid; credential uuid; session_id uuid; v_context jsonb;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  IF length(p_credential_hash)<>64 OR length(p_session_hash)<>64 THEN RAISE EXCEPTION 'executor_token_hash_invalid'; END IF;
  SELECT * INTO p FROM public.tool_executor_pairings WHERE pairing_code_hash=p_pairing_code_hash AND exchanged_at IS NULL AND revoked_at IS NULL AND expires_at>now() FOR UPDATE;
  IF p.tool_executor_pairings_id IS NULL THEN RAISE EXCEPTION 'pairing_invalid_or_expired'; END IF;
  v_context:=public.service_executor_member_context(p.auth_users_id,p.organizations_id,p.tool_id);
  IF (v_context->>'userId')::bigint<>p.users_id OR (v_context->>'memberId')::bigint<>p.organization_members_id THEN
    RAISE EXCEPTION 'pairing_context_divergent';
  END IF;
  installation:=public.service_register_tool_installation(p.organizations_id,p.tool_id,p.external_installation_id,p.requested_version,p.requested_capabilities,p.organization_members_id,jsonb_build_object('pairing','stage4'));
  INSERT INTO public.tool_installation_credentials(organization_tool_installations_id,credential_hash,issued_to_external_installation_id)
  VALUES(installation,p_credential_hash,p.external_installation_id) RETURNING tool_installation_credentials_id INTO credential;
  INSERT INTO public.tool_user_sessions(organization_tool_installations_id,auth_users_id,users_id,organizations_id,organization_members_id,session_hash)
  VALUES(installation,p.auth_users_id,p.users_id,p.organizations_id,p.organization_members_id,p_session_hash) RETURNING tool_user_sessions_id INTO session_id;
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
     OR v_member.organization_members_id IS NULL OR v_member.organizations_id<>NEW.organizations_id OR v_member.users_id<>NEW.users_id OR v_member.status_id<>1 THEN
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
    UPDATE public.tool_user_sessions SET revoked_at=coalesce(revoked_at,now()),logout_reason=coalesce(logout_reason,'membership_inactive')
     WHERE organization_members_id=NEW.organization_members_id AND revoked_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS revoke_executor_sessions_on_member_change_trigger ON public.organization_members;
CREATE TRIGGER revoke_executor_sessions_on_member_change_trigger AFTER UPDATE OF status_id ON public.organization_members
FOR EACH ROW EXECUTE FUNCTION public.revoke_executor_sessions_on_member_change();

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


-- ============================================================================
-- ETAPA 5 / FASE A - GERENCIADOR WHATSAPP COMPLETO (v1.4.0)
-- ============================================================================

BEGIN;

-- CRM Vinsansi Studio v1.4.0
-- Etapa 5 / Fase A: cockpit WhatsApp no Gerenciador.
-- organizations_id e a fronteira de tenant; users_id permanece somente como
-- bridge do ConversationsPage do CRM ate a Fase B explicitamente homologada.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $preflight$
DECLARE v_missing text[] := ARRAY[]::text[];
BEGIN
  IF to_regclass('public.organizations') IS NULL THEN v_missing:=array_append(v_missing,'table:organizations'); END IF;
  IF to_regclass('public.organization_members') IS NULL THEN v_missing:=array_append(v_missing,'table:organization_members'); END IF;
  IF to_regclass('public.conversations') IS NULL THEN v_missing:=array_append(v_missing,'table:conversations'); END IF;
  IF to_regclass('public.conversation_messages') IS NULL THEN v_missing:=array_append(v_missing,'table:conversation_messages'); END IF;
  IF to_regclass('public.instances') IS NULL THEN v_missing:=array_append(v_missing,'table:instances'); END IF;
  IF to_regclass('public.chips') IS NULL THEN v_missing:=array_append(v_missing,'table:chips'); END IF;
  IF to_regclass('public.queue_items') IS NULL THEN v_missing:=array_append(v_missing,'table:queue_items'); END IF;
  IF to_regprocedure('public.append_audit_event(text,text,text,text,bigint,bigint,bigint,bigint,bigint,text,jsonb,bigint)') IS NULL THEN
    v_missing:=array_append(v_missing,'function:append_audit_event');
  END IF;
  IF cardinality(v_missing)>0 THEN
    RAISE EXCEPTION 'v1.4.0_requires_v1.3.0:%',array_to_string(v_missing,',');
  END IF;
END
$preflight$;

INSERT INTO public.permissions(permissions_key,permissions_name,permissions_category,permissions_description,permissions_sensitivity)
VALUES('whatsapp.assign','Atribuir conversas','WhatsApp','Transferir ou reatribuir a responsabilidade de conversas WhatsApp.','delegable')
ON CONFLICT(permissions_key) DO UPDATE SET
  permissions_name=excluded.permissions_name,
  permissions_category=excluded.permissions_category,
  permissions_description=excluded.permissions_description,
  permissions_sensitivity=excluded.permissions_sensitivity;

-- Dono recebe todas as permissoes nao-platform pela regra central. Gestor recebe
-- whatsapp.assign como poder gerencial padrao; funcoes delegaveis podem recebe-la.
INSERT INTO public.organization_role_permissions(organization_roles_id,permissions_id)
SELECT r.organization_roles_id,p.permissions_id
  FROM public.organization_roles r
  JOIN public.permissions p ON p.permissions_key='whatsapp.assign'
 WHERE r.organization_roles_key='gestor' AND r.status_id=1
ON CONFLICT DO NOTHING;

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS conversation_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS assignment_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_message_direction text,
  ADD COLUMN IF NOT EXISTS conversations_created_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.conversation_messages
  ADD COLUMN IF NOT EXISTS queue_items_id bigint REFERENCES public.queue_items(queue_items_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sents_id bigint REFERENCES public.sents(sents_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS client_idempotency_key uuid,
  ADD COLUMN IF NOT EXISTS media_storage_path text,
  ADD COLUMN IF NOT EXISTS media_size_bytes bigint,
  ADD COLUMN IF NOT EXISTS media_archive_status text,
  ADD COLUMN IF NOT EXISTS media_archive_error text,
  ADD COLUMN IF NOT EXISTS reconciliation_state text,
  ADD COLUMN IF NOT EXISTS reconciliation_checked_at timestamptz;

UPDATE public.conversations SET conversation_version=1 WHERE conversation_version IS NULL OR conversation_version<1;

CREATE INDEX IF NOT EXISTS conversations_org_last_message_idx
  ON public.conversations(organizations_id,last_message_at DESC,conversations_id DESC);
CREATE INDEX IF NOT EXISTS conversations_org_assignee_idx
  ON public.conversations(organizations_id,assigned_to_member_id,last_message_at DESC);
CREATE INDEX IF NOT EXISTS conversation_messages_thread_cursor_idx
  ON public.conversation_messages(organizations_id,conversations_id,conversation_messages_id DESC);
CREATE INDEX IF NOT EXISTS conversation_messages_queue_item_idx
  ON public.conversation_messages(organizations_id,queue_items_id) WHERE queue_items_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS conversation_messages_sent_idx
  ON public.conversation_messages(organizations_id,sents_id) WHERE sents_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS conversation_identity_org_chip_jid_unique
  ON public.conversations(organizations_id,chips_id,remote_jid);
CREATE UNIQUE INDEX IF NOT EXISTS conversation_message_manual_idempotency_unique
  ON public.conversation_messages(organizations_id,client_idempotency_key)
  WHERE client_idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS conversation_message_provider_unique
  ON public.conversation_messages(organizations_id,instances_id,external_message_id)
  WHERE external_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.conversation_member_states(
  conversation_member_states_id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  organizations_id bigint NOT NULL REFERENCES public.organizations(organizations_id) ON DELETE CASCADE,
  conversations_id bigint NOT NULL REFERENCES public.conversations(conversations_id) ON DELETE CASCADE,
  organization_members_id bigint NOT NULL REFERENCES public.organization_members(organization_members_id) ON DELETE CASCADE,
  last_read_message_id bigint REFERENCES public.conversation_messages(conversation_messages_id) ON DELETE SET NULL,
  last_viewed_at timestamptz,
  conversation_member_states_created_at timestamptz NOT NULL DEFAULT now(),
  conversation_member_states_updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organizations_id,conversations_id,organization_members_id)
);
CREATE INDEX IF NOT EXISTS conversation_member_states_member_idx
  ON public.conversation_member_states(organizations_id,organization_members_id,last_viewed_at DESC);

CREATE TABLE IF NOT EXISTS public.conversation_presence(
  conversation_presence_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizations_id bigint NOT NULL REFERENCES public.organizations(organizations_id) ON DELETE CASCADE,
  conversations_id bigint NOT NULL REFERENCES public.conversations(conversations_id) ON DELETE CASCADE,
  organization_members_id bigint NOT NULL REFERENCES public.organization_members(organization_members_id) ON DELETE CASCADE,
  session_key text NOT NULL,
  viewing boolean NOT NULL DEFAULT true,
  typing boolean NOT NULL DEFAULT false,
  viewing_seen_at timestamptz NOT NULL DEFAULT now(),
  typing_seen_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now()+interval '45 seconds'),
  conversation_presence_created_at timestamptz NOT NULL DEFAULT now(),
  conversation_presence_updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conversation_presence_session_key_valid CHECK(length(session_key) BETWEEN 8 AND 160),
  UNIQUE(organizations_id,conversations_id,organization_members_id,session_key)
);
CREATE INDEX IF NOT EXISTS conversation_presence_active_idx
  ON public.conversation_presence(organizations_id,conversations_id,expires_at DESC);

ALTER TABLE public.conversation_member_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_presence ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS conversation_member_states_org_select ON public.conversation_member_states;
CREATE POLICY conversation_member_states_org_select ON public.conversation_member_states FOR SELECT TO authenticated
USING(organizations_id=public.current_organization_id() AND public.has_organization_permission('whatsapp.view'));
DROP POLICY IF EXISTS conversation_presence_org_select ON public.conversation_presence;
CREATE POLICY conversation_presence_org_select ON public.conversation_presence FOR SELECT TO authenticated
USING(organizations_id=public.current_organization_id() AND public.has_organization_permission('whatsapp.view'));
REVOKE INSERT,UPDATE,DELETE ON public.conversation_member_states,public.conversation_presence FROM anon,authenticated;
GRANT SELECT ON public.conversation_member_states,public.conversation_presence TO authenticated;

-- Bucket privado. Upload/leitura sao emitidos pelo backend depois de validar
-- sessao humana, membership e organization path.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES(
  'conversation-media','conversation-media',false,26214400,
  ARRAY['image/jpeg','image/png','image/webp','video/mp4','audio/ogg','audio/mpeg','audio/mp4','application/pdf','application/octet-stream']
)
ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

CREATE OR REPLACE FUNCTION public.stage5_member_has_permission(
  p_organizations_id bigint,p_organization_members_id bigint,p_permission text
)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path TO pg_catalog,public AS $$
  SELECT EXISTS(
    SELECT 1
      FROM public.organization_members m
     WHERE m.organization_members_id=p_organization_members_id
       AND m.organizations_id=p_organizations_id
       AND m.status_id=1
       AND (
         m.access_level='owner'
         OR (m.access_level='manager' AND p_permission=ANY(ARRAY[
           'organization.view','members.view','members.invite','members.edit','members.deactivate','roles.view','audit.view','whatsapp.assign'
         ]))
         OR EXISTS(
           SELECT 1 FROM public.organization_role_permissions rp
           JOIN public.permissions p ON p.permissions_id=rp.permissions_id
           WHERE rp.organization_roles_id=m.organization_roles_id
             AND p.permissions_key=p_permission
             AND p.permissions_sensitivity='delegable'
         )
       )
  );
$$;

CREATE OR REPLACE FUNCTION public.stage5_require_member(
  p_organizations_id bigint,p_organization_members_id bigint,p_permission text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO pg_catalog,public AS $$
BEGIN
  IF NOT public.stage5_member_has_permission(p_organizations_id,p_organization_members_id,p_permission) THEN
    RAISE EXCEPTION 'conversation_permission_denied:%',p_permission;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.stage5_audit_entity(
  p_organizations_id bigint,p_organization_members_id bigint,p_action text,p_entity_type text,p_entity_id text,p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_scope bigint;v_actor bigint;v_auth uuid;v_id bigint;
BEGIN
  SELECT o.legacy_scope_users_id INTO v_scope FROM public.organizations o WHERE o.organizations_id=p_organizations_id;
  SELECT m.users_id,u.auth_user_id INTO v_actor,v_auth
    FROM public.organization_members m JOIN public.users u ON u.users_id=m.users_id
   WHERE m.organization_members_id=p_organization_members_id AND m.organizations_id=p_organizations_id;
  INSERT INTO public.audit_events(
    users_id,organizations_id,actor_auth_user_id,actor_users_id,actor_member_id,actor_type,
    source,action,entity_type,entity_id,message,metadata
  ) VALUES(
    v_scope,p_organizations_id,v_auth,v_actor,p_organization_members_id,'member',
    'whatsapp-manager',p_action,p_entity_type,p_entity_id,p_action,
    coalesce(p_metadata,'{}'::jsonb)||jsonb_build_object('actor_member_id',p_organization_members_id)
  ) RETURNING audit_events_id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.stage5_audit(
  p_organizations_id bigint,p_organization_members_id bigint,p_action text,p_entity_id text,p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS bigint
LANGUAGE sql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
  SELECT public.stage5_audit_entity(p_organizations_id,p_organization_members_id,p_action,'conversation',p_entity_id,p_metadata);
$$;

CREATE OR REPLACE FUNCTION public.stage5_status_rank(p_status text)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_status WHEN 'pending' THEN 10 WHEN 'sending' THEN 20 WHEN 'sent' THEN 30
    WHEN 'delivered' THEN 40 WHEN 'read' THEN 50 WHEN 'failed' THEN 15
    WHEN 'reconciliation_required' THEN 16 WHEN 'deleted' THEN 60 ELSE 0 END;
$$;

CREATE OR REPLACE FUNCTION public.service_stage5_list_conversations(
  p_organizations_id bigint,p_organization_members_id bigint,p_chip_id bigint DEFAULT NULL,
  p_scope text DEFAULT 'all',p_unread_only boolean DEFAULT false,p_archived boolean DEFAULT false,
  p_search text DEFAULT NULL,p_cursor_at timestamptz DEFAULT NULL,p_cursor_id bigint DEFAULT NULL,p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO pg_catalog,public AS $$
DECLARE v_rows jsonb;v_limit integer:=least(greatest(coalesce(p_limit,50),1),100);
BEGIN
  PERFORM public.stage5_require_member(p_organizations_id,p_organization_members_id,'whatsapp.view');
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.last_message_at DESC NULLS LAST,x.conversations_id DESC),'[]'::jsonb)
    INTO v_rows
    FROM (
      SELECT c.conversations_id,c.chips_id,c.instances_id,c.leads_id,c.remote_jid,c.contact_phone,c.contact_name,
             c.contact_avatar_url,c.conversation_status,c.assigned_to_member_id,c.last_replied_by_member_id,
             c.last_message_at,c.last_message_preview,c.last_message_direction,c.assignment_updated_at,c.conversation_version,
             ch.chips_name,coalesce(nullif(u.users_name,''),'Membro #'||m.organization_members_id::text) AS assigned_to_member_name,
             (SELECT count(*)::integer FROM public.conversation_messages cm
               WHERE cm.organizations_id=p_organizations_id AND cm.conversations_id=c.conversations_id
                 AND cm.direction='inbound'
                 AND cm.conversation_messages_id>coalesce(ms.last_read_message_id,0)) AS unread_count
        FROM public.conversations c
        JOIN public.chips ch ON ch.chips_id=c.chips_id AND ch.organizations_id=c.organizations_id
        LEFT JOIN public.organization_members m ON m.organization_members_id=c.assigned_to_member_id AND m.organizations_id=c.organizations_id
        LEFT JOIN public.users u ON u.users_id=m.users_id
        LEFT JOIN public.conversation_member_states ms ON ms.organizations_id=c.organizations_id
          AND ms.conversations_id=c.conversations_id AND ms.organization_members_id=p_organization_members_id
       WHERE c.organizations_id=p_organizations_id
         AND (p_chip_id IS NULL OR c.chips_id=p_chip_id)
         AND c.conversation_status=CASE WHEN p_archived THEN 'archived' ELSE 'open' END
         AND (p_scope='all' OR (p_scope='mine' AND c.assigned_to_member_id=p_organization_members_id)
              OR (p_scope='unassigned' AND c.assigned_to_member_id IS NULL))
         AND (nullif(trim(coalesce(p_search,'')),'') IS NULL OR concat_ws(' ',c.contact_name,c.contact_phone,c.remote_jid) ILIKE '%'||trim(p_search)||'%')
         AND (p_cursor_at IS NULL OR (c.last_message_at,c.conversations_id)<(p_cursor_at,coalesce(p_cursor_id,9223372036854775807)))
         AND (NOT p_unread_only OR EXISTS(
           SELECT 1 FROM public.conversation_messages cm
            WHERE cm.organizations_id=p_organizations_id AND cm.conversations_id=c.conversations_id
              AND cm.direction='inbound' AND cm.conversation_messages_id>coalesce(ms.last_read_message_id,0)
         ))
       ORDER BY c.last_message_at DESC NULLS LAST,c.conversations_id DESC
       LIMIT v_limit
    ) x;
  RETURN jsonb_build_object('items',v_rows,'limit',v_limit);
END;
$$;

CREATE OR REPLACE FUNCTION public.service_stage5_list_messages(
  p_organizations_id bigint,p_organization_members_id bigint,p_conversations_id bigint,
  p_before_id bigint DEFAULT NULL,p_after_id bigint DEFAULT NULL,p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO pg_catalog,public AS $$
DECLARE v_rows jsonb;v_limit integer:=least(greatest(coalesce(p_limit,50),1),100);
BEGIN
  PERFORM public.stage5_require_member(p_organizations_id,p_organization_members_id,'whatsapp.view');
  IF NOT EXISTS(SELECT 1 FROM public.conversations c WHERE c.conversations_id=p_conversations_id AND c.organizations_id=p_organizations_id) THEN
    RAISE EXCEPTION 'conversation_not_found';
  END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.conversation_messages_id),'[]'::jsonb) INTO v_rows
    FROM (
      SELECT cm.conversation_messages_id,cm.conversations_id,cm.queue_items_id,cm.sents_id,cm.external_message_id,
             cm.client_idempotency_key,cm.direction,cm.from_me,cm.message_type,cm.message_body,cm.media_url,
             cm.media_storage_path,cm.media_mime_type,cm.media_file_name,cm.media_size_bytes,cm.quoted_external_message_id,
             cm.message_status,cm.sent_by_member_id,cm.executed_by,cm.provider_timestamp,cm.error_message,
             cm.reconciliation_state,cm.conversation_messages_created_at,cm.conversation_messages_updated_at,
             coalesce(nullif(u.users_name,''),CASE WHEN cm.sent_by_member_id IS NULL THEN NULL ELSE 'Membro #'||cm.sent_by_member_id::text END) AS sent_by_member_name
        FROM public.conversation_messages cm
        LEFT JOIN public.organization_members m ON m.organization_members_id=cm.sent_by_member_id AND m.organizations_id=cm.organizations_id
        LEFT JOIN public.users u ON u.users_id=m.users_id
       WHERE cm.organizations_id=p_organizations_id AND cm.conversations_id=p_conversations_id
         AND (p_before_id IS NULL OR cm.conversation_messages_id<p_before_id)
         AND (p_after_id IS NULL OR cm.conversation_messages_id>p_after_id)
       ORDER BY CASE WHEN p_after_id IS NULL THEN cm.conversation_messages_id END DESC,
                CASE WHEN p_after_id IS NOT NULL THEN cm.conversation_messages_id END ASC
       LIMIT v_limit
    ) x;
  RETURN jsonb_build_object('items',v_rows,'limit',v_limit);
END;
$$;

CREATE OR REPLACE FUNCTION public.service_stage5_mark_read(
  p_organizations_id bigint,p_organization_members_id bigint,p_conversations_id bigint,p_last_read_message_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_last bigint;
BEGIN
  PERFORM public.stage5_require_member(p_organizations_id,p_organization_members_id,'whatsapp.view');
  IF NOT EXISTS(SELECT 1 FROM public.conversations WHERE organizations_id=p_organizations_id AND conversations_id=p_conversations_id) THEN RAISE EXCEPTION 'conversation_not_found'; END IF;
  SELECT max(conversation_messages_id) INTO v_last FROM public.conversation_messages
   WHERE organizations_id=p_organizations_id AND conversations_id=p_conversations_id
     AND (p_last_read_message_id IS NULL OR conversation_messages_id<=p_last_read_message_id);
  INSERT INTO public.conversation_member_states(organizations_id,conversations_id,organization_members_id,last_read_message_id,last_viewed_at)
  VALUES(p_organizations_id,p_conversations_id,p_organization_members_id,v_last,now())
  ON CONFLICT(organizations_id,conversations_id,organization_members_id) DO UPDATE SET
    last_read_message_id=greatest(coalesce(conversation_member_states.last_read_message_id,0),coalesce(excluded.last_read_message_id,0)),
    last_viewed_at=now(),conversation_member_states_updated_at=now();
  RETURN jsonb_build_object('conversationId',p_conversations_id,'lastReadMessageId',v_last);
END;
$$;

CREATE OR REPLACE FUNCTION public.service_stage5_assign_conversation(
  p_organizations_id bigint,p_organization_members_id bigint,p_conversations_id bigint,
  p_action text,p_target_member_id bigint DEFAULT NULL,p_expected_version integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_c public.conversations%ROWTYPE;v_target bigint;v_action text:=lower(trim(coalesce(p_action,'')));
BEGIN
  PERFORM public.stage5_require_member(p_organizations_id,p_organization_members_id,'whatsapp.reply');
  SELECT * INTO v_c FROM public.conversations WHERE organizations_id=p_organizations_id AND conversations_id=p_conversations_id FOR UPDATE;
  IF v_c.conversations_id IS NULL THEN RAISE EXCEPTION 'conversation_not_found'; END IF;
  IF p_expected_version IS NOT NULL AND v_c.conversation_version<>p_expected_version THEN RAISE EXCEPTION 'conversation_version_conflict'; END IF;
  IF v_action='assume' THEN
    IF v_c.assigned_to_member_id IS NOT NULL AND v_c.assigned_to_member_id<>p_organization_members_id THEN RAISE EXCEPTION 'conversation_assignment_conflict'; END IF;
    v_target:=p_organization_members_id;
  ELSIF v_action='release' THEN
    IF v_c.assigned_to_member_id<>p_organization_members_id THEN RAISE EXCEPTION 'conversation_assigned_to_other_member'; END IF;
    v_target:=NULL;
  ELSIF v_action='transfer' THEN
    PERFORM public.stage5_require_member(p_organizations_id,p_organization_members_id,'whatsapp.assign');
    IF NOT EXISTS(SELECT 1 FROM public.organization_members m WHERE m.organization_members_id=p_target_member_id AND m.organizations_id=p_organizations_id AND m.status_id=1) THEN
      RAISE EXCEPTION 'conversation_transfer_target_invalid';
    END IF;
    v_target:=p_target_member_id;
  ELSE RAISE EXCEPTION 'conversation_assignment_action_invalid'; END IF;
  UPDATE public.conversations SET assigned_to_member_id=v_target,assignment_updated_at=now(),conversation_version=conversation_version+1,conversations_updated_at=now()
   WHERE conversations_id=p_conversations_id AND organizations_id=p_organizations_id
   RETURNING * INTO v_c;
  PERFORM public.stage5_audit(p_organizations_id,p_organization_members_id,
    CASE v_action WHEN 'assume' THEN 'conversation.assigned' WHEN 'release' THEN 'conversation.released' ELSE 'conversation.transferred' END,
    p_conversations_id::text,jsonb_build_object('assigned_to_member_id',v_target,'conversation_version',v_c.conversation_version));
  RETURN jsonb_build_object('conversationId',p_conversations_id,'assignedToMemberId',v_target,'conversationVersion',v_c.conversation_version);
END;
$$;

CREATE OR REPLACE FUNCTION public.service_stage5_set_archived(
  p_organizations_id bigint,p_organization_members_id bigint,p_conversations_id bigint,p_archived boolean,p_expected_version integer
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_c public.conversations%ROWTYPE;
BEGIN
  PERFORM public.stage5_require_member(p_organizations_id,p_organization_members_id,'whatsapp.reply');
  SELECT * INTO v_c FROM public.conversations WHERE organizations_id=p_organizations_id AND conversations_id=p_conversations_id FOR UPDATE;
  IF v_c.conversations_id IS NULL THEN RAISE EXCEPTION 'conversation_not_found'; END IF;
  IF p_expected_version IS NOT NULL AND v_c.conversation_version<>p_expected_version THEN RAISE EXCEPTION 'conversation_version_conflict'; END IF;
  UPDATE public.conversations SET conversation_status=CASE WHEN p_archived THEN 'archived' ELSE 'open' END,
    conversation_version=conversation_version+1,conversations_updated_at=now()
   WHERE organizations_id=p_organizations_id AND conversations_id=p_conversations_id RETURNING * INTO v_c;
  PERFORM public.stage5_audit(p_organizations_id,p_organization_members_id,CASE WHEN p_archived THEN 'conversation.archived' ELSE 'conversation.unarchived' END,p_conversations_id::text,'{}');
  RETURN jsonb_build_object('conversationId',p_conversations_id,'status',v_c.conversation_status,'conversationVersion',v_c.conversation_version);
END;
$$;

CREATE OR REPLACE FUNCTION public.service_stage5_prepare_manual_message(
  p_organizations_id bigint,p_organization_members_id bigint,p_conversations_id bigint,p_expected_version integer,
  p_client_idempotency_key uuid,p_message_body text,p_message_type text DEFAULT 'text',
  p_media_storage_path text DEFAULT NULL,p_media_mime_type text DEFAULT NULL,p_media_file_name text DEFAULT NULL,p_media_size_bytes bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_c public.conversations%ROWTYPE;v_existing public.conversation_messages%ROWTYPE;v_message public.conversation_messages%ROWTYPE;v_scope bigint;
BEGIN
  PERFORM public.stage5_require_member(p_organizations_id,p_organization_members_id,'whatsapp.reply');
  IF p_client_idempotency_key IS NULL THEN RAISE EXCEPTION 'manual_message_idempotency_key_required'; END IF;
  IF coalesce(p_message_type,'text')='text' AND nullif(trim(coalesce(p_message_body,'')),'') IS NULL THEN RAISE EXCEPTION 'manual_message_body_required'; END IF;
  SELECT * INTO v_existing FROM public.conversation_messages WHERE organizations_id=p_organizations_id AND client_idempotency_key=p_client_idempotency_key;
  IF v_existing.conversation_messages_id IS NOT NULL THEN
    IF v_existing.conversations_id<>p_conversations_id OR v_existing.sent_by_member_id<>p_organization_members_id THEN RAISE EXCEPTION 'manual_message_idempotency_conflict'; END IF;
    SELECT * INTO v_c FROM public.conversations WHERE organizations_id=p_organizations_id AND conversations_id=p_conversations_id;
    RETURN jsonb_build_object('idempotent',true,'messageId',v_existing.conversation_messages_id,'status',v_existing.message_status,
      'conversationVersion',v_c.conversation_version,'instancesId',v_existing.instances_id,'recipient',coalesce(v_c.contact_phone,v_existing.remote_jid));
  END IF;
  SELECT * INTO v_c FROM public.conversations WHERE organizations_id=p_organizations_id AND conversations_id=p_conversations_id FOR UPDATE;
  IF v_c.conversations_id IS NULL THEN RAISE EXCEPTION 'conversation_not_found'; END IF;
  IF v_c.conversation_status='archived' THEN RAISE EXCEPTION 'conversation_archived'; END IF;
  IF p_expected_version IS NOT NULL AND v_c.conversation_version<>p_expected_version THEN RAISE EXCEPTION 'conversation_version_conflict'; END IF;
  IF v_c.assigned_to_member_id IS NULL THEN
    UPDATE public.conversations SET assigned_to_member_id=p_organization_members_id,assignment_updated_at=now(),conversation_version=conversation_version+1
     WHERE organizations_id=p_organizations_id AND conversations_id=p_conversations_id;
    v_c.assigned_to_member_id:=p_organization_members_id;v_c.conversation_version:=v_c.conversation_version+1;
  ELSIF v_c.assigned_to_member_id<>p_organization_members_id THEN RAISE EXCEPTION 'conversation_assigned_to_other_member'; END IF;
  SELECT legacy_scope_users_id INTO v_scope FROM public.organizations WHERE organizations_id=p_organizations_id;
  INSERT INTO public.conversation_messages(
    users_id,organizations_id,conversations_id,chips_id,instances_id,leads_id,remote_jid,direction,from_me,
    message_type,message_body,media_storage_path,media_mime_type,media_file_name,media_size_bytes,
    message_status,client_idempotency_key,sent_by_member_id,executed_by,conversation_messages_created_at,conversation_messages_updated_at
  ) VALUES(
    v_scope,p_organizations_id,p_conversations_id,v_c.chips_id,v_c.instances_id,v_c.leads_id,v_c.remote_jid,'outbound',true,
    coalesce(nullif(p_message_type,''),'text'),nullif(p_message_body,''),p_media_storage_path,p_media_mime_type,p_media_file_name,p_media_size_bytes,
    'pending',p_client_idempotency_key,p_organization_members_id,'member',now(),now()
  ) RETURNING * INTO v_message;
  PERFORM public.stage5_audit(p_organizations_id,p_organization_members_id,'conversation.manual_message_prepared',p_conversations_id::text,
    jsonb_build_object('conversation_message_id',v_message.conversation_messages_id,'client_idempotency_key',p_client_idempotency_key));
  RETURN jsonb_build_object('idempotent',false,'messageId',v_message.conversation_messages_id,'status',v_message.message_status,
    'conversationVersion',v_c.conversation_version,'instancesId',v_c.instances_id,'recipient',coalesce(v_c.contact_phone,v_c.remote_jid));
END;
$$;

CREATE OR REPLACE FUNCTION public.service_stage5_report_manual_message(
  p_organizations_id bigint,p_organization_members_id bigint,p_conversation_messages_id bigint,
  p_status text,p_external_message_id text DEFAULT NULL,p_error_message text DEFAULT NULL,p_provider_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_m public.conversation_messages%ROWTYPE;v_provider public.conversation_messages%ROWTYPE;v_status text:=lower(trim(coalesce(p_status,'')));
BEGIN
  PERFORM public.stage5_require_member(p_organizations_id,p_organization_members_id,'whatsapp.reply');
  IF v_status NOT IN('sending','sent','failed','reconciliation_required') THEN RAISE EXCEPTION 'manual_message_report_status_invalid'; END IF;
  SELECT * INTO v_m FROM public.conversation_messages
   WHERE organizations_id=p_organizations_id AND conversation_messages_id=p_conversation_messages_id FOR UPDATE;
  IF v_m.conversation_messages_id IS NULL OR v_m.executed_by<>'member' OR v_m.sent_by_member_id<>p_organization_members_id THEN RAISE EXCEPTION 'manual_message_not_found'; END IF;
  IF nullif(p_external_message_id,'') IS NOT NULL THEN
    SELECT * INTO v_provider FROM public.conversation_messages
     WHERE organizations_id=p_organizations_id AND instances_id=v_m.instances_id AND external_message_id=p_external_message_id
       AND conversation_messages_id<>v_m.conversation_messages_id FOR UPDATE;
    IF v_provider.conversation_messages_id IS NOT NULL THEN
      IF v_provider.remote_jid IS DISTINCT FROM v_m.remote_jid OR v_provider.direction<>'outbound' OR v_provider.queue_items_id IS NOT NULL THEN
        RAISE EXCEPTION 'manual_message_provider_identity_conflict';
      END IF;
      UPDATE public.conversation_messages SET
        message_body=coalesce(message_body,v_provider.message_body),media_url=coalesce(media_url,v_provider.media_url),
        media_storage_path=coalesce(media_storage_path,v_provider.media_storage_path),media_mime_type=coalesce(media_mime_type,v_provider.media_mime_type),
        media_file_name=coalesce(media_file_name,v_provider.media_file_name),provider_timestamp=coalesce(v_provider.provider_timestamp,provider_timestamp),
        raw_payload=coalesce(raw_payload,'{}'::jsonb)||coalesce(v_provider.raw_payload,'{}'::jsonb)
       WHERE conversation_messages_id=v_m.conversation_messages_id;
      DELETE FROM public.conversation_messages WHERE conversation_messages_id=v_provider.conversation_messages_id;
      SELECT * INTO v_m FROM public.conversation_messages WHERE conversation_messages_id=p_conversation_messages_id FOR UPDATE;
    END IF;
  END IF;
  IF public.stage5_status_rank(v_status)<public.stage5_status_rank(v_m.message_status)
     AND NOT (v_m.message_status IN('pending','sending') AND v_status IN('failed','reconciliation_required'))
     AND NOT (v_m.message_status IN('failed','reconciliation_required') AND v_status='sent') THEN
    RETURN jsonb_build_object('messageId',v_m.conversation_messages_id,'status',v_m.message_status,'ignoredRegression',true);
  END IF;
  UPDATE public.conversation_messages SET message_status=v_status,external_message_id=coalesce(nullif(p_external_message_id,''),external_message_id),
    error_message=nullif(p_error_message,''),raw_payload=coalesce(raw_payload,'{}'::jsonb)||coalesce(p_provider_payload,'{}'::jsonb),
    reconciliation_state=CASE WHEN v_status='reconciliation_required' THEN 'pending' WHEN v_status='sent' THEN 'resolved_sent' ELSE reconciliation_state END,
    conversation_messages_updated_at=now()
   WHERE conversation_messages_id=p_conversation_messages_id RETURNING * INTO v_m;
  IF v_status='sent' THEN
    UPDATE public.conversations SET last_replied_by_member_id=p_organization_members_id,last_message_at=now(),
      last_message_preview=coalesce(v_m.message_body,'['||v_m.message_type||']'),last_message_direction='outbound',conversations_updated_at=now()
     WHERE organizations_id=p_organizations_id AND conversations_id=v_m.conversations_id;
  ELSIF v_status IN('failed','reconciliation_required') THEN
    PERFORM public.stage5_audit(p_organizations_id,p_organization_members_id,'conversation.manual_message_failed',v_m.conversations_id::text,
      jsonb_build_object('conversation_message_id',v_m.conversation_messages_id,'status',v_status,'error',p_error_message));
  END IF;
  RETURN jsonb_build_object('messageId',v_m.conversation_messages_id,'status',v_m.message_status,'externalMessageId',v_m.external_message_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.service_stage5_presence(
  p_organizations_id bigint,p_organization_members_id bigint,p_conversations_id bigint,p_session_key text,
  p_viewing boolean DEFAULT true,p_typing boolean DEFAULT false,p_stop boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_rows jsonb;
BEGIN
  PERFORM public.stage5_require_member(p_organizations_id,p_organization_members_id,'whatsapp.view');
  IF p_typing THEN PERFORM public.stage5_require_member(p_organizations_id,p_organization_members_id,'whatsapp.reply'); END IF;
  IF NOT EXISTS(SELECT 1 FROM public.conversations WHERE organizations_id=p_organizations_id AND conversations_id=p_conversations_id) THEN RAISE EXCEPTION 'conversation_not_found'; END IF;
  UPDATE public.conversation_presence SET typing=false,conversation_presence_updated_at=now()
   WHERE organizations_id=p_organizations_id AND typing AND typing_seen_at<=now()-interval '8 seconds';
  DELETE FROM public.conversation_presence WHERE organizations_id=p_organizations_id AND expires_at<=now();
  IF p_stop THEN
    DELETE FROM public.conversation_presence WHERE organizations_id=p_organizations_id AND conversations_id=p_conversations_id
      AND organization_members_id=p_organization_members_id AND session_key=p_session_key;
  ELSE
    INSERT INTO public.conversation_presence(organizations_id,conversations_id,organization_members_id,session_key,viewing,typing,viewing_seen_at,typing_seen_at,expires_at)
    VALUES(p_organizations_id,p_conversations_id,p_organization_members_id,p_session_key,p_viewing,p_typing,now(),CASE WHEN p_typing THEN now() END,now()+interval '45 seconds')
    ON CONFLICT(organizations_id,conversations_id,organization_members_id,session_key) DO UPDATE SET
      viewing=excluded.viewing,typing=excluded.typing,viewing_seen_at=now(),
      typing_seen_at=CASE WHEN excluded.typing THEN now() ELSE conversation_presence.typing_seen_at END,
      expires_at=now()+interval '45 seconds',conversation_presence_updated_at=now();
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'memberId',p.organization_members_id,'memberName',coalesce(nullif(u.users_name,''),'Membro #'||p.organization_members_id::text),
    'viewing',p.viewing AND p.expires_at>now(),'typing',p.typing AND p.typing_seen_at>now()-interval '8 seconds'
  ) ORDER BY u.users_name),'[]'::jsonb) INTO v_rows
  FROM public.conversation_presence p JOIN public.organization_members m ON m.organization_members_id=p.organization_members_id AND m.status_id=1
  JOIN public.users u ON u.users_id=m.users_id
  WHERE p.organizations_id=p_organizations_id AND p.conversations_id=p_conversations_id
    AND p.organization_members_id<>p_organization_members_id AND p.expires_at>now();
  RETURN jsonb_build_object('items',v_rows,'viewerTtlSeconds',45,'typingTtlSeconds',8);
END;
$$;

CREATE OR REPLACE FUNCTION public.service_stage5_transfer_members(
  p_organizations_id bigint,p_organization_members_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO pg_catalog,public AS $$
DECLARE v_rows jsonb;
BEGIN
  PERFORM public.stage5_require_member(p_organizations_id,p_organization_members_id,'whatsapp.view');
  SELECT coalesce(jsonb_agg(jsonb_build_object('memberId',m.organization_members_id,'name',coalesce(nullif(u.users_name,''),'Membro #'||m.organization_members_id::text),'accessLevel',m.access_level) ORDER BY u.users_name),'[]'::jsonb)
    INTO v_rows FROM public.organization_members m JOIN public.users u ON u.users_id=m.users_id
   WHERE m.organizations_id=p_organizations_id AND m.status_id=1;
  RETURN v_rows;
END;
$$;

-- Webhook canônico: o tenant e derivado da instancia, nunca do payload.
DROP FUNCTION IF EXISTS public.service_ingest_evolution_message(bigint,text,text,text,boolean,text,text,text,text,timestamptz,jsonb,text,text,text,text);
CREATE FUNCTION public.service_ingest_evolution_message(
  p_instances_id bigint,p_event_type text,p_external_message_id text,p_remote_jid text,p_from_me boolean,
  p_message_type text,p_message_body text,p_message_status text,p_contact_name text,p_provider_timestamp timestamptz,
  p_raw_payload jsonb,p_media_url text,p_media_mime_type text,p_media_file_name text,p_quoted_external_message_id text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_instance record;v_chip record;v_scope bigint;v_conversation public.conversations%ROWTYPE;v_message public.conversation_messages%ROWTYPE;
  v_direction text:=CASE WHEN p_from_me THEN 'outbound' ELSE 'inbound' END;v_member bigint;v_queue bigint;v_sent bigint;
BEGIN
  IF p_remote_jid ILIKE '%@g.us' OR p_remote_jid ILIKE '%@broadcast' THEN RETURN jsonb_build_object('ignored',true,'reason','unsupported_chat_kind'); END IF;
  SELECT i.instances_id,i.organizations_id INTO v_instance FROM public.instances i WHERE i.instances_id=p_instances_id;
  IF v_instance.instances_id IS NULL THEN RAISE EXCEPTION 'webhook_instance_not_found'; END IF;
  SELECT c.chips_id,c.instances_id INTO v_chip FROM public.chips c WHERE c.instances_id=p_instances_id AND c.organizations_id=v_instance.organizations_id ORDER BY c.chips_id LIMIT 1;
  IF v_chip.chips_id IS NULL THEN RETURN jsonb_build_object('ignored',true,'reason','webhook_chip_not_found'); END IF;
  SELECT legacy_scope_users_id INTO v_scope FROM public.organizations WHERE organizations_id=v_instance.organizations_id;
  INSERT INTO public.conversations(users_id,organizations_id,chips_id,instances_id,remote_jid,contact_phone,contact_name,conversation_status,last_message_at,last_message_preview,last_message_direction,conversations_created_at,conversations_updated_at)
  VALUES(v_scope,v_instance.organizations_id,v_chip.chips_id,p_instances_id,p_remote_jid,regexp_replace(split_part(p_remote_jid,'@',1),'\D','','g'),nullif(p_contact_name,''),'open',coalesce(p_provider_timestamp,now()),coalesce(p_message_body,'['||p_message_type||']'),v_direction,now(),now())
  ON CONFLICT(organizations_id,chips_id,remote_jid) DO UPDATE SET contact_name=coalesce(nullif(excluded.contact_name,''),conversations.contact_name),
    last_message_at=greatest(coalesce(conversations.last_message_at,'epoch'),excluded.last_message_at),
    last_message_preview=CASE WHEN excluded.last_message_at>=coalesce(conversations.last_message_at,'epoch') THEN excluded.last_message_preview ELSE conversations.last_message_preview END,
    last_message_direction=CASE WHEN excluded.last_message_at>=coalesce(conversations.last_message_at,'epoch') THEN excluded.last_message_direction ELSE conversations.last_message_direction END,
    conversations_updated_at=now()
  RETURNING * INTO v_conversation;
  SELECT * INTO v_message FROM public.conversation_messages WHERE organizations_id=v_instance.organizations_id AND instances_id=p_instances_id AND external_message_id=p_external_message_id;
  IF v_message.conversation_messages_id IS NOT NULL THEN
    UPDATE public.conversation_messages SET
      message_status=CASE WHEN public.stage5_status_rank(p_message_status)>=public.stage5_status_rank(message_status) OR message_status IN('failed','reconciliation_required') THEN p_message_status ELSE message_status END,
      message_body=coalesce(nullif(p_message_body,''),message_body),media_url=coalesce(nullif(p_media_url,''),media_url),
      media_mime_type=coalesce(nullif(p_media_mime_type,''),media_mime_type),media_file_name=coalesce(nullif(p_media_file_name,''),media_file_name),
      raw_payload=coalesce(raw_payload,'{}')||coalesce(p_raw_payload,'{}'),conversation_messages_updated_at=now()
     WHERE conversation_messages_id=v_message.conversation_messages_id RETURNING * INTO v_message;
    RETURN jsonb_build_object('ignored',false,'merged',true,'conversationId',v_message.conversations_id,'messageId',v_message.conversation_messages_id);
  END IF;
  IF p_from_me AND to_regclass('public.queue_item_dispatch_parts') IS NOT NULL THEN
    BEGIN
      EXECUTE 'SELECT queue_items_id FROM public.queue_item_dispatch_parts WHERE external_id=$1 ORDER BY queue_item_dispatch_parts_id DESC LIMIT 1' INTO v_queue USING p_external_message_id;
      SELECT qi.dispatched_by_member_id INTO v_member FROM public.queue_items qi WHERE qi.queue_items_id=v_queue AND qi.organizations_id=v_instance.organizations_id;
    EXCEPTION WHEN undefined_column THEN NULL;
    END;
  END IF;
  INSERT INTO public.conversation_messages(users_id,organizations_id,conversations_id,chips_id,instances_id,queue_items_id,external_message_id,remote_jid,direction,from_me,
    message_type,message_body,media_url,media_mime_type,media_file_name,quoted_external_message_id,message_status,sent_by_member_id,executed_by,provider_timestamp,raw_payload,
    conversation_messages_created_at,conversation_messages_updated_at)
  VALUES(v_scope,v_instance.organizations_id,v_conversation.conversations_id,v_chip.chips_id,p_instances_id,v_queue,p_external_message_id,p_remote_jid,v_direction,p_from_me,
    coalesce(nullif(p_message_type,''),'unsupported'),p_message_body,p_media_url,p_media_mime_type,p_media_file_name,p_quoted_external_message_id,p_message_status,
    CASE WHEN p_from_me THEN v_member ELSE NULL END,'system',p_provider_timestamp,coalesce(p_raw_payload,'{}'),now(),now()) RETURNING * INTO v_message;
  IF NOT p_from_me AND v_conversation.assigned_to_member_id IS NULL THEN
    SELECT cm.sent_by_member_id INTO v_member FROM public.conversation_messages cm
     JOIN public.organization_members m ON m.organization_members_id=cm.sent_by_member_id AND m.organizations_id=cm.organizations_id AND m.status_id=1
     WHERE cm.organizations_id=v_instance.organizations_id AND cm.conversations_id=v_conversation.conversations_id
       AND cm.direction='outbound' AND cm.executed_by='system' AND cm.sent_by_member_id IS NOT NULL
     ORDER BY cm.conversation_messages_id DESC LIMIT 1;
    IF v_member IS NOT NULL THEN
      UPDATE public.conversations SET assigned_to_member_id=v_member,assignment_updated_at=now(),conversation_version=conversation_version+1
       WHERE organizations_id=v_instance.organizations_id AND conversations_id=v_conversation.conversations_id AND assigned_to_member_id IS NULL;
    END IF;
  END IF;
  RETURN jsonb_build_object('ignored',false,'merged',false,'conversationId',v_conversation.conversations_id,'messageId',v_message.conversation_messages_id);
END;
$$;

DROP FUNCTION IF EXISTS public.service_update_evolution_message_status(bigint,text,text,text,jsonb,timestamptz);
CREATE FUNCTION public.service_update_evolution_message_status(
  p_instances_id bigint,p_external_message_id text,p_message_status text,p_event_type text,p_raw_payload jsonb,p_provider_timestamp timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_message public.conversation_messages%ROWTYPE;v_org bigint;
BEGIN
  SELECT organizations_id INTO v_org FROM public.instances WHERE instances_id=p_instances_id;
  SELECT * INTO v_message FROM public.conversation_messages WHERE organizations_id=v_org AND instances_id=p_instances_id AND external_message_id=p_external_message_id FOR UPDATE;
  IF v_message.conversation_messages_id IS NULL THEN RETURN jsonb_build_object('updated',false,'reason','message_not_found'); END IF;
  IF public.stage5_status_rank(p_message_status)<public.stage5_status_rank(v_message.message_status)
    AND NOT (v_message.message_status IN('pending','sending') AND p_message_status IN('failed','reconciliation_required'))
    AND NOT (v_message.message_status IN('failed','reconciliation_required') AND p_message_status IN('sent','delivered','read')) THEN
    RETURN jsonb_build_object('updated',false,'reason','status_regression');
  END IF;
  UPDATE public.conversation_messages SET message_status=p_message_status,provider_timestamp=coalesce(p_provider_timestamp,provider_timestamp),
    raw_payload=coalesce(raw_payload,'{}')||coalesce(p_raw_payload,'{}'),reconciliation_state=CASE WHEN message_status='reconciliation_required' THEN 'resolved_provider' ELSE reconciliation_state END,
    reconciliation_checked_at=CASE WHEN message_status='reconciliation_required' THEN now() ELSE reconciliation_checked_at END,conversation_messages_updated_at=now()
   WHERE conversation_messages_id=v_message.conversation_messages_id RETURNING * INTO v_message;
  RETURN jsonb_build_object('updated',true,'messageId',v_message.conversation_messages_id,'status',v_message.message_status);
END;
$$;

DROP FUNCTION IF EXISTS public.service_upsert_evolution_chat(bigint,text,text,text,integer);
CREATE FUNCTION public.service_upsert_evolution_chat(
  p_instances_id bigint,p_remote_jid text,p_contact_name text,p_contact_avatar_url text,p_unread_count integer
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_instance record;v_chip bigint;v_scope bigint;v_id bigint;
BEGIN
  IF p_remote_jid ILIKE '%@g.us' OR p_remote_jid ILIKE '%@broadcast' THEN RETURN jsonb_build_object('ignored',true); END IF;
  SELECT instances_id,organizations_id INTO v_instance FROM public.instances WHERE instances_id=p_instances_id;
  SELECT chips_id INTO v_chip FROM public.chips WHERE organizations_id=v_instance.organizations_id AND instances_id=p_instances_id ORDER BY chips_id LIMIT 1;
  IF v_chip IS NULL THEN RETURN jsonb_build_object('ignored',true); END IF;
  SELECT legacy_scope_users_id INTO v_scope FROM public.organizations WHERE organizations_id=v_instance.organizations_id;
  INSERT INTO public.conversations(users_id,organizations_id,chips_id,instances_id,remote_jid,contact_phone,contact_name,contact_avatar_url,conversation_status,unread_count,conversations_created_at,conversations_updated_at)
  VALUES(v_scope,v_instance.organizations_id,v_chip,p_instances_id,p_remote_jid,regexp_replace(split_part(p_remote_jid,'@',1),'\D','','g'),p_contact_name,p_contact_avatar_url,'open',coalesce(p_unread_count,0),now(),now())
  ON CONFLICT(organizations_id,chips_id,remote_jid) DO UPDATE SET contact_name=coalesce(nullif(excluded.contact_name,''),conversations.contact_name),
    contact_avatar_url=coalesce(nullif(excluded.contact_avatar_url,''),conversations.contact_avatar_url),
    unread_count=coalesce(excluded.unread_count,conversations.unread_count),conversations_updated_at=now()
  RETURNING conversations_id INTO v_id;
  RETURN jsonb_build_object('ignored',false,'conversationId',v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.service_stage5_converge_automatic_message(
  p_organizations_id bigint,p_queue_items_id bigint,p_external_message_id text,p_remote_jid text,p_message_body text,p_message_type text DEFAULT 'text'
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_q record;v_chip record;v_scope bigint;v_c public.conversations%ROWTYPE;v_m public.conversation_messages%ROWTYPE;
BEGIN
  SELECT qi.queue_items_id,qi.organizations_id,qi.chips_id,qi.leads_id,qi.dispatched_by_member_id INTO v_q
   FROM public.queue_items qi WHERE qi.queue_items_id=p_queue_items_id AND qi.organizations_id=p_organizations_id;
  IF v_q.queue_items_id IS NULL THEN RAISE EXCEPTION 'automatic_message_queue_item_not_found'; END IF;
  SELECT c.chips_id,c.instances_id INTO v_chip FROM public.chips c WHERE c.chips_id=v_q.chips_id AND c.organizations_id=p_organizations_id;
  IF v_chip.chips_id IS NULL THEN RAISE EXCEPTION 'automatic_message_chip_not_found'; END IF;
  SELECT legacy_scope_users_id INTO v_scope FROM public.organizations WHERE organizations_id=p_organizations_id;
  INSERT INTO public.conversations(users_id,organizations_id,chips_id,instances_id,leads_id,remote_jid,contact_phone,conversation_status,last_message_at,last_message_preview,last_message_direction,conversations_created_at,conversations_updated_at)
  VALUES(v_scope,p_organizations_id,v_chip.chips_id,v_chip.instances_id,v_q.leads_id,p_remote_jid,regexp_replace(split_part(p_remote_jid,'@',1),'\D','','g'),'open',now(),p_message_body,'outbound',now(),now())
  ON CONFLICT(organizations_id,chips_id,remote_jid) DO UPDATE SET leads_id=coalesce(conversations.leads_id,excluded.leads_id),last_message_at=excluded.last_message_at,
    last_message_preview=excluded.last_message_preview,last_message_direction='outbound',conversations_updated_at=now()
  RETURNING * INTO v_c;
  INSERT INTO public.conversation_messages(users_id,organizations_id,conversations_id,chips_id,instances_id,leads_id,queue_items_id,external_message_id,remote_jid,
    direction,from_me,message_type,message_body,message_status,sent_by_member_id,executed_by,provider_timestamp,conversation_messages_created_at,conversation_messages_updated_at)
  VALUES(v_scope,p_organizations_id,v_c.conversations_id,v_chip.chips_id,v_chip.instances_id,v_q.leads_id,p_queue_items_id,p_external_message_id,p_remote_jid,
    'outbound',true,coalesce(nullif(p_message_type,''),'text'),p_message_body,'sent',v_q.dispatched_by_member_id,'system',now(),now(),now())
  ON CONFLICT(organizations_id,instances_id,external_message_id) WHERE external_message_id IS NOT NULL DO UPDATE SET
    queue_items_id=coalesce(conversation_messages.queue_items_id,excluded.queue_items_id),sent_by_member_id=coalesce(conversation_messages.sent_by_member_id,excluded.sent_by_member_id),
    executed_by='system',message_body=coalesce(conversation_messages.message_body,excluded.message_body),conversation_messages_updated_at=now()
  RETURNING * INTO v_m;
  RETURN jsonb_build_object('conversationId',v_c.conversations_id,'messageId',v_m.conversation_messages_id,'merged',true);
END;
$$;

CREATE OR REPLACE FUNCTION public.service_stage5_queue_control(
  p_organizations_id bigint,p_organization_members_id bigint,p_worker_batches_id bigint,p_action text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_batch record;v_action text:=lower(trim(coalesce(p_action,'')));v_next bigint;v_scope bigint;
BEGIN
  PERFORM public.stage5_require_member(p_organizations_id,p_organization_members_id,'queues.control');
  SELECT * INTO v_batch FROM public.worker_batches WHERE organizations_id=p_organizations_id AND worker_batches_id=p_worker_batches_id FOR UPDATE;
  IF v_batch.worker_batches_id IS NULL THEN RAISE EXCEPTION 'queue_batch_not_found'; END IF;
  IF v_action='pause' THEN v_next:=8;
  ELSIF v_action='resume' THEN v_next:=4;
  ELSIF v_action='stop' THEN v_next:=7;
  ELSE RAISE EXCEPTION 'queue_control_action_invalid'; END IF;
  UPDATE public.worker_batches SET status_id=v_next,worker_batches_updated_at=now() WHERE worker_batches_id=p_worker_batches_id AND organizations_id=p_organizations_id;
  PERFORM public.stage5_audit_entity(p_organizations_id,p_organization_members_id,
    'queue.'||CASE v_action WHEN 'pause' THEN 'paused' WHEN 'resume' THEN 'resumed' ELSE 'stopped' END,
    'worker_batch',p_worker_batches_id::text,jsonb_build_object('previous_status_id',v_batch.status_id,'status_id',v_next));
  RETURN jsonb_build_object('batchId',p_worker_batches_id,'statusId',v_next,'action',v_action);
END;
$$;

-- A tabela operacional sents continua sendo a prova final do lote. Este trigger
-- completa a linhagem quando o registro de envio for persistido depois do
-- evento/convergência da conversa.
CREATE OR REPLACE FUNCTION public.stage5_link_sent_to_conversation_messages()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
BEGIN
  IF NEW.queue_items_id IS NOT NULL THEN
    UPDATE public.conversation_messages
       SET sents_id=NEW.sents_id,conversation_messages_updated_at=now()
     WHERE organizations_id=NEW.organizations_id
       AND queue_items_id=NEW.queue_items_id
       AND sents_id IS NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS stage5_sents_conversation_lineage ON public.sents;
CREATE TRIGGER stage5_sents_conversation_lineage
AFTER INSERT OR UPDATE OF queue_items_id,status_id ON public.sents
FOR EACH ROW EXECUTE FUNCTION public.stage5_link_sent_to_conversation_messages();

CREATE OR REPLACE FUNCTION public.service_stage5_reprocess_queue_item(
  p_organizations_id bigint,p_organization_members_id bigint,p_queue_items_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_q record;
BEGIN
  PERFORM public.stage5_require_member(p_organizations_id,p_organization_members_id,'queues.control');
  SELECT * INTO v_q FROM public.queue_items WHERE organizations_id=p_organizations_id AND queue_items_id=p_queue_items_id FOR UPDATE;
  IF v_q.queue_items_id IS NULL THEN RAISE EXCEPTION 'queue_item_not_found'; END IF;
  IF v_q.status_id<>6 THEN RAISE EXCEPTION 'queue_item_not_safely_reprocessable'; END IF;
  IF EXISTS(SELECT 1 FROM public.sents s WHERE s.organizations_id=p_organizations_id AND s.queue_items_id=p_queue_items_id AND s.status_id=5) THEN
    RAISE EXCEPTION 'queue_item_already_sent';
  END IF;
  IF EXISTS(SELECT 1 FROM public.conversation_messages cm WHERE cm.organizations_id=p_organizations_id AND cm.queue_items_id=p_queue_items_id
    AND (cm.external_message_id IS NOT NULL OR cm.message_status IN('sent','delivered','read','reconciliation_required'))) THEN
    RAISE EXCEPTION 'queue_item_requires_reconciliation';
  END IF;
  IF to_regclass('public.queue_item_dispatch_parts') IS NOT NULL THEN
    BEGIN
      IF EXISTS(SELECT 1 FROM public.queue_item_dispatch_parts p WHERE p.organizations_id=p_organizations_id AND p.queue_items_id=p_queue_items_id AND p.dispatch_state IN('sent','reconciliation_required')) THEN
        RAISE EXCEPTION 'queue_item_requires_reconciliation';
      END IF;
    EXCEPTION WHEN undefined_column THEN NULL;
    END;
  END IF;
  UPDATE public.queue_items SET status_id=3,queue_items_error_message=NULL,queue_items_started_at=NULL,queue_items_finished_at=NULL,queue_items_updated_at=now()
   WHERE organizations_id=p_organizations_id AND queue_items_id=p_queue_items_id;
  PERFORM public.stage5_audit_entity(p_organizations_id,p_organization_members_id,'queue.reprocessed','queue_item',p_queue_items_id::text,
    jsonb_build_object('previous_status_id',v_q.status_id,'status_id',3,'blind_resend',false));
  RETURN jsonb_build_object('queueItemId',p_queue_items_id,'status','queued');
END;
$$;

CREATE OR REPLACE FUNCTION public.service_stage5_reconcile_queue_item(
  p_organizations_id bigint,p_organization_members_id bigint,p_queue_items_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_q record;v_message bigint;v_scope bigint;
BEGIN
  PERFORM public.stage5_require_member(p_organizations_id,p_organization_members_id,'queues.control');
  SELECT * INTO v_q FROM public.queue_items WHERE organizations_id=p_organizations_id AND queue_items_id=p_queue_items_id FOR UPDATE;
  IF v_q.queue_items_id IS NULL THEN RAISE EXCEPTION 'queue_item_not_found'; END IF;
  SELECT cm.conversation_messages_id INTO v_message FROM public.conversation_messages cm
   WHERE cm.organizations_id=p_organizations_id AND cm.queue_items_id=p_queue_items_id
     AND cm.external_message_id IS NOT NULL AND cm.message_status IN('sent','delivered','read')
   ORDER BY cm.conversation_messages_id DESC LIMIT 1;
  IF v_message IS NOT NULL THEN
    UPDATE public.queue_items SET status_id=5,queue_items_error_message=NULL,queue_items_finished_at=coalesce(queue_items_finished_at,now()),queue_items_updated_at=now()
     WHERE organizations_id=p_organizations_id AND queue_items_id=p_queue_items_id;
  END IF;
  PERFORM public.stage5_audit_entity(p_organizations_id,p_organization_members_id,'queue.reconciled','queue_item',p_queue_items_id::text,
    jsonb_build_object('previous_status_id',v_q.status_id,'status_id',CASE WHEN v_message IS NULL THEN v_q.status_id ELSE 5 END,
      'matched_message_id',v_message,'blind_resend',false));
  RETURN jsonb_build_object('queueItemId',p_queue_items_id,'matchedMessageId',v_message,
    'outcome',CASE WHEN v_message IS NULL THEN 'provider_confirmation_required' ELSE 'confirmed_sent' END,'blindResend',false);
END;
$$;

-- RLS org-scoped para o dominio completo; mutacoes humanas passam pelas funcoes
-- transacionais acima. Platform Owner sem membership nao satisfaz stage5_require_member.
DO $conversation_rls$
DECLARE v_table text;v_policy record;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['conversations','conversation_messages','conversation_member_states','conversation_presence'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',v_table);
    FOR v_policy IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=v_table AND cmd='SELECT' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',v_policy.policyname,v_table);
    END LOOP;
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING(organizations_id=public.current_organization_id() AND public.has_organization_permission(''whatsapp.view''))',v_table||'_stage5_org_select',v_table);
  END LOOP;
END
$conversation_rls$;

REVOKE ALL ON FUNCTION public.stage5_member_has_permission(bigint,bigint,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.stage5_require_member(bigint,bigint,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.stage5_audit(bigint,bigint,text,text,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.stage5_audit_entity(bigint,bigint,text,text,text,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.service_stage5_list_conversations(bigint,bigint,bigint,text,boolean,boolean,text,timestamptz,bigint,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.service_stage5_list_messages(bigint,bigint,bigint,bigint,bigint,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.service_stage5_mark_read(bigint,bigint,bigint,bigint) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.service_stage5_assign_conversation(bigint,bigint,bigint,text,bigint,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.service_stage5_set_archived(bigint,bigint,bigint,boolean,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.service_stage5_prepare_manual_message(bigint,bigint,bigint,integer,uuid,text,text,text,text,text,bigint) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.service_stage5_report_manual_message(bigint,bigint,bigint,text,text,text,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.service_stage5_presence(bigint,bigint,bigint,text,boolean,boolean,boolean) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.service_stage5_transfer_members(bigint,bigint) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.service_stage5_converge_automatic_message(bigint,bigint,text,text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.service_stage5_queue_control(bigint,bigint,bigint,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.stage5_link_sent_to_conversation_messages() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.service_stage5_reprocess_queue_item(bigint,bigint,bigint) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.service_stage5_reconcile_queue_item(bigint,bigint,bigint) FROM PUBLIC,anon,authenticated;

GRANT EXECUTE ON FUNCTION public.stage5_member_has_permission(bigint,bigint,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.service_stage5_list_conversations(bigint,bigint,bigint,text,boolean,boolean,text,timestamptz,bigint,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.service_stage5_list_messages(bigint,bigint,bigint,bigint,bigint,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.service_stage5_mark_read(bigint,bigint,bigint,bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.service_stage5_assign_conversation(bigint,bigint,bigint,text,bigint,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.service_stage5_set_archived(bigint,bigint,bigint,boolean,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.service_stage5_prepare_manual_message(bigint,bigint,bigint,integer,uuid,text,text,text,text,text,bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.service_stage5_report_manual_message(bigint,bigint,bigint,text,text,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.service_stage5_presence(bigint,bigint,bigint,text,boolean,boolean,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.service_stage5_transfer_members(bigint,bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.service_ingest_evolution_message(bigint,text,text,text,boolean,text,text,text,text,timestamptz,jsonb,text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.service_update_evolution_message_status(bigint,text,text,text,jsonb,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.service_upsert_evolution_chat(bigint,text,text,text,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.service_stage5_converge_automatic_message(bigint,bigint,text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.service_stage5_queue_control(bigint,bigint,bigint,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.service_stage5_reprocess_queue_item(bigint,bigint,bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.service_stage5_reconcile_queue_item(bigint,bigint,bigint) TO service_role;

COMMIT;


-- ===== CORRETIVO v1.4.1 =====

-- CRM Vinsansi Studio v1.4.1 — fechamento Etapa 5
-- Text-only operacional + reabertura automática de conversa arquivada.
-- A reabertura ocorre somente para mensagem inbound nova; retries/duplicatas não reabrem.
-- Pode ser aplicado sobre a v1.4.0 já instalada.

BEGIN;

CREATE OR REPLACE FUNCTION public.service_stage5_prepare_manual_message(
  p_organizations_id bigint,p_organization_members_id bigint,p_conversations_id bigint,p_expected_version integer,
  p_client_idempotency_key uuid,p_message_body text,p_message_type text DEFAULT 'text',
  p_media_storage_path text DEFAULT NULL,p_media_mime_type text DEFAULT NULL,p_media_file_name text DEFAULT NULL,p_media_size_bytes bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_c public.conversations%ROWTYPE;v_existing public.conversation_messages%ROWTYPE;v_message public.conversation_messages%ROWTYPE;v_scope bigint;
BEGIN
  PERFORM public.stage5_require_member(p_organizations_id,p_organization_members_id,'whatsapp.reply');
  IF p_client_idempotency_key IS NULL THEN RAISE EXCEPTION 'manual_message_idempotency_key_required'; END IF;
  IF lower(coalesce(nullif(trim(p_message_type),''),'text'))<>'text' OR p_media_storage_path IS NOT NULL OR p_media_mime_type IS NOT NULL OR p_media_file_name IS NOT NULL OR p_media_size_bytes IS NOT NULL THEN RAISE EXCEPTION 'media_disabled_text_only'; END IF;
  IF nullif(trim(coalesce(p_message_body,'')),'') IS NULL THEN RAISE EXCEPTION 'manual_message_body_required'; END IF;
  SELECT * INTO v_existing FROM public.conversation_messages WHERE organizations_id=p_organizations_id AND client_idempotency_key=p_client_idempotency_key;
  IF v_existing.conversation_messages_id IS NOT NULL THEN
    IF v_existing.conversations_id<>p_conversations_id OR v_existing.sent_by_member_id<>p_organization_members_id THEN RAISE EXCEPTION 'manual_message_idempotency_conflict'; END IF;
    SELECT * INTO v_c FROM public.conversations WHERE organizations_id=p_organizations_id AND conversations_id=p_conversations_id;
    RETURN jsonb_build_object('idempotent',true,'messageId',v_existing.conversation_messages_id,'status',v_existing.message_status,
      'conversationVersion',v_c.conversation_version,'instancesId',v_existing.instances_id,'recipient',coalesce(v_c.contact_phone,v_existing.remote_jid));
  END IF;
  SELECT * INTO v_c FROM public.conversations WHERE organizations_id=p_organizations_id AND conversations_id=p_conversations_id FOR UPDATE;
  IF v_c.conversations_id IS NULL THEN RAISE EXCEPTION 'conversation_not_found'; END IF;
  IF v_c.conversation_status='archived' THEN RAISE EXCEPTION 'conversation_archived'; END IF;
  IF p_expected_version IS NOT NULL AND v_c.conversation_version<>p_expected_version THEN RAISE EXCEPTION 'conversation_version_conflict'; END IF;
  IF v_c.assigned_to_member_id IS NULL THEN
    UPDATE public.conversations SET assigned_to_member_id=p_organization_members_id,assignment_updated_at=now(),conversation_version=conversation_version+1
     WHERE organizations_id=p_organizations_id AND conversations_id=p_conversations_id;
    v_c.assigned_to_member_id:=p_organization_members_id;v_c.conversation_version:=v_c.conversation_version+1;
  ELSIF v_c.assigned_to_member_id<>p_organization_members_id THEN RAISE EXCEPTION 'conversation_assigned_to_other_member'; END IF;
  SELECT legacy_scope_users_id INTO v_scope FROM public.organizations WHERE organizations_id=p_organizations_id;
  INSERT INTO public.conversation_messages(
    users_id,organizations_id,conversations_id,chips_id,instances_id,leads_id,remote_jid,direction,from_me,
    message_type,message_body,media_storage_path,media_mime_type,media_file_name,media_size_bytes,
    message_status,client_idempotency_key,sent_by_member_id,executed_by,conversation_messages_created_at,conversation_messages_updated_at
  ) VALUES(
    v_scope,p_organizations_id,p_conversations_id,v_c.chips_id,v_c.instances_id,v_c.leads_id,v_c.remote_jid,'outbound',true,
    coalesce(nullif(p_message_type,''),'text'),nullif(p_message_body,''),p_media_storage_path,p_media_mime_type,p_media_file_name,p_media_size_bytes,
    'pending',p_client_idempotency_key,p_organization_members_id,'member',now(),now()
  ) RETURNING * INTO v_message;
  PERFORM public.stage5_audit(p_organizations_id,p_organization_members_id,'conversation.manual_message_prepared',p_conversations_id::text,
    jsonb_build_object('conversation_message_id',v_message.conversation_messages_id,'client_idempotency_key',p_client_idempotency_key));
  RETURN jsonb_build_object('idempotent',false,'messageId',v_message.conversation_messages_id,'status',v_message.message_status,
    'conversationVersion',v_c.conversation_version,'instancesId',v_c.instances_id,'recipient',coalesce(v_c.contact_phone,v_c.remote_jid));
END;
$$;

DROP FUNCTION IF EXISTS public.service_ingest_evolution_message(bigint,text,text,text,boolean,text,text,text,text,timestamptz,jsonb,text,text,text,text);
CREATE FUNCTION public.service_ingest_evolution_message(
  p_instances_id bigint,p_event_type text,p_external_message_id text,p_remote_jid text,p_from_me boolean,
  p_message_type text,p_message_body text,p_message_status text,p_contact_name text,p_provider_timestamp timestamptz,
  p_raw_payload jsonb,p_media_url text,p_media_mime_type text,p_media_file_name text,p_quoted_external_message_id text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_instance record;v_chip record;v_scope bigint;v_conversation public.conversations%ROWTYPE;v_message public.conversation_messages%ROWTYPE;
  v_direction text:=CASE WHEN p_from_me THEN 'outbound' ELSE 'inbound' END;v_member bigint;v_queue bigint;v_sent bigint;
BEGIN
  IF p_remote_jid ILIKE '%@g.us' OR p_remote_jid ILIKE '%@broadcast' THEN RETURN jsonb_build_object('ignored',true,'reason','unsupported_chat_kind'); END IF;
  SELECT i.instances_id,i.organizations_id INTO v_instance FROM public.instances i WHERE i.instances_id=p_instances_id;
  IF v_instance.instances_id IS NULL THEN RAISE EXCEPTION 'webhook_instance_not_found'; END IF;
  SELECT c.chips_id,c.instances_id INTO v_chip FROM public.chips c WHERE c.instances_id=p_instances_id AND c.organizations_id=v_instance.organizations_id ORDER BY c.chips_id LIMIT 1;
  IF v_chip.chips_id IS NULL THEN RETURN jsonb_build_object('ignored',true,'reason','webhook_chip_not_found'); END IF;
  SELECT legacy_scope_users_id INTO v_scope FROM public.organizations WHERE organizations_id=v_instance.organizations_id;
  INSERT INTO public.conversations(users_id,organizations_id,chips_id,instances_id,remote_jid,contact_phone,contact_name,conversation_status,last_message_at,last_message_preview,last_message_direction,conversations_created_at,conversations_updated_at)
  VALUES(v_scope,v_instance.organizations_id,v_chip.chips_id,p_instances_id,p_remote_jid,regexp_replace(split_part(p_remote_jid,'@',1),'\D','','g'),nullif(p_contact_name,''),'open',coalesce(p_provider_timestamp,now()),coalesce(p_message_body,'['||p_message_type||']'),v_direction,now(),now())
  ON CONFLICT(organizations_id,chips_id,remote_jid) DO UPDATE SET contact_name=coalesce(nullif(excluded.contact_name,''),conversations.contact_name),
    last_message_at=greatest(coalesce(conversations.last_message_at,'epoch'),excluded.last_message_at),
    last_message_preview=CASE WHEN excluded.last_message_at>=coalesce(conversations.last_message_at,'epoch') THEN excluded.last_message_preview ELSE conversations.last_message_preview END,
    last_message_direction=CASE WHEN excluded.last_message_at>=coalesce(conversations.last_message_at,'epoch') THEN excluded.last_message_direction ELSE conversations.last_message_direction END,
    conversations_updated_at=now()
  RETURNING * INTO v_conversation;
  SELECT * INTO v_message FROM public.conversation_messages WHERE organizations_id=v_instance.organizations_id AND instances_id=p_instances_id AND external_message_id=p_external_message_id;
  IF v_message.conversation_messages_id IS NOT NULL THEN
    UPDATE public.conversation_messages SET
      message_status=CASE WHEN public.stage5_status_rank(p_message_status)>=public.stage5_status_rank(message_status) OR message_status IN('failed','reconciliation_required') THEN p_message_status ELSE message_status END,
      message_body=coalesce(nullif(p_message_body,''),message_body),media_url=coalesce(nullif(p_media_url,''),media_url),
      media_mime_type=coalesce(nullif(p_media_mime_type,''),media_mime_type),media_file_name=coalesce(nullif(p_media_file_name,''),media_file_name),
      raw_payload=coalesce(raw_payload,'{}')||coalesce(p_raw_payload,'{}'),conversation_messages_updated_at=now()
     WHERE conversation_messages_id=v_message.conversation_messages_id RETURNING * INTO v_message;
    RETURN jsonb_build_object('ignored',false,'merged',true,'conversationId',v_message.conversations_id,'messageId',v_message.conversation_messages_id);
  END IF;
  -- Somente uma mensagem inbound nova reabre uma conversa arquivada. Retries/duplicatas
  -- já mesclados acima não alteram o estado da conversa.
  IF NOT p_from_me AND v_conversation.conversation_status='archived' THEN
    UPDATE public.conversations SET conversation_status='open',conversation_version=conversation_version+1,conversations_updated_at=now()
     WHERE organizations_id=v_instance.organizations_id AND conversations_id=v_conversation.conversations_id
     RETURNING * INTO v_conversation;
  END IF;
  IF p_from_me AND to_regclass('public.queue_item_dispatch_parts') IS NOT NULL THEN
    BEGIN
      EXECUTE 'SELECT queue_items_id FROM public.queue_item_dispatch_parts WHERE external_id=$1 ORDER BY queue_item_dispatch_parts_id DESC LIMIT 1' INTO v_queue USING p_external_message_id;
      SELECT qi.dispatched_by_member_id INTO v_member FROM public.queue_items qi WHERE qi.queue_items_id=v_queue AND qi.organizations_id=v_instance.organizations_id;
    EXCEPTION WHEN undefined_column THEN NULL;
    END;
  END IF;
  INSERT INTO public.conversation_messages(users_id,organizations_id,conversations_id,chips_id,instances_id,queue_items_id,external_message_id,remote_jid,direction,from_me,
    message_type,message_body,media_url,media_mime_type,media_file_name,quoted_external_message_id,message_status,sent_by_member_id,executed_by,provider_timestamp,raw_payload,
    conversation_messages_created_at,conversation_messages_updated_at)
  VALUES(v_scope,v_instance.organizations_id,v_conversation.conversations_id,v_chip.chips_id,p_instances_id,v_queue,p_external_message_id,p_remote_jid,v_direction,p_from_me,
    coalesce(nullif(p_message_type,''),'unsupported'),p_message_body,p_media_url,p_media_mime_type,p_media_file_name,p_quoted_external_message_id,p_message_status,
    CASE WHEN p_from_me THEN v_member ELSE NULL END,'system',p_provider_timestamp,coalesce(p_raw_payload,'{}'),now(),now()) RETURNING * INTO v_message;
  IF NOT p_from_me AND v_conversation.assigned_to_member_id IS NULL THEN
    SELECT cm.sent_by_member_id INTO v_member FROM public.conversation_messages cm
     JOIN public.organization_members m ON m.organization_members_id=cm.sent_by_member_id AND m.organizations_id=cm.organizations_id AND m.status_id=1
     WHERE cm.organizations_id=v_instance.organizations_id AND cm.conversations_id=v_conversation.conversations_id
       AND cm.direction='outbound' AND cm.executed_by='system' AND cm.sent_by_member_id IS NOT NULL
     ORDER BY cm.conversation_messages_id DESC LIMIT 1;
    IF v_member IS NOT NULL THEN
      UPDATE public.conversations SET assigned_to_member_id=v_member,assignment_updated_at=now(),conversation_version=conversation_version+1
       WHERE organizations_id=v_instance.organizations_id AND conversations_id=v_conversation.conversations_id AND assigned_to_member_id IS NULL;
    END IF;
  END IF;
  RETURN jsonb_build_object('ignored',false,'merged',false,'conversationId',v_conversation.conversations_id,'messageId',v_message.conversation_messages_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.service_stage5_converge_automatic_message(
  p_organizations_id bigint,p_queue_items_id bigint,p_external_message_id text,p_remote_jid text,p_message_body text,p_message_type text DEFAULT 'text'
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_q record;v_chip record;v_scope bigint;v_c public.conversations%ROWTYPE;v_m public.conversation_messages%ROWTYPE;
BEGIN
  IF lower(coalesce(nullif(trim(p_message_type),''),'text'))<>'text' THEN RAISE EXCEPTION 'media_disabled_text_only'; END IF;
  IF nullif(trim(coalesce(p_message_body,'')),'') IS NULL THEN RAISE EXCEPTION 'automatic_message_body_required'; END IF;
  SELECT qi.queue_items_id,qi.organizations_id,qi.chips_id,qi.leads_id,qi.dispatched_by_member_id INTO v_q
   FROM public.queue_items qi WHERE qi.queue_items_id=p_queue_items_id AND qi.organizations_id=p_organizations_id;
  IF v_q.queue_items_id IS NULL THEN RAISE EXCEPTION 'automatic_message_queue_item_not_found'; END IF;
  SELECT c.chips_id,c.instances_id INTO v_chip FROM public.chips c WHERE c.chips_id=v_q.chips_id AND c.organizations_id=p_organizations_id;
  IF v_chip.chips_id IS NULL THEN RAISE EXCEPTION 'automatic_message_chip_not_found'; END IF;
  SELECT legacy_scope_users_id INTO v_scope FROM public.organizations WHERE organizations_id=p_organizations_id;
  INSERT INTO public.conversations(users_id,organizations_id,chips_id,instances_id,leads_id,remote_jid,contact_phone,conversation_status,last_message_at,last_message_preview,last_message_direction,conversations_created_at,conversations_updated_at)
  VALUES(v_scope,p_organizations_id,v_chip.chips_id,v_chip.instances_id,v_q.leads_id,p_remote_jid,regexp_replace(split_part(p_remote_jid,'@',1),'\D','','g'),'open',now(),p_message_body,'outbound',now(),now())
  ON CONFLICT(organizations_id,chips_id,remote_jid) DO UPDATE SET leads_id=coalesce(conversations.leads_id,excluded.leads_id),last_message_at=excluded.last_message_at,
    last_message_preview=excluded.last_message_preview,last_message_direction='outbound',conversations_updated_at=now()
  RETURNING * INTO v_c;
  INSERT INTO public.conversation_messages(users_id,organizations_id,conversations_id,chips_id,instances_id,leads_id,queue_items_id,external_message_id,remote_jid,
    direction,from_me,message_type,message_body,message_status,sent_by_member_id,executed_by,provider_timestamp,conversation_messages_created_at,conversation_messages_updated_at)
  VALUES(v_scope,p_organizations_id,v_c.conversations_id,v_chip.chips_id,v_chip.instances_id,v_q.leads_id,p_queue_items_id,p_external_message_id,p_remote_jid,
    'outbound',true,coalesce(nullif(p_message_type,''),'text'),p_message_body,'sent',v_q.dispatched_by_member_id,'system',now(),now(),now())
  ON CONFLICT(organizations_id,instances_id,external_message_id) WHERE external_message_id IS NOT NULL DO UPDATE SET
    queue_items_id=coalesce(conversation_messages.queue_items_id,excluded.queue_items_id),sent_by_member_id=coalesce(conversation_messages.sent_by_member_id,excluded.sent_by_member_id),
    executed_by='system',message_body=coalesce(conversation_messages.message_body,excluded.message_body),conversation_messages_updated_at=now()
  RETURNING * INTO v_m;
  RETURN jsonb_build_object('conversationId',v_c.conversations_id,'messageId',v_m.conversation_messages_id,'merged',true);
END;
$$;

COMMIT;


-- ===== REALTIME v1.4.2 =====
BEGIN;

-- Etapa 5: atualização instantânea das conversas no Gerenciador desktop.
-- A aplicação escuta apenas conversas e mensagens; presença de membros continua
-- no heartbeat próprio para não criar loops de atualização.
GRANT SELECT ON public.conversations, public.conversation_messages TO authenticated;

ALTER TABLE public.conversations REPLICA IDENTITY FULL;
ALTER TABLE public.conversation_messages REPLICA IDENTITY FULL;

DO $realtime$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
    EXECUTE 'CREATE PUBLICATION supabase_realtime';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='conversations'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='conversation_messages'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_messages';
  END IF;
END
$realtime$;

COMMIT;
