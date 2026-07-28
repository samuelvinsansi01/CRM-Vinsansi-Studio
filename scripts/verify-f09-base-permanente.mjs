import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from '/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js';

const root = process.cwd();
const workerRoot = process.env.WORKER_F09_ROOT
  ? path.resolve(process.env.WORKER_F09_ROOT)
  : path.resolve(root, '../worker_f09/Worker');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const requireText = (file, snippets) => {
  const source = read(file);
  for (const snippet of snippets) assert.ok(source.includes(snippet), `${file} deveria conter: ${snippet}`);
  return source;
};

const baseRepo = requireText('src/repositories/base/supabaseBase.repository.ts', [
  ".from('leads')",
  ".in('lead_status_id', [...FINAL_LEAD_STATUS_IDS])",
  "listFinalIdentities",
  "compareAndArchive",
  ".eq('lead_status_id', expectedStatus)",
]);
assert.ok(!baseRepo.includes(".from('base_permanente')"));
assert.ok(!baseRepo.includes(".from('sent_contacts')"));

const basePage = requireText('src/pages/BasePage.tsx', [
  'useBaseRecords(filters)',
  'archiveMany(ids)',
  'Fonte canônica: tabela leads',
]);
assert.ok(!basePage.includes("useLeadCycle('permanent')"));
assert.ok(!basePage.includes('lead_status_id: 8'));

const baseService = requireText('src/services/base/base.service.ts', [
  'repositories.base.compareAndArchive',
  "source: 'base-permanente'",
  "canonical_source: 'leads'",
]);
assert.ok(!baseService.includes('repositories.base.update('));
assert.ok(!baseService.includes('upsertSent'));

const importService = requireText('src/services/import/import.service.ts', [
  'repositories.base.listFinalIdentities()',
  'basePhones:',
  'baseInstagrams:',
]);
assert.ok(!importService.includes('listSentIdentities'));
assert.ok(!importService.includes('upsertSent'));

for (const file of [
  'src/services/import/importValidation.ts',
  'src/services/import/types.ts',
  'src/services/import-settings/types.ts',
  'src/services/import-settings/importSettings.seed.ts',
  'src/pages/ImportSettingsPage.tsx',
  'src/lib/supabase/config.ts',
  '.env.example',
]) {
  const source = read(file);
  for (const legacy of ['sent_contacts', 'base_permanente', 'blockSentContacts', 'already_sent']) {
    assert.ok(!source.includes(legacy), `${file} ainda contém legado: ${legacy}`);
  }
}

const whatsappService = requireText('src/services/whatsapp-queue/whatsappQueue.service.ts', [
  'syncCanonicalSentStatus',
  'supabaseLeadCycleRepository.compareAndSet(leadId, 4, { lead_status_id: 5 })',
]);
assert.ok(!whatsappService.includes('persistSentToBase'));

const preSendService = read('src/services/pre-send/preSend.service.ts');
assert.ok(!preSendService.includes('repositories.base.upsertSent'));
assert.ok(!preSendService.includes('preSendLeadToBaseInput'));

assert.ok(fs.existsSync(workerRoot), 'Informe WORKER_F09_ROOT para validar o Worker F09.');
const worker = fs.readFileSync(path.join(workerRoot, 'src/worker.js'), 'utf8');
assert.ok(worker.includes("const VERSION = '2.8.0'"));
assert.ok(worker.includes(".from('leads')"));
assert.ok(worker.includes('canonical_sent_synced'));
assert.ok(!worker.includes(".from('base_permanente')"));
assert.ok(!worker.includes(".from('sent_contacts')"));

const changedTsFiles = [
  'src/services/base/types.ts',
  'src/repositories/base/base.repository.ts',
  'src/repositories/base/supabaseBase.repository.ts',
  'src/repositories/base/mockBase.repository.ts',
  'src/services/base/base.service.ts',
  'src/hooks/useBaseRecords.ts',
  'src/pages/BasePage.tsx',
  'src/mappers/lead.mapper.ts',
  'src/services/import/import.service.ts',
  'src/services/import/importValidation.ts',
  'src/services/import/types.ts',
  'src/services/import-settings/types.ts',
  'src/services/import-settings/importSettings.seed.ts',
  'src/pages/ImportSettingsPage.tsx',
  'src/lib/supabase/config.ts',
  'src/services/pre-send/preSend.service.ts',
  'src/services/whatsapp-queue/whatsappQueue.service.ts',
  'src/hooks/useLeadCycle.ts',
  'src/services/lead-cycle/leadCycle.service.ts',
];
for (const file of changedTsFiles) {
  const result = ts.transpileModule(read(file), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
    reportDiagnostics: true,
    fileName: file,
  });
  const errors = (result.diagnostics ?? []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  assert.equal(errors.length, 0, `${file} deve transpilar sem erro sintático.`);
}

const migrationDir = path.join(root, 'supabase', 'migrations');
const migrations = fs.existsSync(migrationDir) ? fs.readdirSync(migrationDir) : [];
assert.ok(!migrations.some((name) => /f09|base_permanente|sent_contacts/i.test(name)), 'F09 não pode adicionar migration estrutural.');

console.log('F09 verificado: Base Permanente canônica em leads, deduplicação consolidada, arquivamento condicional e Worker sem bases legadas.');
