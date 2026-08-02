BEGIN;

-- Todo item precisa de uma data própria. O código legado permite rollover de
-- data sem trocar o queue_id, portanto posição é única por recurso/data, e não
-- apenas por fila.
UPDATE public.queue_items AS qi
SET
  queue_items_scheduled_at = q.queues_scheduled_at,
  queue_items_updated_at = now()
FROM public.queues AS q
WHERE q.queues_id = qi.queues_id
  AND qi.queue_items_scheduled_at IS NULL
  AND q.queues_scheduled_at IS NOT NULL;

-- Normaliza posições existentes por usuário, recurso e instante operacional.
WITH ranked_items AS (
  SELECT
    qi.queue_items_id,
    ROW_NUMBER() OVER (
      PARTITION BY qi.users_id, qi.chips_id, qi.socials_id, ((qi.queue_items_scheduled_at AT TIME ZONE 'UTC')::date)
      ORDER BY
        qi.queue_items_position NULLS LAST,
        qi.queue_items_created_at,
        qi.queue_items_id
    )::integer AS normalized_position
  FROM public.queue_items AS qi
  WHERE qi.queue_items_scheduled_at IS NOT NULL
)
UPDATE public.queue_items AS qi
SET
  queue_items_position = ranked_items.normalized_position,
  queue_items_updated_at = now()
FROM ranked_items
WHERE ranked_items.queue_items_id = qi.queue_items_id
  AND qi.queue_items_position IS DISTINCT FROM ranked_items.normalized_position;

CREATE UNIQUE INDEX IF NOT EXISTS queue_items_whatsapp_resource_date_position_unique
  ON public.queue_items (users_id, chips_id, ((queue_items_scheduled_at AT TIME ZONE 'UTC')::date), queue_items_position)
  WHERE chips_id IS NOT NULL
    AND queue_items_scheduled_at IS NOT NULL
    AND queue_items_position IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS queue_items_instagram_resource_date_position_unique
  ON public.queue_items (users_id, socials_id, ((queue_items_scheduled_at AT TIME ZONE 'UTC')::date), queue_items_position)
  WHERE socials_id IS NOT NULL
    AND queue_items_scheduled_at IS NOT NULL
    AND queue_items_position IS NOT NULL;

CREATE OR REPLACE FUNCTION public.guard_queue_item_capacity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_capacity_status_ids bigint[];
  v_channel_id bigint;
  v_daily_limit integer;
  v_used integer;
  v_operational_date date;
  v_existing_item_id bigint;
BEGIN
  SELECT array_agg(s.status_id ORDER BY s.status_id)
    INTO v_capacity_status_ids
  FROM public.status AS s
  WHERE lower(regexp_replace(public.unaccent(trim(s.status_name)), '[^a-z0-9]+', '', 'g')) IN (
    'pendente', 'pending', 'queued',
    'processando', 'processing', 'sending',
    'concluido', 'completed', 'sent',
    'pausado', 'paused'
  );

  IF coalesce(array_length(v_capacity_status_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Catálogo de status operacionais incompleto.';
  END IF;

  -- Estados que não ocupam agenda (erro/cancelado) não reservam capacidade.
  IF NOT (NEW.status_id = ANY(v_capacity_status_ids)) THEN
    RETURN NEW;
  END IF;

  IF NEW.queue_items_scheduled_at IS NULL THEN
    RAISE EXCEPTION 'Item ativo precisa de data de agendamento.'
      USING ERRCODE = '23514';
  END IF;

  IF (NEW.chips_id IS NULL) = (NEW.socials_id IS NULL) THEN
    RAISE EXCEPTION 'Item ativo deve apontar para exatamente um chip ou perfil Instagram.'
      USING ERRCODE = '23514';
  END IF;

  v_operational_date := (NEW.queue_items_scheduled_at AT TIME ZONE 'UTC')::date;

  IF NEW.chips_id IS NOT NULL THEN
    SELECT l.channels_id, l.levels_daily_limit
      INTO v_channel_id, v_daily_limit
    FROM public.chips AS c
    JOIN public.levels AS l
      ON l.levels_id = c.levels_id
     AND l.users_id = c.users_id
    WHERE c.chips_id = NEW.chips_id
      AND c.users_id = NEW.users_id;
  ELSE
    SELECT l.channels_id, l.levels_daily_limit
      INTO v_channel_id, v_daily_limit
    FROM public.socials AS so
    JOIN public.levels AS l
      ON l.levels_id = so.levels_id
     AND l.users_id = so.users_id
    WHERE so.socials_id = NEW.socials_id
      AND so.users_id = NEW.users_id;
  END IF;

  IF v_channel_id IS NULL OR coalesce(v_daily_limit, 0) <= 0 THEN
    RAISE EXCEPTION 'Recurso operacional ou limite diário inválido para o item.'
      USING ERRCODE = '23514';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      format(
        'queue-preparation:%s:%s:%s:%s',
        NEW.users_id,
        v_channel_id,
        coalesce(NEW.chips_id, NEW.socials_id),
        v_operational_date
      ),
      0
    )
  );

  PERFORM pg_advisory_xact_lock(
    hashtextextended(format('queue-lead:%s:%s', NEW.users_id, NEW.leads_id), 0)
  );

  SELECT qi.queue_items_id
    INTO v_existing_item_id
  FROM public.queue_items AS qi
  WHERE qi.users_id = NEW.users_id
    AND qi.leads_id = NEW.leads_id
    AND qi.status_id = ANY(v_capacity_status_ids)
    AND qi.queue_items_id IS DISTINCT FROM NEW.queue_items_id
  ORDER BY qi.queue_items_created_at DESC, qi.queue_items_id DESC
  LIMIT 1;

  IF v_existing_item_id IS NOT NULL THEN
    RAISE EXCEPTION 'O lead % já possui um item ativo (%).', NEW.leads_id, v_existing_item_id
      USING ERRCODE = '23505';
  END IF;

  IF NEW.chips_id IS NOT NULL THEN
    SELECT count(*)::integer
      INTO v_used
    FROM public.queue_items AS qi
    WHERE qi.users_id = NEW.users_id
      AND qi.chips_id = NEW.chips_id
      AND qi.status_id = ANY(v_capacity_status_ids)
      AND (qi.queue_items_scheduled_at AT TIME ZONE 'UTC')::date = v_operational_date
      AND qi.queue_items_id IS DISTINCT FROM NEW.queue_items_id;
  ELSE
    SELECT count(*)::integer
      INTO v_used
    FROM public.queue_items AS qi
    WHERE qi.users_id = NEW.users_id
      AND qi.socials_id = NEW.socials_id
      AND qi.status_id = ANY(v_capacity_status_ids)
      AND (qi.queue_items_scheduled_at AT TIME ZONE 'UTC')::date = v_operational_date
      AND qi.queue_items_id IS DISTINCT FROM NEW.queue_items_id;
  END IF;

  IF v_used >= v_daily_limit THEN
    RAISE EXCEPTION 'Capacidade diária de % item(ns) atingida para o recurso em %.', v_daily_limit, v_operational_date
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS queue_items_capacity_guard ON public.queue_items;
CREATE TRIGGER queue_items_capacity_guard
BEFORE INSERT OR UPDATE OF status_id, chips_id, socials_id, queue_items_scheduled_at
ON public.queue_items
FOR EACH ROW
EXECUTE FUNCTION public.guard_queue_item_capacity();

COMMENT ON FUNCTION public.guard_queue_item_capacity()
IS 'Impede duplicidade ativa por lead e excesso de capacidade em inserções, reprocessamentos e reagendamentos.';

CREATE OR REPLACE FUNCTION public.prepare_queue_items(
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
  WHERE lower(regexp_replace(public.unaccent(trim(c.channels_name)), '[^a-z0-9]+', '', 'g')) = v_channel_name
  ORDER BY c.channels_id
  LIMIT 1;

  IF v_channel_id IS NULL THEN
    RAISE EXCEPTION 'Canal % não encontrado no catálogo.', p_channel;
  END IF;

  SELECT s.status_id
    INTO v_active_status_id
  FROM public.status AS s
  WHERE lower(regexp_replace(public.unaccent(trim(s.status_name)), '[^a-z0-9]+', '', 'g')) IN ('ativo', 'active')
  ORDER BY CASE WHEN lower(regexp_replace(public.unaccent(trim(s.status_name)), '[^a-z0-9]+', '', 'g')) = 'ativo' THEN 0 ELSE 1 END,
           s.status_id
  LIMIT 1;

  SELECT s.status_id
    INTO v_pending_status_id
  FROM public.status AS s
  WHERE lower(regexp_replace(public.unaccent(trim(s.status_name)), '[^a-z0-9]+', '', 'g')) IN ('pendente', 'pending', 'queued')
  ORDER BY CASE WHEN lower(regexp_replace(public.unaccent(trim(s.status_name)), '[^a-z0-9]+', '', 'g')) = 'pendente' THEN 0 ELSE 1 END,
           s.status_id
  LIMIT 1;

  SELECT ls.lead_status_id
    INTO v_validated_lead_status_id
  FROM public.lead_status AS ls
  WHERE lower(regexp_replace(public.unaccent(trim(ls.lead_status_name)), '[^a-z0-9]+', '', 'g')) IN ('validado', 'validated')
  ORDER BY ls.lead_status_id
  LIMIT 1;

  SELECT ls.lead_status_id
    INTO v_queued_lead_status_id
  FROM public.lead_status AS ls
  WHERE lower(regexp_replace(public.unaccent(trim(ls.lead_status_name)), '[^a-z0-9]+', '', 'g')) IN ('nafila', 'queued')
  ORDER BY ls.lead_status_id
  LIMIT 1;

  SELECT array_agg(s.status_id ORDER BY s.status_id)
    INTO v_capacity_status_ids
  FROM public.status AS s
  WHERE lower(regexp_replace(public.unaccent(trim(s.status_name)), '[^a-z0-9]+', '', 'g')) IN (
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
        lower(regexp_replace(public.unaccent(trim(tc.template_channels_name)), '[^a-z0-9]+', '', 'g')) = v_channel_name
        OR lower(regexp_replace(public.unaccent(trim(tc.template_channels_name)), '[^a-z0-9]+', '', 'g')) IN ('geral', 'general')
      )
      AND length(trim(t.templates_message_1)) > 0
      AND length(trim(t.templates_message_2)) > 0
      AND length(trim(t.templates_message_3)) > 0
      AND length(trim(t.templates_message_4)) > 0
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

COMMENT ON FUNCTION public.prepare_queue_items(text, bigint, date, jsonb)
IS 'Reserva capacidade, cria fila e item e altera o lead para na_fila em uma única transação serializada por recurso/data.';

REVOKE ALL ON FUNCTION public.prepare_queue_items(text, bigint, date, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prepare_queue_items(text, bigint, date, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.prepare_queue_items(text, bigint, date, jsonb) TO authenticated;

-- A partir desta migração, o frontend autenticado não pode criar filas ou
-- itens diretamente. Toda inclusão deve passar por prepare_queue_items().
DROP POLICY IF EXISTS queues_own_insert ON public.queues;
DROP POLICY IF EXISTS queue_items_own_insert ON public.queue_items;
REVOKE INSERT ON public.queues FROM authenticated;
REVOKE INSERT ON public.queue_items FROM authenticated;

COMMIT;
