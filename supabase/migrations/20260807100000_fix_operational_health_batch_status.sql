BEGIN;

CREATE OR REPLACE FUNCTION public.get_operational_health()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_user bigint:=public.ensure_current_user(); v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'checkedAt',now(),
    'workers',jsonb_build_object(
      'online',(SELECT count(*) FROM public.worker_heartbeats WHERE last_seen_at>now()-interval '2 minutes' AND worker_status='online'),
      'stale',(SELECT count(*) FROM public.worker_heartbeats WHERE last_seen_at<=now()-interval '2 minutes')
    ),
    'queues',jsonb_build_object(
      'pending',(SELECT count(*) FROM public.queue_items WHERE users_id=v_user AND status_id=3),
      'processing',(SELECT count(*) FROM public.queue_items WHERE users_id=v_user AND status_id=4),
      'staleProcessing',(SELECT count(*) FROM public.queue_items WHERE users_id=v_user AND status_id=4 AND queue_items_updated_at<now()-interval '15 minutes'),
      'errors',(SELECT count(*) FROM public.queue_items WHERE users_id=v_user AND status_id=6)
    ),
    'reconciliation',jsonb_build_object(
      'whatsapp',(SELECT count(*) FROM public.queue_item_dispatch_parts p WHERE p.users_id=v_user AND p.queue_item_dispatch_parts_state='reconciliation_required'),
      'instagram',(SELECT count(*) FROM public.instagram_queue_progress p WHERE p.users_id=v_user AND p.step='reconciliation_required')
    ),
    'batches',jsonb_build_object(
      'active',(SELECT count(*) FROM public.worker_batches WHERE users_id=v_user AND status_id IN(3,4,8)),
      'stale',(SELECT count(*) FROM public.worker_batches WHERE users_id=v_user AND status_id=4 AND worker_batches_heartbeat_at<now()-interval '15 minutes')
    ),
    'alerts',jsonb_build_object(
      'open',(SELECT count(*) FROM public.operational_alerts WHERE users_id=v_user AND status<>'resolved'),
      'critical',(SELECT count(*) FROM public.operational_alerts WHERE users_id=v_user AND status<>'resolved' AND severity='critical')
    ),
    'latestRecovery',(SELECT to_jsonb(r) FROM public.recovery_requests r WHERE r.users_id=v_user ORDER BY r.requested_at DESC LIMIT 1)
  ) INTO v_result;
  RETURN v_result;
END; $$;

COMMIT;
