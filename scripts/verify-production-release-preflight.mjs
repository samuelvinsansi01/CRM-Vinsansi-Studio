import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const sqlPath = path.join(root, 'scripts', 'production-release-preflight.sql');
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };
const sql = fs.existsSync(sqlPath) ? fs.readFileSync(sqlPath, 'utf8') : '';
const withoutComments = sql.replace(/--.*$/gm, '');
const withoutStrings = withoutComments.replace(/'(?:''|[^'])*'/g, "''");
const normalized = withoutComments.toLowerCase().replace(/\s+/g, ' ').trim();

assert(fs.existsSync(sqlPath), 'SQL de preflight de producao ausente.');
assert(/^with\b/i.test(withoutComments.trim()), 'Preflight deve ser uma unica consulta WITH ... SELECT.');
assert(normalized.endsWith('as production_release_preflight;'), 'Preflight nao retorna a coluna JSON unica esperada.');
assert((withoutComments.match(/;/g) ?? []).length === 1, 'Preflight deve conter exatamente um statement.');
assert(/select\s+jsonb_build_object\s*\(/i.test(withoutComments), 'Resultado final nao e um objeto JSONB.');

const forbiddenCommands = /\b(?:insert|update|delete|alter|create|drop|truncate|grant|revoke|merge|copy|call|do|execute|perform|setval|nextval)\b/i;
assert(!forbiddenCommands.test(withoutStrings), 'Preflight contem comando ou chamada potencialmente mutavel.');
assert(!/\b(?:begin|commit|rollback)\b/i.test(withoutStrings), 'Preflight nao deve controlar transacao.');

const expectedMigrations = [
  '20260730171000_user_profile',
  '20260802070000_atomic_queue_preparation',
  '20260802080000_queue_payload_snapshot',
  '20260802090000_worker_persistence_idempotency',
  '20260802100000_secure_credentials_integrations',
  '20260802110000_centralized_operational_settings',
  '20260802120000_persistent_audit_state_machine',
  '20260802130000_identity_dedup_suppression',
  '20260802131000_fix_instagram_identity_normalization',
  '20260802140000_permanent_base_consolidation',
  '20260802150000_instagram_execution_progress',
  '20260802160000_schema_release_manifest',
  '20260802170000_observability_recovery',
  '20260802180000_chip_conversations_chat',
  '20260806110000_preserve_whatsapp_batch_cadence',
  '20260806170000_contact_sources_owner_rls',
  '20260806180000_sents_append_only_rls',
  '20260806190000_whatsapp_validation_proof',
  '20260807090000_users_owner_rls',
  '20260807100000_fix_operational_health_batch_status',
  '20260812100000_restore_bootstrap_foreign_keys',
  '20260812110000_restore_base_rls_policies',
  '20260812120000_seed_canonical_locations',
];
for (const migration of expectedMigrations) {
  assert(sql.includes(migration), `Migration esperada ausente do diagnostico: ${migration}.`);
}

assert(sql.includes("namespace.nspname = 'supabase_migrations'") && sql.includes("relation.relname = 'schema_migrations'"), 'Ledger padrao do Supabase nao e detectado.');
assert(sql.includes('pg_catalog.has_table_privilege') && sql.includes("'found_but_not_readable_or_incompatible'") && sql.includes("'not_found'"), 'Ausencia ou inacessibilidade do ledger nao e retornada de forma estruturada.');
assert(sql.includes('pg_catalog.query_to_xml') && /'SELECT version::text AS version, %s AS name FROM %I\.%I ORDER BY version'/.test(sql), 'Leitura dinamica do ledger nao esta limitada a SELECT.');
assert(/pg_catalog\.query_to_xml\([\s\S]*?\),\s*false,\s*false,\s*''\s*\)/i.test(sql), 'query_to_xml deve produzir um documento unico com tableforest=false.');
assert(!/pg_catalog\.query_to_xml\([\s\S]*?\),\s*false,\s*true,\s*''\s*\)/i.test(sql), 'query_to_xml ainda produz fragmentos <row> sem root com tableforest=true.');
assert(/XMLTABLE\(\s*'\/table\/row'/i.test(sql), 'XMLTABLE deve ler os rows dentro do root unico <table>.');

for (const functionName of [
  'unaccent', 'get_operational_health', 'guard_queue_item_capacity',
  'prepare_queue_items', 'prepare_queue_items_without_whatsapp_validation_proof',
  'has_current_whatsapp_validation_proof', 'current_user_whatsapp_validation_proofs',
  'record_whatsapp_validation_result',
]) {
  assert(sql.includes(`'${functionName}'`), `Funcao critica ausente: ${functionName}.`);
}
assert(sql.includes('pg_catalog.to_regprocedure') && sql.includes('pg_catalog.pg_get_functiondef') && sql.includes('pg_catalog.pg_get_function_identity_arguments'), 'Assinatura ou definicao resumida das funcoes nao e coletada pelo catalogo PostgreSQL.');

for (const table of [
  'worker_batches', 'worker_batch_items', 'queue_item_dispatch_parts',
  'lead_identity_registry', 'contact_suppressions',
  'permanent_records', 'permanent_record_snapshots',
  'instagram_queue_progress', 'instagram_dispatch_events',
  'conversations', 'conversation_messages', 'conversation_message_events',
  'evolution_webhook_receipts',
]) {
  assert(sql.includes(`'${table}'`), `Tabela critica ausente: ${table}.`);
}

for (const table of ['users', 'contact_sources', 'sents', 'lead_validation_attempts', 'lead_validation_results']) {
  assert(sql.includes(`('${table}',`), `Tabela RLS critica ausente: ${table}.`);
}
assert(sql.includes('pg_catalog.pg_policies') && sql.includes('information_schema.role_table_grants'), 'Policies ou grants criticos nao sao inventariados.');

for (const constraint of [
  'leads_branches_id_fkey', 'leads_contact_sources_id_fkey',
  'leads_channels_id_fkey', 'leads_countries_id_fkey',
  'lead_validation_attempts_users_id_fkey', 'lead_validation_attempts_leads_id_fkey',
  'lead_validation_attempts_channels_id_fkey', 'lead_validation_attempts_result_id_fkey',
  'lead_validation_results_status_id_fkey',
]) {
  assert(sql.includes(`'${constraint}'`), `Foreign key critica ausente: ${constraint}.`);
}
assert(sql.includes('pg_catalog.pg_get_constraintdef'), 'Definicoes das foreign keys nao sao retornadas.');

for (const token of [
  "lower(trim(channels_name)) = 'whatsapp'",
  "lower(trim(channels_name)) = 'instagram'",
  "('sem_site'), ('dominio_proprio'), ('agregador'), ('instagram')",
  "upper(trim(country.countries_code)) = 'BR'",
  '= 27',
  '= 5571',
]) {
  assert(sql.includes(token), `Confirmacao de catalogo ausente: ${token}.`);
}

const forbiddenDataSources = [
  'public.leads', 'public.queues', 'public.queue_items', 'public.sents',
  'public.lead_validation_attempts', 'public.worker_batches',
  'public.worker_batch_items', 'vault.', 'decrypted_secrets',
];
for (const source of forbiddenDataSources) {
  assert(!new RegExp(`\\bfrom\\s+${source.replace('.', '\\.')}\\b`, 'i').test(withoutComments), `Preflight consulta conteudo proibido: ${source}.`);
}
assert(!/\b(?:token|secret|password|recipient|leads_phone|leads_instagram)\b/i.test(withoutComments), 'Preflight referencia segredo ou conteudo de lead.');

if (failures.length) {
  console.error(`Falhas no preflight de producao (${failures.length}):`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('OK: preflight de producao retorna um JSON unico e tolera ledger ausente ou inacessivel.');
console.log('OK: somente SELECT e catalogos PostgreSQL; sem dados operacionais, secrets ou comandos mutaveis.');
