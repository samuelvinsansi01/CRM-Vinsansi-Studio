-- VINSANSI R60.20 — regra comercial interna
-- Leads que continuam em "aguardando_resposta" por 72h após o último outbound
-- são movidos automaticamente para "recusado", desde que não exista resposta inbound posterior.
-- A automação é executada uma vez por dia, à meia-noite de America/Sao_Paulo
-- (03:00 UTC no pg_cron/Supabase), e não depende do browser, do Manager ou do Worker.

CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE INDEX IF NOT EXISTS lead_commercial_waiting_response_idx
  ON public.lead_commercial (commercial_stage, organizations_id, leads_id)
  WHERE commercial_stage = 'aguardando_resposta';

CREATE INDEX IF NOT EXISTS sents_org_lead_sent_at_r60_idx
  ON public.sents (organizations_id, leads_id, sents_sent_at DESC)
  WHERE leads_id IS NOT NULL AND sents_sent_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS conversation_messages_org_lead_direction_time_r60_idx
  ON public.conversation_messages (organizations_id, leads_id, direction, conversation_messages_created_at DESC)
  WHERE leads_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.service_expire_awaiting_response_leads_r60()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_expired_count bigint := 0;
BEGIN
  -- Impede duas execuções concorrentes do mesmo housekeeping.
  PERFORM pg_advisory_xact_lock(hashtextextended('vinsansi:r60:commercial-response-timeout', 0));

  WITH waiting AS (
    SELECT lc.organizations_id, lc.leads_id
    FROM public.lead_commercial AS lc
    JOIN public.leads AS l
      ON l.organizations_id = lc.organizations_id
     AND l.leads_id = lc.leads_id
    WHERE lc.commercial_stage = 'aguardando_resposta'
      AND l.lead_status_id = 5
  ),
  outbound_events AS (
    -- Disparos/campanhas registrados na trilha canônica de envios.
    SELECT
      w.organizations_id,
      w.leads_id,
      s.sents_sent_at AS outbound_at
    FROM waiting AS w
    JOIN public.sents AS s
      ON s.organizations_id = w.organizations_id
     AND s.leads_id = w.leads_id
    WHERE s.sents_sent_at IS NOT NULL

    UNION ALL

    -- Respostas/follow-ups manuais enviados pela conversa também reiniciam as 72h.
    SELECT
      w.organizations_id,
      w.leads_id,
      coalesce(cm.provider_timestamp, cm.conversation_messages_created_at) AS outbound_at
    FROM waiting AS w
    JOIN public.conversations AS c
      ON c.organizations_id = w.organizations_id
     AND c.leads_id = w.leads_id
    JOIN public.conversation_messages AS cm
      ON cm.organizations_id = c.organizations_id
     AND cm.conversations_id = c.conversations_id
    WHERE cm.direction = 'outbound'
      AND cm.message_status IN ('sent', 'delivered', 'read')
  ),
  last_outbound AS (
    SELECT
      organizations_id,
      leads_id,
      max(outbound_at) AS last_outbound_at
    FROM outbound_events
    WHERE outbound_at IS NOT NULL
    GROUP BY organizations_id, leads_id
  ),
  eligible AS (
    SELECT
      w.organizations_id,
      w.leads_id,
      lo.last_outbound_at
    FROM waiting AS w
    JOIN last_outbound AS lo
      ON lo.organizations_id = w.organizations_id
     AND lo.leads_id = w.leads_id
    WHERE lo.last_outbound_at <= v_now - interval '72 hours'
      -- Se houve resposta depois do último outbound, não existe mais timeout por falta de resposta.
      AND NOT EXISTS (
        SELECT 1
        FROM public.conversations AS inbound_conversation
        JOIN public.conversation_messages AS inbound
          ON inbound.organizations_id = inbound_conversation.organizations_id
         AND inbound.conversations_id = inbound_conversation.conversations_id
        WHERE inbound_conversation.organizations_id = w.organizations_id
          AND inbound_conversation.leads_id = w.leads_id
          AND inbound.direction = 'inbound'
          AND coalesce(inbound.provider_timestamp, inbound.conversation_messages_created_at) > lo.last_outbound_at
      )
  ),
  expired AS (
    UPDATE public.lead_commercial AS lc
       SET commercial_stage = 'recusado',
           lead_commercial_updated_at = v_now
      FROM eligible AS e
     WHERE lc.organizations_id = e.organizations_id
       AND lc.leads_id = e.leads_id
       -- Compare-and-set: uma mudança manual concorrente sempre ganha da automação.
       AND lc.commercial_stage = 'aguardando_resposta'
    RETURNING lc.organizations_id, lc.leads_id
  )
  SELECT count(*) INTO v_expired_count FROM expired;

  RETURN jsonb_build_object(
    'ok', true,
    'rule', 'awaiting_response_72h_to_rejected',
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
  'Regra interna: aguardando_resposta -> recusado após 72h do último outbound sem resposta inbound posterior.';

-- Nome estável: reaplicar a migration atualiza o mesmo job em vez de criar duplicatas.
SELECT cron.schedule(
  'vinsansi-commercial-awaiting-response-timeout-r60',
  '0 3 * * *',
  'SELECT public.service_expire_awaiting_response_leads_r60();'
);

-- Não executa varredura imediata no deploy. A limpeza acontece somente no job diário.
