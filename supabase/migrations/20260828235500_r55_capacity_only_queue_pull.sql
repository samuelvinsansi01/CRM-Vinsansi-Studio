-- CRM - Vinsansi Studio v2.4.0-R55
-- Puxada por capacidade real do recurso/data, sem quantidade manual.
--
-- Contrato definitivo:
--   * UI envia somente canal + recurso + data;
--   * o banco calcula a capacidade restante do chip/perfil naquela data;
--   * uma unica RPC resolve recurso, trava capacidade, abre lote, seleciona e reserva;
--   * a reserva e exatamente ate a capacidade restante, sem refill/oversampling;
--   * released pode voltar em uma nova acao; open/locked/invalidated continuam bloqueados;
--   * os dois RPCs intermediarios da R54 sao removidos fisicamente ao final;
--   * queue_review_resource_capacity permanece apenas como helper interno do banco.

BEGIN;

-- Capacidade do recurso: caminhos moderno e legado separados para o planner
-- usar os indices por recurso/data sem OR/COALESCE sobre a coluna agendada.
CREATE INDEX IF NOT EXISTS queue_items_whatsapp_legacy_capacity_idx
  ON public.queue_items(organizations_id,users_id,chips_id,queues_id,status_id)
  WHERE chips_id IS NOT NULL AND queue_items_scheduled_at IS NULL;

CREATE INDEX IF NOT EXISTS queue_items_instagram_legacy_capacity_idx
  ON public.queue_items(organizations_id,users_id,socials_id,queues_id,status_id)
  WHERE socials_id IS NOT NULL AND queue_items_scheduled_at IS NULL;

DROP INDEX IF EXISTS public.queue_items_legacy_schedule_capacity_idx;

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
  v_used_modern integer:=0;
  v_used_legacy integer:=0;
  v_used integer:=0;
  v_start timestamptz:=(coalesce(p_scheduled_date,current_date)::timestamp AT TIME ZONE 'UTC');
  v_end timestamptz:=((coalesce(p_scheduled_date,current_date)+1)::timestamp AT TIME ZONE 'UTC');
BEGIN
  IF v_channel NOT IN ('whatsapp','instagram') THEN
    RAISE EXCEPTION 'queue_review_invalid_channel';
  END IF;
  IF p_resource_id IS NULL OR p_resource_id<=0 THEN
    RAISE EXCEPTION 'queue_review_resource_required';
  END IF;

  v_channel_id:=public.queue_review_channel_id(v_channel);
  SELECT s.status_id INTO v_active
  FROM public.status s
  WHERE regexp_replace(lower(public.unaccent(trim(s.status_name))), '[^a-z0-9]+', '', 'g') IN ('ativo','active')
  ORDER BY s.status_id
  LIMIT 1;

  SELECT coalesce(array_agg(s.status_id ORDER BY s.status_id),'{}'::bigint[])
  INTO v_invalid_status_ids
  FROM public.status s
  WHERE regexp_replace(lower(public.unaccent(trim(s.status_name))), '[^a-z0-9]+', '', 'g') IN
    ('invalido','invalid','cancelado','cancelled','canceled');

  IF v_channel='whatsapp' THEN
    SELECT l.levels_daily_limit INTO v_limit
    FROM public.chips c
    JOIN public.instances i ON i.instances_id=c.instances_id AND i.users_id=c.users_id
    JOIN public.levels l ON l.levels_id=c.levels_id AND l.users_id=c.users_id
    WHERE c.chips_id=p_resource_id
      AND c.users_id=v_user
      AND c.status_id=v_active
      AND i.status_id=v_active
      AND l.status_id=v_active
      AND l.channels_id=v_channel_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'queue_review_resource_not_operational';
    END IF;

    SELECT count(*)::integer INTO v_used_modern
    FROM public.queue_items qi
    JOIN public.queues q ON q.queues_id=qi.queues_id AND q.users_id=qi.users_id
    WHERE qi.organizations_id=v_org
      AND qi.users_id=v_user
      AND q.organizations_id=v_org
      AND q.channels_id=v_channel_id
      AND qi.chips_id=p_resource_id
      AND NOT (qi.status_id=ANY(v_invalid_status_ids))
      AND qi.queue_items_scheduled_at IS NOT NULL
      AND qi.queue_items_scheduled_at>=v_start
      AND qi.queue_items_scheduled_at<v_end;

    SELECT count(*)::integer INTO v_used_legacy
    FROM public.queue_items qi
    JOIN public.queues q ON q.queues_id=qi.queues_id AND q.users_id=qi.users_id
    WHERE qi.organizations_id=v_org
      AND qi.users_id=v_user
      AND q.organizations_id=v_org
      AND q.channels_id=v_channel_id
      AND qi.chips_id=p_resource_id
      AND NOT (qi.status_id=ANY(v_invalid_status_ids))
      AND qi.queue_items_scheduled_at IS NULL
      AND q.queues_scheduled_at>=v_start
      AND q.queues_scheduled_at<v_end;
  ELSE
    SELECT l.levels_daily_limit INTO v_limit
    FROM public.socials so
    JOIN public.levels l ON l.levels_id=so.levels_id AND l.users_id=so.users_id
    WHERE so.socials_id=p_resource_id
      AND so.users_id=v_user
      AND so.status_id=v_active
      AND l.status_id=v_active
      AND l.channels_id=v_channel_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'queue_review_resource_not_operational';
    END IF;

    SELECT count(*)::integer INTO v_used_modern
    FROM public.queue_items qi
    JOIN public.queues q ON q.queues_id=qi.queues_id AND q.users_id=qi.users_id
    WHERE qi.organizations_id=v_org
      AND qi.users_id=v_user
      AND q.organizations_id=v_org
      AND q.channels_id=v_channel_id
      AND qi.socials_id=p_resource_id
      AND NOT (qi.status_id=ANY(v_invalid_status_ids))
      AND qi.queue_items_scheduled_at IS NOT NULL
      AND qi.queue_items_scheduled_at>=v_start
      AND qi.queue_items_scheduled_at<v_end;

    SELECT count(*)::integer INTO v_used_legacy
    FROM public.queue_items qi
    JOIN public.queues q ON q.queues_id=qi.queues_id AND q.users_id=qi.users_id
    WHERE qi.organizations_id=v_org
      AND qi.users_id=v_user
      AND q.organizations_id=v_org
      AND q.channels_id=v_channel_id
      AND qi.socials_id=p_resource_id
      AND NOT (qi.status_id=ANY(v_invalid_status_ids))
      AND qi.queue_items_scheduled_at IS NULL
      AND q.queues_scheduled_at>=v_start
      AND q.queues_scheduled_at<v_end;
  END IF;

  v_used:=greatest(0,coalesce(v_used_modern,0)+coalesce(v_used_legacy,0));
  daily_limit:=greatest(0,coalesce(v_limit,0));
  used:=v_used;
  available:=greatest(0,daily_limit-used);
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.queue_review_resource_capacity(text,bigint,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.queue_review_resource_capacity(text,bigint,date) TO service_role;

CREATE OR REPLACE FUNCTION public.pull_queue_review_to_capacity(
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
  v_batch bigint;
  v_review_open_before integer:=0;
  v_review_open_after integer:=0;
  v_pos integer:=0;
  v_wanted integer:=0;
  v_reserved jsonb:='[]'::jsonb;
  v_reserved_count integer:=0;
  v_review_item_id bigint;
  v_lead record;
  v_available_after integer:=0;
BEGIN
  PERFORM public.require_organization_permission('queues.prepare');

  IF v_channel NOT IN ('whatsapp','instagram') THEN
    RAISE EXCEPTION 'queue_review_invalid_channel';
  END IF;
  IF v_key='' THEN
    RAISE EXCEPTION 'queue_review_resource_required';
  END IF;

  SELECT coalesce(nullif(ots.settings->>'operationalTimezone',''),'America/Sao_Paulo')
  INTO v_tz
  FROM public.organization_tool_settings ots
  WHERE ots.organizations_id=v_org AND ots.tool_id='vinsansi_whatsapp_manager';
  v_tz:=coalesce(nullif(v_tz,''),'America/Sao_Paulo');
  v_local_today:=(now() AT TIME ZONE v_tz)::date;
  IF v_date<v_local_today OR v_date>v_local_today+366 THEN
    RAISE EXCEPTION 'queue_review_scheduled_date_invalid';
  END IF;

  v_channel_id:=public.queue_review_channel_id(v_channel);
  SELECT s.status_id INTO v_active
  FROM public.status s
  WHERE regexp_replace(lower(public.unaccent(trim(s.status_name))), '[^a-z0-9]+', '', 'g') IN ('ativo','active')
  ORDER BY s.status_id
  LIMIT 1;

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
    WHERE c.users_id=v_user
      AND c.status_id=v_active
      AND i.status_id=v_active
      AND l.status_id=v_active
      AND l.channels_id=v_channel_id
      AND rs.operational_state='online'
      AND rs.session_saved IS TRUE
      AND rs.socket_connected IS TRUE
      AND (
        c.chips_id::text=v_key
        OR lower(btrim(coalesce(c.chips_name,'')))=v_key
        OR lower(btrim(coalesce(i.instances_name,'')))=v_key
      )
    ORDER BY c.chips_id
    LIMIT 1;
  ELSE
    SELECT
      so.socials_id,
      coalesce(
        nullif(btrim(so.socials_name),''),
        concat('@',regexp_replace(coalesce(so.socials_username,''),'^@','','g')),
        so.socials_id::text
      ),
      regexp_replace(coalesce(so.socials_username,''),'^@','','g')
    INTO v_resource_id,v_resource_label,v_provider_key
    FROM public.socials so
    JOIN public.levels l ON l.levels_id=so.levels_id AND l.users_id=so.users_id
    WHERE so.users_id=v_user
      AND so.status_id=v_active
      AND l.status_id=v_active
      AND l.channels_id=v_channel_id
      AND length(btrim(coalesce(so.socials_username,'')))>0
      AND (
        so.socials_id::text=v_key
        OR lower(btrim(coalesce(so.socials_name,'')))=v_key
        OR lower(regexp_replace(btrim(coalesce(so.socials_username,'')),'^@','','g'))=regexp_replace(v_key,'^@','','g')
      )
    ORDER BY so.socials_id
    LIMIT 1;
  END IF;

  IF v_resource_id IS NULL THEN
    RAISE EXCEPTION 'queue_review_resource_not_operational';
  END IF;

  -- Uma unica trava cobre capacidade + lote + selecao + reserva do recurso/data.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(format('queue-review:%s:%s:%s:%s',v_org,v_channel,v_resource_id,v_date),0)
  );

  SELECT * INTO v_capacity
  FROM public.queue_review_resource_capacity(v_channel,v_resource_id,v_date);

  SELECT b.queue_review_batches_id
  INTO v_batch
  FROM public.queue_review_batches b
  WHERE b.organizations_id=v_org
    AND b.users_id=v_user
    AND b.channel_key=v_channel
    AND b.resource_id=v_resource_id
    AND b.scheduled_date=v_date
    AND b.review_status='open'
  FOR UPDATE;

  IF v_batch IS NULL THEN
    INSERT INTO public.queue_review_batches(
      organizations_id,users_id,channels_id,channel_key,resource_id,scheduled_date,target_count
    )
    VALUES(
      v_org,v_user,v_channel_id,v_channel,v_resource_id,v_date,greatest(0,coalesce(v_capacity.available,0))
    )
    RETURNING queue_review_batches_id INTO v_batch;
  ELSE
    UPDATE public.queue_review_batches
    SET target_count=greatest(0,coalesce(v_capacity.available,0)),updated_at=now()
    WHERE queue_review_batches_id=v_batch;
  END IF;

  SELECT count(*)::integer
  INTO v_review_open_before
  FROM public.queue_review_items i
  WHERE i.queue_review_batches_id=v_batch AND i.review_status='open';

  SELECT coalesce(max(i.review_position),0)
  INTO v_pos
  FROM public.queue_review_items i
  WHERE i.queue_review_batches_id=v_batch;

  -- Capacidade e teto. Nao existe quantidade enviada pelo cliente.
  v_wanted:=greatest(0,coalesce(v_capacity.available,0)-coalesce(v_review_open_before,0));

  IF v_wanted>0 AND v_channel='whatsapp' THEN
    FOR v_lead IN
      SELECT
        l.leads_id,
        l.leads_name,
        public.effective_whatsapp_phone(l.leads_whatsapp,l.leads_phone) AS effective_phone,
        regexp_replace(
          public.effective_whatsapp_phone(l.leads_whatsapp,l.leads_phone),
          '[^0-9]+','','g'
        ) AS normalized_phone,
        coalesce(l.leads_instagram,'') AS instagram
      FROM public.leads l
      WHERE l.organizations_id=v_org
        AND l.users_id=v_user
        AND l.lead_status_id=1
        AND length(regexp_replace(public.effective_whatsapp_phone(l.leads_whatsapp,l.leads_phone),'[^0-9]+','','g'))>=10
        AND NOT EXISTS(
          SELECT 1
          FROM public.queue_review_items ri
          WHERE ri.organizations_id=v_org
            AND ri.leads_id=l.leads_id
            AND ri.review_status='open'
        )
        AND NOT EXISTS(
          SELECT 1
          FROM public.queue_review_items ri
          WHERE ri.queue_review_batches_id=v_batch
            AND ri.leads_id=l.leads_id
            AND ri.review_status IN ('invalidated','locked')
        )
        AND NOT EXISTS(
          SELECT 1
          FROM public.permanent_records pr
          WHERE pr.organizations_id=v_org
            AND pr.canonical_lead_id=coalesce(l.canonical_lead_id,l.leads_id)
        )
      ORDER BY
        coalesce(l.leads_score,0) DESC,
        coalesce(l.leads_reviews_count,0) DESC,
        l.leads_id ASC
      LIMIT v_wanted
      FOR UPDATE OF l SKIP LOCKED
    LOOP
      v_pos:=v_pos+1;
      INSERT INTO public.queue_review_items(
        organizations_id,queue_review_batches_id,leads_id,review_position
      )
      VALUES(v_org,v_batch,v_lead.leads_id,v_pos)
      RETURNING queue_review_items_id INTO v_review_item_id;

      UPDATE public.leads
      SET lead_status_id=3,channels_id=v_channel_id,leads_updated_at=now()
      WHERE leads_id=v_lead.leads_id
        AND organizations_id=v_org
        AND users_id=v_user
        AND lead_status_id=1;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'queue_review_lead_changed';
      END IF;

      v_reserved:=v_reserved || jsonb_build_array(jsonb_build_object(
        'leadId',v_lead.leads_id,
        'reviewItemId',v_review_item_id,
        'company',v_lead.leads_name,
        'phone',coalesce(v_lead.effective_phone,''),
        'normalizedPhone',coalesce(v_lead.normalized_phone,''),
        'instagram',coalesce(v_lead.instagram,'')
      ));
    END LOOP;
  ELSIF v_wanted>0 AND v_channel='instagram' THEN
    FOR v_lead IN
      SELECT
        l.leads_id,
        l.leads_name,
        coalesce(l.leads_instagram,'') AS instagram
      FROM public.leads l
      WHERE l.organizations_id=v_org
        AND l.users_id=v_user
        AND l.lead_status_id=1
        AND length(btrim(coalesce(l.leads_instagram,'')))>0
        AND NOT EXISTS(
          SELECT 1
          FROM public.queue_review_items ri
          WHERE ri.organizations_id=v_org
            AND ri.leads_id=l.leads_id
            AND ri.review_status='open'
        )
        AND NOT EXISTS(
          SELECT 1
          FROM public.queue_review_items ri
          WHERE ri.queue_review_batches_id=v_batch
            AND ri.leads_id=l.leads_id
            AND ri.review_status IN ('invalidated','locked')
        )
        AND NOT EXISTS(
          SELECT 1
          FROM public.permanent_records pr
          WHERE pr.organizations_id=v_org
            AND pr.canonical_lead_id=coalesce(l.canonical_lead_id,l.leads_id)
        )
      ORDER BY
        coalesce(l.leads_score,0) DESC,
        coalesce(l.leads_reviews_count,0) DESC,
        l.leads_id ASC
      LIMIT v_wanted
      FOR UPDATE OF l SKIP LOCKED
    LOOP
      v_pos:=v_pos+1;
      INSERT INTO public.queue_review_items(
        organizations_id,queue_review_batches_id,leads_id,review_position
      )
      VALUES(v_org,v_batch,v_lead.leads_id,v_pos)
      RETURNING queue_review_items_id INTO v_review_item_id;

      UPDATE public.leads
      SET lead_status_id=3,channels_id=v_channel_id,leads_updated_at=now()
      WHERE leads_id=v_lead.leads_id
        AND organizations_id=v_org
        AND users_id=v_user
        AND lead_status_id=1;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'queue_review_lead_changed';
      END IF;

      v_reserved:=v_reserved || jsonb_build_array(jsonb_build_object(
        'leadId',v_lead.leads_id,
        'reviewItemId',v_review_item_id,
        'company',v_lead.leads_name,
        'phone','',
        'normalizedPhone','',
        'instagram',coalesce(v_lead.instagram,'')
      ));
    END LOOP;
  END IF;

  v_reserved_count:=jsonb_array_length(v_reserved);
  v_review_open_after:=v_review_open_before+v_reserved_count;
  v_available_after:=greatest(0,coalesce(v_capacity.available,0)-v_review_open_after);

  UPDATE public.queue_review_batches
  SET target_count=greatest(0,coalesce(v_capacity.available,0)),updated_at=now()
  WHERE queue_review_batches_id=v_batch;

  -- Retorno minimo consumido pelo frontend. Nao expomos contadores redundantes
  -- nem contratos antigos de target/quantidade manual.
  RETURN jsonb_build_object(
    'batchId',v_batch,
    'resourceId',v_resource_id,
    'resourceLabel',v_resource_label,
    'providerKey',v_provider_key,
    'scheduledDate',v_date,
    'dailyLimit',greatest(0,coalesce(v_capacity.daily_limit,0)),
    'available',v_available_after,
    'capacityToFill',v_wanted,
    'reserved',v_reserved
  );
END;
$$;

REVOKE ALL ON FUNCTION public.pull_queue_review_to_capacity(text,text,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.pull_queue_review_to_capacity(text,text,date) TO authenticated;

-- Limpeza real do caminho substituido. Historicos de migration permanecem no
-- repositorio, mas os objetos obsoletos nao ficam ativos no banco. Os drops
-- abaixo sao defensivos para tambem remover residuos de instalacoes anteriores.
DROP FUNCTION IF EXISTS public.open_queue_review_batch_by_key(text,text,date);
DROP FUNCTION IF EXISTS public.reserve_next_queue_review_items(bigint,integer);
DROP FUNCTION IF EXISTS public.reserve_next_queue_review_items(bigint);
DROP FUNCTION IF EXISTS public.queue_review_candidate_ids(bigint,integer);
DROP FUNCTION IF EXISTS public.reserve_queue_review_items(bigint,bigint[]);
DROP FUNCTION IF EXISTS public.open_queue_review_batch(text,bigint,date);
DROP FUNCTION IF EXISTS public.release_queue_review_items(bigint,bigint[]);
DROP FUNCTION IF EXISTS public.restore_queue_review_whatsapp_valid(bigint,bigint[]);
DROP FUNCTION IF EXISTS public.prune_queue_review_items(bigint);
DROP FUNCTION IF EXISTS public.list_open_queue_review(text);
DROP FUNCTION IF EXISTS public.lock_queue_review_batch(bigint,jsonb);

COMMIT;
