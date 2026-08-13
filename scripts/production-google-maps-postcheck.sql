-- GOOGLE MAPS API-FIRST / PRODUCAO / POSTCHECK ESTRITAMENTE READ-ONLY.
-- Um unico statement e uma unica celula JSONB. Nao consulta linhas de public.leads.
WITH
expected_maps_tables(table_name, position) AS (
  VALUES
    ('maps_extension_installations', 1), ('maps_extension_pairings', 2),
    ('maps_search_executions', 3), ('maps_search_coverage', 4),
    ('maps_search_candidates', 5), ('maps_search_batches', 6),
    ('maps_search_snapshots', 7)
),
maps_tables AS (
  SELECT
    expected.table_name,
    relation.oid,
    relation.oid IS NOT NULL AS exists,
    coalesce(relation.relrowsecurity, false) AS rls_enabled,
    relation.relacl,
    relation.relowner,
    expected.position
  FROM expected_maps_tables AS expected
  LEFT JOIN pg_catalog.pg_namespace AS namespace ON namespace.nspname = 'public'
  LEFT JOIN pg_catalog.pg_class AS relation
    ON relation.relnamespace = namespace.oid
   AND relation.relname = expected.table_name
   AND relation.relkind IN ('r', 'p')
),
lead_columns AS (
  SELECT
    expected.column_name,
    attribute.attname IS NOT NULL AS exists,
    CASE WHEN attribute.attname IS NULL THEN NULL ELSE pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) END AS data_type,
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
expected_policies(table_name, policy_name, position) AS (
  VALUES
    ('maps_extension_installations','maps_extension_installations_own_select',1),
    ('maps_search_executions','maps_search_executions_own_select',2),
    ('maps_search_coverage','maps_search_coverage_own_select',3),
    ('maps_search_candidates','maps_search_candidates_own_select',4),
    ('maps_search_batches','maps_search_batches_own_select',5),
    ('maps_search_snapshots','maps_search_snapshots_own_select',6)
),
policy_inventory AS (
  SELECT
    expected.table_name,
    expected.policy_name,
    policy.policyname IS NOT NULL AS exists,
    policy.cmd,
    policy.roles,
    policy.qual,
    expected.position,
    policy.policyname IS NOT NULL
      AND policy.cmd = 'SELECT'
      AND policy.roles = ARRAY['authenticated']::name[]
      AND regexp_replace(lower(coalesce(policy.qual, '')), '[[:space:]]+', '', 'g') LIKE '%users_id%auth.uid()%'
      AND regexp_replace(lower(coalesce(policy.qual, '')), '[[:space:]]+', '', 'g') NOT IN ('true', '(true)') AS owner_select
  FROM expected_policies AS expected
  LEFT JOIN pg_catalog.pg_policies AS policy
    ON policy.schemaname = 'public'
   AND policy.tablename = expected.table_name
   AND policy.policyname = expected.policy_name
),
unsafe_policies AS (
  SELECT count(*) AS total
  FROM pg_catalog.pg_policies AS policy
  WHERE policy.schemaname = 'public'
    AND policy.tablename IN (SELECT table_name FROM expected_maps_tables)
    AND policy.roles && ARRAY['public','anon','authenticated']::name[]
    AND (
      policy.cmd IN ('INSERT','UPDATE','DELETE','ALL')
      OR regexp_replace(lower(coalesce(policy.qual, '')), '[[:space:]]+', '', 'g') IN ('true', '(true)')
    )
),
unexpected_policies AS (
  SELECT count(*) AS total
  FROM pg_catalog.pg_policies AS policy
  WHERE policy.schemaname = 'public'
    AND policy.tablename IN (SELECT table_name FROM expected_maps_tables)
    AND policy.roles && ARRAY['public','anon','authenticated']::name[]
    AND NOT EXISTS (
      SELECT 1 FROM expected_policies AS expected
      WHERE expected.table_name = policy.tablename
        AND expected.policy_name = policy.policyname
    )
),
pairing_policies AS (
  SELECT count(*) AS total
  FROM pg_catalog.pg_policies AS policy
  WHERE policy.schemaname = 'public'
    AND policy.tablename = 'maps_extension_pairings'
    AND policy.roles && ARRAY['public','anon','authenticated']::name[]
),
privilege_inventory AS (
  SELECT
    maps.table_name,
    coalesce(pg_catalog.has_table_privilege('authenticated', maps.oid, 'SELECT'), false) AS authenticated_select,
    coalesce(pg_catalog.has_table_privilege('authenticated', maps.oid, 'INSERT,UPDATE,DELETE,TRUNCATE'), false) AS authenticated_dml,
    coalesce(pg_catalog.has_table_privilege('anon', maps.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'), false) AS anon_any,
    coalesce(EXISTS (
      SELECT 1
      FROM pg_catalog.aclexplode(coalesce(maps.relacl, pg_catalog.acldefault('r', maps.relowner))) AS acl
      WHERE acl.grantee = 0
        AND acl.privilege_type IN ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE')
    ), false) AS public_any,
    coalesce(pg_catalog.has_table_privilege('service_role', maps.oid, 'SELECT'), false) AS service_select,
    coalesce(pg_catalog.has_table_privilege('service_role', maps.oid, 'INSERT'), false) AS service_insert,
    coalesce(pg_catalog.has_table_privilege('service_role', maps.oid, 'UPDATE'), false) AS service_update,
    coalesce(pg_catalog.has_table_privilege('service_role', maps.oid, 'DELETE,TRUNCATE'), false) AS service_destructive
  FROM maps_tables AS maps
),
constraint_contract AS (
  SELECT
    EXISTS (
      SELECT 1 FROM pg_catalog.pg_constraint AS constraint_row
      WHERE constraint_row.conrelid = pg_catalog.to_regclass('public.maps_search_coverage')
        AND constraint_row.contype = 'u'
        AND replace(pg_catalog.pg_get_constraintdef(constraint_row.oid), ' ', '') LIKE 'UNIQUE(maps_search_executions_id,cities_id,normalized_search_term)%'
    ) AS coverage_identity,
    EXISTS (
      SELECT 1 FROM pg_catalog.pg_constraint AS constraint_row
      WHERE constraint_row.conrelid = pg_catalog.to_regclass('public.maps_search_candidates')
        AND constraint_row.contype = 'u'
        AND replace(pg_catalog.pg_get_constraintdef(constraint_row.oid), ' ', '') LIKE 'UNIQUE(maps_search_executions_id,dedupe_key)%'
    ) AS candidate_identity,
    EXISTS (
      SELECT 1 FROM pg_catalog.pg_constraint AS constraint_row
      WHERE constraint_row.conrelid = pg_catalog.to_regclass('public.maps_search_batches')
        AND constraint_row.contype = 'u'
        AND replace(pg_catalog.pg_get_constraintdef(constraint_row.oid), ' ', '') LIKE 'UNIQUE(maps_search_executions_id,batch_id)%'
    ) AS batch_identity,
    EXISTS (
      SELECT 1 FROM pg_catalog.pg_constraint AS constraint_row
      WHERE constraint_row.conrelid = pg_catalog.to_regclass('public.maps_search_snapshots')
        AND constraint_row.contype = 'u'
        AND replace(pg_catalog.pg_get_constraintdef(constraint_row.oid), ' ', '') LIKE 'UNIQUE(maps_search_coverage_id)%'
    ) AS snapshot_identity,
    EXISTS (
      SELECT 1 FROM pg_catalog.pg_constraint AS constraint_row
      WHERE constraint_row.conrelid = pg_catalog.to_regclass('public.leads')
        AND constraint_row.conname = 'leads_maps_search_candidates_id_fkey'
        AND constraint_row.confrelid = pg_catalog.to_regclass('public.maps_search_candidates')
    ) AS promotion_foreign_key,
    EXISTS (
      SELECT 1 FROM pg_catalog.pg_class AS index_relation
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = index_relation.relnamespace
      JOIN pg_catalog.pg_index AS index_row ON index_row.indexrelid = index_relation.oid
      WHERE namespace.nspname = 'public'
        AND index_relation.relname = 'leads_maps_search_candidates_id_unique'
        AND index_row.indisunique
    ) AS promotion_unique_index
),
function_inventory AS (
  SELECT
    expected.function_key,
    procedure.oid,
    procedure.oid IS NOT NULL AS exists,
    CASE WHEN procedure.oid IS NULL THEN '' ELSE regexp_replace(lower(pg_catalog.pg_get_functiondef(procedure.oid)), '[[:space:]]+', '', 'g') END AS definition
  FROM (VALUES
    ('identity', 'prepare_lead_identity', ''),
    ('identity_register', 'register_lead_identity', ''),
    ('proof', 'has_current_whatsapp_validation_proof', 'bigint, bigint'),
    ('record', 'record_whatsapp_validation_result', 'bigint, bigint, text, text, text, text, text, integer, text, text, jsonb'),
    ('queue', 'prepare_queue_items_without_whatsapp_validation_proof', 'text, bigint, date, jsonb'),
    ('snapshot', 'build_queue_item_payload_snapshot', 'bigint, bigint, bigint, bigint, timestamp with time zone')
  ) AS expected(function_key, function_name, identity_arguments)
  LEFT JOIN pg_catalog.pg_proc AS procedure
    ON procedure.oid = pg_catalog.to_regprocedure(
      pg_catalog.format('public.%I(%s)', expected.function_name, expected.identity_arguments)
    )
),
trigger_contract AS (
  SELECT
    coalesce(bool_or(
    trigger_row.tgname = 'prepare_lead_identity_trigger'
    AND lower(pg_catalog.pg_get_triggerdef(trigger_row.oid)) LIKE '%leads_whatsapp%'
    ), false) AS identity_prepare_trigger_tracks_whatsapp,
    coalesce(bool_or(
      trigger_row.tgname = 'register_lead_identity_trigger'
      AND lower(pg_catalog.pg_get_triggerdef(trigger_row.oid)) LIKE '%leads_whatsapp%'
    ), false) AS identity_register_trigger_tracks_whatsapp
  FROM pg_catalog.pg_trigger AS trigger_row
  WHERE trigger_row.tgrelid = pg_catalog.to_regclass('public.leads')
    AND NOT trigger_row.tgisinternal
),
function_contract AS (
  SELECT
    coalesce((SELECT exists
      AND definition LIKE '%coalesce%'
      AND position('lead.leads_whatsapp' IN definition) > 0
      AND position('lead.leads_phone' IN definition) > position('lead.leads_whatsapp' IN definition)
      FROM function_inventory WHERE function_key = 'proof'), false) AS proof_prefers_whatsapp,
    coalesce((SELECT exists
      AND definition LIKE '%p_outcome=''invalid''%'
      AND definition LIKE '%v_target_status_id:=1%'
      AND definition LIKE '%v_target_channel_id:=v_instagram_channel_id%'
      AND definition LIKE '%p_outcome<>''technical_error''%'
      FROM function_inventory WHERE function_key = 'record'), false) AS fallback_contract,
    coalesce((SELECT exists
      AND definition LIKE '%old.leads_identity_contract_versionisdistinctfrom1%'
      AND position('new.leads_whatsapp' IN definition) > 0
      AND position('new.leads_phone' IN definition) > position('new.leads_whatsapp' IN definition)
      FROM function_inventory WHERE function_key = 'identity'), false) AS identity_uses_whatsapp,
    coalesce((SELECT exists
      AND definition LIKE '%new.leads_identity_contract_versionisdistinctfrom1%'
      AND definition LIKE '%new.leads_normalized_phone%'
      AND definition LIKE '%''phone'',new.leads_normalized_phone%'
      FROM function_inventory WHERE function_key = 'identity_register'), false) AS identity_registers_effective_phone,
    coalesce((SELECT exists
      AND definition LIKE '%coalesce(nullif(btrim(v_lead.leads_whatsapp),''''),nullif(btrim(v_lead.leads_phone),''''),'''')%'
      FROM function_inventory WHERE function_key = 'queue'), false) AS queue_uses_whatsapp,
    coalesce((SELECT exists
      AND definition LIKE '%v_whatsapp:=coalesce(v_lead.leads_whatsapp,'''')%'
      AND definition LIKE '%v_effective_whatsapp_phone:=coalesce(nullif(btrim(v_whatsapp),''''),nullif(btrim(v_phone),''''),'''')%'
      AND definition LIKE '%''phone'',v_phone,''whatsapp'',v_whatsapp%'
      AND definition LIKE '%''phone'',regexp_replace(v_effective_whatsapp_phone%'
      FROM function_inventory WHERE function_key = 'snapshot'), false) AS snapshot_uses_whatsapp
),
catalog_contract AS (
  SELECT
    EXISTS (SELECT 1 FROM public.channels WHERE lower(regexp_replace(trim(channels_name), '[^a-zA-Z0-9]+', '', 'g')) = 'whatsapp') AS whatsapp_channel,
    EXISTS (SELECT 1 FROM public.channels WHERE lower(regexp_replace(trim(channels_name), '[^a-zA-Z0-9]+', '', 'g')) = 'instagram') AS instagram_channel,
    NOT EXISTS (
      SELECT 1
      FROM public.branches AS branch
      WHERE branch.status_id = 1
        AND EXISTS (
          SELECT required.source_key FROM (VALUES ('sem_site'),('dominio_proprio'),('agregador'),('instagram')) AS required(source_key)
          WHERE NOT EXISTS (
            SELECT 1 FROM public.contact_sources AS source
            WHERE source.users_id = branch.users_id
              AND source.contact_sources_key = required.source_key
              AND source.status_id = 1
          )
        )
    ) AS contact_sources,
    EXISTS (SELECT 1 FROM public.lead_status WHERE lead_status_id = 1 AND lower(regexp_replace(trim(lead_status_name), '[^a-zA-Z0-9]+', '', 'g')) = 'importado') AS imported_status
),
apify_contract AS (
  SELECT NOT EXISTS (
    SELECT 1
    FROM maps_tables AS maps
    JOIN pg_catalog.pg_attribute AS attribute ON attribute.attrelid = maps.oid
    WHERE attribute.attnum > 0
      AND NOT attribute.attisdropped
      AND lower(attribute.attname) LIKE '%apify%'
  ) AS no_apify_column
),
summary AS (
  SELECT
    NOT EXISTS (SELECT 1 FROM maps_tables WHERE NOT exists) AS tables_ready,
    NOT EXISTS (SELECT 1 FROM maps_tables WHERE NOT rls_enabled) AS rls_ready,
    NOT EXISTS (SELECT 1 FROM policy_inventory WHERE NOT owner_select) AS policies_ready,
    (SELECT total = 0 FROM unsafe_policies)
      AND (SELECT total = 0 FROM unexpected_policies)
      AND (SELECT total = 0 FROM pairing_policies) AS no_unsafe_policies,
    NOT EXISTS (
      SELECT 1 FROM privilege_inventory
      WHERE authenticated_dml OR anon_any OR public_any OR service_destructive
        OR NOT service_select OR NOT service_insert OR NOT service_update
        OR (table_name = 'maps_extension_pairings' AND authenticated_select)
        OR (table_name <> 'maps_extension_pairings' AND NOT authenticated_select)
    ) AS grants_ready,
    NOT EXISTS (SELECT 1 FROM lead_columns WHERE NOT exists OR NOT nullable OR default_expression IS NOT NULL) AS lead_columns_ready,
    (SELECT coverage_identity AND candidate_identity AND batch_identity AND snapshot_identity AND promotion_foreign_key AND promotion_unique_index FROM constraint_contract) AS constraints_ready,
    (SELECT proof_prefers_whatsapp AND fallback_contract FROM function_contract) AS validation_ready,
    (SELECT identity_uses_whatsapp AND identity_registers_effective_phone AND queue_uses_whatsapp AND snapshot_uses_whatsapp FROM function_contract)
      AND (SELECT identity_prepare_trigger_tracks_whatsapp AND identity_register_trigger_tracks_whatsapp FROM trigger_contract) AS whatsapp_only_runtime_ready,
    (SELECT whatsapp_channel AND instagram_channel AND contact_sources AND imported_status FROM catalog_contract) AS catalogs_ready,
    (SELECT no_apify_column FROM apify_contract) AS apify_free
)
SELECT jsonb_build_object(
  'checkedAt', pg_catalog.statement_timestamp(),
  'readOnly', true,
  'readyForMapsDeploy', (
    SELECT tables_ready AND rls_ready AND policies_ready AND no_unsafe_policies
      AND grants_ready AND lead_columns_ready AND constraints_ready
      AND validation_ready AND whatsapp_only_runtime_ready AND catalogs_ready AND apify_free
    FROM summary
  ),
  'mapsTables', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('name', table_name, 'exists', exists, 'rlsEnabled', rls_enabled) ORDER BY position)
    FROM maps_tables
  ), '[]'::jsonb),
  'leadColumns', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('name', column_name, 'exists', exists, 'type', data_type, 'nullable', nullable, 'default', default_expression) ORDER BY column_name)
    FROM lead_columns
  ), '[]'::jsonb),
  'policies', jsonb_build_object(
    'expected', COALESCE((SELECT jsonb_agg(jsonb_build_object('table', table_name, 'name', policy_name, 'ownerSelect', owner_select) ORDER BY position) FROM policy_inventory), '[]'::jsonb),
    'unsafeCount', (SELECT total FROM unsafe_policies),
    'unexpectedCount', (SELECT total FROM unexpected_policies),
    'pairingAuthenticatedPolicyCount', (SELECT total FROM pairing_policies)
  ),
  'grants', COALESCE((SELECT jsonb_agg(to_jsonb(privilege_inventory) ORDER BY table_name) FROM privilege_inventory), '[]'::jsonb),
  'idempotencyAndRelations', (SELECT to_jsonb(constraint_contract) FROM constraint_contract),
  'validationContract', (SELECT to_jsonb(function_contract) FROM function_contract),
  'identityTrigger', (SELECT to_jsonb(trigger_contract) FROM trigger_contract),
  'whatsappContactCompatibility', CASE
    WHEN (SELECT whatsapp_only_runtime_ready FROM summary) THEN 'pass'
    ELSE 'fail'
  END,
  'catalogs', (SELECT to_jsonb(catalog_contract) FROM catalog_contract),
  'apifyFree', (SELECT no_apify_column FROM apify_contract),
  'blockingChecks', jsonb_build_object(
    'mapsSchema', (SELECT tables_ready AND rls_ready AND policies_ready AND no_unsafe_policies AND grants_ready AND lead_columns_ready AND constraints_ready FROM summary),
    'whatsappValidationFallback', (SELECT validation_ready FROM summary),
    'whatsappOnlyIdentityAndQueue', (SELECT whatsapp_only_runtime_ready FROM summary),
    'catalogs', (SELECT catalogs_ready FROM summary)
  ),
  'doesNotInspectLeadRows', true,
  'doesNotInspectSecrets', true
) AS production_google_maps_postcheck;
