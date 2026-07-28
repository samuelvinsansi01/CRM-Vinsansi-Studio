import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from '/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function requireText(file, snippets) {
  const source = read(file);
  for (const snippet of snippets) {
    assert.ok(source.includes(snippet), `${file} deveria conter: ${snippet}`);
  }
  return source;
}

const service = requireText('src/services/queue-preparation/queuePreparation.service.ts', [
  'supabaseLeadCycleRepository.compareAndSet(id, LEAD_STATUS.VALIDATED, { lead_status_id: LEAD_STATUS.QUEUED })',
  'repositories.whatsappQueue.removeQueued(queueItemId)',
  'repositories.instagramQueue.removeQueued(queueItemId)',
  'settingsService.getDispatchSettings()',
  'preparationReason(row, channel',
  'appendAudit(row, channel, resource',
  'missingTemplateMessageNumbers(messages)',
  'O template precisa ter as 4 mensagens',
  'message1: messages.message1',
  'message2: messages.message2',
  'message3: messages.message3',
  'message4: messages.message4',
]);
const createIndex = service.indexOf('const createdIds = channel');
const guardedStatusIndex = service.indexOf('const updated = await supabaseLeadCycleRepository.compareAndSet', createIndex);
assert.ok(createIndex >= 0 && guardedStatusIndex > createIndex, 'O item de fila deve ser criado antes da mudança de status.');

const panel = requireText('src/components/QueuePreparationPanel.tsx', [
  'useQueuePreparation',
  'A data foi movida para o próximo dia ativo do canal.',
  'Mensagens, template, mídia, recurso e data ficam congelados',
]);
assert.ok(!panel.includes(".from('leads')"), 'A interface não deve gravar diretamente em leads.');
assert.ok(!panel.includes('lead_status_id:'), 'A interface não deve definir status diretamente.');

requireText('src/repositories/whatsapp-queue/whatsappQueue.repository.ts', [
  'enqueue(leads: CreateWhatsAppQueueLeadInput[]): Promise<string[]>',
  'removeQueued(id: string): Promise<void>',
]);
requireText('src/repositories/instagram-queue/instagramQueue.repository.ts', [
  'enqueue(leads: CreateInstagramQueueLeadInput[]): Promise<string[]>',
  'removeQueued(id: string): Promise<void>',
]);
requireText('src/repositories/whatsapp-queue/supabaseWhatsAppQueue.repository.ts', [
  ".eq('user_id', userId)",
  ".eq('status', 'queued')",
  'createdIds.push(lead.id)',
  'block_size: Math.max(1, Number(lead.batchLimit || 30))',
]);
requireText('src/repositories/instagram-queue/supabaseInstagramQueue.repository.ts', [
  ".eq('user_id', userId)",
  ".eq('status', 'queued')",
  'createdIds.push(lead.id)',
  ".select('leads_id')",
  'block_size: Math.max(1, Number(lead.batchLimit || 15))',
]);
requireText('src/pages/PreSendPage.tsx', ['<QueuePreparationPanel onToast={toast} />']);

requireText('src/services/templates/templateSelector.ts', [
  'hasAllTemplateMessages(template)',
]);
requireText('src/services/config/config.service.ts', [
  'assertAllTemplateMessages(template)',
  "fail('message3'",
  "fail('message4'",
]);
requireText('src/services/platform-config/platformConfig.service.ts', [
  'message3: template.message3',
  'message4: template.message4',
]);
requireText('src/services/whatsapp-queue/whatsappQueue.guards.ts', [
  "fields.push('message_3')",
  "fields.push('message_4')",
]);
requireText('src/services/whatsapp-queue/whatsapp.evolution.gateway.ts', [
  'lead.message_3 || lead.message3',
  'lead.message_4 || lead.message4',
  'await sendImage(instance, lead)',
]);
requireText('src/services/whatsapp-queue/whatsappQueue.service.ts', [
  "part: 'message_3'",
  "part: 'message_4'",
]);
requireText('src/services/instagram-queue/instagramQueue.service.ts', [
  'hasAllTemplateMessages(candidate)',
]);


const rulesFile = 'src/services/queue-preparation/queuePreparation.rules.ts';
const compiled = ts.transpileModule(read(rulesFile), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  reportDiagnostics: true,
  fileName: rulesFile,
});
const errors = (compiled.diagnostics ?? []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
assert.equal(errors.length, 0, 'As regras de data devem transpilar sem erro.');
const sandbox = { exports: {}, module: { exports: {} }, require: () => { throw new Error('Import inesperado nas regras puras.'); }, console, Date };
sandbox.exports = sandbox.module.exports;
vm.runInNewContext(compiled.outputText, sandbox, { filename: rulesFile });
const { effectiveScheduleDate } = sandbox.module.exports;
const weekdays = ['Segunda', 'Terca', 'Quarta', 'Quinta', 'Sexta'];

assert.deepEqual(
  JSON.parse(JSON.stringify(effectiveScheduleDate('2026-07-28', weekdays, new Date(2026, 6, 28, 21, 0, 0)))),
  { requestedDate: '2026-07-28', effectiveDate: '2026-07-28', cutoffApplied: false, activeDayAdjusted: false },
);
assert.deepEqual(
  JSON.parse(JSON.stringify(effectiveScheduleDate('2026-07-28', weekdays, new Date(2026, 6, 28, 22, 30, 0)))),
  { requestedDate: '2026-07-28', effectiveDate: '2026-07-29', cutoffApplied: true, activeDayAdjusted: false },
);
assert.deepEqual(
  JSON.parse(JSON.stringify(effectiveScheduleDate('2026-07-31', weekdays, new Date(2026, 6, 31, 22, 30, 0)))),
  { requestedDate: '2026-07-31', effectiveDate: '2026-08-03', cutoffApplied: true, activeDayAdjusted: true },
);
assert.deepEqual(
  JSON.parse(JSON.stringify(effectiveScheduleDate('2026-08-01', weekdays, new Date(2026, 6, 31, 12, 0, 0)))),
  { requestedDate: '2026-08-01', effectiveDate: '2026-08-03', cutoffApplied: false, activeDayAdjusted: true },
);

const migrationDir = path.join(root, 'supabase', 'migrations');
const migrationFiles = fs.existsSync(migrationDir) ? fs.readdirSync(migrationDir) : [];
assert.ok(!migrationFiles.some((name) => name.startsWith('20260728')), 'O F06 não deve adicionar migration estrutural.');

console.log('F06 verificado: quatro mensagens obrigatórias e congeladas, fila antes do status, compensação, capacidade, datas operacionais, segurança por usuário e ausência de alteração estrutural no banco.');
