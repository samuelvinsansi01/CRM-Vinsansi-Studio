-- CRM - Vinsansi Studio v2.4.0-R23
-- Uso único após aplicar o R23.
-- Remove somente o destino operacional (channels_id) dos leads ainda Importados.
-- NÃO altera, insere, arquiva ou exclui registros da Base Permanente.

BEGIN;

WITH updated AS (
  UPDATE public.leads AS l
  SET
    channels_id = NULL,
    leads_updated_at = now()
  WHERE l.lead_status_id = 1
    AND l.channels_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.permanent_records AS pr
      WHERE pr.organizations_id = l.organizations_id
        AND pr.canonical_lead_id = COALESCE(l.canonical_lead_id, l.leads_id)
    )
  RETURNING l.leads_id
)
SELECT count(*)::bigint AS importados_sem_destino
FROM updated;

COMMIT;
