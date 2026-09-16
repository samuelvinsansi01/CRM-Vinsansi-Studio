-- VINSANSI R60.31 — prazo comercial materializado
-- Regra: aguardando_resposta vence após 72h; a limpeza acontece à meia-noite.
-- O cron consulta SOMENTE lead_commercial. Não há varredura de sents,
-- conversations ou conversation_messages durante o housekeeping diário.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_cron;

ALTER TABLE public.lead_commercial
  ADD COLUMN IF NOT EXISTS awaiting_response_since timestamptz,
  ADD COLUMN IF NOT EXISTS response_deadline_at timestamptz;

COMMENT ON COLUMN public.lead_commercial.awaiting_response_since IS
  'Instante materializado que iniciou/reiniciou a espera por resposta.';
COMMENT ON COLUMN public.lead_commercial.response_deadline_at IS
  'Prazo materializado para a regra automática aguardando_resposta -> recusado.';

-- lead_commercial é a fonte da rotina diária. O índice parcial mantém a consulta
-- da meia-noite restrita apenas aos registros que realmente podem vencer.
CREATE INDEX IF NOT EXISTS lead_commercial_response_deadline_r60_idx
  ON public.lead_commercial (response_deadline_at, organizations_id, leads_id)
  WHERE commercial_stage = 'aguardando_resposta'
    AND response_deadline_at IS NOT NULL;

-- Backfill barato e deliberadamente restrito à própria tabela comercial.
-- Não consulta mensagens, conversas nem sents. Para o estoque legado, a melhor
-- referência canônica já materializada é o último update do estado comercial.
UPDATE public.lead_commercial AS lc
   SET awaiting_response_since = coalesce(lc.awaiting_response_since, lc.lead_commercial_updated_at, now()),
       response_deadline_at = coalesce(
         lc.response_deadline_at,
         coalesce(lc.lead_commercial_updated_at, now()) + interval '72 hours'
       )
 WHERE lc.commercial_stage = 'aguardando_resposta'
   AND lc.response_deadline_at IS NULL;

-- Qualquer transição futura para aguardando_resposta nasce com prazo próprio.
CREATE OR REPLACE FUNCTION public.r60_materialize_commercial_response_deadline()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
BEGIN
  IF NEW.commercial_stage = 'aguardando_resposta' THEN
    IF TG_OP = 'INSERT'
       OR OLD.commercial_stage IS DISTINCT FROM 'aguardando_resposta' THEN
      NEW.awaiting_response_since := v_now;
      NEW.response_deadline_at := v_now + interval '72 hours';
    END IF;
  ELSE
    NEW.awaiting_response_since := NULL;
    NEW.response_deadline_at := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS r60_materialize_commercial_response_deadline_trg ON public.lead_commercial;
CREATE TRIGGER r60_materialize_commercial_response_deadline_trg
BEFORE INSERT OR UPDATE OF commercial_stage ON public.lead_commercial
FOR EACH ROW EXECUTE FUNCTION public.r60_materialize_commercial_response_deadline();

-- Atualiza somente o lead tocado por um envio de campanha/disparo.
CREATE OR REPLACE FUNCTION public.r60_refresh_response_deadline_from_sent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NEW.leads_id IS NULL OR NEW.sents_sent_at IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.sents_sent_at IS NOT DISTINCT FROM NEW.sents_sent_at
     AND OLD.leads_id IS NOT DISTINCT FROM NEW.leads_id THEN
    RETURN NEW;
  END IF;

  UPDATE public.lead_commercial
     SET awaiting_response_since = NEW.sents_sent_at,
         response_deadline_at = NEW.sents_sent_at + interval '72 hours'
   WHERE organizations_id = NEW.organizations_id
     AND leads_id = NEW.leads_id
     AND commercial_stage = 'aguardando_resposta';

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS r60_refresh_response_deadline_from_sent_trg ON public.sents;
CREATE TRIGGER r60_refresh_response_deadline_from_sent_trg
AFTER INSERT OR UPDATE OF sents_sent_at, leads_id ON public.sents
FOR EACH ROW EXECUTE FUNCTION public.r60_refresh_response_deadline_from_sent();

-- Mensageria atualiza somente o lead da mensagem no momento do evento.
-- Inbound cancela o prazo; outbound confirmado reinicia as 72h.
CREATE OR REPLACE FUNCTION public.r60_refresh_response_deadline_from_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_event_at timestamptz;
  v_old_was_confirmed boolean := false;
BEGIN
  IF NEW.leads_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.direction = 'inbound' THEN
    IF TG_OP = 'INSERT' THEN
      UPDATE public.lead_commercial
         SET awaiting_response_since = NULL,
             response_deadline_at = NULL
       WHERE organizations_id = NEW.organizations_id
         AND leads_id = NEW.leads_id
         AND commercial_stage = 'aguardando_resposta';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.direction <> 'outbound'
     OR NEW.message_status NOT IN ('sent', 'delivered', 'read') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_old_was_confirmed := OLD.message_status IN ('sent', 'delivered', 'read');
    IF v_old_was_confirmed THEN
      RETURN NEW;
    END IF;
  END IF;

  -- conversation_messages_created_at representa o nascimento da mensagem e não
  -- muda quando chegam receipts delivered/read; por isso não prolonga o prazo.
  v_event_at := coalesce(NEW.conversation_messages_created_at, clock_timestamp());

  UPDATE public.lead_commercial
     SET awaiting_response_since = v_event_at,
         response_deadline_at = v_event_at + interval '72 hours'
   WHERE organizations_id = NEW.organizations_id
     AND leads_id = NEW.leads_id
     AND commercial_stage = 'aguardando_resposta';

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS r60_refresh_response_deadline_from_message_trg ON public.conversation_messages;
CREATE TRIGGER r60_refresh_response_deadline_from_message_trg
AFTER INSERT OR UPDATE OF message_status ON public.conversation_messages
FOR EACH ROW EXECUTE FUNCTION public.r60_refresh_response_deadline_from_message();

REVOKE ALL ON FUNCTION public.r60_materialize_commercial_response_deadline() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.r60_refresh_response_deadline_from_sent() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.r60_refresh_response_deadline_from_message() FROM PUBLIC;

-- Housekeeping diário: SOMENTE lead_commercial + índice parcial.
CREATE OR REPLACE FUNCTION public.service_expire_awaiting_response_leads_r60()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_expired_count bigint := 0;
  v_lock_key bigint := hashtextextended('vinsansi:r60:commercial-response-timeout', 0);
BEGIN
  PERFORM set_config('statement_timeout', '10000', true);
  PERFORM set_config('lock_timeout', '1000', true);

  IF NOT pg_try_advisory_xact_lock(v_lock_key) THEN
    RETURN jsonb_build_object(
      'ok', true,
      'skipped', true,
      'reason', 'already_running',
      'evaluatedAt', v_now
    );
  END IF;

  WITH expired AS (
    UPDATE public.lead_commercial AS lc
       SET commercial_stage = 'recusado',
           awaiting_response_since = NULL,
           response_deadline_at = NULL,
           lead_commercial_updated_at = v_now
     WHERE lc.commercial_stage = 'aguardando_resposta'
       AND lc.response_deadline_at IS NOT NULL
       AND lc.response_deadline_at <= v_now
    RETURNING lc.organizations_id, lc.leads_id
  )
  SELECT count(*) INTO v_expired_count FROM expired;

  RETURN jsonb_build_object(
    'ok', true,
    'skipped', false,
    'rule', 'awaiting_response_materialized_deadline_to_rejected',
    'timeoutHours', 72,
    'expiredCount', v_expired_count,
    'evaluatedAt', v_now
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.service_expire_awaiting_response_leads_r60() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.service_expire_awaiting_response_leads_r60() FROM anon;
REVOKE ALL ON FUNCTION public.service_expire_awaiting_response_leads_r60() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.service_expire_awaiting_response_leads_r60() TO service_role;

COMMENT ON FUNCTION public.service_expire_awaiting_response_leads_r60() IS
  'R60.31: rotina diária indexada e restrita a lead_commercial.response_deadline_at; sem joins de mensageria.';

-- Garante que nunca exista mais de uma cópia do job.
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

-- Supabase/pg_cron usa UTC: 03:00 UTC = 00:00 America/Sao_Paulo.
SELECT cron.schedule(
  'vinsansi-commercial-awaiting-response-timeout-r60',
  '0 3 * * *',
  'SELECT public.service_expire_awaiting_response_leads_r60();'
);

COMMIT;
