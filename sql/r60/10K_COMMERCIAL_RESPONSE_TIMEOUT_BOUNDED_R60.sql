-- VINSANSI R60.30 — housekeeping comercial bounded/fail-safe
-- Mantém a regra diária de 72h, mas garante que ela nunca monopolize o banco.
-- Usa conversation_messages.leads_id diretamente, lock não bloqueante e timeouts locais.

-- Reutiliza o índice criado em 10E:
-- conversation_messages_org_lead_direction_time_r60_idx
-- (organizations_id, leads_id, direction, conversation_messages_created_at DESC).


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
  v_lock_key bigint := hashtextextended('vinsansi:r60:commercial-response-timeout', 0);
BEGIN
  -- Housekeeping nunca deve disputar indefinidamente com tráfego interativo do CRM.
  PERFORM set_config('statement_timeout', '20000', true);
  PERFORM set_config('lock_timeout', '2000', true);

  IF NOT pg_try_advisory_xact_lock(v_lock_key) THEN
    RETURN jsonb_build_object(
      'ok', true,
      'skipped', true,
      'reason', 'already_running',
      'evaluatedAt', v_now
    );
  END IF;

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
    ORDER BY lc.organizations_id, lc.leads_id
    LIMIT 5000
  ),
  activity AS (
    SELECT
      w.organizations_id,
      w.leads_id,
      coalesce(
        greatest(sent.last_sent_at, msg.last_outbound_at),
        sent.last_sent_at,
        msg.last_outbound_at,
        w.legacy_fallback_outbound_at
      ) AS last_outbound_at,
      inbound.last_inbound_at,
      sent.last_sent_at IS NULL
        AND msg.last_outbound_at IS NULL
        AND w.legacy_fallback_outbound_at IS NOT NULL AS used_legacy_fallback
    FROM waiting AS w
    LEFT JOIN LATERAL (
      SELECT max(s.sents_sent_at) AS last_sent_at
      FROM public.sents AS s
      WHERE s.organizations_id = w.organizations_id
        AND s.leads_id = w.leads_id
        AND s.sents_sent_at IS NOT NULL
    ) AS sent ON true
    LEFT JOIN LATERAL (
      SELECT max(coalesce(cm.provider_timestamp, cm.conversation_messages_created_at)) AS last_outbound_at
      FROM public.conversation_messages AS cm
      WHERE cm.organizations_id = w.organizations_id
        AND cm.leads_id = w.leads_id
        AND cm.direction = 'outbound'
        AND cm.message_status IN ('sent', 'delivered', 'read')
    ) AS msg ON true
    LEFT JOIN LATERAL (
      SELECT max(coalesce(cm.provider_timestamp, cm.conversation_messages_created_at)) AS last_inbound_at
      FROM public.conversation_messages AS cm
      WHERE cm.organizations_id = w.organizations_id
        AND cm.leads_id = w.leads_id
        AND cm.direction = 'inbound'
    ) AS inbound ON true
  ),
  eligible AS (
    SELECT
      a.organizations_id,
      a.leads_id,
      a.used_legacy_fallback
    FROM activity AS a
    WHERE a.last_outbound_at IS NOT NULL
      AND a.last_outbound_at <= v_now - interval '72 hours'
      AND (a.last_inbound_at IS NULL OR a.last_inbound_at <= a.last_outbound_at)
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
    'skipped', false,
    'rule', 'awaiting_response_72h_to_rejected',
    'timeoutHours', 72,
    'batchLimit', 5000,
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
  'Regra diária bounded: aguardando_resposta -> recusado após 72h ou mais sem inbound posterior; usa índices por lead, lock não bloqueante e timeout local.';

SELECT cron.schedule(
  'vinsansi-commercial-awaiting-response-timeout-r60',
  '0 3 * * *',
  'SELECT public.service_expire_awaiting_response_leads_r60();'
);
