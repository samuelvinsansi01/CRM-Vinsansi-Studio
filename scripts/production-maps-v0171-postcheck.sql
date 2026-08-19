-- SOMENTE LEITURA. Verifica o contrato de banco exigido pelo Maps v0.17.1.
WITH checks AS (
  SELECT jsonb_build_object(
    'googleMapsOriginAllowed', EXISTS (
      SELECT 1
      FROM pg_constraint c
      WHERE c.conrelid = 'public.leads'::regclass
        AND c.conname = 'leads_origin_check'
        AND pg_get_constraintdef(c.oid) LIKE '%google_maps%'
    ),
    'leadsPriorityScore', EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'leads' AND column_name = 'leads_priority_score'
    ),
    'executionTargetUnique', EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'maps_search_executions' AND column_name = 'target_unique'
    ),
    'executionHeartbeat', EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'maps_search_executions' AND column_name = 'last_heartbeat_at'
    ),
    'candidateBucket', EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'maps_search_candidates' AND column_name = 'acquisition_bucket'
    ),
    'candidateRating', EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'maps_search_candidates' AND column_name = 'maps_rating'
    ),
    'candidateReviews', EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'maps_search_candidates' AND column_name = 'maps_reviews_count'
    ),
    'candidateBusinessStatus', EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'maps_search_candidates' AND column_name = 'business_status'
    ),
    'candidateCoverageProvenance', EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'maps_search_candidates' AND column_name = 'coverage_ids_found'
    ),
    'atomicCreateRpc', to_regprocedure('public.create_maps_search_execution_v2(uuid,bigint,uuid,bigint,text,bigint,bigint,text,smallint,text,integer,integer,text,text,jsonb,jsonb)') IS NOT NULL
  ) AS result
)
SELECT result || jsonb_build_object(
  'readyForMapsV0171',
  (result->>'googleMapsOriginAllowed')::boolean
  AND (result->>'leadsPriorityScore')::boolean
  AND (result->>'executionTargetUnique')::boolean
  AND (result->>'executionHeartbeat')::boolean
  AND (result->>'candidateBucket')::boolean
  AND (result->>'candidateRating')::boolean
  AND (result->>'candidateReviews')::boolean
  AND (result->>'candidateBusinessStatus')::boolean
  AND (result->>'candidateCoverageProvenance')::boolean
  AND (result->>'atomicCreateRpc')::boolean
) AS maps_v0171_postcheck
FROM checks;
