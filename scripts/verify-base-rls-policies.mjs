import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const migrationName = '20260812110000_restore_base_rls_policies.sql';
const previousMigrationName = '20260812100000_restore_bootstrap_foreign_keys.sql';
const migrationPath = path.join(root, 'supabase', 'migrations', migrationName);
const basePath = path.join(root, 'supabase', 'baseline', '00000000000000_base_public_schema.sql');
const catalogPath = path.resolve(root, '..', 'reference', 'Banco - Novo.csv');
const packagePath = path.join(root, 'package.json');
const modernContracts = {
  users: path.join(root, 'supabase', 'migrations', '20260807090000_users_owner_rls.sql'),
  contact_sources: path.join(root, 'supabase', 'migrations', '20260806170000_contact_sources_owner_rls.sql'),
  sents: path.join(root, 'supabase', 'migrations', '20260806180000_sents_append_only_rls.sql'),
  validation: path.join(root, 'supabase', 'migrations', '20260806190000_whatsapp_validation_proof.sql'),
};
const modernOwnedTables = new Set(['users', 'contact_sources', 'sents']);
const globallyReadableCatalogs = new Set([
  'channels', 'cities', 'countries', 'lead_status',
  'lead_validation_results', 'states', 'status',
]);
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };
const read = (filePath) => fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
const compact = (value) => value.replace(/\s+/g, ' ').trim();

function parseCsv(source) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }

  if (field || row.length) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }

  const [headers = [], ...data] = rows;
  return data.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
}

function unquote(value) {
  if (value === 'NULL') return null;
  return value.slice(1, -1).replaceAll("''", "'");
}

function catalogPolicyParts(definition) {
  const normalized = compact(definition);
  const command = normalized.match(/FOR (SELECT|INSERT|UPDATE|DELETE|ALL) TO authenticated/i)?.[1]?.toUpperCase();
  const usingIndex = normalized.indexOf(' USING (');
  const checkIndex = normalized.indexOf(' WITH CHECK (');
  const unwrap = (value) => value.startsWith('(') && value.endsWith(')') ? value.slice(1, -1) : value;
  return {
    command,
    using: usingIndex < 0 ? null : unwrap(normalized.slice(usingIndex + 7, checkIndex < 0 ? undefined : checkIndex)),
    check: checkIndex < 0 ? null : unwrap(normalized.slice(checkIndex + 12)),
  };
}

assert(fs.existsSync(migrationPath), `Migration ausente: ${migrationName}.`);
assert(fs.existsSync(basePath), 'Schema-base ausente.');
assert(fs.existsSync(catalogPath), 'Catalogo canonico reference/Banco - Novo.csv ausente.');

const sql = read(migrationPath);
const executableSql = sql.replace(/--.*$/gm, '');
const normalizedSql = compact(executableSql).toLowerCase();
const base = read(basePath);
const catalog = parseCsv(read(catalogPath));
const baseTables = new Set([...base.matchAll(/^CREATE TABLE IF NOT EXISTS public\.([a-z0-9_]+)/gim)].map((match) => match[1]));
const canonicalRlsTables = new Set(catalog
  .filter((row) => row.object_type === 'TABLE' && row.schema_name === 'public' && baseTables.has(row.object_name))
  .filter((row) => /RLS enabled:\s*t/i.test(row.additional_info))
  .map((row) => row.object_name));

const rlsArray = sql.match(/FOREACH table_name IN ARRAY ARRAY\[([\s\S]*?)\]\s*LOOP/i)?.[1] ?? '';
const enabledTables = new Set([...rlsArray.matchAll(/'([a-z0-9_]+)'/g)].map((match) => match[1]));
const policyEntries = [...sql.matchAll(/\('([^']+)',\s*'([^']+)',\s*'(SELECT|INSERT|UPDATE|DELETE|ALL)',\s*(NULL|'(?:''|[^'])*'),\s*(NULL|'(?:''|[^'])*')\)/g)]
  .map((match) => ({
    table: match[1],
    name: match[2],
    command: match[3],
    using: unquote(match[4]),
    check: unquote(match[5]),
  }));

assert(baseTables.size === 27, `Esperadas 27 tabelas-base; encontradas ${baseTables.size}.`);
assert(canonicalRlsTables.size === 27, `Esperadas 27 tabelas-base com RLS canonico; encontradas ${canonicalRlsTables.size}.`);
assert(enabledTables.size === 27, `Migration deve habilitar RLS deterministicamente nas 27 tabelas-base; encontradas ${enabledTables.size}.`);
for (const table of canonicalRlsTables) {
  assert(enabledTables.has(table), `RLS nao e garantida em public.${table}.`);
}

const expectedPolicies = catalog
  .filter((row) => row.object_type === 'RLS POLICY' && row.schema_name === 'public' && baseTables.has(row.object_name))
  .filter((row) => !modernOwnedTables.has(row.object_name))
  .map((row) => ({ table: row.object_name, name: row.sub_object_name, ...catalogPolicyParts(row.definition) }))
  .sort((left, right) => `${left.table}|${left.name}`.localeCompare(`${right.table}|${right.name}`));
const actualPolicies = [...policyEntries].sort((left, right) => `${left.table}|${left.name}`.localeCompare(`${right.table}|${right.name}`));

assert(expectedPolicies.length === 70, `Catalogo deve fornecer 70 policies restauraveis; encontradas ${expectedPolicies.length}.`);
assert(actualPolicies.length === 70, `Migration deve declarar 70 policies canonicas; encontradas ${actualPolicies.length}.`);
assert(new Set(actualPolicies.map((policy) => `${policy.table}|${policy.name}`)).size === actualPolicies.length, 'Migration possui policies duplicadas.');
assert(JSON.stringify(actualPolicies) === JSON.stringify(expectedPolicies), 'Migration diverge das policies canonicas depois da precedencia dos contratos modernos.');

const branchPolicies = new Set(actualPolicies.filter((policy) => policy.table === 'branches').map((policy) => policy.name));
for (const name of ['branches_own_select', 'branches_own_insert', 'branches_own_update', 'branches_own_delete']) {
  assert(branchPolicies.has(name), `Policy obrigatoria ausente: ${name}.`);
}
const branchInsert = actualPolicies.find((policy) => policy.name === 'branches_own_insert');
assert(branchInsert?.command === 'INSERT' && branchInsert.using === null && /auth\.uid\(\)/.test(branchInsert.check ?? ''), 'branches_own_insert nao restringe INSERT ao proprietario autenticado.');

for (const policy of actualPolicies) {
  const hasGlobalUsing = compact(policy.using ?? '').replaceAll('(', '').replaceAll(')', '').toLowerCase() === 'true';
  const hasGlobalCheck = compact(policy.check ?? '').replaceAll('(', '').replaceAll(')', '').toLowerCase() === 'true';
  if (hasGlobalUsing || hasGlobalCheck) {
    assert(globallyReadableCatalogs.has(policy.table) && policy.command === 'SELECT' && hasGlobalUsing && !hasGlobalCheck, `Policy authenticated excessivamente permissiva: ${policy.table}.${policy.name}.`);
  }
}

for (const table of modernOwnedTables) {
  assert(!actualPolicies.some((policy) => policy.table === table), `Migration nao deve redefinir policies modernas de public.${table}.`);
}
assert(actualPolicies.filter((policy) => policy.table === 'lead_validation_attempts').every((policy) => policy.command === 'SELECT'), 'Ledger de tentativas recebeu DML authenticated.');
assert(actualPolicies.filter((policy) => policy.table === 'lead_validation_results').every((policy) => policy.command === 'SELECT'), 'Catalogo de resultados recebeu DML authenticated.');

const coverage = new Map([...baseTables].map((table) => [table, new Set()]));
for (const policy of actualPolicies) coverage.get(policy.table)?.add(policy.name);
for (const [table, filePath] of Object.entries(modernContracts)) {
  if (table === 'validation') continue;
  for (const match of read(filePath).matchAll(/CREATE POLICY\s+([a-z0-9_]+)\s+ON\s+public\.([a-z0-9_]+)/gi)) {
    coverage.get(match[2])?.add(match[1]);
  }
}
for (const [table, policies] of coverage) {
  assert(policies.size > 0, `Tabela operacional com RLS ficou sem policy coberta: public.${table}.`);
}

const users = read(modernContracts.users);
const contactSources = read(modernContracts.contact_sources);
const sents = read(modernContracts.sents);
const validation = read(modernContracts.validation);
assert(/CREATE POLICY users_select_own/i.test(users) && /CREATE POLICY users_own_update/i.test(users), 'Contrato moderno de public.users deixou de prevalecer.');
assert(['contact_sources_own_select', 'contact_sources_own_insert', 'contact_sources_own_update', 'contact_sources_own_delete'].every((name) => contactSources.includes(`CREATE POLICY ${name}`)), 'Contrato moderno de public.contact_sources deixou de prevalecer.');
assert(/CREATE POLICY sents_own_select/i.test(sents) && !/CREATE POLICY\s+\S+\s+ON public\.sents[\s\S]*?FOR\s+(INSERT|UPDATE|DELETE|ALL)/i.test(sents), 'Contrato append-only moderno de public.sents deixou de prevalecer.');
assert(/REVOKE ALL PRIVILEGES ON TABLE public\.lead_validation_attempts[\s\S]*?FROM PUBLIC, anon, authenticated, service_role/i.test(validation), 'Ledger de validacao nao revoga privilegios antigos deterministicamente.');
assert(/GRANT SELECT ON TABLE public\.lead_validation_attempts TO authenticated/i.test(validation), 'Leitura owner-only do ledger nao possui grant moderno correspondente.');
assert(/GRANT SELECT ON TABLE public\.lead_validation_results TO authenticated/i.test(validation), 'Leitura do catalogo de resultados nao possui grant moderno correspondente.');

assert(normalizedSql.startsWith('begin;') && normalizedSql.endsWith('commit;'), 'Migration deve usar transacao explicita.');
assert(!/\bdrop policy\b/i.test(executableSql), 'Migration nao pode apagar policies existentes.');
assert(/IF FOUND THEN[\s\S]*RAISE EXCEPTION/i.test(executableSql), 'Migration nao aborta diante de policy homonima divergente.');
assert(/p\.roles <> ARRAY\['authenticated'\]::name\[\]/i.test(executableSql) || /current_policy\.roles <> ARRAY\['authenticated'\]::name\[\]/i.test(executableSql), 'Migration nao valida o role da policy existente.');
assert(/An authenticated policy is globally permissive on an owner-scoped base table/i.test(sql), 'Migration nao possui barreira contra policy global em tabela owner-scoped.');
assert(!/\b(?:insert into|update|delete from|truncate)\s+public\./i.test(executableSql), 'Migration altera dados existentes.');
assert(!/\b(?:grant|revoke)\b/i.test(executableSql), 'Migration altera grants fora do escopo de restauracao de policies.');

const migrations = fs.readdirSync(path.join(root, 'supabase', 'migrations')).filter((name) => name.endsWith('.sql')).sort();
assert(migrations.indexOf(migrationName) > migrations.indexOf(previousMigrationName), `${migrationName} deve aparecer depois de ${previousMigrationName}.`);

const packageJson = JSON.parse(read(packagePath));
assert(packageJson.scripts?.['verify:base-rls-policies'] === 'node scripts/verify-base-rls-policies.mjs', 'Verificador nao foi registrado no package.json.');
assert(packageJson.scripts?.['verify:all']?.includes('verify:base-rls-policies'), 'verify:all nao inclui o verificador de RLS-base.');

if (failures.length) {
  console.error(`Falhas na cobertura RLS-base (${failures.length}):`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('OK: 27 tabelas-base RLS verificadas e 70 policies canonicas cobertas.');
console.log('OK: contratos modernos de users, contact_sources, sents e validation ledger continuam prevalecendo.');
