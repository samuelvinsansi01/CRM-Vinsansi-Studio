-- CRM 2.4.0-R11 — Captura: fila global de revisão + TTL 24h
BEGIN;

ALTER TABLE public.maps_search_candidates
  ADD COLUMN IF NOT EXISTS review_state text,
  ADD COLUMN IF NOT EXISTS review_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_decided_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_cleared_at timestamptz;

UPDATE public.maps_search_candidates
SET review_state = CASE
  WHEN promoted_leads_id IS NOT NULL THEN 'saved'
  WHEN identity_decision = 'duplicate' THEN 'duplicate'
  WHEN suppression_match OR identity_decision = 'suppressed' THEN 'suppressed'
  WHEN excluded_by_user THEN 'rejected'
  WHEN eligibility_status IN ('closed_business','no_supported_contact') THEN 'invalid'
  ELSE 'pending' END
WHERE review_state IS NULL;

UPDATE public.maps_search_candidates
SET review_expires_at = created_at + interval '24 hours'
WHERE review_expires_at IS NULL AND review_state IN ('pending','rejected','invalid');

ALTER TABLE public.maps_search_candidates ALTER COLUMN review_state SET DEFAULT 'pending';

DO $do$ BEGIN
  ALTER TABLE public.maps_search_candidates ADD CONSTRAINT maps_search_candidates_review_state_check
    CHECK (review_state IN ('pending','rejected','invalid','saved','duplicate','suppressed','expired'));
EXCEPTION WHEN duplicate_object THEN NULL; END $do$;

CREATE INDEX IF NOT EXISTS maps_candidates_review_active_idx
  ON public.maps_search_candidates(organizations_id,review_state,review_expires_at);
CREATE INDEX IF NOT EXISTS maps_candidates_review_phone_idx
  ON public.maps_search_candidates(organizations_id,effective_phone) WHERE effective_phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS maps_candidates_review_instagram_idx
  ON public.maps_search_candidates(organizations_id,effective_instagram) WHERE effective_instagram IS NOT NULL;
CREATE INDEX IF NOT EXISTS maps_candidates_review_maps_idx
  ON public.maps_search_candidates(organizations_id,maps_url) WHERE maps_url IS NOT NULL;

COMMIT;
