-- GOOGLE MAPS API-FIRST / PRODUCAO / PRE-FLIGHT ESTRITAMENTE READ-ONLY.
-- Um unico statement e uma unica celula JSONB. Nao consulta linhas de public.leads.
WITH
expected_relations(relation_name, position) AS (
  VALUES
    ('users', 1), ('branches', 2), ('countries', 3), ('states', 4), ('cities', 5),
    ('channels', 6), ('contact_sources', 7), ('lead_status', 8), ('status', 9),
    ('leads', 10), ('chips', 11), ('socials', 12), ('levels', 13),
    ('lead_validation_attempts', 14), ('lead_validation_results', 15),
    ('lead_identity_registry', 16), ('contact_suppressions', 17)
),
relation_inventory AS (
  SELECT
    expected.relation_name,
    relation.oid IS NOT NULL AS exists,
    expected.position
  FROM expected_relations AS expected
  LEFT JOIN pg_catalog.pg_namespace AS namespace ON namespace.nspname = 'public'
  LEFT JOIN pg_catalog.pg_class AS relation
    ON relation.relnamespace = namespace.oid
   AND relation.relname = expected.relation_name
   AND relation.relkind IN ('r', 'p')
),
expected_columns(table_name, column_name) AS (
  VALUES
    ('leads','leads_id'), ('leads','users_id'), ('leads','branches_id'),
    ('leads','countries_id'), ('leads','states_id'), ('leads','cities_id'),
    ('leads','channels_id'), ('leads','lead_status_id'), ('leads','contact_sources_id'),
    ('leads','leads_name'), ('leads','leads_phone'), ('leads','leads_instagram'),
    ('leads','leads_website'), ('leads','leads_maps'), ('leads','leads_origin'),
    ('leads','leads_identity_contract_version'), ('leads','leads_normalized_phone'),
    ('chips','users_id'), ('chips','levels_id'), ('chips','status_id'),
    ('socials','users_id'), ('socials','levels_id'), ('socials','status_id'),
    ('levels','users_id'), ('levels','channels_id'), ('levels','status_id'),
    ('levels','levels_daily_limit'), ('branches','users_id'), ('branches','status_id'),
    ('branches','branches_categories'), ('contact_sources','users_id'),
    ('contact_sources','status_id'), ('contact_sources','contact_sources_key'),
    ('channels','channels_id'), ('channels','channels_name'),
    ('lead_status','lead_status_id'), ('lead_status','lead_status_name'),
    ('lead_validation_attempts','lead_validation_attempts_input_value'),
    ('lead_validation_attempts','lead_validation_attempts_finished_at'),
    ('lead_validation_results','lead_validation_results_key')
),
column_inventory AS (
  SELECT
    expected.table_name,
    expected.column_name,
    attribute.attname IS NOT NULL AS exists
  FROM expected_columns AS expected
  LEFT JOIN pg_catalog.pg_namespace AS namespace ON namespace.nspname = 'public'
  LEFT JOIN pg_catalog.pg_class AS relation
    ON relation.relnamespace = namespace.oid
   AND relation.relname = expected.table_name
   AND relation.relkind IN ('r', 'p')
  LEFT JOIN pg_catalog.pg_attribute AS attribute
    ON attribute.attrelid = relation.oid
   AND attribute.attname = expected.column_name
   AND attribute.attnum > 0
   AND NOT attribute.attisdropped
),
expected_constraints(table_name, constraint_name) AS (
  VALUES
    ('leads','leads_users_id_fkey'), ('leads','leads_branches_id_fkey'),
    ('leads','leads_countries_id_fkey'), ('leads','leads_states_id_fkey'),
    ('leads','leads_cities_id_fkey'), ('leads','leads_channels_id_fkey'),
    ('leads','leads_lead_status_id_fkey'), ('leads','leads_contact_sources_id_fkey'),
    ('chips','chips_users_id_fkey'), ('chips','chips_levels_id_fkey'),
    ('socials','socials_users_id_fkey'), ('socials','socials_levels_id_fkey'),
    ('levels','levels_users_id_fkey'), ('levels','levels_channels_id_fkey'),
    ('states','states_countries_id_fkey'), ('cities','cities_states_id_fkey')
),
constraint_inventory AS (
  SELECT
    expected.table_name,
    expected.constraint_name,
    constraint_row.oid IS NOT NULL AS exists
  FROM expected_constraints AS expected
  LEFT JOIN pg_catalog.pg_namespace AS namespace ON namespace.nspname = 'public'
  LEFT JOIN pg_catalog.pg_class AS relation
    ON relation.relnamespace = namespace.oid
   AND relation.relname = expected.table_name
  LEFT JOIN pg_catalog.pg_constraint AS constraint_row
    ON constraint_row.conrelid = relation.oid
   AND constraint_row.conname = expected.constraint_name
   AND constraint_row.contype = 'f'
),
expected_functions(function_name, identity_arguments, position) AS (
  VALUES
    ('unaccent', 'text', 1),
    ('normalize_identity_phone', 'text', 2),
    ('prepare_lead_identity', '', 3),
    ('register_lead_identity', '', 4),
    ('has_current_whatsapp_validation_proof', 'bigint, bigint', 5),
    ('record_whatsapp_validation_result', 'bigint, bigint, text, text, text, text, text, integer, text, text, jsonb', 6),
    ('append_audit_event', 'text, text, text, text, bigint, bigint, bigint, bigint, bigint, text, jsonb, bigint', 7),
    ('prepare_queue_items', 'text, bigint, date, jsonb', 8),
    ('prepare_queue_items_without_whatsapp_validation_proof', 'text, bigint, date, jsonb', 9),
    ('build_queue_item_payload_snapshot', 'bigint, bigint, bigint, bigint, timestamp with time zone', 10)
),
function_inventory AS (
  SELECT
    expected.function_name,
    expected.identity_arguments,
    procedure.oid IS NOT NULL AS exists,
    expected.position
  FROM expected_functions AS expected
  LEFT JOIN pg_catalog.pg_proc AS procedure
    ON procedure.oid = pg_catalog.to_regprocedure(
      pg_catalog.format('public.%I(%s)', expected.function_name, expected.identity_arguments)
    )
),
identity_triggers AS (
  SELECT
    count(*) FILTER (WHERE trigger_row.tgname = 'prepare_lead_identity_trigger') > 0 AS prepare_exists,
    count(*) FILTER (WHERE trigger_row.tgname = 'register_lead_identity_trigger') > 0 AS register_exists
  FROM pg_catalog.pg_trigger AS trigger_row
  WHERE trigger_row.tgrelid = pg_catalog.to_regclass('public.leads')
    AND NOT trigger_row.tgisinternal
),
maps_relations(relation_name, position) AS (
  VALUES
    ('maps_extension_installations', 1), ('maps_extension_pairings', 2),
    ('maps_search_executions', 3), ('maps_search_coverage', 4),
    ('maps_search_candidates', 5), ('maps_search_batches', 6),
    ('maps_search_snapshots', 7)
),
maps_inventory AS (
  SELECT
    expected.relation_name,
    relation.oid IS NOT NULL AS exists,
    expected.position
  FROM maps_relations AS expected
  LEFT JOIN pg_catalog.pg_namespace AS namespace ON namespace.nspname = 'public'
  LEFT JOIN pg_catalog.pg_class AS relation
    ON relation.relnamespace = namespace.oid
   AND relation.relname = expected.relation_name
   AND relation.relkind IN ('r', 'p')
),
new_lead_columns AS (
  SELECT
    expected.column_name,
    attribute.attname IS NOT NULL AS exists,
    CASE WHEN attribute.attname IS NULL THEN NULL ELSE NOT attribute.attnotnull END AS nullable,
    CASE WHEN attribute.attname IS NULL THEN NULL ELSE pg_catalog.pg_get_expr(default_row.adbin, default_row.adrelid) END AS default_expression
  FROM (VALUES ('leads_whatsapp'), ('maps_search_candidates_id')) AS expected(column_name)
  LEFT JOIN pg_catalog.pg_attribute AS attribute
    ON attribute.attrelid = pg_catalog.to_regclass('public.leads')
   AND attribute.attname = expected.column_name
   AND attribute.attnum > 0
   AND NOT attribute.attisdropped
  LEFT JOIN pg_catalog.pg_attrdef AS default_row
    ON default_row.adrelid = attribute.attrelid
   AND default_row.adnum = attribute.attnum
),
catalog_contract AS (
  SELECT
    EXISTS (
      SELECT 1 FROM public.channels AS channel
      WHERE lower(regexp_replace(trim(channel.channels_name), '[^a-zA-Z0-9]+', '', 'g')) = 'whatsapp'
    ) AS whatsapp_channel,
    EXISTS (
      SELECT 1 FROM public.channels AS channel
      WHERE lower(regexp_replace(trim(channel.channels_name), '[^a-zA-Z0-9]+', '', 'g')) = 'instagram'
    ) AS instagram_channel,
    NOT EXISTS (
      SELECT 1
      FROM public.branches AS branch
      WHERE branch.status_id = 1
        AND EXISTS (
          SELECT required.source_key
          FROM (VALUES ('sem_site'), ('dominio_proprio'), ('agregador'), ('instagram')) AS required(source_key)
          WHERE NOT EXISTS (
            SELECT 1 FROM public.contact_sources AS source
            WHERE source.users_id = branch.users_id
              AND source.contact_sources_key = required.source_key
              AND source.status_id = 1
          )
        )
    ) AS contact_sources,
    (
      SELECT count(DISTINCT branch.users_id)
      FROM public.branches AS branch
      WHERE branch.status_id = 1
        AND EXISTS (
          SELECT required.source_key
          FROM (VALUES ('sem_site'), ('dominio_proprio'), ('agregador'), ('instagram')) AS required(source_key)
          WHERE NOT EXISTS (
            SELECT 1 FROM public.contact_sources AS source
            WHERE source.users_id = branch.users_id
              AND source.contact_sources_key = required.source_key
              AND source.status_id = 1
          )
        )
    ) AS contact_source_missing_tenants,
    EXISTS (
      SELECT 1 FROM public.lead_status AS lead_state
      WHERE lead_state.lead_status_id = 1
        AND lower(regexp_replace(trim(lead_state.lead_status_name), '[^a-zA-Z0-9]+', '', 'g')) = 'importado'
    ) AS imported_status,
    NOT EXISTS (
      SELECT required.result_key
      FROM (VALUES ('valido'), ('nao_encontrado'), ('erro_tecnico')) AS required(result_key)
      WHERE NOT EXISTS (
        SELECT 1 FROM public.lead_validation_results AS result
        WHERE result.lead_validation_results_key = required.result_key
      )
    ) AS validation_results
),
summary AS (
  SELECT
    NOT EXISTS (SELECT 1 FROM relation_inventory WHERE NOT exists) AS relations_ready,
    NOT EXISTS (SELECT 1 FROM column_inventory WHERE NOT exists) AS columns_ready,
    NOT EXISTS (SELECT 1 FROM constraint_inventory WHERE NOT exists) AS constraints_ready,
    NOT EXISTS (SELECT 1 FROM function_inventory WHERE NOT exists) AS functions_ready,
    (SELECT prepare_exists AND register_exists FROM identity_triggers) AS identity_triggers_ready,
    (SELECT bool_and(NOT exists OR (nullable AND default_expression IS NULL)) FROM new_lead_columns) AS existing_new_columns_safe,
    (SELECT count(*) FILTER (WHERE exists) FROM maps_inventory) AS maps_object_count,
    (SELECT whatsapp_channel AND instagram_channel AND contact_sources AND imported_status AND validation_results FROM catalog_contract) AS catalogs_ready
)
SELECT jsonb_build_object(
  'checkedAt', pg_catalog.statement_timestamp(),
  'readOnly', true,
  'readyForMapsMigrations', (
    SELECT relations_ready AND columns_ready AND constraints_ready AND functions_ready
      AND identity_triggers_ready AND existing_new_columns_safe AND catalogs_ready
      AND maps_object_count = 0
    FROM summary
  ),
  'mapsObjectState', (
    SELECT CASE WHEN maps_object_count = 0 THEN 'absent'
      WHEN maps_object_count = 7 THEN 'already_present'
      ELSE 'partial_or_divergent' END
    FROM summary
  ),
  'baseRelations', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('name', relation_name, 'exists', exists) ORDER BY position)
    FROM relation_inventory
  ), '[]'::jsonb),
  'requiredColumns', jsonb_build_object(
    'allPresent', (SELECT columns_ready FROM summary),
    'missing', COALESCE((SELECT jsonb_agg(table_name || '.' || column_name ORDER BY table_name, column_name) FROM column_inventory WHERE NOT exists), '[]'::jsonb)
  ),
  'requiredForeignKeys', jsonb_build_object(
    'allPresent', (SELECT constraints_ready FROM summary),
    'missing', COALESCE((SELECT jsonb_agg(table_name || '.' || constraint_name ORDER BY table_name, constraint_name) FROM constraint_inventory WHERE NOT exists), '[]'::jsonb)
  ),
  'functions', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('name', function_name, 'identityArguments', identity_arguments, 'exists', exists) ORDER BY position)
    FROM function_inventory
  ), '[]'::jsonb),
  'identityTriggers', (SELECT to_jsonb(identity_triggers) FROM identity_triggers),
  'catalogs', (SELECT to_jsonb(catalog_contract) FROM catalog_contract),
  'newLeadColumns', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'name', column_name, 'exists', exists, 'nullable', nullable, 'default', default_expression
    ) ORDER BY column_name)
    FROM new_lead_columns
  ), '[]'::jsonb),
  'mapsObjects', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('name', relation_name, 'exists', exists) ORDER BY position)
    FROM maps_inventory
  ), '[]'::jsonb),
  'doesNotInspectLeadRows', true,
  'doesNotInspectSecrets', true
) AS production_google_maps_preflight;
