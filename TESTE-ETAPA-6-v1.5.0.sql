-- CRM v1.5.0 / Etapa 6 — smoke test não destrutivo
-- Execute DEPOIS do PATCH-ETAPA-6-AUDITORIA-ESTADOS-v1.5.0.sql.
DO $test$
DECLARE v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM pg_trigger
   WHERE tgrelid='public.audit_events'::regclass
     AND tgname IN ('audit_events_append_only_update_trigger','audit_events_append_only_delete_trigger')
     AND NOT tgisinternal;
  IF v_count<>2 THEN RAISE EXCEPTION 'stage6_test_missing_append_only_triggers'; END IF;

  IF to_regprocedure('public.validate_audit_event_insert()') IS NULL THEN
    RAISE EXCEPTION 'stage6_test_missing_audit_insert_validator';
  END IF;
  IF to_regprocedure('public.assert_allowed_status_transition(text,bigint,bigint)') IS NULL THEN
    RAISE EXCEPTION 'stage6_test_missing_state_machine';
  END IF;

  PERFORM public.assert_allowed_status_transition('lead',1,2);
  BEGIN
    PERFORM public.assert_allowed_status_transition('lead',1,5);
    RAISE EXCEPTION 'stage6_test_invalid_transition_was_accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM='stage6_test_invalid_transition_was_accepted' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE 'state_transition_not_allowed:%' THEN RAISE; END IF;
  END;

  IF NOT EXISTS(
    SELECT 1 FROM pg_policies
     WHERE schemaname='public' AND tablename='audit_events'
       AND policyname='audit_events_organization_select'
  ) THEN RAISE EXCEPTION 'stage6_test_missing_audit_rls_policy'; END IF;

  RAISE NOTICE 'Etapa 6 OK: append-only + state machine + RLS encontrados.';
END
$test$;
