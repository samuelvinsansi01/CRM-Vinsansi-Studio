BEGIN;

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

DO $migration$
DECLARE
  v_policy record;
BEGIN
  FOR v_policy IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'users'
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.users',
      v_policy.policyname
    );
  END LOOP;
END;
$migration$;

CREATE POLICY users_select_own
ON public.users
FOR SELECT
TO authenticated
USING (
  auth_user_id = auth.uid()
);

CREATE POLICY users_own_update
ON public.users
FOR UPDATE
TO authenticated
USING (
  auth_user_id = auth.uid()
)
WITH CHECK (
  auth_user_id = auth.uid()
);

COMMIT;
