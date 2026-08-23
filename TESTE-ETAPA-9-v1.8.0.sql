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
