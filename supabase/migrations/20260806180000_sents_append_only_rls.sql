BEGIN;

ALTER TABLE public.sents ENABLE ROW LEVEL SECURITY;

-- Remove every historical policy from sents before recreating the single
-- authenticated read path. Policy names are treated as identifiers.
DO $migration$
DECLARE
  v_policy record;
BEGIN
  FOR v_policy IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'sents'
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.sents',
      v_policy.policyname
    );
  END LOOP;
END;
$migration$;

CREATE POLICY sents_own_select
ON public.sents
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

REVOKE ALL PRIVILEGES ON TABLE public.sents FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.sents TO authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE public.sents TO service_role;
REVOKE DELETE, TRUNCATE ON TABLE public.sents FROM service_role;

COMMIT;
