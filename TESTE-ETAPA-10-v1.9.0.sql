-- TESTE ETAPA 10 — contrato atual R19
DO $test$
DECLARE v_missing text[]:=ARRAY[]::text[]; v_name text;
BEGIN
  FOREACH v_name IN ARRAY ARRAY['permanent_records','permanent_record_events','permanent_record_snapshots'] LOOP
    IF to_regclass('public.'||v_name) IS NULL THEN v_missing:=array_append(v_missing,'table:'||v_name); END IF;
  END LOOP;

  FOREACH v_name IN ARRAY ARRAY['commercial_reentry_decision','service_record_capture_memory','refresh_permanent_record'] LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=v_name) THEN
      v_missing:=array_append(v_missing,'function:'||v_name);
    END IF;
  END LOOP;

  IF cardinality(v_missing)>0 THEN RAISE EXCEPTION 'TESTE_FALHOU:%',array_to_string(v_missing,','); END IF;

  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='block_permanent_record_dispatch' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'TESTE_FALHOU:trigger_bloqueio_permanente_ausente';
  END IF;

  IF has_function_privilege('authenticated','public.update_permanent_record_metadata(bigint,text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'TESTE_FALHOU:metadata_da_base_ainda_editavel';
  END IF;

  IF has_function_privilege('authenticated','public.archive_permanent_record(bigint,bigint)','EXECUTE') THEN
    RAISE EXCEPTION 'TESTE_FALHOU:arquivamento_da_base_ainda_exposto';
  END IF;

  RAISE NOTICE 'ETAPA 10 OK — Base Permanente terminal, somente consulta e sem nova prospecção';
END
$test$;
