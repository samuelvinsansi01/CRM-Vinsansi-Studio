-- POST-MIGRATION PRODUCTION CHECK: one read-only catalog statement returning one JSONB cell.
WITH
expected_functions(check_group, function_name, identity_arguments, position) AS (
  VALUES
    ('cadence', 'worker_set_whatsapp_batch_state', 'bigint, text, text, text', 1),
    ('cadence', 'worker_complete_batch_item', 'bigint, text, text, timestamp with time zone', 2),
    ('cadence', 'worker_recover_stale_whatsapp', 'timestamp with time zone', 3),
    ('health', 'get_operational_health', '', 4),
    ('identity', 'normalize_identity_phone', 'text', 5),
    ('identity', 'normalize_identity_instagram', 'text', 6),
    ('identity', 'normalize_identity_domain', 'text', 7),
    ('identity', 'normalize_identity_maps', 'text', 8),
    ('identity', 'prepare_lead_identity', '', 9),
    ('identity', 'register_lead_identity', '', 10),
    ('identity', 'suppress_lead_identities', 'public.leads, text, bigint', 11),
    ('identity', 'suppress_after_lead_sent', '', 12),
    ('identity', 'check_lead_identity', 'text, text, text, text', 13),
    ('whatsapp_proof', 'has_current_whatsapp_validation_proof', 'bigint, bigint', 14),
    ('whatsapp_proof', 'current_user_whatsapp_validation_proofs', 'bigint[]', 15),
    ('whatsapp_proof', 'record_whatsapp_validation_result', 'bigint, bigint, text, text, text, text, text, integer, text, text, jsonb', 16)
),
function_inventory AS (
  SELECT
    expected.check_group,
    expected.function_name,
    expected.identity_arguments,
    expected.position,
    procedure.oid,
    procedure.oid IS NOT NULL AS exists,
    CASE WHEN procedure.oid IS NULL THEN NULL ELSE pg_catalog.pg_get_function_identity_arguments(procedure.oid) END AS actual_identity_arguments,
    CASE WHEN procedure.oid IS NULL THEN NULL ELSE pg_catalog.pg_get_functiondef(procedure.oid) END AS definition,
    CASE
      WHEN procedure.oid IS NULL THEN ''
      ELSE regexp_replace(lower(pg_catalog.pg_get_functiondef(procedure.oid)), '[[:space:]]+', '', 'g')
    END AS compact_definition,
    procedure.proacl,
    procedure.proowner
  FROM expected_functions AS expected
  LEFT JOIN pg_catalog.pg_proc AS procedure
    ON procedure.oid = pg_catalog.to_regprocedure(
      pg_catalog.format('public.%I(%s)', expected.function_name, expected.identity_arguments)
    )
),
relation_inventory AS (
  SELECT
    expected.relation_name,
    relation.oid,
    relation.oid IS NOT NULL AS exists,
    coalesce(relation.relrowsecurity, false) AS rls_enabled
  FROM (VALUES
    ('contact_sources'),
    ('sents'),
    ('leads'),
    ('lead_identity_registry'),
    ('contact_suppressions'),
    ('lead_validation_attempts'),
    ('lead_validation_results')
  ) AS expected(relation_name)
  LEFT JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.nspname = 'public'
  LEFT JOIN pg_catalog.pg_class AS relation
    ON relation.relnamespace = namespace.oid
   AND relation.relname = expected.relation_name
   AND relation.relkind IN ('r', 'p')
),
roles AS (
  SELECT
    pg_catalog.to_regrole('authenticated')::oid AS authenticated_oid,
    pg_catalog.to_regrole('service_role')::oid AS service_role_oid
),
policy_inventory AS (
  SELECT
    relation.relname AS table_name,
    policy.polname AS policy_name,
    policy.polcmd,
    policy.polpermissive,
    policy.polroles,
    pg_catalog.pg_get_expr(policy.polqual, policy.polrelid) AS using_expression,
    pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid) AS check_expression,
    regexp_replace(lower(coalesce(pg_catalog.pg_get_expr(policy.polqual, policy.polrelid), '')), '[[:space:]]+', '', 'g') AS compact_using,
    regexp_replace(lower(coalesce(pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid), '')), '[[:space:]]+', '', 'g') AS compact_check
  FROM pg_catalog.pg_policy AS policy
  JOIN pg_catalog.pg_class AS relation ON relation.oid = policy.polrelid
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
    AND relation.relname IN ('contact_sources', 'sents', 'lead_validation_attempts', 'lead_validation_results')
),
table_grants AS (
  SELECT table_name, grantee, privilege_type
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND table_name IN ('sents', 'lead_validation_attempts', 'lead_validation_results')
    AND grantee IN ('authenticated', 'service_role')
),
paused_column AS (
  SELECT
    attribute.attname IS NOT NULL AS exists,
    CASE WHEN attribute.attname IS NULL THEN NULL ELSE pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) END AS data_type,
    CASE WHEN attribute.attname IS NULL THEN NULL ELSE NOT attribute.attnotnull END AS nullable
  FROM (SELECT 1 AS singleton) AS seed
  LEFT JOIN pg_catalog.pg_attribute AS attribute
    ON attribute.attrelid = pg_catalog.to_regclass('public.worker_batches')
   AND attribute.attname = 'worker_batches_paused_at'
   AND attribute.attnum > 0
   AND NOT attribute.attisdropped
),
cadence_contract AS (
  SELECT
    coalesce((SELECT exists FROM paused_column), false) AS paused_column_exists,
    coalesce(bool_and(function_row.exists), false) AS functions_exist,
    coalesce(bool_and(
      CASE function_row.function_name
        WHEN 'worker_set_whatsapp_batch_state' THEN
          position('v_action=''pause''andv_batch.status_idin(3,4)' IN function_row.compact_definition) > 0
          AND position('worker_batches_paused_at=now()' IN function_row.compact_definition) > 0
          AND position('v_action=''pause''andv_batch.status_id=8' IN function_row.compact_definition) > 0
          AND position('v_action=''resume''andv_batch.status_id=8' IN function_row.compact_definition) > 0
          AND position('now()+greatest(worker_batches_next_run_at-worker_batches_paused_at,interval''0seconds'')' IN function_row.compact_definition) > 0
        WHEN 'worker_complete_batch_item' THEN
          position('worker_batches_next_run_at=casewhenstatus_idin(4,8)thenp_next_run_at' IN function_row.compact_definition) > 0
          AND position('worker_batches_paused_at=casewhenstatus_id=8thennow()' IN function_row.compact_definition) > 0
          AND position('wb.status_idin(4,8)' IN function_row.compact_definition) > 0
          AND position('wbi.status_idin(3,4)' IN function_row.compact_definition) > 0
        WHEN 'worker_recover_stale_whatsapp' THEN
          position('reconciliation_required' IN function_row.compact_definition) > 0
          AND position('worker_batches_next_run_at=greatest(coalesce(worker_batches_next_run_at,now()),now())' IN function_row.compact_definition) > 0
          AND position('wb.status_idin(4,8)' IN function_row.compact_definition) > 0
          AND position('wherestatus_id=4' IN function_row.compact_definition) > 0
        ELSE false
      END
    ), false) AS definitions_match
  FROM function_inventory AS function_row
  WHERE function_row.check_group = 'cadence'
),
cadence_result AS (
  SELECT
    CASE
      WHEN NOT cadence.paused_column_exists OR NOT cadence.functions_exist THEN 'absent'
      WHEN cadence.definitions_match THEN 'present'
      ELSE 'divergent'
    END AS classification,
    cadence.*
  FROM cadence_contract AS cadence
),
contact_sources_contract AS (
  SELECT
    coalesce((SELECT rls_enabled FROM relation_inventory WHERE relation_name = 'contact_sources'), false) AS rls_enabled,
    count(*) FILTER (
      WHERE policy.policy_name = 'contact_sources_own_select'
        AND policy.polcmd = 'r'
        AND (policy.polroles @> ARRAY[roles.authenticated_oid]::oid[])
        AND position('users_id' IN policy.compact_using) > 0
        AND position('auth_user_id=auth.uid()' IN policy.compact_using) > 0
    ) = 1 AS owner_select,
    count(*) FILTER (
      WHERE policy.policy_name = 'contact_sources_own_insert'
        AND policy.polcmd = 'a'
        AND (policy.polroles @> ARRAY[roles.authenticated_oid]::oid[])
        AND position('users_id' IN policy.compact_check) > 0
        AND position('auth_user_id=auth.uid()' IN policy.compact_check) > 0
    ) = 1 AS owner_insert,
    count(*) FILTER (
      WHERE policy.policy_name = 'contact_sources_own_update'
        AND policy.polcmd = 'w'
        AND (policy.polroles @> ARRAY[roles.authenticated_oid]::oid[])
        AND position('auth_user_id=auth.uid()' IN policy.compact_using) > 0
        AND position('auth_user_id=auth.uid()' IN policy.compact_check) > 0
    ) = 1 AS owner_update,
    count(*) FILTER (
      WHERE policy.policy_name = 'contact_sources_own_delete'
        AND policy.polcmd = 'd'
        AND (policy.polroles @> ARRAY[roles.authenticated_oid]::oid[])
        AND position('users_id' IN policy.compact_using) > 0
        AND position('auth_user_id=auth.uid()' IN policy.compact_using) > 0
    ) = 1 AS owner_delete,
    count(*) FILTER (
      WHERE policy.polcmd IN ('r', '*')
        AND (policy.polroles @> ARRAY[roles.authenticated_oid]::oid[] OR policy.polroles @> ARRAY[0::oid]::oid[])
        AND policy.compact_using IN ('true', '(true)')
    ) = 0 AS no_global_authenticated_select,
    coalesce(jsonb_agg(jsonb_build_object(
      'name', policy.policy_name,
      'command', policy.polcmd,
      'using', policy.using_expression,
      'withCheck', policy.check_expression
    ) ORDER BY policy.policy_name) FILTER (WHERE policy.policy_name IS NOT NULL), '[]'::jsonb) AS policies
  FROM roles
  LEFT JOIN policy_inventory AS policy ON policy.table_name = 'contact_sources'
  GROUP BY roles.authenticated_oid
),
contact_sources_result AS (
  SELECT
    contract.*,
    contract.rls_enabled
      AND contract.owner_select
      AND contract.owner_insert
      AND contract.owner_update
      AND contract.owner_delete
      AND contract.no_global_authenticated_select AS passed
  FROM contact_sources_contract AS contract
),
sents_contract AS (
  SELECT
    coalesce((SELECT rls_enabled FROM relation_inventory WHERE relation_name = 'sents'), false) AS rls_enabled,
    count(*) FILTER (
      WHERE policy.policy_name = 'sents_own_select'
        AND policy.polcmd = 'r'
        AND (policy.polroles @> ARRAY[roles.authenticated_oid]::oid[])
        AND position('users_id' IN policy.compact_using) > 0
        AND position('auth_user_id=auth.uid()' IN policy.compact_using) > 0
    ) = 1 AS owner_select,
    count(*) FILTER (
      WHERE (policy.polroles @> ARRAY[roles.authenticated_oid]::oid[] OR policy.polroles @> ARRAY[0::oid]::oid[])
        AND policy.polcmd IN ('a', 'w', 'd', '*')
    ) = 0 AS no_authenticated_dml_policy,
    count(*) FILTER (
      WHERE policy.polroles @> ARRAY[roles.authenticated_oid]::oid[] OR policy.polroles @> ARRAY[0::oid]::oid[]
    ) = 1 AS only_owner_select_policy,
    coalesce(jsonb_agg(jsonb_build_object(
      'name', policy.policy_name,
      'command', policy.polcmd,
      'using', policy.using_expression
    ) ORDER BY policy.policy_name) FILTER (WHERE policy.policy_name IS NOT NULL), '[]'::jsonb) AS policies,
    coalesce((SELECT jsonb_agg(grant_row.privilege_type ORDER BY grant_row.privilege_type)
      FROM table_grants AS grant_row
      WHERE grant_row.table_name = 'sents' AND grant_row.grantee = 'authenticated'), '[]'::jsonb) AS authenticated_grants
  FROM roles
  LEFT JOIN policy_inventory AS policy ON policy.table_name = 'sents'
  GROUP BY roles.authenticated_oid
),
sents_result AS (
  SELECT
    contract.*,
    contract.rls_enabled
      AND contract.owner_select
      AND contract.no_authenticated_dml_policy
      AND contract.only_owner_select_policy AS passed
  FROM sents_contract AS contract
),
health_contract AS (
  SELECT
    function_row.exists,
    function_row.definition,
    position('frompublic.worker_batcheswhereusers_id=v_userandstatus_id' IN function_row.compact_definition) > 0 AS uses_status_id,
    position('worker_batches_status' IN function_row.compact_definition) = 0 AS no_legacy_status_column,
    position('status_idin(3,4,8)' IN function_row.compact_definition) > 0 AS active_batches_contract,
    position('status_id=4andworker_batches_heartbeat_at' IN function_row.compact_definition) > 0 AS stale_batches_contract
  FROM function_inventory AS function_row
  WHERE function_row.check_group = 'health'
),
health_result AS (
  SELECT
    contract.*,
    CASE
      WHEN NOT contract.exists THEN 'absent'
      WHEN contract.uses_status_id
        AND contract.no_legacy_status_column
        AND contract.active_batches_contract
        AND contract.stale_batches_contract THEN 'present'
      ELSE 'divergent'
    END AS classification
  FROM health_contract AS contract
),
identity_column AS (
  SELECT
    attribute.attname IS NOT NULL AS exists,
    CASE WHEN attribute.attname IS NULL THEN NULL ELSE pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) END AS data_type,
    CASE WHEN attribute.attname IS NULL THEN NULL ELSE NOT attribute.attnotnull END AS nullable,
    CASE WHEN attribute.attname IS NULL THEN NULL ELSE pg_catalog.pg_get_expr(attribute_default.adbin, attribute_default.adrelid) END AS default_expression
  FROM (SELECT 1 AS singleton) AS seed
  LEFT JOIN pg_catalog.pg_attribute AS attribute
    ON attribute.attrelid = pg_catalog.to_regclass('public.leads')
   AND attribute.attname = 'leads_identity_contract_version'
   AND attribute.attnum > 0
   AND NOT attribute.attisdropped
  LEFT JOIN pg_catalog.pg_attrdef AS attribute_default
    ON attribute_default.adrelid = attribute.attrelid
   AND attribute_default.adnum = attribute.attnum
),
identity_triggers AS (
  SELECT
    trigger.tgname AS trigger_name,
    trigger.tgenabled,
    procedure.proname AS function_name,
    pg_catalog.pg_get_triggerdef(trigger.oid, true) AS definition
  FROM pg_catalog.pg_trigger AS trigger
  JOIN pg_catalog.pg_class AS relation ON relation.oid = trigger.tgrelid
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  JOIN pg_catalog.pg_proc AS procedure ON procedure.oid = trigger.tgfoid
  WHERE namespace.nspname = 'public'
    AND relation.relname = 'leads'
    AND NOT trigger.tgisinternal
    AND trigger.tgname IN ('prepare_lead_identity_trigger', 'register_lead_identity_trigger', 'suppress_after_lead_sent_trigger')
),
identity_contract AS (
  SELECT
    (SELECT exists AND data_type = 'smallint' AND nullable AND default_expression IS NULL FROM identity_column) AS version_column_contract,
    count(*) FILTER (WHERE function_row.exists) = 9 AS functions_exist,
    count(*) FILTER (
      WHERE function_row.function_name = 'prepare_lead_identity'
        AND position('iftg_op=''update''andold.leads_identity_contract_versionisdistinctfrom1then' IN function_row.compact_definition) > 0
        AND position('new.leads_identity_contract_version:=old.leads_identity_contract_version' IN function_row.compact_definition) > 0
        AND position('returnnew' IN function_row.compact_definition) > 0
        AND position('new.leads_identity_contract_version:=1' IN function_row.compact_definition) > 0
    ) = 1 AS prepare_legacy_barrier,
    count(*) FILTER (
      WHERE function_row.function_name = 'register_lead_identity'
        AND position('new.leads_identity_contract_versionisdistinctfrom1' IN function_row.compact_definition) > 0
    ) = 1 AS register_legacy_barrier,
    count(*) FILTER (
      WHERE function_row.function_name = 'suppress_lead_identities'
        AND position('p_lead.leads_identity_contract_versionisdistinctfrom1' IN function_row.compact_definition) > 0
    ) = 1 AS suppression_legacy_barrier,
    count(*) FILTER (
      WHERE function_row.function_name = 'suppress_after_lead_sent'
        AND position('new.leads_identity_contract_versionisdistinctfrom1' IN function_row.compact_definition) > 0
    ) = 1 AS sent_trigger_legacy_barrier,
    (SELECT count(*) = 3 FROM identity_triggers WHERE tgenabled <> 'D') AS triggers_present,
    coalesce((SELECT bool_and(
      (trigger_row.trigger_name = 'prepare_lead_identity_trigger' AND trigger_row.function_name = 'prepare_lead_identity')
      OR (trigger_row.trigger_name = 'register_lead_identity_trigger' AND trigger_row.function_name = 'register_lead_identity')
      OR (trigger_row.trigger_name = 'suppress_after_lead_sent_trigger' AND trigger_row.function_name = 'suppress_after_lead_sent')
    ) FROM identity_triggers AS trigger_row), false) AS trigger_function_mapping,
    coalesce((SELECT exists FROM relation_inventory WHERE relation_name = 'lead_identity_registry'), false) AS registry_exists,
    coalesce((SELECT exists FROM relation_inventory WHERE relation_name = 'contact_suppressions'), false) AS suppressions_exists,
    coalesce(jsonb_agg(jsonb_build_object(
      'name', function_row.function_name,
      'signature', function_row.actual_identity_arguments,
      'exists', function_row.exists
    ) ORDER BY function_row.position), '[]'::jsonb) AS functions
  FROM function_inventory AS function_row
  WHERE function_row.check_group = 'identity'
),
identity_result AS (
  SELECT
    contract.*,
    contract.version_column_contract
      AND contract.functions_exist
      AND contract.prepare_legacy_barrier
      AND contract.register_legacy_barrier
      AND contract.suppression_legacy_barrier
      AND contract.sent_trigger_legacy_barrier
      AND contract.triggers_present
      AND contract.trigger_function_mapping
      AND contract.registry_exists
      AND contract.suppressions_exists AS passed
  FROM identity_contract AS contract
),
function_acl AS (
  SELECT
    function_row.function_name,
    expanded.grantee,
    expanded.privilege_type
  FROM function_inventory AS function_row
  CROSS JOIN LATERAL pg_catalog.aclexplode(
    coalesce(function_row.proacl, pg_catalog.acldefault('f', function_row.proowner))
  ) AS expanded
  WHERE function_row.check_group = 'whatsapp_proof'
),
validation_attempts_contract AS (
  SELECT
    coalesce((SELECT exists FROM relation_inventory WHERE relation_name = 'lead_validation_attempts'), false) AS table_exists,
    coalesce((SELECT rls_enabled FROM relation_inventory WHERE relation_name = 'lead_validation_attempts'), false) AS rls_enabled,
    count(*) FILTER (
      WHERE policy.policy_name = 'lead_validation_attempts_select_own'
        AND policy.polcmd = 'r'
        AND (policy.polroles @> ARRAY[roles.authenticated_oid]::oid[])
        AND position('users_id' IN policy.compact_using) > 0
        AND position('auth_user_id=auth.uid()' IN policy.compact_using) > 0
    ) = 1 AS authenticated_owner_select,
    count(*) FILTER (
      WHERE (policy.polroles @> ARRAY[roles.authenticated_oid]::oid[] OR policy.polroles @> ARRAY[0::oid]::oid[])
        AND policy.polcmd IN ('a', 'w', 'd', '*')
    ) = 0 AS no_authenticated_dml_policy,
    (SELECT count(*) FILTER (WHERE grant_row.privilege_type IN ('SELECT', 'INSERT')) = 2
      FROM table_grants AS grant_row
      WHERE grant_row.table_name = 'lead_validation_attempts'
        AND grant_row.grantee = 'service_role') AS service_role_table_access,
    NOT EXISTS (
      SELECT 1 FROM table_grants AS grant_row
      WHERE grant_row.table_name = 'lead_validation_attempts'
        AND grant_row.grantee = 'service_role'
        AND grant_row.privilege_type IN ('UPDATE', 'DELETE', 'TRUNCATE')
    ) AS service_role_append_only,
    coalesce(jsonb_agg(jsonb_build_object(
      'name', policy.policy_name,
      'command', policy.polcmd,
      'using', policy.using_expression
    ) ORDER BY policy.policy_name) FILTER (WHERE policy.policy_name IS NOT NULL), '[]'::jsonb) AS policies
  FROM roles
  LEFT JOIN policy_inventory AS policy ON policy.table_name = 'lead_validation_attempts'
  GROUP BY roles.authenticated_oid
),
whatsapp_proof_contract AS (
  SELECT
    count(*) FILTER (WHERE function_row.exists) = 3 AS functions_exist,
    coalesce((SELECT contract.table_exists
      AND contract.rls_enabled
      AND contract.authenticated_owner_select
      AND contract.no_authenticated_dml_policy
      AND contract.service_role_table_access
      AND contract.service_role_append_only
      FROM validation_attempts_contract AS contract), false) AS attempts_ledger_contract,
    coalesce((SELECT count(*) = 1
      FROM function_acl AS access
      CROSS JOIN roles
      WHERE access.function_name = 'record_whatsapp_validation_result'
        AND access.grantee = roles.service_role_oid
        AND access.privilege_type = 'EXECUTE'), false) AS service_role_record_execute,
    coalesce((SELECT count(*) = 0
      FROM function_acl AS access
      CROSS JOIN roles
      WHERE access.function_name = 'record_whatsapp_validation_result'
        AND access.grantee IN (0::oid, roles.authenticated_oid)
        AND access.privilege_type = 'EXECUTE'), false) AS record_not_public_or_authenticated,
    coalesce(jsonb_agg(jsonb_build_object(
      'name', function_row.function_name,
      'signature', function_row.actual_identity_arguments,
      'exists', function_row.exists
    ) ORDER BY function_row.position), '[]'::jsonb) AS functions
  FROM function_inventory AS function_row
  WHERE function_row.check_group = 'whatsapp_proof'
),
whatsapp_proof_result AS (
  SELECT
    contract.*,
    contract.functions_exist
      AND contract.attempts_ledger_contract
      AND contract.service_role_record_execute
      AND contract.record_not_public_or_authenticated AS passed
  FROM whatsapp_proof_contract AS contract
),
validation_results_catalog AS (
  SELECT
    count(*) = 3 AS exactly_three_rows,
    count(*) FILTER (WHERE lead_validation_results_id = 1 AND lead_validation_results_key = 'valido' AND lead_validation_results_name = 'Válido') = 1 AS valid_result,
    count(*) FILTER (WHERE lead_validation_results_id = 2 AND lead_validation_results_key = 'nao_encontrado' AND lead_validation_results_name = 'Não encontrado') = 1 AS not_found_result,
    count(*) FILTER (WHERE lead_validation_results_id = 3 AND lead_validation_results_key = 'erro_tecnico' AND lead_validation_results_name = 'Erro técnico') = 1 AS technical_error_result,
    coalesce(max(lead_validation_results_id), 0) AS max_id,
    coalesce(jsonb_agg(jsonb_build_object(
      'id', lead_validation_results_id,
      'key', lead_validation_results_key,
      'name', lead_validation_results_name
    ) ORDER BY lead_validation_results_id), '[]'::jsonb) AS rows
  FROM public.lead_validation_results
),
validation_results_identity AS (
  SELECT
    coalesce(attribute.attidentity = 'a', false) AS generated_always,
    sequence_relation.oid IS NOT NULL AS sequence_exists,
    sequence_namespace.nspname AS sequence_schema,
    sequence_relation.relname AS sequence_name,
    sequence_parameters.seqstart AS start_value,
    sequence_parameters.seqincrement AS increment_by,
    sequence_view.last_value,
    CASE
      WHEN sequence_view.last_value IS NULL THEN sequence_parameters.seqstart
      ELSE sequence_view.last_value + sequence_parameters.seqincrement
    END AS next_candidate
  FROM (SELECT 1 AS singleton) AS seed
  LEFT JOIN pg_catalog.pg_attribute AS attribute
    ON attribute.attrelid = pg_catalog.to_regclass('public.lead_validation_results')
   AND attribute.attname = 'lead_validation_results_id'
   AND attribute.attnum > 0
   AND NOT attribute.attisdropped
  LEFT JOIN pg_catalog.pg_depend AS dependency
    ON dependency.refobjid = attribute.attrelid
   AND dependency.refobjsubid = attribute.attnum
   AND dependency.classid = 'pg_catalog.pg_class'::pg_catalog.regclass
   AND dependency.refclassid = 'pg_catalog.pg_class'::pg_catalog.regclass
   AND dependency.deptype = 'i'
  LEFT JOIN pg_catalog.pg_class AS sequence_relation
    ON sequence_relation.oid = dependency.objid
   AND sequence_relation.relkind = 'S'
  LEFT JOIN pg_catalog.pg_namespace AS sequence_namespace
    ON sequence_namespace.oid = sequence_relation.relnamespace
  LEFT JOIN pg_catalog.pg_sequence AS sequence_parameters
    ON sequence_parameters.seqrelid = sequence_relation.oid
  LEFT JOIN pg_catalog.pg_sequences AS sequence_view
    ON sequence_view.schemaname = sequence_namespace.nspname
   AND sequence_view.sequencename = sequence_relation.relname
),
validation_results_result AS (
  SELECT
    catalog.*,
    identity.generated_always,
    identity.sequence_exists,
    identity.sequence_schema,
    identity.sequence_name,
    identity.start_value,
    identity.increment_by,
    identity.last_value,
    identity.next_candidate,
    coalesce(
      catalog.exactly_three_rows
        AND catalog.valid_result
        AND catalog.not_found_result
        AND catalog.technical_error_result
        AND catalog.max_id >= 3
        AND identity.generated_always
        AND identity.sequence_exists
        AND identity.last_value >= catalog.max_id
        AND identity.next_candidate > catalog.max_id,
      false
    ) AS passed
  FROM validation_results_catalog AS catalog
  CROSS JOIN validation_results_identity AS identity
),
expected_foreign_keys(constraint_name, position) AS (
  VALUES
    ('leads_branches_id_fkey', 1),
    ('leads_contact_sources_id_fkey', 2),
    ('leads_channels_id_fkey', 3),
    ('leads_users_id_fkey', 4),
    ('lead_validation_attempts_users_id_fkey', 5),
    ('lead_validation_attempts_leads_id_fkey', 6),
    ('lead_validation_attempts_channels_id_fkey', 7),
    ('lead_validation_attempts_chips_id_fkey', 8),
    ('lead_validation_attempts_queue_items_id_fkey', 9),
    ('lead_validation_attempts_result_id_fkey', 10),
    ('lead_validation_attempts_status_id_fkey', 11)
),
foreign_key_inventory AS (
  SELECT
    expected.constraint_name,
    expected.position,
    constraint_record.oid IS NOT NULL AS exists,
    coalesce(constraint_record.convalidated, false) AS validated,
    CASE WHEN constraint_record.oid IS NULL THEN NULL ELSE pg_catalog.pg_get_constraintdef(constraint_record.oid, true) END AS definition
  FROM expected_foreign_keys AS expected
  LEFT JOIN pg_catalog.pg_constraint AS constraint_record
    ON constraint_record.connamespace = pg_catalog.to_regnamespace('public')
   AND constraint_record.conname = expected.constraint_name
   AND constraint_record.contype = 'f'
),
foreign_keys_result AS (
  SELECT
    count(*) = 11 AND bool_and(foreign_key.exists AND foreign_key.validated) AS passed,
    jsonb_agg(jsonb_build_object(
      'name', foreign_key.constraint_name,
      'exists', foreign_key.exists,
      'validated', foreign_key.validated,
      'definition', foreign_key.definition
    ) ORDER BY foreign_key.position) AS constraints
  FROM foreign_key_inventory AS foreign_key
),
checks AS (
  SELECT
    jsonb_build_object(
      'status', CASE WHEN cadence.classification = 'present' THEN 'pass' ELSE 'fail' END,
      'reason', CASE WHEN cadence.classification = 'present' THEN 'Cadência WhatsApp corresponde ao contrato esperado.' ELSE 'Cadência WhatsApp ausente ou divergente.' END,
      'evidence', jsonb_build_object(
        'classification', cadence.classification,
        'pausedAtColumn', cadence.paused_column_exists,
        'functionsExist', cadence.functions_exist,
        'definitionsMatch', cadence.definitions_match
      )
    ) AS whatsapp_cadence,
    jsonb_build_object(
      'status', CASE WHEN contact.passed THEN 'pass' ELSE 'fail' END,
      'reason', CASE WHEN contact.passed THEN 'contact_sources possui somente o contrato owner-only esperado.' ELSE 'RLS ou policies de contact_sources estão ausentes ou permissivas.' END,
      'evidence', to_jsonb(contact)
    ) AS contact_sources_rls,
    jsonb_build_object(
      'status', CASE WHEN sents.passed THEN 'pass' ELSE 'fail' END,
      'reason', CASE WHEN sents.passed THEN 'sents permanece append-only para authenticated.' ELSE 'Contrato efetivo de policies de sents divergiu.' END,
      'evidence', to_jsonb(sents)
    ) AS sents_append_only,
    jsonb_build_object(
      'status', CASE WHEN health.classification = 'present' THEN 'pass' ELSE 'fail' END,
      'reason', CASE WHEN health.classification = 'present' THEN 'Operational health usa status_id corretamente.' ELSE 'get_operational_health está ausente ou divergente.' END,
      'evidence', to_jsonb(health)
    ) AS operational_health,
    jsonb_build_object(
      'status', CASE WHEN identity.passed THEN 'pass' ELSE 'fail' END,
      'reason', CASE WHEN identity.passed THEN 'Identity forward-only está estruturalmente instalada com barreira de legado.' ELSE 'Contrato forward-only está incompleto ou divergente.' END,
      'evidence', to_jsonb(identity) || jsonb_build_object(
        'column', (SELECT to_jsonb(column_row) FROM identity_column AS column_row),
        'triggers', coalesce((SELECT jsonb_agg(to_jsonb(trigger_row) ORDER BY trigger_row.trigger_name) FROM identity_triggers AS trigger_row), '[]'::jsonb)
      )
    ) AS identity_forward_only,
    jsonb_build_object(
      'status', CASE WHEN proof.passed THEN 'pass' ELSE 'fail' END,
      'reason', CASE WHEN proof.passed THEN 'Prova WhatsApp e ledger append-only estão operacionais.' ELSE 'Funções, RLS, policies ou privilégios da prova WhatsApp divergiram.' END,
      'evidence', to_jsonb(proof) || jsonb_build_object(
        'attempts', (SELECT to_jsonb(attempts) FROM validation_attempts_contract AS attempts)
      )
    ) AS whatsapp_validation_proof,
    jsonb_build_object(
      'status', CASE WHEN validation_results.passed THEN 'pass' ELSE 'fail' END,
      'reason', CASE WHEN validation_results.passed THEN 'Catálogo e identity sequence estão coerentes.' ELSE 'Catálogo canônico ou identity sequence de resultados divergiu.' END,
      'evidence', to_jsonb(validation_results)
    ) AS lead_validation_results,
    jsonb_build_object(
      'status', CASE WHEN foreign_keys.passed THEN 'pass' ELSE 'fail' END,
      'reason', CASE WHEN foreign_keys.passed THEN 'Todas as foreign keys críticas existem e estão validadas.' ELSE 'Uma ou mais foreign keys críticas estão ausentes ou NOT VALID.' END,
      'evidence', foreign_keys.constraints
    ) AS critical_foreign_keys,
    cadence.classification = 'present'
      AND contact.passed
      AND sents.passed
      AND health.classification = 'present'
      AND identity.passed
      AND proof.passed
      AND validation_results.passed
      AND foreign_keys.passed AS all_passed
  FROM cadence_result AS cadence
  CROSS JOIN contact_sources_result AS contact
  CROSS JOIN sents_result AS sents
  CROSS JOIN health_result AS health
  CROSS JOIN identity_result AS identity
  CROSS JOIN whatsapp_proof_result AS proof
  CROSS JOIN validation_results_result AS validation_results
  CROSS JOIN foreign_keys_result AS foreign_keys
)
SELECT jsonb_build_object(
  'readyForDeploy', checks.all_passed,
  'checkedAt', pg_catalog.statement_timestamp(),
  'readOnly', true,
  'checks', jsonb_build_object(
    'whatsappCadence', checks.whatsapp_cadence,
    'contactSourcesRls', checks.contact_sources_rls,
    'sentsAppendOnly', checks.sents_append_only,
    'operationalHealth', checks.operational_health,
    'identityForwardOnly', checks.identity_forward_only,
    'whatsappValidationProof', checks.whatsapp_validation_proof,
    'leadValidationResults', checks.lead_validation_results,
    'criticalForeignKeys', checks.critical_foreign_keys
  )
) AS production_post_migration_check
FROM checks;
