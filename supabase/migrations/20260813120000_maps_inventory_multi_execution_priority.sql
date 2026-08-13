BEGIN;

-- Google Maps is now a first-class lead origin. This is forward-only and does
-- not rewrite historical leads.
ALTER TABLE public.leads
  DROP CONSTRAINT IF EXISTS leads_origin_check;

ALTER TABLE public.leads
  ADD CONSTRAINT leads_origin_check
  CHECK (leads_origin = ANY (ARRAY[
    'manual'::text,
    'apify'::text,
    'csv'::text,
    'api'::text,
    'google_maps'::text
  ]));

-- Keep public.leads.leads_score as the original Google rating (0..5).
-- Internal CRM ordering uses a separate field.
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS leads_priority_score integer NOT NULL DEFAULT 0;

ALTER TABLE public.leads
  DROP CONSTRAINT IF EXISTS leads_priority_score_nonnegative;
ALTER TABLE public.leads
  ADD CONSTRAINT leads_priority_score_nonnegative
  CHECK (leads_priority_score >= 0);

-- Acquisition progress is additive by channel: 1000 WhatsApp + 500 Instagram
-- means 1500 unique allocated candidates.
ALTER TABLE public.maps_search_executions
  ADD COLUMN IF NOT EXISTS target_unique integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS whatsapp_bucket_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS instagram_bucket_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unique_allocated_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS target_source text NOT NULL DEFAULT 'branch_default',
  ADD COLUMN IF NOT EXISTS last_heartbeat_at timestamptz NOT NULL DEFAULT now();

UPDATE public.maps_search_executions
SET target_unique = target_phone_whatsapp + target_instagram
WHERE target_unique = 0
  AND (target_phone_whatsapp > 0 OR target_instagram > 0);

ALTER TABLE public.maps_search_executions
  DROP CONSTRAINT IF EXISTS maps_search_executions_target_unique_check;
ALTER TABLE public.maps_search_executions
  ADD CONSTRAINT maps_search_executions_target_unique_check CHECK (target_unique >= 0);

ALTER TABLE public.maps_search_executions
  DROP CONSTRAINT IF EXISTS maps_search_executions_bucket_counts_check;
ALTER TABLE public.maps_search_executions
  ADD CONSTRAINT maps_search_executions_bucket_counts_check CHECK (
    whatsapp_bucket_count >= 0
    AND instagram_bucket_count >= 0
    AND unique_allocated_count >= 0
  );

ALTER TABLE public.maps_search_executions
  DROP CONSTRAINT IF EXISTS maps_search_executions_target_source_check;
ALTER TABLE public.maps_search_executions
  ADD CONSTRAINT maps_search_executions_target_source_check CHECK (
    target_source IN ('branch_default','execution_override','legacy_days')
  );

ALTER TABLE public.maps_search_candidates
  ADD COLUMN IF NOT EXISTS maps_rating numeric(3,2),
  ADD COLUMN IF NOT EXISTS maps_reviews_count integer,
  ADD COLUMN IF NOT EXISTS business_status text,
  ADD COLUMN IF NOT EXISTS acquisition_bucket text,
  ADD COLUMN IF NOT EXISTS coverage_ids_found jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.maps_search_candidates
  DROP CONSTRAINT IF EXISTS maps_search_candidates_rating_check;
ALTER TABLE public.maps_search_candidates
  ADD CONSTRAINT maps_search_candidates_rating_check CHECK (
    maps_rating IS NULL OR (maps_rating >= 0 AND maps_rating <= 5)
  );

ALTER TABLE public.maps_search_candidates
  DROP CONSTRAINT IF EXISTS maps_search_candidates_reviews_check;
ALTER TABLE public.maps_search_candidates
  ADD CONSTRAINT maps_search_candidates_reviews_check CHECK (
    maps_reviews_count IS NULL OR maps_reviews_count >= 0
  );

ALTER TABLE public.maps_search_candidates
  DROP CONSTRAINT IF EXISTS maps_search_candidates_business_status_check;
ALTER TABLE public.maps_search_candidates
  ADD CONSTRAINT maps_search_candidates_business_status_check CHECK (
    business_status IS NULL OR business_status IN ('open','temporarily_closed','permanently_closed','unknown')
  );

ALTER TABLE public.maps_search_candidates
  DROP CONSTRAINT IF EXISTS maps_search_candidates_acquisition_bucket_check;
ALTER TABLE public.maps_search_candidates
  ADD CONSTRAINT maps_search_candidates_acquisition_bucket_check CHECK (
    acquisition_bucket IS NULL OR acquisition_bucket IN ('whatsapp','instagram')
  );

ALTER TABLE public.maps_search_candidates
  DROP CONSTRAINT IF EXISTS maps_search_candidates_coverage_ids_found_check;
ALTER TABLE public.maps_search_candidates
  ADD CONSTRAINT maps_search_candidates_coverage_ids_found_check CHECK (
    jsonb_typeof(coverage_ids_found) = 'array'
  );

-- Extend the pre-existing eligibility contract without removing prior values.
ALTER TABLE public.maps_search_candidates
  DROP CONSTRAINT IF EXISTS maps_search_candidates_eligibility_status_check;
ALTER TABLE public.maps_search_candidates
  ADD CONSTRAINT maps_search_candidates_eligibility_status_check CHECK (
    eligibility_status IN ('ready_to_save','no_supported_contact','invalid_contact','closed_business')
  );

CREATE INDEX IF NOT EXISTS maps_search_executions_active_owner_idx
  ON public.maps_search_executions (users_id, status, last_heartbeat_at DESC);
CREATE INDEX IF NOT EXISTS maps_search_candidates_bucket_idx
  ON public.maps_search_candidates (maps_search_executions_id, acquisition_bucket)
  WHERE acquisition_bucket IS NOT NULL AND excluded_by_user = false;
CREATE INDEX IF NOT EXISTS leads_priority_score_idx
  ON public.leads (users_id, branches_id, leads_priority_score DESC, leads_created_at ASC);

-- Atomic creation contract. A transaction-scoped advisory lock prevents two
-- devices/windows from both seeing 4/5 and creating a sixth active execution.
CREATE OR REPLACE FUNCTION public.create_maps_search_execution_v2(
  p_execution_id uuid,
  p_users_id bigint,
  p_installation_id uuid,
  p_branches_id bigint,
  p_branch_name text,
  p_states_id bigint,
  p_requested_cities_id bigint,
  p_city_mode text,
  p_requested_days smallint,
  p_extraction_mode text,
  p_target_phone_whatsapp integer,
  p_target_instagram integer,
  p_target_source text,
  p_extension_version text,
  p_search_terms_snapshot jsonb,
  p_runner_strategy jsonb
)
RETURNS public.maps_search_executions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_active_count integer;
  v_row public.maps_search_executions;
BEGIN
  PERFORM pg_advisory_xact_lock(p_users_id);

  -- A crashed browser must not consume a slot forever. Active extension
  -- sessions heartbeat every minute; 15 minutes without heartbeat is stale.
  UPDATE public.maps_search_executions
  SET status = 'stopped',
      termination_reason = COALESCE(termination_reason, 'stale_extension_session'),
      finished_at = COALESCE(finished_at, now()),
      updated_at = now()
  WHERE users_id = p_users_id
    AND status IN ('pending','running','paused')
    AND COALESCE(last_heartbeat_at, updated_at, created_at) < now() - interval '15 minutes';

  SELECT count(*)::integer
  INTO v_active_count
  FROM public.maps_search_executions
  WHERE users_id = p_users_id
    AND status IN ('pending','running','paused');

  IF v_active_count >= 5 THEN
    RAISE EXCEPTION 'MAPS_ACTIVE_EXECUTION_LIMIT';
  END IF;

  INSERT INTO public.maps_search_executions (
    maps_search_executions_id,
    users_id,
    maps_extension_installations_id,
    branches_id,
    branch_name,
    states_id,
    requested_cities_id,
    city_mode,
    requested_days,
    extraction_mode,
    target_phone_whatsapp,
    target_instagram,
    target_unique,
    target_source,
    status,
    extension_version,
    search_terms_snapshot,
    runner_strategy,
    last_heartbeat_at
  ) VALUES (
    p_execution_id,
    p_users_id,
    p_installation_id,
    p_branches_id,
    p_branch_name,
    p_states_id,
    p_requested_cities_id,
    p_city_mode,
    p_requested_days,
    p_extraction_mode,
    p_target_phone_whatsapp,
    p_target_instagram,
    p_target_phone_whatsapp + p_target_instagram,
    p_target_source,
    'pending',
    p_extension_version,
    p_search_terms_snapshot,
    p_runner_strategy,
    now()
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.create_maps_search_execution_v2(
  uuid,bigint,uuid,bigint,text,bigint,bigint,text,smallint,text,integer,integer,text,text,jsonb,jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_maps_search_execution_v2(
  uuid,bigint,uuid,bigint,text,bigint,bigint,text,smallint,text,integer,integer,text,text,jsonb,jsonb
) TO service_role;

COMMIT;
