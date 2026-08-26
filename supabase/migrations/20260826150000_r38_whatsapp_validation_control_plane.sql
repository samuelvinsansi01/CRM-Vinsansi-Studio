-- CRM - Vinsansi Studio R38
-- Validação WhatsApp persistente via control plane.
-- Elimina a dependência do CRM hospedado em WHATSAPP_VALIDATION_WORKER_URL/TOKEN.

BEGIN;

CREATE TABLE IF NOT EXISTS public.whatsapp_validation_requests (
  whatsapp_validation_requests_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizations_id bigint NOT NULL REFERENCES public.organizations(organizations_id) ON DELETE CASCADE,
  users_id bigint NOT NULL REFERENCES public.users(users_id) ON DELETE CASCADE,
  request_key text NOT NULL,
  operation text NOT NULL CHECK (operation IN ('validate','revalidate')),
  mode text NOT NULL CHECK (mode IN ('initial','revalidation')),
  leads_payload jsonb NOT NULL CHECK (jsonb_typeof(leads_payload)='array' AND jsonb_array_length(leads_payload)>0),
  request_status text NOT NULL DEFAULT 'pending' CHECK (request_status IN ('pending','processing','completed','failed','canceled')),
  worker_id text,
  claim_token uuid,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts>=0),
  result_payload jsonb,
  error_message text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  finished_at timestamptz,
  consumed_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now()+interval '10 minutes'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_validation_requests_org_key_unique UNIQUE(organizations_id,request_key)
);

CREATE INDEX IF NOT EXISTS whatsapp_validation_requests_pending_idx
  ON public.whatsapp_validation_requests(organizations_id,request_status,requested_at)
  WHERE request_status IN ('pending','processing');

ALTER TABLE public.whatsapp_validation_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.whatsapp_validation_requests FROM PUBLIC,anon,authenticated;

-- O Worker usa a credencial da instalação no endpoint executor/runtime. O backend
-- fixa p_organizations_id pelo escopo da instalação, portanto uma instalação nunca
-- consegue reivindicar validações de outra organização.
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

  -- Se um processo local morreu após claim, a solicitação volta a ficar elegível.
  UPDATE public.whatsapp_validation_requests
     SET request_status='pending',worker_id=NULL,claim_token=NULL,claimed_at=NULL,updated_at=now()
   WHERE organizations_id=p_organizations_id
     AND request_status='processing'
     AND claimed_at<now()-interval '2 minutes'
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

CREATE OR REPLACE FUNCTION public.worker_complete_whatsapp_validation_request(
  p_organizations_id bigint,
  p_request_id uuid,
  p_claim_token uuid,
  p_results jsonb DEFAULT NULL,
  p_error text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog,public
AS $$
DECLARE
  v_updated integer:=0;
BEGIN
  IF p_organizations_id IS NULL OR p_organizations_id<=0 OR p_request_id IS NULL OR p_claim_token IS NULL THEN
    RAISE EXCEPTION 'validation_completion_invalid';
  END IF;
  IF p_error IS NULL AND (p_results IS NULL OR jsonb_typeof(p_results)<>'array') THEN
    RAISE EXCEPTION 'validation_completion_results_invalid';
  END IF;

  UPDATE public.whatsapp_validation_requests r
     SET request_status=CASE WHEN nullif(trim(coalesce(p_error,'')),'') IS NULL THEN 'completed' ELSE 'failed' END,
         result_payload=CASE WHEN nullif(trim(coalesce(p_error,'')),'') IS NULL THEN coalesce(p_results,'[]'::jsonb) ELSE p_results END,
         error_message=nullif(trim(coalesce(p_error,'')),''),finished_at=now(),updated_at=now()
   WHERE r.whatsapp_validation_requests_id=p_request_id
     AND r.organizations_id=p_organizations_id
     AND r.request_status='processing'
     AND r.claim_token=p_claim_token;
  GET DIAGNOSTICS v_updated=ROW_COUNT;
  RETURN v_updated=1;
END
$$;

REVOKE ALL ON FUNCTION public.worker_claim_whatsapp_validation_request(bigint,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.worker_complete_whatsapp_validation_request(bigint,uuid,uuid,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.worker_claim_whatsapp_validation_request(bigint,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.worker_complete_whatsapp_validation_request(bigint,uuid,uuid,jsonb,text) TO service_role;

COMMIT;
