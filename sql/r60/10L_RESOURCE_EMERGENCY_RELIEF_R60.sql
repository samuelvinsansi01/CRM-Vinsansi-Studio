-- VINSANSI R60.31 — contenção emergencial de carga no Postgres
-- Interrompe a automação comercial antiga que reconstruía atividade por joins.
-- Não apaga dados, não altera mensagens/leads e não executa VACUUM/REINDEX.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Remove todas as cópias do job legado antes de instalar o modelo materializado.
DO $block$
DECLARE
  v_jobid bigint;
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    FOR v_jobid IN
      SELECT jobid
      FROM cron.job
      WHERE jobname = 'vinsansi-commercial-awaiting-response-timeout-r60'
    LOOP
      PERFORM cron.unschedule(v_jobid);
    END LOOP;
  END IF;
END
$block$;

-- Cancela somente uma execução ativa da função comercial antiga.
-- Não toca em autovacuum, sessões do CRM, Worker, Gateway ou outras queries.
DO $block$
DECLARE
  v_pid integer;
BEGIN
  FOR v_pid IN
    SELECT pid
    FROM pg_stat_activity
    WHERE pid <> pg_backend_pid()
      AND state = 'active'
      AND query ILIKE '%service_expire_awaiting_response_leads_r60%'
  LOOP
    PERFORM pg_cancel_backend(v_pid);
  END LOOP;
END
$block$;

-- Fail-safe entre 10L e 10M: qualquer chamada antiga retorna imediatamente.
CREATE OR REPLACE FUNCTION public.service_expire_awaiting_response_leads_r60()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT jsonb_build_object(
    'ok', false,
    'disabled', true,
    'reason', 'resource_relief_r60_31',
    'rule', 'awaiting_response_72h_to_rejected'
  );
$function$;

REVOKE ALL ON FUNCTION public.service_expire_awaiting_response_leads_r60() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.service_expire_awaiting_response_leads_r60() FROM anon;
REVOKE ALL ON FUNCTION public.service_expire_awaiting_response_leads_r60() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.service_expire_awaiting_response_leads_r60() TO service_role;

COMMENT ON FUNCTION public.service_expire_awaiting_response_leads_r60() IS
  'R60.31 relief interlock: legacy 72h scanner disabled before materialized-deadline installation.';

COMMIT;
