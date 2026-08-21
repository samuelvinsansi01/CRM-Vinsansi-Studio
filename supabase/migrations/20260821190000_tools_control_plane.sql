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
DECLARE v_org bigint:=public.current_organization_id(); wa jsonb; ig jsonb; cap jsonb; wa_v bigint; ig_v bigint; cap_v bigint; newest timestamptz;
BEGIN
  PERFORM public.require_organization_permission('settings.view');
  SELECT settings,settings_version,organization_tool_settings.updated_at INTO wa,wa_v,newest FROM public.organization_tool_settings WHERE organizations_id=v_org AND tool_id='vinsansi_whatsapp_manager';
  SELECT settings,settings_version,greatest(newest,organization_tool_settings.updated_at) INTO ig,ig_v,newest FROM public.organization_tool_settings WHERE organizations_id=v_org AND tool_id='vinsansi_instagram';
  SELECT settings,settings_version,greatest(newest,organization_tool_settings.updated_at) INTO cap,cap_v,newest FROM public.organization_tool_settings WHERE organizations_id=v_org AND tool_id='vinsansi_capture';
  RETURN QUERY SELECT jsonb_build_object('whatsapp',wa->'whatsapp','instagram',ig->'instagram','chipLevels',wa->'chipLevels'),cap,
    jsonb_build_object('version',1,'source','platform','generatedAt',clock_timestamp(),'instagram',jsonb_build_object('dispatch',ig->'instagram'),'whatsapp',jsonb_build_object('dispatch',wa->'whatsapp')),
    coalesce(wa->>'operationalTimezone','America/Sao_Paulo'),coalesce((wa->>'operationalCutoffHour')::smallint,22::smallint),greatest(wa_v,ig_v,cap_v)::integer,newest;
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
