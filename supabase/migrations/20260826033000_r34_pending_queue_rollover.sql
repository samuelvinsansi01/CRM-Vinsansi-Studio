-- CRM - Vinsansi Studio v2.4.0-R34
-- Virada automática de pendências para o dia corrente.
-- Move somente trabalho ainda pendente: queue_items pendentes/pausados e itens abertos de Revisão.
-- Enviados, processando, erros/reconciliação e inválidos permanecem no dia histórico.

BEGIN;

CREATE OR REPLACE FUNCTION public.rollover_pending_queue_work(p_target_date date DEFAULT current_date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog,public
AS $$
DECLARE
  v_org bigint:=public.current_organization_id();
  v_user bigint:=public.ensure_current_user();
  v_target date:=coalesce(p_target_date,current_date);
  v_pending_ids bigint[];
  v_paused_ids bigint[];
  v_row record;
  v_cap record;
  v_date date;
  v_review_count integer;
  v_position integer;
  v_target_batch bigint;
  v_final_moved integer:=0;
  v_review_moved integer:=0;
  v_guard integer;
BEGIN
  PERFORM public.require_organization_permission('queues.view');
  IF v_target < DATE '2020-01-01' OR v_target > current_date + 366 THEN
    RAISE EXCEPTION 'queue_rollover_target_date_invalid';
  END IF;

  SELECT coalesce(array_agg(s.status_id),'{}'::bigint[]) INTO v_pending_ids
  FROM public.status s
  WHERE regexp_replace(lower(public.unaccent(trim(s.status_name))), '[^a-z0-9]+', '', 'g') IN ('pendente','pending','queued');
  SELECT coalesce(array_agg(s.status_id),'{}'::bigint[]) INTO v_paused_ids
  FROM public.status s
  WHERE regexp_replace(lower(public.unaccent(trim(s.status_name))), '[^a-z0-9]+', '', 'g') IN ('pausado','paused');

  PERFORM pg_advisory_xact_lock(hashtextextended(format('queue-rollover:%s:%s:%s',v_org,v_user,v_target),0));

  -- Primeiro preservamos quem já foi aprovado e está efetivamente aguardando envio.
  FOR v_row IN
    SELECT qi.queue_items_id,qi.queues_id,qi.chips_id,qi.socials_id,qi.queue_items_position,
           q.channels_id,
           CASE
             WHEN regexp_replace(lower(public.unaccent(trim(c.channels_name))), '[^a-z0-9]+', '', 'g')='instagram' THEN 'instagram'
             ELSE 'whatsapp'
           END AS channel_key,
           CASE
             WHEN regexp_replace(lower(public.unaccent(trim(c.channels_name))), '[^a-z0-9]+', '', 'g')='instagram' THEN qi.socials_id
             ELSE qi.chips_id
           END AS resource_id,
           (coalesce(qi.queue_items_scheduled_at,q.queues_scheduled_at) AT TIME ZONE 'UTC')::date AS scheduled_date
    FROM public.queue_items qi
    JOIN public.queues q ON q.queues_id=qi.queues_id AND q.users_id=qi.users_id
    JOIN public.channels c ON c.channels_id=q.channels_id
    WHERE qi.organizations_id=v_org AND qi.users_id=v_user
      AND qi.status_id = ANY(v_pending_ids || v_paused_ids)
      AND (coalesce(qi.queue_items_scheduled_at,q.queues_scheduled_at) AT TIME ZONE 'UTC')::date < v_target
      AND ((regexp_replace(lower(public.unaccent(trim(c.channels_name))), '[^a-z0-9]+', '', 'g')='instagram' AND qi.socials_id IS NOT NULL)
        OR (regexp_replace(lower(public.unaccent(trim(c.channels_name))), '[^a-z0-9]+', '', 'g')='whatsapp' AND qi.chips_id IS NOT NULL))
    ORDER BY scheduled_date,qi.queue_items_position,qi.queue_items_id
    FOR UPDATE OF qi
  LOOP
    v_date:=v_target;
    v_guard:=0;
    LOOP
      v_guard:=v_guard+1;
      IF v_guard>366 THEN EXIT; END IF;
      BEGIN
        SELECT * INTO v_cap FROM public.queue_review_resource_capacity(v_row.channel_key,v_row.resource_id,v_date);
      EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%queue_review_resource_not_operational%' THEN v_guard:=367; EXIT; END IF;
        RAISE;
      END;
      SELECT count(*)::integer INTO v_review_count
      FROM public.queue_review_batches b
      JOIN public.queue_review_items i ON i.queue_review_batches_id=b.queue_review_batches_id AND i.review_status='open'
      WHERE b.organizations_id=v_org AND b.users_id=v_user AND b.review_status='open'
        AND b.channel_key=v_row.channel_key AND b.resource_id=v_row.resource_id AND b.scheduled_date=v_date;
      IF coalesce(v_cap.used,0)+coalesce(v_review_count,0) < coalesce(v_cap.daily_limit,0) THEN EXIT; END IF;
      v_date:=v_date+1;
    END LOOP;
    IF v_guard>366 OR coalesce(v_cap.daily_limit,0)<=0 THEN CONTINUE; END IF;

    SELECT coalesce(max(qi2.queue_items_position),0)+1 INTO v_position
    FROM public.queue_items qi2
    JOIN public.queues q2 ON q2.queues_id=qi2.queues_id AND q2.users_id=qi2.users_id
    WHERE qi2.organizations_id=v_org AND qi2.users_id=v_user AND q2.channels_id=v_row.channels_id
      AND ((v_row.channel_key='whatsapp' AND qi2.chips_id=v_row.resource_id)
        OR (v_row.channel_key='instagram' AND qi2.socials_id=v_row.resource_id))
      AND (coalesce(qi2.queue_items_scheduled_at,q2.queues_scheduled_at) AT TIME ZONE 'UTC')::date=v_date;

    UPDATE public.queue_items
    SET queue_items_scheduled_at=(v_date::timestamp + interval '12 hours') AT TIME ZONE 'UTC',
        queue_items_position=v_position,
        queue_items_updated_at=now()
    WHERE queue_items_id=v_row.queue_items_id AND organizations_id=v_org AND users_id=v_user;
    v_final_moved:=v_final_moved+1;
  END LOOP;

  -- Depois carregamos apenas o que ainda precisa de aprovação manual (Revisão aberta).
  FOR v_row IN
    SELECT i.queue_review_items_id,b.queue_review_batches_id,b.channels_id,b.channel_key,b.resource_id,b.scheduled_date,i.review_position
    FROM public.queue_review_items i
    JOIN public.queue_review_batches b ON b.queue_review_batches_id=i.queue_review_batches_id
    WHERE i.organizations_id=v_org AND i.review_status='open'
      AND b.organizations_id=v_org AND b.users_id=v_user AND b.review_status='open'
      AND b.scheduled_date<v_target
    ORDER BY b.scheduled_date,i.review_position,i.queue_review_items_id
    FOR UPDATE OF i
  LOOP
    v_date:=v_target;
    v_guard:=0;
    LOOP
      v_guard:=v_guard+1;
      IF v_guard>366 THEN EXIT; END IF;
      BEGIN
        SELECT * INTO v_cap FROM public.queue_review_resource_capacity(v_row.channel_key,v_row.resource_id,v_date);
      EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%queue_review_resource_not_operational%' THEN v_guard:=367; EXIT; END IF;
        RAISE;
      END;
      SELECT count(*)::integer INTO v_review_count
      FROM public.queue_review_batches b
      JOIN public.queue_review_items i ON i.queue_review_batches_id=b.queue_review_batches_id AND i.review_status='open'
      WHERE b.organizations_id=v_org AND b.users_id=v_user AND b.review_status='open'
        AND b.channel_key=v_row.channel_key AND b.resource_id=v_row.resource_id AND b.scheduled_date=v_date;
      IF coalesce(v_cap.used,0)+coalesce(v_review_count,0) < coalesce(v_cap.daily_limit,0) THEN EXIT; END IF;
      v_date:=v_date+1;
    END LOOP;
    IF v_guard>366 OR coalesce(v_cap.daily_limit,0)<=0 THEN CONTINUE; END IF;

    SELECT b.queue_review_batches_id INTO v_target_batch
    FROM public.queue_review_batches b
    WHERE b.organizations_id=v_org AND b.users_id=v_user AND b.review_status='open'
      AND b.channel_key=v_row.channel_key AND b.resource_id=v_row.resource_id AND b.scheduled_date=v_date
    FOR UPDATE;
    IF v_target_batch IS NULL THEN
      INSERT INTO public.queue_review_batches(organizations_id,users_id,channels_id,channel_key,resource_id,scheduled_date,target_count)
      VALUES(v_org,v_user,v_row.channels_id,v_row.channel_key,v_row.resource_id,v_date,greatest(0,coalesce(v_cap.available,0)))
      RETURNING queue_review_batches_id INTO v_target_batch;
    END IF;

    SELECT coalesce(max(review_position),0)+1 INTO v_position
    FROM public.queue_review_items
    WHERE queue_review_batches_id=v_target_batch AND review_status='open';

    UPDATE public.queue_review_items
    SET queue_review_batches_id=v_target_batch,review_position=v_position,updated_at=now()
    WHERE queue_review_items_id=v_row.queue_review_items_id AND organizations_id=v_org AND review_status='open';
    IF FOUND THEN v_review_moved:=v_review_moved+1; END IF;

    SELECT * INTO v_cap FROM public.queue_review_resource_capacity(v_row.channel_key,v_row.resource_id,v_date);
    UPDATE public.queue_review_batches
    SET target_count=greatest(0,coalesce(v_cap.available,0)),updated_at=now()
    WHERE queue_review_batches_id=v_target_batch;
  END LOOP;

  UPDATE public.queue_review_batches b
  SET review_status='cancelled',updated_at=now()
  WHERE b.organizations_id=v_org AND b.users_id=v_user AND b.review_status='open' AND b.scheduled_date<v_target
    AND NOT EXISTS(SELECT 1 FROM public.queue_review_items i WHERE i.queue_review_batches_id=b.queue_review_batches_id AND i.review_status='open');

  RETURN jsonb_build_object('targetDate',v_target,'finalQueueMoved',v_final_moved,'reviewMoved',v_review_moved);
END
$$;

REVOKE ALL ON FUNCTION public.rollover_pending_queue_work(date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rollover_pending_queue_work(date) TO authenticated,service_role;

COMMIT;
