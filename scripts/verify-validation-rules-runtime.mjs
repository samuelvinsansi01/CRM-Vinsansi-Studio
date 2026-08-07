import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), 'utf8');
const sha256 = (path) => createHash('sha256').update(read(path)).digest('hex');

function sourceFiles(directory) {
  const absolute = join(root, directory);
  const files = [];
  for (const entry of readdirSync(absolute)) {
    const target = join(absolute, entry);
    if (statSync(target).isDirectory()) files.push(...sourceFiles(join(directory, entry)));
    else if (/\.(?:ts|tsx|js|mjs)$/.test(entry)) files.push(target);
  }
  return files;
}

const app = read('src/App.tsx');
const registry = read('src/pages/pageRegistry.ts');
const configurationPages = read('src/pages/ConfigurationPages.tsx');
const legacyPage = read('src/pages/ValidationRulesSettingsPage.tsx');
const legacyRepository = read('src/repositories/configuration/configuration.repository.ts');
const proofMigration = read('supabase/migrations/20260806190000_whatsapp_validation_proof.sql');

assert(!registry.includes('config-validation-rules'), 'validation_rules ainda está registrada na navegação ou catálogo de páginas.');
assert(!registry.includes('Regras de validação'), 'O menu ainda comunica regras de validação editáveis.');
assert(!app.includes("activePage === 'config-validation-rules'"), 'App.tsx ainda monta ValidationRulesSettingsPage.');
assert(!app.includes("import { ValidationRulesSettingsPage }"), 'App.tsx ainda importa a página legada.');
assert(!configurationPages.includes('config-validation-rules') && !configurationPages.includes('Regras de validação'), 'ConfigurationPages ainda apresenta validation_rules como disponível.');

for (const legacyId of ['config-validation-rules', 'validation-rules', 'validation-settings', 'validation-rules-settings']) {
  assert(app.includes(`'${legacyId}': 'validation-routing'`), `ID legado ${legacyId} não redireciona para validation-routing.`);
}

assert(legacyPage.includes('export function ValidationRulesSettingsPage') && legacyPage.includes('saveValidationRules'), 'A página legada foi removida ou alterada estruturalmente.');
assert(legacyRepository.includes("from('validation_rules')") && legacyRepository.includes('loadValidationRules') && legacyRepository.includes('saveValidationRules'), 'Repository legado de validation_rules não foi preservado.');
assert(read('supabase/baseline/00000000000000_base_public_schema.sql').includes('CREATE TABLE IF NOT EXISTS public.validation_rules'), 'Tabela validation_rules não foi preservada no schema.');

assert.equal(sha256('src/pages/ValidationRulesSettingsPage.tsx'), 'bca1f1c337a84300a206584ebd60f8f945442126655f3231389de1bd64a2d0aa', 'ValidationRulesSettingsPage.tsx foi alterada.');
assert.equal(sha256('src/repositories/configuration/configuration.repository.ts'), 'c382b9aaf5c0482815cd568bd67e618a1b929f8ada9174ae5ce51906b0867bbb', 'configuration.repository.ts foi alterado.');
assert.equal(sha256('supabase/baseline/00000000000000_base_public_schema.sql'), '14824eb8aaeccfeab8fd1a480ef8e26662a723f10771e489ccef729a6ef407b4', 'Schema da tabela validation_rules foi alterado.');
assert.equal(sha256('supabase/migrations/20260806190000_whatsapp_validation_proof.sql'), 'dac25ab8c66f94452dd0c88e336780f7f65968c6f62b2e7f0bf0e5ac4e1b5d0d', 'Migration da prova WhatsApp foi alterada.');

const excluded = new Set([
  'src/pages/ValidationRulesSettingsPage.tsx',
  'src/repositories/configuration/configuration.repository.ts',
]);
for (const file of [
  ...sourceFiles('src'),
  ...sourceFiles('api'),
  ...sourceFiles('../worker/src'),
  ...sourceFiles('../instagram-extension'),
]) {
  const path = relative(root, file).replaceAll('\\', '/');
  if (excluded.has(path)) continue;
  const content = readFileSync(file, 'utf8');
  assert(!content.includes("from('validation_rules')"), `Runtime passou a consultar validation_rules em ${path}.`);
  assert(!/\b(?:loadValidationRules|saveValidationRules)\b/.test(content), `Runtime passou a consumir o repository legado em ${path}.`);
}

for (const migration of readdirSync(join(root, 'supabase/migrations')).filter((name) => name.endsWith('.sql'))) {
  const content = read(`supabase/migrations/${migration}`);
  assert(!/(?:FROM|JOIN)\s+public\.validation_rules/i.test(content), `RPC/função SQL passou a consumir validation_rules em ${migration}.`);
}

assert(!/JOIN\s+public\.validation_rules/i.test(proofMigration), 'A prova WhatsApp passou a depender de validation_rules.');
assert(/validation_rules_id,[\s\S]{0,900}?NULL,[\s\S]{0,120}?v_result_id/.test(proofMigration), 'A tentativa WhatsApp deixou de registrar validation_rules_id como NULL.');

console.log('✓ validation_rules preservada como legado, fora da navegação e sem consumidor operacional.');
