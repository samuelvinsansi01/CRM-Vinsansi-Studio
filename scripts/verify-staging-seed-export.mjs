import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const exportPath = path.join(root, 'scripts', 'export-staging-seed-data.sql');
const finderPath = path.join(root, 'scripts', 'find-production-source-user.sql');
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };
const read = (filePath) => fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
const executable = (sql) => sql.replace(/--.*$/gm, '').trim();

assert(fs.existsSync(exportPath), 'SQL de exportação ausente.');
assert(fs.existsSync(finderPath), 'SQL para identificar source_users_id ausente.');

const exportSql = read(exportPath);
const finderSql = read(finderPath);
const exportExecutable = executable(exportSql);
const finderExecutable = executable(finderSql);
const normalizedExport = exportExecutable.toLowerCase().replace(/\s+/g, ' ');

const forbiddenMutation = /\b(?:insert|update|delete|truncate|merge|copy|create|alter|drop|grant|revoke|call|do)\b/i;
assert(!forbiddenMutation.test(exportExecutable), 'Export contém comando que não é somente leitura.');
assert(!forbiddenMutation.test(finderExecutable), 'Consulta de usuário contém comando que não é somente leitura.');
assert(/^with\s+params\s+as\s*\(/i.test(exportExecutable), 'Export deve iniciar por uma CTE de parâmetro seguida de SELECT.');
assert(/^select\b/i.test(finderExecutable), 'Consulta de usuário deve ser um único SELECT.');
assert((exportExecutable.match(/;/g) ?? []).length === 1 && exportExecutable.endsWith(';'), 'Export deve conter exatamente um statement.');
assert((finderExecutable.match(/;/g) ?? []).length === 1 && finderExecutable.endsWith(';'), 'Consulta de usuário deve conter exatamente um statement.');

assert((exportSql.match(/REPLACE_WITH_SOURCE_USERS_ID/g) ?? []).length === 2, 'Placeholder source_users_id deve aparecer uma vez no SQL executável e uma vez na instrução.');
assert(normalizedExport.includes("cast('replace_with_source_users_id' as bigint) as source_users_id"), 'Parâmetro source_users_id não está explícito e tipado como bigint.');

const expectedCanonical = [
  'status', 'channels', 'lead_status', 'countries', 'states', 'cities',
  'lead_validation_results', 'audit_transition_rules',
];
const expectedTenant = [
  'branches', 'contact_sources', 'levels', 'template_channels',
  'template_types', 'template_variables', 'templates',
];
const allowedTables = new Set([...expectedCanonical, ...expectedTenant]);
const referencedTables = [...exportExecutable.matchAll(/\bfrom\s+public\.([a-z0-9_]+)/gi)].map((match) => match[1]);

assert(new Set(referencedTables).size === 15, `Export deve consultar exatamente 15 tabelas; encontrou ${new Set(referencedTables).size}.`);
assert(referencedTables.every((table) => allowedTables.has(table)), 'Export consulta tabela fora da allowlist aprovada.');
for (const table of allowedTables) {
  assert(referencedTables.filter((candidate) => candidate === table).length === 1, `Tabela ${table} deve ser consultada exatamente uma vez.`);
}

assert(normalizedExport.includes("'canonical', jsonb_build_object("), 'Objeto canonical ausente.');
assert(normalizedExport.includes("'tenant', jsonb_build_object("), 'Objeto tenant ausente.');
for (const key of [...expectedCanonical, ...expectedTenant]) {
  assert(new RegExp(`'${key}'\\s*,\\s*coalesce\\s*\\(`, 'i').test(exportSql), `Array JSON ausente: ${key}.`);
}
assert((normalizedExport.match(/jsonb_agg\(/g) ?? []).length === 15, 'Cada tabela aprovada deve ser agregada server-side em JSON.');
assert((normalizedExport.match(/'\[\]'::jsonb/g) ?? []).length === 15, 'Arrays vazios devem retornar [] em todas as tabelas.');
assert(normalizedExport.endsWith('from params as p;'), 'Export deve retornar uma única linha a partir do parâmetro único.');

for (const table of expectedTenant) {
  const alias = {
    branches: 'b', contact_sources: 'cs', levels: 'l', template_channels: 'tc',
    template_types: 'tt', template_variables: 'tv', templates: 't',
  }[table];
  assert(normalizedExport.includes(`where ${alias}.users_id = p.source_users_id`), `${table} não está filtrada pelo source_users_id.`);
}

for (const id of [
  'source_branches_id', 'source_contact_sources_id', 'source_levels_id',
  'source_template_channels_id', 'source_template_types_id',
  'source_template_variables_id', 'source_templates_id',
]) {
  assert(exportSql.includes(id), `ID de origem não preservado: ${id}.`);
}

assert(exportSql.includes("ELSE '[STAGING]'"), 'Valor padrão de template_variables não está sanitizado.');
for (let part = 1; part <= 4; part += 1) {
  assert(exportSql.includes(`ELSE '[STAGING] Mensagem ${part} para {EMPRESA}'`), `Mensagem ${part} não está sanitizada.`);
}

const forbiddenReferences = [
  'leads', 'queues', 'queue_items', 'sents', 'lead_validation_attempts',
  'worker_batches', 'worker_batch_items', 'chips', 'socials', 'instances',
  'instance_credentials', 'apify_account_credentials', 'vault',
];
for (const name of forbiddenReferences) {
  assert(!new RegExp(`\\b(?:public\\.)?${name}\\b`, 'i').test(exportExecutable), `Export referencia conteúdo proibido: ${name}.`);
}
assert(!/\b(?:phone|telefone|socials_username|external_username|remote_jid)\b/i.test(exportExecutable), 'Export consulta telefone ou identificador social proibido.');

assert(/from\s+public\.users\s+as\s+u/i.test(finderExecutable), 'Consulta de identificação não lê public.users.');
assert(/join\s+auth\.users\s+as\s+au/i.test(finderExecutable), 'Consulta de identificação não relaciona auth.users.');
assert(/u\.users_id\s+as\s+source_users_id/i.test(finderExecutable), 'Consulta não retorna source_users_id explicitamente.');
assert(!/\b(?:encrypted_password|confirmation_token|recovery_token|access_token|refresh_token)\b/i.test(finderExecutable), 'Consulta de identificação expõe segredo de Auth.');

if (failures.length) {
  console.error(`Falhas no export read-only (${failures.length}):`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('OK: export agrega somente as 15 tabelas aprovadas em uma linha JSONB e aplica o filtro tenant-scoped.');
console.log('OK: templates e variáveis estão sanitizados; nenhuma tabela operacional ou credencial é consultada.');
