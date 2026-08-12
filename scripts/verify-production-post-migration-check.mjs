import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const sqlPath = path.join(root, 'scripts', 'production-post-migration-check.sql');
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };
const sql = fs.existsSync(sqlPath) ? fs.readFileSync(sqlPath, 'utf8') : '';
const withoutComments = sql.replace(/--.*$/gm, '');
const withoutStrings = withoutComments.replace(/'(?:''|[^'])*'/g, "''");
const normalized = withoutComments.toLowerCase().replace(/\s+/g, ' ').trim();

assert(fs.existsSync(sqlPath), 'SQL de pos-validacao de producao ausente.');
assert(/^with\b/i.test(withoutComments.trim()), 'SQL deve iniciar por WITH e permanecer um unico statement.');
assert(normalized.endsWith('as production_post_migration_check from checks;'), 'SQL nao retorna a celula JSONB final esperada.');
assert((withoutComments.match(/;/g) ?? []).length === 1, 'SQL deve conter exatamente um statement.');
assert(/select\s+jsonb_build_object\s*\(/i.test(withoutComments), 'Resultado final nao e JSONB.');
assert(/'readyForDeploy'\s*,\s*checks\.all_passed/i.test(sql), 'readyForDeploy nao deriva da conjuncao dos checks.');
assert(/'checkedAt'\s*,\s*pg_catalog\.statement_timestamp\(\)/i.test(sql), 'checkedAt ausente.');
assert(/'readOnly'\s*,\s*true/i.test(sql), 'Marcador readOnly=true ausente.');

const forbiddenCommands = /\b(?:insert|update|delete|alter|create|drop|truncate|grant|revoke|merge|copy|call|do|execute|perform)\b/i;
assert(!forbiddenCommands.test(withoutStrings), 'SQL contem comando mutavel ou executor operacional.');
assert(!/\b(?:begin|commit|rollback|setval|nextval|currval)\b/i.test(withoutStrings), 'SQL controla transacao ou avanca sequence.');
assert(!/\b(?:query_to_xml|table_to_xml|database_to_xml|xmltable|xmlparse|xmlserialize|xpath|xmlelement|xmlagg)\b/i.test(withoutComments), 'SQL usa XML.');
assert(!/\b(?:vault|secret|secrets|token|tokens|credential|credentials|password)\b/i.test(withoutComments), 'SQL referencia credenciais ou armazenamento sensivel.');

assert(!/\b(?:from|join)\s+(?:only\s+)?public\.leads\b/i.test(withoutComments), 'SQL le conteudo de public.leads.');
const publicDataReads = [...withoutComments.matchAll(/\b(?:from|join)\s+(?:only\s+)?public\.([a-z0-9_]+)/gi)].map((match) => match[1]);
assert(publicDataReads.every((table) => table === 'lead_validation_results'), `SQL le tabela publica nao permitida: ${publicDataReads.join(', ')}.`);
assert(publicDataReads.filter((table) => table === 'lead_validation_results').length === 1, 'A unica leitura funcional permitida deve ser do catalogo lead_validation_results.');

for (const catalog of [
  'pg_catalog.pg_proc',
  'pg_catalog.pg_class',
  'pg_catalog.pg_attribute',
  'pg_catalog.pg_policy',
  'pg_catalog.pg_trigger',
  'pg_catalog.pg_constraint',
  'pg_catalog.pg_depend',
  'pg_catalog.pg_sequence',
  'pg_catalog.pg_sequences',
  'information_schema.role_table_grants',
]) {
  assert(sql.includes(catalog), `Catalogo estrutural ausente: ${catalog}.`);
}

for (const requiredGroup of [
  'whatsapp_cadence',
  'contact_sources_rls',
  'sents_append_only',
  'operational_health',
  'identity_forward_only',
  'whatsapp_validation_proof',
  'lead_validation_results',
  'critical_foreign_keys',
]) {
  assert(new RegExp(`\\b${requiredGroup}\\b`, 'i').test(sql), `Bloco obrigatorio ausente: ${requiredGroup}.`);
}

for (const signature of [
  ["worker_set_whatsapp_batch_state", 'bigint, text, text, text'],
  ["worker_complete_batch_item", 'bigint, text, text, timestamp with time zone'],
  ["worker_recover_stale_whatsapp", 'timestamp with time zone'],
  ["has_current_whatsapp_validation_proof", 'bigint, bigint'],
  ["current_user_whatsapp_validation_proofs", 'bigint[]'],
  ["record_whatsapp_validation_result", 'bigint, bigint, text, text, text, text, text, integer, text, text, jsonb'],
]) {
  assert(sql.includes(`'${signature[0]}', '${signature[1]}'`), `Assinatura ausente: ${signature[0]}(${signature[1]}).`);
}
assert(sql.includes("'present'") && sql.includes("'absent'") && sql.includes("'divergent'"), 'Classificacao present/absent/divergent incompleta.');
assert(sql.includes("'worker_batches_paused_at'"), 'worker_batches_paused_at nao e inspecionada.');
assert(sql.includes("position('worker_batches_status'"), 'Referencia legada worker_batches_status nao e detectada.');
assert(sql.includes("position('status_idin(3,4,8)'"), 'Contrato de lotes ativos nao e verificado.');
assert(sql.includes("position('status_id=4andworker_batches_heartbeat_at'"), 'Contrato stale de lotes nao e verificado.');

for (const policy of [
  'contact_sources_own_select',
  'contact_sources_own_insert',
  'contact_sources_own_update',
  'contact_sources_own_delete',
  'sents_own_select',
  'lead_validation_attempts_select_own',
]) {
  assert(sql.includes(`'${policy}'`), `Policy nao verificada: ${policy}.`);
}
assert(sql.includes("policy.compact_using IN ('true', '(true)')"), 'SELECT global USING true de contact_sources nao e detectado semanticamente.');
assert(sql.includes("policy.polcmd IN ('a', 'w', 'd', '*')"), 'Policies DML/ALL de authenticated nao sao bloqueadas.');
assert(!/sents\.passed[\s\S]{0,180}authenticated_grants/i.test(sql), 'Grants brutos nao podem ser a unica barreira efetiva de sents.');

assert(sql.includes("'leads_identity_contract_version'"), 'Marcador forward-only nao e inspecionado.');
assert(sql.includes("data_type = 'smallint' AND nullable AND default_expression IS NULL"), 'Tipo, nulabilidade e ausencia de DEFAULT nao sao validados.');
for (const functionName of [
  'normalize_identity_phone',
  'normalize_identity_instagram',
  'prepare_lead_identity',
  'register_lead_identity',
  'suppress_lead_identities',
  'suppress_after_lead_sent',
]) {
  assert(sql.includes(`'${functionName}'`), `Funcao forward-only nao verificada: ${functionName}.`);
}
for (const triggerName of [
  'prepare_lead_identity_trigger',
  'register_lead_identity_trigger',
  'suppress_after_lead_sent_trigger',
]) {
  assert(sql.includes(`'${triggerName}'`), `Trigger forward-only nao verificado: ${triggerName}.`);
}
assert(sql.includes("old.leads_identity_contract_versionisdistinctfrom1"), 'Barreira de update do legado nao e verificada.');
assert(sql.includes("new.leads_identity_contract_versionisdistinctfrom1"), 'Barreiras auxiliares do legado nao sao verificadas.');
assert(sql.includes("'lead_identity_registry'"), 'lead_identity_registry nao e inspecionada.');
assert(sql.includes("'contact_suppressions'"), 'contact_suppressions nao e inspecionada.');

assert(sql.includes("attribute.attidentity = 'a'"), 'GENERATED ALWAYS AS IDENTITY nao e confirmado.');
assert(sql.includes('identity.last_value >= catalog.max_id'), 'Sequence nao e comparada ao maior ID do catalogo.');
assert(sql.includes('identity.next_candidate > catalog.max_id'), 'Proxima geracao nao e verificada contra colisao.');
for (const catalogEntry of [
  "lead_validation_results_id = 1 AND lead_validation_results_key = 'valido' AND lead_validation_results_name = 'Válido'",
  "lead_validation_results_id = 2 AND lead_validation_results_key = 'nao_encontrado' AND lead_validation_results_name = 'Não encontrado'",
  "lead_validation_results_id = 3 AND lead_validation_results_key = 'erro_tecnico' AND lead_validation_results_name = 'Erro técnico'",
]) {
  assert(sql.includes(catalogEntry), `Registro canonico nao e validado: ${catalogEntry}.`);
}

for (const foreignKey of [
  'leads_branches_id_fkey',
  'leads_contact_sources_id_fkey',
  'leads_channels_id_fkey',
  'leads_users_id_fkey',
  'lead_validation_attempts_users_id_fkey',
  'lead_validation_attempts_leads_id_fkey',
  'lead_validation_attempts_channels_id_fkey',
  'lead_validation_attempts_chips_id_fkey',
  'lead_validation_attempts_queue_items_id_fkey',
  'lead_validation_attempts_result_id_fkey',
  'lead_validation_attempts_status_id_fkey',
]) {
  assert(sql.includes(`'${foreignKey}'`), `Foreign key critica nao verificada: ${foreignKey}.`);
}
assert(sql.includes('foreign_key.exists AND foreign_key.validated'), 'FKs nao exigem existencia e convalidated=true.');

assert((sql.match(/'status'/g) ?? []).length >= 8, 'Cada grupo deve retornar status.');
assert((sql.match(/'reason'/g) ?? []).length >= 8, 'Cada grupo deve retornar reason.');
assert((sql.match(/'evidence'/g) ?? []).length >= 8, 'Cada grupo deve retornar evidence.');

if (failures.length) {
  console.error(`Falhas no verificador pos-migration (${failures.length}):`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('OK: pos-validacao e um statement read-only que retorna uma celula JSONB.');
console.log('OK: oito contratos criticos controlam readyForDeploy sem ler public.leads.');
