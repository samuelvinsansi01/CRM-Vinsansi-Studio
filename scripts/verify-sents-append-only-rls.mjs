import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const migrationName = '20260806180000_sents_append_only_rls.sql';
const migrationPath = path.join(root, 'supabase', 'migrations', migrationName);
const workerMigrationPath = path.join(root, 'supabase', 'migrations', '20260802090000_worker_persistence_idempotency.sql');
const permanentBaseMigrationPath = path.join(root, 'supabase', 'migrations', '20260802140000_permanent_base_consolidation.sql');
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };
const read = (filePath) => fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
const normalize = (source) => source.replace(/--.*$/gm, '').toLowerCase().replace(/\s+/g, ' ').trim();

assert(fs.existsSync(migrationPath), `Migration ausente: ${migrationName}.`);
assert(fs.existsSync(workerMigrationPath), 'Migration canônica de persistência do Worker ausente.');
assert(fs.existsSync(permanentBaseMigrationPath), 'Migration canônica da Base Permanente ausente.');

const sql = read(migrationPath);
const executableSql = sql.replace(/--.*$/gm, '');
const normalized = normalize(sql);
const workerSql = normalize(read(workerMigrationPath));
const permanentBaseSql = normalize(read(permanentBaseMigrationPath));

assert(normalized.startsWith('begin;') && normalized.endsWith('commit;'), 'Migration deve usar uma transação explícita.');
assert(normalized.includes('alter table public.sents enable row level security'), 'RLS não é habilitada em public.sents.');
assert(!normalized.includes('force row level security'), 'Migration não pode usar FORCE ROW LEVEL SECURITY.');

assert(normalized.includes("from pg_policies where schemaname = 'public' and tablename = 'sents'"), 'Policies existentes de public.sents não são enumeradas com escopo seguro.');
assert(normalized.includes("'drop policy if exists %i on public.sents'"), 'DROP dinâmico não trata o nome da policy como identificador seguro.');

const createdPolicies = [...normalized.matchAll(/create policy ([a-z0-9_]+) on public\.sents/g)].map((match) => match[1]);
assert(createdPolicies.length === 1, `Esperada exatamente uma policy final; encontradas ${createdPolicies.length}.`);
assert(createdPolicies[0] === 'sents_own_select', 'A única policy final deve ser sents_own_select.');

const policyStart = normalized.indexOf('create policy sents_own_select');
const policyEnd = normalized.indexOf(';', policyStart);
const selectPolicy = policyStart >= 0 ? normalized.slice(policyStart, policyEnd < 0 ? normalized.length : policyEnd) : '';
assert(selectPolicy.includes('for select') && selectPolicy.includes('to authenticated'), 'sents_own_select deve ser SELECT para authenticated.');
assert(selectPolicy.includes('using ('), 'sents_own_select não possui predicado USING.');
assert(selectPolicy.includes('users_id = ( select u.users_id from public.users as u'), 'SELECT não está vinculado ao public.users.users_id proprietário.');
assert(selectPolicy.includes('u.auth_user_id = auth.uid()') && selectPolicy.includes('limit 1'), 'SELECT não resolve o proprietário por auth.uid().');
assert(!selectPolicy.includes('with check'), 'Policy SELECT não deve possuir WITH CHECK.');
assert(!/create policy\s+\S+\s+on public\.sents[\s\S]*?for\s+(insert|update|delete|all)\b/i.test(executableSql), 'Existe policy final de INSERT, UPDATE, DELETE ou ALL.');

assert(normalized.includes('revoke all privileges on table public.sents from public, anon, authenticated'), 'Privilégios de PUBLIC, anon e authenticated não são revogados deterministicamente.');
assert(normalized.includes('grant select on table public.sents to authenticated'), 'authenticated não recebe SELECT explicitamente.');
assert(!/grant\s+(?:[a-z, ]+)\s+on table public\.sents to public\b/i.test(executableSql), 'PUBLIC recebe privilégios em public.sents.');
assert(!/grant\s+(?:[a-z, ]+)\s+on table public\.sents to anon\b/i.test(executableSql), 'anon recebe privilégios em public.sents.');
assert(!/grant\s+(?:[a-z, ]*\b(?:insert|update|delete|truncate)\b[a-z, ]*)\s+on table public\.sents to authenticated\b/i.test(executableSql), 'authenticated recebe DML em public.sents.');

assert(normalized.includes('grant select, insert, update on table public.sents to service_role'), 'service_role não recebe SELECT, INSERT e UPDATE explicitamente.');
assert(normalized.includes('revoke delete, truncate on table public.sents from service_role'), 'DELETE e TRUNCATE não são revogados de service_role.');
assert(!/grant\s+(?:[a-z, ]*\b(?:delete|truncate)\b[a-z, ]*)\s+on table public\.sents to service_role\b/i.test(executableSql), 'service_role recebe DELETE ou TRUNCATE.');

const workerSignature = 'public.worker_complete_dispatch_part(bigint, bigint, text, uuid, text, text, text)';
assert(workerSql.includes(`revoke all on function ${workerSignature} from public, anon, authenticated`), 'worker_complete_dispatch_part não permanece revogada de PUBLIC, anon e authenticated.');
assert(workerSql.includes(`grant execute on function ${workerSignature} to service_role`), 'worker_complete_dispatch_part não permanece concedida a service_role.');
assert(!workerSql.includes(`grant execute on function ${workerSignature} to authenticated`), 'authenticated recebeu EXECUTE em worker_complete_dispatch_part.');
assert(workerSql.includes('insert into public.sents ('), 'INSERT operacional em public.sents foi removido da RPC do Worker.');
assert(workerSql.includes('on conflict (sents_idempotency_key) where sents_idempotency_key is not null do update set'), 'UPSERT idempotente de public.sents foi alterado ou removido.');

assert(permanentBaseSql.includes('create trigger refresh_permanent_record_sent_trigger after insert or update of status_id,sents_sent_at on public.sents'), 'Trigger canônico da Base Permanente está ausente.');
assert(!/\b(?:drop|create|alter)\s+trigger\b/i.test(executableSql), 'Migration remove ou redefine trigger.');
assert(!/refresh_permanent_record_sent_trigger/i.test(executableSql), 'Migration interfere no trigger da Base Permanente.');

assert(!/\b(?:insert into|update|delete from)\s+public\./i.test(executableSql), 'Migration altera dados existentes.');
assert(!/\b(?:create|drop|alter)\s+(?:unique\s+)?index\b/i.test(executableSql), 'Migration altera índices.');
assert(!/\b(?:add|drop|validate)\s+constraint\b/i.test(executableSql), 'Migration altera constraints.');
assert(!/\bcreate\s+or\s+replace\s+function\b/i.test(executableSql), 'Migration redefine funções.');
assert(!/\b(?:alter|create|drop|truncate)\s+table\s+(?!public\.sents\b)/i.test(executableSql), 'Migration altera outra tabela.');
assert(!/\b(?:grant|revoke)[^;]*\bon table\s+(?!public\.sents\b)/i.test(executableSql), 'Migration altera privilégios de outra tabela.');
assert(!/\bcreate policy\s+\S+\s+on\s+(?!public\.sents\b)/i.test(executableSql), 'Migration cria policy em outra tabela.');

const migrations = fs.readdirSync(path.join(root, 'supabase', 'migrations')).filter((name) => name.endsWith('.sql')).sort();
const contactSourcesMigrationName = '20260806170000_contact_sources_owner_rls.sql';
const contactSourcesMigrationIndex = migrations.indexOf(contactSourcesMigrationName);
const migrationIndex = migrations.indexOf(migrationName);
assert(contactSourcesMigrationIndex >= 0, `Migration anterior ausente: ${contactSourcesMigrationName}.`);
assert(migrationIndex >= 0, `Migration ausente do histórico: ${migrationName}.`);
assert(migrationIndex > contactSourcesMigrationIndex, 'Migration de sents deve aparecer depois da migration de contact_sources.');

if (failures.length) {
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('OK: public.sents é append-only para authenticated e mantém o fluxo controlado do service_role.');
