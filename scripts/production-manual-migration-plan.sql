-- PLANO SOMENTE LEITURA. Este arquivo NAO executa migrations.
-- A ordem abaixo e uma whitelist manual e deliberadamente nao faz scan de supabase/migrations.
WITH manual_sequence(
  execution_order,
  migration_file,
  required_tables,
  required_columns,
  required_functions,
  required_prior_migrations,
  depends_on_blocked_identity,
  isolated_application,
  notes
) AS (
  VALUES
    (
      1,
      '20260806110000_preserve_whatsapp_batch_cadence.sql',
      ARRAY['public.worker_batches','public.worker_batch_items','public.queue_items','public.queue_item_dispatch_parts','public.channels','public.chips','public.instances'],
      ARRAY['worker_batches.worker_batches_next_run_at','worker_batches.worker_batches_heartbeat_at','worker_batch_items.worker_batch_items_started_at','queue_items.queue_items_started_at','queue_item_dispatch_parts.queue_item_dispatch_parts_state'],
      ARRAY['public.refresh_worker_batch_counters(bigint)'],
      ARRAY['20260802090000_worker_persistence_idempotency.sql'],
      false,
      'yes_when_preconditions_present',
      'Adiciona worker_batches_paused_at e redefine somente RPCs de pausa, conclusao e recuperacao.'
    ),
    (
      2,
      '20260806170000_contact_sources_owner_rls.sql',
      ARRAY['public.contact_sources','public.users'],
      ARRAY['contact_sources.users_id','users.users_id','users.auth_user_id'],
      ARRAY['auth.uid()'],
      ARRAY[]::text[],
      false,
      'yes_when_preconditions_present',
      'O acesso operacional owner-only tambem exige que o contrato atual de leitura propria de public.users esteja presente.'
    ),
    (
      3,
      '20260806180000_sents_append_only_rls.sql',
      ARRAY['public.sents','public.users'],
      ARRAY['sents.users_id','users.users_id','users.auth_user_id'],
      ARRAY['auth.uid()'],
      ARRAY[]::text[],
      false,
      'yes_when_preconditions_present',
      'Remove DML direto de authenticated e preserva SELECT owner-only.'
    ),
    (
      4,
      '20260807100000_fix_operational_health_batch_status.sql',
      ARRAY['public.worker_heartbeats','public.queue_items','public.queue_item_dispatch_parts','public.instagram_queue_progress','public.worker_batches','public.operational_alerts','public.recovery_requests'],
      ARRAY['worker_batches.status_id','worker_batches.worker_batches_heartbeat_at','queue_items.status_id','queue_item_dispatch_parts.queue_item_dispatch_parts_state','instagram_queue_progress.step'],
      ARRAY['public.ensure_current_user()'],
      ARRAY['20260802170000_observability_recovery.sql'],
      false,
      'yes_when_preconditions_present',
      'Redefine get_operational_health usando status_id; nao le nem altera public.leads.'
    ),
    (
      5,
      '20260812130000_install_forward_only_identity_contract.sql',
      ARRAY['public.leads','public.users','public.sents','public.audit_transition_rules'],
      ARRAY['leads.leads_id','leads.users_id','leads.lead_status_id','leads.leads_phone','leads.leads_instagram','leads.leads_website','leads.leads_maps'],
      ARRAY['public.ensure_current_user()','extensions.digest(bytea,text)'],
      ARRAY['20260802120000_persistent_audit_state_machine.sql'],
      false,
      'yes_when_preconditions_present',
      'Substitui integralmente a dependencia funcional das duas migrations de identity bloqueadas, sem backfill historico.'
    ),
    (
      6,
      '20260806190000_whatsapp_validation_proof.sql',
      ARRAY['public.lead_validation_attempts','public.lead_validation_results','public.leads','public.channels'],
      ARRAY['lead_validation_results.lead_validation_results_id','lead_validation_attempts.lead_validation_attempts_input_value','leads.leads_phone','leads.leads_instagram','leads.channels_id','leads.lead_status_id'],
      ARRAY['public.prepare_queue_items(text,bigint,date,jsonb)','public.append_audit_event(text,text,text,text,bigint,bigint,bigint,bigint,bigint,text,jsonb,bigint)','public.ensure_current_user()','public.unaccent(text)','public.normalize_identity_phone(text)','public.normalize_identity_instagram(text)'],
      ARRAY['20260802070000_atomic_queue_preparation.sql','20260802120000_persistent_audit_state_machine.sql','20260812130000_install_forward_only_identity_contract.sql'],
      false,
      'yes_only_after_forward_identity',
      'Deve ser aplicada uma unica vez: renomeia prepare_queue_items e instala a barreira de prova WhatsApp.'
    ),
    (
      7,
      '20260820210000_instance_runtime_state.sql',
      ARRAY['public.instances','public.instance_credentials','public.users'],
      ARRAY['instances.instances_id','instances.status_id','instances.users_id'],
      ARRAY['public.ensure_current_user()','public.save_instance_secure(bigint,text,text,text)'],
      ARRAY['20260802100000_secure_credentials_integrations.sql'],
      false,
      'yes_when_preconditions_present',
      'Separa o estado administrativo da instancia do estado operacional Evolution Go e normaliza cadastros existentes para ativo.'
    ),
    (
      8,
      '20260820211000_whatsapp_queue_runtime_guard.sql',
      ARRAY['public.instance_runtime_states','public.instances','public.chips'],
      ARRAY['instance_runtime_states.instances_id','instance_runtime_states.users_id','instance_runtime_states.session_saved'],
      ARRAY['public.prepare_queue_items_without_whatsapp_validation_proof(text,bigint,date,jsonb)'],
      ARRAY['20260820210000_instance_runtime_state.sql','20260806190000_whatsapp_validation_proof.sql'],
      false,
      'yes_after_instance_runtime_state',
      'Exige sessao persistida conhecida para reservar novos itens WhatsApp, sem usar o socket instantaneo como status administrativo.'
    )
),
blocked_migrations(migration_file, reason) AS (
  VALUES
    (
      '20260802130000_identity_dedup_suppression.sql',
      'PROIBIDA: executa UPDATE de todos os leads e backfill historico de registry/suppressions.'
    ),
    (
      '20260802131000_fix_instagram_identity_normalization.sql',
      'PROIBIDA: limpa/recalcula campos de leads historicos e remove dados derivados.'
    )
)
SELECT jsonb_build_object(
  'mode', 'manual_only_no_executor',
  'automatic_folder_scan', false,
  'sequence', (
    SELECT jsonb_agg(to_jsonb(step) ORDER BY step.execution_order)
    FROM manual_sequence AS step
  ),
  'blocked', (
    SELECT jsonb_agg(to_jsonb(blocked) ORDER BY blocked.migration_file)
    FROM blocked_migrations AS blocked
  )
) AS production_manual_migration_plan;

