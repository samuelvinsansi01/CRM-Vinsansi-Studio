BEGIN;

-- R20 — corrige o contrato da Etapa 11 para a estrutura real de worker_batches.
-- A tabela usa status_id (3=queued, 4=processing/running, 8=paused),
-- e não possui a coluna legada legacy textual batch status column.

DO $preflight$
BEGIN
  IF to_regclass('public.worker_batches') IS NULL THEN
    RAISE EXCEPTION 'r20_preflight_failed:table:worker_batches';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema='public' AND table_name='worker_batches' AND column_name='status_id'
  ) THEN
    RAISE EXCEPTION 'r20_preflight_failed:column:worker_batches.status_id';
  END IF;
END
$preflight$;

CREATE OR REPLACE FUNCTION public.worker_recover_stale_whatsapp_v2(
  p_organizations_id bigint,
  p_stale_before timestamptz DEFAULT now()-interval '15 minutes'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog,public AS $$
DECLARE
  r record;
  v_recovered integer:=0;
  v_reconciliation integer:=0;
BEGIN
  IF auth.role()<>'service_role' THEN
    RAISE EXCEPTION 'service_role_required';
  END IF;

  FOR r IN
    SELECT qi.queue_items_id
      FROM public.queue_items qi
     WHERE qi.organizations_id=p_organizations_id
       AND qi.status_id=4
       AND coalesce(qi.queue_items_started_at,qi.queue_items_updated_at)<p_stale_before
     FOR UPDATE OF qi SKIP LOCKED
  LOOP
    IF EXISTS(
      SELECT 1
        FROM public.queue_item_dispatch_parts p
       WHERE p.organizations_id=p_organizations_id
         AND p.queue_items_id=r.queue_items_id
         AND p.queue_item_dispatch_parts_state='processing'
    ) THEN
      UPDATE public.queue_item_dispatch_parts
         SET queue_item_dispatch_parts_state='reconciliation_required',
             queue_item_dispatch_parts_claim_token=NULL,
             queue_item_dispatch_parts_error_message='worker_restart_after_provider_claim',
             queue_item_dispatch_parts_updated_at=now()
       WHERE organizations_id=p_organizations_id
         AND queue_items_id=r.queue_items_id
         AND queue_item_dispatch_parts_state='processing';

      UPDATE public.queue_items
         SET status_id=6,
             queue_items_error_message='reconciliation_required_after_worker_restart',
             queue_items_finished_at=now(),
             queue_items_updated_at=now()
       WHERE organizations_id=p_organizations_id
         AND queue_items_id=r.queue_items_id;

      UPDATE public.worker_batch_items
         SET status_id=6,
             worker_batch_items_error_message='reconciliation_required_after_worker_restart',
             worker_batch_items_finished_at=now(),
             worker_batch_items_updated_at=now()
       WHERE organizations_id=p_organizations_id
         AND queue_items_id=r.queue_items_id
         AND status_id=4;

      v_reconciliation:=v_reconciliation+1;
    ELSE
      UPDATE public.queue_items
         SET status_id=3,
             queue_items_error_message=NULL,
             queue_items_started_at=NULL,
             queue_items_finished_at=NULL,
             queue_items_updated_at=now()
       WHERE organizations_id=p_organizations_id
         AND queue_items_id=r.queue_items_id;

      UPDATE public.worker_batch_items
         SET status_id=3,
             worker_batch_items_started_at=NULL,
             worker_batch_items_finished_at=NULL,
             worker_batch_items_error_message=NULL,
             worker_batch_items_updated_at=now()
       WHERE organizations_id=p_organizations_id
         AND queue_items_id=r.queue_items_id
         AND status_id=4;

      v_recovered:=v_recovered+1;
    END IF;
  END LOOP;

  UPDATE public.worker_batches
     SET worker_batches_next_run_at=now(),
         worker_batches_heartbeat_at=now(),
         worker_batches_updated_at=now()
   WHERE organizations_id=p_organizations_id
     AND status_id=4
     AND worker_batches_heartbeat_at<p_stale_before;

  RETURN jsonb_build_object(
    'recovered_items',v_recovered,
    'reconciliation_items',v_reconciliation
  );
END;
$$;

REVOKE ALL ON FUNCTION public.worker_recover_stale_whatsapp_v2(bigint,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.worker_recover_stale_whatsapp_v2(bigint,timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.get_operational_health()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path TO pg_catalog,public AS $$
DECLARE
  v_org bigint:=public.current_organization_id();
  v_result jsonb;
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
      'active',(SELECT count(*) FROM public.worker_batches WHERE organizations_id=v_org AND status_id IN(3,4,8)),
      'stale',(SELECT count(*) FROM public.worker_batches WHERE organizations_id=v_org AND status_id=4 AND worker_batches_heartbeat_at<now()-interval '15 minutes')
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
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_operational_health() TO authenticated;

COMMIT;
