import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from '/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const requireText = (file, snippets) => {
  const source = read(file);
  for (const snippet of snippets) assert.ok(source.includes(snippet), `${file} deveria conter: ${snippet}`);
  return source;
};

const rulesSource = requireText('src/services/reconciliation/reconciliation.rules.ts', [
  'lead-without-queue',
  'lead-status-behind-queue',
  'duplicate-active-queue',
  'stuck-queue-item',
  "'sync-lead-sent'",
  "'return-lead-to-valid'",
  'safeForBulkRepair',
]);
const repository = requireText('src/repositories/reconciliation/supabaseReconciliation.repository.ts', [
  "getSupabaseConfig().tables.importLeads",
  "config.tables.whatsappQueueItems",
  "config.tables.instagramQueueItems",
  ".eq('users_id', userId)",
  ".eq('user_id', userId)",
  ".eq('lead_status_id', expectedStatus)",
  "issue.repairAction === 'mark-queue-error'",
  "issue.queueUpdatedAt",
]);
assert.ok(!repository.includes(".from('base_permanente')"));
assert.ok(!repository.includes(".from('sent_contacts')"));

requireText('src/services/reconciliation/reconciliation.service.ts', [
  "source: 'reconciliation'",
  "flow: 'F10'",
  'repairSafeIssues',
  "eventBus.emit('audit:changed'",
]);
requireText('src/pages/AuditPage.tsx', [
  'Corrigir casos seguros',
  'Revisão manual',
  'useReconciliation()',
  'scan.staleAfterMinutes',
]);
requireText('src/pages/pageRegistry.ts', ["| 'audit'", "{ id: 'audit', label: 'Auditoria' }"]);
requireText('src/App.tsx', ["import { AuditPage }", "activePage === 'audit'"]);
requireText('src/lib/events/eventBus.ts', ["'audit:changed'"]);

const compile = (source, fileName, module = ts.ModuleKind.CommonJS) => {
  const result = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module, jsx: ts.JsxEmit.ReactJSX },
    reportDiagnostics: true,
    fileName,
  });
  const errors = (result.diagnostics ?? []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  assert.equal(errors.length, 0, `${fileName} deve transpilar sem erro sintático.`);
  return result.outputText;
};

const statusSandbox = {
  module: { exports: {} },
  exports: {},
  require: (specifier) => {
    if (specifier === './leadStatus') return {
      LEAD_STATUS: { IMPORTED: 1, VALIDATED: 2, PRE_SEND: 3, QUEUED: 4, SENT: 5, INVALID: 6, DUPLICATE: 7, ARCHIVED: 8 },
    };
    throw new Error(`Import inesperado no status mapper: ${specifier}`);
  },
};
statusSandbox.exports = statusSandbox.module.exports;
vm.runInNewContext(compile(read('src/services/status/status.mapper.ts'), 'status.mapper.ts'), statusSandbox, { filename: 'status.mapper.ts' });
const statusExports = statusSandbox.module.exports;
const rulesSandbox = {
  module: { exports: {} },
  exports: {},
  require: (specifier) => {
    if (specifier === '../status/status.mapper') return statusExports;
    throw new Error(`Import inesperado: ${specifier}`);
  },
  Date,
  Map,
  Set,
  Math,
  Number,
  String,
  Array,
};
rulesSandbox.exports = rulesSandbox.module.exports;
vm.runInNewContext(compile(rulesSource, 'reconciliation.rules.ts'), rulesSandbox, { filename: 'reconciliation.rules.ts' });
const { analyzeReconciliationSnapshot } = rulesSandbox.module.exports;

const now = new Date('2026-07-28T15:00:00.000Z');
const old = '2026-07-28T13:00:00.000Z';
const recent = '2026-07-28T14:55:00.000Z';
const leads = [
  { id: '1', name: 'Sem fila', statusId: 4, channelId: 1, updatedAt: recent },
  { id: '2', name: 'Fila criada', statusId: 2, channelId: 1, updatedAt: recent },
  { id: '3', name: 'Enviado pendente', statusId: 4, channelId: 1, updatedAt: recent },
  { id: '4', name: 'Inválido pendente', statusId: 4, channelId: 2, updatedAt: recent },
  { id: '5', name: 'Travado', statusId: 4, channelId: 1, updatedAt: recent },
  { id: '6', name: 'Duplicado ativo', statusId: 4, channelId: 1, updatedAt: recent },
  { id: '7', name: 'Final ativo', statusId: 5, channelId: 1, updatedAt: recent },
];
const queues = [
  { id: 'q2', channel: 'whatsapp', leadId: '2', status: 'queued', statusRaw: 'queued', updatedAt: recent, createdAt: recent },
  { id: 'q3', channel: 'whatsapp', leadId: '3', status: 'sent', statusRaw: 'sent', updatedAt: recent, createdAt: recent },
  { id: 'q4', channel: 'instagram', leadId: '4', status: 'invalid', statusRaw: 'invalid', updatedAt: recent, createdAt: recent },
  { id: 'q5', channel: 'whatsapp', leadId: '5', status: 'sending', statusRaw: 'sending', updatedAt: old, createdAt: old },
  { id: 'q6a', channel: 'whatsapp', leadId: '6', status: 'queued', statusRaw: 'queued', updatedAt: recent, createdAt: recent },
  { id: 'q6b', channel: 'instagram', leadId: '6', status: 'following', statusRaw: 'following', updatedAt: recent, createdAt: recent },
  { id: 'q7', channel: 'whatsapp', leadId: '7', status: 'queued', statusRaw: 'queued', updatedAt: recent, createdAt: recent },
  { id: 'orphan', channel: 'instagram', leadId: '999', status: 'queued', statusRaw: 'queued', updatedAt: recent, createdAt: recent },
];
const scan = analyzeReconciliationSnapshot(leads, queues, 45, now);
const actionByLead = new Map(scan.issues.filter((issue) => issue.leadId).map((issue) => [issue.leadId, issue.repairAction]));
assert.equal(actionByLead.get('1'), 'return-lead-to-valid');
assert.equal(actionByLead.get('2'), 'sync-lead-queued');
assert.equal(actionByLead.get('3'), 'sync-lead-sent');
assert.equal(actionByLead.get('4'), 'sync-lead-invalid');
assert.ok(scan.issues.some((issue) => issue.type === 'stuck-queue-item' && issue.leadId === '5'));
assert.ok(scan.issues.some((issue) => issue.type === 'duplicate-active-queue' && issue.leadId === '6' && !issue.repairAction));
assert.ok(scan.issues.some((issue) => issue.type === 'active-queue-for-final-lead' && issue.leadId === '7'));
assert.ok(scan.issues.some((issue) => issue.type === 'orphan-queue-item' && issue.leadId === '999'));
assert.ok(scan.summary.safeBulk >= 4);

const changedTsFiles = [
  'src/services/reconciliation/types.ts',
  'src/services/reconciliation/reconciliation.rules.ts',
  'src/services/reconciliation/reconciliation.service.ts',
  'src/repositories/reconciliation/reconciliation.repository.ts',
  'src/repositories/reconciliation/supabaseReconciliation.repository.ts',
  'src/hooks/useReconciliation.ts',
  'src/pages/AuditPage.tsx',
  'src/pages/pageRegistry.ts',
  'src/App.tsx',
  'src/lib/events/eventBus.ts',
];
for (const file of changedTsFiles) compile(read(file), file, ts.ModuleKind.ESNext);

const migrationDir = path.join(root, 'supabase', 'migrations');
const migrations = fs.existsSync(migrationDir) ? fs.readdirSync(migrationDir) : [];
assert.ok(!migrations.some((name) => /f10|audit|reconciliation|reconcile/i.test(name)), 'F10 não pode adicionar migration estrutural.');

console.log('F10 verificado: diagnóstico entre leads e filas, reparos compare-and-set, tratamento conservador e ausência de alteração estrutural no banco.');
