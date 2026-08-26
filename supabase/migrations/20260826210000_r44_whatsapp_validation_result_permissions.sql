-- CRM - Vinsansi Studio v2.4.0-R44
-- Corrige a permissao da RPC que persiste o resultado final da validacao WhatsApp.
-- A funcao e legada do schema-base; por isso a assinatura e descoberta no catalogo
-- em vez de ser duplicada/recriada aqui.

BEGIN;

DO $r44_grant$
DECLARE
  r record;
  v_found integer := 0;
BEGIN
  FOR r IN
    SELECT
      n.nspname AS schema_name,
      p.proname AS function_name,
      pg_get_function_identity_arguments(p.oid) AS identity_arguments
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'record_whatsapp_validation_result'
      AND p.prokind = 'f'
  LOOP
    v_found := v_found + 1;

    EXECUTE format(
      'REVOKE ALL ON FUNCTION %I.%I(%s) FROM PUBLIC, anon',
      r.schema_name,
      r.function_name,
      r.identity_arguments
    );

    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION %I.%I(%s) TO authenticated, service_role',
      r.schema_name,
      r.function_name,
      r.identity_arguments
    );
  END LOOP;

  IF v_found = 0 THEN
    RAISE EXCEPTION 'r44_record_whatsapp_validation_result_not_found';
  END IF;
END
$r44_grant$;

-- Falha a migration se o grant nao tiver sido efetivamente aplicado.
DO $r44_verify$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'record_whatsapp_validation_result'
      AND p.prokind = 'f'
  LOOP
    IF NOT has_function_privilege('authenticated', r.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'r44_authenticated_execute_missing';
    END IF;
    IF NOT has_function_privilege('service_role', r.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'r44_service_role_execute_missing';
    END IF;
    IF has_function_privilege('anon', r.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'r44_anon_execute_must_remain_blocked';
    END IF;
  END LOOP;
END
$r44_verify$;

COMMIT;
