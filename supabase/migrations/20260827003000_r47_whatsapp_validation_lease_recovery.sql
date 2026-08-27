-- CRM - Vinsansi Studio R47
-- Recuperação rápida e observável do control plane de validação WhatsApp.
-- Corrige incompatibilidade entre lease de 2 minutos e timeout HTTP de 50 segundos.

BEGIN;

CREATE OR REPLACE FUNCTION public.worker_claim_whatsapp_validation_request(
  p_organizations_id bigint,
  p_worker_id text
)
RETURNS TABLE(
  request_id uuid,
  operation text,
  mode text,
  leads jsonb,
  claim_token uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog,public
AS $$
DECLARE
  v_id uuid;
  v_claim uuid:=gen_random_uuid();
BEGIN
  IF p_organizations_id IS NULL OR p_organizations_id<=0 THEN
    RAISE EXCEPTION 'validation_request_organization_invalid';
  END IF;
  IF nullif(trim(coalesce(p_worker_id,'')),'') IS NULL THEN
    RAISE EXCEPTION 'validation_request_worker_invalid';
  END IF;

  -- R47: a chamada ao provider tem timeout de 15s. Uma claim sem conclusão por
  -- mais de 20s é considerada órfã. O valor precisa ser menor que os 50s que o
  -- CRM espera, para permitir uma nova claim ainda dentro da mesma requisição.
  UPDATE public.whatsapp_validation_requests
     SET request_status='pending',worker_id=NULL,claim_token=NULL,claimed_at=NULL,
         error_message=NULL,updated_at=now()
   WHERE organizations_id=p_organizations_id
     AND request_status='processing'
     AND claimed_at<now()-interval '20 seconds'
     AND expires_at>now();

  SELECT r.whatsapp_validation_requests_id
    INTO v_id
    FROM public.whatsapp_validation_requests r
   WHERE r.organizations_id=p_organizations_id
     AND r.request_status='pending'
     AND r.expires_at>now()
   ORDER BY r.requested_at,r.created_at
   FOR UPDATE SKIP LOCKED
   LIMIT 1;

  IF v_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  UPDATE public.whatsapp_validation_requests r
     SET request_status='processing',worker_id=trim(p_worker_id),claim_token=v_claim,
         claimed_at=now(),attempts=r.attempts+1,error_message=NULL,updated_at=now()
   WHERE r.whatsapp_validation_requests_id=v_id
   RETURNING r.whatsapp_validation_requests_id,r.operation,r.mode,r.leads_payload,r.claim_token;
END
$$;

REVOKE ALL ON FUNCTION public.worker_claim_whatsapp_validation_request(bigint,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.worker_claim_whatsapp_validation_request(bigint,text) TO service_role;

COMMIT;
