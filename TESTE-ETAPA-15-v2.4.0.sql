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
