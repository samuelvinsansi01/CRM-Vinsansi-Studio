-- CRM Vinsansi Studio v1.6.0
-- Smoke test NÃO destrutivo da Etapa 7.
-- Pode ser executado no SQL Editor depois do patch.

DO $test$
DECLARE
  v_def text;
  v_count bigint;
BEGIN
  IF public.normalize_identity_phone('(11) 99999-0000') <> '5511999990000' THEN
    RAISE EXCEPTION 'stage7_test_phone_normalization_failed';
  END IF;
  IF public.normalize_identity_instagram('https://instagram.com/Minha.Empresa/') <> 'minha.empresa' THEN
    RAISE EXCEPTION 'stage7_test_instagram_normalization_failed';
  END IF;
  IF public.normalize_identity_domain('https://www.Exemplo.com.br/pagina') <> 'exemplo.com.br' THEN
    RAISE EXCEPTION 'stage7_test_domain_normalization_failed';
  END IF;

  SELECT pg_get_indexdef(indexrelid) INTO v_def
    FROM pg_index
   WHERE indexrelid='public.lead_identity_registry_org_identity_unique'::regclass;
  IF v_def IS NULL OR position('(organizations_id, identity_type, identity_value)' in v_def)=0 THEN
    RAISE EXCEPTION 'stage7_test_registry_org_unique_missing';
  END IF;

  SELECT pg_get_indexdef(indexrelid) INTO v_def
    FROM pg_index
   WHERE indexrelid='public.contact_suppressions_org_identity_unique'::regclass;
  IF v_def IS NULL OR position('(organizations_id, identity_type, identity_value)' in v_def)=0 THEN
    RAISE EXCEPTION 'stage7_test_suppression_org_unique_missing';
  END IF;

  SELECT count(*) INTO v_count FROM pg_trigger
   WHERE tgrelid='public.leads'::regclass AND NOT tgisinternal
     AND tgname IN ('prepare_lead_identity_trigger','register_lead_identity_trigger','validate_lead_canonical_scope_trigger','suppress_after_lead_finalized_trigger');
  IF v_count<>4 THEN RAISE EXCEPTION 'stage7_test_lead_triggers_missing:%',v_count; END IF;

  IF NOT EXISTS(
    SELECT 1 FROM public.audit_transition_rules
     WHERE entity_type='lead' AND from_status_id=7 AND to_status_id=1 AND is_active
  ) THEN RAISE EXCEPTION 'stage7_test_duplicate_restore_transition_missing'; END IF;

  IF NOT EXISTS(
    SELECT 1 FROM pg_trigger
     WHERE tgrelid='public.leads'::regclass
       AND tgname='audit_lead_state_change_trigger'
       AND NOT tgisinternal
       AND tgenabled='O'
  ) THEN RAISE EXCEPTION 'stage7_test_audit_trigger_not_enabled'; END IF;

  IF NOT EXISTS(
    SELECT 1 FROM pg_policies
     WHERE schemaname='public' AND tablename='lead_identity_registry' AND policyname='lead_identity_registry_org_select'
  ) THEN RAISE EXCEPTION 'stage7_test_registry_rls_missing'; END IF;

  IF NOT EXISTS(
    SELECT 1 FROM pg_policies
     WHERE schemaname='public' AND tablename='contact_suppressions' AND policyname='contact_suppressions_org_select'
  ) THEN RAISE EXCEPTION 'stage7_test_suppression_rls_missing'; END IF;
END
$test$;

SELECT 'Etapa 7 v1.6.0: contratos estruturais aprovados.' AS resultado;
