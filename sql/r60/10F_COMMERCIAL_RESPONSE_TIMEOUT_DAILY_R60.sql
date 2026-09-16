-- VINSANSI R60.20 — agenda diária da regra comercial
-- Compatibilidade forward-only para ambientes que tenham aplicado a R60.19.
-- O Supabase/pg_cron usa UTC/GMT por padrão; 03:00 UTC = 00:00 America/Sao_Paulo.
-- Reagendar pelo mesmo nome substitui o job existente sem criar duplicatas.

CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule(
  'vinsansi-commercial-awaiting-response-timeout-r60',
  '0 3 * * *',
  'SELECT public.service_expire_awaiting_response_leads_r60();'
);

COMMENT ON FUNCTION public.service_expire_awaiting_response_leads_r60() IS
  'Regra interna diária: à meia-noite de America/Sao_Paulo, aguardando_resposta -> recusado para leads com 72h ou mais desde o último outbound e sem resposta inbound posterior.';
