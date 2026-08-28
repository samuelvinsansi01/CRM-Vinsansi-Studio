-- CRM - Vinsansi Studio v2.4.0-R53
-- Reentrada segura de leads liberados na revisão.
--
-- Regra:
--   * open: continua bloqueado globalmente;
--   * locked/invalidated no mesmo lote: continuam bloqueados;
--   * released no mesmo lote: volta a ser elegível, respeitando novamente
--     nota DESC -> avaliações DESC -> leads_id ASC.
--
-- A proteção contra repetir o MESMO lead dentro de um único clique de "Puxar"
-- é feita no cliente R53. Assim, uma falha técnica pode ser tentada novamente
-- em uma ação futura, mas nunca entra em loop/retry automático na mesma ação.

BEGIN;

CREATE OR REPLACE FUNCTION public.queue_review_candidate_ids(p_batch_id bigint,p_limit integer DEFAULT 100)
RETURNS TABLE(lead_id bigint)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path TO pg_catalog,public
AS $$
DECLARE
  v_org bigint:=public.current_organization_id();
  v_user bigint:=public.ensure_current_user();
  v_channel text;
BEGIN
  PERFORM public.require_organization_permission('queues.prepare');
  SELECT b.channel_key INTO v_channel FROM public.queue_review_batches b
  WHERE b.queue_review_batches_id=p_batch_id AND b.organizations_id=v_org AND b.users_id=v_user AND b.review_status='open';
  IF v_channel IS NULL THEN RAISE EXCEPTION 'queue_review_batch_not_open'; END IF;

  RETURN QUERY
  SELECT l.leads_id
  FROM public.leads l
  WHERE l.organizations_id=v_org AND l.users_id=v_user AND l.lead_status_id=1
    AND NOT EXISTS(
      SELECT 1 FROM public.queue_review_items ri
      WHERE ri.organizations_id=v_org AND ri.leads_id=l.leads_id
        AND (
          ri.review_status='open'
          OR (
            ri.queue_review_batches_id=p_batch_id
            AND ri.review_status IN ('invalidated','locked')
          )
        )
    )
    AND NOT EXISTS(
      SELECT 1 FROM public.permanent_records pr
      WHERE pr.organizations_id=v_org AND pr.canonical_lead_id=coalesce(l.canonical_lead_id,l.leads_id)
    )
    AND CASE WHEN v_channel='whatsapp'
      THEN length(regexp_replace(coalesce(nullif(trim(l.leads_whatsapp),''),l.leads_phone,''),'[^0-9]+','','g'))>=10
      ELSE length(trim(coalesce(l.leads_instagram,'')))>0
    END
  ORDER BY coalesce(l.leads_score,0) DESC,coalesce(l.leads_reviews_count,0) DESC,l.leads_id ASC
  LIMIT greatest(0,least(coalesce(p_limit,100),500));
END
$$;

REVOKE ALL ON FUNCTION public.queue_review_candidate_ids(bigint,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.queue_review_candidate_ids(bigint,integer) TO authenticated;

COMMIT;
