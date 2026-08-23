-- TESTES ESTRUTURAIS DAS ETAPAS 8–15

-- ETAPA 8
-- TESTE ETAPA 8 — execute após o PATCH correspondente.
DO $test$
DECLARE v_missing text[]:=ARRAY[]::text[]; v_name text; v_ok boolean;
BEGIN
  FOREACH v_name IN ARRAY ARRAY['tool_browser_pairings','capture_execution_events'] LOOP IF to_regclass('public.'||v_name) IS NULL THEN v_missing:=array_append(v_missing,'table:'||v_name);END IF;END LOOP;
  FOREACH v_name IN ARRAY ARRAY['service_capture_identity_gate'] LOOP IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=v_name) THEN v_missing:=array_append(v_missing,'function:'||v_name);END IF;END LOOP;
  SELECT EXISTS(SELECT 1 FROM public.platform_tools WHERE tool_id='vinsansi_capture' AND latest_version='1.0.0') INTO v_ok; IF NOT v_ok THEN v_missing:=array_append(v_missing,'row:platform_tools:tool_id=vinsansi_capture AND latest_version=1.0.0');END IF;
  IF cardinality(v_missing)>0 THEN RAISE EXCEPTION 'TESTE_FALHOU:%',array_to_string(v_missing,',');END IF;
  RAISE NOTICE 'ETAPA 8 OK';
END
$test$;

-- ETAPA 9
-- TESTE ETAPA 9 — execute após o PATCH correspondente.
DO $test$
DECLARE v_missing text[]:=ARRAY[]::text[]; v_name text; v_ok boolean;
BEGIN
  FOREACH v_name IN ARRAY ARRAY['instagram_profile_runtime','instagram_dispatch_events'] LOOP IF to_regclass('public.'||v_name) IS NULL THEN v_missing:=array_append(v_missing,'table:'||v_name);END IF;END LOOP;
  FOREACH v_name IN ARRAY ARRAY['instagram_claim_queue_item_v2','instagram_update_queue_progress_v2'] LOOP IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=v_name) THEN v_missing:=array_append(v_missing,'function:'||v_name);END IF;END LOOP;
  SELECT EXISTS(SELECT 1 FROM public.platform_tools WHERE tool_id='vinsansi_instagram' AND latest_version='2.0.0') INTO v_ok; IF NOT v_ok THEN v_missing:=array_append(v_missing,'row:platform_tools:tool_id=vinsansi_instagram AND latest_version=2.0.0');END IF;
  IF cardinality(v_missing)>0 THEN RAISE EXCEPTION 'TESTE_FALHOU:%',array_to_string(v_missing,',');END IF;
  RAISE NOTICE 'ETAPA 9 OK';
END
$test$;

-- ETAPA 10
-- TESTE ETAPA 10 — execute após o PATCH correspondente.
DO $test$
DECLARE v_missing text[]:=ARRAY[]::text[]; v_name text; v_ok boolean;
BEGIN
  FOREACH v_name IN ARRAY ARRAY['commercial_outcomes','permanent_record_events'] LOOP IF to_regclass('public.'||v_name) IS NULL THEN v_missing:=array_append(v_missing,'table:'||v_name);END IF;END LOOP;
  FOREACH v_name IN ARRAY ARRAY['commercial_reentry_decision','service_record_capture_memory','refresh_permanent_record'] LOOP IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=v_name) THEN v_missing:=array_append(v_missing,'function:'||v_name);END IF;END LOOP;
  IF cardinality(v_missing)>0 THEN RAISE EXCEPTION 'TESTE_FALHOU:%',array_to_string(v_missing,',');END IF;
  RAISE NOTICE 'ETAPA 10 OK';
END
$test$;

-- ETAPA 11
-- TESTE ETAPA 11 — execute após o PATCH correspondente.
DO $test$
DECLARE v_missing text[]:=ARRAY[]::text[]; v_name text; v_ok boolean;
BEGIN
  FOREACH v_name IN ARRAY ARRAY['platform_runtime_heartbeats','operational_alerts','recovery_requests'] LOOP IF to_regclass('public.'||v_name) IS NULL THEN v_missing:=array_append(v_missing,'table:'||v_name);END IF;END LOOP;
  FOREACH v_name IN ARRAY ARRAY['service_runtime_heartbeat','get_operational_health','request_operational_recovery','worker_recover_stale_whatsapp_v2','instagram_recover_stale_items_v2'] LOOP IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=v_name) THEN v_missing:=array_append(v_missing,'function:'||v_name);END IF;END LOOP;
  IF cardinality(v_missing)>0 THEN RAISE EXCEPTION 'TESTE_FALHOU:%',array_to_string(v_missing,',');END IF;
  RAISE NOTICE 'ETAPA 11 OK';
END
$test$;

-- ETAPA 12
-- TESTE ETAPA 12 — execute após o PATCH correspondente.
DO $test$
DECLARE v_missing text[]:=ARRAY[]::text[]; v_name text; v_ok boolean;
BEGIN
  FOREACH v_name IN ARRAY ARRAY['platform_schema_contracts'] LOOP IF to_regclass('public.'||v_name) IS NULL THEN v_missing:=array_append(v_missing,'table:'||v_name);END IF;END LOOP;
  FOREACH v_name IN ARRAY ARRAY['platform_schema_health'] LOOP IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=v_name) THEN v_missing:=array_append(v_missing,'function:'||v_name);END IF;END LOOP;
  SELECT EXISTS(SELECT 1 FROM public.platform_schema_contracts WHERE schema_contract_version='2026.08.23.12') INTO v_ok; IF NOT v_ok THEN v_missing:=array_append(v_missing,'schema_contract:2026.08.23.12');END IF;
  IF cardinality(v_missing)>0 THEN RAISE EXCEPTION 'TESTE_FALHOU:%',array_to_string(v_missing,',');END IF;
  RAISE NOTICE 'ETAPA 12 OK';
END
$test$;

-- ETAPA 13
-- TESTE ETAPA 13 — execute após o PATCH correspondente.
DO $test$
DECLARE v_missing text[]:=ARRAY[]::text[]; v_name text; v_ok boolean;
BEGIN
  FOREACH v_name IN ARRAY ARRAY['lead_orchestration_state','lead_lifecycle_events'] LOOP IF to_regclass('public.'||v_name) IS NULL THEN v_missing:=array_append(v_missing,'table:'||v_name);END IF;END LOOP;
  FOREACH v_name IN ARRAY ARRAY['service_orchestrate_lead','service_orchestrate_ready_leads'] LOOP IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=v_name) THEN v_missing:=array_append(v_missing,'function:'||v_name);END IF;END LOOP;
  SELECT EXISTS(SELECT 1 FROM public.platform_schema_contracts WHERE schema_contract_version='2026.08.23.12') INTO v_ok; IF NOT v_ok THEN v_missing:=array_append(v_missing,'schema_contract:2026.08.23.12');END IF;
  IF cardinality(v_missing)>0 THEN RAISE EXCEPTION 'TESTE_FALHOU:%',array_to_string(v_missing,',');END IF;
  RAISE NOTICE 'ETAPA 13 OK';
END
$test$;

-- ETAPA 14
-- TESTE ETAPA 14 — execute após o PATCH correspondente.
DO $test$
DECLARE v_missing text[]:=ARRAY[]::text[]; v_name text; v_ok boolean;
BEGIN
  FOREACH v_name IN ARRAY ARRAY['platform_release_channels'] LOOP IF to_regclass('public.'||v_name) IS NULL THEN v_missing:=array_append(v_missing,'table:'||v_name);END IF;END LOOP;
  FOREACH v_name IN ARRAY ARRAY['platform_component_compatibility','platform_release_matrix'] LOOP IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=v_name) THEN v_missing:=array_append(v_missing,'function:'||v_name);END IF;END LOOP;
  SELECT EXISTS(SELECT 1 FROM public.platform_schema_contracts WHERE schema_contract_version='2026.08.24.14') INTO v_ok; IF NOT v_ok THEN v_missing:=array_append(v_missing,'schema_contract:2026.08.24.14');END IF;
  IF cardinality(v_missing)>0 THEN RAISE EXCEPTION 'TESTE_FALHOU:%',array_to_string(v_missing,',');END IF;
  RAISE NOTICE 'ETAPA 14 OK';
END
$test$;

-- ETAPA 15
-- TESTE ETAPA 15 — execute após o PATCH correspondente.
DO $test$
DECLARE v_missing text[]:=ARRAY[]::text[]; v_name text; v_ok boolean;
BEGIN
  FOREACH v_name IN ARRAY ARRAY['production_homologation_runs','production_homologation_checks'] LOOP IF to_regclass('public.'||v_name) IS NULL THEN v_missing:=array_append(v_missing,'table:'||v_name);END IF;END LOOP;
  FOREACH v_name IN ARRAY ARRAY['start_production_homologation','set_production_homologation_check','platform_production_readiness','promote_platform_stable_release'] LOOP IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=v_name) THEN v_missing:=array_append(v_missing,'function:'||v_name);END IF;END LOOP;
  SELECT EXISTS(SELECT 1 FROM public.platform_schema_contracts WHERE schema_contract_version='2026.08.24.15') INTO v_ok; IF NOT v_ok THEN v_missing:=array_append(v_missing,'schema_contract:2026.08.24.15');END IF;
  IF cardinality(v_missing)>0 THEN RAISE EXCEPTION 'TESTE_FALHOU:%',array_to_string(v_missing,',');END IF;
  RAISE NOTICE 'ETAPA 15 OK';
END
$test$;
