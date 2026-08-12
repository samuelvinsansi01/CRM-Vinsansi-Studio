import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const sqlPath = path.join(root, 'scripts', 'production-release-preflight-final.sql');
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };
const sql = fs.existsSync(sqlPath) ? fs.readFileSync(sqlPath, 'utf8') : '';
const withoutComments = sql.replace(/--.*$/gm, '');
const withoutStrings = withoutComments.replace(/'(?:''|[^'])*'/g, "''");
const normalized = withoutComments.toLowerCase().replace(/\s+/g, ' ').trim();

assert(fs.existsSync(sqlPath), 'Complemento final de preflight ausente.');
assert(/^with\b/i.test(withoutComments.trim()), 'Complemento deve iniciar por WITH.');
assert(normalized.endsWith('as production_release_preflight_final;'), 'Complemento nao retorna a celula JSONB esperada.');
assert((withoutComments.match(/;/g) ?? []).length === 1, 'Complemento deve conter exatamente um statement.');
assert(/select\s+jsonb_build_object\s*\(/i.test(withoutComments), 'Resultado final nao e JSONB unico.');

const forbiddenCommands = /\b(?:insert|update|delete|alter|create|drop|truncate|grant|revoke|merge|copy|call|do|execute|perform|setval|nextval)\b/i;
assert(!forbiddenCommands.test(withoutStrings), 'Complemento contem comando ou chamada mutavel.');
assert(!/\b(?:begin|commit|rollback)\b/i.test(withoutStrings), 'Complemento nao deve controlar transacao.');
assert(!/\b(?:query_to_xml|xmltable|xmlparse|xpath)\b/i.test(withoutComments), 'Complemento nao deve usar XML.');

assert(sql.includes("'worker_batches_paused_at'"), 'Coluna worker_batches_paused_at nao e inspecionada.');
assert(sql.includes('pg_catalog.pg_attribute') && sql.includes('pg_catalog.format_type'), 'Existencia/tipo da coluna nao vem do catalogo PostgreSQL.');

for (const [name, signature] of [
  ['worker_set_whatsapp_batch_state', 'bigint, text, text, text'],
  ['worker_complete_batch_item', 'bigint, text, text, timestamp with time zone'],
  ['worker_recover_stale_whatsapp', 'timestamp with time zone'],
]) {
  assert(sql.includes(`'${name}', '${signature}'`), `Funcao de cadencia ausente: ${name}(${signature}).`);
}
assert(sql.includes('pg_catalog.to_regprocedure') && sql.includes('pg_catalog.pg_get_functiondef'), 'Funcoes nao sao resolvidas por assinatura com definicao completa.');

for (const contract of [
  "v_action=''pause''andv_batch.status_idin(3,4)",
  'worker_batches_paused_at=now()',
  "v_action=''resume''andv_batch.status_id=8",
  "now()+greatest(worker_batches_next_run_at-worker_batches_paused_at,interval''0seconds'')",
  'worker_batches_next_run_at=casewhenstatus_idin(4,8)thenp_next_run_at',
  'worker_batches_paused_at=casewhenstatus_id=8thennow()',
  'wb.status_idin(4,8)',
  'wbi.status_idin(3,4)',
  'reconciliation_required',
  'worker_batches_next_run_at=greatest(coalesce(worker_batches_next_run_at,now()),now())',
]) {
  assert(sql.includes(contract), `Contrato de cadencia nao verificado: ${contract}.`);
}

assert(sql.includes("'present'") && sql.includes("'absent'") && sql.includes("'divergent'"), 'Classificacao present/absent/divergent incompleta.');
assert(sql.includes("'20260806110000_preserve_whatsapp_batch_cadence.sql'"), 'Migration de cadencia nao e identificada.');

assert(sql.includes("'get_operational_health', ''"), 'get_operational_health() nao e resolvida.');
assert(sql.includes("'20260807100000_fix_operational_health_batch_status.sql'"), 'Migration de operational health nao e identificada.');
assert(sql.includes("position('frompublic.worker_batcheswhereusers_id=v_userandstatus_id'"), 'Referencia a worker_batches.status_id nao e confirmada.');
assert(sql.includes("position('worker_batches_status'"), 'Referencia legada worker_batches_status nao e detectada.');
assert(sql.includes("position('status_idin(3,4,8)'"), 'Contrato de lotes ativos nao e verificado.');
assert(sql.includes("position('status_id=4andworker_batches_heartbeat_at'"), 'Contrato de lote stale nao e verificado.');
assert(sql.includes("'definition', health.definition"), 'Definicao completa de get_operational_health nao e retornada.');

for (const forbiddenSource of [
  'public.leads', 'public.queues', 'public.queue_items', 'public.sents',
  'public.worker_batches', 'public.worker_batch_items', 'vault.',
]) {
  assert(!new RegExp(`\\bfrom\\s+${forbiddenSource.replace('.', '\\.')}\\b`, 'i').test(withoutComments), `Consulta dados operacionais: ${forbiddenSource}.`);
}
assert(!/\b(?:token|secret|password|leads_phone|leads_instagram|recipient)\b/i.test(withoutComments), 'Complemento referencia segredo ou conteudo operacional.');

if (failures.length) {
  console.error(`Falhas no complemento final (${failures.length}):`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('OK: complemento read-only classifica cadencia WhatsApp e operational health como present, absent ou divergent.');
console.log('OK: definicoes completas via pg_catalog, um statement JSONB e nenhuma leitura de dados operacionais.');
