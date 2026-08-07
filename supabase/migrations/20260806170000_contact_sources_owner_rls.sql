BEGIN;

ALTER TABLE public.contact_sources ENABLE ROW LEVEL SECURITY;

-- Remove every permissive path currently attached to this table, including
-- the historical authenticated SELECT policy with USING (true). The four
-- owner-only policies are recreated below with their established names.
DROP POLICY IF EXISTS "authenticated can read contact sources"
ON public.contact_sources;

DO $migration$
DECLARE
  v_policy record;
BEGIN
  FOR v_policy IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'contact_sources'
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.contact_sources',
      v_policy.policyname
    );
  END LOOP;
END;
$migration$;

CREATE POLICY contact_sources_own_select
ON public.contact_sources
AS PERMISSIVE
FOR SELECT
TO authenticated
USING (
  users_id = (
    SELECT u.users_id
    FROM public.users AS u
    WHERE u.auth_user_id = auth.uid()
    LIMIT 1
  )
);

CREATE POLICY contact_sources_own_insert
ON public.contact_sources
AS PERMISSIVE
FOR INSERT
TO authenticated
WITH CHECK (
  users_id = (
    SELECT u.users_id
    FROM public.users AS u
    WHERE u.auth_user_id = auth.uid()
    LIMIT 1
  )
);

CREATE POLICY contact_sources_own_update
ON public.contact_sources
AS PERMISSIVE
FOR UPDATE
TO authenticated
USING (
  users_id = (
    SELECT u.users_id
    FROM public.users AS u
    WHERE u.auth_user_id = auth.uid()
    LIMIT 1
  )
)
WITH CHECK (
  users_id = (
    SELECT u.users_id
    FROM public.users AS u
    WHERE u.auth_user_id = auth.uid()
    LIMIT 1
  )
);

CREATE POLICY contact_sources_own_delete
ON public.contact_sources
AS PERMISSIVE
FOR DELETE
TO authenticated
USING (
  users_id = (
    SELECT u.users_id
    FROM public.users AS u
    WHERE u.auth_user_id = auth.uid()
    LIMIT 1
  )
);

-- service_role keeps explicit table privileges and its PostgreSQL BYPASSRLS
-- behavior. No authenticated global policy is required for service access.
GRANT SELECT, INSERT, UPDATE, DELETE
ON TABLE public.contact_sources
TO service_role;

COMMIT;
