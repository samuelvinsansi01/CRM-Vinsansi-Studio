-- PRE-FLIGHT READ-ONLY DE PRODUCAO.
-- Execute como uma unica consulta no SQL Editor e copie a unica celula JSONB.
-- A leitura dinamica do ledger usa query_to_xml apenas com uma consulta SELECT
-- e somente quando uma tabela de historico compativel e legivel for encontrada.
WITH
expected_migrations(version, migration_name, position) AS (
  VALUES
    ('20260730171000', '20260730171000_user_profile', 1),
    ('20260802070000', '20260802070000_atomic_queue_preparation', 2),
    ('20260802080000', '20260802080000_queue_payload_snapshot', 3),
    ('20260802090000', '20260802090000_worker_persistence_idempotency', 4),
    ('20260802100000', '20260802100000_secure_credentials_integrations', 5),
    ('20260802110000', '20260802110000_centralized_operational_settings', 6),
    ('20260802120000', '20260802120000_persistent_audit_state_machine', 7),
    ('20260802130000', '20260802130000_identity_dedup_suppression', 8),
    ('20260802131000', '20260802131000_fix_instagram_identity_normalization', 9),
    ('20260802140000', '20260802140000_permanent_base_consolidation', 10),
    ('20260802150000', '20260802150000_instagram_execution_progress', 11),
    ('20260802160000', '20260802160000_schema_release_manifest', 12),
    ('20260802170000', '20260802170000_observability_recovery', 13),
    ('20260802180000', '20260802180000_chip_conversations_chat', 14),
    ('20260806110000', '20260806110000_preserve_whatsapp_batch_cadence', 15),
    ('20260806170000', '20260806170000_contact_sources_owner_rls', 16),
    ('20260806180000', '20260806180000_sents_append_only_rls', 17),
    ('20260806190000', '20260806190000_whatsapp_validation_proof', 18),
    ('20260807090000', '20260807090000_users_owner_rls', 19),
    ('20260807100000', '20260807100000_fix_operational_health_batch_status', 20),
    ('20260812100000', '20260812100000_restore_bootstrap_foreign_keys', 21),
    ('20260812110000', '20260812110000_restore_base_rls_policies', 22),
    ('20260812120000', '20260812120000_seed_canonical_locations', 23)
),
ledger_candidates AS (
  SELECT
    namespace.nspname AS schema_name,
    relation.relname AS table_name,
    relation.oid AS relation_oid,
    EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
      WHERE attribute.attrelid = relation.oid
        AND attribute.attname = 'version'
        AND attribute.attnum > 0
        AND NOT attribute.attisdropped
    ) AS has_version,
    EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
      WHERE attribute.attrelid = relation.oid
        AND attribute.attname = 'name'
        AND attribute.attnum > 0
        AND NOT attribute.attisdropped
    ) AS has_name,
    pg_catalog.has_table_privilege(relation.oid, 'SELECT') AS readable,
    CASE
      WHEN namespace.nspname = 'supabase_migrations' AND relation.relname = 'schema_migrations' THEN 1
      WHEN namespace.nspname = 'public' AND relation.relname = 'schema_migrations' THEN 2
      WHEN relation.relname = 'schema_migrations' THEN 3
      WHEN relation.relname = 'migrations' THEN 4
      ELSE 10
    END AS priority
  FROM pg_catalog.pg_class AS relation
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE relation.relkind IN ('r', 'p', 'v', 'm')
    AND relation.relname IN ('schema_migrations', 'migrations')
    AND namespace.nspname NOT IN ('pg_catalog', 'information_schema')
),
ledger_choice AS (
  SELECT candidate.*
  FROM ledger_candidates AS candidate
  WHERE candidate.has_version
    AND candidate.readable
  ORDER BY candidate.priority, candidate.schema_name, candidate.table_name
  LIMIT 1
),
ledger_xml AS (
  SELECT
    choice.schema_name,
    choice.table_name,
    pg_catalog.query_to_xml(
      pg_catalog.format(
        'SELECT version::text AS version, %s AS name FROM %I.%I ORDER BY version',
        CASE WHEN choice.has_name THEN 'name::text' ELSE 'NULL::text' END,
        choice.schema_name,
        choice.table_name
    ),
      false,
      false,
      ''
    ) AS document
  FROM ledger_choice AS choice
),
ledger_rows AS (
  SELECT
    ledger.schema_name,
    ledger.table_name,
    row_data.version,
    row_data.name
  FROM ledger_xml AS ledger
  CROSS JOIN LATERAL XMLTABLE(
    '/table/row'
    PASSING ledger.document
    COLUMNS
      version text PATH 'version',
      name text PATH 'name'
  ) AS row_data
),
expected_function_groups(group_name, function_name, required_identity_arguments, position) AS (
  VALUES
    ('compatibility', 'unaccent', 'text', 1),
    ('observability', 'get_operational_health', '', 2),
    ('atomic_queue', 'guard_queue_item_capacity', '', 3),
    ('atomic_queue', 'prepare_queue_items', 'text, bigint, date, jsonb', 4),
    ('atomic_queue', 'prepare_queue_items_without_whatsapp_validation_proof', 'text, bigint, date, jsonb', 5),
    ('whatsapp_validation', 'has_current_whatsapp_validation_proof', 'bigint, bigint', 6),
    ('whatsapp_validation', 'current_user_whatsapp_validation_proofs', 'bigint[]', 7),
    ('whatsapp_validation', 'record_whatsapp_validation_result', 'bigint, bigint, text, text, text, text, text, integer, text, text, jsonb', 8)
),
critical_functions AS (
  SELECT
    expected.group_name,
    expected.function_name,
    expected.required_identity_arguments,
    procedure.oid IS NOT NULL AS exists,
    COALESCE(pg_catalog.pg_get_function_identity_arguments(procedure.oid), '') AS actual_identity_arguments,
    language.lanname AS language,
    procedure.prosecdef AS security_definer,
    CASE procedure.provolatile WHEN 'i' THEN 'immutable' WHEN 's' THEN 'stable' WHEN 'v' THEN 'volatile' END AS volatility,
    CASE
      WHEN procedure.oid IS NULL THEN NULL
      ELSE left(regexp_replace(pg_catalog.pg_get_functiondef(procedure.oid), '[[:space:]]+', ' ', 'g'), 800)
    END AS definition_summary,
    expected.position
  FROM expected_function_groups AS expected
  LEFT JOIN pg_catalog.pg_proc AS procedure
    ON procedure.oid = pg_catalog.to_regprocedure(
      pg_catalog.format('public.%I(%s)', expected.function_name, expected.required_identity_arguments)
    )
  LEFT JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
),
expected_tables(group_name, table_name, position) AS (
  VALUES
    ('worker', 'worker_batches', 1),
    ('worker', 'worker_batch_items', 2),
    ('worker', 'queue_item_dispatch_parts', 3),
    ('identity', 'lead_identity_registry', 4),
    ('identity', 'contact_suppressions', 5),
    ('permanent_base', 'permanent_records', 6),
    ('permanent_base', 'permanent_record_snapshots', 7),
    ('instagram_progress', 'instagram_queue_progress', 8),
    ('instagram_progress', 'instagram_dispatch_events', 9),
    ('chat', 'conversations', 10),
    ('chat', 'conversation_messages', 11),
    ('chat', 'conversation_message_events', 12),
    ('chat', 'evolution_webhook_receipts', 13)
),
critical_tables AS (
  SELECT
    expected.group_name,
    expected.table_name,
    relation.oid IS NOT NULL AS exists,
    CASE relation.relkind
      WHEN 'r' THEN 'table'
      WHEN 'p' THEN 'partitioned_table'
      WHEN 'v' THEN 'view'
      WHEN 'm' THEN 'materialized_view'
      ELSE NULL
    END AS relation_kind,
    COALESCE(relation.relrowsecurity, false) AS rls_enabled,
    expected.position
  FROM expected_tables AS expected
  LEFT JOIN pg_catalog.pg_namespace AS namespace ON namespace.nspname = 'public'
  LEFT JOIN pg_catalog.pg_class AS relation
    ON relation.relnamespace = namespace.oid
   AND relation.relname = expected.table_name
   AND relation.relkind IN ('r', 'p', 'v', 'm')
),
critical_rls_tables(table_name, position) AS (
  VALUES
    ('users', 1),
    ('contact_sources', 2),
    ('sents', 3),
    ('lead_validation_attempts', 4),
    ('lead_validation_results', 5)
),
rls_inventory AS (
  SELECT
    expected.table_name,
    relation.oid IS NOT NULL AS exists,
    COALESCE(relation.relrowsecurity, false) AS rls_enabled,
    COALESCE(relation.relforcerowsecurity, false) AS rls_forced,
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'name', policy.policyname,
          'permissive', policy.permissive,
          'roles', policy.roles,
          'command', policy.cmd,
          'using', policy.qual,
          'withCheck', policy.with_check
        )
        ORDER BY policy.policyname
      )
      FROM pg_catalog.pg_policies AS policy
      WHERE policy.schemaname = 'public'
        AND policy.tablename = expected.table_name
    ), '[]'::jsonb) AS policies,
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'grantee', grant_row.grantee,
          'privilege', grant_row.privilege_type
        )
        ORDER BY grant_row.grantee, grant_row.privilege_type
      )
      FROM information_schema.role_table_grants AS grant_row
      WHERE grant_row.table_schema = 'public'
        AND grant_row.table_name = expected.table_name
        AND grant_row.grantee IN ('PUBLIC', 'anon', 'authenticated', 'service_role')
    ), '[]'::jsonb) AS grants,
    expected.position
  FROM critical_rls_tables AS expected
  LEFT JOIN pg_catalog.pg_namespace AS namespace ON namespace.nspname = 'public'
  LEFT JOIN pg_catalog.pg_class AS relation
    ON relation.relnamespace = namespace.oid
   AND relation.relname = expected.table_name
   AND relation.relkind IN ('r', 'p')
),
expected_foreign_keys(constraint_name, purpose, position) AS (
  VALUES
    ('leads_branches_id_fkey', 'manual_lead_branch', 1),
    ('leads_contact_sources_id_fkey', 'manual_lead_source', 2),
    ('leads_channels_id_fkey', 'manual_lead_channel', 3),
    ('leads_countries_id_fkey', 'manual_lead_country', 4),
    ('leads_states_id_fkey', 'manual_lead_state', 5),
    ('leads_cities_id_fkey', 'manual_lead_city', 6),
    ('leads_lead_status_id_fkey', 'manual_lead_status', 7),
    ('leads_users_id_fkey', 'manual_lead_owner', 8),
    ('contact_sources_default_channel_id_fkey', 'source_default_channel', 9),
    ('contact_sources_users_id_fkey', 'source_owner', 10),
    ('lead_validation_attempts_users_id_fkey', 'validation_owner', 11),
    ('lead_validation_attempts_leads_id_fkey', 'validation_lead', 12),
    ('lead_validation_attempts_channels_id_fkey', 'validation_channel', 13),
    ('lead_validation_attempts_chips_id_fkey', 'validation_chip', 14),
    ('lead_validation_attempts_queue_items_id_fkey', 'validation_queue_item', 15),
    ('lead_validation_attempts_result_id_fkey', 'validation_result', 16),
    ('lead_validation_attempts_status_id_fkey', 'validation_status', 17),
    ('lead_validation_attempts_validation_rules_id_fkey', 'validation_legacy_rule', 18),
    ('lead_validation_results_status_id_fkey', 'validation_result_status', 19)
),
foreign_key_inventory AS (
  SELECT
    expected.constraint_name,
    expected.purpose,
    constraint_row.oid IS NOT NULL AS exists,
    constraint_row.convalidated AS validated,
    CASE WHEN constraint_row.oid IS NULL THEN NULL ELSE pg_catalog.pg_get_constraintdef(constraint_row.oid) END AS definition,
    expected.position
  FROM expected_foreign_keys AS expected
  LEFT JOIN pg_catalog.pg_constraint AS constraint_row
    ON constraint_row.conname = expected.constraint_name
   AND constraint_row.contype = 'f'
   AND constraint_row.connamespace = 'public'::regnamespace
),
catalog_summary AS (
  SELECT jsonb_build_object(
    'channels', jsonb_build_object(
      'count', (SELECT count(*) FROM public.channels),
      'keys', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('id', channels_id, 'name', channels_name) ORDER BY channels_id)
        FROM public.channels
      ), '[]'::jsonb),
      'hasWhatsApp', EXISTS (SELECT 1 FROM public.channels WHERE lower(trim(channels_name)) = 'whatsapp'),
      'hasInstagram', EXISTS (SELECT 1 FROM public.channels WHERE lower(trim(channels_name)) = 'instagram')
    ),
    'contactSources', jsonb_build_object(
      'count', (SELECT count(*) FROM public.contact_sources),
      'distinctKeys', COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'key', grouped.contact_sources_key,
            'name', grouped.contact_sources_name,
            'defaultChannelId', grouped.contact_sources_default_channel_id,
            'tenantCount', grouped.tenant_count
          ) ORDER BY grouped.contact_sources_key
        )
        FROM (
          SELECT
            contact_sources_key,
            min(contact_sources_name) AS contact_sources_name,
            min(contact_sources_default_channel_id) AS contact_sources_default_channel_id,
            count(DISTINCT users_id) AS tenant_count
          FROM public.contact_sources
          GROUP BY contact_sources_key
        ) AS grouped
      ), '[]'::jsonb),
      'hasCanonicalKeys', NOT EXISTS (
        SELECT required.key
        FROM (VALUES ('sem_site'), ('dominio_proprio'), ('agregador'), ('instagram')) AS required(key)
        WHERE NOT EXISTS (
          SELECT 1 FROM public.contact_sources AS source
          WHERE source.contact_sources_key = required.key
        )
      ),
      'hasUnexpectedWhatsAppKey', EXISTS (
        SELECT 1 FROM public.contact_sources
        WHERE lower(trim(contact_sources_key)) = 'whatsapp'
      )
    ),
    'status', jsonb_build_object(
      'count', (SELECT count(*) FROM public.status),
      'keys', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('id', status_id, 'name', status_name) ORDER BY status_id)
        FROM public.status
      ), '[]'::jsonb)
    ),
    'leadStatus', jsonb_build_object(
      'count', (SELECT count(*) FROM public.lead_status),
      'keys', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('id', lead_status_id, 'name', lead_status_name) ORDER BY lead_status_id)
        FROM public.lead_status
      ), '[]'::jsonb)
    ),
    'locations', jsonb_build_object(
      'countries', (SELECT count(*) FROM public.countries),
      'states', (SELECT count(*) FROM public.states),
      'cities', (SELECT count(*) FROM public.cities),
      'brazil', COALESCE((
        SELECT jsonb_build_object(
          'id', country.countries_id,
          'name', country.countries_name,
          'code', country.countries_code,
          'states', (SELECT count(*) FROM public.states AS state WHERE state.countries_id = country.countries_id),
          'cities', (
            SELECT count(*)
            FROM public.cities AS city
            JOIN public.states AS state ON state.states_id = city.states_id
            WHERE state.countries_id = country.countries_id
          )
        )
        FROM public.countries AS country
        WHERE upper(trim(country.countries_code)) = 'BR'
           OR lower(trim(country.countries_name)) IN ('brasil', 'brazil')
        ORDER BY CASE WHEN upper(trim(country.countries_code)) = 'BR' THEN 0 ELSE 1 END, country.countries_id
        LIMIT 1
      ), 'null'::jsonb),
      'matchesExpectedBrazilCounts', EXISTS (
        SELECT 1
        FROM public.countries AS country
        WHERE (upper(trim(country.countries_code)) = 'BR' OR lower(trim(country.countries_name)) IN ('brasil', 'brazil'))
          AND (SELECT count(*) FROM public.states AS state WHERE state.countries_id = country.countries_id) = 27
          AND (
            SELECT count(*)
            FROM public.cities AS city
            JOIN public.states AS state ON state.states_id = city.states_id
            WHERE state.countries_id = country.countries_id
          ) = 5571
      )
    )
  ) AS value
)
SELECT jsonb_build_object(
  'checkedAt', pg_catalog.statement_timestamp(),
  'readOnly', true,
  'migrationLedger', jsonb_build_object(
    'status', CASE
      WHEN EXISTS (SELECT 1 FROM ledger_choice) THEN 'accessible'
      WHEN EXISTS (SELECT 1 FROM ledger_candidates) THEN 'found_but_not_readable_or_incompatible'
      ELSE 'not_found'
    END,
    'detectedCandidates', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'schema', candidate.schema_name,
          'table', candidate.table_name,
          'hasVersion', candidate.has_version,
          'hasName', candidate.has_name,
          'readable', candidate.readable
        ) ORDER BY candidate.priority, candidate.schema_name, candidate.table_name
      )
      FROM ledger_candidates AS candidate
    ), '[]'::jsonb),
    'selectedMechanism', COALESCE((
      SELECT jsonb_build_object('schema', choice.schema_name, 'table', choice.table_name)
      FROM ledger_choice AS choice
    ), 'null'::jsonb),
    'registered', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object('version', row_data.version, 'name', row_data.name)
        ORDER BY row_data.version, row_data.name
      )
      FROM ledger_rows AS row_data
    ), '[]'::jsonb),
    'expected', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'version', expected.version,
          'name', expected.migration_name,
          'registered', EXISTS (
            SELECT 1
            FROM ledger_rows AS registered
            WHERE registered.version = expected.version
               OR registered.name = expected.migration_name
               OR registered.name = expected.migration_name || '.sql'
          )
        ) ORDER BY expected.position
      )
      FROM expected_migrations AS expected
    ), '[]'::jsonb)
  ),
  'criticalObjects', jsonb_build_object(
    'functions', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'group', function_row.group_name,
          'name', function_row.function_name,
          'requiredIdentityArguments', function_row.required_identity_arguments,
          'exists', function_row.exists,
          'actualIdentityArguments', function_row.actual_identity_arguments,
          'language', function_row.language,
          'securityDefiner', function_row.security_definer,
          'volatility', function_row.volatility,
          'definitionSummary', function_row.definition_summary
        ) ORDER BY function_row.position
      )
      FROM critical_functions AS function_row
    ), '[]'::jsonb),
    'tables', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'group', table_row.group_name,
          'name', table_row.table_name,
          'exists', table_row.exists,
          'kind', table_row.relation_kind,
          'rlsEnabled', table_row.rls_enabled
        ) ORDER BY table_row.position
      )
      FROM critical_tables AS table_row
    ), '[]'::jsonb)
  ),
  'criticalRls', COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'table', rls_row.table_name,
        'exists', rls_row.exists,
        'rlsEnabled', rls_row.rls_enabled,
        'rlsForced', rls_row.rls_forced,
        'policies', rls_row.policies,
        'grants', rls_row.grants
      ) ORDER BY rls_row.position
    )
    FROM rls_inventory AS rls_row
  ), '[]'::jsonb),
  'criticalForeignKeys', COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'name', foreign_key.constraint_name,
        'purpose', foreign_key.purpose,
        'exists', foreign_key.exists,
        'validated', foreign_key.validated,
        'definition', foreign_key.definition
      ) ORDER BY foreign_key.position
    )
    FROM foreign_key_inventory AS foreign_key
  ), '[]'::jsonb),
  'catalogs', (SELECT summary.value FROM catalog_summary AS summary)
) AS production_release_preflight;
