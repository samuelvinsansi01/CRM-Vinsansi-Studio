BEGIN;

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS leads_whatsapp text;

CREATE TABLE IF NOT EXISTS public.maps_extension_installations (
  maps_extension_installations_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  users_id bigint NOT NULL REFERENCES public.users(users_id),
  extension_type text NOT NULL CHECK (extension_type = 'google_maps'),
  installation_id text NOT NULL CHECK (length(installation_id) BETWEEN 16 AND 200),
  scopes text[] NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  UNIQUE (users_id, extension_type, installation_id)
);

CREATE TABLE IF NOT EXISTS public.maps_extension_pairings (
  maps_extension_pairings_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  users_id bigint REFERENCES public.users(users_id),
  installation_id text NOT NULL CHECK (length(installation_id) BETWEEN 16 AND 200),
  pairing_secret_hash text NOT NULL CHECK (length(pairing_secret_hash) = 64),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','authorized','consumed','expired','revoked')),
  expires_at timestamptz NOT NULL,
  authorized_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'pending' AND users_id IS NULL) OR status <> 'pending')
);

CREATE TABLE IF NOT EXISTS public.maps_search_executions (
  maps_search_executions_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  users_id bigint NOT NULL REFERENCES public.users(users_id),
  maps_extension_installations_id uuid NOT NULL REFERENCES public.maps_extension_installations(maps_extension_installations_id),
  branches_id bigint NOT NULL REFERENCES public.branches(branches_id),
  branch_name text NOT NULL,
  states_id bigint NOT NULL REFERENCES public.states(states_id),
  requested_cities_id bigint REFERENCES public.cities(cities_id),
  city_mode text NOT NULL CHECK (city_mode IN ('automatic','manual')),
  requested_days smallint NOT NULL CHECK (requested_days BETWEEN 1 AND 7),
  extraction_mode text NOT NULL CHECK (extraction_mode IN ('quick','complete')),
  target_phone_whatsapp integer NOT NULL CHECK (target_phone_whatsapp >= 0),
  target_instagram integer NOT NULL CHECK (target_instagram >= 0),
  found_count integer NOT NULL DEFAULT 0 CHECK (found_count >= 0),
  unique_count integer NOT NULL DEFAULT 0 CHECK (unique_count >= 0),
  eligible_count integer NOT NULL DEFAULT 0 CHECK (eligible_count >= 0),
  duplicate_count integer NOT NULL DEFAULT 0 CHECK (duplicate_count >= 0),
  rejected_count integer NOT NULL DEFAULT 0 CHECK (rejected_count >= 0),
  phone_whatsapp_candidate_count integer NOT NULL DEFAULT 0 CHECK (phone_whatsapp_candidate_count >= 0),
  instagram_candidate_count integer NOT NULL DEFAULT 0 CHECK (instagram_candidate_count >= 0),
  promoted_leads_count integer NOT NULL DEFAULT 0 CHECK (promoted_leads_count >= 0),
  status text NOT NULL CHECK (status IN ('pending','running','paused','completed','exhausted','error','stopped')),
  extension_version text NOT NULL,
  search_terms_snapshot jsonb NOT NULL CHECK (jsonb_typeof(search_terms_snapshot) = 'array'),
  runner_strategy jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(runner_strategy) = 'object'),
  termination_reason text,
  last_error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.maps_search_coverage (
  maps_search_coverage_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  users_id bigint NOT NULL REFERENCES public.users(users_id),
  maps_search_executions_id uuid NOT NULL REFERENCES public.maps_search_executions(maps_search_executions_id),
  branches_id bigint NOT NULL REFERENCES public.branches(branches_id),
  states_id bigint NOT NULL REFERENCES public.states(states_id),
  cities_id bigint NOT NULL REFERENCES public.cities(cities_id),
  branch_name text NOT NULL,
  state_name text NOT NULL,
  state_code text NOT NULL,
  city_name text NOT NULL,
  search_term text NOT NULL,
  normalized_search_term text NOT NULL,
  term_position smallint NOT NULL CHECK (term_position >= 1),
  search_query text NOT NULL,
  search_signature text,
  status text NOT NULL CHECK (status IN ('pending','navigating','waiting_maps_ready','running','scraping','finishing','syncing','completed','exhausted','error','stopped','paused')),
  found_count integer NOT NULL DEFAULT 0 CHECK (found_count >= 0),
  unique_count integer NOT NULL DEFAULT 0 CHECK (unique_count >= 0),
  eligible_count integer NOT NULL DEFAULT 0 CHECK (eligible_count >= 0),
  rejected_count integer NOT NULL DEFAULT 0 CHECK (rejected_count >= 0),
  duplicate_count integer NOT NULL DEFAULT 0 CHECK (duplicate_count >= 0),
  phone_whatsapp_candidate_count integer NOT NULL DEFAULT 0 CHECK (phone_whatsapp_candidate_count >= 0),
  instagram_candidate_count integer NOT NULL DEFAULT 0 CHECK (instagram_candidate_count >= 0),
  termination_reason text,
  last_error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (maps_search_executions_id, cities_id, normalized_search_term)
);

CREATE TABLE IF NOT EXISTS public.maps_search_candidates (
  maps_search_candidates_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  users_id bigint NOT NULL REFERENCES public.users(users_id),
  maps_search_executions_id uuid NOT NULL REFERENCES public.maps_search_executions(maps_search_executions_id),
  branches_id bigint NOT NULL REFERENCES public.branches(branches_id),
  states_id bigint NOT NULL REFERENCES public.states(states_id),
  cities_id bigint NOT NULL REFERENCES public.cities(cities_id),
  dedupe_key text NOT NULL,
  candidate_name text NOT NULL,
  maps_category text,
  search_terms_found jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(search_terms_found) = 'array'),
  maps_url text,
  raw_payload jsonb NOT NULL CHECK (jsonb_typeof(raw_payload) = 'object'),
  effective_phone text,
  effective_whatsapp text,
  effective_instagram text,
  effective_website text,
  website_classification text CHECK (website_classification IS NULL OR website_classification IN ('sem_site','dominio_proprio','agregador')),
  eligibility_status text NOT NULL CHECK (eligibility_status IN ('ready_to_save','no_supported_contact','invalid_contact')),
  eligibility_reason text,
  edited_by_user boolean NOT NULL DEFAULT false,
  excluded_by_user boolean NOT NULL DEFAULT false,
  promoted_leads_id bigint REFERENCES public.leads(leads_id),
  promoted_at timestamptz,
  sync_status text NOT NULL DEFAULT 'synced' CHECK (sync_status IN ('pending','synced','error')),
  collected_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (maps_search_executions_id, dedupe_key)
);

CREATE TABLE IF NOT EXISTS public.maps_search_batches (
  maps_search_batches_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  users_id bigint NOT NULL REFERENCES public.users(users_id),
  maps_search_executions_id uuid NOT NULL REFERENCES public.maps_search_executions(maps_search_executions_id),
  batch_id text NOT NULL,
  payload_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('processing','confirmed','error')),
  response_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  UNIQUE (maps_search_executions_id, batch_id)
);

CREATE TABLE IF NOT EXISTS public.maps_search_snapshots (
  maps_search_snapshots_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  users_id bigint NOT NULL REFERENCES public.users(users_id),
  maps_search_executions_id uuid NOT NULL REFERENCES public.maps_search_executions(maps_search_executions_id),
  maps_search_coverage_id uuid NOT NULL REFERENCES public.maps_search_coverage(maps_search_coverage_id),
  snapshot_payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (maps_search_coverage_id)
);

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS maps_search_candidates_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.leads'::regclass
      AND conname = 'leads_maps_search_candidates_id_fkey'
  ) THEN
    ALTER TABLE public.leads
      ADD CONSTRAINT leads_maps_search_candidates_id_fkey
      FOREIGN KEY (maps_search_candidates_id)
      REFERENCES public.maps_search_candidates(maps_search_candidates_id);
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS leads_maps_search_candidates_id_unique
  ON public.leads (maps_search_candidates_id)
  WHERE maps_search_candidates_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS maps_extension_pairings_expiry_idx ON public.maps_extension_pairings (status, expires_at);
CREATE INDEX IF NOT EXISTS maps_search_executions_owner_created_idx ON public.maps_search_executions (users_id, created_at DESC);
CREATE INDEX IF NOT EXISTS maps_search_coverage_next_idx ON public.maps_search_coverage (users_id, branches_id, states_id, cities_id, normalized_search_term, status);
CREATE INDEX IF NOT EXISTS maps_search_candidates_execution_idx ON public.maps_search_candidates (users_id, maps_search_executions_id, excluded_by_user, promoted_leads_id);
CREATE INDEX IF NOT EXISTS maps_search_candidates_promoted_idx ON public.maps_search_candidates (promoted_leads_id) WHERE promoted_leads_id IS NOT NULL;

ALTER TABLE public.maps_extension_installations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maps_extension_pairings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maps_search_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maps_search_coverage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maps_search_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maps_search_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maps_search_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY maps_extension_installations_own_select ON public.maps_extension_installations FOR SELECT TO authenticated
USING (users_id = (SELECT u.users_id FROM public.users u WHERE u.auth_user_id = auth.uid() LIMIT 1));
CREATE POLICY maps_search_executions_own_select ON public.maps_search_executions FOR SELECT TO authenticated
USING (users_id = (SELECT u.users_id FROM public.users u WHERE u.auth_user_id = auth.uid() LIMIT 1));
CREATE POLICY maps_search_coverage_own_select ON public.maps_search_coverage FOR SELECT TO authenticated
USING (users_id = (SELECT u.users_id FROM public.users u WHERE u.auth_user_id = auth.uid() LIMIT 1));
CREATE POLICY maps_search_candidates_own_select ON public.maps_search_candidates FOR SELECT TO authenticated
USING (users_id = (SELECT u.users_id FROM public.users u WHERE u.auth_user_id = auth.uid() LIMIT 1));
CREATE POLICY maps_search_batches_own_select ON public.maps_search_batches FOR SELECT TO authenticated
USING (users_id = (SELECT u.users_id FROM public.users u WHERE u.auth_user_id = auth.uid() LIMIT 1));
CREATE POLICY maps_search_snapshots_own_select ON public.maps_search_snapshots FOR SELECT TO authenticated
USING (users_id = (SELECT u.users_id FROM public.users u WHERE u.auth_user_id = auth.uid() LIMIT 1));

REVOKE ALL PRIVILEGES ON TABLE
  public.maps_extension_installations,
  public.maps_extension_pairings,
  public.maps_search_executions,
  public.maps_search_coverage,
  public.maps_search_candidates,
  public.maps_search_batches,
  public.maps_search_snapshots
FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE
  public.maps_extension_installations,
  public.maps_search_executions,
  public.maps_search_coverage,
  public.maps_search_candidates,
  public.maps_search_batches,
  public.maps_search_snapshots
TO authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE
  public.maps_extension_installations,
  public.maps_extension_pairings,
  public.maps_search_executions,
  public.maps_search_coverage,
  public.maps_search_candidates,
  public.maps_search_batches,
  public.maps_search_snapshots
TO service_role;

REVOKE DELETE, TRUNCATE ON TABLE
  public.maps_extension_installations,
  public.maps_extension_pairings,
  public.maps_search_executions,
  public.maps_search_coverage,
  public.maps_search_candidates,
  public.maps_search_batches,
  public.maps_search_snapshots
FROM service_role;

COMMIT;
