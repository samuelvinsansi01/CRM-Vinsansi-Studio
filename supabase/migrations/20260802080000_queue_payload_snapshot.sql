BEGIN;

ALTER TABLE public.queue_items
  ADD COLUMN IF NOT EXISTS queue_items_payload_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS queue_items_payload_hash text,
  ADD COLUMN IF NOT EXISTS queue_items_payload_created_at timestamp with time zone;

COMMENT ON COLUMN public.queue_items.queue_items_payload_snapshot
IS 'Snapshot imutável do destinatário, lead, variáveis, mensagens renderizadas, template e referência de mídia no momento do enfileiramento.';

COMMENT ON COLUMN public.queue_items.queue_items_payload_hash
IS 'SHA-256 do JSONB canônico armazenado em queue_items_payload_snapshot.';

COMMENT ON COLUMN public.queue_items.queue_items_payload_created_at
IS 'Instante em que o conteúdo operacional do item foi congelado.';

CREATE OR REPLACE FUNCTION public.queue_snapshot_replace_aliases(
  p_message text,
  p_alias_pattern text,
  p_value text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_result text := coalesce(p_message, '');
  v_replacement text := replace(coalesce(p_value, ''), E'\\', E'\\\\');
BEGIN
  v_result := regexp_replace(v_result, '\{\{\s*(' || p_alias_pattern || ')\s*\}\}', v_replacement, 'gi');
  v_result := regexp_replace(v_result, '\{\s*(' || p_alias_pattern || ')\s*\}', v_replacement, 'gi');
  v_result := regexp_replace(v_result, '\[\s*(' || p_alias_pattern || ')\s*\]', v_replacement, 'gi');
  v_result := regexp_replace(v_result, '%\s*(' || p_alias_pattern || ')\s*%', v_replacement, 'gi');
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.render_queue_snapshot_message(
  p_message text,
  p_company text,
  p_branch text,
  p_city text,
  p_state text,
  p_phone text,
  p_instagram text,
  p_site text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_result text := coalesce(p_message, '');
BEGIN
  v_result := public.queue_snapshot_replace_aliases(
    v_result,
    'EMPRESA|NOME[[:space:]_-]*EMPRESA|NOME[[:space:]_-]*DA[[:space:]_-]*EMPRESA|COMPANY|COMPANY[[:space:]_-]*NAME',
    p_company
  );
  v_result := public.queue_snapshot_replace_aliases(v_result, 'RAMO|BRANCH', p_branch);
  v_result := public.queue_snapshot_replace_aliases(v_result, 'CIDADE|CITY', p_city);
  v_result := public.queue_snapshot_replace_aliases(v_result, 'ESTADO|STATE', p_state);
  v_result := public.queue_snapshot_replace_aliases(v_result, 'TELEFONE|WHATSAPP|PHONE', p_phone);
  v_result := public.queue_snapshot_replace_aliases(v_result, 'INSTAGRAM', p_instagram);
  v_result := public.queue_snapshot_replace_aliases(v_result, 'SITE', p_site);
  RETURN v_result;
END;
$function$;

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
  SELECT l.*
    INTO v_lead
  FROM public.leads AS l
  WHERE l.leads_id = p_leads_id
    AND l.users_id = p_users_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Não foi possível congelar o conteúdo: lead % não encontrado.', p_leads_id;
  END IF;

  SELECT t.*
    INTO v_template
  FROM public.templates AS t
  WHERE t.templates_id = p_templates_id
    AND t.users_id = p_users_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Não foi possível congelar o conteúdo: template % não encontrado.', p_templates_id;
  END IF;

  SELECT b.*
    INTO v_branch
  FROM public.branches AS b
  WHERE b.branches_id = v_lead.branches_id
    AND b.users_id = p_users_id;

  SELECT c.cities_name
    INTO v_city
  FROM public.cities AS c
  WHERE c.cities_id = v_lead.cities_id;

  SELECT coalesce(nullif(s.states_code, ''), s.states_name)
    INTO v_state
  FROM public.states AS s
  WHERE s.states_id = v_lead.states_id;

  SELECT c.channels_name
    INTO v_channel_name
  FROM public.queues AS q
  JOIN public.channels AS c ON c.channels_id = q.channels_id
  WHERE q.queues_id = p_queues_id
    AND q.users_id = p_users_id;

  SELECT tc.template_channels_name, tt.template_types_name
    INTO v_template_channel, v_template_type
  FROM public.template_channels AS tc
  JOIN public.template_types AS tt
    ON tt.template_types_id = v_template.template_types_id
   AND tt.users_id = v_template.users_id
  WHERE tc.template_channels_id = v_template.template_channels_id
    AND tc.users_id = v_template.users_id;

  v_city := coalesce(v_city, '');
  v_state := coalesce(v_state, '');
  v_phone := coalesce(v_lead.leads_phone, '');
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
    ))) IN ('true', '1', 'sim', 'yes', 'required', 'obrigatoria', 'obrigatório');
  END IF;

  v_message_1 := public.render_queue_snapshot_message(
    v_template.templates_message_1,
    v_lead.leads_name,
    v_branch.branches_name,
    v_city,
    v_state,
    v_phone,
    v_instagram,
    v_site
  );
  v_message_2 := public.render_queue_snapshot_message(
    v_template.templates_message_2,
    v_lead.leads_name,
    v_branch.branches_name,
    v_city,
    v_state,
    v_phone,
    v_instagram,
    v_site
  );
  v_message_3 := public.render_queue_snapshot_message(
    v_template.templates_message_3,
    v_lead.leads_name,
    v_branch.branches_name,
    v_city,
    v_state,
    v_phone,
    v_instagram,
    v_site
  );
  v_message_4 := public.render_queue_snapshot_message(
    v_template.templates_message_4,
    v_lead.leads_name,
    v_branch.branches_name,
    v_city,
    v_state,
    v_phone,
    v_instagram,
    v_site
  );

  RETURN jsonb_build_object(
    'schema_version', 1,
    'frozen_at', coalesce(p_frozen_at, now()),
    'channel', v_channel_name,
    'recipient', jsonb_build_object(
      'phone', regexp_replace(v_phone, '[^0-9]+', '', 'g'),
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
      'WHATSAPP', v_phone,
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

-- Congela imediatamente o estado atual dos itens existentes. A partir daqui,
-- edições em templates, leads ou ramos não alteram o conteúdo desses itens.
UPDATE public.queue_items AS qi
SET
  queue_items_payload_created_at = coalesce(qi.queue_items_payload_created_at, qi.queue_items_created_at, now()),
  queue_items_payload_snapshot = public.build_queue_item_payload_snapshot(
    qi.users_id,
    qi.queues_id,
    qi.leads_id,
    qi.templates_id,
    coalesce(qi.queue_items_payload_created_at, qi.queue_items_created_at, now())
  )
WHERE qi.templates_id IS NOT NULL
  AND qi.queue_items_payload_snapshot IS NULL;

UPDATE public.queue_items AS qi
SET queue_items_payload_hash = encode(
  extensions.digest(convert_to(qi.queue_items_payload_snapshot::text, 'UTF8'), 'sha256'),
  'hex'
)
WHERE qi.queue_items_payload_snapshot IS NOT NULL
  AND coalesce(qi.queue_items_payload_hash, '') = '';

CREATE OR REPLACE FUNCTION public.apply_queue_item_payload_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_message_number integer;
  v_message text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.leads_id IS DISTINCT FROM OLD.leads_id
       OR NEW.templates_id IS DISTINCT FROM OLD.templates_id
       OR NEW.queues_id IS DISTINCT FROM OLD.queues_id THEN
      RAISE EXCEPTION 'Lead, template e fila de um item preparado são imutáveis. Crie um novo item.'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.queue_items_payload_snapshot IS DISTINCT FROM OLD.queue_items_payload_snapshot
       OR NEW.queue_items_payload_hash IS DISTINCT FROM OLD.queue_items_payload_hash
       OR NEW.queue_items_payload_created_at IS DISTINCT FROM OLD.queue_items_payload_created_at THEN
      RAISE EXCEPTION 'O conteúdo congelado do item não pode ser alterado.'
        USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
  END IF;

  IF NEW.templates_id IS NULL THEN
    RAISE EXCEPTION 'Todo item de fila precisa de um template para congelar o conteúdo.'
      USING ERRCODE = '23514';
  END IF;

  NEW.queue_items_payload_created_at := coalesce(NEW.queue_items_created_at, now());
  NEW.queue_items_payload_snapshot := public.build_queue_item_payload_snapshot(
    NEW.users_id,
    NEW.queues_id,
    NEW.leads_id,
    NEW.templates_id,
    NEW.queue_items_payload_created_at
  );

  FOR v_message_number IN 1..4 LOOP
    v_message := trim(coalesce(
      NEW.queue_items_payload_snapshot #>> ARRAY['messages', format('message_%s', v_message_number)],
      ''
    ));
    IF v_message = '' THEN
      RAISE EXCEPTION 'O snapshot precisa conter as quatro mensagens. Mensagem % vazia.', v_message_number
        USING ERRCODE = '23514';
    END IF;
  END LOOP;

  NEW.queue_items_payload_hash := encode(
    extensions.digest(convert_to(NEW.queue_items_payload_snapshot::text, 'UTF8'), 'sha256'),
    'hex'
  );

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS queue_items_content_snapshot_guard ON public.queue_items;
CREATE TRIGGER queue_items_content_snapshot_guard
BEFORE INSERT OR UPDATE OF leads_id, templates_id, queues_id, queue_items_payload_snapshot, queue_items_payload_hash, queue_items_payload_created_at
ON public.queue_items
FOR EACH ROW
EXECUTE FUNCTION public.apply_queue_item_payload_snapshot();

ALTER TABLE public.queue_items
  DROP CONSTRAINT IF EXISTS queue_items_payload_snapshot_object_check;

ALTER TABLE public.queue_items
  ADD CONSTRAINT queue_items_payload_snapshot_object_check
  CHECK (
    queue_items_payload_snapshot IS NULL
    OR jsonb_typeof(queue_items_payload_snapshot) = 'object'
  );

COMMENT ON FUNCTION public.build_queue_item_payload_snapshot(bigint, bigint, bigint, bigint, timestamp with time zone)
IS 'Constrói no PostgreSQL o conteúdo confiável e renderizado que será usado pelo Worker ou pela extensão.';

COMMENT ON FUNCTION public.apply_queue_item_payload_snapshot()
IS 'Cria automaticamente o snapshot no INSERT e impede alterações posteriores no conteúdo congelado.';

REVOKE ALL ON FUNCTION public.queue_snapshot_replace_aliases(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.render_queue_snapshot_message(text, text, text, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.build_queue_item_payload_snapshot(bigint, bigint, bigint, bigint, timestamp with time zone) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_queue_item_payload_snapshot() FROM PUBLIC;

COMMIT;
