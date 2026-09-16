-- VINSANSI R60.23 — compatibilidade com histórico comercial legado
-- A tela Comercial já considera leads_updated_at como "Enviado em" quando o lead
-- está tecnicamente em Enviado (lead_status_id = 5) e não existe sents_sent_at.
-- Esta migration alinha a rotina diária das 72h com a mesma semântica, mas usa
-- esse timestamp SOMENTE como fallback quando não existe nenhum outbound canônico.
-- Não executa limpeza no deploy; o job diário continua sendo a única execução automática.

CREATE OR REPLACE FUNCTION public.service_expire_awaiting_response_leads_r60()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_expired_count bigint := 0;
  v_legacy_fallback_count bigint := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('vinsansi:r60:commercial-response-timeout', 0));

  WITH waiting AS (
    SELECT
      lc.organizations_id,
      lc.leads_id,
      coalesce(l.leads_updated_at, l.leads_created_at) AS legacy_fallback_outbound_at
    FROM public.lead_commercial AS lc
    JOIN public.leads AS l
      ON l.organizations_id = lc.organizations_id
     AND l.leads_id = lc.leads_id
    WHERE lc.commercial_stage = 'aguardando_resposta'
      AND l.lead_status_id = 5
  ),
  outbound_events AS (
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
  canonical_outbound AS (
    SELECT
      organizations_id,
      leads_id,
      max(outbound_at) AS last_outbound_at
    FROM outbound_events
    WHERE outbound_at IS NOT NULL
    GROUP BY organizations_id, leads_id
  ),
  last_outbound AS (
    SELECT
      w.organizations_id,
      w.leads_id,
      coalesce(co.last_outbound_at, w.legacy_fallback_outbound_at) AS last_outbound_at,
      (co.last_outbound_at IS NULL AND w.legacy_fallback_outbound_at IS NOT NULL) AS used_legacy_fallback
    FROM waiting AS w
    LEFT JOIN canonical_outbound AS co
      ON co.organizations_id = w.organizations_id
     AND co.leads_id = w.leads_id
    WHERE co.last_outbound_at IS NOT NULL
       OR w.legacy_fallback_outbound_at IS NOT NULL
  ),
  eligible AS (
    SELECT
      lo.organizations_id,
      lo.leads_id,
      lo.last_outbound_at,
      lo.used_legacy_fallback
    FROM last_outbound AS lo
    WHERE lo.last_outbound_at <= v_now - interval '72 hours'
      AND NOT EXISTS (
        SELECT 1
        FROM public.conversations AS inbound_conversation
        JOIN public.conversation_messages AS inbound
          ON inbound.organizations_id = inbound_conversation.organizations_id
         AND inbound.conversations_id = inbound_conversation.conversations_id
        WHERE inbound_conversation.organizations_id = lo.organizations_id
          AND inbound_conversation.leads_id = lo.leads_id
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
       AND lc.commercial_stage = 'aguardando_resposta'
    RETURNING lc.organizations_id, lc.leads_id, e.used_legacy_fallback
  )
  SELECT
    count(*),
    count(*) FILTER (WHERE used_legacy_fallback)
  INTO v_expired_count, v_legacy_fallback_count
  FROM expired;

  RETURN jsonb_build_object(
    'ok', true,
    'rule', 'awaiting_response_72h_to_rejected',
    'timeoutHours', 72,
    'expiredCount', v_expired_count,
    'legacyFallbackCount', v_legacy_fallback_count,
    'evaluatedAt', v_now
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.service_expire_awaiting_response_leads_r60() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.service_expire_awaiting_response_leads_r60() FROM anon;
REVOKE ALL ON FUNCTION public.service_expire_awaiting_response_leads_r60() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.service_expire_awaiting_response_leads_r60() TO service_role;

COMMENT ON FUNCTION public.service_expire_awaiting_response_leads_r60() IS
  'Regra interna diária: aguardando_resposta -> recusado após 72h ou mais sem resposta; usa outbound canônico e, somente para histórico legado sem outbound, o timestamp de Enviado exibido pelo CRM.';

-- Mantém uma única execução diária: 03:00 UTC = 00:00 America/Sao_Paulo.
SELECT cron.schedule(
  'vinsansi-commercial-awaiting-response-timeout-r60',
  '0 3 * * *',
  'SELECT public.service_expire_awaiting_response_leads_r60();'
);
