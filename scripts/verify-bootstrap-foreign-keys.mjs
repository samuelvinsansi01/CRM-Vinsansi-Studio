import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const migrationName = '20260812100000_restore_bootstrap_foreign_keys.sql';
const previousMigrationName = '20260807100000_fix_operational_health_batch_status.sql';
const migrationPath = path.join(root, 'supabase', 'migrations', migrationName);
const basePath = path.join(root, 'supabase', 'baseline', '00000000000000_base_public_schema.sql');
const bootstrapPath = path.join(root, 'supabase', 'baseline', 'bootstrap_full.sql');
const catalogPath = path.resolve(root, '..', 'reference', 'Banco - Novo.csv');
const expectedDigest = '4bf73c94cd43c33deb6539731ce0bbee38a21a942587945579ac2c66fda3f916';
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };
const read = (filePath) => fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
const normalize = (value) => value.replace(/\s+/g, ' ').trim().toUpperCase();

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

assert(fs.existsSync(migrationPath), `Migration ausente: ${migrationName}.`);
assert(fs.existsSync(basePath), 'Schema-base ausente.');
assert(fs.existsSync(bootstrapPath), 'bootstrap_full.sql ausente.');

const sql = read(migrationPath);
const executableSql = sql.replace(/--.*$/gm, '');
const normalizedSql = normalize(executableSql);
const entries = [...sql.matchAll(/\('([^']+)',\s*'([^']+)',\s*'([^']+)'\)/g)]
  .map((match) => match.slice(1));
const digest = crypto.createHash('sha256').update(JSON.stringify(entries)).digest('hex');

assert(normalizedSql.startsWith('BEGIN;') && normalizedSql.endsWith('COMMIT;'), 'Migration deve usar transacao explicita.');
assert(entries.length === 80, `Esperadas 80 FKs omitidas pelo schema-base; encontradas ${entries.length}.`);
assert(new Set(entries.map((entry) => entry[1])).size === entries.length, 'Migration possui nomes de constraints duplicados.');
assert(digest === expectedDigest, 'O conjunto ou a definicao canonica das 80 FKs foi alterado.');
assert(entries.every(([, , definition]) => /^FOREIGN KEY \([a-z0-9_]+\) REFERENCES (?:public|auth)\.[a-z0-9_]+\([a-z0-9_]+\)(?: ON DELETE (?:CASCADE|SET NULL|RESTRICT))?$/i.test(definition)), 'Existe definicao de FK fora do formato estrutural esperado.');
assert(entries.some(([table, name, definition]) => table === 'leads' && name === 'leads_branches_id_fkey' && definition === 'FOREIGN KEY (branches_id) REFERENCES public.branches(branches_id) ON DELETE SET NULL'), 'leads_branches_id_fkey nao reproduz o contrato canonico.');
assert(!entries.some(([, name]) => name === 'leads_canonical_lead_id_fkey'), 'FK de canonical_lead_id ja e criada por migration anterior e nao deve ser duplicada.');

assert(normalizedSql.includes("FROM PG_CONSTRAINT C JOIN PG_NAMESPACE N ON N.OID = C.CONNAMESPACE"), 'Migration nao verifica constraints existentes de forma catalogada.');
assert(normalizedSql.includes("N.NSPNAME = 'PUBLIC'"), 'Consulta de idempotencia nao esta limitada ao schema public.');
assert(normalizedSql.includes("C.CONRELID = FORMAT('PUBLIC.%I', FK.TABLE_NAME)::REGCLASS"), 'Consulta de idempotencia nao esta limitada a tabela esperada.');
assert(normalizedSql.includes('PG_GET_CONSTRAINTDEF(C.OID)'), 'Migration nao valida a definicao de uma constraint ja existente.');
assert(normalizedSql.includes("'ALTER TABLE PUBLIC.%I ADD CONSTRAINT %I %S'"), 'ADD CONSTRAINT nao usa identificadores dinamicos seguros.');
assert(!/\b(?:insert into|update|delete from|truncate)\s+public\./i.test(executableSql), 'Migration altera dados existentes.');
assert(!/\bdrop\s+(?:table|constraint|index)\b/i.test(executableSql), 'Migration remove estrutura existente.');
assert(!/\b(?:create|alter|drop)\s+(?:policy|function|trigger|index)\b/i.test(executableSql), 'Migration altera objetos fora das FKs.');

const base = read(basePath);
const bootstrap = read(bootstrapPath);
assert(!/\b(?:foreign key|references)\b/i.test(base), 'Schema-base passou a criar FKs; reavaliar esta migration incremental.');
assert(/ADD COLUMN IF NOT EXISTS canonical_lead_id bigint REFERENCES public\.leads\(leads_id\) ON DELETE SET NULL/i.test(bootstrap), 'FK leads_canonical_lead_id_fkey preexistente nao foi localizada no bootstrap.');

const migrations = fs.readdirSync(path.join(root, 'supabase', 'migrations')).filter((name) => name.endsWith('.sql')).sort();
assert(migrations.indexOf(migrationName) > migrations.indexOf(previousMigrationName), `${migrationName} deve aparecer depois de ${previousMigrationName}.`);

if (fs.existsSync(catalogPath)) {
  const baseTables = new Set([...base.matchAll(/^CREATE TABLE IF NOT EXISTS public\.([a-z0-9_]+)/gim)].map((match) => match[1]));
  const canonical = parseCsv(read(catalogPath))
    .filter((row) => row.object_type === 'CONSTRAINT FOREIGN KEY' && row.schema_name === 'public' && baseTables.has(row.object_name))
    .filter((row) => row.sub_object_name !== 'leads_canonical_lead_id_fkey')
    .map((row) => [
      row.object_name,
      row.sub_object_name,
      row.definition.replace(/REFERENCES ([a-z_]+)\(/i, 'REFERENCES public.$1('),
    ])
    .sort((left, right) => `${left[0]}|${left[1]}`.localeCompare(`${right[0]}|${right[1]}`));
  const actual = [...entries].sort((left, right) => `${left[0]}|${left[1]}`.localeCompare(`${right[0]}|${right[1]}`));
  assert(JSON.stringify(actual) === JSON.stringify(canonical), 'Migration diverge das FKs do catalogo canonico reference/Banco - Novo.csv.');
}

if (failures.length) {
  console.error(`Falhas na restauracao das FKs (${failures.length}):`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('OK: 80 FKs omitidas pelo bootstrap sao restauradas conforme o catalogo canonico.');
console.log('OK: leads.branches_id volta a expor a relacao PostgREST com public.branches.');
