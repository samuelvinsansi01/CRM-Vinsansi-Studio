-- CRM - Vinsansi Studio v2.4.0-R54
-- Puxada agendada, leve e consolidada.
--
-- Objetivos:
--   * a data selecionada passa a ser parte explicita do contrato da puxada;
--   * Home e Fila/Revisao usam o mesmo motor de selecao/reserva;
--   * nenhuma hidratacao completa da fila/base e necessaria para "Puxar";
--   * selecao + lock + reserva acontecem atomicamente no banco;
--   * cada clique reserva no maximo a quantidade explicitamente solicitada;
--   * nao existe refill, oversampling, segunda passada ou retry automatico;
--   * released volta somente em uma ACAO futura, pois cada acao executa uma unica reserva;
--   * reconciliacao WhatsApp ocorre em uma unica RPC;
--   * objetos antigos exclusivos da puxada R23/R53 sao removidos no fim.

BEGIN;

-- ---------------------------------------------------------------------------
-- Indices da selecao por qualidade e dos bloqueios da revisao.
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS leads_queue_pull_whatsapp_priority_idx
  ON public.leads(
    organizations_id,
    users_id,
    (coalesce(leads_score,0)) DESC,
    (coalesce(leads_reviews_count,0)) DESC,
    leads_id ASC
  )
  WHERE lead_status_id = 1
    AND length(regexp_replace(public.effective_whatsapp_phone(leads_whatsapp,leads_phone),'[^0-9]+','','g')) >= 10;

CREATE INDEX IF NOT EXISTS leads_queue_pull_instagram_priority_idx
  ON public.leads(
    organizations_id,
    users_id,
    (coalesce(leads_score,0)) DESC,
    (coalesce(leads_reviews_count,0)) DESC,
    leads_id ASC
  )
  WHERE lead_status_id = 1
    AND length(btrim(coalesce(leads_instagram,''))) > 0;

CREATE INDEX IF NOT EXISTS queue_review_items_batch_terminal_block_idx
  ON public.queue_review_items(queue_review_batches_id,leads_id)
  WHERE review_status IN ('invalidated','locked');

CREATE INDEX IF NOT EXISTS queue_review_batches_resource_date_idx
  ON public.queue_review_batches(organizations_id,users_id,channel_key,resource_id,scheduled_date,review_status);

-- Capacidade moderna: queue_items_scheduled_at e consultado por faixa, sem cast
-- sobre a coluna. O indice legado abaixo cobre apenas itens antigos sem data no item.
CREATE INDEX IF NOT EXISTS queue_items_whatsapp_scheduled_capacity_idx
  ON public.queue_items(organizations_id,users_id,chips_id,queue_items_scheduled_at,status_id)
  WHERE chips_id IS NOT NULL AND queue_items_scheduled_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS queue_items_instagram_scheduled_capacity_idx
  ON public.queue_items(organizations_id,users_id,socials_id,queue_items_scheduled_at,status_id)
  WHERE socials_id IS NOT NULL AND queue_items_scheduled_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS queue_items_legacy_schedule_capacity_idx
  ON public.queue_items(organizations_id,users_id,queues_id,status_id,chips_id,socials_id)
  WHERE queue_items_scheduled_at IS NULL;

CREATE INDEX IF NOT EXISTS queues_scheduled_capacity_idx
  ON public.queues(organizations_id,users_id,channels_id,queues_scheduled_at,queues_id);

-- ---------------------------------------------------------------------------
-- Capacidade por recurso/data sem COALESCE/cast no caminho moderno.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.queue_review_resource_capacity(
  p_channel text,
  p_resource_id bigint,
  p_scheduled_date date
)
RETURNS TABLE(daily_limit integer,used integer,available integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog,public
AS $$
DECLARE
  v_org bigint:=public.current_organization_id();
  v_user bigint:=public.ensure_current_user();
  v_channel text:=lower(trim(coalesce(p_channel,'')));
  v_channel_id bigint;
  v_active bigint;
  v_invalid_status_ids bigint[];
  v_limit integer;
  v_used integer:=0;
  v_date date:=coalesce(p_scheduled_date,current_date);
  v_start timestamptz;
  v_end timestamptz;
BEGIN
  IF v_channel NOT IN ('whatsapp','instagram') THEN RAISE EXCEPTION 'queue_review_invalid_channel'; END IF;
  IF p_resource_id IS NULL OR p_resource_id<=0 THEN RAISE EXCEPTION 'queue_review_resource_required'; END IF;

  v_channel_id:=public.queue_review_channel_id(v_channel);
  SELECT s.status_id INTO v_active
  FROM public.status s
  WHERE regexp_replace(lower(public.unaccent(trim(s.status_name))), '[^a-z0-9]+', '', 'g') IN ('ativo','active')
  ORDER BY s.status_id LIMIT 1;

  -- Mantem exatamente a semantica R26: tudo consome capacidade, exceto
  -- itens explicitamente invalidos/cancelados.
  SELECT coalesce(array_agg(s.status_id ORDER BY s.status_id),'{}'::bigint[])
  INTO v_invalid_status_ids
  FROM public.status s
  WHERE regexp_replace(lower(public.unaccent(trim(s.status_name))), '[^a-z0-9]+', '', 'g') IN
    ('invalido','invalid','cancelado','cancelled','canceled');

  -- prepare_queue_items grava a data operacional em UTC (normalmente 12:00 UTC).
  -- Consultar por faixa preserva a mesma data R26 sem aplicar cast na coluna.
  v_start := (v_date::timestamp AT TIME ZONE 'UTC');
  v_end := ((v_date + 1)::timestamp AT TIME ZONE 'UTC');

  IF v_channel='whatsapp' THEN
    SELECT l.levels_daily_limit INTO v_limit
    FROM public.chips c
    JOIN public.instances i ON i.instances_id=c.instances_id AND i.users_id=c.users_id
    JOIN public.levels l ON l.levels_id=c.levels_id AND l.users_id=c.users_id
    WHERE c.chips_id=p_resource_id AND c.users_id=v_user AND c.status_id=v_active
      AND i.status_id=v_active AND l.status_id=v_active AND l.channels_id=v_channel_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'queue_review_resource_not_operational'; END IF;

    SELECT count(*)::integer INTO v_used
    FROM public.queue_items qi
    JOIN public.queues q ON q.queues_id=qi.queues_id AND q.users_id=qi.users_id
    WHERE qi.organizations_id=v_org AND qi.users_id=v_user
      AND q.organizations_id=v_org AND q.channels_id=v_channel_id
      AND qi.chips_id=p_resource_id
      AND NOT (qi.status_id=ANY(v_invalid_status_ids))
      AND (
        (qi.queue_items_scheduled_at IS NOT NULL AND qi.queue_items_scheduled_at>=v_start AND qi.queue_items_scheduled_at<v_end)
        OR
        (qi.queue_items_scheduled_at IS NULL AND q.queues_scheduled_at>=v_start AND q.queues_scheduled_at<v_end)
      );
  ELSE
    SELECT l.levels_daily_limit INTO v_limit
    FROM public.socials so
    JOIN public.levels l ON l.levels_id=so.levels_id AND l.users_id=so.users_id
    WHERE so.socials_id=p_resource_id AND so.users_id=v_user AND so.status_id=v_active
      AND l.status_id=v_active AND l.channels_id=v_channel_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'queue_review_resource_not_operational'; END IF;

    SELECT count(*)::integer INTO v_used
    FROM public.queue_items qi
    JOIN public.queues q ON q.queues_id=qi.queues_id AND q.users_id=qi.users_id
    WHERE qi.organizations_id=v_org AND qi.users_id=v_user
      AND q.organizations_id=v_org AND q.channels_id=v_channel_id
      AND qi.socials_id=p_resource_id
      AND NOT (qi.status_id=ANY(v_invalid_status_ids))
      AND (
        (qi.queue_items_scheduled_at IS NOT NULL AND qi.queue_items_scheduled_at>=v_start AND qi.queue_items_scheduled_at<v_end)
        OR
        (qi.queue_items_scheduled_at IS NULL AND q.queues_scheduled_at>=v_start AND q.queues_scheduled_at<v_end)
      );
  END IF;

  daily_limit:=greatest(0,coalesce(v_limit,0));
  used:=greatest(0,coalesce(v_used,0));
  available:=greatest(0,daily_limit-used);
  RETURN NEXT;
END
$$;

REVOKE ALL ON FUNCTION public.queue_review_resource_capacity(text,bigint,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.queue_review_resource_capacity(text,bigint,date) TO authenticated,service_role;

-- ---------------------------------------------------------------------------
-- Lista leve de recursos. Substitui snapshot() no caminho de "Puxar".
-- used/available consideram Fila final + Revisao aberta da data escolhida.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.list_queue_review_resources(
  p_channel text,
  p_scheduled_date date DEFAULT current_date
)
RETURNS TABLE(
  resource_id bigint,
  resource_label text,
  daily_limit integer,
  final_used integer,
  review_open integer,
  used integer,
  available integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog,public
AS $$
DECLARE
  v_org bigint:=public.current_organization_id();
  v_user bigint:=public.ensure_current_user();
  v_channel text:=lower(trim(coalesce(p_channel,'')));
  v_date date:=coalesce(p_scheduled_date,current_date);
  v_active bigint;
  v_channel_id bigint;
  v_invalid_status_ids bigint[];
  v_start timestamptz:=(coalesce(p_scheduled_date,current_date)::timestamp AT TIME ZONE 'UTC');
  v_end timestamptz:=((coalesce(p_scheduled_date,current_date)+1)::timestamp AT TIME ZONE 'UTC');
BEGIN
  PERFORM public.require_organization_permission('queues.prepare');
  IF v_channel NOT IN ('whatsapp','instagram') THEN RAISE EXCEPTION 'queue_review_invalid_channel'; END IF;
  v_channel_id:=public.queue_review_channel_id(v_channel);

  SELECT s.status_id INTO v_active
  FROM public.status s
  WHERE regexp_replace(lower(public.unaccent(trim(s.status_name))), '[^a-z0-9]+', '', 'g') IN ('ativo','active')
  ORDER BY s.status_id LIMIT 1;

  SELECT coalesce(array_agg(s.status_id ORDER BY s.status_id),'{}'::bigint[])
  INTO v_invalid_status_ids
  FROM public.status s
  WHERE regexp_replace(lower(public.unaccent(trim(s.status_name))), '[^a-z0-9]+', '', 'g') IN
    ('invalido','invalid','cancelado','cancelled','canceled');

  IF v_channel='whatsapp' THEN
    RETURN QUERY
    WITH final_raw AS (
      SELECT qi.chips_id AS rid,count(*)::integer AS qty
      FROM public.queue_items qi
      JOIN public.queues q ON q.queues_id=qi.queues_id AND q.users_id=qi.users_id
      WHERE qi.organizations_id=v_org AND qi.users_id=v_user
        AND q.organizations_id=v_org AND q.channels_id=v_channel_id
        AND qi.chips_id IS NOT NULL
        AND NOT (qi.status_id=ANY(v_invalid_status_ids))
        AND qi.queue_items_scheduled_at IS NOT NULL
        AND qi.queue_items_scheduled_at>=v_start AND qi.queue_items_scheduled_at<v_end
      GROUP BY qi.chips_id
      UNION ALL
      SELECT qi.chips_id AS rid,count(*)::integer AS qty
      FROM public.queue_items qi
      JOIN public.queues q ON q.queues_id=qi.queues_id AND q.users_id=qi.users_id
      WHERE qi.organizations_id=v_org AND qi.users_id=v_user
        AND q.organizations_id=v_org AND q.channels_id=v_channel_id
        AND qi.chips_id IS NOT NULL
        AND NOT (qi.status_id=ANY(v_invalid_status_ids))
        AND qi.queue_items_scheduled_at IS NULL
        AND q.queues_scheduled_at>=v_start AND q.queues_scheduled_at<v_end
      GROUP BY qi.chips_id
    ), final_usage AS (
      SELECT rid,sum(qty)::integer AS qty FROM final_raw GROUP BY rid
    ), review_usage AS (
      SELECT b.resource_id AS rid,count(*)::integer AS qty
      FROM public.queue_review_batches b
      JOIN public.queue_review_items i ON i.queue_review_batches_id=b.queue_review_batches_id AND i.review_status='open'
      WHERE b.organizations_id=v_org AND b.users_id=v_user AND b.review_status='open'
        AND b.channel_key='whatsapp' AND b.scheduled_date=v_date
      GROUP BY b.resource_id
    )
    SELECT
      c.chips_id,
      coalesce(nullif(btrim(c.chips_name),''),i.instances_name,c.chips_id::text),
      greatest(0,coalesce(l.levels_daily_limit,0))::integer,
      greatest(0,coalesce(fu.qty,0))::integer,
      greatest(0,coalesce(ru.qty,0))::integer,
      greatest(0,coalesce(fu.qty,0)+coalesce(ru.qty,0))::integer,
      greatest(0,coalesce(l.levels_daily_limit,0)-coalesce(fu.qty,0)-coalesce(ru.qty,0))::integer
    FROM public.chips c
    JOIN public.instances i ON i.instances_id=c.instances_id AND i.users_id=c.users_id
    JOIN public.levels l ON l.levels_id=c.levels_id AND l.users_id=c.users_id
    JOIN public.instance_runtime_states rs ON rs.instances_id=i.instances_id AND rs.users_id=i.users_id
    LEFT JOIN final_usage fu ON fu.rid=c.chips_id
    LEFT JOIN review_usage ru ON ru.rid=c.chips_id
    WHERE c.users_id=v_user AND c.status_id=v_active AND i.status_id=v_active AND l.status_id=v_active
      AND l.channels_id=v_channel_id
      AND rs.operational_state='online' AND rs.session_saved IS TRUE AND rs.socket_connected IS TRUE
    ORDER BY c.chips_name,c.chips_id;
    RETURN;
  END IF;

  RETURN QUERY
  WITH final_raw AS (
    SELECT qi.socials_id AS rid,count(*)::integer AS qty
    FROM public.queue_items qi
    JOIN public.queues q ON q.queues_id=qi.queues_id AND q.users_id=qi.users_id
    WHERE qi.organizations_id=v_org AND qi.users_id=v_user
      AND q.organizations_id=v_org AND q.channels_id=v_channel_id
      AND qi.socials_id IS NOT NULL
      AND NOT (qi.status_id=ANY(v_invalid_status_ids))
      AND qi.queue_items_scheduled_at IS NOT NULL
      AND qi.queue_items_scheduled_at>=v_start AND qi.queue_items_scheduled_at<v_end
    GROUP BY qi.socials_id
    UNION ALL
    SELECT qi.socials_id AS rid,count(*)::integer AS qty
    FROM public.queue_items qi
    JOIN public.queues q ON q.queues_id=qi.queues_id AND q.users_id=qi.users_id
    WHERE qi.organizations_id=v_org AND qi.users_id=v_user
      AND q.organizations_id=v_org AND q.channels_id=v_channel_id
      AND qi.socials_id IS NOT NULL
      AND NOT (qi.status_id=ANY(v_invalid_status_ids))
      AND qi.queue_items_scheduled_at IS NULL
      AND q.queues_scheduled_at>=v_start AND q.queues_scheduled_at<v_end
    GROUP BY qi.socials_id
  ), final_usage AS (
    SELECT rid,sum(qty)::integer AS qty FROM final_raw GROUP BY rid
  ), review_usage AS (
    SELECT b.resource_id AS rid,count(*)::integer AS qty
    FROM public.queue_review_batches b
    JOIN public.queue_review_items i ON i.queue_review_batches_id=b.queue_review_batches_id AND i.review_status='open'
    WHERE b.organizations_id=v_org AND b.users_id=v_user AND b.review_status='open'
      AND b.channel_key='instagram' AND b.scheduled_date=v_date
    GROUP BY b.resource_id
  )
  SELECT
    so.socials_id,
    coalesce(nullif(btrim(so.socials_name),''),concat('@',regexp_replace(coalesce(so.socials_username,''),'^@','','g')),so.socials_id::text),
    greatest(0,coalesce(l.levels_daily_limit,0))::integer,
    greatest(0,coalesce(fu.qty,0))::integer,
    greatest(0,coalesce(ru.qty,0))::integer,
    greatest(0,coalesce(fu.qty,0)+coalesce(ru.qty,0))::integer,
    greatest(0,coalesce(l.levels_daily_limit,0)-coalesce(fu.qty,0)-coalesce(ru.qty,0))::integer
  FROM public.socials so
  JOIN public.levels l ON l.levels_id=so.levels_id AND l.users_id=so.users_id
  LEFT JOIN final_usage fu ON fu.rid=so.socials_id
  LEFT JOIN review_usage ru ON ru.rid=so.socials_id
  WHERE so.users_id=v_user AND so.status_id=v_active AND l.status_id=v_active AND l.channels_id=v_channel_id
    AND length(btrim(coalesce(so.socials_username,'')))>0
  ORDER BY so.socials_name,so.socials_id;
END
$$;

REVOKE ALL ON FUNCTION public.list_queue_review_resources(text,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_queue_review_resources(text,date) TO authenticated;

-- ---------------------------------------------------------------------------
-- Abre/recupera o lote pela chave que a UI conhece (ID, nome, instancia/@).
-- A data escolhida e parte obrigatoria da chave operacional.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.open_queue_review_batch_by_key(
  p_channel text,
  p_resource_key text,
  p_scheduled_date date DEFAULT current_date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog,public
AS $$
DECLARE
  v_org bigint:=public.current_organization_id();
  v_user bigint:=public.ensure_current_user();
  v_channel text:=lower(trim(coalesce(p_channel,'')));
  v_key text:=lower(trim(coalesce(p_resource_key,'')));
  v_date date:=coalesce(p_scheduled_date,current_date);
  v_local_today date;
  v_tz text:='America/Sao_Paulo';
  v_active bigint;
  v_channel_id bigint;
  v_resource_id bigint;
  v_resource_label text;
  v_provider_key text;
  v_capacity record;
  v_review_open integer:=0;
  v_batch bigint;
BEGIN
  PERFORM public.require_organization_permission('queues.prepare');
  IF v_channel NOT IN ('whatsapp','instagram') THEN RAISE EXCEPTION 'queue_review_invalid_channel'; END IF;
  IF v_key='' THEN RAISE EXCEPTION 'queue_review_resource_required'; END IF;

  SELECT coalesce(nullif(ots.settings->>'operationalTimezone',''),'America/Sao_Paulo')
  INTO v_tz
  FROM public.organization_tool_settings ots
  WHERE ots.organizations_id=v_org AND ots.tool_id='vinsansi_whatsapp_manager';
  v_tz:=coalesce(nullif(v_tz,''),'America/Sao_Paulo');
  v_local_today:=(now() AT TIME ZONE v_tz)::date;
  IF v_date<v_local_today OR v_date>v_local_today+366 THEN RAISE EXCEPTION 'queue_review_scheduled_date_invalid'; END IF;

  v_channel_id:=public.queue_review_channel_id(v_channel);
  SELECT s.status_id INTO v_active
  FROM public.status s
  WHERE regexp_replace(lower(public.unaccent(trim(s.status_name))), '[^a-z0-9]+', '', 'g') IN ('ativo','active')
  ORDER BY s.status_id LIMIT 1;

  IF v_channel='whatsapp' THEN
    SELECT
      c.chips_id,
      coalesce(nullif(btrim(c.chips_name),''),i.instances_name,c.chips_id::text),
      coalesce(i.instances_name,'')
    INTO v_resource_id,v_resource_label,v_provider_key
    FROM public.chips c
    JOIN public.instances i ON i.instances_id=c.instances_id AND i.users_id=c.users_id
    JOIN public.levels l ON l.levels_id=c.levels_id AND l.users_id=c.users_id
    JOIN public.instance_runtime_states rs ON rs.instances_id=i.instances_id AND rs.users_id=i.users_id
    WHERE c.users_id=v_user AND c.status_id=v_active AND i.status_id=v_active AND l.status_id=v_active
      AND l.channels_id=v_channel_id
      AND rs.operational_state='online' AND rs.session_saved IS TRUE AND rs.socket_connected IS TRUE
      AND (
        c.chips_id::text=v_key OR lower(btrim(coalesce(c.chips_name,'')))=v_key
        OR lower(btrim(coalesce(i.instances_name,'')))=v_key
      )
    ORDER BY c.chips_id LIMIT 1;
  ELSE
    SELECT
      so.socials_id,
      coalesce(nullif(btrim(so.socials_name),''),concat('@',regexp_replace(coalesce(so.socials_username,''),'^@','','g')),so.socials_id::text),
      regexp_replace(coalesce(so.socials_username,''),'^@','','g')
    INTO v_resource_id,v_resource_label,v_provider_key
    FROM public.socials so
    JOIN public.levels l ON l.levels_id=so.levels_id AND l.users_id=so.users_id
    WHERE so.users_id=v_user AND so.status_id=v_active AND l.status_id=v_active AND l.channels_id=v_channel_id
      AND length(btrim(coalesce(so.socials_username,'')))>0
      AND (
        so.socials_id::text=v_key OR lower(btrim(coalesce(so.socials_name,'')))=v_key
        OR lower(regexp_replace(btrim(coalesce(so.socials_username,'')),'^@','','g'))=regexp_replace(v_key,'^@','','g')
      )
    ORDER BY so.socials_id LIMIT 1;
  END IF;

  IF v_resource_id IS NULL THEN RAISE EXCEPTION 'queue_review_resource_not_operational'; END IF;

  -- A trava vem antes da capacidade e da abertura para duas puxadas do mesmo
  -- recurso/data nunca calcularem a mesma vaga simultaneamente.
  PERFORM pg_advisory_xact_lock(hashtextextended(format('queue-review:%s:%s:%s:%s',v_org,v_channel,v_resource_id,v_date),0));
  SELECT * INTO v_capacity FROM public.queue_review_resource_capacity(v_channel,v_resource_id,v_date);

  SELECT b.queue_review_batches_id INTO v_batch
  FROM public.queue_review_batches b
  WHERE b.organizations_id=v_org AND b.users_id=v_user AND b.channel_key=v_channel
    AND b.resource_id=v_resource_id AND b.scheduled_date=v_date AND b.review_status='open'
  FOR UPDATE;

  IF v_batch IS NULL THEN
    INSERT INTO public.queue_review_batches(organizations_id,users_id,channels_id,channel_key,resource_id,scheduled_date,target_count)
    VALUES(v_org,v_user,v_channel_id,v_channel,v_resource_id,v_date,v_capacity.available)
    RETURNING queue_review_batches_id INTO v_batch;
  ELSE
    UPDATE public.queue_review_batches
    SET target_count=v_capacity.available,updated_at=now()
    WHERE queue_review_batches_id=v_batch;
  END IF;

  SELECT count(*)::integer INTO v_review_open
  FROM public.queue_review_items i
  WHERE i.queue_review_batches_id=v_batch AND i.review_status='open';

  RETURN jsonb_build_object(
    'batchId',v_batch,
    'channel',v_channel,
    'resourceId',v_resource_id,
    'resourceLabel',v_resource_label,
    'providerKey',v_provider_key,
    'scheduledDate',v_date,
    'dailyLimit',v_capacity.daily_limit,
    'used',v_capacity.used,
    'targetCount',v_capacity.available,
    'openCount',greatest(0,coalesce(v_review_open,0)),
    'missingCount',greatest(0,coalesce(v_capacity.available,0)-coalesce(v_review_open,0))
  );
END
$$;

REVOKE ALL ON FUNCTION public.open_queue_review_batch_by_key(text,text,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.open_queue_review_batch_by_key(text,text,date) TO authenticated;

-- ---------------------------------------------------------------------------
-- Selecao + lock + reserva atomicos. Nao existe candidate RPC + reserve RPC.
-- p_limit e o limite EXPLICITO daquela acao. Esta funcao e chamada uma unica vez
-- por clique; por isso nao existe refill/oversampling/segunda passagem.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reserve_next_queue_review_items(
  p_batch_id bigint,
  p_limit integer
)
RETURNS TABLE(
  lead_id bigint,
  review_item_id bigint,
  company text,
  phone text,
  normalized_phone text,
  instagram text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog,public
AS $$
DECLARE
  v_org bigint:=public.current_organization_id();
  v_user bigint:=public.ensure_current_user();
  v_batch public.queue_review_batches%ROWTYPE;
  v_capacity record;
  v_open integer;
  v_pos integer;
  v_wanted integer;
  v_lead record;
BEGIN
  PERFORM public.require_organization_permission('queues.prepare');

  SELECT * INTO v_batch
  FROM public.queue_review_batches b
  WHERE b.queue_review_batches_id=p_batch_id AND b.organizations_id=v_org AND b.users_id=v_user AND b.review_status='open';
  IF NOT FOUND THEN RAISE EXCEPTION 'queue_review_batch_not_open'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(format('queue-review:%s:%s:%s:%s',v_org,v_batch.channel_key,v_batch.resource_id,v_batch.scheduled_date),0));
  SELECT * INTO v_batch
  FROM public.queue_review_batches b
  WHERE b.queue_review_batches_id=p_batch_id AND b.organizations_id=v_org AND b.users_id=v_user AND b.review_status='open'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'queue_review_batch_not_open'; END IF;

  SELECT * INTO v_capacity
  FROM public.queue_review_resource_capacity(v_batch.channel_key,v_batch.resource_id,v_batch.scheduled_date);
  UPDATE public.queue_review_batches SET target_count=v_capacity.available,updated_at=now()
  WHERE queue_review_batches_id=p_batch_id;
  v_batch.target_count:=v_capacity.available;

  SELECT coalesce(max(i.review_position),0) INTO v_pos
  FROM public.queue_review_items i
  WHERE i.queue_review_batches_id=p_batch_id;
  SELECT count(*)::integer INTO v_open
  FROM public.queue_review_items i
  WHERE i.queue_review_batches_id=p_batch_id AND i.review_status='open';

  v_wanted:=least(
    greatest(0,coalesce(p_limit,0)),
    greatest(0,v_batch.target_count-v_open),
    500
  );
  IF v_wanted<=0 THEN RETURN; END IF;

  -- As consultas sao separadas por canal de proposito. Isso permite ao planner
  -- usar os indices parciais de prioridade de cada canal; um CASE parametrizado
  -- faria o PostgreSQL perder a prova do predicado do indice.
  IF v_batch.channel_key='whatsapp' THEN
    FOR v_lead IN
      SELECT
        l.leads_id,
        l.leads_name,
        public.effective_whatsapp_phone(l.leads_whatsapp,l.leads_phone) AS effective_phone,
        regexp_replace(public.effective_whatsapp_phone(l.leads_whatsapp,l.leads_phone),'[^0-9]+','','g') AS normalized_phone,
        coalesce(l.leads_instagram,'') AS instagram
      FROM public.leads l
      WHERE l.organizations_id=v_org AND l.users_id=v_user AND l.lead_status_id=1
        AND length(regexp_replace(public.effective_whatsapp_phone(l.leads_whatsapp,l.leads_phone),'[^0-9]+','','g'))>=10
        AND NOT EXISTS(
          SELECT 1 FROM public.queue_review_items ri
          WHERE ri.organizations_id=v_org AND ri.leads_id=l.leads_id AND ri.review_status='open'
        )
        AND NOT EXISTS(
          SELECT 1 FROM public.queue_review_items ri
          WHERE ri.queue_review_batches_id=p_batch_id AND ri.leads_id=l.leads_id
            AND ri.review_status IN ('invalidated','locked')
        )
        AND NOT EXISTS(
          SELECT 1 FROM public.permanent_records pr
          WHERE pr.organizations_id=v_org AND pr.canonical_lead_id=coalesce(l.canonical_lead_id,l.leads_id)
        )
      ORDER BY coalesce(l.leads_score,0) DESC,coalesce(l.leads_reviews_count,0) DESC,l.leads_id ASC
      LIMIT v_wanted
      FOR UPDATE OF l SKIP LOCKED
    LOOP
      v_pos:=v_pos+1;
      INSERT INTO public.queue_review_items(organizations_id,queue_review_batches_id,leads_id,review_position)
      VALUES(v_org,p_batch_id,v_lead.leads_id,v_pos)
      RETURNING queue_review_items_id INTO review_item_id;

      UPDATE public.leads
      SET lead_status_id=3,channels_id=v_batch.channels_id,leads_updated_at=now()
      WHERE leads_id=v_lead.leads_id AND organizations_id=v_org AND users_id=v_user AND lead_status_id=1;
      IF NOT FOUND THEN RAISE EXCEPTION 'queue_review_lead_changed'; END IF;

      lead_id:=v_lead.leads_id;
      company:=v_lead.leads_name;
      phone:=coalesce(v_lead.effective_phone,'');
      normalized_phone:=coalesce(v_lead.normalized_phone,'');
      instagram:=coalesce(v_lead.instagram,'');
      RETURN NEXT;
    END LOOP;
  ELSE
    FOR v_lead IN
      SELECT
        l.leads_id,
        l.leads_name,
        ''::text AS effective_phone,
        ''::text AS normalized_phone,
        coalesce(l.leads_instagram,'') AS instagram
      FROM public.leads l
      WHERE l.organizations_id=v_org AND l.users_id=v_user AND l.lead_status_id=1
        AND length(btrim(coalesce(l.leads_instagram,'')))>0
        AND NOT EXISTS(
          SELECT 1 FROM public.queue_review_items ri
          WHERE ri.organizations_id=v_org AND ri.leads_id=l.leads_id AND ri.review_status='open'
        )
        AND NOT EXISTS(
          SELECT 1 FROM public.queue_review_items ri
          WHERE ri.queue_review_batches_id=p_batch_id AND ri.leads_id=l.leads_id
            AND ri.review_status IN ('invalidated','locked')
        )
        AND NOT EXISTS(
          SELECT 1 FROM public.permanent_records pr
          WHERE pr.organizations_id=v_org AND pr.canonical_lead_id=coalesce(l.canonical_lead_id,l.leads_id)
        )
      ORDER BY coalesce(l.leads_score,0) DESC,coalesce(l.leads_reviews_count,0) DESC,l.leads_id ASC
      LIMIT v_wanted
      FOR UPDATE OF l SKIP LOCKED
    LOOP
      v_pos:=v_pos+1;
      INSERT INTO public.queue_review_items(organizations_id,queue_review_batches_id,leads_id,review_position)
      VALUES(v_org,p_batch_id,v_lead.leads_id,v_pos)
      RETURNING queue_review_items_id INTO review_item_id;

      UPDATE public.leads
      SET lead_status_id=3,channels_id=v_batch.channels_id,leads_updated_at=now()
      WHERE leads_id=v_lead.leads_id AND organizations_id=v_org AND users_id=v_user AND lead_status_id=1;
      IF NOT FOUND THEN RAISE EXCEPTION 'queue_review_lead_changed'; END IF;

      lead_id:=v_lead.leads_id;
      company:=v_lead.leads_name;
      phone:='';
      normalized_phone:='';
      instagram:=coalesce(v_lead.instagram,'');
      RETURN NEXT;
    END LOOP;
  END IF;

  UPDATE public.queue_review_batches SET updated_at=now() WHERE queue_review_batches_id=p_batch_id;
END
$$;

REVOKE ALL ON FUNCTION public.reserve_next_queue_review_items(bigint,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.reserve_next_queue_review_items(bigint,integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- Uma unica reconciliacao depois da resposta WhatsApp.
-- validos voltam para PRE_SEND; erros tecnicos sao released/Importado;
-- invalidos/redirecionados ja alterados pelo contrato canonico sao podados.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reconcile_queue_review_whatsapp_validation(
  p_batch_id bigint,
  p_approved_ids bigint[] DEFAULT '{}'::bigint[],
  p_release_ids bigint[] DEFAULT '{}'::bigint[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog,public
AS $$
DECLARE
  v_org bigint:=public.current_organization_id();
  v_user bigint:=public.ensure_current_user();
  v_batch public.queue_review_batches%ROWTYPE;
  v_capacity record;
  v_open integer;
  v_restored integer:=0;
  v_released integer:=0;
  v_pruned integer:=0;
BEGIN
  PERFORM public.require_organization_permission('queues.prepare');
  SELECT * INTO v_batch
  FROM public.queue_review_batches b
  WHERE b.queue_review_batches_id=p_batch_id AND b.organizations_id=v_org AND b.users_id=v_user
    AND b.channel_key='whatsapp' AND b.review_status='open';
  IF NOT FOUND THEN RAISE EXCEPTION 'queue_review_batch_not_open'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(format('queue-review:%s:%s:%s:%s',v_org,v_batch.channel_key,v_batch.resource_id,v_batch.scheduled_date),0));
  SELECT * INTO v_batch
  FROM public.queue_review_batches b
  WHERE b.queue_review_batches_id=p_batch_id AND b.organizations_id=v_org AND b.users_id=v_user
    AND b.channel_key='whatsapp' AND b.review_status='open'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'queue_review_batch_not_open'; END IF;

  UPDATE public.leads l
  SET lead_status_id=3,channels_id=v_batch.channels_id,leads_updated_at=now()
  WHERE l.organizations_id=v_org AND l.users_id=v_user AND l.lead_status_id=2
    AND l.leads_id=ANY(coalesce(p_approved_ids,'{}'::bigint[]))
    AND EXISTS(
      SELECT 1 FROM public.queue_review_items i
      WHERE i.queue_review_batches_id=p_batch_id AND i.leads_id=l.leads_id AND i.review_status='open'
    );
  GET DIAGNOSTICS v_restored=ROW_COUNT;

  UPDATE public.leads l
  SET lead_status_id=1,channels_id=NULL,leads_updated_at=now()
  WHERE l.organizations_id=v_org AND l.users_id=v_user AND l.lead_status_id=3
    AND l.leads_id=ANY(coalesce(p_release_ids,'{}'::bigint[]))
    AND EXISTS(
      SELECT 1 FROM public.queue_review_items i
      WHERE i.queue_review_batches_id=p_batch_id AND i.leads_id=l.leads_id AND i.review_status='open'
    );

  UPDATE public.queue_review_items i
  SET review_status='released',updated_at=now()
  WHERE i.queue_review_batches_id=p_batch_id AND i.organizations_id=v_org AND i.review_status='open'
    AND i.leads_id=ANY(coalesce(p_release_ids,'{}'::bigint[]));
  GET DIAGNOSTICS v_released=ROW_COUNT;

  UPDATE public.queue_review_items i
  SET review_status='released',updated_at=now()
  FROM public.leads l
  WHERE i.queue_review_batches_id=p_batch_id AND i.organizations_id=v_org AND i.review_status='open'
    AND l.leads_id=i.leads_id AND l.organizations_id=v_org AND l.users_id=v_user
    AND (l.lead_status_id<>3 OR l.channels_id IS DISTINCT FROM v_batch.channels_id);
  GET DIAGNOSTICS v_pruned=ROW_COUNT;

  UPDATE public.leads l
  SET channels_id=NULL,leads_updated_at=now()
  WHERE l.organizations_id=v_org AND l.users_id=v_user AND l.lead_status_id=1 AND l.channels_id IS NOT NULL
    AND EXISTS(
      SELECT 1 FROM public.queue_review_items i
      WHERE i.queue_review_batches_id=p_batch_id AND i.leads_id=l.leads_id AND i.review_status='released'
    );

  SELECT * INTO v_capacity
  FROM public.queue_review_resource_capacity(v_batch.channel_key,v_batch.resource_id,v_batch.scheduled_date);
  UPDATE public.queue_review_batches SET target_count=v_capacity.available,updated_at=now()
  WHERE queue_review_batches_id=p_batch_id;
  SELECT count(*)::integer INTO v_open
  FROM public.queue_review_items i WHERE i.queue_review_batches_id=p_batch_id AND i.review_status='open';

  RETURN jsonb_build_object(
    'batchId',p_batch_id,
    'restored',v_restored,
    'released',v_released,
    'pruned',v_pruned,
    'targetCount',greatest(0,coalesce(v_capacity.available,0)),
    'openCount',greatest(0,coalesce(v_open,0)),
    'missingCount',greatest(0,coalesce(v_capacity.available,0)-coalesce(v_open,0))
  );
END
$$;

REVOKE ALL ON FUNCTION public.reconcile_queue_review_whatsapp_validation(bigint,bigint[],bigint[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.reconcile_queue_review_whatsapp_validation(bigint,bigint[],bigint[]) TO authenticated;

-- ---------------------------------------------------------------------------
-- Leitura direta da revisao por recurso + data. Evita listar todo o canal,
-- resolver recursos por snapshot e depois filtrar em JavaScript.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.list_queue_review_for_resource(
  p_channel text,
  p_resource_key text,
  p_scheduled_date date
)
RETURNS TABLE(
  batch_id bigint,
  review_item_id bigint,
  channel_key text,
  resource_id bigint,
  resource_label text,
  scheduled_date date,
  target_count integer,
  lead_id bigint,
  "position" integer,
  company text,
  branch_id bigint,
  branch_name text,
  city text,
  state text,
  phone text,
  whatsapp text,
  instagram text,
  website text,
  maps_url text,
  rating numeric,
  reviews integer
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path TO pg_catalog,public
AS $$
DECLARE
  v_org bigint:=public.current_organization_id();
  v_user bigint:=public.ensure_current_user();
  v_channel text:=lower(trim(coalesce(p_channel,'')));
  v_key text:=lower(trim(coalesce(p_resource_key,'')));
  v_resource_id bigint;
  v_resource_label text;
BEGIN
  PERFORM public.require_organization_permission('queues.view');
  IF v_channel NOT IN ('whatsapp','instagram') OR v_key='' THEN RETURN; END IF;

  IF v_channel='whatsapp' THEN
    SELECT c.chips_id,coalesce(nullif(btrim(c.chips_name),''),i.instances_name,c.chips_id::text)
    INTO v_resource_id,v_resource_label
    FROM public.chips c
    JOIN public.instances i ON i.instances_id=c.instances_id AND i.users_id=c.users_id
    WHERE c.users_id=v_user
      AND (c.chips_id::text=v_key OR lower(btrim(coalesce(c.chips_name,'')))=v_key OR lower(btrim(coalesce(i.instances_name,'')))=v_key)
    ORDER BY c.chips_id LIMIT 1;
  ELSE
    SELECT so.socials_id,coalesce(nullif(btrim(so.socials_name),''),concat('@',regexp_replace(coalesce(so.socials_username,''),'^@','','g')),so.socials_id::text)
    INTO v_resource_id,v_resource_label
    FROM public.socials so
    WHERE so.users_id=v_user
      AND (so.socials_id::text=v_key OR lower(btrim(coalesce(so.socials_name,'')))=v_key
        OR lower(regexp_replace(btrim(coalesce(so.socials_username,'')),'^@','','g'))=regexp_replace(v_key,'^@','','g'))
    ORDER BY so.socials_id LIMIT 1;
  END IF;
  IF v_resource_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    b.queue_review_batches_id,
    i.queue_review_items_id,
    b.channel_key,
    b.resource_id,
    v_resource_label,
    b.scheduled_date,
    b.target_count,
    l.leads_id,
    row_number() OVER(PARTITION BY b.queue_review_batches_id ORDER BY i.review_position,i.queue_review_items_id)::integer,
    coalesce(nullif(btrim(l.leads_alternative_name),''),l.leads_name),
    l.branches_id,
    coalesce(br.branches_name,''),
    coalesce(ci.cities_name,''),
    coalesce(st.states_code,st.states_name,''),
    coalesce(l.leads_phone,''),
    coalesce(l.leads_whatsapp,''),
    coalesce(l.leads_instagram,''),
    coalesce(l.leads_website,''),
    coalesce(l.leads_maps,''),
    coalesce(l.leads_score,0)::numeric,
    coalesce(l.leads_reviews_count,0)::integer
  FROM public.queue_review_batches b
  JOIN public.queue_review_items i ON i.queue_review_batches_id=b.queue_review_batches_id AND i.review_status='open'
  JOIN public.leads l ON l.leads_id=i.leads_id AND l.organizations_id=b.organizations_id
  LEFT JOIN public.branches br ON br.branches_id=l.branches_id
  LEFT JOIN public.cities ci ON ci.cities_id=l.cities_id
  LEFT JOIN public.states st ON st.states_id=l.states_id
  WHERE b.organizations_id=v_org AND b.users_id=v_user AND b.review_status='open'
    AND b.channel_key=v_channel AND b.resource_id=v_resource_id AND b.scheduled_date=p_scheduled_date
  ORDER BY b.queue_review_batches_id,i.review_position,i.queue_review_items_id;
END
$$;

REVOKE ALL ON FUNCTION public.list_queue_review_for_resource(text,text,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_queue_review_for_resource(text,text,date) TO authenticated;

-- ---------------------------------------------------------------------------
-- Limpeza: estes objetos eram exclusivos do caminho antigo candidate -> reserve
-- ou das tres RPCs de reconciliacao. Historicos de migration permanecem.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.queue_review_candidate_ids(bigint,integer);
DROP FUNCTION IF EXISTS public.reserve_queue_review_items(bigint,bigint[]);
DROP FUNCTION IF EXISTS public.open_queue_review_batch(text,bigint,date);
DROP FUNCTION IF EXISTS public.release_queue_review_items(bigint,bigint[]);
DROP FUNCTION IF EXISTS public.restore_queue_review_whatsapp_valid(bigint,bigint[]);
DROP FUNCTION IF EXISTS public.prune_queue_review_items(bigint);
DROP FUNCTION IF EXISTS public.list_open_queue_review(text);
DROP FUNCTION IF EXISTS public.lock_queue_review_batch(bigint,jsonb);

COMMIT;
