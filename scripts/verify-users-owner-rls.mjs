import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const migrationName = '20260807090000_users_owner_rls.sql';
const previousMigrationName = '20260806190000_whatsapp_validation_proof.sql';
const migrationPath = path.join(root, 'supabase', 'migrations', migrationName);
const bootstrapPath = path.join(root, 'supabase', 'baseline', 'bootstrap_full.sql');
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };
const read = (filePath) => fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
const normalize = (source) => source.replace(/--.*$/gm, '').toLowerCase().replace(/\s+/g, ' ').trim();

assert(fs.existsSync(migrationPath), `Migration ausente: ${migrationName}.`);
assert(fs.existsSync(bootstrapPath), 'Baseline bootstrap_full.sql ausente.');

const sql = read(migrationPath);
const executableSql = sql.replace(/--.*$/gm, '');
const normalized = normalize(sql);

assert(normalized.startsWith('begin;') && normalized.endsWith('commit;'), 'Migration deve usar transacao explicita.');
assert(normalized.includes('alter table public.users enable row level security'), 'RLS nao e habilitada em public.users.');
assert(!normalized.includes('force row level security'), 'Migration nao deve usar FORCE ROW LEVEL SECURITY.');

assert(normalized.includes("from pg_policies where schemaname = 'public' and tablename = 'users'"), 'Policies anteriores de public.users nao sao enumeradas com escopo seguro.');
assert(normalized.includes("'drop policy if exists %i on public.users'"), 'DROP dinamico nao trata o nome da policy como identificador seguro.');

const createdPolicies = [...normalized.matchAll(/create policy ([a-z0-9_]+) on public\.users/g)].map((match) => match[1]);
assert(createdPolicies.length === 2, `Esperadas exatamente duas policies finais; encontradas ${createdPolicies.length}.`);
assert(new Set(createdPolicies).size === 2, 'Existem policies duplicadas em public.users.');
assert(createdPolicies.includes('users_select_own'), 'Policy users_select_own ausente.');
assert(createdPolicies.includes('users_own_update'), 'Policy users_own_update ausente.');

const policyBlock = (name) => {
  const start = normalized.indexOf(`create policy ${name}`);
  if (start < 0) return '';
  const end = normalized.indexOf(';', start);
  return normalized.slice(start, end < 0 ? normalized.length : end);
};

const selectPolicy = policyBlock('users_select_own');
const updatePolicy = policyBlock('users_own_update');

assert(selectPolicy.includes('for select') && selectPolicy.includes('to authenticated'), 'users_select_own deve ser SELECT para authenticated.');
assert(selectPolicy.includes('using ( auth_user_id = auth.uid() )'), 'users_select_own nao restringe SELECT por auth_user_id = auth.uid().');
assert(!selectPolicy.includes('with check'), 'users_select_own nao deve possuir WITH CHECK.');

assert(updatePolicy.includes('for update') && updatePolicy.includes('to authenticated'), 'users_own_update deve ser UPDATE para authenticated.');
assert(updatePolicy.includes('using ( auth_user_id = auth.uid() )'), 'users_own_update nao restringe USING por auth_user_id = auth.uid().');
assert(updatePolicy.includes('with check ( auth_user_id = auth.uid() )'), 'users_own_update nao restringe WITH CHECK por auth_user_id = auth.uid().');
assert((updatePolicy.match(/auth\.uid\(\)/g) ?? []).length === 2, 'users_own_update deve validar propriedade antes e depois da alteracao.');

assert(!/create policy\s+\S+\s+on public\.users[\s\S]*?for\s+(insert|delete|all)\b/i.test(executableSql), 'Authenticated recebeu policy de INSERT, DELETE ou ALL em public.users.');
assert(!/using\s*\(\s*true\s*\)|with check\s*\(\s*true\s*\)/i.test(executableSql), 'Existe predicado global permissivo em public.users.');
assert(!/create policy\s+\S+\s+on public\.users[\s\S]*?to\s+(?:public|anon)\b/i.test(executableSql), 'PUBLIC ou anon recebeu policy em public.users.');

assert(!/\b(?:insert into|update|delete from|truncate)\s+public\./i.test(executableSql), 'Migration altera dados existentes.');
assert(!/\b(?:create|drop|alter)\s+(?:unique\s+)?index\b/i.test(executableSql), 'Migration altera indices.');
assert(!/\b(?:add|drop|validate)\s+constraint\b/i.test(executableSql), 'Migration altera constraints.');
assert(!/\b(?:alter|create|drop|truncate)\s+table\s+(?!public\.users\b)/i.test(executableSql), 'Migration altera outra tabela.');
assert(!/\bcreate policy\s+\S+\s+on\s+(?!public\.users\b)/i.test(executableSql), 'Migration cria policy em outra tabela.');

const migrations = fs.readdirSync(path.join(root, 'supabase', 'migrations')).filter((name) => name.endsWith('.sql')).sort();
const previousIndex = migrations.indexOf(previousMigrationName);
const migrationIndex = migrations.indexOf(migrationName);
assert(previousIndex >= 0, `Migration anterior ausente: ${previousMigrationName}.`);
assert(migrationIndex >= 0, `Migration ausente do historico: ${migrationName}.`);
assert(migrationIndex > previousIndex, `Migration ${migrationName} deve aparecer depois de ${previousMigrationName}.`);

const bootstrap = normalize(read(bootstrapPath));
const bootstrapHasSelectPolicy = bootstrap.includes('create policy users_select_own on public.users');
const bootstrapHasUpdatePolicy = bootstrap.includes('create policy users_own_update on public.users');

if (failures.length) {
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('OK: public.users possui somente SELECT e UPDATE owner-only para authenticated.');
console.log(`INFO: bootstrap_full.sql reproduz as policies de users: ${bootstrapHasSelectPolicy && bootstrapHasUpdatePolicy ? 'sim' : 'nao'}.`);
