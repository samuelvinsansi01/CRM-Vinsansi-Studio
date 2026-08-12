import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const seedPath = path.join(root, 'scripts', 'staging-seed-from-export.sql');
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };
const sql = fs.readFileSync(seedPath, 'utf8');
const executable = sql.replace(/--.*$/gm, '').toLowerCase();

const canonicalTables = [
  'audit_transition_rules', 'channels', 'cities', 'countries',
  'lead_status', 'lead_validation_results', 'states', 'status',
];
const tenantTables = [
  'branches', 'contact_sources', 'levels', 'template_channels',
  'template_types', 'template_variables', 'templates',
];
const allowedPublicWrites = new Set([...canonicalTables, ...tenantTables]);
const forbiddenTables = [
  'leads', 'queues', 'queue_items', 'sents', 'lead_validation_attempts',
  'worker_batches', 'worker_batch_items', 'chips', 'instances', 'socials',
  'audit_events', 'apify_accounts', 'apify_import_jobs', 'users',
];

assert(fs.existsSync(seedPath), 'Seed staging-only ausente.');
assert(!seedPath.includes(`${path.sep}supabase${path.sep}migrations${path.sep}`), 'Seed foi colocado na cadeia normal de migrations.');
assert(sql.includes('STAGING-ONLY') && sql.includes("v_confirmation <> 'STAGING_ONLY'"), 'Barreira explicita de staging ausente.');
assert(sql.includes('REPLACE_WITH_COMPLETE_STAGING_SEED_EXPORT_JSON'), 'Placeholder do snapshot completo ausente.');
assert(sql.includes('REPLACE_WITH_STAGING_AUTH_USER_ID'), 'Placeholder do auth_user_id de staging ausente.');
assert(sql.includes('WHERE u.auth_user_id = v_target_auth_user_id'), 'Usuario de staging nao e resolvido por auth_user_id explicito.');
assert(sql.includes('INTO STRICT v_target_users_id'), 'Resolucao do usuario de staging nao exige correspondencia unica.');
assert(!/\bsource_users_id\b/i.test(executable), 'Seed ainda transporta source_users_id da producao.');
assert(!/\busers_id\s*=\s*1\b/i.test(executable), 'Seed contem users_id de producao fixo.');

for (const table of [...canonicalTables, ...tenantTables]) {
  assert(sql.includes(`'{${canonicalTables.includes(table) ? 'canonical' : 'tenant'},${table}}'`), `Array de input ausente: ${table}.`);
}

const publicWrites = [...executable.matchAll(/\binsert\s+into\s+public\.([a-z0-9_]+)/g)].map((match) => match[1]);
assert(publicWrites.length === allowedPublicWrites.size, `Esperados ${allowedPublicWrites.size} INSERTs publicos; encontrados ${publicWrites.length}.`);
assert(publicWrites.every((table) => allowedPublicWrites.has(table)), 'Seed escreve fora das 15 tabelas aprovadas.');
assert([...allowedPublicWrites].every((table) => publicWrites.includes(table)), 'Alguma tabela aprovada nao recebe carga.');
assert(!/\b(update|delete\s+from|truncate|merge\s+into)\s+public\./i.test(executable), 'Seed altera ou apaga registros publicos existentes.');
assert(!/\bon\s+conflict\b/i.test(executable), 'Seed usa ON CONFLICT e pode esconder divergencias.');

for (const table of tenantTables) {
  const insert = new RegExp(`insert\\s+into\\s+public\\.${table}\\s*\\([\\s\\S]{0,500}?users_id[\\s\\S]{0,900}?select\\s+v_target_users_id`, 'i');
  assert(insert.test(sql), `${table} nao usa o users_id resolvido no staging.`);
}

for (const table of forbiddenTables) {
  const mutation = new RegExp(`\\b(?:insert\\s+into|update|delete\\s+from|truncate)\\s+public\\.${table}\\b`, 'i');
  assert(!mutation.test(executable), `Tabela operacional recebeu mutacao: ${table}.`);
}

assert(sql.includes("contact_sources_key NOT IN ('sem_site', 'dominio_proprio', 'agregador', 'instagram')"), 'Conjunto canonico de contact_sources nao e validado.');
assert(sql.includes('(SELECT count(*) FROM staging_seed_contact_sources) <> 4'), 'Quantidade exata de contact_sources nao e exigida.');
assert(sql.includes("template_variables_default_value IS DISTINCT FROM '[STAGING]'"), 'Sanitizacao de template_variables nao e exigida.');
for (let index = 1; index <= 4; index += 1) {
  assert(sql.includes(`templates_message_${index} IS DISTINCT FROM '[STAGING] Mensagem ${index} para {EMPRESA}'`), `Mensagem sanitizada ${index} nao e validada.`);
}
assert(sql.includes('staging_seed_branch_map') && sql.includes('branch.target_id'), 'FK branches -> templates nao e remapeada.');
assert(sql.includes('staging_seed_template_channel_map') && sql.includes('channel.target_id'), 'FK template_channels -> templates nao e remapeada.');
assert(sql.includes('staging_seed_template_type_map') && sql.includes('type.target_id'), 'FK template_types -> templates nao e remapeada.');
assert((sql.match(/_divergence'/g) ?? []).length >= 15, 'Barreiras de divergencia nao cobrem todos os catalogos e cadastros.');
assert(!/(password|access_token|refresh_token|service_role|api[_-]?key|secret[_-]?key|private[_-]?key)/i.test(executable), 'Seed contem campo ou credencial proibida.');

if (failures.length) {
  console.error(`Falhas no seed staging-only (${failures.length}):`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('OK: seed staging-only usa snapshot sanitizado, usuario local explicito e remapeamento tenant seguro.');
console.log('OK: somente as 15 tabelas aprovadas recebem INSERT; tabelas operacionais e credenciais permanecem fora do seed.');
