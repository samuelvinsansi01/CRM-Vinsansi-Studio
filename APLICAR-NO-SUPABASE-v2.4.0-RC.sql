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

-- ============================================================
-- IDENTIDADE DE CONVERSAS v1.4.3
-- ============================================================

BEGIN;

-- Etapa 5 v1.4.3
-- Corrige identidade WhatsApp LID x telefone sem misturar chips diferentes.
-- A identidade continua sendo organização + chip + JID canônico.

CREATE OR REPLACE FUNCTION public.stage5_canonical_remote_jid(p_value text)
RETURNS text
LANGUAGE sql IMMUTABLE SET search_path TO pg_catalog,public AS $$
  SELECT CASE
    WHEN nullif(trim(coalesce(p_value,'')),'') IS NULL THEN NULL
    WHEN lower(trim(p_value)) ~ '^[0-9]+@(s\.whatsapp\.net|c\.us)$'
      THEN regexp_replace(split_part(lower(trim(p_value)),'@',1),'\D','','g')||'@s.whatsapp.net'
    ELSE trim(p_value)
  END;
$$;

CREATE OR REPLACE FUNCTION public.stage5_payload_phone_jid(p_payload jsonb)
RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path TO pg_catalog,public AS $$
DECLARE v_candidate text;
BEGIN
  IF p_payload IS NULL THEN RETURN NULL; END IF;
  FOR v_candidate IN
    SELECT value FROM unnest(ARRAY[
      p_payload#>>'{Info,ChatAlt}',p_payload#>>'{Info,SenderAlt}',
      p_payload#>>'{info,ChatAlt}',p_payload#>>'{info,chatAlt}',p_payload#>>'{info,SenderAlt}',p_payload#>>'{info,senderAlt}',
      p_payload#>>'{key,remoteJidAlt}',p_payload#>>'{key,remote_jid_alt}',
      p_payload#>>'{chat,remoteJidAlt}',p_payload#>>'{chat,remote_jid_alt}',
      p_payload#>>'{data,Info,ChatAlt}',p_payload#>>'{data,Info,SenderAlt}',
      p_payload#>>'{remoteJidAlt}',p_payload#>>'{remote_jid_alt}',
      p_payload#>>'{Info,Chat}',p_payload#>>'{Info,Sender}',
      p_payload#>>'{key,remoteJid}',p_payload#>>'{remoteJid}'
    ]) AS candidate(value)
  LOOP
    v_candidate:=public.stage5_canonical_remote_jid(v_candidate);
    IF v_candidate ~ '^[0-9]+@s\.whatsapp\.net$' THEN RETURN v_candidate; END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.stage5_meaningful_contact_name(p_value text)
RETURNS text
LANGUAGE sql IMMUTABLE SET search_path TO pg_catalog,public AS $$
  SELECT CASE
    WHEN nullif(trim(coalesce(p_value,'')),'') IS NULL THEN NULL
    WHEN trim(p_value) !~ '[[:alnum:]]' THEN NULL
    ELSE trim(p_value)
  END;
$$;

REVOKE ALL ON FUNCTION public.stage5_canonical_remote_jid(text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.stage5_payload_phone_jid(jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.stage5_meaningful_contact_name(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.stage5_canonical_remote_jid(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.stage5_payload_phone_jid(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.stage5_meaningful_contact_name(text) TO service_role;

-- Repara threads históricas criadas como @lid quando o payload preservou ChatAlt/SenderAlt.
-- A mesclagem acontece SOMENTE dentro da mesma organização e do mesmo chip.
DO $merge_lid_threads$
DECLARE r record;v_target_id bigint;v_phone text;
BEGIN
  FOR r IN
    SELECT c.conversations_id,c.organizations_id,c.chips_id,
           p.phone_jid
      FROM public.conversations c
      CROSS JOIN LATERAL (
        SELECT public.stage5_payload_phone_jid(cm.raw_payload) AS phone_jid
          FROM public.conversation_messages cm
         WHERE cm.organizations_id=c.organizations_id
           AND cm.conversations_id=c.conversations_id
           AND public.stage5_payload_phone_jid(cm.raw_payload) IS NOT NULL
         ORDER BY cm.conversation_messages_id DESC
         LIMIT 1
      ) p
     WHERE lower(c.remote_jid) LIKE '%@lid'
  LOOP
    v_phone:=public.stage5_canonical_remote_jid(r.phone_jid);
    IF v_phone IS NULL OR v_phone !~ '^[0-9]+@s\.whatsapp\.net$' THEN CONTINUE; END IF;

    SELECT c.conversations_id INTO v_target_id
      FROM public.conversations c
     WHERE c.organizations_id=r.organizations_id
       AND c.chips_id=r.chips_id
       AND c.remote_jid=v_phone
       AND c.conversations_id<>r.conversations_id
     ORDER BY c.conversations_id
     LIMIT 1;

    IF v_target_id IS NULL THEN
      UPDATE public.conversation_messages
         SET remote_jid=v_phone,conversation_messages_updated_at=now()
       WHERE organizations_id=r.organizations_id AND conversations_id=r.conversations_id;
      UPDATE public.conversations
         SET remote_jid=v_phone,
             contact_phone=regexp_replace(split_part(v_phone,'@',1),'\D','','g'),
             contact_name=public.stage5_meaningful_contact_name(contact_name),
             conversations_updated_at=now(),conversation_version=conversation_version+1
       WHERE organizations_id=r.organizations_id AND conversations_id=r.conversations_id;
    ELSE
      UPDATE public.conversation_messages
         SET conversations_id=v_target_id,remote_jid=v_phone,conversation_messages_updated_at=now()
       WHERE organizations_id=r.organizations_id AND conversations_id=r.conversations_id;

      INSERT INTO public.conversation_member_states(
        organizations_id,conversations_id,organization_members_id,last_read_message_id,last_viewed_at,
        conversation_member_states_created_at,conversation_member_states_updated_at
      )
      SELECT organizations_id,v_target_id,organization_members_id,last_read_message_id,last_viewed_at,
             conversation_member_states_created_at,now()
        FROM public.conversation_member_states
       WHERE organizations_id=r.organizations_id AND conversations_id=r.conversations_id
      ON CONFLICT(organizations_id,conversations_id,organization_members_id) DO UPDATE SET
        last_read_message_id=CASE
          WHEN excluded.last_read_message_id IS NULL THEN conversation_member_states.last_read_message_id
          WHEN conversation_member_states.last_read_message_id IS NULL THEN excluded.last_read_message_id
          ELSE greatest(conversation_member_states.last_read_message_id,excluded.last_read_message_id)
        END,
        last_viewed_at=greatest(conversation_member_states.last_viewed_at,excluded.last_viewed_at),
        conversation_member_states_updated_at=now();

      DELETE FROM public.conversation_member_states
       WHERE organizations_id=r.organizations_id AND conversations_id=r.conversations_id;
      DELETE FROM public.conversation_presence
       WHERE organizations_id=r.organizations_id AND conversations_id=r.conversations_id;

      UPDATE public.conversations target SET
        contact_phone=regexp_replace(split_part(v_phone,'@',1),'\D','','g'),
        contact_name=coalesce(public.stage5_meaningful_contact_name(target.contact_name),public.stage5_meaningful_contact_name(source.contact_name)),
        contact_avatar_url=coalesce(target.contact_avatar_url,source.contact_avatar_url),
        leads_id=coalesce(target.leads_id,source.leads_id),
        assigned_to_member_id=coalesce(target.assigned_to_member_id,source.assigned_to_member_id),
        last_replied_by_member_id=coalesce(
          CASE WHEN coalesce(source.last_message_at,'epoch'::timestamptz)>coalesce(target.last_message_at,'epoch'::timestamptz) THEN source.last_replied_by_member_id END,
          target.last_replied_by_member_id,source.last_replied_by_member_id
        ),
        conversation_status=CASE WHEN target.conversation_status='open' OR source.conversation_status='open' THEN 'open' ELSE 'archived' END,
        last_message_preview=CASE WHEN coalesce(source.last_message_at,'epoch'::timestamptz)>coalesce(target.last_message_at,'epoch'::timestamptz) THEN source.last_message_preview ELSE target.last_message_preview END,
        last_message_direction=CASE WHEN coalesce(source.last_message_at,'epoch'::timestamptz)>coalesce(target.last_message_at,'epoch'::timestamptz) THEN source.last_message_direction ELSE target.last_message_direction END,
        last_message_at=greatest(target.last_message_at,source.last_message_at),
        conversation_version=greatest(target.conversation_version,source.conversation_version)+1,
        conversations_updated_at=now()
      FROM public.conversations source
      WHERE source.conversations_id=r.conversations_id
        AND target.conversations_id=v_target_id
        AND target.organizations_id=r.organizations_id;

      DELETE FROM public.conversations
       WHERE organizations_id=r.organizations_id AND conversations_id=r.conversations_id;
    END IF;
    v_target_id:=NULL;
  END LOOP;
END
$merge_lid_threads$;

-- Nomes compostos só por pontuação não devem substituir o telefone como fallback.
UPDATE public.conversations
   SET contact_name=NULL,conversations_updated_at=now()
 WHERE contact_name IS NOT NULL
   AND public.stage5_meaningful_contact_name(contact_name) IS NULL;

-- Remove previews técnicos legados; usa o último texto humano existente na thread.
UPDATE public.conversations c
   SET last_message_preview=(
         SELECT cm.message_body
           FROM public.conversation_messages cm
          WHERE cm.organizations_id=c.organizations_id
            AND cm.conversations_id=c.conversations_id
            AND nullif(trim(coalesce(cm.message_body,'')),'') IS NOT NULL
            AND lower(trim(cm.message_body)) NOT IN ('[reactionmessage]','[base64]')
          ORDER BY coalesce(cm.provider_timestamp,cm.conversation_messages_created_at) DESC,cm.conversation_messages_id DESC
          LIMIT 1
       ),
       conversations_updated_at=now()
 WHERE lower(trim(coalesce(c.last_message_preview,''))) IN ('[reactionmessage]','[base64]','');

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
      SELECT c.conversations_id,c.chips_id,c.instances_id,c.leads_id,c.remote_jid,c.contact_phone,
             public.stage5_meaningful_contact_name(c.contact_name) AS contact_name,
             c.contact_avatar_url,c.conversation_status,c.assigned_to_member_id,c.last_replied_by_member_id,
             c.last_message_at,c.last_message_preview,c.last_message_direction,c.assignment_updated_at,c.conversation_version,
             ch.chips_name,ch.chips_phone,
             coalesce(nullif(u.users_name,''),'Membro #'||m.organization_members_id::text) AS assigned_to_member_name,
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
         AND (nullif(trim(coalesce(p_search,'')),'') IS NULL OR concat_ws(' ',c.contact_name,c.contact_phone,c.remote_jid,ch.chips_name,ch.chips_phone) ILIKE '%'||trim(p_search)||'%')
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

CREATE OR REPLACE FUNCTION public.service_ingest_evolution_message(
  p_instances_id bigint,p_event_type text,p_external_message_id text,p_remote_jid text,p_from_me boolean,
  p_message_type text,p_message_body text,p_message_status text,p_contact_name text,p_provider_timestamp timestamptz,
  p_raw_payload jsonb,p_media_url text,p_media_mime_type text,p_media_file_name text,p_quoted_external_message_id text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_instance record;v_chip record;v_scope bigint;v_conversation public.conversations%ROWTYPE;v_message public.conversation_messages%ROWTYPE;
  v_direction text:=CASE WHEN p_from_me THEN 'outbound' ELSE 'inbound' END;v_member bigint;v_queue bigint;
  v_remote_jid text;v_contact_name text;v_chip_id bigint;v_any_chip_id bigint;v_active_count integer;v_total_count integer;
BEGIN
  v_remote_jid:=coalesce(public.stage5_payload_phone_jid(p_raw_payload),public.stage5_canonical_remote_jid(p_remote_jid));
  v_contact_name:=public.stage5_meaningful_contact_name(p_contact_name);
  IF v_remote_jid IS NULL THEN RETURN jsonb_build_object('ignored',true,'reason','remote_jid_missing'); END IF;
  IF v_remote_jid ILIKE '%@g.us' OR v_remote_jid ILIKE '%@broadcast' THEN RETURN jsonb_build_object('ignored',true,'reason','unsupported_chat_kind'); END IF;
  IF nullif(trim(coalesce(p_message_body,'')),'') IS NULL THEN RETURN jsonb_build_object('ignored',true,'reason','text_body_empty'); END IF;

  SELECT i.instances_id,i.organizations_id INTO v_instance FROM public.instances i WHERE i.instances_id=p_instances_id;
  IF v_instance.instances_id IS NULL THEN RAISE EXCEPTION 'webhook_instance_not_found'; END IF;

  SELECT count(*) FILTER(WHERE c.status_id=1)::integer,count(*)::integer,
         min(c.chips_id) FILTER(WHERE c.status_id=1),min(c.chips_id)
    INTO v_active_count,v_total_count,v_chip_id,v_any_chip_id
    FROM public.chips c
   WHERE c.instances_id=p_instances_id AND c.organizations_id=v_instance.organizations_id;
  IF v_active_count=1 THEN NULL;
  ELSIF v_active_count>1 THEN RAISE EXCEPTION 'webhook_chip_ambiguous_active';
  ELSIF v_total_count=1 THEN v_chip_id:=v_any_chip_id;
  ELSIF v_total_count=0 THEN RETURN jsonb_build_object('ignored',true,'reason','webhook_chip_not_found');
  ELSE RAISE EXCEPTION 'webhook_chip_ambiguous'; END IF;
  SELECT c.chips_id,c.instances_id INTO v_chip FROM public.chips c WHERE c.chips_id=v_chip_id AND c.organizations_id=v_instance.organizations_id;

  SELECT legacy_scope_users_id INTO v_scope FROM public.organizations WHERE organizations_id=v_instance.organizations_id;

  -- Idempotência vem ANTES do upsert da conversa. Um retry com LID/JID alternativo
  -- nunca pode criar uma thread vazia paralela.
  SELECT * INTO v_message FROM public.conversation_messages
   WHERE organizations_id=v_instance.organizations_id AND instances_id=p_instances_id AND external_message_id=p_external_message_id;
  IF v_message.conversation_messages_id IS NOT NULL THEN
    UPDATE public.conversation_messages SET
      message_status=CASE WHEN public.stage5_status_rank(p_message_status)>=public.stage5_status_rank(message_status) OR message_status IN('failed','reconciliation_required') THEN p_message_status ELSE message_status END,
      message_body=coalesce(nullif(p_message_body,''),message_body),remote_jid=v_remote_jid,
      raw_payload=coalesce(raw_payload,'{}')||coalesce(p_raw_payload,'{}'),conversation_messages_updated_at=now()
     WHERE conversation_messages_id=v_message.conversation_messages_id RETURNING * INTO v_message;
    UPDATE public.conversations SET
      contact_name=coalesce(v_contact_name,contact_name),
      contact_phone=coalesce(CASE WHEN v_remote_jid LIKE '%@s.whatsapp.net' THEN regexp_replace(split_part(v_remote_jid,'@',1),'\D','','g') END,contact_phone),
      conversations_updated_at=now()
     WHERE organizations_id=v_instance.organizations_id AND conversations_id=v_message.conversations_id;
    RETURN jsonb_build_object('ignored',false,'merged',true,'conversationId',v_message.conversations_id,'messageId',v_message.conversation_messages_id);
  END IF;

  INSERT INTO public.conversations(users_id,organizations_id,chips_id,instances_id,remote_jid,contact_phone,contact_name,conversation_status,last_message_at,last_message_preview,last_message_direction,conversations_created_at,conversations_updated_at)
  VALUES(v_scope,v_instance.organizations_id,v_chip.chips_id,p_instances_id,v_remote_jid,
    CASE WHEN v_remote_jid LIKE '%@s.whatsapp.net' THEN regexp_replace(split_part(v_remote_jid,'@',1),'\D','','g') ELSE NULL END,
    v_contact_name,'open',coalesce(p_provider_timestamp,now()),p_message_body,v_direction,now(),now())
  ON CONFLICT(organizations_id,chips_id,remote_jid) DO UPDATE SET
    contact_name=coalesce(excluded.contact_name,conversations.contact_name),contact_phone=coalesce(excluded.contact_phone,conversations.contact_phone),
    last_message_at=greatest(coalesce(conversations.last_message_at,'epoch'),excluded.last_message_at),
    last_message_preview=CASE WHEN excluded.last_message_at>=coalesce(conversations.last_message_at,'epoch') THEN excluded.last_message_preview ELSE conversations.last_message_preview END,
    last_message_direction=CASE WHEN excluded.last_message_at>=coalesce(conversations.last_message_at,'epoch') THEN excluded.last_message_direction ELSE conversations.last_message_direction END,
    conversations_updated_at=now()
  RETURNING * INTO v_conversation;

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
  VALUES(v_scope,v_instance.organizations_id,v_conversation.conversations_id,v_chip.chips_id,p_instances_id,v_queue,p_external_message_id,v_remote_jid,v_direction,p_from_me,
    'text',p_message_body,NULL,NULL,NULL,p_quoted_external_message_id,p_message_status,
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
DECLARE v_q record;v_chip record;v_scope bigint;v_c public.conversations%ROWTYPE;v_m public.conversation_messages%ROWTYPE;v_remote_jid text;
BEGIN
  IF lower(coalesce(nullif(trim(p_message_type),''),'text'))<>'text' THEN RAISE EXCEPTION 'media_disabled_text_only'; END IF;
  IF nullif(trim(coalesce(p_message_body,'')),'') IS NULL THEN RAISE EXCEPTION 'automatic_message_body_required'; END IF;
  v_remote_jid:=public.stage5_canonical_remote_jid(p_remote_jid);
  IF v_remote_jid IS NULL OR v_remote_jid LIKE '%@lid' THEN RAISE EXCEPTION 'automatic_message_phone_jid_required'; END IF;
  SELECT qi.queue_items_id,qi.organizations_id,qi.chips_id,qi.leads_id,qi.dispatched_by_member_id INTO v_q
   FROM public.queue_items qi WHERE qi.queue_items_id=p_queue_items_id AND qi.organizations_id=p_organizations_id;
  IF v_q.queue_items_id IS NULL THEN RAISE EXCEPTION 'automatic_message_queue_item_not_found'; END IF;
  SELECT c.chips_id,c.instances_id INTO v_chip FROM public.chips c WHERE c.chips_id=v_q.chips_id AND c.organizations_id=p_organizations_id;
  IF v_chip.chips_id IS NULL THEN RAISE EXCEPTION 'automatic_message_chip_not_found'; END IF;
  SELECT legacy_scope_users_id INTO v_scope FROM public.organizations WHERE organizations_id=p_organizations_id;
  INSERT INTO public.conversations(users_id,organizations_id,chips_id,instances_id,leads_id,remote_jid,contact_phone,conversation_status,last_message_at,last_message_preview,last_message_direction,conversations_created_at,conversations_updated_at)
  VALUES(v_scope,p_organizations_id,v_chip.chips_id,v_chip.instances_id,v_q.leads_id,v_remote_jid,regexp_replace(split_part(v_remote_jid,'@',1),'\D','','g'),'open',now(),p_message_body,'outbound',now(),now())
  ON CONFLICT(organizations_id,chips_id,remote_jid) DO UPDATE SET leads_id=coalesce(conversations.leads_id,excluded.leads_id),contact_phone=excluded.contact_phone,last_message_at=excluded.last_message_at,
    last_message_preview=excluded.last_message_preview,last_message_direction='outbound',conversations_updated_at=now()
  RETURNING * INTO v_c;
  INSERT INTO public.conversation_messages(users_id,organizations_id,conversations_id,chips_id,instances_id,leads_id,queue_items_id,external_message_id,remote_jid,
    direction,from_me,message_type,message_body,message_status,sent_by_member_id,executed_by,provider_timestamp,conversation_messages_created_at,conversation_messages_updated_at)
  VALUES(v_scope,p_organizations_id,v_c.conversations_id,v_chip.chips_id,v_chip.instances_id,v_q.leads_id,p_queue_items_id,p_external_message_id,v_remote_jid,
    'outbound',true,'text',p_message_body,'sent',v_q.dispatched_by_member_id,'system',now(),now(),now())
  ON CONFLICT(organizations_id,instances_id,external_message_id) WHERE external_message_id IS NOT NULL DO UPDATE SET
    queue_items_id=coalesce(conversation_messages.queue_items_id,excluded.queue_items_id),sent_by_member_id=coalesce(conversation_messages.sent_by_member_id,excluded.sent_by_member_id),
    executed_by='system',message_body=coalesce(conversation_messages.message_body,excluded.message_body),remote_jid=excluded.remote_jid,conversation_messages_updated_at=now()
  RETURNING * INTO v_m;
  RETURN jsonb_build_object('conversationId',v_c.conversations_id,'messageId',v_m.conversation_messages_id,'merged',true);
END;
$$;

COMMIT;

BEGIN;

-- CRM Vinsansi Studio v1.5.0
-- Etapa 6: auditoria persistente append-only e maquina de estados no PostgreSQL.
--
-- Objetivos:
--   * audit_events e imutavel em runtime;
--   * toda insercao valida organizacao/ator/entidade;
--   * transicoes de lead e queue_item sao validadas no banco;
--   * mudancas criticas sao auditadas mesmo quando nao passam pelo frontend;
--   * o contrato multi-organizacao das Etapas 2-5 e preservado.

DO $preflight$
DECLARE v_missing text[] := ARRAY[]::text[];
BEGIN
  IF to_regclass('public.organizations') IS NULL THEN v_missing:=array_append(v_missing,'table:organizations'); END IF;
  IF to_regclass('public.organization_members') IS NULL THEN v_missing:=array_append(v_missing,'table:organization_members'); END IF;
  IF to_regclass('public.audit_events') IS NULL THEN v_missing:=array_append(v_missing,'table:audit_events'); END IF;
  IF to_regclass('public.audit_transition_rules') IS NULL THEN v_missing:=array_append(v_missing,'table:audit_transition_rules'); END IF;
  IF to_regclass('public.leads') IS NULL THEN v_missing:=array_append(v_missing,'table:leads'); END IF;
  IF to_regclass('public.queue_items') IS NULL THEN v_missing:=array_append(v_missing,'table:queue_items'); END IF;
  IF to_regprocedure('public.append_audit_event(text,text,text,text,bigint,bigint,bigint,bigint,bigint,text,jsonb,bigint)') IS NULL THEN v_missing:=array_append(v_missing,'function:append_audit_event'); END IF;
  IF to_regprocedure('public.current_organization_id()') IS NULL THEN v_missing:=array_append(v_missing,'function:current_organization_id'); END IF;
  IF to_regprocedure('public.current_organization_member_id()') IS NULL THEN v_missing:=array_append(v_missing,'function:current_organization_member_id'); END IF;
  IF cardinality(v_missing)>0 THEN
    RAISE EXCEPTION 'v1.5.0_requires_v1.4.3:%',array_to_string(v_missing,',');
  END IF;
END
$preflight$;

-- Garante as colunas organizacionais/atoriais mesmo em bancos que vieram do baseline antigo.
ALTER TABLE public.audit_events
  ADD COLUMN IF NOT EXISTS organizations_id bigint REFERENCES public.organizations(organizations_id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS actor_users_id bigint REFERENCES public.users(users_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS actor_member_id bigint REFERENCES public.organization_members(organization_members_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS actor_type text NOT NULL DEFAULT 'system';

DO $actor_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.audit_events'::regclass AND conname='audit_events_actor_type_check'
  ) THEN
    ALTER TABLE public.audit_events
      ADD CONSTRAINT audit_events_actor_type_check
      CHECK (actor_type IN ('member','platform_owner','system'));
  END IF;
END
$actor_constraint$;

-- Backfill organizacional para eventos legados antes de tornar o contrato obrigatorio para novos eventos.
UPDATE public.audit_events a
   SET organizations_id=o.organizations_id
  FROM public.organizations o
 WHERE a.organizations_id IS NULL
   AND o.legacy_scope_users_id=a.users_id;

-- Um log imutavel nao pode depender de FKs com CASCADE/SET NULL, pois a acao
-- referencial alteraria o proprio historico. IDs historicos permanecem escalares e
-- sao validados no INSERT pelo trigger validate_audit_event_insert.
ALTER TABLE public.audit_events DROP CONSTRAINT IF EXISTS audit_events_lead_id_fkey;
ALTER TABLE public.audit_events DROP CONSTRAINT IF EXISTS audit_events_queue_item_id_fkey;
ALTER TABLE public.audit_events DROP CONSTRAINT IF EXISTS audit_events_channel_id_fkey;
ALTER TABLE public.audit_events DROP CONSTRAINT IF EXISTS audit_events_actor_users_id_fkey;
ALTER TABLE public.audit_events DROP CONSTRAINT IF EXISTS audit_events_actor_member_id_fkey;
ALTER TABLE public.audit_events DROP CONSTRAINT IF EXISTS audit_events_users_id_fkey;
ALTER TABLE public.audit_events
  ADD CONSTRAINT audit_events_users_id_fkey FOREIGN KEY(users_id) REFERENCES public.users(users_id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS audit_events_organization_created_idx
  ON public.audit_events(organizations_id,created_at DESC,audit_events_id DESC);
CREATE INDEX IF NOT EXISTS audit_events_actor_member_idx
  ON public.audit_events(organizations_id,actor_member_id,created_at DESC)
  WHERE actor_member_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS audit_events_entity_idx
  ON public.audit_events(organizations_id,entity_type,entity_id,created_at DESC,audit_events_id DESC);
CREATE INDEX IF NOT EXISTS audit_events_request_idx
  ON public.audit_events(request_id);

-- Regras canonicas. A tabela e global e somente leitura para clientes autenticados.
INSERT INTO public.audit_transition_rules(entity_type,from_status_id,to_status_id,action_key,is_active)
VALUES
  ('lead',1,2,'validate_or_route',true), ('lead',1,3,'route_to_pre_send',true),
  ('lead',1,6,'invalidate',true), ('lead',1,7,'mark_duplicate',true), ('lead',1,8,'archive',true),
  ('lead',2,1,'return_to_import',true), ('lead',2,3,'prepare_validation',true),
  ('lead',2,4,'enqueue',true), ('lead',2,6,'invalidate',true), ('lead',2,8,'archive',true),
  ('lead',3,1,'return_to_import',true), ('lead',3,2,'validation_success',true),
  ('lead',3,6,'validation_failure',true), ('lead',3,8,'archive',true),
  ('lead',4,2,'reconcile_to_valid',true), ('lead',4,5,'dispatch_success',true),
  ('lead',4,6,'invalidate',true), ('lead',4,8,'archive',true),
  ('lead',5,8,'archive',true), ('lead',6,2,'restore_valid',true), ('lead',6,8,'archive',true),
  ('lead',7,8,'archive',true), ('lead',8,2,'restore_valid',true),
  ('lead',8,5,'restore_sent',true), ('lead',8,6,'restore_invalid',true),
  ('queue_item',3,4,'start',true), ('queue_item',3,6,'fail',true), ('queue_item',3,7,'cancel',true), ('queue_item',3,8,'pause',true),
  ('queue_item',4,3,'recover',true), ('queue_item',4,5,'complete',true), ('queue_item',4,6,'fail',true), ('queue_item',4,7,'cancel',true), ('queue_item',4,8,'pause',true),
  ('queue_item',6,3,'reprocess',true), ('queue_item',6,5,'reconcile_sent',true), ('queue_item',6,7,'cancel',true), ('queue_item',6,8,'pause',true),
  ('queue_item',7,3,'restore',true),
  ('queue_item',8,3,'resume',true), ('queue_item',8,4,'resume_processing',true), ('queue_item',8,6,'fail',true), ('queue_item',8,7,'cancel',true)
ON CONFLICT(entity_type,from_status_id,to_status_id)
DO UPDATE SET action_key=excluded.action_key,is_active=excluded.is_active;

CREATE OR REPLACE FUNCTION public.assert_allowed_status_transition(
  p_entity_type text,
  p_from_status_id bigint,
  p_to_status_id bigint
)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path TO pg_catalog,public
AS $$
BEGIN
  IF p_from_status_id IS NULL OR p_to_status_id IS NULL OR p_from_status_id=p_to_status_id THEN RETURN; END IF;
  IF NOT EXISTS(
    SELECT 1 FROM public.audit_transition_rules r
     WHERE r.entity_type=p_entity_type
       AND r.from_status_id=p_from_status_id
       AND r.to_status_id=p_to_status_id
       AND r.is_active
  ) THEN
    RAISE EXCEPTION 'state_transition_not_allowed:%:%->%',p_entity_type,p_from_status_id,p_to_status_id;
  END IF;
END;
$$;

-- Valida qualquer insercao, inclusive as feitas por funcoes SECURITY DEFINER.
CREATE OR REPLACE FUNCTION public.validate_audit_event_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog,public
AS $$
DECLARE v_scope bigint;
DECLARE v_member_users_id bigint;
BEGIN
  IF NEW.organizations_id IS NULL THEN RAISE EXCEPTION 'audit_organization_required'; END IF;
  IF nullif(trim(coalesce(NEW.source,'')),'') IS NULL OR nullif(trim(coalesce(NEW.action,'')),'') IS NULL THEN
    RAISE EXCEPTION 'audit_source_action_required';
  END IF;
  IF nullif(trim(coalesce(NEW.entity_type,'')),'') IS NULL THEN RAISE EXCEPTION 'audit_entity_type_required'; END IF;
  SELECT legacy_scope_users_id INTO v_scope FROM public.organizations WHERE organizations_id=NEW.organizations_id;
  IF v_scope IS NULL OR v_scope<>NEW.users_id THEN RAISE EXCEPTION 'audit_scope_mismatch'; END IF;
  IF NEW.actor_member_id IS NOT NULL THEN
    SELECT m.users_id INTO v_member_users_id
      FROM public.organization_members m
     WHERE m.organization_members_id=NEW.actor_member_id
       AND m.organizations_id=NEW.organizations_id;
    IF v_member_users_id IS NULL THEN RAISE EXCEPTION 'audit_actor_member_scope_mismatch'; END IF;
    IF NEW.actor_users_id IS NULL THEN NEW.actor_users_id:=v_member_users_id; END IF;
    IF NEW.actor_users_id<>v_member_users_id THEN RAISE EXCEPTION 'audit_actor_identity_mismatch'; END IF;
  END IF;
  IF NEW.actor_type='member' AND NEW.actor_member_id IS NULL THEN RAISE EXCEPTION 'audit_member_actor_required'; END IF;
  IF NEW.actor_type='platform_owner' AND (NEW.actor_users_id IS NULL OR NOT EXISTS(
    SELECT 1 FROM public.platform_owners po WHERE po.users_id=NEW.actor_users_id
  )) THEN RAISE EXCEPTION 'audit_platform_owner_invalid'; END IF;
  IF NEW.actor_type='system' AND NEW.actor_member_id IS NOT NULL THEN RAISE EXCEPTION 'audit_system_member_invalid'; END IF;
  IF NEW.lead_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.leads l WHERE l.leads_id=NEW.lead_id AND l.organizations_id=NEW.organizations_id
  ) THEN RAISE EXCEPTION 'audit_lead_scope_mismatch'; END IF;
  IF NEW.queue_item_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.queue_items qi WHERE qi.queue_items_id=NEW.queue_item_id AND qi.organizations_id=NEW.organizations_id
  ) THEN RAISE EXCEPTION 'audit_queue_item_scope_mismatch'; END IF;
  NEW.metadata:=coalesce(NEW.metadata,'{}'::jsonb);
  NEW.request_id:=coalesce(NEW.request_id,gen_random_uuid());
  NEW.created_at:=coalesce(NEW.created_at,now());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_audit_event_insert_trigger ON public.audit_events;
CREATE TRIGGER validate_audit_event_insert_trigger
BEFORE INSERT ON public.audit_events
FOR EACH ROW EXECUTE FUNCTION public.validate_audit_event_insert();

-- Append-only real: depois desta etapa nenhum papel de aplicacao altera ou apaga historico.
CREATE OR REPLACE FUNCTION public.prevent_audit_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog,public
AS $$
BEGIN
  RAISE EXCEPTION 'audit_events_append_only';
END;
$$;

DROP TRIGGER IF EXISTS audit_events_append_only_update_trigger ON public.audit_events;
DROP TRIGGER IF EXISTS audit_events_append_only_delete_trigger ON public.audit_events;
CREATE TRIGGER audit_events_append_only_update_trigger
BEFORE UPDATE ON public.audit_events
FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_event_mutation();
CREATE TRIGGER audit_events_append_only_delete_trigger
BEFORE DELETE ON public.audit_events
FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_event_mutation();

-- Mantem a assinatura publica usada pelo CRM, mas endurece escopo e ator.
CREATE OR REPLACE FUNCTION public.append_audit_event(
  p_source text,
  p_action text,
  p_entity_type text,
  p_entity_id text DEFAULT NULL,
  p_lead_id bigint DEFAULT NULL,
  p_queue_item_id bigint DEFAULT NULL,
  p_channel_id bigint DEFAULT NULL,
  p_previous_status_id bigint DEFAULT NULL,
  p_target_status_id bigint DEFAULT NULL,
  p_message text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_users_id bigint DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog,public
AS $$
DECLARE
  v_scope_users_id bigint;
  v_org bigint;
  v_actor_users_id bigint;
  v_actor_member_id bigint;
  v_actor_type text;
  v_actor_name text;
  v_id bigint;
BEGIN
  IF auth.role()='service_role' THEN
    v_scope_users_id:=p_users_id;
    SELECT o.organizations_id INTO v_org FROM public.organizations o WHERE o.legacy_scope_users_id=v_scope_users_id LIMIT 1;
    v_actor_type:='system';
  ELSE
    v_scope_users_id:=public.ensure_current_user();
    v_org:=public.current_organization_id();
    v_actor_users_id:=public.current_actor_user_id();
    v_actor_member_id:=public.current_organization_member_id();
    v_actor_type:=CASE WHEN public.is_platform_owner(v_actor_users_id) AND v_actor_member_id IS NULL THEN 'platform_owner' ELSE 'member' END;
    SELECT u.users_name INTO v_actor_name FROM public.users u WHERE u.users_id=v_actor_users_id;
    IF p_users_id IS NOT NULL AND p_users_id<>v_scope_users_id THEN RAISE EXCEPTION 'audit_forbidden'; END IF;
  END IF;
  IF v_scope_users_id IS NULL THEN RAISE EXCEPTION 'audit_user_required'; END IF;
  IF v_org IS NULL THEN RAISE EXCEPTION 'audit_organization_required'; END IF;
  IF nullif(trim(coalesce(p_source,'')),'') IS NULL OR nullif(trim(coalesce(p_action,'')),'') IS NULL THEN RAISE EXCEPTION 'audit_source_action_required'; END IF;

  INSERT INTO public.audit_events(
    users_id,organizations_id,actor_auth_user_id,actor_users_id,actor_member_id,actor_type,
    source,action,entity_type,entity_id,lead_id,queue_item_id,channel_id,
    previous_status_id,target_status_id,message,metadata
  ) VALUES(
    v_scope_users_id,v_org,auth.uid(),v_actor_users_id,v_actor_member_id,v_actor_type,
    trim(p_source),trim(p_action),coalesce(nullif(trim(p_entity_type),''),'system'),p_entity_id,
    p_lead_id,p_queue_item_id,p_channel_id,p_previous_status_id,p_target_status_id,p_message,
    coalesce(p_metadata,'{}'::jsonb)||jsonb_build_object(
      'actor_name',v_actor_name,
      'actor_type',v_actor_type,
      'actor_member_id',v_actor_member_id,
      'organization_id',v_org
    )
  ) RETURNING audit_events_id INTO v_id;
  RETURN v_id;
END;
$$;

-- Gatilhos de estado: a regra esta no banco, nao na interface.
CREATE OR REPLACE FUNCTION public.audit_lead_state_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog,public
AS $$
BEGIN
  IF TG_OP='UPDATE' AND NEW.lead_status_id IS DISTINCT FROM OLD.lead_status_id THEN
    PERFORM public.assert_allowed_status_transition('lead',OLD.lead_status_id,NEW.lead_status_id);
  END IF;
  IF TG_OP='INSERT' THEN
    PERFORM public.append_audit_event('database','lead_created','lead',NEW.leads_id::text,NEW.leads_id,NULL,NEW.channels_id,NULL,NEW.lead_status_id,NULL,
      jsonb_build_object('origin',NEW.leads_origin,'organization_id',NEW.organizations_id),NEW.users_id);
  ELSIF NEW.lead_status_id IS DISTINCT FROM OLD.lead_status_id OR NEW.channels_id IS DISTINCT FROM OLD.channels_id THEN
    PERFORM public.append_audit_event('database','lead_state_changed','lead',NEW.leads_id::text,NEW.leads_id,NULL,NEW.channels_id,
      OLD.lead_status_id,NEW.lead_status_id,NULL,
      jsonb_build_object('previous_channel_id',OLD.channels_id,'target_channel_id',NEW.channels_id,'organization_id',NEW.organizations_id),NEW.users_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_lead_state_change_trigger ON public.leads;
CREATE TRIGGER audit_lead_state_change_trigger
AFTER INSERT OR UPDATE OF lead_status_id,channels_id ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.audit_lead_state_change();

CREATE OR REPLACE FUNCTION public.audit_queue_item_state_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog,public
AS $$
BEGIN
  IF TG_OP='UPDATE' AND NEW.status_id IS DISTINCT FROM OLD.status_id THEN
    PERFORM public.assert_allowed_status_transition('queue_item',OLD.status_id,NEW.status_id);
  END IF;
  IF TG_OP='INSERT' THEN
    PERFORM public.append_audit_event('database','queue_item_created','queue_item',NEW.queue_items_id::text,NEW.leads_id,NEW.queue_items_id,NULL,NULL,NEW.status_id,NULL,
      jsonb_build_object('queue_id',NEW.queues_id,'position',NEW.queue_items_position,'organization_id',NEW.organizations_id),NEW.users_id);
  ELSIF NEW.status_id IS DISTINCT FROM OLD.status_id THEN
    PERFORM public.append_audit_event('database','queue_item_state_changed','queue_item',NEW.queue_items_id::text,NEW.leads_id,NEW.queue_items_id,NULL,
      OLD.status_id,NEW.status_id,NEW.queue_items_error_message,
      jsonb_build_object('attempts',NEW.queue_items_attempts,'queue_id',NEW.queues_id,'organization_id',NEW.organizations_id),NEW.users_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_queue_item_state_change_trigger ON public.queue_items;
CREATE TRIGGER audit_queue_item_state_change_trigger
AFTER INSERT OR UPDATE OF status_id ON public.queue_items
FOR EACH ROW EXECUTE FUNCTION public.audit_queue_item_state_change();

-- Se um fluxo administrativo fizer hard-delete de lead, o evento preserva o ID historico.
CREATE OR REPLACE FUNCTION public.audit_lead_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog,public
AS $$
BEGIN
  PERFORM public.append_audit_event('database','lead_deleted','lead',OLD.leads_id::text,OLD.leads_id,NULL,OLD.channels_id,
    OLD.lead_status_id,NULL,NULL,
    jsonb_build_object('origin',OLD.leads_origin,'organization_id',OLD.organizations_id),OLD.users_id);
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS audit_lead_delete_trigger ON public.leads;
CREATE TRIGGER audit_lead_delete_trigger
BEFORE DELETE ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.audit_lead_delete();

-- Exclusao de item enfileirado continua permitida pelos contratos atuais, mas passa a deixar rastro.
CREATE OR REPLACE FUNCTION public.audit_queue_item_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog,public
AS $$
BEGIN
  PERFORM public.append_audit_event('database','queue_item_deleted','queue_item',OLD.queue_items_id::text,OLD.leads_id,OLD.queue_items_id,NULL,
    OLD.status_id,NULL,OLD.queue_items_error_message,
    jsonb_build_object('queue_id',OLD.queues_id,'position',OLD.queue_items_position,'attempts',OLD.queue_items_attempts,'organization_id',OLD.organizations_id),OLD.users_id);
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS audit_queue_item_delete_trigger ON public.queue_items;
CREATE TRIGGER audit_queue_item_delete_trigger
BEFORE DELETE ON public.queue_items
FOR EACH ROW EXECUTE FUNCTION public.audit_queue_item_delete();

-- Worker batches continuam auditados quando a tabela existe.
DO $worker_audit$
BEGIN
  IF to_regclass('public.worker_batches') IS NOT NULL THEN
    EXECUTE $fn$
      CREATE OR REPLACE FUNCTION public.audit_worker_batch_state_change()
      RETURNS trigger
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path TO pg_catalog,public
      AS $body$
      BEGIN
        IF TG_OP='INSERT' OR NEW.status_id IS DISTINCT FROM OLD.status_id THEN
          PERFORM public.append_audit_event(
            'worker','worker_batch_state_changed','worker_batch',NEW.worker_batches_id::text,NULL,NULL,NEW.channels_id,
            CASE WHEN TG_OP='UPDATE' THEN OLD.status_id ELSE NULL END,NEW.status_id,NEW.worker_batches_last_error,
            jsonb_build_object('chip_id',NEW.chips_id,'total',NEW.worker_batches_total_items,'processed',NEW.worker_batches_processed_items,'worker_id',NEW.worker_batches_worker_id,'organization_id',NEW.organizations_id),NEW.users_id
          );
        END IF;
        RETURN NEW;
      END;
      $body$;
    $fn$;
    DROP TRIGGER IF EXISTS audit_worker_batch_state_change_trigger ON public.worker_batches;
    CREATE TRIGGER audit_worker_batch_state_change_trigger
    AFTER INSERT OR UPDATE OF status_id ON public.worker_batches
    FOR EACH ROW EXECUTE FUNCTION public.audit_worker_batch_state_change();
  END IF;
END
$worker_audit$;

-- RLS/grants: leitura exige organizacao + audit.view; escrita somente por contratos server-side.
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_transition_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_events_own_select ON public.audit_events;
DROP POLICY IF EXISTS audit_events_organization_select ON public.audit_events;
CREATE POLICY audit_events_organization_select ON public.audit_events
FOR SELECT TO authenticated
USING(organizations_id=public.current_organization_id() AND public.has_organization_permission('audit.view'));
DROP POLICY IF EXISTS audit_transition_rules_read ON public.audit_transition_rules;
CREATE POLICY audit_transition_rules_read ON public.audit_transition_rules
FOR SELECT TO authenticated USING(is_active);

REVOKE INSERT,UPDATE,DELETE ON public.audit_events FROM anon,authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.audit_transition_rules FROM anon,authenticated;
GRANT SELECT ON public.audit_events,public.audit_transition_rules TO authenticated;
GRANT SELECT,INSERT ON public.audit_events TO service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.audit_transition_rules TO service_role;
GRANT EXECUTE ON FUNCTION public.append_audit_event(text,text,text,text,bigint,bigint,bigint,bigint,bigint,text,jsonb,bigint) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.assert_allowed_status_transition(text,bigint,bigint) TO authenticated,service_role;

COMMIT;
BEGIN;

-- CRM Vinsansi Studio v1.6.0
-- Etapa 7: identidade canônica, deduplicação transversal e supressão de contato
-- adaptadas ao tenant canônico organizations_id.

DO $preflight$
DECLARE v_missing text[]:=ARRAY[]::text[];
BEGIN
  IF to_regclass('public.organizations') IS NULL THEN v_missing:=array_append(v_missing,'table:organizations'); END IF;
  IF to_regclass('public.leads') IS NULL THEN v_missing:=array_append(v_missing,'table:leads'); END IF;
  IF to_regclass('public.lead_identity_registry') IS NULL THEN v_missing:=array_append(v_missing,'table:lead_identity_registry'); END IF;
  IF to_regclass('public.contact_suppressions') IS NULL THEN v_missing:=array_append(v_missing,'table:contact_suppressions'); END IF;
  IF to_regclass('public.audit_transition_rules') IS NULL THEN v_missing:=array_append(v_missing,'table:audit_transition_rules'); END IF;
  IF to_regprocedure('public.append_audit_event(text,text,text,text,bigint,bigint,bigint,bigint,bigint,text,jsonb,bigint)') IS NULL THEN v_missing:=array_append(v_missing,'function:append_audit_event'); END IF;
  IF to_regprocedure('public.current_organization_id()') IS NULL THEN v_missing:=array_append(v_missing,'function:current_organization_id'); END IF;
  IF cardinality(v_missing)>0 THEN RAISE EXCEPTION 'v1.6.0_requires_v1.5.0:%',array_to_string(v_missing,','); END IF;
END
$preflight$;

-- Normalizadores preservam os contratos públicos existentes.
CREATE OR REPLACE FUNCTION public.normalize_identity_phone(p_value text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path TO pg_catalog AS $$
DECLARE v text:=regexp_replace(coalesce(p_value,''),'[^0-9]','','g');
BEGIN
  IF v LIKE '00%' THEN v:=substr(v,3); END IF;
  IF v='' THEN RETURN ''; END IF;
  IF v LIKE '55%' THEN RETURN v; END IF;
  IF length(v) IN (10,11) THEN RETURN '55'||v; END IF;
  RETURN v;
END; $$;

CREATE OR REPLACE FUNCTION public.normalize_identity_instagram(p_value text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path TO pg_catalog AS $$
DECLARE
  v_raw text:=lower(trim(coalesce(p_value,'')));
  v_path text;
  v_candidate text;
  v_reserved constant text[]:=ARRAY[
    'about','accounts','api','challenge','contact','developer','direct','directory',
    'download','emails','explore','graphql','invites','legal','oauth','p','press',
    'reel','reels','stories','tv','web'
  ];
BEGIN
  IF v_raw='' THEN RETURN ''; END IF;

  IF v_raw ~* '^https?://' THEN
    IF v_raw !~* '^https?://(www\.)?instagram\.com(?:/|$)' THEN RETURN ''; END IF;
    v_path:=regexp_replace(v_raw,'^https?://(www\.)?instagram\.com/?','','i');
  ELSIF v_raw ~* '^(www\.)?instagram\.com(?:/|$)' THEN
    v_path:=regexp_replace(v_raw,'^(www\.)?instagram\.com/?','','i');
  ELSE
    v_candidate:=regexp_replace(v_raw,'^@','');
    IF v_candidate='' OR v_candidate=ANY(v_reserved) OR length(v_candidate)>30 OR v_candidate !~ '^[a-z0-9._]+$' THEN RETURN ''; END IF;
    RETURN v_candidate;
  END IF;

  v_path:=split_part(split_part(v_path,'?',1),'#',1);
  v_path:=regexp_replace(v_path,'^/+|/+$','','g');
  IF v_path='' OR position('/' in v_path)>0 THEN RETURN ''; END IF;
  v_candidate:=regexp_replace(v_path,'^@','');
  IF v_candidate='' OR v_candidate=ANY(v_reserved) OR length(v_candidate)>30 OR v_candidate !~ '^[a-z0-9._]+$' THEN RETURN ''; END IF;
  RETURN v_candidate;
END; $$;

CREATE OR REPLACE FUNCTION public.normalize_identity_domain(p_value text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path TO pg_catalog AS $$
DECLARE v text:=lower(trim(coalesce(p_value,'')));
BEGIN
  v:=regexp_replace(v,'^https?://','','i');
  v:=regexp_replace(v,'^www\.','','i');
  v:=split_part(v,'/',1); v:=split_part(v,'?',1); v:=split_part(v,'#',1);
  IF v IN ('','google.com','google.com.br','instagram.com','facebook.com','fb.com','wa.me','whatsapp.com','bit.ly','tinyurl.com','goo.gl','t.co','linktr.ee') THEN RETURN ''; END IF;
  RETURN v;
END; $$;

CREATE OR REPLACE FUNCTION public.normalize_identity_maps(p_value text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO pg_catalog AS $$
  SELECT lower(regexp_replace(trim(coalesce(p_value,'')),'/+$','','g'));
$$;

-- Stage 2 já criou organizations_id; a Etapa 7 torna essa coluna a chave real da identidade.
-- Antes de criar unicidades/validadores, aborta se houver dados legados cruzando tenants.
DO $identity_integrity$
DECLARE v_count bigint;
BEGIN
  SELECT count(*) INTO v_count
    FROM public.leads l
    JOIN public.organizations o ON o.organizations_id=l.organizations_id
   WHERE l.users_id<>o.legacy_scope_users_id;
  IF v_count>0 THEN RAISE EXCEPTION 'stage7_existing_lead_scope_mismatch:%',v_count; END IF;

  SELECT count(*) INTO v_count
    FROM public.leads l
    JOIN public.leads c ON c.leads_id=l.canonical_lead_id
   WHERE l.canonical_lead_id IS NOT NULL AND c.organizations_id<>l.organizations_id;
  IF v_count>0 THEN RAISE EXCEPTION 'stage7_existing_canonical_cross_organization:%',v_count; END IF;

  SELECT count(*) INTO v_count
    FROM public.lead_identity_registry r
    JOIN public.organizations o ON o.organizations_id=r.organizations_id
    JOIN public.leads l ON l.leads_id=r.canonical_lead_id
   WHERE r.users_id<>o.legacy_scope_users_id OR l.organizations_id<>r.organizations_id;
  IF v_count>0 THEN RAISE EXCEPTION 'stage7_existing_registry_scope_mismatch:%',v_count; END IF;

  SELECT count(*) INTO v_count
    FROM public.contact_suppressions s
    JOIN public.organizations o ON o.organizations_id=s.organizations_id
    LEFT JOIN public.leads l ON l.leads_id=s.source_lead_id
    LEFT JOIN public.sents st ON st.sents_id=s.source_sent_id
   WHERE s.users_id<>o.legacy_scope_users_id
      OR (s.source_lead_id IS NOT NULL AND (l.leads_id IS NULL OR l.organizations_id<>s.organizations_id))
      OR (s.source_sent_id IS NOT NULL AND (st.sents_id IS NULL OR st.organizations_id<>s.organizations_id));
  IF v_count>0 THEN RAISE EXCEPTION 'stage7_existing_suppression_scope_mismatch:%',v_count; END IF;
END
$identity_integrity$;

ALTER TABLE public.lead_identity_registry ALTER COLUMN organizations_id SET NOT NULL;
ALTER TABLE public.contact_suppressions ALTER COLUMN organizations_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS lead_identity_registry_org_identity_unique
  ON public.lead_identity_registry(organizations_id,identity_type,identity_value);
CREATE UNIQUE INDEX IF NOT EXISTS contact_suppressions_org_identity_unique
  ON public.contact_suppressions(organizations_id,identity_type,identity_value);
CREATE INDEX IF NOT EXISTS leads_org_identity_phone_idx ON public.leads(organizations_id,leads_normalized_phone) WHERE leads_normalized_phone<>'';
CREATE INDEX IF NOT EXISTS leads_org_identity_instagram_idx ON public.leads(organizations_id,leads_normalized_instagram) WHERE leads_normalized_instagram<>'';
CREATE INDEX IF NOT EXISTS leads_org_identity_domain_idx ON public.leads(organizations_id,leads_normalized_domain) WHERE leads_normalized_domain<>'';
CREATE INDEX IF NOT EXISTS leads_org_identity_maps_idx ON public.leads(organizations_id,leads_normalized_maps) WHERE leads_normalized_maps<>'';
CREATE INDEX IF NOT EXISTS leads_org_canonical_idx ON public.leads(organizations_id,canonical_lead_id) WHERE canonical_lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS contact_suppressions_org_active_idx ON public.contact_suppressions(organizations_id,identity_type,identity_value) WHERE is_active;

-- Um canonical_lead_id jamais pode cruzar organizações.
CREATE OR REPLACE FUNCTION public.validate_lead_canonical_scope()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_scope bigint; v_org bigint;
BEGIN
  IF TG_OP='UPDATE' AND (NEW.organizations_id IS DISTINCT FROM OLD.organizations_id OR NEW.users_id IS DISTINCT FROM OLD.users_id) THEN
    RAISE EXCEPTION 'lead_identity_tenant_immutable';
  END IF;
  SELECT legacy_scope_users_id INTO v_scope FROM public.organizations WHERE organizations_id=NEW.organizations_id;
  IF v_scope IS NULL OR NEW.users_id<>v_scope THEN RAISE EXCEPTION 'lead_identity_scope_mismatch'; END IF;
  IF NEW.canonical_lead_id IS NOT NULL THEN
    SELECT organizations_id INTO v_org FROM public.leads WHERE leads_id=NEW.canonical_lead_id;
    IF v_org IS NULL OR v_org<>NEW.organizations_id THEN RAISE EXCEPTION 'canonical_lead_cross_organization'; END IF;
    IF NEW.leads_id IS NOT NULL AND NEW.canonical_lead_id=NEW.leads_id THEN NEW.canonical_lead_id:=NULL; NEW.duplicate_reason:=NULL; END IF;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS validate_lead_canonical_scope_trigger ON public.leads;
CREATE TRIGGER validate_lead_canonical_scope_trigger
BEFORE INSERT OR UPDATE OF organizations_id,users_id,canonical_lead_id ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.validate_lead_canonical_scope();

CREATE OR REPLACE FUNCTION public.validate_identity_registry_scope()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_scope bigint; v_lead_org bigint;
BEGIN
  SELECT legacy_scope_users_id INTO v_scope FROM public.organizations WHERE organizations_id=NEW.organizations_id;
  IF v_scope IS NULL OR NEW.users_id<>v_scope THEN RAISE EXCEPTION 'identity_registry_scope_mismatch'; END IF;
  SELECT organizations_id INTO v_lead_org FROM public.leads WHERE leads_id=NEW.canonical_lead_id;
  IF v_lead_org IS NULL OR v_lead_org<>NEW.organizations_id THEN RAISE EXCEPTION 'identity_registry_canonical_cross_organization'; END IF;
  NEW.identity_value:=trim(coalesce(NEW.identity_value,''));
  IF NEW.identity_value='' THEN RAISE EXCEPTION 'identity_value_required'; END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS validate_identity_registry_scope_trigger ON public.lead_identity_registry;
CREATE TRIGGER validate_identity_registry_scope_trigger BEFORE INSERT OR UPDATE ON public.lead_identity_registry
FOR EACH ROW EXECUTE FUNCTION public.validate_identity_registry_scope();

CREATE OR REPLACE FUNCTION public.validate_contact_suppression_scope()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_scope bigint; v_org bigint;
BEGIN
  SELECT legacy_scope_users_id INTO v_scope FROM public.organizations WHERE organizations_id=NEW.organizations_id;
  IF v_scope IS NULL OR NEW.users_id<>v_scope THEN RAISE EXCEPTION 'contact_suppression_scope_mismatch'; END IF;
  IF NEW.source_lead_id IS NOT NULL THEN
    SELECT organizations_id INTO v_org FROM public.leads WHERE leads_id=NEW.source_lead_id;
    IF v_org IS NULL OR v_org<>NEW.organizations_id THEN RAISE EXCEPTION 'contact_suppression_lead_cross_organization'; END IF;
  END IF;
  IF NEW.source_sent_id IS NOT NULL THEN
    SELECT organizations_id INTO v_org FROM public.sents WHERE sents_id=NEW.source_sent_id;
    IF v_org IS NULL OR v_org<>NEW.organizations_id THEN RAISE EXCEPTION 'contact_suppression_sent_cross_organization'; END IF;
  END IF;
  NEW.identity_value:=trim(coalesce(NEW.identity_value,''));
  IF NEW.identity_value='' THEN RAISE EXCEPTION 'suppression_identity_required'; END IF;
  NEW.updated_at:=coalesce(NEW.updated_at,now());
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS validate_contact_suppression_scope_trigger ON public.contact_suppressions;
CREATE TRIGGER validate_contact_suppression_scope_trigger BEFORE INSERT OR UPDATE ON public.contact_suppressions
FOR EACH ROW EXECUTE FUNCTION public.validate_contact_suppression_scope();

-- Transições extras legítimas da deduplicação automática.
INSERT INTO public.audit_transition_rules(entity_type,from_status_id,to_status_id,action_key,is_active)
VALUES ('lead',2,7,'mark_duplicate',true),('lead',3,7,'mark_duplicate',true),('lead',6,7,'mark_duplicate',true),('lead',7,1,'duplicate_identity_cleared',true)
ON CONFLICT(entity_type,from_status_id,to_status_id) DO UPDATE SET is_active=true,action_key=excluded.action_key;

CREATE OR REPLACE FUNCTION public.prepare_lead_identity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public,extensions AS $$
DECLARE v_canonical bigint; v_reason text; v_scope bigint;
BEGIN
  SELECT legacy_scope_users_id INTO v_scope FROM public.organizations WHERE organizations_id=NEW.organizations_id;
  IF v_scope IS NULL OR NEW.users_id<>v_scope THEN RAISE EXCEPTION 'lead_identity_scope_mismatch'; END IF;

  NEW.leads_normalized_phone:=public.normalize_identity_phone(NEW.leads_phone);
  NEW.leads_normalized_instagram:=public.normalize_identity_instagram(NEW.leads_instagram);
  NEW.leads_normalized_domain:=public.normalize_identity_domain(NEW.leads_website);
  NEW.leads_normalized_maps:=public.normalize_identity_maps(NEW.leads_maps);
  NEW.leads_identity_hash:=encode(extensions.digest(concat_ws('|',NEW.leads_normalized_phone,NEW.leads_normalized_instagram,NEW.leads_normalized_domain,NEW.leads_normalized_maps),'sha256'),'hex');

  SELECT r.canonical_lead_id,r.identity_type||':'||r.identity_value
    INTO v_canonical,v_reason
    FROM public.lead_identity_registry r
   WHERE r.organizations_id=NEW.organizations_id
     AND r.canonical_lead_id<>coalesce(NEW.leads_id,-1)
     AND ((r.identity_type='phone' AND r.identity_value=NEW.leads_normalized_phone AND NEW.leads_normalized_phone<>'')
       OR (r.identity_type='instagram' AND r.identity_value=NEW.leads_normalized_instagram AND NEW.leads_normalized_instagram<>'')
       OR (r.identity_type='domain' AND r.identity_value=NEW.leads_normalized_domain AND NEW.leads_normalized_domain<>'')
       OR (r.identity_type='maps' AND r.identity_value=NEW.leads_normalized_maps AND NEW.leads_normalized_maps<>''))
   ORDER BY r.first_seen_at,r.canonical_lead_id,r.lead_identity_registry_id LIMIT 1;

  IF v_canonical IS NOT NULL THEN
    NEW.canonical_lead_id:=v_canonical;
    NEW.duplicate_reason:=v_reason;
    IF NEW.lead_status_id IN (1,2,3,6) THEN NEW.lead_status_id:=7; END IF;
  ELSE
    NEW.canonical_lead_id:=NULL;
    NEW.duplicate_reason:=NULL;
    IF TG_OP='UPDATE' THEN
      IF OLD.canonical_lead_id IS NOT NULL AND OLD.lead_status_id=7 AND NEW.lead_status_id=7 THEN
        NEW.lead_status_id:=1;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.register_lead_identity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_canonical bigint:=coalesce(NEW.canonical_lead_id,NEW.leads_id); v_is_new_duplicate boolean:=false; v_previous_canonical bigint;
BEGIN
  IF NEW.leads_normalized_phone<>'' THEN
    INSERT INTO public.lead_identity_registry(users_id,organizations_id,identity_type,identity_value,canonical_lead_id)
    VALUES(NEW.users_id,NEW.organizations_id,'phone',NEW.leads_normalized_phone,v_canonical)
    ON CONFLICT(organizations_id,identity_type,identity_value) DO UPDATE SET last_seen_at=now();
  END IF;
  IF NEW.leads_normalized_instagram<>'' THEN
    INSERT INTO public.lead_identity_registry(users_id,organizations_id,identity_type,identity_value,canonical_lead_id)
    VALUES(NEW.users_id,NEW.organizations_id,'instagram',NEW.leads_normalized_instagram,v_canonical)
    ON CONFLICT(organizations_id,identity_type,identity_value) DO UPDATE SET last_seen_at=now();
  END IF;
  IF NEW.leads_normalized_domain<>'' THEN
    INSERT INTO public.lead_identity_registry(users_id,organizations_id,identity_type,identity_value,canonical_lead_id)
    VALUES(NEW.users_id,NEW.organizations_id,'domain',NEW.leads_normalized_domain,v_canonical)
    ON CONFLICT(organizations_id,identity_type,identity_value) DO UPDATE SET last_seen_at=now();
  END IF;
  IF NEW.leads_normalized_maps<>'' THEN
    INSERT INTO public.lead_identity_registry(users_id,organizations_id,identity_type,identity_value,canonical_lead_id)
    VALUES(NEW.users_id,NEW.organizations_id,'maps',NEW.leads_normalized_maps,v_canonical)
    ON CONFLICT(organizations_id,identity_type,identity_value) DO UPDATE SET last_seen_at=now();
  END IF;

  IF TG_OP='UPDATE' THEN
    v_previous_canonical:=OLD.canonical_lead_id;
    v_is_new_duplicate:=NEW.canonical_lead_id IS NOT NULL
      AND NEW.canonical_lead_id<>NEW.leads_id
      AND v_previous_canonical IS DISTINCT FROM NEW.canonical_lead_id;
  ELSE
    v_is_new_duplicate:=NEW.canonical_lead_id IS NOT NULL AND NEW.canonical_lead_id<>NEW.leads_id;
  END IF;
  IF v_is_new_duplicate THEN
    PERFORM public.append_audit_event('identity','lead_deduplicated','lead',NEW.leads_id::text,NEW.leads_id,NULL,NEW.channels_id,NULL,NEW.lead_status_id,
      'Lead vinculado a identidade canônica',jsonb_build_object('canonical_lead_id',NEW.canonical_lead_id,'duplicate_reason',NEW.duplicate_reason,'organization_id',NEW.organizations_id),NEW.users_id);
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.suppress_lead_identities(p_lead public.leads,p_reason text,p_sent_id bigint DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_count integer:=0;
BEGIN
  INSERT INTO public.contact_suppressions(users_id,organizations_id,identity_type,identity_value,reason,source_lead_id,source_sent_id)
  SELECT p_lead.users_id,p_lead.organizations_id,x.t,x.v,p_reason,p_lead.leads_id,p_sent_id
  FROM (VALUES ('phone',p_lead.leads_normalized_phone),('instagram',p_lead.leads_normalized_instagram),('domain',p_lead.leads_normalized_domain),('maps',p_lead.leads_normalized_maps)) x(t,v)
  WHERE x.v IS NOT NULL AND x.v<>''
  ON CONFLICT(organizations_id,identity_type,identity_value) DO UPDATE SET
    reason=excluded.reason,source_lead_id=excluded.source_lead_id,
    source_sent_id=coalesce(excluded.source_sent_id,public.contact_suppressions.source_sent_id),
    is_active=true,expires_at=NULL,updated_at=now();
  GET DIAGNOSTICS v_count=ROW_COUNT;
  IF v_count>0 THEN
    PERFORM public.append_audit_event('identity','contact_suppressed','lead',p_lead.leads_id::text,p_lead.leads_id,NULL,p_lead.channels_id,p_lead.lead_status_id,p_lead.lead_status_id,
      'Identidades bloqueadas para novo contato',jsonb_build_object('reason',p_reason,'identity_count',v_count,'sent_id',p_sent_id,'organization_id',p_lead.organizations_id),p_lead.users_id);
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.suppress_after_lead_finalized()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
BEGIN
  IF NEW.lead_status_id IN (5,8) THEN
    IF TG_OP='INSERT' THEN
      PERFORM public.suppress_lead_identities(NEW,CASE WHEN NEW.lead_status_id=5 THEN 'lead_sent' ELSE 'lead_archived' END,NULL);
    ELSIF OLD.lead_status_id IS DISTINCT FROM NEW.lead_status_id THEN
      PERFORM public.suppress_lead_identities(NEW,CASE WHEN NEW.lead_status_id=5 THEN 'lead_sent' ELSE 'lead_archived' END,NULL);
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS prepare_lead_identity_trigger ON public.leads;
CREATE TRIGGER prepare_lead_identity_trigger BEFORE INSERT OR UPDATE OF leads_phone,leads_instagram,leads_website,leads_maps ON public.leads FOR EACH ROW EXECUTE FUNCTION public.prepare_lead_identity();
DROP TRIGGER IF EXISTS register_lead_identity_trigger ON public.leads;
CREATE TRIGGER register_lead_identity_trigger AFTER INSERT OR UPDATE OF leads_phone,leads_instagram,leads_website,leads_maps ON public.leads FOR EACH ROW EXECUTE FUNCTION public.register_lead_identity();
DROP TRIGGER IF EXISTS suppress_after_lead_sent_trigger ON public.leads;
DROP TRIGGER IF EXISTS suppress_after_lead_finalized_trigger ON public.leads;
CREATE TRIGGER suppress_after_lead_finalized_trigger AFTER INSERT OR UPDATE OF lead_status_id ON public.leads FOR EACH ROW EXECUTE FUNCTION public.suppress_after_lead_finalized();

-- Reforça o registry com o tenant canônico preservando o canonical já conhecido.
INSERT INTO public.lead_identity_registry(users_id,organizations_id,identity_type,identity_value,canonical_lead_id,first_seen_at,last_seen_at)
SELECT l.users_id,l.organizations_id,x.identity_type,x.identity_value,
       min(coalesce(l.canonical_lead_id,l.leads_id)),min(l.leads_created_at),max(l.leads_updated_at)
FROM public.leads l
CROSS JOIN LATERAL (VALUES
  ('phone'::text,l.leads_normalized_phone),('instagram',l.leads_normalized_instagram),('domain',l.leads_normalized_domain),('maps',l.leads_normalized_maps)
) x(identity_type,identity_value)
WHERE x.identity_value IS NOT NULL AND x.identity_value<>''
GROUP BY l.users_id,l.organizations_id,x.identity_type,x.identity_value
ON CONFLICT(organizations_id,identity_type,identity_value) DO UPDATE SET last_seen_at=greatest(public.lead_identity_registry.last_seen_at,excluded.last_seen_at);

-- Backfill administrativo da migration:
-- a Etapa 6 exige ator autenticado para mudanças operacionais, mas o SQL Editor
-- não possui auth.uid(). Desabilitamos SOMENTE o trigger de auditoria de estado
-- durante este backfill histórico. As validações de tenant/canonical continuam ativas.
-- O ALTER TABLE é transacional: em qualquer erro, o estado anterior é restaurado.
ALTER TABLE public.leads DISABLE TRIGGER audit_lead_state_change_trigger;

-- Corrige leads históricos ainda não marcados quando a identidade canônica já é inequívoca.
WITH matches AS (
  SELECT l.leads_id,r.canonical_lead_id,r.identity_type||':'||r.identity_value reason,
         row_number() OVER(PARTITION BY l.leads_id ORDER BY r.first_seen_at,r.canonical_lead_id,r.lead_identity_registry_id) rn
  FROM public.leads l
  JOIN public.lead_identity_registry r ON r.organizations_id=l.organizations_id AND r.canonical_lead_id<>l.leads_id
   AND ((r.identity_type='phone' AND r.identity_value=l.leads_normalized_phone AND coalesce(l.leads_normalized_phone,'')<>'')
     OR (r.identity_type='instagram' AND r.identity_value=l.leads_normalized_instagram AND coalesce(l.leads_normalized_instagram,'')<>'')
     OR (r.identity_type='domain' AND r.identity_value=l.leads_normalized_domain AND coalesce(l.leads_normalized_domain,'')<>'')
     OR (r.identity_type='maps' AND r.identity_value=l.leads_normalized_maps AND coalesce(l.leads_normalized_maps,'')<>''))
  WHERE l.canonical_lead_id IS NULL
)
UPDATE public.leads l
   SET canonical_lead_id=m.canonical_lead_id,duplicate_reason=m.reason,
       lead_status_id=CASE WHEN l.lead_status_id IN(1,2,3,6) THEN 7 ELSE l.lead_status_id END,
       leads_updated_at=now()
  FROM matches m
 WHERE m.rn=1 AND l.leads_id=m.leads_id;

-- Restaura imediatamente a auditoria operacional obrigatória.
ALTER TABLE public.leads ENABLE TRIGGER audit_lead_state_change_trigger;


-- Status finais antigos também entram na supressão por organização.
WITH candidates AS (
  SELECT l.users_id,l.organizations_id,x.t identity_type,x.v identity_value,l.leads_id source_lead_id,l.leads_updated_at,
         row_number() OVER(PARTITION BY l.organizations_id,x.t,x.v ORDER BY l.leads_updated_at DESC NULLS LAST,l.leads_id DESC) rn
  FROM public.leads l
  CROSS JOIN LATERAL (VALUES ('phone',l.leads_normalized_phone),('instagram',l.leads_normalized_instagram),('domain',l.leads_normalized_domain),('maps',l.leads_normalized_maps)) x(t,v)
  WHERE l.lead_status_id IN(5,8) AND x.v IS NOT NULL AND x.v<>''
)
INSERT INTO public.contact_suppressions(users_id,organizations_id,identity_type,identity_value,reason,source_lead_id)
SELECT users_id,organizations_id,identity_type,identity_value,'historical_final_lead',source_lead_id FROM candidates WHERE rn=1
ON CONFLICT(organizations_id,identity_type,identity_value) DO UPDATE SET
  reason=excluded.reason,source_lead_id=excluded.source_lead_id,is_active=true,expires_at=NULL,updated_at=now();

CREATE OR REPLACE FUNCTION public.check_lead_identity(p_phone text DEFAULT NULL,p_instagram text DEFAULT NULL,p_website text DEFAULT NULL,p_maps text DEFAULT NULL)
RETURNS TABLE(identity_type text,identity_value text,canonical_lead_id bigint,is_suppressed boolean,suppression_reason text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_org bigint;
BEGIN
  v_org:=public.current_organization_id();
  IF v_org IS NULL THEN RAISE EXCEPTION 'organization_context_required'; END IF;
  IF NOT public.has_organization_permission('leads.view') THEN RAISE EXCEPTION 'permission_denied:leads.view'; END IF;
  RETURN QUERY
  WITH input AS (
    SELECT 'phone'::text t,public.normalize_identity_phone(p_phone) v UNION ALL
    SELECT 'instagram',public.normalize_identity_instagram(p_instagram) UNION ALL
    SELECT 'domain',public.normalize_identity_domain(p_website) UNION ALL
    SELECT 'maps',public.normalize_identity_maps(p_maps)
  )
  SELECT i.t,i.v,r.canonical_lead_id,
         coalesce(s.is_active AND (s.expires_at IS NULL OR s.expires_at>now()),false),s.reason
    FROM input i
    LEFT JOIN public.lead_identity_registry r ON r.organizations_id=v_org AND r.identity_type=i.t AND r.identity_value=i.v
    LEFT JOIN public.contact_suppressions s ON s.organizations_id=v_org AND s.identity_type=i.t AND s.identity_value=i.v
   WHERE i.v<>'';
END; $$;

-- RLS canônico por organização. DML continua apenas em funções/serviços.
ALTER TABLE public.lead_identity_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_suppressions ENABLE ROW LEVEL SECURITY;
DO $policies$
DECLARE p record;
BEGIN
  FOR p IN SELECT policyname,tablename FROM pg_policies WHERE schemaname='public' AND tablename IN('lead_identity_registry','contact_suppressions') LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',p.policyname,p.tablename);
  END LOOP;
END
$policies$;
CREATE POLICY lead_identity_registry_org_select ON public.lead_identity_registry FOR SELECT TO authenticated
USING(organizations_id=public.current_organization_id() AND public.has_organization_permission('leads.view'));
CREATE POLICY contact_suppressions_org_select ON public.contact_suppressions FOR SELECT TO authenticated
USING(organizations_id=public.current_organization_id() AND public.has_organization_permission('leads.view'));
REVOKE INSERT,UPDATE,DELETE ON public.lead_identity_registry,public.contact_suppressions FROM anon,authenticated;
GRANT SELECT ON public.lead_identity_registry,public.contact_suppressions TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.lead_identity_registry,public.contact_suppressions TO service_role;
GRANT EXECUTE ON FUNCTION public.check_lead_identity(text,text,text,text) TO authenticated,service_role;

COMMIT;


-- CONTINUAÇÃO ETAPAS 8–15
-- Cada etapa possui sua própria transação. Em caso de falha, pare e corrija antes de continuar.

-- ======================================================================
-- ETAPA 8
-- ======================================================================
BEGIN;

-- ETAPA 8 — Vinsansi Captura oficial.
-- Remove a ponte Google Maps legada, centraliza pairing/configuracao e garante
-- gate de identidade/supressao antes da promocao de candidatos para leads.

DO $stage_preflight$
DECLARE v_missing text[]:=ARRAY[]::text[]; v_name text;
BEGIN
  FOREACH v_name IN ARRAY ARRAY['lead_identity_registry','contact_suppressions'] LOOP IF to_regclass('public.'||v_name) IS NULL THEN v_missing:=array_append(v_missing,'table:'||v_name);END IF;END LOOP;
  FOREACH v_name IN ARRAY ARRAY['check_lead_identity'] LOOP IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=v_name) THEN v_missing:=array_append(v_missing,'function:'||v_name);END IF;END LOOP;
  IF cardinality(v_missing)>0 THEN RAISE EXCEPTION 'stage_preflight_failed:%',array_to_string(v_missing,',');END IF;
END
$stage_preflight$;

CREATE TABLE IF NOT EXISTS public.tool_browser_pairings (
  tool_browser_pairings_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_id text NOT NULL REFERENCES public.platform_tools(tool_id) ON DELETE RESTRICT,
  external_installation_id text NOT NULL CHECK(length(trim(external_installation_id)) BETWEEN 1 AND 200),
  pairing_secret_hash text NOT NULL CHECK(length(pairing_secret_hash)=64),
  requested_version text,
  requested_capabilities text[] NOT NULL DEFAULT '{}',
  requested_metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(requested_metadata)='object'),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','authorized','consumed','expired','revoked')),
  organizations_id bigint REFERENCES public.organizations(organizations_id) ON DELETE RESTRICT,
  auth_users_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  users_id bigint REFERENCES public.users(users_id) ON DELETE SET NULL,
  organization_members_id bigint REFERENCES public.organization_members(organization_members_id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  authorized_at timestamptz,
  consumed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tool_browser_pairings_version_semver CHECK(public.tool_semver_is_valid(requested_version))
);
CREATE INDEX IF NOT EXISTS tool_browser_pairings_pending_idx ON public.tool_browser_pairings(status,expires_at);
CREATE INDEX IF NOT EXISTS tool_browser_pairings_org_idx ON public.tool_browser_pairings(organizations_id,tool_id,created_at DESC);
ALTER TABLE public.tool_browser_pairings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tool_browser_pairings FROM anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.tool_browser_pairings TO service_role;

DROP TRIGGER IF EXISTS tool_touch_updated_at ON public.tool_browser_pairings;
CREATE TRIGGER tool_touch_updated_at BEFORE UPDATE ON public.tool_browser_pairings
FOR EACH ROW EXECUTE FUNCTION public.tool_touch_updated_at();

-- Contrato oficial da Captura 1.0.0. O antigo 0.x deixa de ser suportado para
-- evitar que uma extensao ainda dependente das tabelas maps_extension_* continue operando.
UPDATE public.platform_tools
SET display_name='Vinsansi Captura',
    description='Executor oficial de aquisicao Google Maps com execucoes persistentes, checkpoint, identidade canonica, supressao e importacao incremental.',
    latest_version='1.0.0', minimum_supported_version='1.0.0', settings_schema_version=2,
    capability_catalog=ARRAY['settings.read','presence.heartbeat','activity.report','organization.context','member.context','capture.maps','capture.website_review','capture.multi_activity','capture.batch_ingestion','capture.checkpoint','capture.diagnostics','capture.incremental_import'],
    settings_schema='{"type":"object","required":["minRating","minReviews","safeMode","instagramLowRating","branchRules","deduplication","routes","logs","checkpoint","diagnostics"]}'::jsonb,
    default_settings=(default_settings || jsonb_build_object(
      'checkpoint',jsonb_build_object('enabled',true,'intervalSeconds',20,'resumeOnRestart',true),
      'diagnostics',jsonb_build_object('heartbeatSeconds',60,'persistDomErrors',true,'maxRecentErrors',50),
      'sourcePolicy',jsonb_build_object('incrementalImport',true,'csvIsBackupOnly',true,'rejectSuppressed',true,'rejectDuplicates',true)
    )),
    updated_at=now()
WHERE tool_id='vinsansi_capture';

UPDATE public.organization_tool_settings s
SET settings=s.settings || jsonb_build_object(
      'checkpoint',coalesce(s.settings->'checkpoint',jsonb_build_object('enabled',true,'intervalSeconds',20,'resumeOnRestart',true)),
      'diagnostics',coalesce(s.settings->'diagnostics',jsonb_build_object('heartbeatSeconds',60,'persistDomErrors',true,'maxRecentErrors',50)),
      'sourcePolicy',coalesce(s.settings->'sourcePolicy',jsonb_build_object('incrementalImport',true,'csvIsBackupOnly',true,'rejectSuppressed',true,'rejectDuplicates',true))
    ), settings_schema_version=2, settings_version=settings_version+1, updated_at=now()
WHERE tool_id='vinsansi_capture';

-- Tabelas de execucao ja existem na base operacional. Garantimos as colunas que
-- materializam o contrato oficial da Captura e a propriedade da organizacao.
DO $capture_tables$
DECLARE t text; v_nulls bigint;
BEGIN
  FOREACH t IN ARRAY ARRAY['maps_search_executions','maps_search_coverage','maps_search_candidates','maps_search_snapshots'] LOOP
    IF to_regclass('public.'||t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS organizations_id bigint',t);
      IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=t AND column_name='users_id') THEN
        EXECUTE format('UPDATE public.%I x SET organizations_id=o.organizations_id FROM public.organizations o WHERE x.organizations_id IS NULL AND o.legacy_scope_users_id=x.users_id',t);
      END IF;
      EXECUTE format('SELECT count(*) FROM public.%I WHERE organizations_id IS NULL',t) INTO v_nulls;
      IF v_nulls>0 THEN RAISE EXCEPTION 'capture_organization_backfill_incomplete:%:%',t,v_nulls; END IF;
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN organizations_id SET NOT NULL',t);
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I(organizations_id)',left(t||'_org_idx',63),t);
    END IF;
  END LOOP;
END
$capture_tables$;

DO $capture_columns$
BEGIN
 IF to_regclass('public.maps_search_executions') IS NOT NULL THEN
   ALTER TABLE public.maps_search_executions
     ADD COLUMN IF NOT EXISTS source_installation_id uuid REFERENCES public.organization_tool_installations(organization_tool_installations_id) ON DELETE SET NULL,
     ADD COLUMN IF NOT EXISTS initiated_by_member_id bigint REFERENCES public.organization_members(organization_members_id) ON DELETE SET NULL,
     ADD COLUMN IF NOT EXISTS processed_count integer NOT NULL DEFAULT 0,
     ADD COLUMN IF NOT EXISTS accepted_count integer NOT NULL DEFAULT 0,
     ADD COLUMN IF NOT EXISTS suppressed_count integer NOT NULL DEFAULT 0,
     ADD COLUMN IF NOT EXISTS error_count integer NOT NULL DEFAULT 0,
     ADD COLUMN IF NOT EXISTS last_checkpoint_at timestamptz,
     ADD COLUMN IF NOT EXISTS diagnostic_status text NOT NULL DEFAULT 'ok' CHECK(diagnostic_status IN ('ok','degraded','error')),
     ADD COLUMN IF NOT EXISTS last_diagnostic jsonb NOT NULL DEFAULT '{}'::jsonb;
   CREATE INDEX IF NOT EXISTS maps_search_executions_org_status_idx ON public.maps_search_executions(organizations_id,status,created_at DESC);
 END IF;
 IF to_regclass('public.maps_search_candidates') IS NOT NULL THEN
   ALTER TABLE public.maps_search_candidates
     ADD COLUMN IF NOT EXISTS data_provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
     ADD COLUMN IF NOT EXISTS identity_decision text,
     ADD COLUMN IF NOT EXISTS suppression_match boolean NOT NULL DEFAULT false,
     ADD COLUMN IF NOT EXISTS dedup_match_leads_id bigint REFERENCES public.leads(leads_id) ON DELETE SET NULL;
 END IF;
END
$capture_columns$;

-- Gate canonico de Captura. Nao confia na extensao para decidir se um contato
-- pode ser importado; a decisao e refeita no servidor pelo tenant.
CREATE OR REPLACE FUNCTION public.service_capture_identity_gate(
  p_organizations_id bigint,
  p_phone text DEFAULT NULL,
  p_instagram text DEFAULT NULL,
  p_domain text DEFAULT NULL,
  p_maps text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO pg_catalog,public AS $$
DECLARE
  v_phone text:=public.normalize_identity_phone(p_phone);
  v_instagram text:=public.normalize_identity_instagram(p_instagram);
  v_domain text:=public.normalize_identity_domain(p_domain);
  v_maps text:=public.normalize_identity_maps(p_maps);
  v_suppression bigint; v_lead bigint; v_type text; v_value text;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.organizations WHERE organizations_id=p_organizations_id AND status_id=1) THEN RAISE EXCEPTION 'organization_not_found'; END IF;

  SELECT cs.contact_suppressions_id,cs.identity_type,cs.identity_value
    INTO v_suppression,v_type,v_value
  FROM public.contact_suppressions cs
  WHERE cs.organizations_id=p_organizations_id AND cs.is_active
    AND (cs.expires_at IS NULL OR cs.expires_at>now())
    AND ((v_phone<>'' AND cs.identity_type='phone' AND cs.identity_value=v_phone)
      OR (v_instagram<>'' AND cs.identity_type='instagram' AND cs.identity_value=v_instagram)
      OR (v_domain<>'' AND cs.identity_type='domain' AND cs.identity_value=v_domain)
      OR (v_maps<>'' AND cs.identity_type='maps' AND cs.identity_value=v_maps))
  ORDER BY cs.contact_suppressions_id LIMIT 1;
  IF v_suppression IS NOT NULL THEN
    RETURN jsonb_build_object('decision','suppressed','suppressed',true,'duplicate',false,'suppressionId',v_suppression,'identityType',v_type,'identityValue',v_value);
  END IF;

  SELECT r.canonical_lead_id,r.identity_type,r.identity_value
    INTO v_lead,v_type,v_value
  FROM public.lead_identity_registry r
  WHERE r.organizations_id=p_organizations_id
    AND ((v_phone<>'' AND r.identity_type='phone' AND r.identity_value=v_phone)
      OR (v_instagram<>'' AND r.identity_type='instagram' AND r.identity_value=v_instagram)
      OR (v_domain<>'' AND r.identity_type='domain' AND r.identity_value=v_domain)
      OR (v_maps<>'' AND r.identity_type='maps' AND r.identity_value=v_maps))
  ORDER BY r.lead_identity_registry_id LIMIT 1;
  IF v_lead IS NOT NULL THEN
    RETURN jsonb_build_object('decision','duplicate','suppressed',false,'duplicate',true,'canonicalLeadId',v_lead,'identityType',v_type,'identityValue',v_value);
  END IF;
  RETURN jsonb_build_object('decision','accept','suppressed',false,'duplicate',false);
END; $$;
REVOKE ALL ON FUNCTION public.service_capture_identity_gate(bigint,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.service_capture_identity_gate(bigint,text,text,text,text) TO service_role;

-- Checkpoint/diagnostico persistente de uma execucao, usado pelo executor local.
CREATE TABLE IF NOT EXISTS public.capture_execution_events (
  capture_execution_events_id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  organizations_id bigint NOT NULL REFERENCES public.organizations(organizations_id) ON DELETE RESTRICT,
  maps_search_executions_id uuid NOT NULL,
  organization_tool_installations_id uuid REFERENCES public.organization_tool_installations(organization_tool_installations_id) ON DELETE SET NULL,
  organization_members_id bigint REFERENCES public.organization_members(organization_members_id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK(event_type IN ('started','checkpoint','paused','resumed','completed','failed','diagnostic','imported','rejected','duplicate','suppressed')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS capture_execution_events_exec_idx ON public.capture_execution_events(organizations_id,maps_search_executions_id,created_at DESC);
ALTER TABLE public.capture_execution_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS capture_execution_events_org_select ON public.capture_execution_events;
CREATE POLICY capture_execution_events_org_select ON public.capture_execution_events FOR SELECT TO authenticated
USING(organizations_id=public.current_organization_id() AND public.has_organization_permission('capture.use'));
REVOKE INSERT,UPDATE,DELETE ON public.capture_execution_events FROM anon,authenticated;
GRANT SELECT ON public.capture_execution_events TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.capture_execution_events TO service_role;

-- Migra metadata de instalacoes antigas para a instalacao canonica antes de remover a ponte.
DO $maps_legacy_migrate$
DECLARE r record; v_org bigint;
BEGIN
 IF to_regclass('public.maps_extension_installations') IS NOT NULL THEN
   FOR r IN EXECUTE 'SELECT to_jsonb(x) j FROM public.maps_extension_installations x' LOOP
     v_org:=NULLIF(r.j->>'organizations_id','')::bigint;
     IF v_org IS NULL THEN SELECT organizations_id INTO v_org FROM public.organizations WHERE legacy_scope_users_id=NULLIF(r.j->>'users_id','')::bigint LIMIT 1; END IF;
     IF v_org IS NULL OR nullif(r.j->>'installation_id','') IS NULL THEN CONTINUE; END IF;
     INSERT INTO public.organization_tools(organizations_id,tool_id,enabled) VALUES(v_org,'vinsansi_capture',true) ON CONFLICT(organizations_id,tool_id) DO NOTHING;
     INSERT INTO public.organization_tool_installations(organizations_id,tool_id,external_installation_id,registration_status,installed_version,reported_capabilities,last_seen_at,metadata)
     VALUES(v_org,'vinsansi_capture',r.j->>'installation_id',CASE WHEN lower(coalesce(r.j->>'status','active'))='revoked' THEN 'revoked' ELSE 'registered' END,NULL,ARRAY['capture.maps'],NULLIF(r.j->>'last_seen_at','')::timestamptz,jsonb_build_object('migratedFrom','maps_extension_installations','migratedAt',now()))
     ON CONFLICT(organizations_id,tool_id,external_installation_id) DO UPDATE SET
       last_seen_at=coalesce(excluded.last_seen_at,organization_tool_installations.last_seen_at),
       metadata=organization_tool_installations.metadata||excluded.metadata;
   END LOOP;
 END IF;
END
$maps_legacy_migrate$;

DROP TABLE IF EXISTS public.maps_extension_pairings CASCADE;
DROP TABLE IF EXISTS public.maps_extension_installations CASCADE;

-- RLS explicita para tabelas da Captura agora que o tenant e canonico.
DO $capture_rls$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['maps_search_executions','maps_search_coverage','maps_search_candidates','maps_search_snapshots'] LOOP
   IF to_regclass('public.'||t) IS NOT NULL THEN
     EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
     EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',left(t||'_org_select',63),t);
     EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (organizations_id=public.current_organization_id() AND public.has_organization_permission(''capture.use''))',left(t||'_org_select',63),t);
   END IF;
 END LOOP;
END
$capture_rls$;

-- Auditoria de migration não é emitida sem ator; a própria migration é a fonte canônica de versão.

COMMIT;

-- ======================================================================
-- ETAPA 9
-- ======================================================================
BEGIN;

-- ETAPA 9 — Vinsansi Instagram executor oficial.

DO $stage_preflight$
DECLARE v_missing text[]:=ARRAY[]::text[]; v_name text;
BEGIN
  FOREACH v_name IN ARRAY ARRAY['tool_browser_pairings','instagram_queue_progress','organization_tool_installations'] LOOP IF to_regclass('public.'||v_name) IS NULL THEN v_missing:=array_append(v_missing,'table:'||v_name);END IF;END LOOP;
  IF cardinality(v_missing)>0 THEN RAISE EXCEPTION 'stage_preflight_failed:%',array_to_string(v_missing,',');END IF;
END
$stage_preflight$;

UPDATE public.platform_tools
SET display_name='Vinsansi Instagram',
    description='Executor oficial outbound Instagram com fila canonica, claim transacional, progresso por etapa, idempotencia, limites e recuperacao segura.',
    latest_version='2.0.2',minimum_supported_version='2.0.0',settings_schema_version=2,
    capability_catalog=ARRAY['settings.read','presence.heartbeat','activity.report','organization.context','member.context','instagram.queue.execute','instagram.dm.send','instagram.media.send','instagram.result.report','instagram.checkpoint','instagram.profile.bound'],
    settings_schema='{"type":"object","required":["instagram"]}'::jsonb,
    updated_at=now()
WHERE tool_id='vinsansi_instagram';
UPDATE public.organization_tool_settings SET settings_schema_version=2,settings_version=settings_version+1,updated_at=now() WHERE tool_id='vinsansi_instagram';

ALTER TABLE public.instagram_queue_progress
  ADD COLUMN IF NOT EXISTS organizations_id bigint,
  ADD COLUMN IF NOT EXISTS organization_tool_installations_id uuid REFERENCES public.organization_tool_installations(organization_tool_installations_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS dispatched_by_member_id bigint REFERENCES public.organization_members(organization_members_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS profile_username text,
  ADD COLUMN IF NOT EXISTS frozen_payload_hash text,
  ADD COLUMN IF NOT EXISTS canonical_step text;
ALTER TABLE public.instagram_queue_progress DROP CONSTRAINT IF EXISTS instagram_queue_progress_step_check;
ALTER TABLE public.instagram_queue_progress ADD CONSTRAINT instagram_queue_progress_step_check CHECK(step IN ('queued','claimed','profile_opened','opening_profile','following','followed','dm_opened','opening_dm','messages_sending','media_sending','sending','sent','completed','invalid','error','reconciliation_required'));

ALTER TABLE public.instagram_dispatch_events
  ADD COLUMN IF NOT EXISTS organizations_id bigint,
  ADD COLUMN IF NOT EXISTS organization_tool_installations_id uuid REFERENCES public.organization_tool_installations(organization_tool_installations_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS organization_members_id bigint REFERENCES public.organization_members(organization_members_id) ON DELETE SET NULL;

UPDATE public.instagram_queue_progress p SET organizations_id=qi.organizations_id FROM public.queue_items qi WHERE p.organizations_id IS NULL AND qi.queue_items_id=p.queue_items_id;
UPDATE public.instagram_dispatch_events e SET organizations_id=qi.organizations_id FROM public.queue_items qi WHERE e.organizations_id IS NULL AND qi.queue_items_id=e.queue_items_id;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.instagram_queue_progress WHERE organizations_id IS NULL) THEN RAISE EXCEPTION 'instagram_progress_organization_backfill_incomplete'; END IF;
 IF EXISTS(SELECT 1 FROM public.instagram_dispatch_events WHERE organizations_id IS NULL) THEN RAISE EXCEPTION 'instagram_events_organization_backfill_incomplete'; END IF;
END $$;
ALTER TABLE public.instagram_queue_progress ALTER COLUMN organizations_id SET NOT NULL;
ALTER TABLE public.instagram_dispatch_events ALTER COLUMN organizations_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS instagram_progress_org_profile_idx ON public.instagram_queue_progress(organizations_id,profile_username,step,instagram_queue_progress_updated_at DESC);
CREATE INDEX IF NOT EXISTS instagram_events_org_item_idx ON public.instagram_dispatch_events(organizations_id,queue_items_id,created_at DESC);

-- Alias canônico de etapas, preservando leitura de releases anteriores.
UPDATE public.instagram_queue_progress SET canonical_step=CASE step
 WHEN 'profile_opened' THEN 'opening_profile' WHEN 'dm_opened' THEN 'opening_dm'
 WHEN 'messages_sending' THEN 'sending' WHEN 'media_sending' THEN 'sending'
 WHEN 'sent' THEN 'completed' WHEN 'invalid' THEN 'error' ELSE step END
WHERE canonical_step IS NULL;

CREATE OR REPLACE FUNCTION public.instagram_canonical_step(p_step text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE lower(trim(coalesce(p_step,'')))
  WHEN 'profile_opened' THEN 'opening_profile' WHEN 'opening_profile' THEN 'opening_profile'
  WHEN 'dm_opened' THEN 'opening_dm' WHEN 'opening_dm' THEN 'opening_dm'
  WHEN 'messages_sending' THEN 'sending' WHEN 'media_sending' THEN 'sending' WHEN 'sending' THEN 'sending'
  WHEN 'sent' THEN 'completed' WHEN 'completed' THEN 'completed'
  WHEN 'invalid' THEN 'error' ELSE lower(trim(coalesce(p_step,''))) END;
$$;

-- Estado diario por perfil: limites nao se misturam entre contas.
CREATE TABLE IF NOT EXISTS public.instagram_profile_runtime (
 instagram_profile_runtime_id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
 organizations_id bigint NOT NULL REFERENCES public.organizations(organizations_id) ON DELETE RESTRICT,
 socials_id bigint NOT NULL REFERENCES public.socials(socials_id) ON DELETE CASCADE,
 organization_tool_installations_id uuid REFERENCES public.organization_tool_installations(organization_tool_installations_id) ON DELETE SET NULL,
 profile_username text NOT NULL,
 operational_date date NOT NULL,
 claimed_count integer NOT NULL DEFAULT 0 CHECK(claimed_count>=0),
 sent_count integer NOT NULL DEFAULT 0 CHECK(sent_count>=0),
 invalid_count integer NOT NULL DEFAULT 0 CHECK(invalid_count>=0),
 error_count integer NOT NULL DEFAULT 0 CHECK(error_count>=0),
 last_claim_at timestamptz,last_send_at timestamptz,last_heartbeat_at timestamptz,
 runtime_status text NOT NULL DEFAULT 'online' CHECK(runtime_status IN ('online','paused','offline','error','limit_reached')),
 metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organizations_id,socials_id,operational_date)
);
CREATE INDEX IF NOT EXISTS instagram_profile_runtime_health_idx ON public.instagram_profile_runtime(organizations_id,operational_date,last_heartbeat_at DESC);
ALTER TABLE public.instagram_profile_runtime ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS instagram_profile_runtime_org_select ON public.instagram_profile_runtime;
CREATE POLICY instagram_profile_runtime_org_select ON public.instagram_profile_runtime FOR SELECT TO authenticated USING(organizations_id=public.current_organization_id() AND public.has_organization_permission('instagram.view'));
REVOKE INSERT,UPDATE,DELETE ON public.instagram_profile_runtime FROM anon,authenticated;
GRANT SELECT ON public.instagram_profile_runtime TO authenticated;
GRANT ALL ON public.instagram_profile_runtime TO service_role;

CREATE OR REPLACE FUNCTION public.instagram_profile_capacity(
 p_organizations_id bigint,p_socials_id bigint,p_now timestamptz DEFAULT now()
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO pg_catalog,public AS $$
DECLARE v_settings jsonb;v_cfg jsonb;v_limit integer;v_sent integer;v_profile text;v_date date;v_timezone text:='America/Sao_Paulo';v_start time;v_end time;v_local timestamp;v_day text;v_days jsonb;
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
 SELECT s.socials_username INTO v_profile FROM public.socials s WHERE s.socials_id=p_socials_id AND s.organizations_id=p_organizations_id AND s.status_id=1;
 IF v_profile IS NULL THEN RAISE EXCEPTION 'instagram_profile_not_available'; END IF;
 SELECT coalesce(ots.settings,pt.default_settings) INTO v_settings FROM public.platform_tools pt LEFT JOIN public.organization_tool_settings ots ON ots.organizations_id=p_organizations_id AND ots.tool_id=pt.tool_id WHERE pt.tool_id='vinsansi_instagram';
 v_cfg:=coalesce(v_settings->'instagram','{}'::jsonb);v_limit:=greatest(0,coalesce((v_cfg->>'dailyLimit')::integer,60));v_start:=coalesce(nullif(v_cfg->>'startTime','')::time,'00:00'::time);v_end:=coalesce(nullif(v_cfg->>'endTime','')::time,'23:59:59'::time);v_days:=coalesce(v_cfg->'activeDays','[]'::jsonb);
 v_local:=p_now AT TIME ZONE v_timezone;v_date:=v_local::date;v_day:=CASE extract(isodow from v_local)::int WHEN 1 THEN 'Segunda' WHEN 2 THEN 'Terca' WHEN 3 THEN 'Quarta' WHEN 4 THEN 'Quinta' WHEN 5 THEN 'Sexta' WHEN 6 THEN 'Sabado' ELSE 'Domingo' END;
 SELECT coalesce(r.sent_count,0) INTO v_sent FROM public.instagram_profile_runtime r WHERE r.organizations_id=p_organizations_id AND r.socials_id=p_socials_id AND r.operational_date=v_date;
 RETURN jsonb_build_object('allowed',coalesce(v_days?'Todos',false) OR coalesce(v_days?v_day,false),'withinWindow',v_local::time BETWEEN v_start AND v_end,'dailyLimit',v_limit,'sentToday',coalesce(v_sent,0),'remaining',greatest(v_limit-coalesce(v_sent,0),0),'profile',v_profile,'operationalDate',v_date);
END; $$;
REVOKE ALL ON FUNCTION public.instagram_profile_capacity(bigint,bigint,timestamptz) FROM PUBLIC,anon,authenticated;GRANT EXECUTE ON FUNCTION public.instagram_profile_capacity(bigint,bigint,timestamptz) TO service_role;

-- Claim tenant-aware e vinculado à instalação/perfil.
CREATE OR REPLACE FUNCTION public.instagram_claim_queue_item_v2(
 p_organizations_id bigint,p_queue_item_id bigint,p_socials_id bigint,p_consumer_id text,p_installation_id uuid,p_member_id bigint
) RETURNS TABLE(queue_items_id bigint,claim_token uuid,step text,attempts integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_item public.queue_items%ROWTYPE;v_existing public.instagram_queue_progress%ROWTYPE;v_token uuid:=gen_random_uuid();v_attempts integer;v_users bigint;v_profile text;v_capacity jsonb;
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
 IF nullif(trim(coalesce(p_consumer_id,'')),'') IS NULL THEN RAISE EXCEPTION 'consumer_id_required'; END IF;
 SELECT * INTO v_item FROM public.queue_items qi WHERE qi.queue_items_id=p_queue_item_id AND qi.organizations_id=p_organizations_id AND qi.socials_id=p_socials_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'instagram_queue_item_not_found'; END IF;v_users:=v_item.users_id;
 IF NOT EXISTS(SELECT 1 FROM public.organization_tool_installations i WHERE i.organization_tool_installations_id=p_installation_id AND i.organizations_id=p_organizations_id AND i.tool_id='vinsansi_instagram' AND i.registration_status='registered') THEN RAISE EXCEPTION 'instagram_installation_invalid'; END IF;
 IF p_member_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.organization_members m WHERE m.organization_members_id=p_member_id AND m.organizations_id=p_organizations_id AND m.status_id=1) THEN RAISE EXCEPTION 'instagram_member_invalid'; END IF;
 SELECT socials_username INTO v_profile FROM public.socials WHERE socials_id=p_socials_id AND organizations_id=p_organizations_id AND status_id=1;IF v_profile IS NULL THEN RAISE EXCEPTION 'instagram_profile_not_available'; END IF;
 v_capacity:=public.instagram_profile_capacity(p_organizations_id,p_socials_id,now());IF coalesce((v_capacity->>'allowed')::boolean,false)=false OR coalesce((v_capacity->>'withinWindow')::boolean,false)=false THEN RAISE EXCEPTION 'instagram_outside_operational_window'; END IF;IF coalesce((v_capacity->>'remaining')::integer,0)<=0 THEN RAISE EXCEPTION 'instagram_daily_limit_reached'; END IF;
 SELECT * INTO v_existing FROM public.instagram_queue_progress p WHERE p.queue_items_id=p_queue_item_id FOR UPDATE;
 IF FOUND AND public.instagram_canonical_step(v_existing.step) IN ('completed','reconciliation_required') THEN RAISE EXCEPTION 'instagram_item_not_claimable:%',v_existing.step; END IF;
 IF v_item.status_id NOT IN(3,6) THEN RAISE EXCEPTION 'instagram_item_not_pending:%',v_item.status_id; END IF;
 v_attempts:=coalesce(v_existing.attempts,0)+1;
 INSERT INTO public.instagram_queue_progress(users_id,organizations_id,queue_items_id,socials_id,step,canonical_step,claim_token,claimed_by,attempts,last_heartbeat_at,started_at,finished_at,error_message,metadata,organization_tool_installations_id,dispatched_by_member_id,profile_username,frozen_payload_hash)
 VALUES(v_users,p_organizations_id,p_queue_item_id,p_socials_id,'claimed','claimed',v_token,trim(p_consumer_id),v_attempts,now(),coalesce(v_existing.started_at,now()),NULL,NULL,'{}',p_installation_id,p_member_id,v_profile,v_item.queue_items_payload_hash)
 ON CONFLICT(queue_items_id) DO UPDATE SET organizations_id=excluded.organizations_id,socials_id=excluded.socials_id,step='claimed',canonical_step='claimed',claim_token=excluded.claim_token,claimed_by=excluded.claimed_by,attempts=excluded.attempts,last_heartbeat_at=now(),started_at=coalesce(public.instagram_queue_progress.started_at,now()),finished_at=NULL,error_message=NULL,organization_tool_installations_id=excluded.organization_tool_installations_id,dispatched_by_member_id=excluded.dispatched_by_member_id,profile_username=excluded.profile_username,frozen_payload_hash=excluded.frozen_payload_hash,instagram_queue_progress_updated_at=now()
 RETURNING public.instagram_queue_progress.claim_token,public.instagram_queue_progress.attempts INTO v_token,v_attempts;
 UPDATE public.queue_items SET status_id=4,dispatched_by_member_id=coalesce(dispatched_by_member_id,p_member_id),queue_items_started_at=coalesce(queue_items_started_at,now()),queue_items_finished_at=NULL,queue_items_error_message=NULL,queue_items_updated_at=now() WHERE public.queue_items.queue_items_id=p_queue_item_id;
 INSERT INTO public.instagram_profile_runtime(organizations_id,socials_id,organization_tool_installations_id,profile_username,operational_date,claimed_count,last_claim_at,last_heartbeat_at) VALUES(p_organizations_id,p_socials_id,p_installation_id,v_profile,(now() AT TIME ZONE 'America/Sao_Paulo')::date,1,now(),now()) ON CONFLICT(organizations_id,socials_id,operational_date) DO UPDATE SET claimed_count=public.instagram_profile_runtime.claimed_count+1,last_claim_at=now(),last_heartbeat_at=now(),organization_tool_installations_id=excluded.organization_tool_installations_id,updated_at=now();
 INSERT INTO public.instagram_dispatch_events(users_id,organizations_id,queue_items_id,socials_id,from_step,to_step,claim_token,actor,metadata,organization_tool_installations_id,organization_members_id) VALUES(v_users,p_organizations_id,p_queue_item_id,p_socials_id,coalesce(v_existing.step,'queued'),'claimed',v_token,p_consumer_id,jsonb_build_object('attempt',v_attempts,'profile',v_profile),p_installation_id,p_member_id);
 RETURN QUERY SELECT p_queue_item_id,v_token,'claimed'::text,v_attempts;
END; $$;

CREATE OR REPLACE FUNCTION public.instagram_update_queue_progress_v2(
 p_organizations_id bigint,p_queue_item_id bigint,p_claim_token uuid,p_step text,p_message text DEFAULT NULL,p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS TABLE(queue_items_id bigint,step text,queue_status_id bigint,lead_status_id bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_progress public.instagram_queue_progress%ROWTYPE;v_item public.queue_items%ROWTYPE;v_canonical text:=public.instagram_canonical_step(p_step);v_queue bigint:=4;v_lead bigint;v_final boolean:=false;v_previous text;
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
 IF NOT v_canonical=ANY(ARRAY['claimed','opening_profile','following','followed','opening_dm','sending','completed','error','reconciliation_required']) THEN RAISE EXCEPTION 'instagram_step_invalid:%',p_step; END IF;
 SELECT * INTO v_progress FROM public.instagram_queue_progress WHERE queue_items_id=p_queue_item_id AND organizations_id=p_organizations_id FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'instagram_progress_not_found';END IF;IF v_progress.claim_token IS DISTINCT FROM p_claim_token THEN RAISE EXCEPTION 'instagram_claim_token_invalid';END IF;v_previous:=v_progress.step;
 IF public.instagram_canonical_step(v_progress.step) IN('completed','reconciliation_required') AND public.instagram_canonical_step(v_progress.step)<>v_canonical THEN RAISE EXCEPTION 'instagram_progress_final:%',v_progress.step; END IF;
 SELECT * INTO v_item FROM public.queue_items WHERE queue_items_id=p_queue_item_id AND organizations_id=p_organizations_id FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'instagram_queue_item_not_found';END IF;
 IF v_canonical='completed' THEN v_queue:=5;v_lead:=5;v_final:=true;ELSIF v_canonical='error' THEN v_queue:=6;v_lead:=CASE WHEN p_step='invalid' THEN 6 ELSE NULL END;v_final:=true;ELSIF v_canonical='reconciliation_required' THEN v_queue:=6;v_final:=true;END IF;
 UPDATE public.instagram_queue_progress SET step=p_step,canonical_step=v_canonical,last_heartbeat_at=now(),finished_at=CASE WHEN v_final THEN now() ELSE NULL END,error_message=CASE WHEN v_canonical IN('error','reconciliation_required') THEN nullif(trim(coalesce(p_message,'')),'') ELSE NULL END,metadata=coalesce(metadata,'{}')||coalesce(p_metadata,'{}'),instagram_queue_progress_updated_at=now() WHERE instagram_queue_progress_id=v_progress.instagram_queue_progress_id;
 UPDATE public.queue_items SET status_id=v_queue,queue_items_updated_at=now(),queue_items_finished_at=CASE WHEN v_final THEN now() ELSE NULL END,queue_items_error_message=CASE WHEN v_canonical IN('error','reconciliation_required') THEN nullif(trim(coalesce(p_message,'')),'') ELSE NULL END WHERE public.queue_items.queue_items_id=p_queue_item_id;
 IF v_lead IS NOT NULL THEN UPDATE public.leads SET lead_status_id=v_lead,leads_updated_at=now() WHERE leads_id=v_item.leads_id AND organizations_id=p_organizations_id AND lead_status_id=4; END IF;
 INSERT INTO public.instagram_dispatch_events(users_id,organizations_id,queue_items_id,socials_id,from_step,to_step,claim_token,actor,message,metadata,organization_tool_installations_id,organization_members_id) VALUES(v_item.users_id,p_organizations_id,p_queue_item_id,v_progress.socials_id,v_previous,p_step,p_claim_token,v_progress.claimed_by,p_message,coalesce(p_metadata,'{}'),v_progress.organization_tool_installations_id,v_progress.dispatched_by_member_id);
 IF v_final THEN INSERT INTO public.instagram_profile_runtime(organizations_id,socials_id,organization_tool_installations_id,profile_username,operational_date,sent_count,invalid_count,error_count,last_send_at,last_heartbeat_at) VALUES(p_organizations_id,v_progress.socials_id,v_progress.organization_tool_installations_id,coalesce(v_progress.profile_username,''),(now() AT TIME ZONE 'America/Sao_Paulo')::date,CASE WHEN v_canonical='completed' THEN 1 ELSE 0 END,CASE WHEN p_step='invalid' THEN 1 ELSE 0 END,CASE WHEN v_canonical IN('error','reconciliation_required') AND p_step<>'invalid' THEN 1 ELSE 0 END,CASE WHEN v_canonical='completed' THEN now() ELSE NULL END,now()) ON CONFLICT(organizations_id,socials_id,operational_date) DO UPDATE SET sent_count=public.instagram_profile_runtime.sent_count+excluded.sent_count,invalid_count=public.instagram_profile_runtime.invalid_count+excluded.invalid_count,error_count=public.instagram_profile_runtime.error_count+excluded.error_count,last_send_at=coalesce(excluded.last_send_at,public.instagram_profile_runtime.last_send_at),last_heartbeat_at=now(),updated_at=now(); END IF;
 RETURN QUERY SELECT p_queue_item_id,p_step,v_queue,coalesce(v_lead,4::bigint);
END; $$;
REVOKE ALL ON FUNCTION public.instagram_claim_queue_item_v2(bigint,bigint,bigint,text,uuid,bigint) FROM PUBLIC,anon,authenticated;GRANT EXECUTE ON FUNCTION public.instagram_claim_queue_item_v2(bigint,bigint,bigint,text,uuid,bigint) TO service_role;
REVOKE ALL ON FUNCTION public.instagram_update_queue_progress_v2(bigint,bigint,uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated;GRANT EXECUTE ON FUNCTION public.instagram_update_queue_progress_v2(bigint,bigint,uuid,text,text,jsonb) TO service_role;

-- RLS por tenant nas tabelas de progresso.
ALTER TABLE public.instagram_queue_progress ENABLE ROW LEVEL SECURITY;ALTER TABLE public.instagram_dispatch_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS instagram_queue_progress_own_select ON public.instagram_queue_progress;DROP POLICY IF EXISTS instagram_queue_progress_org_select ON public.instagram_queue_progress;CREATE POLICY instagram_queue_progress_org_select ON public.instagram_queue_progress FOR SELECT TO authenticated USING(organizations_id=public.current_organization_id() AND public.has_organization_permission('instagram.view'));
DROP POLICY IF EXISTS instagram_dispatch_events_own_select ON public.instagram_dispatch_events;DROP POLICY IF EXISTS instagram_dispatch_events_org_select ON public.instagram_dispatch_events;CREATE POLICY instagram_dispatch_events_org_select ON public.instagram_dispatch_events FOR SELECT TO authenticated USING(organizations_id=public.current_organization_id() AND public.has_organization_permission('instagram.view'));

COMMIT;

-- ======================================================================
-- ETAPA 10
-- ======================================================================
BEGIN;

-- ETAPA 10 — Base Permanente como memória comercial canônica por organização.

DO $stage_preflight$
DECLARE v_missing text[]:=ARRAY[]::text[]; v_name text;
BEGIN
  FOREACH v_name IN ARRAY ARRAY['lead_identity_registry','contact_suppressions','permanent_records'] LOOP IF to_regclass('public.'||v_name) IS NULL THEN v_missing:=array_append(v_missing,'table:'||v_name);END IF;END LOOP;
  IF cardinality(v_missing)>0 THEN RAISE EXCEPTION 'stage_preflight_failed:%',array_to_string(v_missing,',');END IF;
END
$stage_preflight$;

ALTER TABLE public.permanent_records
 ADD COLUMN IF NOT EXISTS organizations_id bigint,
 ADD COLUMN IF NOT EXISTS first_capture_at timestamptz,
 ADD COLUMN IF NOT EXISTS last_capture_at timestamptz,
 ADD COLUMN IF NOT EXISTS capture_occurrences integer NOT NULL DEFAULT 0 CHECK(capture_occurrences>=0),
 ADD COLUMN IF NOT EXISTS contact_channels text[] NOT NULL DEFAULT '{}',
 ADD COLUMN IF NOT EXISTS last_contact_at timestamptz,
 ADD COLUMN IF NOT EXISTS last_contact_result text,
 ADD COLUMN IF NOT EXISTS outcome_updated_at timestamptz,
 ADD COLUMN IF NOT EXISTS outcome_updated_by_member_id bigint REFERENCES public.organization_members(organization_members_id) ON DELETE SET NULL;
ALTER TABLE public.permanent_record_snapshots ADD COLUMN IF NOT EXISTS organizations_id bigint;
UPDATE public.permanent_records p SET organizations_id=l.organizations_id FROM public.leads l WHERE p.organizations_id IS NULL AND l.leads_id=p.canonical_lead_id;
UPDATE public.permanent_record_snapshots s SET organizations_id=p.organizations_id FROM public.permanent_records p WHERE s.organizations_id IS NULL AND p.permanent_records_id=s.permanent_records_id;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.permanent_records WHERE organizations_id IS NULL) THEN RAISE EXCEPTION 'permanent_records_organization_backfill_incomplete'; END IF;
 IF EXISTS(SELECT 1 FROM public.permanent_record_snapshots WHERE organizations_id IS NULL) THEN RAISE EXCEPTION 'permanent_snapshots_organization_backfill_incomplete'; END IF;
END $$;
ALTER TABLE public.permanent_records ALTER COLUMN organizations_id SET NOT NULL;
ALTER TABLE public.permanent_record_snapshots ALTER COLUMN organizations_id SET NOT NULL;
ALTER TABLE public.permanent_records DROP CONSTRAINT IF EXISTS permanent_records_users_id_canonical_lead_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS permanent_records_org_canonical_uidx ON public.permanent_records(organizations_id,canonical_lead_id);
CREATE INDEX IF NOT EXISTS permanent_records_org_identity_idx ON public.permanent_records(organizations_id,normalized_phone,normalized_instagram,normalized_domain,normalized_maps);
CREATE INDEX IF NOT EXISTS permanent_records_org_outcome_idx ON public.permanent_records(organizations_id,commercial_outcome,last_activity_at DESC);

CREATE TABLE IF NOT EXISTS public.commercial_outcomes (
 commercial_outcome_key text PRIMARY KEY,
 display_name text NOT NULL,
 suppress_contact boolean NOT NULL DEFAULT false,
 allow_reentry boolean NOT NULL DEFAULT true,
 minimum_reentry_days integer CHECK(minimum_reentry_days IS NULL OR minimum_reentry_days>=0),
 sort_order integer NOT NULL,
 status_id bigint NOT NULL DEFAULT 1 REFERENCES public.status(status_id)
);
INSERT INTO public.commercial_outcomes(commercial_outcome_key,display_name,suppress_contact,allow_reentry,minimum_reentry_days,sort_order) VALUES
 ('no_response','Sem resposta',false,true,30,10),
 ('responded','Respondeu',false,true,14,20),
 ('interested','Interessado',false,true,7,30),
 ('not_interested','Não interessado',false,true,90,40),
 ('client','Cliente',true,false,NULL,50),
 ('wrong_contact','Contato incorreto',true,false,NULL,60),
 ('closed_business','Empresa fechada',true,false,NULL,70),
 ('do_not_contact','Não contatar',true,false,NULL,80)
ON CONFLICT(commercial_outcome_key) DO UPDATE SET display_name=excluded.display_name,suppress_contact=excluded.suppress_contact,allow_reentry=excluded.allow_reentry,minimum_reentry_days=excluded.minimum_reentry_days,sort_order=excluded.sort_order;
GRANT SELECT ON public.commercial_outcomes TO authenticated,service_role;

CREATE TABLE IF NOT EXISTS public.permanent_record_events (
 permanent_record_events_id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
 organizations_id bigint NOT NULL REFERENCES public.organizations(organizations_id) ON DELETE RESTRICT,
 permanent_records_id bigint NOT NULL REFERENCES public.permanent_records(permanent_records_id) ON DELETE CASCADE,
 canonical_lead_id bigint NOT NULL REFERENCES public.leads(leads_id) ON DELETE RESTRICT,
 organization_members_id bigint REFERENCES public.organization_members(organization_members_id) ON DELETE SET NULL,
 event_type text NOT NULL CHECK(event_type IN ('capture_seen','lead_finalized','dispatch','conversation','outcome_changed','suppressed','unsuppressed','archived','reentry_allowed','reentry_blocked','metadata_changed')),
 channel text,
 result text,
 payload jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS permanent_record_events_record_idx ON public.permanent_record_events(organizations_id,permanent_records_id,created_at DESC);
ALTER TABLE public.permanent_record_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS permanent_record_events_org_select ON public.permanent_record_events;
CREATE POLICY permanent_record_events_org_select ON public.permanent_record_events FOR SELECT TO authenticated USING(organizations_id=public.current_organization_id() AND public.has_organization_permission('leads.view'));
REVOKE INSERT,UPDATE,DELETE ON public.permanent_record_events FROM anon,authenticated;GRANT SELECT ON public.permanent_record_events TO authenticated;GRANT ALL ON public.permanent_record_events TO service_role;

-- Memória de captura agrega ocorrências da Captura oficial sem criar novo lead.
CREATE OR REPLACE FUNCTION public.service_record_capture_memory(p_organizations_id bigint,p_canonical_lead_id bigint,p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_id bigint;
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required';END IF;
 SELECT permanent_records_id INTO v_id FROM public.permanent_records WHERE organizations_id=p_organizations_id AND canonical_lead_id=p_canonical_lead_id FOR UPDATE;
 IF v_id IS NULL THEN PERFORM public.refresh_permanent_record(p_canonical_lead_id,'capture_memory');SELECT permanent_records_id INTO v_id FROM public.permanent_records WHERE organizations_id=p_organizations_id AND canonical_lead_id=p_canonical_lead_id;END IF;
 IF v_id IS NULL THEN RETURN NULL; END IF;
 UPDATE public.permanent_records SET first_capture_at=coalesce(first_capture_at,now()),last_capture_at=now(),capture_occurrences=capture_occurrences+1,last_activity_at=greatest(last_activity_at,now()),permanent_records_updated_at=now() WHERE permanent_records_id=v_id;
 INSERT INTO public.permanent_record_events(organizations_id,permanent_records_id,canonical_lead_id,event_type,payload) VALUES(p_organizations_id,v_id,p_canonical_lead_id,'capture_seen',coalesce(p_payload,'{}'));
 RETURN v_id;
END; $$;
REVOKE ALL ON FUNCTION public.service_record_capture_memory(bigint,bigint,jsonb) FROM PUBLIC,anon,authenticated;GRANT EXECUTE ON FUNCTION public.service_record_capture_memory(bigint,bigint,jsonb) TO service_role;

-- Atualiza o refresh legado para respeitar tenant e registrar snapshot/evento.
CREATE OR REPLACE FUNCTION public.refresh_permanent_record(p_lead_id bigint,p_reason text DEFAULT 'refresh')
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_lead public.leads%ROWTYPE;v_canonical bigint;v_base public.leads%ROWTYPE;v_status bigint;v_total integer;v_dispatch integer;v_first timestamptz;v_last timestamptz;v_last_sent timestamptz;v_suppressed boolean;v_id bigint;v_snapshot jsonb;v_channels text[];
BEGIN
 SELECT * INTO v_lead FROM public.leads WHERE leads_id=p_lead_id;IF NOT FOUND THEN RETURN NULL;END IF;v_canonical:=coalesce(v_lead.canonical_lead_id,v_lead.leads_id);
 SELECT * INTO v_base FROM public.leads WHERE leads_id=v_canonical AND organizations_id=v_lead.organizations_id;IF NOT FOUND THEN v_base:=v_lead;v_canonical:=v_lead.leads_id;END IF;
 IF NOT EXISTS(SELECT 1 FROM public.leads l WHERE l.organizations_id=v_lead.organizations_id AND (l.leads_id=v_canonical OR l.canonical_lead_id=v_canonical) AND l.lead_status_id IN(5,6,7,8)) THEN RETURN NULL;END IF;
 SELECT l.lead_status_id,l.leads_updated_at INTO v_status,v_last FROM public.leads l WHERE l.organizations_id=v_lead.organizations_id AND (l.leads_id=v_canonical OR l.canonical_lead_id=v_canonical) AND l.lead_status_id IN(5,6,7,8) ORDER BY l.leads_updated_at DESC,l.leads_id DESC LIMIT 1;
 SELECT count(*)::integer,min(l.leads_created_at),max(l.leads_updated_at) INTO v_total,v_first,v_last FROM public.leads l WHERE l.organizations_id=v_lead.organizations_id AND (l.leads_id=v_canonical OR l.canonical_lead_id=v_canonical);
 SELECT count(*)::integer,max(s.sents_sent_at),coalesce(array_agg(DISTINCT c.channels_name) FILTER(WHERE c.channels_name IS NOT NULL),'{}') INTO v_dispatch,v_last_sent,v_channels FROM public.sents s JOIN public.leads l ON l.leads_id=s.leads_id LEFT JOIN public.channels c ON c.channels_id=s.channels_id WHERE l.organizations_id=v_lead.organizations_id AND (l.leads_id=v_canonical OR l.canonical_lead_id=v_canonical) AND s.sents_sent_at IS NOT NULL;
 SELECT EXISTS(SELECT 1 FROM public.contact_suppressions cs WHERE cs.organizations_id=v_lead.organizations_id AND cs.is_active AND (cs.expires_at IS NULL OR cs.expires_at>now()) AND ((cs.identity_type='phone' AND cs.identity_value=v_base.leads_normalized_phone) OR (cs.identity_type='instagram' AND cs.identity_value=v_base.leads_normalized_instagram) OR (cs.identity_type='domain' AND cs.identity_value=v_base.leads_normalized_domain) OR (cs.identity_type='maps' AND cs.identity_value=v_base.leads_normalized_maps))) INTO v_suppressed;
 INSERT INTO public.permanent_records(users_id,organizations_id,canonical_lead_id,branches_id,states_id,cities_id,channels_id,last_lead_status_id,company_name,normalized_phone,normalized_instagram,normalized_domain,normalized_maps,total_leads,total_dispatches,first_seen_at,last_activity_at,last_sent_at,last_contact_at,contact_channels,is_suppressed)
 VALUES(v_lead.users_id,v_lead.organizations_id,v_canonical,v_base.branches_id,v_base.states_id,v_base.cities_id,v_base.channels_id,v_status,v_base.leads_name,v_base.leads_normalized_phone,v_base.leads_normalized_instagram,v_base.leads_normalized_domain,v_base.leads_normalized_maps,greatest(v_total,1),coalesce(v_dispatch,0),coalesce(v_first,now()),coalesce(v_last,now()),v_last_sent,v_last_sent,coalesce(v_channels,'{}'),coalesce(v_suppressed,false))
 ON CONFLICT(organizations_id,canonical_lead_id) DO UPDATE SET branches_id=excluded.branches_id,states_id=excluded.states_id,cities_id=excluded.cities_id,channels_id=excluded.channels_id,last_lead_status_id=CASE WHEN public.permanent_records.record_status='archived' THEN 8 ELSE excluded.last_lead_status_id END,company_name=excluded.company_name,normalized_phone=excluded.normalized_phone,normalized_instagram=excluded.normalized_instagram,normalized_domain=excluded.normalized_domain,normalized_maps=excluded.normalized_maps,total_leads=excluded.total_leads,total_dispatches=excluded.total_dispatches,first_seen_at=excluded.first_seen_at,last_activity_at=excluded.last_activity_at,last_sent_at=excluded.last_sent_at,last_contact_at=excluded.last_contact_at,contact_channels=excluded.contact_channels,is_suppressed=excluded.is_suppressed,permanent_records_updated_at=now()
 RETURNING permanent_records_id INTO v_id;
 SELECT to_jsonb(pr) INTO v_snapshot FROM public.permanent_records pr WHERE pr.permanent_records_id=v_id;
 INSERT INTO public.permanent_record_snapshots(users_id,organizations_id,permanent_records_id,reason,snapshot) VALUES(v_lead.users_id,v_lead.organizations_id,v_id,p_reason,v_snapshot);
 INSERT INTO public.permanent_record_events(organizations_id,permanent_records_id,canonical_lead_id,event_type,payload) VALUES(v_lead.organizations_id,v_id,v_canonical,CASE WHEN p_reason='dispatch_changed' THEN 'dispatch' ELSE 'lead_finalized' END,jsonb_build_object('reason',p_reason,'statusId',v_status)) ON CONFLICT DO NOTHING;
 RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.update_permanent_record_metadata(p_canonical_lead_id bigint,p_commercial_outcome text,p_operator_notes text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_org bigint:=public.current_organization_id();v_member bigint:=public.current_organization_member_id();v_id bigint;v_old text;v_users bigint;v_suppress boolean;
BEGIN
 PERFORM public.require_organization_permission('leads.edit');
 IF nullif(trim(coalesce(p_commercial_outcome,'')),'') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.commercial_outcomes WHERE commercial_outcome_key=trim(p_commercial_outcome) AND status_id=1) THEN RAISE EXCEPTION 'commercial_outcome_invalid';END IF;
 SELECT permanent_records_id,commercial_outcome,users_id INTO v_id,v_old,v_users FROM public.permanent_records WHERE organizations_id=v_org AND canonical_lead_id=p_canonical_lead_id FOR UPDATE;IF v_id IS NULL THEN RAISE EXCEPTION 'permanent_record_not_found';END IF;
 UPDATE public.permanent_records SET commercial_outcome=nullif(trim(p_commercial_outcome),''),operator_notes=nullif(trim(p_operator_notes),''),outcome_updated_at=now(),outcome_updated_by_member_id=v_member,permanent_records_updated_at=now() WHERE permanent_records_id=v_id;
 INSERT INTO public.permanent_record_events(organizations_id,permanent_records_id,canonical_lead_id,organization_members_id,event_type,result,payload) VALUES(v_org,v_id,p_canonical_lead_id,v_member,'outcome_changed',nullif(trim(p_commercial_outcome),''),jsonb_build_object('previous',v_old,'notesChanged',true));
 SELECT suppress_contact INTO v_suppress FROM public.commercial_outcomes WHERE commercial_outcome_key=trim(p_commercial_outcome);
 IF coalesce(v_suppress,false) THEN
   INSERT INTO public.contact_suppressions(users_id,organizations_id,identity_type,identity_value,reason,is_active,source_lead_id)
   SELECT v_users,v_org,x.identity_type,x.identity_value,'commercial_outcome:'||trim(p_commercial_outcome),true,p_canonical_lead_id FROM (VALUES('phone',(SELECT normalized_phone FROM public.permanent_records WHERE permanent_records_id=v_id)),('instagram',(SELECT normalized_instagram FROM public.permanent_records WHERE permanent_records_id=v_id)),('domain',(SELECT normalized_domain FROM public.permanent_records WHERE permanent_records_id=v_id)),('maps',(SELECT normalized_maps FROM public.permanent_records WHERE permanent_records_id=v_id))) x(identity_type,identity_value) WHERE nullif(x.identity_value,'') IS NOT NULL ON CONFLICT(organizations_id,identity_type,identity_value) DO UPDATE SET is_active=true,reason=excluded.reason,expires_at=NULL,updated_at=now();
 END IF;
END; $$;
GRANT EXECUTE ON FUNCTION public.update_permanent_record_metadata(bigint,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.commercial_reentry_decision(p_organizations_id bigint,p_canonical_lead_id bigint,p_at timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO pg_catalog,public AS $$
DECLARE r public.permanent_records%ROWTYPE;o public.commercial_outcomes%ROWTYPE;v_age integer;
BEGIN
 IF auth.role()<>'service_role' AND p_organizations_id<>public.current_organization_id() THEN RAISE EXCEPTION 'organization_access_denied';END IF;
 SELECT * INTO r FROM public.permanent_records WHERE organizations_id=p_organizations_id AND canonical_lead_id=p_canonical_lead_id;IF NOT FOUND THEN RETURN jsonb_build_object('allowed',true,'reason','not_seen');END IF;
 IF r.is_suppressed THEN RETURN jsonb_build_object('allowed',false,'reason','suppressed','outcome',r.commercial_outcome);END IF;
 IF r.commercial_outcome IS NULL THEN RETURN jsonb_build_object('allowed',true,'reason','no_outcome');END IF;
 SELECT * INTO o FROM public.commercial_outcomes WHERE commercial_outcome_key=r.commercial_outcome AND status_id=1;IF NOT FOUND THEN RETURN jsonb_build_object('allowed',true,'reason','unknown_outcome');END IF;
 IF NOT o.allow_reentry THEN RETURN jsonb_build_object('allowed',false,'reason','outcome_blocks_reentry','outcome',o.commercial_outcome_key);END IF;
 v_age:=floor(extract(epoch from (p_at-coalesce(r.last_contact_at,r.last_activity_at)))/86400)::integer;
 RETURN jsonb_build_object('allowed',o.minimum_reentry_days IS NULL OR v_age>=o.minimum_reentry_days,'reason',CASE WHEN o.minimum_reentry_days IS NULL OR v_age>=o.minimum_reentry_days THEN 'cooldown_completed' ELSE 'cooldown_active' END,'daysSinceContact',v_age,'minimumDays',o.minimum_reentry_days,'outcome',o.commercial_outcome_key);
END; $$;
GRANT EXECUTE ON FUNCTION public.commercial_reentry_decision(bigint,bigint,timestamptz) TO authenticated,service_role;


CREATE OR REPLACE FUNCTION public.archive_permanent_record(p_canonical_lead_id bigint,p_expected_status_id bigint)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_org bigint:=public.current_organization_id();v_user bigint:=public.ensure_current_user();v_member bigint:=public.current_organization_member_id();v_id bigint;
BEGIN
 PERFORM public.require_organization_permission('leads.delete');
 UPDATE public.permanent_records SET record_status='archived',last_lead_status_id=8,archived_at=now(),permanent_records_updated_at=now()
 WHERE organizations_id=v_org AND canonical_lead_id=p_canonical_lead_id AND last_lead_status_id=p_expected_status_id AND record_status<>'archived' RETURNING permanent_records_id INTO v_id;
 IF v_id IS NOT NULL THEN
   INSERT INTO public.permanent_record_events(organizations_id,permanent_records_id,canonical_lead_id,organization_members_id,event_type,payload) VALUES(v_org,v_id,p_canonical_lead_id,v_member,'archived',jsonb_build_object('expectedStatusId',p_expected_status_id));
   PERFORM public.append_audit_event('base-permanente','archive_permanent_record','permanent_record',v_id::text,p_canonical_lead_id,NULL,NULL,p_expected_status_id,8,NULL,jsonb_build_object('organization_id',v_org),v_user);
 END IF;
 RETURN v_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.archive_permanent_record(bigint,bigint) TO authenticated;

-- RLS tenant-aware.
ALTER TABLE public.permanent_records ENABLE ROW LEVEL SECURITY;ALTER TABLE public.permanent_record_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS permanent_records_own_select ON public.permanent_records;DROP POLICY IF EXISTS permanent_records_org_select ON public.permanent_records;CREATE POLICY permanent_records_org_select ON public.permanent_records FOR SELECT TO authenticated USING(organizations_id=public.current_organization_id() AND public.has_organization_permission('leads.view'));
DROP POLICY IF EXISTS permanent_record_snapshots_own_select ON public.permanent_record_snapshots;DROP POLICY IF EXISTS permanent_record_snapshots_org_select ON public.permanent_record_snapshots;CREATE POLICY permanent_record_snapshots_org_select ON public.permanent_record_snapshots FOR SELECT TO authenticated USING(organizations_id=public.current_organization_id() AND public.has_organization_permission('leads.view'));

DO $$ DECLARE r record; BEGIN FOR r IN SELECT DISTINCT coalesce(canonical_lead_id,leads_id) lead_id FROM public.leads WHERE lead_status_id IN(5,6,7,8) LOOP PERFORM public.refresh_permanent_record(r.lead_id,'stage10_backfill'); END LOOP; END $$;

COMMIT;

-- ======================================================================
-- ETAPA 11
-- ======================================================================
BEGIN;

-- ETAPA 11 — observabilidade tenant-aware, saúde, alertas e recuperação controlada.

DO $stage_preflight$
DECLARE v_missing text[]:=ARRAY[]::text[]; v_name text;
BEGIN
  FOREACH v_name IN ARRAY ARRAY['organization_tool_installations','worker_heartbeats'] LOOP IF to_regclass('public.'||v_name) IS NULL THEN v_missing:=array_append(v_missing,'table:'||v_name);END IF;END LOOP;
  FOREACH v_name IN ARRAY ARRAY['append_audit_event'] LOOP IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=v_name) THEN v_missing:=array_append(v_missing,'function:'||v_name);END IF;END LOOP;
  IF cardinality(v_missing)>0 THEN RAISE EXCEPTION 'stage_preflight_failed:%',array_to_string(v_missing,',');END IF;
END
$stage_preflight$;

CREATE TABLE IF NOT EXISTS public.platform_runtime_heartbeats (
  platform_runtime_heartbeats_id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  organizations_id bigint NOT NULL REFERENCES public.organizations(organizations_id) ON DELETE CASCADE,
  organization_tool_installations_id uuid REFERENCES public.organization_tool_installations(organization_tool_installations_id) ON DELETE SET NULL,
  component_type text NOT NULL CHECK(component_type IN ('worker','manager','gateway','evolution','capture','instagram','realtime')),
  component_key text NOT NULL,
  component_version text,
  runtime_status text NOT NULL DEFAULT 'online' CHECK(runtime_status IN ('online','degraded','stopping','offline','error','incompatible')),
  started_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_meaningful_activity_at timestamptz,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(organizations_id,component_type,component_key)
);
CREATE INDEX IF NOT EXISTS platform_runtime_heartbeats_seen_idx ON public.platform_runtime_heartbeats(organizations_id,last_seen_at DESC);
CREATE INDEX IF NOT EXISTS platform_runtime_heartbeats_component_idx ON public.platform_runtime_heartbeats(organizations_id,component_type,runtime_status,last_seen_at DESC);
ALTER TABLE public.platform_runtime_heartbeats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS platform_runtime_heartbeats_org_select ON public.platform_runtime_heartbeats;
CREATE POLICY platform_runtime_heartbeats_org_select ON public.platform_runtime_heartbeats FOR SELECT TO authenticated
USING(organizations_id=public.current_organization_id() AND public.has_organization_permission('monitoring.view'));
REVOKE INSERT,UPDATE,DELETE ON public.platform_runtime_heartbeats FROM anon,authenticated;
GRANT SELECT ON public.platform_runtime_heartbeats TO authenticated;
GRANT ALL ON public.platform_runtime_heartbeats TO service_role;

-- Heartbeat legado do Worker passa a ser tenant-aware. Registros antigos sem tenant são efêmeros e podem ser descartados.
ALTER TABLE public.worker_heartbeats ADD COLUMN IF NOT EXISTS organizations_id bigint REFERENCES public.organizations(organizations_id) ON DELETE CASCADE;
DELETE FROM public.worker_heartbeats WHERE organizations_id IS NULL;
ALTER TABLE public.worker_heartbeats ALTER COLUMN organizations_id SET NOT NULL;
ALTER TABLE public.worker_heartbeats DROP CONSTRAINT IF EXISTS worker_heartbeats_worker_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS worker_heartbeats_org_worker_uidx ON public.worker_heartbeats(organizations_id,worker_id);
ALTER TABLE public.worker_heartbeats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS worker_heartbeats_authenticated_read ON public.worker_heartbeats;
DROP POLICY IF EXISTS worker_heartbeats_org_select ON public.worker_heartbeats;
CREATE POLICY worker_heartbeats_org_select ON public.worker_heartbeats FOR SELECT TO authenticated
USING(organizations_id=public.current_organization_id() AND public.has_organization_permission('monitoring.view'));
REVOKE INSERT,UPDATE,DELETE ON public.worker_heartbeats FROM anon,authenticated;
GRANT SELECT ON public.worker_heartbeats TO authenticated;
GRANT ALL ON public.worker_heartbeats TO service_role;

-- Tabelas antigas de alerta/recovery já recebem organizations_id na Etapa 2; reforça índices e RLS por tenant.
CREATE UNIQUE INDEX IF NOT EXISTS operational_alerts_org_key_uidx ON public.operational_alerts(organizations_id,alert_key);
CREATE INDEX IF NOT EXISTS operational_alerts_org_open_idx ON public.operational_alerts(organizations_id,severity,last_detected_at DESC) WHERE status<>'resolved';
CREATE INDEX IF NOT EXISTS recovery_requests_org_pending_idx ON public.recovery_requests(organizations_id,status,requested_at) WHERE status IN ('pending','running');
ALTER TABLE public.operational_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recovery_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS operational_alerts_own_select ON public.operational_alerts;
DROP POLICY IF EXISTS operational_alerts_org_select ON public.operational_alerts;
CREATE POLICY operational_alerts_org_select ON public.operational_alerts FOR SELECT TO authenticated
USING(organizations_id=public.current_organization_id() AND public.has_organization_permission('monitoring.view'));
DROP POLICY IF EXISTS recovery_requests_own_select ON public.recovery_requests;
DROP POLICY IF EXISTS recovery_requests_org_select ON public.recovery_requests;
CREATE POLICY recovery_requests_org_select ON public.recovery_requests FOR SELECT TO authenticated
USING(organizations_id=public.current_organization_id() AND public.has_organization_permission('monitoring.view'));

-- Registro canônico de qualquer componente. O servidor fixa a organização a partir da credencial da instalação.
CREATE OR REPLACE FUNCTION public.service_runtime_heartbeat(
  p_organizations_id bigint,
  p_component_type text,
  p_component_key text,
  p_component_version text DEFAULT NULL,
  p_status text DEFAULT 'online',
  p_installation_id uuid DEFAULT NULL,
  p_metrics jsonb DEFAULT '{}'::jsonb,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_meaningful_activity boolean DEFAULT false
) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_id bigint; v_type text:=lower(trim(coalesce(p_component_type,''))); v_status text:=lower(trim(coalesce(p_status,'online')));
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.organizations WHERE organizations_id=p_organizations_id AND status_id=1) THEN RAISE EXCEPTION 'organization_not_active'; END IF;
  IF v_type NOT IN ('worker','manager','gateway','evolution','capture','instagram','realtime') THEN RAISE EXCEPTION 'runtime_component_invalid'; END IF;
  IF v_status NOT IN ('online','degraded','stopping','offline','error','incompatible') THEN RAISE EXCEPTION 'runtime_status_invalid'; END IF;
  IF nullif(trim(coalesce(p_component_key,'')),'') IS NULL THEN RAISE EXCEPTION 'runtime_component_key_required'; END IF;
  IF p_installation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.organization_tool_installations i WHERE i.organization_tool_installations_id=p_installation_id AND i.organizations_id=p_organizations_id AND i.registration_status='registered') THEN RAISE EXCEPTION 'runtime_installation_scope_mismatch'; END IF;
  INSERT INTO public.platform_runtime_heartbeats(organizations_id,organization_tool_installations_id,component_type,component_key,component_version,runtime_status,last_meaningful_activity_at,metrics,metadata)
  VALUES(p_organizations_id,p_installation_id,v_type,trim(p_component_key),nullif(trim(coalesce(p_component_version,'')),''),v_status,CASE WHEN p_meaningful_activity THEN now() ELSE NULL END,coalesce(p_metrics,'{}'::jsonb),coalesce(p_metadata,'{}'::jsonb))
  ON CONFLICT(organizations_id,component_type,component_key) DO UPDATE SET
    organization_tool_installations_id=coalesce(excluded.organization_tool_installations_id,public.platform_runtime_heartbeats.organization_tool_installations_id),
    component_version=coalesce(excluded.component_version,public.platform_runtime_heartbeats.component_version),
    runtime_status=excluded.runtime_status,last_seen_at=now(),
    last_meaningful_activity_at=CASE WHEN p_meaningful_activity THEN now() ELSE public.platform_runtime_heartbeats.last_meaningful_activity_at END,
    metrics=excluded.metrics,metadata=public.platform_runtime_heartbeats.metadata||excluded.metadata
  RETURNING platform_runtime_heartbeats_id INTO v_id;
  RETURN v_id;
END; $$;
REVOKE ALL ON FUNCTION public.service_runtime_heartbeat(bigint,text,text,text,text,uuid,jsonb,jsonb,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.service_runtime_heartbeat(bigint,text,text,text,text,uuid,jsonb,jsonb,boolean) TO service_role;

-- Substitui o heartbeat legado do Worker por uma assinatura com tenant explícito.
DROP FUNCTION IF EXISTS public.service_worker_heartbeat(text,text,text,jsonb,jsonb);
CREATE OR REPLACE FUNCTION public.service_worker_heartbeat(
  p_organizations_id bigint,p_worker_id text,p_worker_version text,p_status text DEFAULT 'online',p_metrics jsonb DEFAULT '{}'::jsonb,p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  INSERT INTO public.worker_heartbeats(organizations_id,worker_id,worker_version,worker_status,metrics,metadata)
  VALUES(p_organizations_id,trim(p_worker_id),trim(p_worker_version),p_status,coalesce(p_metrics,'{}'::jsonb),coalesce(p_metadata,'{}'::jsonb))
  ON CONFLICT(organizations_id,worker_id) DO UPDATE SET worker_version=excluded.worker_version,worker_status=excluded.worker_status,last_seen_at=now(),metrics=excluded.metrics,metadata=excluded.metadata;
  PERFORM public.service_runtime_heartbeat(p_organizations_id,'worker',trim(p_worker_id),p_worker_version,p_status,NULL,p_metrics,p_metadata,false);
END; $$;
REVOKE ALL ON FUNCTION public.service_worker_heartbeat(bigint,text,text,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.service_worker_heartbeat(bigint,text,text,text,jsonb,jsonb) TO service_role;

-- Recovery por organização. Nenhum Worker pode reclamar pedido de outro tenant.
CREATE OR REPLACE FUNCTION public.request_operational_recovery(p_scope text DEFAULT 'all')
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_org bigint:=public.current_organization_id(); v_user bigint:=public.ensure_current_user(); v_id bigint; v_scope text:=lower(trim(coalesce(p_scope,'all')));
BEGIN
  PERFORM public.require_organization_permission('monitoring.manage');
  IF v_scope NOT IN('all','whatsapp','instagram','capture','realtime','tools') THEN RAISE EXCEPTION 'recovery_scope_invalid'; END IF;
  SELECT recovery_requests_id INTO v_id FROM public.recovery_requests WHERE organizations_id=v_org AND status IN('pending','running') ORDER BY requested_at DESC LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  INSERT INTO public.recovery_requests(users_id,organizations_id,requested_by,scope) VALUES(v_user,v_org,auth.uid(),v_scope) RETURNING recovery_requests_id INTO v_id;
  PERFORM public.append_audit_event('monitoring','recovery_requested','recovery_request',v_id::text,NULL,NULL,NULL,NULL,NULL,NULL,jsonb_build_object('scope',v_scope,'organization_id',v_org),v_user);
  RETURN v_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.request_operational_recovery(text) TO authenticated;

DROP FUNCTION IF EXISTS public.service_claim_recovery_request(text);
CREATE OR REPLACE FUNCTION public.service_claim_recovery_request(p_organizations_id bigint,p_worker_id text)
RETURNS TABLE(recovery_requests_id bigint,organizations_id bigint,users_id bigint,scope text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_id bigint;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  SELECT r.recovery_requests_id INTO v_id FROM public.recovery_requests r WHERE r.organizations_id=p_organizations_id AND r.status='pending' ORDER BY r.requested_at FOR UPDATE SKIP LOCKED LIMIT 1;
  IF v_id IS NULL THEN RETURN; END IF;
  UPDATE public.recovery_requests SET status='running',worker_id=p_worker_id,started_at=now() WHERE public.recovery_requests.recovery_requests_id=v_id;
  RETURN QUERY SELECT r.recovery_requests_id,r.organizations_id,r.users_id,r.scope FROM public.recovery_requests r WHERE r.recovery_requests_id=v_id;
END; $$;
REVOKE ALL ON FUNCTION public.service_claim_recovery_request(bigint,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.service_claim_recovery_request(bigint,text) TO service_role;

DROP FUNCTION IF EXISTS public.service_complete_recovery_request(bigint,jsonb,text);
CREATE OR REPLACE FUNCTION public.service_complete_recovery_request(p_organizations_id bigint,p_request_id bigint,p_result jsonb,p_error text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  UPDATE public.recovery_requests SET status=CASE WHEN p_error IS NULL THEN 'completed' ELSE 'failed' END,result=coalesce(p_result,'{}'::jsonb),error_message=p_error,finished_at=now()
  WHERE recovery_requests_id=p_request_id AND organizations_id=p_organizations_id AND status='running';
END; $$;
REVOKE ALL ON FUNCTION public.service_complete_recovery_request(bigint,bigint,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.service_complete_recovery_request(bigint,bigint,jsonb,text) TO service_role;

-- Alertas derivados da verdade operacional. Idempotente: abre/atualiza e resolve quando a condição some.
-- Contrato legado possuía o mesmo tipo bigint com nome de parâmetro p_users_id.
-- PostgreSQL não permite alterar nome de parâmetro via CREATE OR REPLACE;
-- removemos a função antiga e recriamos o contrato tenant-aware explicitamente.
DROP FUNCTION IF EXISTS public.refresh_operational_alerts(bigint);
CREATE OR REPLACE FUNCTION public.refresh_operational_alerts(p_organizations_id bigint)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_user bigint; v_count integer:=0; v_value bigint; v_now timestamptz:=now();
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  SELECT legacy_scope_users_id INTO v_user FROM public.organizations WHERE organizations_id=p_organizations_id;
  IF v_user IS NULL THEN RAISE EXCEPTION 'organization_not_found'; END IF;

  SELECT count(*) INTO v_value FROM public.queue_items WHERE organizations_id=p_organizations_id AND status_id=4 AND queue_items_updated_at<v_now-interval '15 minutes';
  IF v_value>0 THEN
    INSERT INTO public.operational_alerts(users_id,organizations_id,alert_key,source,severity,title,message,metadata)
    VALUES(v_user,p_organizations_id,'stale_queue_items','queues','critical','Itens travados em processamento',v_value||' item(ns) estão processando há mais de 15 minutos.',jsonb_build_object('count',v_value))
    ON CONFLICT(organizations_id,alert_key) DO UPDATE SET status='open',last_detected_at=v_now,message=excluded.message,metadata=excluded.metadata,resolved_at=NULL;
    v_count:=v_count+1;
  ELSE UPDATE public.operational_alerts SET status='resolved',resolved_at=v_now WHERE organizations_id=p_organizations_id AND alert_key='stale_queue_items' AND status<>'resolved'; END IF;

  SELECT count(*) INTO v_value FROM public.queue_item_dispatch_parts WHERE organizations_id=p_organizations_id AND queue_item_dispatch_parts_state='reconciliation_required';
  IF v_value>0 THEN
    INSERT INTO public.operational_alerts(users_id,organizations_id,alert_key,source,severity,title,message,metadata)
    VALUES(v_user,p_organizations_id,'whatsapp_reconciliation','worker','warning','WhatsApp requer reconciliação',v_value||' parte(s) possuem resultado incerto.',jsonb_build_object('count',v_value))
    ON CONFLICT(organizations_id,alert_key) DO UPDATE SET status='open',last_detected_at=v_now,message=excluded.message,metadata=excluded.metadata,resolved_at=NULL;
    v_count:=v_count+1;
  ELSE UPDATE public.operational_alerts SET status='resolved',resolved_at=v_now WHERE organizations_id=p_organizations_id AND alert_key='whatsapp_reconciliation' AND status<>'resolved'; END IF;

  SELECT count(*) INTO v_value FROM public.instagram_queue_progress WHERE organizations_id=p_organizations_id AND canonical_step='reconciliation_required';
  IF v_value>0 THEN
    INSERT INTO public.operational_alerts(users_id,organizations_id,alert_key,source,severity,title,message,metadata)
    VALUES(v_user,p_organizations_id,'instagram_reconciliation','instagram','warning','Instagram requer reconciliação',v_value||' item(ns) possuem resultado incerto.',jsonb_build_object('count',v_value))
    ON CONFLICT(organizations_id,alert_key) DO UPDATE SET status='open',last_detected_at=v_now,message=excluded.message,metadata=excluded.metadata,resolved_at=NULL;
    v_count:=v_count+1;
  ELSE UPDATE public.operational_alerts SET status='resolved',resolved_at=v_now WHERE organizations_id=p_organizations_id AND alert_key='instagram_reconciliation' AND status<>'resolved'; END IF;

  -- Worker é obrigatório quando o WhatsApp Manager está habilitado.
  IF EXISTS(SELECT 1 FROM public.organization_tools WHERE organizations_id=p_organizations_id AND tool_id='vinsansi_whatsapp_manager' AND enabled) THEN
    SELECT count(*) INTO v_value FROM public.platform_runtime_heartbeats WHERE organizations_id=p_organizations_id AND component_type='worker' AND last_seen_at>v_now-interval '2 minutes' AND runtime_status IN('online','degraded');
    IF v_value=0 THEN
      INSERT INTO public.operational_alerts(users_id,organizations_id,alert_key,source,severity,title,message,metadata)
      VALUES(v_user,p_organizations_id,'worker_heartbeat_missing','worker','critical','Worker sem heartbeat','Nenhum Worker da organização comunicou nos últimos 2 minutos.','{}'::jsonb)
      ON CONFLICT(organizations_id,alert_key) DO UPDATE SET status='open',last_detected_at=v_now,message=excluded.message,resolved_at=NULL;
      v_count:=v_count+1;
    ELSE UPDATE public.operational_alerts SET status='resolved',resolved_at=v_now WHERE organizations_id=p_organizations_id AND alert_key='worker_heartbeat_missing' AND status<>'resolved'; END IF;
  END IF;

  -- Instalações registradas das ferramentas locais devem reportar presença.
  SELECT count(*) INTO v_value FROM public.organization_tool_installations i
  WHERE i.organizations_id=p_organizations_id AND i.registration_status='registered' AND i.tool_id IN('vinsansi_capture','vinsansi_instagram')
    AND (i.last_seen_at IS NULL OR i.last_seen_at<v_now-interval '3 minutes');
  IF v_value>0 THEN
    INSERT INTO public.operational_alerts(users_id,organizations_id,alert_key,source,severity,title,message,metadata)
    VALUES(v_user,p_organizations_id,'tool_installation_stale','tools','warning','Ferramenta local sem comunicação',v_value||' instalação(ões) não comunicaram nos últimos 3 minutos.',jsonb_build_object('count',v_value))
    ON CONFLICT(organizations_id,alert_key) DO UPDATE SET status='open',last_detected_at=v_now,message=excluded.message,metadata=excluded.metadata,resolved_at=NULL;
    v_count:=v_count+1;
  ELSE UPDATE public.operational_alerts SET status='resolved',resolved_at=v_now WHERE organizations_id=p_organizations_id AND alert_key='tool_installation_stale' AND status<>'resolved'; END IF;

  RETURN v_count;
END; $$;
REVOKE ALL ON FUNCTION public.refresh_operational_alerts(bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_operational_alerts(bigint) TO service_role;


-- Recuperação stale com escopo por organização; nunca toca execução de outro tenant.
CREATE OR REPLACE FUNCTION public.worker_recover_stale_whatsapp_v2(p_organizations_id bigint,p_stale_before timestamptz DEFAULT now()-interval '15 minutes')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE r record;v_recovered integer:=0;v_reconciliation integer:=0;
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required';END IF;
 FOR r IN SELECT qi.queue_items_id FROM public.queue_items qi WHERE qi.organizations_id=p_organizations_id AND qi.status_id=4 AND coalesce(qi.queue_items_started_at,qi.queue_items_updated_at)<p_stale_before FOR UPDATE OF qi SKIP LOCKED LOOP
   IF EXISTS(SELECT 1 FROM public.queue_item_dispatch_parts p WHERE p.organizations_id=p_organizations_id AND p.queue_items_id=r.queue_items_id AND p.queue_item_dispatch_parts_state='processing') THEN
     UPDATE public.queue_item_dispatch_parts SET queue_item_dispatch_parts_state='reconciliation_required',queue_item_dispatch_parts_claim_token=NULL,queue_item_dispatch_parts_error_message='worker_restart_after_provider_claim',queue_item_dispatch_parts_updated_at=now() WHERE organizations_id=p_organizations_id AND queue_items_id=r.queue_items_id AND queue_item_dispatch_parts_state='processing';
     UPDATE public.queue_items SET status_id=6,queue_items_error_message='reconciliation_required_after_worker_restart',queue_items_finished_at=now(),queue_items_updated_at=now() WHERE organizations_id=p_organizations_id AND queue_items_id=r.queue_items_id;
     UPDATE public.worker_batch_items SET status_id=6,worker_batch_items_error_message='reconciliation_required_after_worker_restart',worker_batch_items_finished_at=now(),worker_batch_items_updated_at=now() WHERE organizations_id=p_organizations_id AND queue_items_id=r.queue_items_id AND status_id=4;
     v_reconciliation:=v_reconciliation+1;
   ELSE
     UPDATE public.queue_items SET status_id=3,queue_items_error_message=NULL,queue_items_started_at=NULL,queue_items_finished_at=NULL,queue_items_updated_at=now() WHERE organizations_id=p_organizations_id AND queue_items_id=r.queue_items_id;
     UPDATE public.worker_batch_items SET status_id=3,worker_batch_items_started_at=NULL,worker_batch_items_finished_at=NULL,worker_batch_items_error_message=NULL,worker_batch_items_updated_at=now() WHERE organizations_id=p_organizations_id AND queue_items_id=r.queue_items_id AND status_id=4;
     v_recovered:=v_recovered+1;
   END IF;
 END LOOP;
 UPDATE public.worker_batches SET worker_batches_next_run_at=now(),worker_batches_heartbeat_at=now(),worker_batches_updated_at=now() WHERE organizations_id=p_organizations_id AND worker_batches_status='running' AND worker_batches_heartbeat_at<p_stale_before;
 RETURN jsonb_build_object('recovered_items',v_recovered,'reconciliation_items',v_reconciliation);
END; $$;
REVOKE ALL ON FUNCTION public.worker_recover_stale_whatsapp_v2(bigint,timestamptz) FROM PUBLIC,anon,authenticated;GRANT EXECUTE ON FUNCTION public.worker_recover_stale_whatsapp_v2(bigint,timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.instagram_recover_stale_items_v2(p_organizations_id bigint,p_stale_before timestamptz DEFAULT now()-interval '15 minutes')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE r record;v_requeued integer:=0;v_reconciliation integer:=0;v_next text;
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required';END IF;
 FOR r IN SELECT p.instagram_queue_progress_id,p.queue_items_id,p.socials_id,p.canonical_step,p.claim_token FROM public.instagram_queue_progress p WHERE p.organizations_id=p_organizations_id AND p.canonical_step IN('claimed','opening_profile','following','followed','opening_dm','sending') AND coalesce(p.last_heartbeat_at,p.instagram_queue_progress_updated_at)<p_stale_before FOR UPDATE OF p SKIP LOCKED LOOP
   IF r.canonical_step='sending' THEN
     v_next:='reconciliation_required';v_reconciliation:=v_reconciliation+1;
     UPDATE public.instagram_queue_progress SET canonical_step=v_next,step=v_next,error_message='stale_after_possible_dispatch',finished_at=now(),instagram_queue_progress_updated_at=now() WHERE instagram_queue_progress_id=r.instagram_queue_progress_id;
     UPDATE public.queue_items SET status_id=6,queue_items_error_message='instagram_reconciliation_required',queue_items_finished_at=now(),queue_items_updated_at=now() WHERE organizations_id=p_organizations_id AND queue_items_id=r.queue_items_id;
   ELSE
     v_next:='queued';v_requeued:=v_requeued+1;
     UPDATE public.instagram_queue_progress SET canonical_step='queued',step='queued',claim_token=NULL,claimed_by=NULL,error_message='recovered_stale_claim',instagram_queue_progress_updated_at=now() WHERE instagram_queue_progress_id=r.instagram_queue_progress_id;
     UPDATE public.queue_items SET status_id=3,queue_items_started_at=NULL,queue_items_error_message=NULL,queue_items_finished_at=NULL,queue_items_updated_at=now() WHERE organizations_id=p_organizations_id AND queue_items_id=r.queue_items_id;
   END IF;
   INSERT INTO public.instagram_dispatch_events(users_id,organizations_id,queue_items_id,socials_id,from_step,to_step,actor,message) SELECT qi.users_id,p_organizations_id,r.queue_items_id,r.socials_id,r.canonical_step,v_next,'recovery','stale_execution_recovered' FROM public.queue_items qi WHERE qi.queue_items_id=r.queue_items_id;
 END LOOP;
 RETURN jsonb_build_object('requeued',v_requeued,'reconciliation',v_reconciliation);
END; $$;
REVOKE ALL ON FUNCTION public.instagram_recover_stale_items_v2(bigint,timestamptz) FROM PUBLIC,anon,authenticated;GRANT EXECUTE ON FUNCTION public.instagram_recover_stale_items_v2(bigint,timestamptz) TO service_role;

-- Saúde operacional completa e tenant-aware.
CREATE OR REPLACE FUNCTION public.get_operational_health()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO pg_catalog,public AS $$
DECLARE v_org bigint:=public.current_organization_id(); v_result jsonb;
BEGIN
  PERFORM public.require_organization_permission('monitoring.view');
  SELECT jsonb_build_object(
    'checkedAt',now(),
    'organizationId',v_org,
    'workers',jsonb_build_object(
      'online',(SELECT count(*) FROM public.platform_runtime_heartbeats WHERE organizations_id=v_org AND component_type='worker' AND last_seen_at>now()-interval '2 minutes' AND runtime_status='online'),
      'stale',(SELECT count(*) FROM public.platform_runtime_heartbeats WHERE organizations_id=v_org AND component_type='worker' AND last_seen_at<=now()-interval '2 minutes')
    ),
    'components',coalesce((SELECT jsonb_agg(jsonb_build_object('type',component_type,'key',component_key,'version',component_version,'status',CASE WHEN last_seen_at<=now()-interval '3 minutes' THEN 'offline' ELSE runtime_status END,'lastSeenAt',last_seen_at,'lastActivityAt',last_meaningful_activity_at,'metrics',metrics,'metadata',metadata) ORDER BY component_type,component_key) FROM public.platform_runtime_heartbeats WHERE organizations_id=v_org),'[]'::jsonb),
    'queues',jsonb_build_object(
      'pending',(SELECT count(*) FROM public.queue_items WHERE organizations_id=v_org AND status_id=3),
      'processing',(SELECT count(*) FROM public.queue_items WHERE organizations_id=v_org AND status_id=4),
      'staleProcessing',(SELECT count(*) FROM public.queue_items WHERE organizations_id=v_org AND status_id=4 AND queue_items_updated_at<now()-interval '15 minutes'),
      'errors',(SELECT count(*) FROM public.queue_items WHERE organizations_id=v_org AND status_id=6)
    ),
    'reconciliation',jsonb_build_object(
      'whatsapp',(SELECT count(*) FROM public.queue_item_dispatch_parts WHERE organizations_id=v_org AND queue_item_dispatch_parts_state='reconciliation_required'),
      'instagram',(SELECT count(*) FROM public.instagram_queue_progress WHERE organizations_id=v_org AND canonical_step='reconciliation_required')
    ),
    'batches',jsonb_build_object(
      'active',(SELECT count(*) FROM public.worker_batches WHERE organizations_id=v_org AND worker_batches_status IN('queued','running','paused')),
      'stale',(SELECT count(*) FROM public.worker_batches WHERE organizations_id=v_org AND worker_batches_status='running' AND worker_batches_heartbeat_at<now()-interval '15 minutes')
    ),
    'tools',jsonb_build_object(
      'registered',(SELECT count(*) FROM public.organization_tool_installations WHERE organizations_id=v_org AND registration_status='registered'),
      'stale',(SELECT count(*) FROM public.organization_tool_installations WHERE organizations_id=v_org AND registration_status='registered' AND (last_seen_at IS NULL OR last_seen_at<now()-interval '3 minutes'))
    ),
    'alerts',jsonb_build_object(
      'open',(SELECT count(*) FROM public.operational_alerts WHERE organizations_id=v_org AND status<>'resolved'),
      'critical',(SELECT count(*) FROM public.operational_alerts WHERE organizations_id=v_org AND status<>'resolved' AND severity='critical')
    ),
    'latestRecovery',(SELECT to_jsonb(r) FROM public.recovery_requests r WHERE r.organizations_id=v_org ORDER BY r.requested_at DESC LIMIT 1)
  ) INTO v_result;
  RETURN v_result;
END; $$;
GRANT EXECUTE ON FUNCTION public.get_operational_health() TO authenticated;

COMMIT;

-- ======================================================================
-- ETAPA 12
-- ======================================================================
BEGIN;

-- ETAPA 12 — consolidação estrutural, manifesto de schema e remoção de bridges obsoletas.

DO $stage_preflight$
DECLARE v_missing text[]:=ARRAY[]::text[]; v_name text;
BEGIN
  FOREACH v_name IN ARRAY ARRAY['platform_schema_releases','operational_alerts'] LOOP IF to_regclass('public.'||v_name) IS NULL THEN v_missing:=array_append(v_missing,'table:'||v_name);END IF;END LOOP;
  FOREACH v_name IN ARRAY ARRAY['get_operational_health'] LOOP IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=v_name) THEN v_missing:=array_append(v_missing,'function:'||v_name);END IF;END LOOP;
  IF cardinality(v_missing)>0 THEN RAISE EXCEPTION 'stage_preflight_failed:%',array_to_string(v_missing,',');END IF;
END
$stage_preflight$;

ALTER TABLE public.platform_schema_releases
  ADD COLUMN IF NOT EXISTS schema_contract_version text,
  ADD COLUMN IF NOT EXISTS minimum_application_version text,
  ADD COLUMN IF NOT EXISTS is_stable boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.platform_schema_contracts (
  schema_contract_version text PRIMARY KEY,
  application_version text NOT NULL,
  required_tables text[] NOT NULL,
  required_functions text[] NOT NULL,
  retired_objects text[] NOT NULL DEFAULT '{}',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.platform_schema_contracts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS platform_schema_contracts_read ON public.platform_schema_contracts;
CREATE POLICY platform_schema_contracts_read ON public.platform_schema_contracts FOR SELECT TO authenticated USING(true);
REVOKE INSERT,UPDATE,DELETE ON public.platform_schema_contracts FROM anon,authenticated;
GRANT SELECT ON public.platform_schema_contracts TO authenticated;
GRANT ALL ON public.platform_schema_contracts TO service_role;

INSERT INTO public.platform_schema_contracts(schema_contract_version,application_version,required_tables,required_functions,retired_objects,notes)
VALUES('2026.08.23.12','2.1.0',
 ARRAY['organizations','organization_members','platform_tools','organization_tools','organization_tool_installations','tool_user_sessions','leads','lead_identity_registry','contact_suppressions','queues','queue_items','sents','conversations','conversation_messages','maps_search_executions','maps_search_candidates','capture_execution_events','instagram_queue_progress','instagram_profile_runtime','permanent_records','permanent_record_events','platform_runtime_heartbeats','operational_alerts','recovery_requests','audit_events'],
 ARRAY['current_organization_id','require_organization_permission','append_audit_event','service_capture_identity_gate','instagram_claim_queue_item_v2','instagram_update_queue_progress_v2','commercial_reentry_decision','service_runtime_heartbeat','get_operational_health'],
 ARRAY['maps_extension_installations','maps_extension_pairings','instagram_claim_queue_item','instagram_update_queue_progress','get_operational_health_rbac_inner'],
 'Contrato consolidado das Etapas 2–12; bridges de Maps/Instagram antigas deixam de ser contratos oficiais.')
ON CONFLICT(schema_contract_version) DO UPDATE SET application_version=excluded.application_version,required_tables=excluded.required_tables,required_functions=excluded.required_functions,retired_objects=excluded.retired_objects,notes=excluded.notes;

INSERT INTO public.platform_schema_releases(release_key,application_version,migration_count,base_schema_sha256,notes,schema_contract_version,minimum_application_version,is_stable,metadata)
VALUES('stage-12-consolidation-20260823','2.1.0',18,encode(extensions.digest('stage-12-consolidation-20260823','sha256'),'hex'),'Schema oficial multi-organização consolidado até a Etapa 12.','2026.08.23.12','2.1.0',false,jsonb_build_object('stages',jsonb_build_array(1,2,3,4,5,6,7,8,9,10,11,12)))
ON CONFLICT(release_key) DO UPDATE SET application_version=excluded.application_version,migration_count=excluded.migration_count,base_schema_sha256=excluded.base_schema_sha256,notes=excluded.notes,schema_contract_version=excluded.schema_contract_version,minimum_application_version=excluded.minimum_application_version,metadata=excluded.metadata,applied_at=now();

-- Diagnóstico verificável de contrato atual.
CREATE OR REPLACE FUNCTION public.platform_schema_health()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO pg_catalog,public AS $$
DECLARE v_contract public.platform_schema_contracts%ROWTYPE;v_missing_tables text[]:=ARRAY[]::text[];v_missing_functions text[]:=ARRAY[]::text[];v_retired_present text[]:=ARRAY[]::text[];v_name text;
BEGIN
 SELECT * INTO v_contract FROM public.platform_schema_contracts ORDER BY created_at DESC,schema_contract_version DESC LIMIT 1;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','schema_contract_not_found','checkedAt',now());END IF;
 FOREACH v_name IN ARRAY v_contract.required_tables LOOP IF to_regclass('public.'||v_name) IS NULL THEN v_missing_tables:=array_append(v_missing_tables,v_name);END IF;END LOOP;
 FOREACH v_name IN ARRAY v_contract.required_functions LOOP IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=v_name) THEN v_missing_functions:=array_append(v_missing_functions,v_name);END IF;END LOOP;
 FOREACH v_name IN ARRAY v_contract.retired_objects LOOP IF to_regclass('public.'||v_name) IS NOT NULL OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=v_name) THEN v_retired_present:=array_append(v_retired_present,v_name);END IF;END LOOP;
 RETURN jsonb_build_object('ok',cardinality(v_missing_tables)=0 AND cardinality(v_missing_functions)=0,'contractVersion',v_contract.schema_contract_version,'applicationVersion',v_contract.application_version,'missingTables',to_jsonb(v_missing_tables),'missingFunctions',to_jsonb(v_missing_functions),'retiredObjectsStillPresent',to_jsonb(v_retired_present),'checkedAt',now());
END; $$;
GRANT EXECUTE ON FUNCTION public.platform_schema_health() TO authenticated,service_role;

-- Contratos antigos que já possuem substitutos oficiais. CASCADE não é usado para evitar remover dependências ocultas.
DROP FUNCTION IF EXISTS public.instagram_claim_queue_item(bigint,bigint,bigint,text);
DROP FUNCTION IF EXISTS public.instagram_update_queue_progress(bigint,bigint,uuid,text,text,jsonb);
DROP FUNCTION IF EXISTS public.get_operational_health_rbac_inner();
DROP FUNCTION IF EXISTS public.request_operational_recovery_rbac_inner(text);

-- RLS sanity: objetos de negócio tenant-aware permanecem sem escrita direta authenticated.
DO $rls_sanity$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['lead_identity_registry','contact_suppressions','permanent_records','permanent_record_events','capture_execution_events','instagram_queue_progress','instagram_dispatch_events','platform_runtime_heartbeats','operational_alerts','recovery_requests'] LOOP
  IF to_regclass('public.'||t) IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE INSERT,UPDATE,DELETE ON public.%I FROM anon,authenticated',t);
  END IF;
 END LOOP;
END
$rls_sanity$;

COMMIT;

-- ======================================================================
-- ETAPA 13
-- ======================================================================
BEGIN;

-- ETAPA 13 — orquestração ponta a ponta da operação.

DO $stage_preflight$
DECLARE v_missing text[]:=ARRAY[]::text[]; v_name text;
BEGIN
  FOREACH v_name IN ARRAY ARRAY['platform_schema_contracts','permanent_records'] LOOP IF to_regclass('public.'||v_name) IS NULL THEN v_missing:=array_append(v_missing,'table:'||v_name);END IF;END LOOP;
  FOREACH v_name IN ARRAY ARRAY['platform_schema_health'] LOOP IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=v_name) THEN v_missing:=array_append(v_missing,'function:'||v_name);END IF;END LOOP;
  IF cardinality(v_missing)>0 THEN RAISE EXCEPTION 'stage_preflight_failed:%',array_to_string(v_missing,',');END IF;
END
$stage_preflight$;

CREATE TABLE IF NOT EXISTS public.lead_orchestration_state (
  lead_orchestration_state_id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  organizations_id bigint NOT NULL REFERENCES public.organizations(organizations_id) ON DELETE CASCADE,
  leads_id bigint NOT NULL REFERENCES public.leads(leads_id) ON DELETE CASCADE,
  orchestration_state text NOT NULL DEFAULT 'waiting_validation' CHECK(orchestration_state IN ('waiting_validation','eligible','blocked','capacity_wait','queued','dispatching','sent','responded','finalized','reconciliation_required','error')),
  routed_channel text CHECK(routed_channel IS NULL OR routed_channel IN ('whatsapp','instagram')),
  resource_id bigint,
  templates_id bigint REFERENCES public.templates(templates_id) ON DELETE SET NULL,
  queue_items_id bigint REFERENCES public.queue_items(queue_items_id) ON DELETE SET NULL,
  block_reason text,
  next_attempt_at timestamptz,
  last_evaluated_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organizations_id,leads_id)
);
CREATE INDEX IF NOT EXISTS lead_orchestration_state_pending_idx ON public.lead_orchestration_state(organizations_id,orchestration_state,next_attempt_at,last_evaluated_at);
ALTER TABLE public.lead_orchestration_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lead_orchestration_state_org_select ON public.lead_orchestration_state;
CREATE POLICY lead_orchestration_state_org_select ON public.lead_orchestration_state FOR SELECT TO authenticated USING(organizations_id=public.current_organization_id() AND public.has_organization_permission('leads.view'));
REVOKE INSERT,UPDATE,DELETE ON public.lead_orchestration_state FROM anon,authenticated;GRANT SELECT ON public.lead_orchestration_state TO authenticated;GRANT ALL ON public.lead_orchestration_state TO service_role;

CREATE TABLE IF NOT EXISTS public.lead_lifecycle_events (
  lead_lifecycle_events_id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  organizations_id bigint NOT NULL REFERENCES public.organizations(organizations_id) ON DELETE CASCADE,
  leads_id bigint NOT NULL REFERENCES public.leads(leads_id) ON DELETE CASCADE,
  event_type text NOT NULL,
  channel text,
  entity_type text,
  entity_id text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lead_lifecycle_events_lead_idx ON public.lead_lifecycle_events(organizations_id,leads_id,created_at,lead_lifecycle_events_id);
ALTER TABLE public.lead_lifecycle_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lead_lifecycle_events_org_select ON public.lead_lifecycle_events;
CREATE POLICY lead_lifecycle_events_org_select ON public.lead_lifecycle_events FOR SELECT TO authenticated USING(organizations_id=public.current_organization_id() AND public.has_organization_permission('leads.view'));
REVOKE INSERT,UPDATE,DELETE ON public.lead_lifecycle_events FROM anon,authenticated;GRANT SELECT ON public.lead_lifecycle_events TO authenticated;GRANT ALL ON public.lead_lifecycle_events TO service_role;

CREATE OR REPLACE FUNCTION public.service_set_orchestration_state(p_organizations_id bigint,p_leads_id bigint,p_state text,p_channel text DEFAULT NULL,p_resource_id bigint DEFAULT NULL,p_templates_id bigint DEFAULT NULL,p_queue_items_id bigint DEFAULT NULL,p_reason text DEFAULT NULL,p_metadata jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required';END IF;
 INSERT INTO public.lead_orchestration_state(organizations_id,leads_id,orchestration_state,routed_channel,resource_id,templates_id,queue_items_id,block_reason,next_attempt_at,last_evaluated_at,metadata)
 VALUES(p_organizations_id,p_leads_id,p_state,p_channel,p_resource_id,p_templates_id,p_queue_items_id,p_reason,CASE WHEN p_state='capacity_wait' THEN now()+interval '10 minutes' ELSE NULL END,now(),coalesce(p_metadata,'{}'))
 ON CONFLICT(organizations_id,leads_id) DO UPDATE SET orchestration_state=excluded.orchestration_state,routed_channel=excluded.routed_channel,resource_id=excluded.resource_id,templates_id=excluded.templates_id,queue_items_id=excluded.queue_items_id,block_reason=excluded.block_reason,next_attempt_at=excluded.next_attempt_at,last_evaluated_at=now(),metadata=public.lead_orchestration_state.metadata||excluded.metadata,updated_at=now();
 INSERT INTO public.lead_lifecycle_events(organizations_id,leads_id,event_type,channel,entity_type,entity_id,payload) VALUES(p_organizations_id,p_leads_id,'orchestration:'||p_state,p_channel,'lead',p_leads_id::text,jsonb_build_object('reason',p_reason,'resourceId',p_resource_id,'templateId',p_templates_id,'queueItemId',p_queue_items_id)||coalesce(p_metadata,'{}'));
END; $$;
REVOKE ALL ON FUNCTION public.service_set_orchestration_state(bigint,bigint,text,text,bigint,bigint,bigint,text,jsonb) FROM PUBLIC,anon,authenticated;GRANT EXECUTE ON FUNCTION public.service_set_orchestration_state(bigint,bigint,text,text,bigint,bigint,bigint,text,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.service_orchestrate_lead(p_organizations_id bigint,p_leads_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE l public.leads%ROWTYPE;v_channel text;v_channel_id bigint;v_resource bigint;v_template bigint;v_queue bigint;v_item bigint;v_user bigint;v_name text;v_usage integer;v_limit integer;v_reentry jsonb;v_capacity jsonb;v_existing bigint;v_has_phone boolean;v_has_instagram boolean;
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required';END IF;
 SELECT * INTO l FROM public.leads WHERE organizations_id=p_organizations_id AND leads_id=p_leads_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('outcome','not_found');END IF;
 v_user:=l.users_id;v_has_phone:=length(regexp_replace(coalesce(l.leads_whatsapp,l.leads_phone,''),'\\D','','g'))>=10;v_has_instagram:=nullif(trim(coalesce(l.leads_instagram,'')),'') IS NOT NULL;
 IF l.lead_status_id=5 THEN PERFORM public.service_set_orchestration_state(p_organizations_id,p_leads_id,'sent',NULL,NULL,NULL,NULL,NULL,'{}');RETURN jsonb_build_object('outcome','sent');END IF;
 IF l.lead_status_id IN(6,7,8) THEN PERFORM public.service_set_orchestration_state(p_organizations_id,p_leads_id,'finalized',NULL,NULL,NULL,NULL,'lead_finalized','{}');RETURN jsonb_build_object('outcome','finalized');END IF;
 IF l.lead_status_id<>2 THEN PERFORM public.service_set_orchestration_state(p_organizations_id,p_leads_id,'waiting_validation',NULL,NULL,NULL,NULL,'lead_not_validated',jsonb_build_object('statusId',l.lead_status_id));RETURN jsonb_build_object('outcome','waiting_validation');END IF;
 IF EXISTS(SELECT 1 FROM public.contact_suppressions s WHERE s.organizations_id=p_organizations_id AND s.is_active AND (s.expires_at IS NULL OR s.expires_at>now()) AND ((s.identity_type='phone' AND s.identity_value=l.leads_normalized_phone) OR (s.identity_type='instagram' AND s.identity_value=l.leads_normalized_instagram) OR (s.identity_type='domain' AND s.identity_value=l.leads_normalized_domain) OR (s.identity_type='maps' AND s.identity_value=l.leads_normalized_maps))) THEN
   PERFORM public.service_set_orchestration_state(p_organizations_id,p_leads_id,'blocked',NULL,NULL,NULL,NULL,'contact_suppressed','{}');RETURN jsonb_build_object('outcome','blocked','reason','contact_suppressed');
 END IF;
 IF EXISTS(SELECT 1 FROM public.permanent_records pr WHERE pr.organizations_id=p_organizations_id AND pr.canonical_lead_id=coalesce(l.canonical_lead_id,l.leads_id)) THEN
   v_reentry:=public.commercial_reentry_decision(p_organizations_id,coalesce(l.canonical_lead_id,l.leads_id),now());
   IF coalesce((v_reentry->>'allowed')::boolean,false)=false THEN PERFORM public.service_set_orchestration_state(p_organizations_id,p_leads_id,'blocked',NULL,NULL,NULL,NULL,'commercial_reentry_blocked',v_reentry);RETURN jsonb_build_object('outcome','blocked','reason','commercial_reentry_blocked','decision',v_reentry);END IF;
 END IF;
 -- O canal já validado é soberano. Fallback só é usado se o registro legado não tiver canal.
 IF l.channels_id=1 AND v_has_phone THEN v_channel:='whatsapp';v_channel_id:=1;
 ELSIF l.channels_id=2 AND v_has_instagram THEN v_channel:='instagram';v_channel_id:=2;
 ELSIF v_has_phone THEN v_channel:='whatsapp';v_channel_id:=1;
 ELSIF v_has_instagram THEN v_channel:='instagram';v_channel_id:=2;
 ELSE PERFORM public.service_set_orchestration_state(p_organizations_id,p_leads_id,'blocked',NULL,NULL,NULL,NULL,'no_supported_contact','{}');RETURN jsonb_build_object('outcome','blocked','reason','no_supported_contact');END IF;

 -- Item ativo existente vence qualquer nova preparação.
 SELECT qi.queue_items_id INTO v_existing FROM public.queue_items qi JOIN public.queues q ON q.queues_id=qi.queues_id WHERE qi.organizations_id=p_organizations_id AND qi.leads_id=p_leads_id AND q.channels_id=v_channel_id AND qi.status_id IN(3,4,5,8) ORDER BY qi.queue_items_created_at DESC LIMIT 1;
 IF v_existing IS NOT NULL THEN PERFORM public.service_set_orchestration_state(p_organizations_id,p_leads_id,CASE WHEN EXISTS(SELECT 1 FROM public.queue_items WHERE queue_items_id=v_existing AND status_id=5) THEN 'sent' ELSE 'queued' END,v_channel,NULL,NULL,v_existing,NULL,'{}');RETURN jsonb_build_object('outcome','already_queued','queueItemId',v_existing,'channel',v_channel);END IF;

 IF v_channel='whatsapp' THEN
   SELECT c.chips_id,lv.levels_daily_limit INTO v_resource,v_limit FROM public.chips c JOIN public.instances i ON i.instances_id=c.instances_id AND i.organizations_id=p_organizations_id JOIN public.levels lv ON lv.levels_id=c.levels_id AND lv.organizations_id=p_organizations_id
   WHERE c.organizations_id=p_organizations_id AND c.status_id=1 AND i.status_id=1 AND lv.status_id=1
   ORDER BY (SELECT count(*) FROM public.queue_items qi WHERE qi.organizations_id=p_organizations_id AND qi.chips_id=c.chips_id AND qi.status_id IN(3,4,5,8) AND coalesce(qi.queue_items_scheduled_at,qi.queue_items_created_at)::date=current_date),c.chips_id LIMIT 1;
   IF v_resource IS NOT NULL THEN SELECT count(*) INTO v_usage FROM public.queue_items qi WHERE qi.organizations_id=p_organizations_id AND qi.chips_id=v_resource AND qi.status_id IN(3,4,5,8) AND coalesce(qi.queue_items_scheduled_at,qi.queue_items_created_at)::date=current_date;END IF;
   IF v_resource IS NULL OR coalesce(v_usage,0)>=coalesce(v_limit,0) THEN PERFORM public.service_set_orchestration_state(p_organizations_id,p_leads_id,'capacity_wait',v_channel,NULL,NULL,NULL,'whatsapp_capacity_unavailable','{}');RETURN jsonb_build_object('outcome','capacity_wait','channel',v_channel);END IF;
 ELSE
   SELECT s.socials_id,public.instagram_profile_capacity(p_organizations_id,s.socials_id,now()) INTO v_resource,v_capacity FROM public.socials s WHERE s.organizations_id=p_organizations_id AND s.status_id=1 ORDER BY s.socials_id LIMIT 1;
   IF v_resource IS NULL OR coalesce((v_capacity->>'allowed')::boolean,false)=false OR coalesce((v_capacity->>'withinWindow')::boolean,false)=false OR coalesce((v_capacity->>'remaining')::integer,0)<=0 THEN PERFORM public.service_set_orchestration_state(p_organizations_id,p_leads_id,'capacity_wait',v_channel,NULL,NULL,NULL,'instagram_capacity_unavailable',coalesce(v_capacity,'{}'));RETURN jsonb_build_object('outcome','capacity_wait','channel',v_channel);END IF;
 END IF;

 -- Template ativo do mesmo ramo. Priorizamos template explicitamente rotulado para o canal.
 SELECT t.templates_id INTO v_template FROM public.templates t LEFT JOIN public.template_channels tc ON tc.template_channels_id=t.template_channels_id WHERE t.organizations_id=p_organizations_id AND t.status_id=1 AND t.branches_id=l.branches_id ORDER BY CASE WHEN lower(coalesce(tc.template_channels_name,'')) LIKE '%'||v_channel||'%' THEN 0 ELSE 1 END,t.templates_id LIMIT 1;
 IF v_template IS NULL THEN PERFORM public.service_set_orchestration_state(p_organizations_id,p_leads_id,'blocked',v_channel,v_resource,NULL,NULL,'template_missing','{}');RETURN jsonb_build_object('outcome','blocked','reason','template_missing','channel',v_channel);END IF;

 PERFORM pg_advisory_xact_lock(hashtextextended(format('orchestrate:%s:%s:%s:%s',p_organizations_id,v_channel,v_resource,current_date),0));
 v_name:=format('Orquestração %s %s #%s',initcap(v_channel),to_char(current_date,'YYYY-MM-DD'),v_resource);
 SELECT queues_id INTO v_queue FROM public.queues WHERE organizations_id=p_organizations_id AND queues_name=v_name LIMIT 1;
 IF v_queue IS NULL THEN INSERT INTO public.queues(users_id,organizations_id,channels_id,status_id,queues_name,queues_scheduled_at) VALUES(v_user,p_organizations_id,v_channel_id,3,v_name,current_date::timestamptz) RETURNING queues_id INTO v_queue;END IF;
 INSERT INTO public.queue_items(users_id,organizations_id,queues_id,leads_id,chips_id,socials_id,templates_id,status_id,queue_items_position,queue_items_attempts,queue_items_scheduled_at)
 VALUES(v_user,p_organizations_id,v_queue,p_leads_id,CASE WHEN v_channel='whatsapp' THEN v_resource ELSE NULL END,CASE WHEN v_channel='instagram' THEN v_resource ELSE NULL END,v_template,3,(SELECT coalesce(max(queue_items_position),0)+1 FROM public.queue_items WHERE queues_id=v_queue),0,current_date::timestamptz)
 ON CONFLICT(queues_id,leads_id) DO UPDATE SET templates_id=excluded.templates_id RETURNING queue_items_id INTO v_item;
 UPDATE public.leads SET channels_id=v_channel_id,lead_status_id=4,leads_updated_at=now() WHERE leads_id=p_leads_id AND organizations_id=p_organizations_id AND lead_status_id=2;
 PERFORM public.service_set_orchestration_state(p_organizations_id,p_leads_id,'queued',v_channel,v_resource,v_template,v_item,NULL,jsonb_build_object('queueId',v_queue));
 RETURN jsonb_build_object('outcome','queued','channel',v_channel,'resourceId',v_resource,'templateId',v_template,'queueId',v_queue,'queueItemId',v_item);
EXCEPTION WHEN OTHERS THEN
 PERFORM public.service_set_orchestration_state(p_organizations_id,p_leads_id,'error',v_channel,v_resource,v_template,v_item,SQLERRM,'{}');
 RETURN jsonb_build_object('outcome','error','error',SQLERRM);
END; $$;
REVOKE ALL ON FUNCTION public.service_orchestrate_lead(bigint,bigint) FROM PUBLIC,anon,authenticated;GRANT EXECUTE ON FUNCTION public.service_orchestrate_lead(bigint,bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.service_orchestrate_ready_leads(p_organizations_id bigint,p_limit integer DEFAULT 25)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE r record;v_results jsonb:='[]'::jsonb;v_result jsonb;v_limit integer:=least(greatest(coalesce(p_limit,25),1),100);
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required';END IF;
 FOR r IN SELECT l.leads_id FROM public.leads l LEFT JOIN public.lead_orchestration_state os ON os.organizations_id=l.organizations_id AND os.leads_id=l.leads_id WHERE l.organizations_id=p_organizations_id AND l.lead_status_id=2 AND (os.leads_id IS NULL OR os.orchestration_state IN('eligible','capacity_wait','error','waiting_validation') AND (os.next_attempt_at IS NULL OR os.next_attempt_at<=now())) ORDER BY l.leads_priority_score DESC NULLS LAST,l.leads_created_at,l.leads_id LIMIT v_limit FOR UPDATE OF l SKIP LOCKED LOOP
   v_result:=public.service_orchestrate_lead(p_organizations_id,r.leads_id);v_results:=v_results||jsonb_build_array(jsonb_build_object('leadId',r.leads_id)||v_result);
 END LOOP;
 RETURN jsonb_build_object('processed',jsonb_array_length(v_results),'results',v_results);
END; $$;
REVOKE ALL ON FUNCTION public.service_orchestrate_ready_leads(bigint,integer) FROM PUBLIC,anon,authenticated;GRANT EXECUTE ON FUNCTION public.service_orchestrate_ready_leads(bigint,integer) TO service_role;

-- Timeline automática para os principais estados do ciclo.
CREATE OR REPLACE FUNCTION public.record_lead_lifecycle_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_lead bigint;v_org bigint;v_event text;v_channel text;v_entity_id text;
BEGIN
 IF TG_TABLE_NAME='leads' THEN v_lead:=NEW.leads_id;v_org:=NEW.organizations_id;v_event:=CASE WHEN TG_OP='INSERT' THEN 'lead:captured' ELSE 'lead:status_changed' END;v_channel:=CASE NEW.channels_id WHEN 1 THEN 'whatsapp' WHEN 2 THEN 'instagram' ELSE NULL END;v_entity_id:=NEW.leads_id::text;
 ELSIF TG_TABLE_NAME='queue_items' THEN v_lead:=NEW.leads_id;v_org:=NEW.organizations_id;v_event:=CASE NEW.status_id WHEN 3 THEN 'queue:queued' WHEN 4 THEN 'queue:processing' WHEN 5 THEN 'queue:completed' WHEN 6 THEN 'queue:error' ELSE 'queue:changed' END;v_entity_id:=NEW.queue_items_id::text;
 ELSIF TG_TABLE_NAME='sents' THEN v_lead:=NEW.leads_id;v_org:=NEW.organizations_id;v_event:=CASE WHEN NEW.sents_sent_at IS NOT NULL THEN 'dispatch:sent' WHEN NEW.status_id=6 THEN 'dispatch:error' ELSE 'dispatch:changed' END;v_channel:=CASE NEW.channels_id WHEN 1 THEN 'whatsapp' WHEN 2 THEN 'instagram' ELSE NULL END;v_entity_id:=NEW.sents_id::text;
 ELSIF TG_TABLE_NAME='conversation_messages' THEN v_lead:=NEW.leads_id;v_org:=NEW.organizations_id;v_event:=CASE WHEN NEW.direction='inbound' THEN 'conversation:inbound' ELSE 'conversation:outbound' END;v_channel:='whatsapp';v_entity_id:=NEW.conversation_messages_id::text;
 END IF;
 IF v_lead IS NOT NULL AND v_org IS NOT NULL THEN INSERT INTO public.lead_lifecycle_events(organizations_id,leads_id,event_type,channel,entity_type,entity_id,payload) VALUES(v_org,v_lead,v_event,v_channel,TG_TABLE_NAME,v_entity_id,to_jsonb(NEW));END IF;
 RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS lead_lifecycle_leads ON public.leads;CREATE TRIGGER lead_lifecycle_leads AFTER INSERT OR UPDATE OF lead_status_id,channels_id ON public.leads FOR EACH ROW EXECUTE FUNCTION public.record_lead_lifecycle_event();
DROP TRIGGER IF EXISTS lead_lifecycle_queue_items ON public.queue_items;CREATE TRIGGER lead_lifecycle_queue_items AFTER INSERT OR UPDATE OF status_id ON public.queue_items FOR EACH ROW EXECUTE FUNCTION public.record_lead_lifecycle_event();
DROP TRIGGER IF EXISTS lead_lifecycle_sents ON public.sents;CREATE TRIGGER lead_lifecycle_sents AFTER INSERT OR UPDATE OF status_id,sents_sent_at ON public.sents FOR EACH ROW EXECUTE FUNCTION public.record_lead_lifecycle_event();
DROP TRIGGER IF EXISTS lead_lifecycle_conversation_messages ON public.conversation_messages;CREATE TRIGGER lead_lifecycle_conversation_messages AFTER INSERT ON public.conversation_messages FOR EACH ROW WHEN(NEW.leads_id IS NOT NULL) EXECUTE FUNCTION public.record_lead_lifecycle_event();

COMMIT;

-- ======================================================================
-- ETAPA 14
-- ======================================================================
BEGIN;

-- ETAPA 14 — instalação, atualização, backup e portabilidade.
-- O backup físico dos volumes é executado pelo Gerenciador Desktop; o banco mantém
-- a matriz oficial de compatibilidade para impedir combinações silenciosamente incompatíveis.

DO $stage_preflight$
DECLARE v_missing text[]:=ARRAY[]::text[]; v_name text;
BEGIN
  FOREACH v_name IN ARRAY ARRAY['platform_schema_contracts'] LOOP IF to_regclass('public.'||v_name) IS NULL THEN v_missing:=array_append(v_missing,'table:'||v_name);END IF;END LOOP;
  FOREACH v_name IN ARRAY ARRAY['service_orchestrate_ready_leads','tool_semver_is_valid'] LOOP IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=v_name) THEN v_missing:=array_append(v_missing,'function:'||v_name);END IF;END LOOP;
  IF cardinality(v_missing)>0 THEN RAISE EXCEPTION 'stage_preflight_failed:%',array_to_string(v_missing,',');END IF;
END
$stage_preflight$;

CREATE TABLE IF NOT EXISTS public.platform_release_channels (
  component_key text PRIMARY KEY,
  display_name text NOT NULL,
  latest_version text NOT NULL,
  minimum_supported_version text NOT NULL,
  stable_version text,
  release_channel text NOT NULL DEFAULT 'stable' CHECK(release_channel IN ('stable','preview','legacy')),
  update_required boolean NOT NULL DEFAULT false,
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(metadata)='object'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_release_latest_semver CHECK(public.tool_semver_is_valid(latest_version)),
  CONSTRAINT platform_release_minimum_semver CHECK(public.tool_semver_is_valid(minimum_supported_version)),
  CONSTRAINT platform_release_stable_semver CHECK(stable_version IS NULL OR public.tool_semver_is_valid(stable_version))
);
ALTER TABLE public.platform_release_channels ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS platform_release_channels_read ON public.platform_release_channels;
CREATE POLICY platform_release_channels_read ON public.platform_release_channels FOR SELECT TO authenticated USING(true);
REVOKE INSERT,UPDATE,DELETE ON public.platform_release_channels FROM anon,authenticated;
GRANT SELECT ON public.platform_release_channels TO authenticated;
GRANT ALL ON public.platform_release_channels TO service_role;

INSERT INTO public.platform_release_channels(component_key,display_name,latest_version,minimum_supported_version,stable_version,release_channel,update_required,notes,metadata)
VALUES
 ('crm','CRM - Vinsansi Studio','2.3.0','2.3.0',NULL,'preview',true,'Release da Etapa 14; a Stable é promovida somente na Etapa 15.',jsonb_build_object('stage',14)),
 ('manager','CRM - Gerenciador de Disparos','1.3.1','1.3.0',NULL,'preview',true,'Inclui instalador NSIS, atualização gerenciada e backup/restore portátil com volumes Docker.',jsonb_build_object('stage',14)),
 ('worker','Worker WhatsApp','3.13.1','3.13.0',NULL,'preview',true,'Worker organizacional com observabilidade e orquestração.',jsonb_build_object('stage',13)),
 ('gateway','Vinsansi WhatsApp Gateway','1.2.7','1.2.7','1.2.7','stable',false,'Gateway texto-only homologado na Etapa 5.',jsonb_build_object('stage',5)),
 ('evolution','Evolution Go','0.7.2','0.7.2','0.7.2','stable',false,'Provider WhatsApp fixado; nunca usar latest.',jsonb_build_object('stage',5)),
 ('capture','Vinsansi Captura','1.0.0','1.0.0',NULL,'preview',true,'Executor Google Maps oficial da Etapa 8.',jsonb_build_object('stage',8)),
 ('instagram','Vinsansi Instagram','2.0.2','2.0.0',NULL,'preview',true,'Executor outbound Instagram oficial da Etapa 9.',jsonb_build_object('stage',9))
ON CONFLICT(component_key) DO UPDATE SET display_name=excluded.display_name,latest_version=excluded.latest_version,minimum_supported_version=excluded.minimum_supported_version,stable_version=excluded.stable_version,release_channel=excluded.release_channel,update_required=excluded.update_required,notes=excluded.notes,metadata=excluded.metadata,updated_at=now();

CREATE OR REPLACE FUNCTION public.platform_semver_parts(p_version text)
RETURNS integer[] LANGUAGE plpgsql IMMUTABLE STRICT SET search_path TO pg_catalog,public AS $$
DECLARE v text:=trim(p_version);m text[];
BEGIN
 m:=regexp_match(v,'^([0-9]+)\.([0-9]+)\.([0-9]+)(?:[-+].*)?$');
 IF m IS NULL THEN RETURN NULL;END IF;
 RETURN ARRAY[m[1]::integer,m[2]::integer,m[3]::integer];
END; $$;

CREATE OR REPLACE FUNCTION public.platform_semver_compare(p_left text,p_right text)
RETURNS integer LANGUAGE plpgsql IMMUTABLE STRICT SET search_path TO pg_catalog,public AS $$
DECLARE a integer[]:=public.platform_semver_parts(p_left);b integer[]:=public.platform_semver_parts(p_right);i integer;
BEGIN
 IF a IS NULL OR b IS NULL THEN RAISE EXCEPTION 'invalid_semver';END IF;
 FOR i IN 1..3 LOOP IF a[i]<b[i] THEN RETURN -1;ELSIF a[i]>b[i] THEN RETURN 1;END IF;END LOOP;RETURN 0;
END; $$;

CREATE OR REPLACE FUNCTION public.platform_component_compatibility(p_component_key text,p_version text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO pg_catalog,public AS $$
DECLARE r public.platform_release_channels%ROWTYPE;v_cmp integer;
BEGIN
 SELECT * INTO r FROM public.platform_release_channels WHERE component_key=lower(trim(p_component_key));
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'compatible',false,'error','component_unknown','component',p_component_key);END IF;
 IF NOT public.tool_semver_is_valid(p_version) THEN RETURN jsonb_build_object('ok',false,'compatible',false,'error','version_invalid','component',r.component_key,'version',p_version);END IF;
 v_cmp:=public.platform_semver_compare(p_version,r.minimum_supported_version);
 RETURN jsonb_build_object('ok',true,'compatible',v_cmp>=0,'component',r.component_key,'version',p_version,'minimumSupportedVersion',r.minimum_supported_version,'latestVersion',r.latest_version,'stableVersion',r.stable_version,'releaseChannel',r.release_channel,'updateRequired',v_cmp<0 OR (r.update_required AND public.platform_semver_compare(p_version,r.latest_version)<0));
END; $$;
GRANT EXECUTE ON FUNCTION public.platform_component_compatibility(text,text) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.platform_release_matrix()
RETURNS jsonb LANGUAGE sql SECURITY DEFINER STABLE SET search_path TO pg_catalog,public AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('component',component_key,'name',display_name,'latestVersion',latest_version,'minimumSupportedVersion',minimum_supported_version,'stableVersion',stable_version,'channel',release_channel,'updateRequired',update_required,'notes',notes) ORDER BY component_key),'[]'::jsonb) FROM public.platform_release_channels;
$$;
GRANT EXECUTE ON FUNCTION public.platform_release_matrix() TO authenticated,service_role;

-- Contrato de schema da Etapa 14 já inclui toda a orquestração da Etapa 13 e a matriz de releases.
INSERT INTO public.platform_schema_contracts(schema_contract_version,application_version,required_tables,required_functions,retired_objects,notes)
VALUES('2026.08.24.14','2.3.0',
 ARRAY['organizations','organization_members','platform_tools','organization_tool_installations','tool_browser_pairings','leads','lead_identity_registry','contact_suppressions','queues','queue_items','sents','conversations','conversation_messages','capture_execution_events','instagram_queue_progress','permanent_records','platform_runtime_heartbeats','operational_alerts','lead_orchestration_state','lead_lifecycle_events','platform_release_channels'],
 ARRAY['append_audit_event','service_capture_identity_gate','instagram_claim_queue_item_v2','commercial_reentry_decision','service_runtime_heartbeat','platform_schema_health','service_orchestrate_ready_leads','platform_component_compatibility','platform_release_matrix'],
 ARRAY['maps_extension_installations','maps_extension_pairings','instagram_claim_queue_item','instagram_update_queue_progress','get_operational_health_rbac_inner'],
 'Contrato completo até a Etapa 14, incluindo portabilidade do Desktop e matriz de compatibilidade de versões.')
ON CONFLICT(schema_contract_version) DO UPDATE SET application_version=excluded.application_version,required_tables=excluded.required_tables,required_functions=excluded.required_functions,retired_objects=excluded.retired_objects,notes=excluded.notes;

INSERT INTO public.platform_schema_releases(release_key,application_version,migration_count,base_schema_sha256,notes,schema_contract_version,minimum_application_version,is_stable,metadata)
VALUES('stage-14-portability-20260824','2.3.0',20,encode(extensions.digest('stage-14-portability-20260824','sha256'),'hex'),'Etapa 14: instalação, atualização, backup e portabilidade.','2026.08.24.14','2.3.0',false,jsonb_build_object('stages',jsonb_build_array(1,2,3,4,5,6,7,8,9,10,11,12,13,14),'portableBackupFormat',1))
ON CONFLICT(release_key) DO UPDATE SET application_version=excluded.application_version,migration_count=excluded.migration_count,base_schema_sha256=excluded.base_schema_sha256,notes=excluded.notes,schema_contract_version=excluded.schema_contract_version,minimum_application_version=excluded.minimum_application_version,is_stable=false,metadata=excluded.metadata,applied_at=now();

COMMIT;

-- ======================================================================
-- ETAPA 15
-- ======================================================================
BEGIN;

-- ETAPA 15 — homologação final, readiness verificável e promoção Stable.

DO $stage_preflight$
DECLARE v_missing text[]:=ARRAY[]::text[]; v_name text;
BEGIN
  FOREACH v_name IN ARRAY ARRAY['platform_release_channels','lead_lifecycle_events'] LOOP IF to_regclass('public.'||v_name) IS NULL THEN v_missing:=array_append(v_missing,'table:'||v_name);END IF;END LOOP;
  FOREACH v_name IN ARRAY ARRAY['platform_release_matrix'] LOOP IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=v_name) THEN v_missing:=array_append(v_missing,'function:'||v_name);END IF;END LOOP;
  IF cardinality(v_missing)>0 THEN RAISE EXCEPTION 'stage_preflight_failed:%',array_to_string(v_missing,',');END IF;
END
$stage_preflight$;

CREATE TABLE IF NOT EXISTS public.production_homologation_runs (
  production_homologation_runs_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizations_id bigint NOT NULL REFERENCES public.organizations(organizations_id) ON DELETE CASCADE,
  started_by_member_id bigint REFERENCES public.organization_members(organization_members_id) ON DELETE SET NULL,
  release_version text NOT NULL,
  status text NOT NULL DEFAULT 'running' CHECK(status IN ('running','passed','failed','cancelled')),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  notes text,
  UNIQUE(organizations_id,production_homologation_runs_id)
);
CREATE INDEX IF NOT EXISTS production_homologation_runs_org_idx ON public.production_homologation_runs(organizations_id,started_at DESC);

CREATE TABLE IF NOT EXISTS public.production_homologation_checks (
  production_homologation_checks_id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  organizations_id bigint NOT NULL REFERENCES public.organizations(organizations_id) ON DELETE CASCADE,
  production_homologation_runs_id uuid NOT NULL REFERENCES public.production_homologation_runs(production_homologation_runs_id) ON DELETE CASCADE,
  check_key text NOT NULL,
  section text NOT NULL,
  label text NOT NULL,
  required boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','passed','failed','not_applicable')),
  evidence text,
  checked_by_member_id bigint REFERENCES public.organization_members(organization_members_id) ON DELETE SET NULL,
  checked_at timestamptz,
  sort_order integer NOT NULL DEFAULT 0,
  UNIQUE(production_homologation_runs_id,check_key)
);
CREATE INDEX IF NOT EXISTS production_homologation_checks_run_idx ON public.production_homologation_checks(organizations_id,production_homologation_runs_id,sort_order);

ALTER TABLE public.production_homologation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_homologation_checks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS production_homologation_runs_org_select ON public.production_homologation_runs;
CREATE POLICY production_homologation_runs_org_select ON public.production_homologation_runs FOR SELECT TO authenticated USING(organizations_id=public.current_organization_id() AND public.has_organization_permission('monitoring.view'));
DROP POLICY IF EXISTS production_homologation_checks_org_select ON public.production_homologation_checks;
CREATE POLICY production_homologation_checks_org_select ON public.production_homologation_checks FOR SELECT TO authenticated USING(organizations_id=public.current_organization_id() AND public.has_organization_permission('monitoring.view'));
REVOKE INSERT,UPDATE,DELETE ON public.production_homologation_runs FROM anon,authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.production_homologation_checks FROM anon,authenticated;
GRANT SELECT ON public.production_homologation_runs,public.production_homologation_checks TO authenticated;
GRANT ALL ON public.production_homologation_runs,public.production_homologation_checks TO service_role;

CREATE OR REPLACE FUNCTION public.start_production_homologation(p_notes text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_org bigint:=public.current_organization_id();v_member bigint:=public.current_organization_member_id();v_run uuid:=gen_random_uuid();
BEGIN
 PERFORM public.require_organization_permission('monitoring.manage');
 INSERT INTO public.production_homologation_runs(production_homologation_runs_id,organizations_id,started_by_member_id,release_version,notes) VALUES(v_run,v_org,v_member,'2.4.0',nullif(trim(coalesce(p_notes,'')),''));
 INSERT INTO public.production_homologation_checks(organizations_id,production_homologation_runs_id,check_key,section,label,sort_order) VALUES
 (v_org,v_run,'organization_isolation','Organizações','Isolamento entre organizações e permissões/RBAC validado',10),
 (v_org,v_run,'capture_pairing','Vinsansi Captura','Pairing por organização, configuração central e heartbeat funcionando',20),
 (v_org,v_run,'capture_resume','Vinsansi Captura','Captura real pausa/retoma sem duplicar e importa incrementalmente',30),
 (v_org,v_run,'capture_dedup','Vinsansi Captura','Duplicados e suprimidos são bloqueados antes da reentrada',40),
 (v_org,v_run,'instagram_pairing','Vinsansi Instagram','Perfil vinculado à organização e fila canônica carregada',50),
 (v_org,v_run,'instagram_resume','Vinsansi Instagram','Pausa/restart continua do checkpoint sem repetir DM',60),
 (v_org,v_run,'instagram_limits','Vinsansi Instagram','Limites, janela e capacidade por perfil respeitados',70),
 (v_org,v_run,'permanent_memory','Base Permanente','Uma identidade comercial concentra histórico, canais e resultado',80),
 (v_org,v_run,'suppression_reentry','Base Permanente','Supressão e cooldown de reentrada validados',90),
 (v_org,v_run,'whatsapp_text','WhatsApp','Envio/recebimento texto, realtime e status entregue/lido validados',100),
 (v_org,v_run,'whatsapp_identity','WhatsApp','LID/telefone converge no mesmo chip e não cruza chips',110),
 (v_org,v_run,'whatsapp_reconnect','WhatsApp','Reinício/reconexão preserva sessões e conversas',120),
 (v_org,v_run,'observability','Observabilidade','Heartbeats, alertas e diagnóstico detectam componente parado',130),
 (v_org,v_run,'recovery','Observabilidade','Recuperação controlada libera stale sem duplicar envio',140),
 (v_org,v_run,'audit_append_only','Auditoria','Auditoria append-only registra ator, organização, antes/depois',150),
 (v_org,v_run,'state_machine','Auditoria','Transições inválidas são bloqueadas pelo PostgreSQL',160),
 (v_org,v_run,'orchestration_e2e','Orquestração','Lead real percorre captura → validação → fila → envio → memória sem SQL manual',170),
 (v_org,v_run,'backup_restore','Portabilidade','Backup portátil restaurado em ambiente limpo com volumes e credenciais',180),
 (v_org,v_run,'clean_install','Portabilidade','Instalação do zero concluída sem editar código/usar terminal na operação normal',190),
 (v_org,v_run,'upgrade_existing','Portabilidade','Upgrade da base existente chega ao mesmo contrato do banco limpo',200),
 (v_org,v_run,'failure_matrix','Resiliência','Quedas de internet/processos/webhook repetido não corrompem estado nem duplicam envio',210),
 (v_org,v_run,'security_review','Segurança','RLS, service_role, secrets, CORS e rotas públicas revisados',220),
 (v_org,v_run,'performance','Performance','Volume realista de leads, filas, conversas e auditoria permanece operacional',230);
 PERFORM public.append_audit_event('production','start_homologation','production_homologation_run',v_run::text,NULL,NULL,NULL,NULL,NULL,NULL,jsonb_build_object('release','2.4.0'),NULL);
 RETURN v_run;
END; $$;
GRANT EXECUTE ON FUNCTION public.start_production_homologation(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_production_homologation_check(p_run_id uuid,p_check_key text,p_status text,p_evidence text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_org bigint:=public.current_organization_id();v_member bigint:=public.current_organization_member_id();v_status text:=lower(trim(p_status));v_required_pending integer;v_required_failed integer;
BEGIN
 PERFORM public.require_organization_permission('monitoring.manage');
 IF v_status NOT IN ('pending','passed','failed','not_applicable') THEN RAISE EXCEPTION 'homologation_status_invalid';END IF;
 UPDATE public.production_homologation_checks SET status=v_status,evidence=nullif(trim(coalesce(p_evidence,'')),''),checked_by_member_id=CASE WHEN v_status='pending' THEN NULL ELSE v_member END,checked_at=CASE WHEN v_status='pending' THEN NULL ELSE now() END WHERE organizations_id=v_org AND production_homologation_runs_id=p_run_id AND check_key=p_check_key;
 IF NOT FOUND THEN RAISE EXCEPTION 'homologation_check_not_found';END IF;
 SELECT count(*) FILTER(WHERE required AND status='pending'),count(*) FILTER(WHERE required AND status='failed') INTO v_required_pending,v_required_failed FROM public.production_homologation_checks WHERE organizations_id=v_org AND production_homologation_runs_id=p_run_id;
 UPDATE public.production_homologation_runs SET status=CASE WHEN v_required_failed>0 THEN 'failed' WHEN v_required_pending=0 THEN 'passed' ELSE 'running' END,completed_at=CASE WHEN v_required_pending=0 OR v_required_failed>0 THEN now() ELSE NULL END WHERE organizations_id=v_org AND production_homologation_runs_id=p_run_id;
 RETURN jsonb_build_object('runId',p_run_id,'pending',v_required_pending,'failed',v_required_failed,'status',CASE WHEN v_required_failed>0 THEN 'failed' WHEN v_required_pending=0 THEN 'passed' ELSE 'running' END);
END; $$;
GRANT EXECUTE ON FUNCTION public.set_production_homologation_check(uuid,text,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_production_homologation_snapshot(p_run_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO pg_catalog,public AS $$
DECLARE v_org bigint:=public.current_organization_id();v_run public.production_homologation_runs%ROWTYPE;v_checks jsonb;
BEGIN
 PERFORM public.require_organization_permission('monitoring.view');
 IF p_run_id IS NULL THEN SELECT * INTO v_run FROM public.production_homologation_runs WHERE organizations_id=v_org ORDER BY started_at DESC LIMIT 1;ELSE SELECT * INTO v_run FROM public.production_homologation_runs WHERE organizations_id=v_org AND production_homologation_runs_id=p_run_id;END IF;
 IF NOT FOUND THEN RETURN jsonb_build_object('run',NULL,'checks','[]'::jsonb);END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('key',check_key,'section',section,'label',label,'required',required,'status',status,'evidence',evidence,'checkedAt',checked_at,'checkedByMemberId',checked_by_member_id) ORDER BY sort_order,production_homologation_checks_id),'[]'::jsonb) INTO v_checks FROM public.production_homologation_checks WHERE organizations_id=v_org AND production_homologation_runs_id=v_run.production_homologation_runs_id;
 RETURN jsonb_build_object('run',jsonb_build_object('id',v_run.production_homologation_runs_id,'releaseVersion',v_run.release_version,'status',v_run.status,'startedAt',v_run.started_at,'completedAt',v_run.completed_at,'notes',v_run.notes),'checks',v_checks);
END; $$;
GRANT EXECUTE ON FUNCTION public.get_production_homologation_snapshot(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.platform_production_readiness()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO pg_catalog,public AS $$
DECLARE v_org bigint:=public.current_organization_id();v_schema jsonb;v_health jsonb;v_release jsonb;v_critical integer;v_homologation jsonb;v_hstatus text;
BEGIN
 PERFORM public.require_organization_permission('monitoring.view');
 v_schema:=public.platform_schema_health();v_health:=public.get_operational_health();v_release:=public.platform_release_matrix();v_homologation:=public.get_production_homologation_snapshot(NULL);v_hstatus:=coalesce(v_homologation->'run'->>'status','not_started');
 SELECT count(*) INTO v_critical FROM public.operational_alerts WHERE organizations_id=v_org AND status<>'resolved' AND severity='critical';
 RETURN jsonb_build_object('ok',coalesce((v_schema->>'ok')::boolean,false) AND v_critical=0 AND v_hstatus='passed','schema',v_schema,'health',v_health,'releases',v_release,'homologation',v_homologation,'criticalAlerts',v_critical,'checkedAt',now());
END; $$;
GRANT EXECUTE ON FUNCTION public.platform_production_readiness() TO authenticated;

-- A Etapa 15 instala a homologação, mas NÃO promove Stable automaticamente.
-- A promoção só acontece depois de uma rodada obrigatória aprovada e readiness saudável.
UPDATE public.platform_release_channels
SET latest_version='2.4.0',
    release_channel='preview',
    update_required=CASE WHEN component_key='crm' THEN true ELSE update_required END,
    updated_at=now(),
    notes=CASE WHEN component_key='crm' THEN 'Release candidate 2.4.0 aguardando homologação final.' ELSE notes END
WHERE component_key='crm';

CREATE OR REPLACE FUNCTION public.promote_platform_stable_release()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog,public
AS $$
DECLARE
  v_org bigint:=public.current_organization_id();
  v_run public.production_homologation_runs%ROWTYPE;
  v_schema jsonb;
  v_critical integer:=0;
  v_release_key text:='stable-'||to_char(current_date,'YYYYMMDD');
BEGIN
  PERFORM public.require_organization_permission('monitoring.manage');
  IF NOT public.is_platform_owner(public.current_actor_user_id()) THEN RAISE EXCEPTION 'platform_owner_required_for_stable_promotion'; END IF;
  SELECT * INTO v_run
  FROM public.production_homologation_runs
  WHERE organizations_id=v_org
  ORDER BY started_at DESC
  LIMIT 1;
  IF NOT FOUND OR v_run.status<>'passed' THEN
    RAISE EXCEPTION 'production_homologation_not_passed';
  END IF;

  v_schema:=public.platform_schema_health();
  IF NOT coalesce((v_schema->>'ok')::boolean,false) THEN
    RAISE EXCEPTION 'platform_schema_not_ready';
  END IF;

  SELECT count(*) INTO v_critical
  FROM public.operational_alerts
  WHERE organizations_id=v_org
    AND status<>'resolved'
    AND severity='critical';
  IF v_critical>0 THEN
    RAISE EXCEPTION 'critical_operational_alerts:%',v_critical;
  END IF;

  UPDATE public.platform_release_channels
  SET stable_version=latest_version,
      release_channel='stable',
      update_required=false,
      updated_at=now()
  WHERE component_key IN ('manager','worker','capture','instagram','gateway','evolution');

  UPDATE public.platform_release_channels
  SET latest_version='2.4.0',
      minimum_supported_version='2.4.0',
      stable_version='2.4.0',
      release_channel='stable',
      update_required=false,
      updated_at=now(),
      notes='Vinsansi Studio Stable após homologação das Etapas 1–15.'
  WHERE component_key='crm';

  INSERT INTO public.platform_schema_releases(
    release_key,application_version,migration_count,base_schema_sha256,notes,
    schema_contract_version,minimum_application_version,is_stable,metadata
  ) VALUES(
    v_release_key,'2.4.0',21,encode(extensions.digest(v_release_key,'sha256'),'hex'),
    'Vinsansi Studio Stable — Etapas 1–15.','2026.08.24.15','2.4.0',true,
    jsonb_build_object('stages',jsonb_build_array(1,2,3,4,5,6,7,8,9,10,11,12,13,14,15),'release','stable','textOnlyWhatsapp',true,'homologationRunId',v_run.production_homologation_runs_id,'organizationId',v_org)
  )
  ON CONFLICT(release_key) DO UPDATE
  SET application_version=excluded.application_version,
      migration_count=excluded.migration_count,
      base_schema_sha256=excluded.base_schema_sha256,
      notes=excluded.notes,
      schema_contract_version=excluded.schema_contract_version,
      minimum_application_version=excluded.minimum_application_version,
      is_stable=true,
      metadata=excluded.metadata,
      applied_at=now();

  PERFORM public.append_audit_event(
    'production','promote_stable_release','platform_schema_release',v_release_key,
    NULL,NULL,NULL,NULL,NULL,'Release promovida a Stable após homologação.',
    jsonb_build_object('release','2.4.0','run_id',v_run.production_homologation_runs_id,'organization_id',v_org),NULL
  );

  RETURN jsonb_build_object('ok',true,'release','2.4.0','releaseKey',v_release_key,'runId',v_run.production_homologation_runs_id,'promotedAt',now());
END;
$$;
GRANT EXECUTE ON FUNCTION public.promote_platform_stable_release() TO authenticated;

INSERT INTO public.platform_schema_contracts(schema_contract_version,application_version,required_tables,required_functions,retired_objects,notes)
VALUES('2026.08.24.15','2.4.0',
 ARRAY['organizations','organization_members','platform_tools','organization_tool_installations','tool_browser_pairings','leads','lead_identity_registry','contact_suppressions','queues','queue_items','sents','conversations','conversation_messages','capture_execution_events','instagram_queue_progress','permanent_records','permanent_record_events','platform_runtime_heartbeats','operational_alerts','recovery_requests','lead_orchestration_state','lead_lifecycle_events','platform_release_channels','production_homologation_runs','production_homologation_checks'],
 ARRAY['append_audit_event','service_capture_identity_gate','instagram_claim_queue_item_v2','commercial_reentry_decision','service_runtime_heartbeat','platform_schema_health','service_orchestrate_ready_leads','platform_component_compatibility','platform_release_matrix','platform_production_readiness','start_production_homologation','set_production_homologation_check','promote_platform_stable_release'],
 ARRAY['maps_extension_installations','maps_extension_pairings','instagram_claim_queue_item','instagram_update_queue_progress','get_operational_health_rbac_inner'],
 'Contrato final das Etapas 1–15. A promoção Stable depende de homologação aprovada; instalar esta migration sozinho não congela a release.')
ON CONFLICT(schema_contract_version) DO UPDATE SET application_version=excluded.application_version,required_tables=excluded.required_tables,required_functions=excluded.required_functions,retired_objects=excluded.retired_objects,notes=excluded.notes;

INSERT INTO public.platform_schema_releases(release_key,application_version,migration_count,base_schema_sha256,notes,schema_contract_version,minimum_application_version,is_stable,metadata)
VALUES('stage-15-homologation-20260824','2.4.0',21,encode(extensions.digest('stage-15-homologation-20260824','sha256'),'hex'),'Release candidate para homologação final das Etapas 1–15.','2026.08.24.15','2.4.0',false,jsonb_build_object('stages',jsonb_build_array(1,2,3,4,5,6,7,8,9,10,11,12,13,14,15),'release','preview','textOnlyWhatsapp',true))
ON CONFLICT(release_key) DO UPDATE SET application_version=excluded.application_version,migration_count=excluded.migration_count,base_schema_sha256=excluded.base_schema_sha256,notes=excluded.notes,schema_contract_version=excluded.schema_contract_version,minimum_application_version=excluded.minimum_application_version,is_stable=false,metadata=excluded.metadata,applied_at=now();

COMMIT;

BEGIN;

-- R15: restaura a preparação atômica multicanal no núcleo RBAC.
-- O banco do ambiente podia manter uma versão legada WhatsApp-only do inner.
-- Esta implementação aceita WhatsApp e Instagram e mantém o wrapper público RBAC.

CREATE OR REPLACE FUNCTION public.prepare_queue_items_rbac_inner(
  p_channel text,
  p_resource_id bigint,
  p_scheduled_date date,
  p_items jsonb
)
RETURNS TABLE (
  lead_id bigint,
  queue_item_id bigint,
  outcome text,
  reason text,
  queue_id bigint,
  queue_position integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_users_id bigint;
  v_channel_name text;
  v_channel_id bigint;
  v_active_status_id bigint;
  v_pending_status_id bigint;
  v_validated_lead_status_id bigint;
  v_queued_lead_status_id bigint;
  v_capacity_status_ids bigint[];
  v_daily_limit integer;
  v_used integer;
  v_queue_name text;
  v_queue_id bigint;
  v_next_position integer;
  v_item jsonb;
  v_lead_id bigint;
  v_template_id bigint;
  v_existing_item_id bigint;
  v_existing_queue_id bigint;
  v_existing_position integer;
  v_lead public.leads%ROWTYPE;
  v_resource_found boolean := false;
  v_template_found boolean;
BEGIN
  v_users_id := public.ensure_current_user();
  v_channel_name := lower(trim(coalesce(p_channel, '')));

  IF v_channel_name NOT IN ('whatsapp', 'instagram') THEN
    RAISE EXCEPTION 'Canal inválido. Use WhatsApp ou Instagram.'
      USING ERRCODE = '22023';
  END IF;

  IF p_resource_id IS NULL OR p_resource_id <= 0 THEN
    RAISE EXCEPTION 'Recurso operacional inválido.'
      USING ERRCODE = '22023';
  END IF;

  IF p_scheduled_date IS NULL THEN
    RAISE EXCEPTION 'Data de agendamento obrigatória.'
      USING ERRCODE = '22023';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Informe ao menos um lead para preparação.'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_array_length(p_items) > 500 THEN
    RAISE EXCEPTION 'O lote excede o limite de 500 leads por operação.'
      USING ERRCODE = '22023';
  END IF;

  SELECT c.channels_id
    INTO v_channel_id
  FROM public.channels AS c
  WHERE regexp_replace(lower(public.unaccent(trim(c.channels_name))), '[^a-z0-9]+', '', 'g') = v_channel_name
  ORDER BY c.channels_id
  LIMIT 1;

  IF v_channel_id IS NULL THEN
    RAISE EXCEPTION 'Canal % não encontrado no catálogo.', p_channel;
  END IF;

  SELECT s.status_id
    INTO v_active_status_id
  FROM public.status AS s
  WHERE regexp_replace(lower(public.unaccent(trim(s.status_name))), '[^a-z0-9]+', '', 'g') IN ('ativo', 'active')
  ORDER BY CASE WHEN regexp_replace(lower(public.unaccent(trim(s.status_name))), '[^a-z0-9]+', '', 'g') = 'ativo' THEN 0 ELSE 1 END,
           s.status_id
  LIMIT 1;

  SELECT s.status_id
    INTO v_pending_status_id
  FROM public.status AS s
  WHERE regexp_replace(lower(public.unaccent(trim(s.status_name))), '[^a-z0-9]+', '', 'g') IN ('pendente', 'pending', 'queued')
  ORDER BY CASE WHEN regexp_replace(lower(public.unaccent(trim(s.status_name))), '[^a-z0-9]+', '', 'g') = 'pendente' THEN 0 ELSE 1 END,
           s.status_id
  LIMIT 1;

  SELECT ls.lead_status_id
    INTO v_validated_lead_status_id
  FROM public.lead_status AS ls
  WHERE regexp_replace(lower(public.unaccent(trim(ls.lead_status_name))), '[^a-z0-9]+', '', 'g') IN ('validado', 'validated')
  ORDER BY ls.lead_status_id
  LIMIT 1;

  SELECT ls.lead_status_id
    INTO v_queued_lead_status_id
  FROM public.lead_status AS ls
  WHERE regexp_replace(lower(public.unaccent(trim(ls.lead_status_name))), '[^a-z0-9]+', '', 'g') IN ('nafila', 'queued')
  ORDER BY ls.lead_status_id
  LIMIT 1;

  SELECT array_agg(s.status_id ORDER BY s.status_id)
    INTO v_capacity_status_ids
  FROM public.status AS s
  WHERE regexp_replace(lower(public.unaccent(trim(s.status_name))), '[^a-z0-9]+', '', 'g') IN (
    'pendente', 'pending', 'queued',
    'processando', 'processing', 'sending',
    'concluido', 'completed', 'sent',
    'pausado', 'paused'
  );

  IF v_active_status_id IS NULL
     OR v_pending_status_id IS NULL
     OR v_validated_lead_status_id IS NULL
     OR v_queued_lead_status_id IS NULL
     OR coalesce(array_length(v_capacity_status_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Catálogos operacionais incompletos para preparar a fila.';
  END IF;

  -- Serializa a reserva por usuário, canal, recurso e data. O lock é liberado
  -- automaticamente no commit ou rollback da chamada.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      format('queue-preparation:%s:%s:%s:%s', v_users_id, v_channel_id, p_resource_id, p_scheduled_date),
      0
    )
  );

  IF v_channel_name = 'whatsapp' THEN
    SELECT l.levels_daily_limit
      INTO v_daily_limit
    FROM public.chips AS c
    JOIN public.instances AS i
      ON i.instances_id = c.instances_id
     AND i.users_id = c.users_id
    JOIN public.levels AS l
      ON l.levels_id = c.levels_id
     AND l.users_id = c.users_id
    WHERE c.chips_id = p_resource_id
      AND c.users_id = v_users_id
      AND c.status_id = v_active_status_id
      AND i.status_id = v_active_status_id
      AND l.status_id = v_active_status_id
      AND l.channels_id = v_channel_id
    FOR UPDATE OF c;

    v_resource_found := FOUND;
  ELSE
    SELECT l.levels_daily_limit
      INTO v_daily_limit
    FROM public.socials AS so
    JOIN public.levels AS l
      ON l.levels_id = so.levels_id
     AND l.users_id = so.users_id
    WHERE so.socials_id = p_resource_id
      AND so.users_id = v_users_id
      AND so.status_id = v_active_status_id
      AND l.status_id = v_active_status_id
      AND l.channels_id = v_channel_id
    FOR UPDATE OF so;

    v_resource_found := FOUND;
  END IF;

  IF NOT v_resource_found THEN
    RAISE EXCEPTION 'O recurso selecionado não está ativo, pertence a outro usuário ou não corresponde ao canal.';
  END IF;

  IF coalesce(v_daily_limit, 0) <= 0 THEN
    RAISE EXCEPTION 'O recurso selecionado não possui limite diário válido.';
  END IF;

  IF v_channel_name = 'whatsapp' THEN
    SELECT count(*)::integer
      INTO v_used
    FROM public.queue_items AS qi
    JOIN public.queues AS q
      ON q.queues_id = qi.queues_id
     AND q.users_id = qi.users_id
    WHERE qi.users_id = v_users_id
      AND q.channels_id = v_channel_id
      AND qi.chips_id = p_resource_id
      AND qi.status_id = ANY(v_capacity_status_ids)
      AND (coalesce(qi.queue_items_scheduled_at, q.queues_scheduled_at) AT TIME ZONE 'UTC')::date = p_scheduled_date;
  ELSE
    SELECT count(*)::integer
      INTO v_used
    FROM public.queue_items AS qi
    JOIN public.queues AS q
      ON q.queues_id = qi.queues_id
     AND q.users_id = qi.users_id
    WHERE qi.users_id = v_users_id
      AND q.channels_id = v_channel_id
      AND qi.socials_id = p_resource_id
      AND qi.status_id = ANY(v_capacity_status_ids)
      AND (coalesce(qi.queue_items_scheduled_at, q.queues_scheduled_at) AT TIME ZONE 'UTC')::date = p_scheduled_date;
  END IF;

  v_queue_name := format('%s:%s:%s', v_channel_name, p_resource_id, p_scheduled_date);

  -- Bloqueia todos os leads válidos em ordem determinística para evitar
  -- deadlocks quando operações concorrentes contêm conjuntos sobrepostos.
  PERFORM l.leads_id
  FROM public.leads AS l
  WHERE l.users_id = v_users_id
    AND l.leads_id IN (
      SELECT DISTINCT (entry.value ->> 'lead_id')::bigint
      FROM jsonb_array_elements(p_items) AS entry(value)
      WHERE coalesce(entry.value ->> 'lead_id', '') ~ '^[0-9]+$'
    )
  ORDER BY l.leads_id
  FOR UPDATE;

  FOR v_item IN
    SELECT entry.value
    FROM jsonb_array_elements(p_items) WITH ORDINALITY AS entry(value, ordinal)
    ORDER BY entry.ordinal
  LOOP
    lead_id := NULL;
    queue_item_id := NULL;
    outcome := NULL;
    reason := NULL;
    queue_id := NULL;
    queue_position := NULL;
    v_existing_item_id := NULL;
    v_existing_queue_id := NULL;
    v_existing_position := NULL;
    v_template_found := false;

    IF coalesce(v_item ->> 'lead_id', '') !~ '^[0-9]+$' THEN
      outcome := 'failed';
      reason := 'Identificador de lead inválido.';
      RETURN NEXT;
      CONTINUE;
    END IF;

    v_lead_id := (v_item ->> 'lead_id')::bigint;
    lead_id := v_lead_id;

    SELECT l.*
      INTO v_lead
    FROM public.leads AS l
    WHERE l.leads_id = v_lead_id
      AND l.users_id = v_users_id;

    IF NOT FOUND THEN
      outcome := 'failed';
      reason := 'Lead não encontrado ou sem permissão de acesso.';
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- Uma fila ativa existente é a fonte canônica. Se o lead ainda aparece
    -- como validado, a função reconcilia o status sem criar outro item.
    SELECT qi.queue_items_id, qi.queues_id, qi.queue_items_position
      INTO v_existing_item_id, v_existing_queue_id, v_existing_position
    FROM public.queue_items AS qi
    JOIN public.queues AS q
      ON q.queues_id = qi.queues_id
     AND q.users_id = qi.users_id
    WHERE qi.users_id = v_users_id
      AND qi.leads_id = v_lead_id
      AND qi.status_id = ANY(v_capacity_status_ids)
    ORDER BY qi.queue_items_created_at DESC, qi.queue_items_id DESC
    LIMIT 1;

    IF v_existing_item_id IS NOT NULL THEN
      IF v_lead.lead_status_id = v_validated_lead_status_id THEN
        UPDATE public.leads AS l
        SET
          lead_status_id = v_queued_lead_status_id,
          leads_updated_at = now()
        WHERE l.leads_id = v_lead_id
          AND l.users_id = v_users_id
          AND l.lead_status_id = v_validated_lead_status_id;
      END IF;

      queue_item_id := v_existing_item_id;
      queue_id := v_existing_queue_id;
      queue_position := v_existing_position;
      outcome := 'reconciled';
      reason := 'O lead já possuía um item ativo; o estado canônico foi preservado.';
      RETURN NEXT;
      CONTINUE;
    END IF;

    SELECT qi.queue_items_id, qi.queues_id, qi.queue_items_position
      INTO v_existing_item_id, v_existing_queue_id, v_existing_position
    FROM public.queue_items AS qi
    JOIN public.queues AS q
      ON q.queues_id = qi.queues_id
     AND q.users_id = qi.users_id
    WHERE qi.users_id = v_users_id
      AND qi.leads_id = v_lead_id
      AND q.queues_name = v_queue_name
    ORDER BY qi.queue_items_created_at DESC, qi.queue_items_id DESC
    LIMIT 1;

    IF v_existing_item_id IS NOT NULL THEN
      queue_item_id := v_existing_item_id;
      queue_id := v_existing_queue_id;
      queue_position := v_existing_position;
      outcome := 'conflict';
      reason := 'O lead já possui uma tentativa registrada para este recurso e esta data.';
      RETURN NEXT;
      CONTINUE;
    END IF;

    IF v_lead.lead_status_id <> v_validated_lead_status_id THEN
      outcome := 'conflict';
      reason := 'O lead não está mais no status Validado.';
      RETURN NEXT;
      CONTINUE;
    END IF;

    IF v_lead.channels_id IS DISTINCT FROM v_channel_id THEN
      outcome := 'conflict';
      reason := 'O canal do lead foi alterado antes da preparação.';
      RETURN NEXT;
      CONTINUE;
    END IF;

    IF v_channel_name = 'whatsapp'
       AND length(regexp_replace(coalesce(v_lead.leads_phone, ''), '[^0-9]+', '', 'g')) < 10 THEN
      outcome := 'blocked';
      reason := 'Telefone inválido para WhatsApp.';
      RETURN NEXT;
      CONTINUE;
    END IF;

    IF v_channel_name = 'instagram'
       AND length(trim(coalesce(v_lead.leads_instagram, ''))) = 0 THEN
      outcome := 'blocked';
      reason := 'Instagram inválido ou ausente.';
      RETURN NEXT;
      CONTINUE;
    END IF;

    IF coalesce(v_item ->> 'template_id', '') !~ '^[0-9]+$' THEN
      outcome := 'blocked';
      reason := 'Template obrigatório ou inválido.';
      RETURN NEXT;
      CONTINUE;
    END IF;

    v_template_id := (v_item ->> 'template_id')::bigint;

    SELECT true
      INTO v_template_found
    FROM public.templates AS t
    JOIN public.template_channels AS tc
      ON tc.template_channels_id = t.template_channels_id
     AND tc.users_id = t.users_id
    WHERE t.templates_id = v_template_id
      AND t.users_id = v_users_id
      AND t.branches_id = v_lead.branches_id
      AND t.status_id = v_active_status_id
      AND tc.status_id = v_active_status_id
      AND NOT (v_channel_id = ANY(coalesce(tc.template_channels_blocked_channels, ARRAY[]::bigint[])))
      AND (
        regexp_replace(lower(public.unaccent(trim(tc.template_channels_name))), '[^a-z0-9]+', '', 'g') = v_channel_name
        OR regexp_replace(lower(public.unaccent(trim(tc.template_channels_name))), '[^a-z0-9]+', '', 'g') IN ('geral', 'general')
      )
      AND length(trim(coalesce(t.templates_message_1, ''))) > 0
      AND NOT (
        length(trim(coalesce(t.templates_message_2, ''))) = 0
        AND (
          length(trim(coalesce(t.templates_message_3, ''))) > 0
          OR length(trim(coalesce(t.templates_message_4, ''))) > 0
        )
      )
      AND NOT (
        length(trim(coalesce(t.templates_message_3, ''))) = 0
        AND length(trim(coalesce(t.templates_message_4, ''))) > 0
      )
    LIMIT 1;

    IF NOT coalesce(v_template_found, false) THEN
      outcome := 'blocked';
      reason := 'O template não está ativo, não pertence ao ramo ou não é compatível com o canal.';
      RETURN NEXT;
      CONTINUE;
    END IF;

    IF v_used >= v_daily_limit THEN
      outcome := 'blocked';
      reason := 'Sem capacidade diária disponível para este recurso.';
      RETURN NEXT;
      CONTINUE;
    END IF;

    IF v_queue_id IS NULL THEN
      INSERT INTO public.queues (
        users_id,
        channels_id,
        status_id,
        queues_name,
        queues_scheduled_at,
        queues_created_at,
        queues_updated_at
      )
      VALUES (
        v_users_id,
        v_channel_id,
        v_pending_status_id,
        v_queue_name,
        (p_scheduled_date::timestamp + time '12:00:00') AT TIME ZONE 'UTC',
        now(),
        now()
      )
      ON CONFLICT (users_id, queues_name)
      DO UPDATE SET
        status_id = EXCLUDED.status_id,
        queues_scheduled_at = EXCLUDED.queues_scheduled_at,
        queues_finished_at = NULL,
        queues_updated_at = now()
      RETURNING queues_id INTO v_queue_id;

      PERFORM q.queues_id
      FROM public.queues AS q
      WHERE q.queues_id = v_queue_id
        AND q.users_id = v_users_id
      FOR UPDATE;
    END IF;

    IF v_channel_name = 'whatsapp' THEN
      SELECT coalesce(max(qi.queue_items_position), 0) + 1
        INTO v_next_position
      FROM public.queue_items AS qi
      WHERE qi.users_id = v_users_id
        AND qi.chips_id = p_resource_id
        AND (qi.queue_items_scheduled_at AT TIME ZONE 'UTC')::date = p_scheduled_date;
    ELSE
      SELECT coalesce(max(qi.queue_items_position), 0) + 1
        INTO v_next_position
      FROM public.queue_items AS qi
      WHERE qi.users_id = v_users_id
        AND qi.socials_id = p_resource_id
        AND (qi.queue_items_scheduled_at AT TIME ZONE 'UTC')::date = p_scheduled_date;
    END IF;

    INSERT INTO public.queue_items (
      users_id,
      queues_id,
      leads_id,
      chips_id,
      socials_id,
      templates_id,
      status_id,
      queue_items_position,
      queue_items_attempts,
      queue_items_scheduled_at,
      queue_items_created_at,
      queue_items_updated_at
    )
    VALUES (
      v_users_id,
      v_queue_id,
      v_lead_id,
      CASE WHEN v_channel_name = 'whatsapp' THEN p_resource_id ELSE NULL END,
      CASE WHEN v_channel_name = 'instagram' THEN p_resource_id ELSE NULL END,
      v_template_id,
      v_pending_status_id,
      v_next_position,
      0,
      p_scheduled_date + time '12:00:00',
      now(),
      now()
    )
    RETURNING queue_items_id INTO queue_item_id;

    UPDATE public.leads AS l
    SET
      lead_status_id = v_queued_lead_status_id,
      leads_updated_at = now()
    WHERE l.leads_id = v_lead_id
      AND l.users_id = v_users_id
      AND l.lead_status_id = v_validated_lead_status_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Conflito inesperado ao alterar o lead % após reservar a fila.', v_lead_id;
    END IF;

    v_used := v_used + 1;
    lead_id := v_lead_id;
    outcome := 'queued';
    reason := NULL;
    queue_id := v_queue_id;
    queue_position := v_next_position;
    RETURN NEXT;
  END LOOP;
END;
$function$;



REVOKE ALL ON FUNCTION public.prepare_queue_items_rbac_inner(text,bigint,date,jsonb) FROM PUBLIC, anon, authenticated;

-- A assinatura pública continua sendo a única executável pelo frontend autenticado.
GRANT EXECUTE ON FUNCTION public.prepare_queue_items(text,bigint,date,jsonb) TO authenticated;

COMMIT;



-- R16 FINAL OVERRIDE: sem janelas operacionais + claim Instagram corrigido
BEGIN;

-- R16: canais de disparo nao possuem janela de horario/dias ativos.
-- Limites diarios, lotes e delays permanecem ativos.
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
       AND jsonb_typeof(v_dispatch->'profiles')='array'
       AND jsonb_typeof(v_dispatch->'profile')='string'
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
       AND jsonb_typeof(v_dispatch->'delayMinSeconds')='number'
       AND jsonb_typeof(v_dispatch->'delayMaxSeconds')='number'
       AND jsonb_typeof(v_dispatch->'perBatch')='number'
       AND jsonb_typeof(v_dispatch->'batches')='number'
       AND jsonb_typeof(v_dispatch->'batchDelayMinutes')='number'
       AND jsonb_typeof(v_dispatch->'dailyLimit')='number'
       AND jsonb_typeof(v_dispatch->'batchBehavior')='string'
       AND jsonb_typeof(p_settings->'chipLevels')='object';
  END IF;
  RETURN false;
EXCEPTION WHEN others THEN
  RETURN false;
END;
$$;

-- Remove configuracoes antigas de horario dos defaults oficiais.
UPDATE public.platform_tools
SET default_settings = jsonb_set(
  default_settings,
  '{instagram}',
  ((coalesce(default_settings->'instagram','{}'::jsonb) - 'startTime' - 'endTime' - 'activeDays')
    || jsonb_build_object('batchBehavior','Respeitar lotes e limites')),
  true
)
WHERE tool_id='vinsansi_instagram';

UPDATE public.platform_tools
SET default_settings = (jsonb_set(
  default_settings,
  '{whatsapp}',
  ((coalesce(default_settings->'whatsapp','{}'::jsonb) - 'startTime' - 'endTime' - 'activeDays')
    || jsonb_build_object('batchBehavior','Respeitar lotes e limites')),
  true
) - 'operationalCutoffHour')
WHERE tool_id='vinsansi_whatsapp_manager';

-- Remove as mesmas chaves das configuracoes ja salvas por organizacao.
UPDATE public.organization_tool_settings
SET settings = jsonb_set(
  settings,
  '{instagram}',
  ((coalesce(settings->'instagram','{}'::jsonb) - 'startTime' - 'endTime' - 'activeDays')
    || jsonb_build_object('batchBehavior','Respeitar lotes e limites')),
  true
)
WHERE tool_id='vinsansi_instagram';

UPDATE public.organization_tool_settings
SET settings = (jsonb_set(
  settings,
  '{whatsapp}',
  ((coalesce(settings->'whatsapp','{}'::jsonb) - 'startTime' - 'endTime' - 'activeDays')
    || jsonb_build_object('batchBehavior','Respeitar lotes e limites')),
  true
) - 'operationalCutoffHour')
WHERE tool_id='vinsansi_whatsapp_manager';

-- Capacidade Instagram passa a considerar apenas limite diario, nunca horario/dia da semana.
CREATE OR REPLACE FUNCTION public.instagram_profile_capacity(
 p_organizations_id bigint,p_socials_id bigint,p_now timestamptz DEFAULT now()
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO pg_catalog,public AS $$
DECLARE
  v_settings jsonb;
  v_cfg jsonb;
  v_limit integer;
  v_sent integer;
  v_profile text;
  v_date date;
  v_timezone text:='America/Sao_Paulo';
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
 SELECT s.socials_username INTO v_profile
 FROM public.socials s
 WHERE s.socials_id=p_socials_id AND s.organizations_id=p_organizations_id AND s.status_id=1;
 IF v_profile IS NULL THEN RAISE EXCEPTION 'instagram_profile_not_available'; END IF;
 SELECT coalesce(ots.settings,pt.default_settings) INTO v_settings
 FROM public.platform_tools pt
 LEFT JOIN public.organization_tool_settings ots
   ON ots.organizations_id=p_organizations_id AND ots.tool_id=pt.tool_id
 WHERE pt.tool_id='vinsansi_instagram';
 v_cfg:=coalesce(v_settings->'instagram','{}'::jsonb);
 v_limit:=greatest(0,coalesce((v_cfg->>'dailyLimit')::integer,60));
 v_date:=(p_now AT TIME ZONE v_timezone)::date;
 SELECT coalesce(r.sent_count,0) INTO v_sent
 FROM public.instagram_profile_runtime r
 WHERE r.organizations_id=p_organizations_id AND r.socials_id=p_socials_id AND r.operational_date=v_date;
 RETURN jsonb_build_object(
   'allowed',true,
   'withinWindow',true,
   'dailyLimit',v_limit,
   'sentToday',coalesce(v_sent,0),
   'remaining',greatest(v_limit-coalesce(v_sent,0),0),
   'profile',v_profile,
   'operationalDate',v_date
 );
END; $$;
REVOKE ALL ON FUNCTION public.instagram_profile_capacity(bigint,bigint,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.instagram_profile_capacity(bigint,bigint,timestamptz) TO service_role;

-- Claim Instagram: sem janela operacional e sem ambiguidade de queue_items_id.
CREATE OR REPLACE FUNCTION public.instagram_claim_queue_item_v2(
 p_organizations_id bigint,p_queue_item_id bigint,p_socials_id bigint,p_consumer_id text,p_installation_id uuid,p_member_id bigint
) RETURNS TABLE(queue_items_id bigint,claim_token uuid,step text,attempts integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE
  v_item public.queue_items%ROWTYPE;
  v_existing public.instagram_queue_progress%ROWTYPE;
  v_token uuid:=gen_random_uuid();
  v_attempts integer;
  v_users bigint;
  v_profile text;
  v_capacity jsonb;
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
 IF nullif(trim(coalesce(p_consumer_id,'')),'') IS NULL THEN RAISE EXCEPTION 'consumer_id_required'; END IF;
 SELECT qi.* INTO v_item
 FROM public.queue_items qi
 WHERE qi.queue_items_id=p_queue_item_id
   AND qi.organizations_id=p_organizations_id
   AND qi.socials_id=p_socials_id
 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'instagram_queue_item_not_found'; END IF;
 v_users:=v_item.users_id;
 IF NOT EXISTS(
   SELECT 1 FROM public.organization_tool_installations i
   WHERE i.organization_tool_installations_id=p_installation_id
     AND i.organizations_id=p_organizations_id
     AND i.tool_id='vinsansi_instagram'
     AND i.registration_status='registered'
 ) THEN RAISE EXCEPTION 'instagram_installation_invalid'; END IF;
 IF p_member_id IS NOT NULL AND NOT EXISTS(
   SELECT 1 FROM public.organization_members m
   WHERE m.organization_members_id=p_member_id
     AND m.organizations_id=p_organizations_id
     AND m.status_id=1
 ) THEN RAISE EXCEPTION 'instagram_member_invalid'; END IF;
 SELECT s.socials_username INTO v_profile
 FROM public.socials s
 WHERE s.socials_id=p_socials_id AND s.organizations_id=p_organizations_id AND s.status_id=1;
 IF v_profile IS NULL THEN RAISE EXCEPTION 'instagram_profile_not_available'; END IF;
 v_capacity:=public.instagram_profile_capacity(p_organizations_id,p_socials_id,now());
 IF coalesce((v_capacity->>'remaining')::integer,0)<=0 THEN RAISE EXCEPTION 'instagram_daily_limit_reached'; END IF;
 SELECT p.* INTO v_existing
 FROM public.instagram_queue_progress p
 WHERE p.queue_items_id=p_queue_item_id
 FOR UPDATE;
 IF FOUND AND public.instagram_canonical_step(v_existing.step) IN ('completed','reconciliation_required') THEN
   RAISE EXCEPTION 'instagram_item_not_claimable:%',v_existing.step;
 END IF;
 IF v_item.status_id NOT IN(3,6) THEN RAISE EXCEPTION 'instagram_item_not_pending:%',v_item.status_id; END IF;
 v_attempts:=coalesce(v_existing.attempts,0)+1;
 INSERT INTO public.instagram_queue_progress(
   users_id,organizations_id,queue_items_id,socials_id,step,canonical_step,claim_token,claimed_by,attempts,
   last_heartbeat_at,started_at,finished_at,error_message,metadata,organization_tool_installations_id,
   dispatched_by_member_id,profile_username,frozen_payload_hash
 ) VALUES(
   v_users,p_organizations_id,p_queue_item_id,p_socials_id,'claimed','claimed',v_token,trim(p_consumer_id),v_attempts,
   now(),coalesce(v_existing.started_at,now()),NULL,NULL,'{}',p_installation_id,p_member_id,v_profile,v_item.queue_items_payload_hash
 )
 ON CONFLICT ON CONSTRAINT instagram_queue_progress_queue_items_id_key
 DO UPDATE SET
   organizations_id=excluded.organizations_id,
   socials_id=excluded.socials_id,
   step='claimed',canonical_step='claimed',claim_token=excluded.claim_token,claimed_by=excluded.claimed_by,
   attempts=excluded.attempts,last_heartbeat_at=now(),
   started_at=coalesce(public.instagram_queue_progress.started_at,now()),finished_at=NULL,error_message=NULL,
   organization_tool_installations_id=excluded.organization_tool_installations_id,
   dispatched_by_member_id=excluded.dispatched_by_member_id,profile_username=excluded.profile_username,
   frozen_payload_hash=excluded.frozen_payload_hash,instagram_queue_progress_updated_at=now()
 RETURNING public.instagram_queue_progress.claim_token,public.instagram_queue_progress.attempts INTO v_token,v_attempts;
 UPDATE public.queue_items qi
 SET status_id=4,
     dispatched_by_member_id=coalesce(qi.dispatched_by_member_id,p_member_id),
     queue_items_started_at=coalesce(qi.queue_items_started_at,now()),
     queue_items_finished_at=NULL,queue_items_error_message=NULL,queue_items_updated_at=now()
 WHERE qi.queue_items_id=p_queue_item_id;
 INSERT INTO public.instagram_profile_runtime(
   organizations_id,socials_id,organization_tool_installations_id,profile_username,operational_date,claimed_count,last_claim_at,last_heartbeat_at
 ) VALUES(
   p_organizations_id,p_socials_id,p_installation_id,v_profile,(now() AT TIME ZONE 'America/Sao_Paulo')::date,1,now(),now()
 ) ON CONFLICT(organizations_id,socials_id,operational_date)
 DO UPDATE SET claimed_count=public.instagram_profile_runtime.claimed_count+1,last_claim_at=now(),last_heartbeat_at=now(),
   organization_tool_installations_id=excluded.organization_tool_installations_id,updated_at=now();
 INSERT INTO public.instagram_dispatch_events(
   users_id,organizations_id,queue_items_id,socials_id,from_step,to_step,claim_token,actor,metadata,
   organization_tool_installations_id,organization_members_id
 ) VALUES(
   v_users,p_organizations_id,p_queue_item_id,p_socials_id,coalesce(v_existing.step,'queued'),'claimed',v_token,p_consumer_id,
   jsonb_build_object('attempt',v_attempts,'profile',v_profile),p_installation_id,p_member_id
 );
 RETURN QUERY SELECT p_queue_item_id,v_token,'claimed'::text,v_attempts;
END; $$;
REVOKE ALL ON FUNCTION public.instagram_claim_queue_item_v2(bigint,bigint,bigint,text,uuid,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.instagram_claim_queue_item_v2(bigint,bigint,bigint,text,uuid,bigint) TO service_role;

-- Progresso Instagram: qualifica colunas que colidiam com nomes de saida RETURNS TABLE.
CREATE OR REPLACE FUNCTION public.instagram_update_queue_progress_v2(
 p_organizations_id bigint,p_queue_item_id bigint,p_claim_token uuid,p_step text,p_message text DEFAULT NULL,p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS TABLE(queue_items_id bigint,step text,queue_status_id bigint,lead_status_id bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE
  v_progress public.instagram_queue_progress%ROWTYPE;
  v_item public.queue_items%ROWTYPE;
  v_canonical text:=public.instagram_canonical_step(p_step);
  v_queue bigint:=4;
  v_lead bigint;
  v_final boolean:=false;
  v_previous text;
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
 IF NOT v_canonical=ANY(ARRAY['claimed','opening_profile','following','followed','opening_dm','sending','completed','error','reconciliation_required']) THEN
   RAISE EXCEPTION 'instagram_step_invalid:%',p_step;
 END IF;
 SELECT p.* INTO v_progress
 FROM public.instagram_queue_progress p
 WHERE p.queue_items_id=p_queue_item_id AND p.organizations_id=p_organizations_id
 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'instagram_progress_not_found'; END IF;
 IF v_progress.claim_token IS DISTINCT FROM p_claim_token THEN RAISE EXCEPTION 'instagram_claim_token_invalid'; END IF;
 v_previous:=v_progress.step;
 IF public.instagram_canonical_step(v_progress.step) IN('completed','reconciliation_required')
    AND public.instagram_canonical_step(v_progress.step)<>v_canonical THEN
   RAISE EXCEPTION 'instagram_progress_final:%',v_progress.step;
 END IF;
 SELECT qi.* INTO v_item
 FROM public.queue_items qi
 WHERE qi.queue_items_id=p_queue_item_id AND qi.organizations_id=p_organizations_id
 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'instagram_queue_item_not_found'; END IF;
 IF v_canonical='completed' THEN
   v_queue:=5;v_lead:=5;v_final:=true;
 ELSIF v_canonical='error' THEN
   v_queue:=6;v_lead:=CASE WHEN p_step='invalid' THEN 6 ELSE NULL END;v_final:=true;
 ELSIF v_canonical='reconciliation_required' THEN
   v_queue:=6;v_final:=true;
 END IF;
 UPDATE public.instagram_queue_progress p
 SET step=p_step,canonical_step=v_canonical,last_heartbeat_at=now(),
     finished_at=CASE WHEN v_final THEN now() ELSE NULL END,
     error_message=CASE WHEN v_canonical IN('error','reconciliation_required') THEN nullif(trim(coalesce(p_message,'')),'') ELSE NULL END,
     metadata=coalesce(p.metadata,'{}')||coalesce(p_metadata,'{}'),instagram_queue_progress_updated_at=now()
 WHERE p.instagram_queue_progress_id=v_progress.instagram_queue_progress_id;
 UPDATE public.queue_items qi
 SET status_id=v_queue,queue_items_updated_at=now(),
     queue_items_finished_at=CASE WHEN v_final THEN now() ELSE NULL END,
     queue_items_error_message=CASE WHEN v_canonical IN('error','reconciliation_required') THEN nullif(trim(coalesce(p_message,'')),'') ELSE NULL END
 WHERE qi.queue_items_id=p_queue_item_id;
 IF v_lead IS NOT NULL THEN
   UPDATE public.leads l SET lead_status_id=v_lead,leads_updated_at=now()
   WHERE l.leads_id=v_item.leads_id AND l.organizations_id=p_organizations_id AND l.lead_status_id=4;
 END IF;
 INSERT INTO public.instagram_dispatch_events(
   users_id,organizations_id,queue_items_id,socials_id,from_step,to_step,claim_token,actor,message,metadata,
   organization_tool_installations_id,organization_members_id
 ) VALUES(
   v_item.users_id,p_organizations_id,p_queue_item_id,v_progress.socials_id,v_previous,p_step,p_claim_token,
   v_progress.claimed_by,p_message,coalesce(p_metadata,'{}'),v_progress.organization_tool_installations_id,v_progress.dispatched_by_member_id
 );
 IF v_final THEN
   INSERT INTO public.instagram_profile_runtime(
     organizations_id,socials_id,organization_tool_installations_id,profile_username,operational_date,
     sent_count,invalid_count,error_count,last_send_at,last_heartbeat_at
   ) VALUES(
     p_organizations_id,v_progress.socials_id,v_progress.organization_tool_installations_id,coalesce(v_progress.profile_username,''),
     (now() AT TIME ZONE 'America/Sao_Paulo')::date,
     CASE WHEN v_canonical='completed' THEN 1 ELSE 0 END,
     CASE WHEN p_step='invalid' THEN 1 ELSE 0 END,
     CASE WHEN v_canonical IN('error','reconciliation_required') AND p_step<>'invalid' THEN 1 ELSE 0 END,
     CASE WHEN v_canonical='completed' THEN now() ELSE NULL END,now()
   ) ON CONFLICT(organizations_id,socials_id,operational_date)
   DO UPDATE SET sent_count=public.instagram_profile_runtime.sent_count+excluded.sent_count,
     invalid_count=public.instagram_profile_runtime.invalid_count+excluded.invalid_count,
     error_count=public.instagram_profile_runtime.error_count+excluded.error_count,
     last_send_at=coalesce(excluded.last_send_at,public.instagram_profile_runtime.last_send_at),last_heartbeat_at=now(),updated_at=now();
 END IF;
 RETURN QUERY SELECT p_queue_item_id,p_step,v_queue,coalesce(v_lead,4::bigint);
END; $$;
REVOKE ALL ON FUNCTION public.instagram_update_queue_progress_v2(bigint,bigint,uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.instagram_update_queue_progress_v2(bigint,bigint,uuid,text,text,jsonb) TO service_role;

COMMIT;

-- R16 SETTINGS SCHEMA/VERSIONS
UPDATE public.platform_tools SET settings_schema_version=2,settings_schema='{"type":"object","required":["instagram"]}'::jsonb,latest_version='2.0.4',minimum_supported_version='2.0.4' WHERE tool_id='vinsansi_instagram';
UPDATE public.platform_tools SET settings_schema_version=2,settings_schema='{"type":"object","required":["whatsapp","chipLevels"]}'::jsonb,latest_version='1.3.2',minimum_supported_version='1.3.2' WHERE tool_id='vinsansi_whatsapp_manager';
