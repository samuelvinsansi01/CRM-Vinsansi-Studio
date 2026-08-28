-- CRM - Vinsansi Studio R52
-- Segurança da validação WhatsApp:
-- 1) cada ciclo de solicitação pode ser reclamado no máximo uma vez;
-- 2) uma claim em processing nunca volta automaticamente para pending;
-- 3) elimina a duplicação causada pelo lease de 20 segundos da R47.

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

  -- R52: NÃO reciclar uma solicitação em processing. A chamada ao provider pode
  -- já ter ocorrido; retomá-la automaticamente pode consultar os mesmos números
  -- novamente. Em caso de Worker interrompido, o pedido fica observável até
  -- expirar e uma nova tentativa precisa nascer de um novo ciclo explícito.

  SELECT r.whatsapp_validation_requests_id
    INTO v_id
    FROM public.whatsapp_validation_requests r
   WHERE r.organizations_id=p_organizations_id
     AND r.request_status='pending'
     AND r.attempts=0
     AND r.expires_at>now()
   ORDER BY r.requested_at,r.created_at
   FOR UPDATE SKIP LOCKED
   LIMIT 1;

  IF v_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  UPDATE public.whatsapp_validation_requests r
     SET request_status='processing',worker_id=trim(p_worker_id),claim_token=v_claim,
         claimed_at=now(),attempts=1,error_message=NULL,updated_at=now()
   WHERE r.whatsapp_validation_requests_id=v_id
     AND r.request_status='pending'
     AND r.attempts=0
   RETURNING r.whatsapp_validation_requests_id,r.operation,r.mode,r.leads_payload,r.claim_token;
END
$$;

REVOKE ALL ON FUNCTION public.worker_claim_whatsapp_validation_request(bigint,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.worker_claim_whatsapp_validation_request(bigint,text) TO service_role;

COMMIT;
