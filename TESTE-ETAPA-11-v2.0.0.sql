-- TESTE ETAPA 11 — execute após o PATCH correspondente.
DO $test$
DECLARE v_missing text[]:=ARRAY[]::text[]; v_name text; v_ok boolean;
BEGIN
  FOREACH v_name IN ARRAY ARRAY['platform_runtime_heartbeats','operational_alerts','recovery_requests'] LOOP IF to_regclass('public.'||v_name) IS NULL THEN v_missing:=array_append(v_missing,'table:'||v_name);END IF;END LOOP;
  FOREACH v_name IN ARRAY ARRAY['service_runtime_heartbeat','get_operational_health','request_operational_recovery','worker_recover_stale_whatsapp_v2','instagram_recover_stale_items_v2'] LOOP IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=v_name) THEN v_missing:=array_append(v_missing,'function:'||v_name);END IF;END LOOP;
  IF cardinality(v_missing)>0 THEN RAISE EXCEPTION 'TESTE_FALHOU:%',array_to_string(v_missing,',');END IF;
  IF NOT EXISTS(
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='refresh_operational_alerts'
      AND pg_get_function_identity_arguments(p.oid)='p_organizations_id bigint'
  ) THEN RAISE EXCEPTION 'stage11_refresh_operational_alerts_signature_invalid'; END IF;
  IF NOT has_function_privilege('service_role','public.refresh_operational_alerts(bigint)','EXECUTE')
  THEN RAISE EXCEPTION 'stage11_refresh_operational_alerts_service_role_grant_missing'; END IF;
  RAISE NOTICE 'ETAPA 11 OK';
END
$test$;
