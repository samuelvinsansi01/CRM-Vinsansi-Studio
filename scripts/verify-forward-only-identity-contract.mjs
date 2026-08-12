import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const migrationName = '20260812130000_install_forward_only_identity_contract.sql';
const previousMigrationName = '20260812120000_seed_canonical_locations.sql';
const unsafeIdentityMigrationName = '20260802130000_identity_dedup_suppression.sql';
const unsafeInstagramFixName = '20260802131000_fix_instagram_identity_normalization.sql';
const migrationPath = path.join(root, 'supabase', 'migrations', migrationName);
const packagePath = path.join(root, 'package.json');
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };
const read = (filePath) => fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const withoutComments = (value) => value.replace(/--.*$/gm, '');
const normalize = (value) => withoutComments(value).toLowerCase().replace(/\s+/g, ' ').trim();

assert(fs.existsSync(migrationPath), `Migration ausente: ${migrationName}.`);

const sql = read(migrationPath);
const executableSql = withoutComments(sql);
const normalized = normalize(sql);

assert(normalized.startsWith('begin;') && normalized.endsWith('commit;'), 'Migration deve ser transacional.');
assert((sql.match(/\$\$/g) ?? []).length % 2 === 0, 'Migration possui delimitador dollar-quote sem fechamento.');

const forbiddenLeadDml = [
  [/\bupdate\s+(?:only\s+)?public\.leads\b/i, 'UPDATE public.leads'],
  [/\bdelete\s+from\s+(?:only\s+)?public\.leads\b/i, 'DELETE FROM public.leads'],
  [/\binsert\s+into\s+public\.leads\b/i, 'INSERT INTO public.leads'],
  [/\btruncate(?:\s+table)?\s+public\.leads\b/i, 'TRUNCATE public.leads'],
];
for (const [pattern, operation] of forbiddenLeadDml) {
  assert(!pattern.test(executableSql), `Migration contem operacao historica proibida: ${operation}.`);
}

assert(
  !/insert\s+into\s+public\.lead_identity_registry[\s\S]*?\bfrom\s+public\.leads\b/i.test(executableSql),
  'Migration faz backfill de lead_identity_registry a partir de public.leads.',
);
assert(
  !/insert\s+into\s+public\.contact_suppressions[\s\S]*?\bfrom\s+public\.leads\b/i.test(executableSql),
  'Migration faz backfill de contact_suppressions a partir de public.leads.',
);
assert(!/\bset\s+leads_instagram\s*=\s*null\b/i.test(executableSql), 'Migration limpa leads_instagram historico.');
assert(!/\bset\s+leads_website\s*=\s*null\b/i.test(executableSql), 'Migration limpa leads_website historico.');
assert(!/\bset\s+canonical_lead_id\s*=\s*null\b/i.test(executableSql), 'Migration limpa canonical_lead_id historico.');
assert(!/\bset\s+duplicate_reason\s*=\s*null\b/i.test(executableSql), 'Migration limpa duplicate_reason historico.');

for (const column of [
  'leads_normalized_phone',
  'leads_normalized_instagram',
  'leads_normalized_domain',
  'leads_normalized_maps',
  'leads_identity_hash',
  'canonical_lead_id',
  'duplicate_reason',
  'leads_identity_contract_version',
]) {
  assert(normalized.includes(`add column if not exists ${column}`), `Coluna necessaria ausente: ${column}.`);
}
assert(
  /add column if not exists leads_identity_contract_version smallint\s*[;,]/i.test(executableSql),
  'Marcador do contrato nao pode possuir DEFAULT ou preencher o legado.',
);
assert(normalized.includes("('leads_identity_contract_version', 'smallint')"), 'Tipo do marcador nao e validado pelo catalogo.');
assert(normalized.includes('or v_has_default then'), 'Migration nao aborta se uma coluna de leads possuir DEFAULT divergente.');
assert(normalized.includes('leads_identity_contract_version_check'), 'Constraint do marcador forward-only ausente.');
assert(normalized.includes('not valid'), 'Constraints incrementais devem evitar validacao/backfill da base historica.');

for (const objectName of [
  'lead_identity_registry',
  'contact_suppressions',
  'normalize_identity_phone',
  'normalize_identity_instagram',
  'normalize_identity_domain',
  'normalize_identity_maps',
  'prepare_lead_identity',
  'register_lead_identity',
  'suppress_lead_identities',
  'suppress_after_lead_sent',
  'check_lead_identity',
]) {
  assert(normalized.includes(objectName), `Objeto do contrato ausente: ${objectName}.`);
}

assert(normalized.includes('identity_contract_divergent_leads_column'), 'Colunas existentes divergentes nao causam aborto.');
assert(normalized.includes('identity_contract_divergent_foreign_key'), 'Foreign keys existentes divergentes nao causam aborto.');
assert(normalized.includes('identity_contract_divergent_primary_key'), 'Primary keys existentes divergentes nao causam aborto.');
assert(normalized.includes('identity_contract_divergent_named_constraint'), 'Constraints nomeadas divergentes nao causam aborto.');
assert(normalized.includes('identity_contract_divergent_policy'), 'Policies existentes divergentes nao causam aborto.');

const prepareStart = normalized.indexOf('create or replace function public.prepare_lead_identity()');
const prepareEnd = normalized.indexOf('create or replace function public.register_lead_identity()', prepareStart);
const prepareBody = normalized.slice(prepareStart, prepareEnd);
const legacyGuard = "if tg_op = 'update' and old.leads_identity_contract_version is distinct from 1 then";
assert(prepareStart >= 0 && prepareEnd > prepareStart, 'Funcao prepare_lead_identity nao pode ser isolada.');
assert(prepareBody.includes(legacyGuard), 'prepare_lead_identity nao ignora updates de leads legados.');
assert(
  prepareBody.indexOf(legacyGuard) < prepareBody.indexOf('new.leads_normalized_phone :='),
  'Guard do legado deve executar antes de qualquer normalizacao.',
);
assert(
  prepareBody.indexOf(legacyGuard) < prepareBody.indexOf('new.lead_status_id := 7'),
  'Guard do legado deve executar antes de qualquer classificacao de status.',
);
assert(prepareBody.includes('new.leads_identity_contract_version := old.leads_identity_contract_version'), 'Update nao preserva o marcador legado.');
assert(prepareBody.includes('new.leads_identity_contract_version := 1'), 'INSERT novo nao recebe a versao do contrato.');

const registerStart = normalized.indexOf('create or replace function public.register_lead_identity()');
const registerEnd = normalized.indexOf('create or replace function public.suppress_lead_identities(', registerStart);
const registerBody = normalized.slice(registerStart, registerEnd);
assert(
  registerBody.includes('if new.leads_identity_contract_version is distinct from 1 then return new; end if;'),
  'Registry nao ignora leads legados.',
);

const suppressFunctionStart = normalized.indexOf('create or replace function public.suppress_lead_identities(');
const suppressFunctionEnd = normalized.indexOf('create or replace function public.suppress_after_lead_sent()', suppressFunctionStart);
const suppressFunctionBody = normalized.slice(suppressFunctionStart, suppressFunctionEnd);
assert(
  suppressFunctionBody.includes('if p_lead.leads_identity_contract_version is distinct from 1 then return; end if;'),
  'Supressao direta nao ignora leads legados.',
);

const suppressTriggerStart = normalized.indexOf('create or replace function public.suppress_after_lead_sent()');
const suppressTriggerEnd = normalized.indexOf('create or replace function public.check_lead_identity(', suppressTriggerStart);
const suppressTriggerBody = normalized.slice(suppressTriggerStart, suppressTriggerEnd);
assert(
  suppressTriggerBody.includes('if new.leads_identity_contract_version is distinct from 1 then return new; end if;'),
  'Trigger de supressao nao ignora leads legados.',
);

assert(
  /create trigger prepare_lead_identity_trigger[\s\S]*?before insert or update of[\s\S]*?leads_identity_contract_version[\s\S]*?execute function public\.prepare_lead_identity\(\)/i.test(executableSql),
  'Trigger BEFORE nao instala o fluxo para INSERTs novos e updates futuros.',
);
assert(
  /create trigger register_lead_identity_trigger[\s\S]*?after insert or update of[\s\S]*?leads_identity_contract_version[\s\S]*?execute function public\.register_lead_identity\(\)/i.test(executableSql),
  'Trigger AFTER nao registra identidades de INSERTs novos.',
);
assert(
  /create trigger suppress_after_lead_sent_trigger[\s\S]*?after insert or update of lead_status_id[\s\S]*?execute function public\.suppress_after_lead_sent\(\)/i.test(executableSql),
  'Trigger futuro de supressao ausente.',
);

assert(normalized.includes("v_candidate = any(v_reserved)"), 'Normalizador Instagram nao preserva a rejeicao de rotas reservadas.');
assert(normalized.includes("v_raw !~* '^https?://(www\\.)?instagram\\.com(?:/|$)'"), 'Normalizador Instagram nao rejeita host externo.');
assert(normalized.includes('alter table public.lead_identity_registry enable row level security'), 'RLS do registry nao e habilitado.');
assert(normalized.includes('alter table public.contact_suppressions enable row level security'), 'RLS de suppressions nao e habilitado.');
assert(normalized.includes('identity_contract_unsafe_existing_policy'), 'Policy autenticada perigosa nao causa aborto.');

const migrations = fs.readdirSync(path.join(root, 'supabase', 'migrations'))
  .filter((name) => name.endsWith('.sql'))
  .sort();
assert(migrations.indexOf(migrationName) > migrations.indexOf(previousMigrationName), `${migrationName} deve ser posterior a ${previousMigrationName}.`);
assert(migrations.indexOf(migrationName) > migrations.indexOf(unsafeIdentityMigrationName), 'Migration forward-only deve ser posterior a identity/dedup original.');
assert(migrations.indexOf(migrationName) > migrations.indexOf(unsafeInstagramFixName), 'Migration forward-only deve ser posterior ao fix Instagram original.');

const unsafeIdentitySql = read(path.join(root, 'supabase', 'migrations', unsafeIdentityMigrationName));
const unsafeInstagramFixSql = read(path.join(root, 'supabase', 'migrations', unsafeInstagramFixName));
assert(hash(unsafeIdentitySql) === '306fa14976018a2ada20b809743483ed0dfed6adc128f35aa3f3e76b918a33b4', `${unsafeIdentityMigrationName} foi alterada.`);
assert(hash(unsafeInstagramFixSql) === '122fe608657bd96c787091338496e447244dad82b87b5050ace4b618cb478cc6', `${unsafeInstagramFixName} foi alterada.`);

const packageJson = JSON.parse(read(packagePath));
assert(
  packageJson.scripts?.['verify:identity-forward-only'] === 'node scripts/verify-forward-only-identity-contract.mjs',
  'Verificador forward-only nao esta registrado no package.json.',
);
assert(
  packageJson.scripts?.['verify:all']?.includes('npm run verify:identity-forward-only'),
  'verify:all nao inclui o contrato identity forward-only.',
);

if (failures.length) {
  console.error(`Falhas no contrato de identity forward-only (${failures.length}):`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('OK: migration de identity/dedup nao executa DML nem backfill sobre public.leads.');
console.log('OK: leads historicos permanecem sem marcador e sao ignorados pelos triggers futuros.');
console.log('OK: novos leads recebem o marcador e entram no fluxo de normalizacao, registry e supressao.');
