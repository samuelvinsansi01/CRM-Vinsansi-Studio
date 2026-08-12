BEGIN;

-- The canonical catalog marks every base table as RLS-enabled. These ALTERs are
-- idempotent and do not replace any policy created by a later migration.
DO $rls$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'apify_accounts', 'apify_import_jobs', 'branches', 'channels', 'chips',
    'cities', 'contact_sources', 'countries', 'import_rules', 'instances',
    'lead_status', 'lead_validation_attempts', 'lead_validation_results',
    'leads', 'levels', 'queue_items', 'queues', 'sents', 'socials', 'states',
    'status', 'template_channels', 'template_types', 'template_variables',
    'templates', 'users', 'validation_rules'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
  END LOOP;
END
$rls$;

-- users, contact_sources and sents are intentionally absent from this list:
-- their complete policy sets are owned by the newer security migrations.
-- The validation ledger receives only the read policies compatible with its
-- newer append-only grants; no authenticated DML policy is restored.
DO $policies$
DECLARE
  expected record;
  current_policy record;
  create_statement text;
  actual_using text;
  actual_check text;
  expected_using text;
  expected_check text;
BEGIN
  FOR expected IN
    SELECT *
    FROM (VALUES
      ('apify_accounts', 'apify_accounts_own_select', 'SELECT', '(users_id = ( SELECT u.users_id FROM users u WHERE (u.auth_user_id = auth.uid()) LIMIT 1))', NULL),
      ('apify_accounts', 'apify_accounts_secure_select', 'SELECT', '(users_id = ensure_current_user())', NULL),
      ('apify_import_jobs', 'apify_import_jobs_own_delete', 'DELETE', '(users_id = ( SELECT u.users_id FROM users u WHERE (u.auth_user_id = auth.uid()) LIMIT 1))', NULL),
      ('apify_import_jobs', 'apify_import_jobs_own_insert', 'INSERT', NULL, '(users_id = ( SELECT u.users_id FROM users u WHERE (u.auth_user_id = auth.uid()) LIMIT 1))'),
      ('apify_import_jobs', 'apify_import_jobs_own_select', 'SELECT', '(users_id = ( SELECT u.users_id FROM users u WHERE (u.auth_user_id = auth.uid()) LIMIT 1))', NULL),
      ('apify_import_jobs', 'apify_import_jobs_own_update', 'UPDATE', '(users_id = ( SELECT u.users_id FROM users u WHERE (u.auth_user_id = auth.uid()) LIMIT 1))', '(users_id = ( SELECT u.users_id FROM users u WHERE (u.auth_user_id = auth.uid()) LIMIT 1))'),
      ('branches', 'branches_own_delete', 'DELETE', '(users_id = ( SELECT u.users_id FROM users u WHERE (u.auth_user_id = auth.uid()) LIMIT 1))', NULL),
      ('branches', 'branches_own_insert', 'INSERT', NULL, '(users_id = ( SELECT u.users_id FROM users u WHERE (u.auth_user_id = auth.uid()) LIMIT 1))'),
      ('branches', 'branches_own_select', 'SELECT', '(users_id = ( SELECT u.users_id FROM users u WHERE (u.auth_user_id = auth.uid()) LIMIT 1))', NULL),
      ('branches', 'branches_own_update', 'UPDATE', '(users_id = ( SELECT u.users_id FROM users u WHERE (u.auth_user_id = auth.uid()) LIMIT 1))', '(users_id = ( SELECT u.users_id FROM users u WHERE (u.auth_user_id = auth.uid()) LIMIT 1))'),
      ('channels', 'authenticated can read channels', 'SELECT', 'true', NULL),
      ('channels', 'channels_authenticated_read', 'SELECT', 'true', NULL),
      ('chips', 'chips_own_delete', 'DELETE', '(users_id = ( SELECT u.users_id FROM users u WHERE (u.auth_user_id = auth.uid()) LIMIT 1))', NULL),
      ('chips', 'chips_own_insert', 'INSERT', NULL, '(users_id = ( SELECT u.users_id FROM users u WHERE (u.auth_user_id = auth.uid()) LIMIT 1))'),
      ('chips', 'chips_own_select', 'SELECT', '(users_id = ( SELECT u.users_id FROM users u WHERE (u.auth_user_id = auth.uid()) LIMIT 1))', NULL),
      ('chips', 'chips_own_update', 'UPDATE', '(users_id = ( SELECT u.users_id FROM users u WHERE (u.auth_user_id = auth.uid()) LIMIT 1))', '(users_id = ( SELECT u.users_id FROM users u WHERE (u.auth_user_id = auth.uid()) LIMIT 1))'),
      ('cities', 'authenticated can read cities', 'SELECT', 'true', NULL),
      ('cities', 'cities_authenticated_read', 'SELECT', 'true', NULL),
      ('countries', 'authenticated can read countries', 'SELECT', 'true', NULL),
      ('countries', 'countries_authenticated_read', 'SELECT', 'true', NULL),
      ('import_rules', 'import_rules_delete_own', 'DELETE', '(users_id = ( SELECT u.users_id FROM users u WHERE (u.auth_user_id = auth.uid()) LIMIT 1))', NULL),
      ('import_rules', 'import_rules_insert_own', 'INSERT', NULL, '(users_id = ( SELECT u.users_id FROM users u WHERE (u.auth_user_id = auth.uid()) LIMIT 1))'),
      ('import_rules', 'import_rules_select_own', 'SELECT', '(users_id = ( SELECT u.users_id FROM users u WHERE (u.auth_user_id = auth.uid()) LIMIT 1))', NULL),
      ('import_rules', 'import_rules_update_own', 'UPDATE', '(users_id = ( SELECT u.users_id FROM users u WHERE (u.auth_user_id = auth.uid()) LIMIT 1))', '(users_id = ( SELECT u.users_id FROM users u WHERE (u.auth_user_id = auth.uid()) LIMIT 1))'),
      ('instances', 'instances_own_select', 'SELECT', '(users_id = ( SELECT u.users_id FROM users u WHERE (u.auth_user_id = auth.uid()) LIMIT 1))', NULL),
      ('instances', 'instances_secure_select', 'SELECT', '(users_id = ensure_current_user())', NULL),
      ('lead_status', 'authenticated can read lead status', 'SELECT', 'true', NULL),
      ('lead_status', 'lead_status_authenticated_read', 'SELECT', 'true', NULL),
      ('lead_validation_attempts', 'lead_validation_attempts_select_own', 'SELECT', '(users_id = ( SELECT u.users_id FROM users u WHERE (u.auth_user_id = auth.uid()) LIMIT 1))', NULL),
      ('lead_validation_results', 'lead_validation_results_authenticated_read', 'SELECT', 'true', NULL),
      ('leads', 'users can insert own leads', 'INSERT', NULL, '(users_id = ( SELECT u.users_id FROM users u WHERE (u.auth_user_id = auth.uid()) LIMIT 1))'),
      ('leads', 'users can select own leads', 'SELECT', '(users_id = ( SELECT u.users_id FROM users u WHERE (u.auth_user_id = auth.uid()) LIMIT 1))', NULL),
      ('leads', 'users can update own leads', 'UPDATE', '(users_id = ( SELECT u.users_id FROM users u WHERE (u.auth_user_id = auth.uid()) LIMIT 1))', '(users_id = ( SELECT u.users_id FROM users u WHERE (u.auth_user_id = auth.uid()) LIMIT 1))'),
      ('levels', 'levels_own_delete', 'DELETE', '(users_id = ( SELECT u.users_id FROM users u WHERE (u.auth_user_id = auth.uid()) LIMIT 1))', NULL),
      ('levels', 'levels_own_insert', 'INSERT', NULL, '(users_id = ( SELECT u.users_id FROM users u WHERE (u.auth_user_id = auth.uid()) LIMIT 1))'),
      ('levels', 'levels_own_select', 'SELECT', '(users_id = ( SELECT u.users_id FROM users u WHERE (u.auth_user_id = auth.uid()) LIMIT 1))', NULL),
      ('levels', 'levels_own_update', 'UPDATE', '(users_id = ( SELECT u.users_id FROM users u WHERE (u.auth_user_id = auth.uid()) LIMIT 1))', '(users_id = ( SELECT u.users_id FROM users u WHERE (u.auth_user_id = auth.uid()) LIMIT 1))'),
      ('queue_items', 'queue_items_own_delete', 'DELETE', '(users_id = ( SELECT u.users_id FROM users u WHERE (u.auth_user_id = auth.uid()) LIMIT 1))', NULL),
      ('queue_items', 'queue_items_own_select', 'SELECT', '(users_id = ( SELECT u.users_id FROM users u WHERE (u.auth_user_id = auth.uid()) LIMIT 1))', NULL),
      ('queue_items', 'queue_items_own_update', 'UPDATE', '(users_id = ( SELECT u.users_id FROM users u WHERE (u.auth_user_id = auth.uid()) LIMIT 1))', '(users_id = ( SELECT u.users_id FROM users u WHERE (u.auth_user_id = auth.uid()) LIMIT 1))'),
      ('queues', 'queues_own_delete', 'DELETE', '(users_id = ( SELECT u.users_id FROM users u WHERE (u.auth_user_id = auth.uid()) LIMIT 1))', NULL),
      ('queues', 'queues_own_select', 'SELECT', '(users_id = ( SELECT u.users_id FROM users u WHERE (u.auth_user_id = auth.uid()) LIMIT 1))', NULL),
      ('queues', 'queues_own_update', 'UPDATE', '(users_id = ( SELECT u.users_id FROM users u WHERE (u.auth_user_id = auth.uid()) LIMIT 1))', '(users_id = ( SELECT u.users_id FROM users u WHERE (u.auth_user_id = auth.uid()) LIMIT 1))'),
      ('socials', 'socials_own_delete', 'DELETE', '(users_id = ( SELECT u.users_id FROM users u WHERE (u.auth_user_id = auth.uid()) LIMIT 1))', NULL),
      ('socials', 'socials_own_insert', 'INSERT', NULL, '(users_id = ( SELECT u.users_id FROM users u WHERE (u.auth_user_id = auth.uid()) LIMIT 1))'),
      ('socials', 'socials_own_select', 'SELECT', '(users_id = ( SELECT u.users_id FROM users u WHERE (u.auth_user_id = auth.uid()) LIMIT 1))', NULL),
      ('socials', 'socials_own_update', 'UPDATE', '(users_id = ( SELECT u.users_id FROM users u WHERE (u.auth_user_id = auth.uid()) LIMIT 1))', '(users_id = ( SELECT u.users_id FROM users u WHERE (u.auth_user_id = auth.uid()) LIMIT 1))'),
      ('states', 'authenticated can read states', 'SELECT', 'true', NULL),
      ('states', 'states_authenticated_read', 'SELECT', 'true', NULL),
      ('status', 'status_authenticated_read', 'SELECT', 'true', NULL),
      ('template_channels', 'template_channels_own_delete', 'DELETE', '(users_id = ( SELECT u.users_id FROM users u WHERE (u.auth_user_id = auth.uid()) LIMIT 1))', NULL),
      ('template_channels', 'template_channels_own_insert', 'INSERT', NULL, '(users_id = ( SELECT u.users_id FROM users u WHERE (u.auth_user_id = auth.uid()) LIMIT 1))'),
      ('template_channels', 'template_channels_own_select', 'SELECT', '(users_id = ( SELECT u.users_id FROM users u WHERE (u.auth_user_id = auth.uid()) LIMIT 1))', NULL),
      ('template_channels', 'template_channels_own_update', 'UPDATE', '(users_id = ( SELECT u.users_id FROM users u WHERE (u.auth_user_id = auth.uid()) LIMIT 1))', '(users_id = ( SELECT u.users_id FROM users u WHERE (u.auth_user_id = auth.uid()) LIMIT 1))'),
      ('template_types', 'template_types_own_delete', 'DELETE', '(users_id = ( SELECT u.users_id FROM users u WHERE (u.auth_user_id = auth.uid()) LIMIT 1))', NULL),
      ('template_types', 'template_types_own_insert', 'INSERT', NULL, '(users_id = ( SELECT u.users_id FROM users u WHERE (u.auth_user_id = auth.uid()) LIMIT 1))'),
      ('template_types', 'template_types_own_select', 'SELECT', '(users_id = ( SELECT u.users_id FROM users u WHERE (u.auth_user_id = auth.uid()) LIMIT 1))', NULL),
      ('template_types', 'template_types_own_update', 'UPDATE', '(users_id = ( SELECT u.users_id FROM users u WHERE (u.auth_user_id = auth.uid()) LIMIT 1))', '(users_id = ( SELECT u.users_id FROM users u WHERE (u.auth_user_id = auth.uid()) LIMIT 1))'),
      ('template_variables', 'template_variables_own_delete', 'DELETE', '(users_id = ( SELECT u.users_id FROM users u WHERE (u.auth_user_id = auth.uid()) LIMIT 1))', NULL),
      ('template_variables', 'template_variables_own_insert', 'INSERT', NULL, '(users_id = ( SELECT u.users_id FROM users u WHERE (u.auth_user_id = auth.uid()) LIMIT 1))'),
      ('template_variables', 'template_variables_own_select', 'SELECT', '(users_id = ( SELECT u.users_id FROM users u WHERE (u.auth_user_id = auth.uid()) LIMIT 1))', NULL),
      ('template_variables', 'template_variables_own_update', 'UPDATE', '(users_id = ( SELECT u.users_id FROM users u WHERE (u.auth_user_id = auth.uid()) LIMIT 1))', '(users_id = ( SELECT u.users_id FROM users u WHERE (u.auth_user_id = auth.uid()) LIMIT 1))'),
      ('templates', 'templates_own_delete', 'DELETE', '(users_id = ( SELECT u.users_id FROM users u WHERE (u.auth_user_id = auth.uid()) LIMIT 1))', NULL),
      ('templates', 'templates_own_insert', 'INSERT', NULL, '(users_id = ( SELECT u.users_id FROM users u WHERE (u.auth_user_id = auth.uid()) LIMIT 1))'),
      ('templates', 'templates_own_select', 'SELECT', '(users_id = ( SELECT u.users_id FROM users u WHERE (u.auth_user_id = auth.uid()) LIMIT 1))', NULL),
      ('templates', 'templates_own_update', 'UPDATE', '(users_id = ( SELECT u.users_id FROM users u WHERE (u.auth_user_id = auth.uid()) LIMIT 1))', '(users_id = ( SELECT u.users_id FROM users u WHERE (u.auth_user_id = auth.uid()) LIMIT 1))'),
      ('validation_rules', 'validation_rules_delete_own', 'DELETE', '(users_id = ( SELECT u.users_id FROM users u WHERE (u.auth_user_id = auth.uid()) LIMIT 1))', NULL),
      ('validation_rules', 'validation_rules_insert_own', 'INSERT', NULL, '((users_id = ( SELECT u.users_id FROM users u WHERE (u.auth_user_id = auth.uid()) LIMIT 1)) AND (EXISTS ( SELECT 1 FROM contact_sources cs WHERE ((cs.contact_sources_id = validation_rules.validation_rules_source_id) AND (cs.users_id = validation_rules.users_id)))))'),
      ('validation_rules', 'validation_rules_select_own', 'SELECT', '(users_id = ( SELECT u.users_id FROM users u WHERE (u.auth_user_id = auth.uid()) LIMIT 1))', NULL),
      ('validation_rules', 'validation_rules_update_own', 'UPDATE', '(users_id = ( SELECT u.users_id FROM users u WHERE (u.auth_user_id = auth.uid()) LIMIT 1))', '((users_id = ( SELECT u.users_id FROM users u WHERE (u.auth_user_id = auth.uid()) LIMIT 1)) AND (EXISTS ( SELECT 1 FROM contact_sources cs WHERE ((cs.contact_sources_id = validation_rules.validation_rules_source_id) AND (cs.users_id = validation_rules.users_id)))))')
    ) AS canonical(table_name, policy_name, command_name, using_expression, check_expression)
  LOOP
    SELECT p.permissive, p.roles, p.cmd, p.qual, p.with_check
      INTO current_policy
      FROM pg_policies p
     WHERE p.schemaname = 'public'
       AND p.tablename = expected.table_name
       AND p.policyname = expected.policy_name;

    IF FOUND THEN
      actual_using := regexp_replace(lower(replace(coalesce(current_policy.qual, ''), 'public.', '')), '[[:space:]()]', '', 'g');
      actual_check := regexp_replace(lower(replace(coalesce(current_policy.with_check, ''), 'public.', '')), '[[:space:]()]', '', 'g');
      expected_using := regexp_replace(lower(replace(coalesce(expected.using_expression, ''), 'public.', '')), '[[:space:]()]', '', 'g');
      expected_check := regexp_replace(lower(replace(coalesce(expected.check_expression, ''), 'public.', '')), '[[:space:]()]', '', 'g');

      IF upper(current_policy.permissive) <> 'PERMISSIVE'
         OR current_policy.roles <> ARRAY['authenticated']::name[]
         OR upper(current_policy.cmd) <> expected.command_name
         OR actual_using <> expected_using
         OR actual_check <> expected_check THEN
        RAISE EXCEPTION
          'Policy public.%.% exists with a definition different from the canonical contract',
          expected.table_name,
          expected.policy_name;
      END IF;
    ELSE
      create_statement := format(
        'CREATE POLICY %I ON public.%I AS PERMISSIVE FOR %s TO authenticated',
        expected.policy_name,
        expected.table_name,
        expected.command_name
      );

      IF expected.using_expression IS NOT NULL THEN
        create_statement := create_statement || format(' USING (%s)', expected.using_expression);
      END IF;
      IF expected.check_expression IS NOT NULL THEN
        create_statement := create_statement || format(' WITH CHECK (%s)', expected.check_expression);
      END IF;

      EXECUTE create_statement;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
      FROM pg_policies p
     WHERE p.schemaname = 'public'
       AND p.tablename = ANY (ARRAY[
         'apify_accounts', 'apify_import_jobs', 'branches', 'chips',
         'contact_sources', 'import_rules', 'instances',
         'lead_validation_attempts', 'leads', 'levels', 'queue_items',
         'queues', 'sents', 'socials', 'template_channels', 'template_types',
         'template_variables', 'templates', 'users', 'validation_rules'
       ])
       AND p.roles @> ARRAY['authenticated']::name[]
       AND (
         regexp_replace(lower(coalesce(p.qual, '')), '[[:space:]()]', '', 'g') = 'true'
         OR regexp_replace(lower(coalesce(p.with_check, '')), '[[:space:]()]', '', 'g') = 'true'
       )
  ) THEN
    RAISE EXCEPTION 'An authenticated policy is globally permissive on an owner-scoped base table';
  END IF;
END
$policies$;

COMMIT;
