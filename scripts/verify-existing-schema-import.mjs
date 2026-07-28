import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const repository = readFileSync(resolve(root, 'src/repositories/import/supabaseImport.repository.ts'), 'utf8');
const canonical = readFileSync(resolve(root, 'src/services/import/canonicalLead.ts'), 'utf8');
const dbTypes = readFileSync(resolve(root, 'src/lib/supabase/database.types.ts'), 'utf8');
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

const forbiddenSchemaDependencies = [
  'lead_identities',
  'leads_source_id',
  'leads_phone_normalized',
  'leads_website_domain',
  'leads_instagram_username',
  'leads_maps_normalized',
  'leads_import_payload',
  'import_leads_canonical',
  'update_lead_canonical',
];

for (const name of forbiddenSchemaDependencies) {
  assert.equal(repository.includes(name), false, `Repository ainda depende de ${name}.`);
  assert.equal(canonical.includes(name), false, `Contrato ainda depende de ${name}.`);
  assert.equal(dbTypes.includes(name), false, `Tipos do banco ainda declaram ${name}.`);
}

assert.equal(
  existsSync(resolve(root, 'supabase/migrations/20260728010000_canonical_lead_import.sql')),
  false,
  'A migration estrutural anterior ainda existe.',
);
assert.match(repository, /from\('leads'\)[\s\S]*\.insert\(payload\)/, 'A importação deve gravar diretamente em leads.');
assert.match(repository, /\.select\(NORMALIZED_LEADS_SELECT\)/, 'A inserção deve reler somente o contrato existente.');
assert.match(repository, /buildIdentityIndex/, 'A deduplicação em memória deve permanecer ativa.');
assert.match(repository, /duplicateClientIds/, 'O lote deve informar duplicidades sem falso sucesso.');
assert.match(canonical, /type ExistingLeadInsert/, 'O payload do esquema existente não foi definido.');
assert.match(canonical, /leads_name:/, 'O payload não contém as colunas atuais de leads.');
assert.equal(packageJson.scripts['verify:existing-schema-import'], 'node scripts/verify-existing-schema-import.mjs');

console.log('Contrato de importação validado: usa apenas a estrutura existente do banco.');
