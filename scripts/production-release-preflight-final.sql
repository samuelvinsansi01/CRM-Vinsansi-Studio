-- COMPLEMENTO READ-ONLY: somente cadencia WhatsApp e operational health.
-- Retorna uma unica celula JSONB e consulta exclusivamente pg_catalog.
WITH
expected_functions(section_name, function_name, identity_arguments, position) AS (
  VALUES
    ('whatsapp_cadence', 'worker_set_whatsapp_batch_state', 'bigint, text, text, text', 1),
    ('whatsapp_cadence', 'worker_complete_batch_item', 'bigint, text, text, timestamp with time zone', 2),
    ('whatsapp_cadence', 'worker_recover_stale_whatsapp', 'timestamp with time zone', 3),
    ('operational_health', 'get_operational_health', '', 4)
),
function_inventory AS (
  SELECT
    expected.section_name,
    expected.function_name,
    expected.identity_arguments,
    procedure.oid,
    procedure.oid IS NOT NULL AS exists,
    CASE WHEN procedure.oid IS NULL THEN NULL ELSE pg_catalog.pg_get_functiondef(procedure.oid) END AS definition,
    CASE WHEN procedure.oid IS NULL THEN NULL ELSE lower(pg_catalog.pg_get_functiondef(procedure.oid)) END AS normalized_definition,
    CASE
      WHEN procedure.oid IS NULL THEN NULL
      ELSE regexp_replace(lower(pg_catalog.pg_get_functiondef(procedure.oid)), '[[:space:]]+', '', 'g')
    END AS compact_definition,
    expected.position
  FROM expected_functions AS expected
  LEFT JOIN pg_catalog.pg_proc AS procedure
    ON procedure.oid = pg_catalog.to_regprocedure(
      pg_catalog.format('public.%I(%s)', expected.function_name, expected.identity_arguments)
    )
),
paused_column AS (
  SELECT
    attribute.attname IS NOT NULL AS exists,
    CASE WHEN attribute.attname IS NULL THEN NULL ELSE pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) END AS data_type,
    CASE WHEN attribute.attname IS NULL THEN NULL ELSE NOT attribute.attnotnull END AS nullable
  FROM (SELECT 1 AS singleton) AS seed
  LEFT JOIN pg_catalog.pg_namespace AS namespace ON namespace.nspname = 'public'
  LEFT JOIN pg_catalog.pg_class AS relation
    ON relation.relnamespace = namespace.oid
   AND relation.relname = 'worker_batches'
   AND relation.relkind IN ('r', 'p')
  LEFT JOIN pg_catalog.pg_attribute AS attribute
    ON attribute.attrelid = relation.oid
   AND attribute.attname = 'worker_batches_paused_at'
   AND attribute.attnum > 0
   AND NOT attribute.attisdropped
),
cadence_checks AS (
  SELECT
    (SELECT exists FROM paused_column) AS paused_column_exists,
    COALESCE((SELECT exists FROM function_inventory WHERE function_name = 'worker_set_whatsapp_batch_state'), false) AS set_state_exists,
    COALESCE((SELECT exists FROM function_inventory WHERE function_name = 'worker_complete_batch_item'), false) AS complete_item_exists,
    COALESCE((SELECT exists FROM function_inventory WHERE function_name = 'worker_recover_stale_whatsapp'), false) AS recover_stale_exists,
    COALESCE((
      SELECT
        position('v_action=''pause''andv_batch.status_idin(3,4)' IN compact_definition) > 0
        AND position('worker_batches_paused_at=now()' IN compact_definition) > 0
        AND position('v_action=''pause''andv_batch.status_id=8' IN compact_definition) > 0
        AND position('v_action=''resume''andv_batch.status_id=8' IN compact_definition) > 0
        AND position('now()+greatest(worker_batches_next_run_at-worker_batches_paused_at,interval''0seconds'')' IN compact_definition) > 0
        AND position('worker_batches_paused_at=null' IN compact_definition) > 0
      FROM function_inventory
      WHERE function_name = 'worker_set_whatsapp_batch_state'
    ), false) AS set_state_contract,
    COALESCE((
      SELECT
        position('worker_batches_next_run_at=casewhenstatus_idin(4,8)thenp_next_run_at' IN compact_definition) > 0
        AND position('worker_batches_paused_at=casewhenstatus_id=8thennow()' IN compact_definition) > 0
        AND position('wb.status_idin(4,8)' IN compact_definition) > 0
        AND position('wbi.status_idin(3,4)' IN compact_definition) > 0
        AND position('worker_batches_next_run_at=null' IN compact_definition) > 0
        AND position('worker_batches_paused_at=null' IN compact_definition) > 0
      FROM function_inventory
      WHERE function_name = 'worker_complete_batch_item'
    ), false) AS complete_item_contract,
    COALESCE((
      SELECT
        position('reconciliation_required' IN compact_definition) > 0
        AND position('wb.status_idin(4,8)' IN compact_definition) > 0
        AND position('wbi.status_idin(3,4)' IN compact_definition) > 0
        AND position('worker_batches_next_run_at=null' IN compact_definition) > 0
        AND position('worker_batches_paused_at=null' IN compact_definition) > 0
        AND position('worker_batches_next_run_at=greatest(coalesce(worker_batches_next_run_at,now()),now())' IN compact_definition) > 0
        AND position('wherestatus_id=4' IN compact_definition) > 0
      FROM function_inventory
      WHERE function_name = 'worker_recover_stale_whatsapp'
    ), false) AS recover_stale_contract
),
cadence_classification AS (
  SELECT
    checks.*,
    CASE
      WHEN NOT checks.paused_column_exists
        OR NOT checks.set_state_exists
        OR NOT checks.complete_item_exists
        OR NOT checks.recover_stale_exists
        THEN 'absent'
      WHEN checks.set_state_contract
        AND checks.complete_item_contract
        AND checks.recover_stale_contract
        THEN 'present'
      ELSE 'divergent'
    END AS migration_status
  FROM cadence_checks AS checks
),
health_function AS (
  SELECT *
  FROM function_inventory
  WHERE function_name = 'get_operational_health'
),
health_checks AS (
  SELECT
    health.exists,
    health.definition,
    COALESCE(position('frompublic.worker_batcheswhereusers_id=v_userandstatus_id' IN health.compact_definition) > 0, false)
      AS references_worker_batches_status_id,
    COALESCE(position('worker_batches_status' IN health.compact_definition) > 0, false)
      AS references_worker_batches_status_legacy,
    COALESCE(position('status_idin(3,4,8)' IN health.compact_definition) > 0, false)
      AS active_status_contract,
    COALESCE(position('status_id=4andworker_batches_heartbeat_at' IN health.compact_definition) > 0, false)
      AS stale_status_contract,
    COALESCE(
      position('''workers''' IN health.compact_definition) > 0
      AND position('''queues''' IN health.compact_definition) > 0
      AND position('''reconciliation''' IN health.compact_definition) > 0
      AND position('''batches''' IN health.compact_definition) > 0
      AND position('''alerts''' IN health.compact_definition) > 0
      AND position('''latestrecovery''' IN health.compact_definition) > 0,
      false
    ) AS response_contract
  FROM health_function AS health
),
health_classification AS (
  SELECT
    checks.*,
    CASE
      WHEN NOT checks.exists THEN 'absent'
      WHEN checks.references_worker_batches_status_id
        AND NOT checks.references_worker_batches_status_legacy
        AND checks.active_status_contract
        AND checks.stale_status_contract
        AND checks.response_contract
        THEN 'present'
      ELSE 'divergent'
    END AS migration_status
  FROM health_checks AS checks
)
SELECT jsonb_build_object(
  'checkedAt', pg_catalog.statement_timestamp(),
  'readOnly', true,
  'whatsappCadence', jsonb_build_object(
    'migration', '20260806110000_preserve_whatsapp_batch_cadence.sql',
    'status', (SELECT migration_status FROM cadence_classification),
    'pausedAtColumn', (
      SELECT jsonb_build_object('exists', exists, 'dataType', data_type, 'nullable', nullable)
      FROM paused_column
    ),
    'contractChecks', (
      SELECT jsonb_build_object(
        'workerSetBatchState', set_state_contract,
        'workerCompleteBatchItem', complete_item_contract,
        'workerRecoverStaleWhatsApp', recover_stale_contract
      )
      FROM cadence_classification
    ),
    'functions', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'name', function_row.function_name,
          'identityArguments', function_row.identity_arguments,
          'exists', function_row.exists,
          'definition', function_row.definition
        ) ORDER BY function_row.position
      )
      FROM function_inventory AS function_row
      WHERE function_row.section_name = 'whatsapp_cadence'
    ), '[]'::jsonb)
  ),
  'operationalHealth', (
    SELECT jsonb_build_object(
      'migration', '20260807100000_fix_operational_health_batch_status.sql',
      'status', health.migration_status,
      'functionExists', health.exists,
      'referencesWorkerBatchesStatusId', health.references_worker_batches_status_id,
      'referencesWorkerBatchesStatusLegacy', health.references_worker_batches_status_legacy,
      'activeStatusContract', health.active_status_contract,
      'staleStatusContract', health.stale_status_contract,
      'responseContract', health.response_contract,
      'definition', health.definition
    )
    FROM health_classification AS health
  )
) AS production_release_preflight_final;
