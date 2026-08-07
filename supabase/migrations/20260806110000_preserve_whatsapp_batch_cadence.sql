BEGIN;

ALTER TABLE public.worker_batches
  ADD COLUMN IF NOT EXISTS worker_batches_paused_at timestamptz NULL;

CREATE OR REPLACE FUNCTION public.worker_set_whatsapp_batch_state(
  p_users_id bigint,
  p_chip_instance text,
  p_action text,
  p_worker_id text DEFAULT NULL
)
RETURNS TABLE (
  batch_id bigint,
  batch_status text,
  enabled boolean,
  chip text,
  total integer,
  remaining integer,
  processed integer,
  sent integer,
  failed integer,
  next_run_at timestamp with time zone,
  started_at timestamp with time zone,
  last_error text,
  already_running boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_channel_id bigint;
  v_chip_id bigint;
  v_batch public.worker_batches%ROWTYPE;
  v_action text := lower(trim(coalesce(p_action, '')));
BEGIN
  SELECT c.channels_id INTO v_channel_id FROM public.channels AS c WHERE lower(trim(c.channels_name)) = 'whatsapp' LIMIT 1;
  SELECT ch.chips_id INTO v_chip_id
  FROM public.chips AS ch
  JOIN public.instances AS i ON i.instances_id = ch.instances_id AND i.users_id = ch.users_id
  WHERE ch.users_id = p_users_id AND i.instances_name = trim(p_chip_instance)
  LIMIT 1;

  IF v_channel_id IS NULL OR v_chip_id IS NULL THEN RAISE EXCEPTION 'batch_chip_not_found'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(format('worker-batch:%s:%s:%s', p_users_id, v_channel_id, v_chip_id), 0));

  SELECT * INTO v_batch
  FROM public.worker_batches
  WHERE users_id = p_users_id AND channels_id = v_channel_id AND chips_id = v_chip_id
  ORDER BY worker_batches_id DESC
  LIMIT 1
  FOR UPDATE;

  IF v_batch.worker_batches_id IS NULL THEN RAISE EXCEPTION 'batch_not_found'; END IF;

  IF v_action = 'pause' AND v_batch.status_id IN (3, 4) THEN
    UPDATE public.worker_batches
    SET status_id = 8,
        worker_batches_paused_at = now(),
        worker_batches_updated_at = now()
    WHERE worker_batches_id = v_batch.worker_batches_id;
  ELSIF v_action = 'pause' AND v_batch.status_id = 8 THEN
    NULL;
  ELSIF v_action = 'resume' AND v_batch.status_id = 8 THEN
    UPDATE public.worker_batches
    SET status_id = 4,
        worker_batches_next_run_at = CASE
          WHEN worker_batches_paused_at IS NOT NULL AND worker_batches_next_run_at IS NOT NULL
            THEN now() + greatest(worker_batches_next_run_at - worker_batches_paused_at, interval '0 seconds')
          ELSE now()
        END,
        worker_batches_paused_at = NULL,
        worker_batches_heartbeat_at = now(),
        worker_batches_worker_id = coalesce(nullif(trim(coalesce(p_worker_id, '')), ''), worker_batches_worker_id),
        worker_batches_updated_at = now()
    WHERE worker_batches_id = v_batch.worker_batches_id;
  ELSIF v_action = 'stop' AND v_batch.status_id IN (3, 4, 8) THEN
    UPDATE public.worker_batches
    SET status_id = 7,
        worker_batches_next_run_at = NULL,
        worker_batches_paused_at = NULL,
        worker_batches_finished_at = now(),
        worker_batches_updated_at = now()
    WHERE worker_batches_id = v_batch.worker_batches_id;
    UPDATE public.worker_batch_items
    SET status_id = 7,
        worker_batch_items_finished_at = now(),
        worker_batch_items_updated_at = now()
    WHERE worker_batches_id = v_batch.worker_batches_id AND status_id = 3;
  ELSIF v_action NOT IN ('state', 'status') THEN
    RAISE EXCEPTION 'batch_action_invalid';
  END IF;

  PERFORM public.refresh_worker_batch_counters(v_batch.worker_batches_id);

  RETURN QUERY
  SELECT
    wb.worker_batches_id,
    CASE wb.status_id WHEN 3 THEN 'pending' WHEN 4 THEN 'running' WHEN 5 THEN 'completed' WHEN 6 THEN 'error' WHEN 7 THEN 'stopped' WHEN 8 THEN 'paused' ELSE 'idle' END,
    wb.status_id IN (3, 4, 8),
    trim(p_chip_instance),
    wb.worker_batches_total_items,
    greatest(wb.worker_batches_total_items - wb.worker_batches_processed_items, 0),
    wb.worker_batches_processed_items,
    wb.worker_batches_sent_items,
    wb.worker_batches_failed_items,
    wb.worker_batches_next_run_at,
    wb.worker_batches_started_at,
    coalesce(wb.worker_batches_last_error, ''),
    false
  FROM public.worker_batches AS wb
  WHERE wb.worker_batches_id = v_batch.worker_batches_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.worker_complete_batch_item(
  p_worker_batch_items_id bigint,
  p_result text,
  p_error_message text,
  p_next_run_at timestamp with time zone
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_item public.worker_batch_items%ROWTYPE;
  v_result text := lower(trim(coalesce(p_result, '')));
  v_status_id bigint;
BEGIN
  SELECT * INTO v_item FROM public.worker_batch_items WHERE worker_batch_items_id = p_worker_batch_items_id FOR UPDATE;
  IF v_item.worker_batch_items_id IS NULL THEN RAISE EXCEPTION 'batch_item_not_found'; END IF;

  v_status_id := CASE v_result WHEN 'sent' THEN 5 WHEN 'paused' THEN 8 WHEN 'stopped' THEN 7 ELSE 6 END;

  UPDATE public.worker_batch_items
  SET status_id = v_status_id,
      worker_batch_items_finished_at = now(),
      worker_batch_items_error_message = nullif(trim(coalesce(p_error_message, '')), ''),
      worker_batch_items_updated_at = now()
  WHERE worker_batch_items_id = p_worker_batch_items_id;

  PERFORM public.refresh_worker_batch_counters(v_item.worker_batches_id);

  UPDATE public.worker_batches
  SET worker_batches_next_run_at = CASE WHEN status_id IN (4, 8) THEN p_next_run_at ELSE worker_batches_next_run_at END,
      worker_batches_paused_at = CASE WHEN status_id = 8 THEN now() ELSE worker_batches_paused_at END,
      worker_batches_heartbeat_at = now(),
      worker_batches_last_error = CASE WHEN v_status_id = 6 THEN nullif(trim(coalesce(p_error_message, '')), '') ELSE worker_batches_last_error END,
      worker_batches_updated_at = now()
  WHERE worker_batches_id = v_item.worker_batches_id;

  UPDATE public.worker_batches AS wb
  SET status_id = 5,
      worker_batches_finished_at = now(),
      worker_batches_next_run_at = NULL,
      worker_batches_paused_at = NULL,
      worker_batches_updated_at = now()
  WHERE wb.worker_batches_id = v_item.worker_batches_id
    AND wb.status_id IN (4, 8)
    AND NOT EXISTS (
      SELECT 1 FROM public.worker_batch_items AS wbi
      WHERE wbi.worker_batches_id = wb.worker_batches_id AND wbi.status_id IN (3, 4)
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.worker_recover_stale_whatsapp(
  p_stale_before timestamp with time zone DEFAULT (now() - interval '15 minutes')
)
RETURNS TABLE (
  recovered_items integer,
  reconciliation_items integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_recovered integer := 0;
  v_reconciliation integer := 0;
  v_row record;
BEGIN
  FOR v_row IN
    SELECT wbi.worker_batch_items_id, wbi.worker_batches_id, wbi.queue_items_id, qi.users_id, qi.status_id
    FROM public.worker_batch_items AS wbi
    JOIN public.queue_items AS qi ON qi.queue_items_id = wbi.queue_items_id
    WHERE wbi.status_id = 4
      AND coalesce(wbi.worker_batch_items_started_at, wbi.worker_batch_items_updated_at) < p_stale_before
    FOR UPDATE OF wbi, qi SKIP LOCKED
  LOOP
    IF v_row.status_id = 5 THEN
      UPDATE public.worker_batch_items SET status_id = 5, worker_batch_items_finished_at = now(), worker_batch_items_updated_at = now()
      WHERE worker_batch_items_id = v_row.worker_batch_items_id;
      v_recovered := v_recovered + 1;
    ELSIF EXISTS (
      SELECT 1 FROM public.queue_item_dispatch_parts AS p
      WHERE p.queue_items_id = v_row.queue_items_id AND p.queue_item_dispatch_parts_state = 'processing'
    ) THEN
      UPDATE public.queue_item_dispatch_parts
      SET queue_item_dispatch_parts_state = 'reconciliation_required',
          queue_item_dispatch_parts_claim_token = NULL,
          queue_item_dispatch_parts_error_message = 'worker_restart_after_provider_claim',
          queue_item_dispatch_parts_updated_at = now()
      WHERE queue_items_id = v_row.queue_items_id AND queue_item_dispatch_parts_state = 'processing';

      UPDATE public.queue_items SET status_id = 6,
        queue_items_error_message = 'reconciliation_required_after_worker_restart',
        queue_items_finished_at = now(), queue_items_updated_at = now()
      WHERE queue_items_id = v_row.queue_items_id AND status_id <> 5;

      UPDATE public.worker_batch_items SET status_id = 6,
        worker_batch_items_error_message = 'reconciliation_required_after_worker_restart',
        worker_batch_items_finished_at = now(), worker_batch_items_updated_at = now()
      WHERE worker_batch_items_id = v_row.worker_batch_items_id;
      v_reconciliation := v_reconciliation + 1;
    ELSE
      UPDATE public.queue_items SET status_id = 3,
        queue_items_error_message = NULL, queue_items_finished_at = NULL, queue_items_updated_at = now()
      WHERE queue_items_id = v_row.queue_items_id AND status_id = 4;

      UPDATE public.worker_batch_items SET status_id = 3,
        worker_batch_items_started_at = NULL, worker_batch_items_finished_at = NULL,
        worker_batch_items_error_message = NULL, worker_batch_items_updated_at = now()
      WHERE worker_batch_items_id = v_row.worker_batch_items_id;
      v_recovered := v_recovered + 1;
    END IF;
    PERFORM public.refresh_worker_batch_counters(v_row.worker_batches_id);
  END LOOP;

  -- Mantem a recuperacao conservadora dos itens legados fora de lote.
  FOR v_row IN
    SELECT qi.queue_items_id, qi.users_id
    FROM public.queue_items AS qi
    WHERE qi.status_id = 4
      AND coalesce(qi.queue_items_started_at, qi.queue_items_updated_at) < p_stale_before
      AND NOT EXISTS (
        SELECT 1 FROM public.worker_batch_items AS wbi
        WHERE wbi.queue_items_id = qi.queue_items_id AND wbi.status_id = 4
      )
    FOR UPDATE OF qi SKIP LOCKED
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.queue_item_dispatch_parts AS p
      WHERE p.queue_items_id = v_row.queue_items_id AND p.queue_item_dispatch_parts_state = 'processing'
    ) THEN
      UPDATE public.queue_item_dispatch_parts
      SET queue_item_dispatch_parts_state = 'reconciliation_required',
          queue_item_dispatch_parts_claim_token = NULL,
          queue_item_dispatch_parts_error_message = 'worker_restart_after_provider_claim',
          queue_item_dispatch_parts_updated_at = now()
      WHERE queue_items_id = v_row.queue_items_id AND queue_item_dispatch_parts_state = 'processing';

      UPDATE public.queue_items SET status_id = 6,
        queue_items_error_message = 'reconciliation_required_after_worker_restart',
        queue_items_finished_at = now(), queue_items_updated_at = now()
      WHERE queue_items_id = v_row.queue_items_id;
      v_reconciliation := v_reconciliation + 1;
    ELSE
      UPDATE public.queue_items SET status_id = 3,
        queue_items_error_message = NULL, queue_items_finished_at = NULL, queue_items_updated_at = now()
      WHERE queue_items_id = v_row.queue_items_id;
      v_recovered := v_recovered + 1;
    END IF;
  END LOOP;

  UPDATE public.worker_batches AS wb
  SET status_id = 5,
      worker_batches_finished_at = now(),
      worker_batches_next_run_at = NULL,
      worker_batches_paused_at = NULL,
      worker_batches_updated_at = now()
  WHERE wb.status_id IN (4, 8)
    AND NOT EXISTS (
      SELECT 1 FROM public.worker_batch_items AS wbi
      WHERE wbi.worker_batches_id = wb.worker_batches_id AND wbi.status_id IN (3, 4)
    );

  UPDATE public.worker_batches
  SET worker_batches_next_run_at = greatest(coalesce(worker_batches_next_run_at, now()), now()),
      worker_batches_heartbeat_at = now(),
      worker_batches_updated_at = now()
  WHERE status_id = 4
    AND coalesce(worker_batches_heartbeat_at, worker_batches_updated_at) < p_stale_before;

  RETURN QUERY SELECT v_recovered, v_reconciliation;
END;
$function$;

REVOKE ALL ON FUNCTION public.worker_set_whatsapp_batch_state(bigint, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.worker_complete_batch_item(bigint, text, text, timestamp with time zone) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.worker_recover_stale_whatsapp(timestamp with time zone) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.worker_set_whatsapp_batch_state(bigint, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.worker_complete_batch_item(bigint, text, text, timestamp with time zone) TO service_role;
GRANT EXECUTE ON FUNCTION public.worker_recover_stale_whatsapp(timestamp with time zone) TO service_role;

COMMIT;
