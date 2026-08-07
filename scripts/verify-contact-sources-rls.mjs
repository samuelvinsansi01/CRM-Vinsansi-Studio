import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const migrationName = '20260806170000_contact_sources_owner_rls.sql';
const migrationPath = path.join(root, 'supabase', 'migrations', migrationName);
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };

assert(fs.existsSync(migrationPath), `Migration ausente: ${migrationName}.`);

const sql = fs.existsSync(migrationPath) ? fs.readFileSync(migrationPath, 'utf8') : '';
const executableSql = sql.replace(/--.*$/gm, '');
const normalized = executableSql.toLowerCase().replace(/\s+/g, ' ').trim();
const policyBlock = (name) => {
  const start = normalized.indexOf(`create policy ${name}`);
  if (start < 0) return '';
  const end = normalized.indexOf(';', start);
  return normalized.slice(start, end < 0 ? normalized.length : end);
};
const ownsRow = (block) => (
  block.includes('users_id = ( select u.users_id from public.users as u')
  && block.includes('u.auth_user_id = auth.uid()')
  && block.includes('limit 1')
);

assert(normalized.startsWith('begin;') && normalized.endsWith('commit;'), 'Migration deve usar uma transação explícita.');
assert(normalized.includes('alter table public.contact_sources enable row level security'), 'RLS não é habilitada em contact_sources.');
assert(!normalized.includes('force row level security'), 'Migration não deve forçar RLS e bloquear o BYPASSRLS do service_role.');
assert(!normalized.includes('as restrictive'), 'Policy RESTRICTIVE não deve compensar uma policy permissiva global.');
assert(!normalized.includes('revoke '), 'Migration não deve revogar privilégios existentes.');

assert(normalized.includes("from pg_policies where schemaname = 'public' and tablename = 'contact_sources'"), 'Policies antigas de contact_sources não são enumeradas para remoção.');
assert(normalized.includes('drop policy if exists "authenticated can read contact sources" on public.contact_sources'), 'A policy histórica de SELECT global não é removida explicitamente.');
assert(normalized.includes("drop policy if exists %i on public.contact_sources"), 'Policies antigas não são removidas antes da recriação owner-only.');
assert(!/using\s*\(\s*true\s*\)/i.test(executableSql), 'Existe USING (true) na migration de contact_sources.');

const createdPolicies = [...normalized.matchAll(/create policy ([a-z0-9_]+) on public\.contact_sources/g)].map((match) => match[1]);
assert(createdPolicies.length === 4, `Esperadas 4 policies owner-only; encontradas ${createdPolicies.length}.`);
assert(new Set(createdPolicies).size === 4, 'Existem policies duplicadas na migration.');
assert(createdPolicies.every((name) => name.startsWith('contact_sources_own_')), 'Existe policy alternativa ou global em contact_sources.');

const selectPolicy = policyBlock('contact_sources_own_select');
const insertPolicy = policyBlock('contact_sources_own_insert');
const updatePolicy = policyBlock('contact_sources_own_update');
const deletePolicy = policyBlock('contact_sources_own_delete');

assert(selectPolicy.includes('for select') && selectPolicy.includes('to authenticated') && selectPolicy.includes('using ('), 'SELECT owner-only está incompleto.');
assert(ownsRow(selectPolicy), 'SELECT não está vinculado ao proprietário autenticado.');
assert(!selectPolicy.includes('with check'), 'SELECT não deve declarar WITH CHECK.');

assert(insertPolicy.includes('for insert') && insertPolicy.includes('to authenticated') && insertPolicy.includes('with check ('), 'INSERT owner-only está incompleto.');
assert(ownsRow(insertPolicy), 'INSERT não valida o proprietário autenticado.');
assert(!insertPolicy.includes(' using ('), 'INSERT não deve usar predicado de leitura global.');

assert(updatePolicy.includes('for update') && updatePolicy.includes('to authenticated'), 'UPDATE owner-only está incompleto.');
assert(updatePolicy.includes('using (') && updatePolicy.includes('with check ('), 'UPDATE exige USING e WITH CHECK.');
assert((updatePolicy.match(/auth\.uid\(\)/g) ?? []).length === 2 && ownsRow(updatePolicy), 'UPDATE não valida propriedade antes e depois da alteração.');

assert(deletePolicy.includes('for delete') && deletePolicy.includes('to authenticated') && deletePolicy.includes('using ('), 'DELETE owner-only está incompleto.');
assert(ownsRow(deletePolicy), 'DELETE não está vinculado ao proprietário autenticado.');
assert(!deletePolicy.includes('with check'), 'DELETE não deve declarar WITH CHECK.');

assert(normalized.includes('grant select, insert, update, delete on table public.contact_sources to service_role'), 'Privilégios DML do service_role não foram preservados explicitamente.');
assert(!/\b(?:alter table|create table|drop table|truncate table)\s+public\.(?!contact_sources\b)/i.test(executableSql), 'A migration altera outra tabela pública.');
assert(!/\b(?:insert into|update|delete from)\s+public\./i.test(executableSql), 'A migration altera dados, o que está fora do escopo RLS.');

const migrations = fs.readdirSync(path.join(root, 'supabase', 'migrations')).filter((name) => name.endsWith('.sql')).sort();
assert(migrations.includes(migrationName), 'A migration de RLS deve permanecer registrada no histórico de migrations.');

if (failures.length) {
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('OK: contact_sources possui somente policies owner-only para authenticated e preserva service_role.');
