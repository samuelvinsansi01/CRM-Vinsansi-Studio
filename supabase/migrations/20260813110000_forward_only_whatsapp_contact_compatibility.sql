BEGIN;

-- This migration only changes future trigger/RPC behavior. It deliberately does
-- not scan, backfill, update, insert into, or delete from public.leads.
DO $prerequisite$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = pg_catalog.to_regclass('public.leads')
      AND attribute.attname = 'leads_whatsapp'
      AND attribute.atttypid = 'text'::pg_catalog.regtype
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
  ) THEN
    RAISE EXCEPTION 'whatsapp_contact_compatibility_missing_column:public.leads.leads_whatsapp';
  END IF;
END;
$prerequisite$;

CREATE OR REPLACE FUNCTION public.prepare_lead_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public, extensions
AS $function$
DECLARE
  v_canonical bigint;
  v_reason text;
BEGIN
  -- Preserve the historical boundary: legacy rows never enter contract v1 just
  -- because a normal UPDATE happens after this migration.
  IF TG_OP = 'UPDATE' AND OLD.leads_identity_contract_version IS DISTINCT FROM 1 THEN
    NEW.leads_identity_contract_version := OLD.leads_identity_contract_version;
    RETURN NEW;
  END IF;

  NEW.leads_identity_contract_version := 1;
  NEW.leads_normalized_phone := public.normalize_identity_phone(
    coalesce(
      nullif(btrim(NEW.leads_whatsapp), ''),
      nullif(btrim(NEW.leads_phone), '')
    )
  );
  NEW.leads_normalized_instagram := public.normalize_identity_instagram(NEW.leads_instagram);
  NEW.leads_normalized_domain := public.normalize_identity_domain(NEW.leads_website);
  NEW.leads_normalized_maps := public.normalize_identity_maps(NEW.leads_maps);
  NEW.leads_identity_hash := encode(
    extensions.digest(
      concat_ws(
        '|',
        NEW.leads_normalized_phone,
        NEW.leads_normalized_instagram,
        NEW.leads_normalized_domain,
        NEW.leads_normalized_maps
      ),
      'sha256'
    ),
    'hex'
  );

  SELECT registry.canonical_lead_id, registry.identity_type || ':' || registry.identity_value
  INTO v_canonical, v_reason
  FROM public.lead_identity_registry AS registry
  WHERE registry.users_id = NEW.users_id
    AND registry.canonical_lead_id <> coalesce(NEW.leads_id, -1)
    AND (
      (registry.identity_type = 'phone' AND registry.identity_value = NEW.leads_normalized_phone AND NEW.leads_normalized_phone <> '')
      OR (registry.identity_type = 'instagram' AND registry.identity_value = NEW.leads_normalized_instagram AND NEW.leads_normalized_instagram <> '')
      OR (registry.identity_type = 'domain' AND registry.identity_value = NEW.leads_normalized_domain AND NEW.leads_normalized_domain <> '')
      OR (registry.identity_type = 'maps' AND registry.identity_value = NEW.leads_normalized_maps AND NEW.leads_normalized_maps <> '')
    )
  ORDER BY registry.canonical_lead_id, registry.lead_identity_registry_id
  LIMIT 1;

  IF v_canonical IS NOT NULL THEN
    NEW.canonical_lead_id := v_canonical;
    NEW.duplicate_reason := v_reason;
    IF NEW.lead_status_id IN (1, 2, 3, 6) THEN
      NEW.lead_status_id := 7;
    END IF;
  ELSIF NEW.canonical_lead_id = NEW.leads_id THEN
    NEW.canonical_lead_id := NULL;
    NEW.duplicate_reason := NULL;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.register_lead_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $function$
DECLARE
  v_canonical bigint := coalesce(NEW.canonical_lead_id, NEW.leads_id);
BEGIN
  IF NEW.leads_identity_contract_version IS DISTINCT FROM 1 THEN
    RETURN NEW;
  END IF;

  -- prepare_lead_identity produces one effective phone identity. Consequently,
  -- equal phone/WhatsApp values never create two registry entries and different
  -- values still preserve both raw columns while WhatsApp owns dedupe priority.
  IF NEW.leads_normalized_phone <> '' THEN
    INSERT INTO public.lead_identity_registry(users_id, identity_type, identity_value, canonical_lead_id)
    VALUES (NEW.users_id, 'phone', NEW.leads_normalized_phone, v_canonical)
    ON CONFLICT (users_id, identity_type, identity_value)
    DO UPDATE SET last_seen_at = now();
  END IF;
  IF NEW.leads_normalized_instagram <> '' THEN
    INSERT INTO public.lead_identity_registry(users_id, identity_type, identity_value, canonical_lead_id)
    VALUES (NEW.users_id, 'instagram', NEW.leads_normalized_instagram, v_canonical)
    ON CONFLICT (users_id, identity_type, identity_value)
    DO UPDATE SET last_seen_at = now();
  END IF;
  IF NEW.leads_normalized_domain <> '' THEN
    INSERT INTO public.lead_identity_registry(users_id, identity_type, identity_value, canonical_lead_id)
    VALUES (NEW.users_id, 'domain', NEW.leads_normalized_domain, v_canonical)
    ON CONFLICT (users_id, identity_type, identity_value)
    DO UPDATE SET last_seen_at = now();
  END IF;
  IF NEW.leads_normalized_maps <> '' THEN
    INSERT INTO public.lead_identity_registry(users_id, identity_type, identity_value, canonical_lead_id)
    VALUES (NEW.users_id, 'maps', NEW.leads_normalized_maps, v_canonical)
    ON CONFLICT (users_id, identity_type, identity_value)
    DO UPDATE SET last_seen_at = now();
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.prepare_lead_identity() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.register_lead_identity() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS prepare_lead_identity_trigger ON public.leads;
CREATE TRIGGER prepare_lead_identity_trigger
BEFORE INSERT OR UPDATE OF
  leads_phone,
  leads_whatsapp,
  leads_instagram,
  leads_website,
  leads_maps,
  leads_identity_contract_version
ON public.leads
FOR EACH ROW
EXECUTE FUNCTION public.prepare_lead_identity();

DROP TRIGGER IF EXISTS register_lead_identity_trigger ON public.leads;
CREATE TRIGGER register_lead_identity_trigger
AFTER INSERT OR UPDATE OF
  leads_phone,
  leads_whatsapp,
  leads_instagram,
  leads_website,
  leads_maps,
  leads_identity_contract_version
ON public.leads
FOR EACH ROW
EXECUTE FUNCTION public.register_lead_identity();

-- Keep the complete, currently installed queue-preparation contract and replace
-- exactly its legacy phone-only guard. Aborting on any unexpected definition is
-- safer than silently installing a partial or divergent copy of the large RPC.
DO $queue_contract$
DECLARE
  v_function regprocedure := pg_catalog.to_regprocedure(
    'public.prepare_queue_items_without_whatsapp_validation_proof(text,bigint,date,jsonb)'
  );
  v_definition text;
  v_legacy_expression constant text := 'coalesce(v_lead.leads_phone, '''')';
  v_effective_expression constant text := 'coalesce(nullif(btrim(v_lead.leads_whatsapp), ''''), nullif(btrim(v_lead.leads_phone), ''''), '''')';
  v_occurrences integer;
BEGIN
  IF v_function IS NULL THEN
    RAISE EXCEPTION 'whatsapp_contact_compatibility_missing_function:prepare_queue_items_without_whatsapp_validation_proof';
  END IF;

  v_definition := pg_catalog.pg_get_functiondef(v_function);
  IF pg_catalog.strpos(v_definition, v_effective_expression) > 0 THEN
    RETURN;
  END IF;

  v_occurrences := (
    pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_legacy_expression, ''))
  ) / pg_catalog.length(v_legacy_expression);

  IF v_occurrences <> 1 THEN
    RAISE EXCEPTION 'whatsapp_contact_compatibility_divergent_function:prepare_queue_items_without_whatsapp_validation_proof:%', v_occurrences;
  END IF;

  v_definition := pg_catalog.replace(v_definition, v_legacy_expression, v_effective_expression);
  EXECUTE v_definition;
END;
$queue_contract$;

REVOKE ALL ON FUNCTION public.prepare_queue_items_without_whatsapp_validation_proof(text, bigint, date, jsonb)
FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.build_queue_item_payload_snapshot(
  p_users_id bigint,
  p_queues_id bigint,
  p_leads_id bigint,
  p_templates_id bigint,
  p_frozen_at timestamp with time zone DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_lead public.leads%ROWTYPE;
  v_template public.templates%ROWTYPE;
  v_branch public.branches%ROWTYPE;
  v_channel_name text := '';
  v_template_channel text := '';
  v_template_type text := '';
  v_city text := '';
  v_state text := '';
  v_phone text := '';
  v_whatsapp text := '';
  v_effective_whatsapp_phone text := '';
  v_instagram text := '';
  v_site text := '';
  v_media_name text := '';
  v_media_sha256 text := '';
  v_media_required boolean := false;
  v_message_1 text := '';
  v_message_2 text := '';
  v_message_3 text := '';
  v_message_4 text := '';
BEGIN
  SELECT lead.*
    INTO v_lead
  FROM public.leads AS lead
  WHERE lead.leads_id = p_leads_id
    AND lead.users_id = p_users_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nao foi possivel congelar o conteudo: lead % nao encontrado.', p_leads_id;
  END IF;

  SELECT template.*
    INTO v_template
  FROM public.templates AS template
  WHERE template.templates_id = p_templates_id
    AND template.users_id = p_users_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nao foi possivel congelar o conteudo: template % nao encontrado.', p_templates_id;
  END IF;

  SELECT branch.*
    INTO v_branch
  FROM public.branches AS branch
  WHERE branch.branches_id = v_lead.branches_id
    AND branch.users_id = p_users_id;

  SELECT city.cities_name
    INTO v_city
  FROM public.cities AS city
  WHERE city.cities_id = v_lead.cities_id;

  SELECT coalesce(nullif(state.states_code, ''), state.states_name)
    INTO v_state
  FROM public.states AS state
  WHERE state.states_id = v_lead.states_id;

  SELECT channel.channels_name
    INTO v_channel_name
  FROM public.queues AS queue
  JOIN public.channels AS channel ON channel.channels_id = queue.channels_id
  WHERE queue.queues_id = p_queues_id
    AND queue.users_id = p_users_id;

  SELECT template_channel.template_channels_name, template_type.template_types_name
    INTO v_template_channel, v_template_type
  FROM public.template_channels AS template_channel
  JOIN public.template_types AS template_type
    ON template_type.template_types_id = v_template.template_types_id
   AND template_type.users_id = v_template.users_id
  WHERE template_channel.template_channels_id = v_template.template_channels_id
    AND template_channel.users_id = v_template.users_id;

  v_city := coalesce(v_city, '');
  v_state := coalesce(v_state, '');
  v_phone := coalesce(v_lead.leads_phone, '');
  v_whatsapp := coalesce(v_lead.leads_whatsapp, '');
  v_effective_whatsapp_phone := coalesce(
    nullif(btrim(v_whatsapp), ''),
    nullif(btrim(v_phone), ''),
    ''
  );
  v_instagram := coalesce(v_lead.leads_instagram, '');
  v_site := coalesce(v_lead.leads_website, '');
  v_channel_name := coalesce(v_channel_name, '');
  v_template_channel := coalesce(v_template_channel, '');
  v_template_type := coalesce(v_template_type, '');

  IF v_branch.branches_categories IS NOT NULL
     AND jsonb_typeof(v_branch.branches_categories) = 'object' THEN
    v_media_name := trim(coalesce(
      v_branch.branches_categories ->> 'imageName',
      v_branch.branches_categories ->> 'image_name',
      v_branch.branches_categories ->> 'imagem',
      ''
    ));
    v_media_sha256 := lower(trim(coalesce(
      v_branch.branches_categories ->> 'imageSha256',
      v_branch.branches_categories ->> 'image_sha256',
      v_branch.branches_categories ->> 'sha256',
      ''
    )));
    v_media_required := lower(trim(coalesce(
      v_branch.branches_categories ->> 'imageRequired',
      v_branch.branches_categories ->> 'image_required',
      CASE WHEN v_media_name <> '' THEN 'true' ELSE 'false' END
    ))) IN ('true', '1', 'sim', 'yes', 'required', 'obrigatoria', 'obrigatorio');
  END IF;

  v_message_1 := public.render_queue_snapshot_message(
    v_template.templates_message_1,
    v_lead.leads_name,
    v_branch.branches_name,
    v_city,
    v_state,
    v_effective_whatsapp_phone,
    v_instagram,
    v_site
  );
  v_message_2 := public.render_queue_snapshot_message(
    v_template.templates_message_2,
    v_lead.leads_name,
    v_branch.branches_name,
    v_city,
    v_state,
    v_effective_whatsapp_phone,
    v_instagram,
    v_site
  );
  v_message_3 := public.render_queue_snapshot_message(
    v_template.templates_message_3,
    v_lead.leads_name,
    v_branch.branches_name,
    v_city,
    v_state,
    v_effective_whatsapp_phone,
    v_instagram,
    v_site
  );
  v_message_4 := public.render_queue_snapshot_message(
    v_template.templates_message_4,
    v_lead.leads_name,
    v_branch.branches_name,
    v_city,
    v_state,
    v_effective_whatsapp_phone,
    v_instagram,
    v_site
  );

  RETURN jsonb_build_object(
    'schema_version', 1,
    'frozen_at', coalesce(p_frozen_at, now()),
    'channel', v_channel_name,
    'recipient', jsonb_build_object(
      'phone', regexp_replace(v_effective_whatsapp_phone, '[^0-9]+', '', 'g'),
      'instagram', v_instagram
    ),
    'lead', jsonb_build_object(
      'id', v_lead.leads_id,
      'company_name', v_lead.leads_name,
      'branch_id', v_lead.branches_id,
      'branch_name', coalesce(v_branch.branches_name, ''),
      'city', v_city,
      'state', v_state,
      'phone', v_phone,
      'whatsapp', v_whatsapp,
      'effective_whatsapp_phone', v_effective_whatsapp_phone,
      'instagram', v_instagram,
      'site', v_site,
      'maps_url', coalesce(v_lead.leads_maps, '')
    ),
    'variables', jsonb_build_object(
      'EMPRESA', v_lead.leads_name,
      'NOME_EMPRESA', v_lead.leads_name,
      'RAMO', coalesce(v_branch.branches_name, ''),
      'CIDADE', v_city,
      'ESTADO', v_state,
      'TELEFONE', v_phone,
      'WHATSAPP', v_effective_whatsapp_phone,
      'INSTAGRAM', v_instagram,
      'SITE', v_site
    ),
    'template', jsonb_build_object(
      'id', v_template.templates_id,
      'name', v_template.templates_name,
      'channel', v_template_channel,
      'type', v_template_type,
      'updated_at', v_template.templates_updated_at,
      'raw_hash', encode(
        extensions.digest(
          convert_to(
            concat_ws(E'\n',
              v_template.templates_message_1,
              v_template.templates_message_2,
              v_template.templates_message_3,
              v_template.templates_message_4
            ),
            'UTF8'
          ),
          'sha256'
        ),
        'hex'
      )
    ),
    'messages', jsonb_build_object(
      'message_1', v_message_1,
      'message_2', v_message_2,
      'message_3', v_message_3,
      'message_4', v_message_4
    ),
    'media', jsonb_build_object(
      'required', v_media_required,
      'name', v_media_name,
      'sha256', v_media_sha256,
      'branch_updated_at', v_branch.branches_updated_at,
      'source', CASE
        WHEN lower(regexp_replace(public.unaccent(trim(v_channel_name)), '[^a-z0-9]+', '', 'g')) = 'instagram'
          THEN 'instagram-extension-local'
        ELSE 'worker-images'
      END
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.build_queue_item_payload_snapshot(bigint, bigint, bigint, bigint, timestamp with time zone)
FROM PUBLIC;

COMMENT ON FUNCTION public.prepare_lead_identity()
IS 'Forward-only identity preparation: contract-v1 leads use explicit WhatsApp first and legacy phone as fallback.';
COMMENT ON FUNCTION public.register_lead_identity()
IS 'Registers the single normalized effective phone identity produced for future contract-v1 leads.';
COMMENT ON FUNCTION public.build_queue_item_payload_snapshot(bigint, bigint, bigint, bigint, timestamp with time zone)
IS 'Freezes queue content while preserving raw phone/WhatsApp and preferring explicit WhatsApp as recipient.';

COMMIT;
