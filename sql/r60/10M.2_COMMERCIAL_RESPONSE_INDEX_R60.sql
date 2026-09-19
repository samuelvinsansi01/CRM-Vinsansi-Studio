-- Idempotente e compatível com o Supabase SQL Editor.
-- O live closeout confirmou lead_commercial pequeno; lock_timeout evita espera longa.
SET statement_timeout='5min';
SET lock_timeout='5s';

CREATE INDEX IF NOT EXISTS lead_commercial_response_deadline_r60_idx
ON public.lead_commercial(response_deadline_at,organizations_id,leads_id)
WHERE commercial_stage='aguardando_resposta'
  AND response_deadline_at IS NOT NULL;

RESET statement_timeout;
RESET lock_timeout;
