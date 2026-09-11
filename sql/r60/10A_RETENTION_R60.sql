BEGIN;

CREATE OR REPLACE FUNCTION public.service_retention_r60(p_receipt_days integer DEFAULT 7,p_heartbeat_hours integer DEFAULT 72,p_recovery_days integer DEFAULT 14)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE receipts integer:=0;heartbeats integer:=0;recovery integer:=0;
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
 p_receipt_days:=least(greatest(coalesce(p_receipt_days,7),1),30);
 p_heartbeat_hours:=least(greatest(coalesce(p_heartbeat_hours,72),24),720);
 p_recovery_days:=least(greatest(coalesce(p_recovery_days,14),1),90);
 DELETE FROM public.evolution_webhook_receipts WHERE received_at<now()-make_interval(days=>p_receipt_days); GET DIAGNOSTICS receipts=ROW_COUNT;
 DELETE FROM public.platform_runtime_heartbeats WHERE last_seen_at<now()-make_interval(hours=>p_heartbeat_hours); GET DIAGNOSTICS heartbeats=ROW_COUNT;
 DELETE FROM public.recovery_requests WHERE finished_at IS NOT NULL AND finished_at<now()-make_interval(days=>p_recovery_days); GET DIAGNOSTICS recovery=ROW_COUNT;
 RETURN jsonb_build_object('receipts',receipts,'heartbeats',heartbeats,'recovery',recovery);
END $$;

REVOKE ALL ON FUNCTION public.service_retention_r60(integer,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.service_retention_r60(integer,integer,integer) TO service_role;

COMMIT;
