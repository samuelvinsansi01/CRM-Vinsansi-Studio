-- TESTE ETAPA 10 — execute após o PATCH correspondente.
DO $test$
DECLARE v_missing text[]:=ARRAY[]::text[]; v_name text; v_ok boolean;
BEGIN
  FOREACH v_name IN ARRAY ARRAY['commercial_outcomes','permanent_record_events'] LOOP IF to_regclass('public.'||v_name) IS NULL THEN v_missing:=array_append(v_missing,'table:'||v_name);END IF;END LOOP;
  FOREACH v_name IN ARRAY ARRAY['commercial_reentry_decision','service_record_capture_memory','refresh_permanent_record'] LOOP IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=v_name) THEN v_missing:=array_append(v_missing,'function:'||v_name);END IF;END LOOP;
  IF cardinality(v_missing)>0 THEN RAISE EXCEPTION 'TESTE_FALHOU:%',array_to_string(v_missing,',');END IF;
  IF EXISTS(SELECT 1 FROM public.commercial_outcomes WHERE allow_reentry OR minimum_reentry_days IS NOT NULL) THEN RAISE EXCEPTION 'TESTE_FALHOU:reentrada_ainda_ativa'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='block_permanent_record_dispatch' AND NOT tgisinternal) THEN RAISE EXCEPTION 'TESTE_FALHOU:trigger_bloqueio_permanente_ausente'; END IF;
  RAISE NOTICE 'ETAPA 10 OK — Base Permanente terminal para prospecção';
END
$test$;
