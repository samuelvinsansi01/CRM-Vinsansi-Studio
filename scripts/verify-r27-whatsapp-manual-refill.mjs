import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (file) => readFileSync(join(root, file), 'utf8');
let checks = 0;
const ok = (value, message) => { checks += 1; assert.ok(value, message); };

const reviewService = read('src/services/queue-review/queueReview.service.ts');
const reviewPanel = read('src/components/QueueReviewPanel.tsx');
const queuePage = read('src/pages/QueuePage.tsx');
const whatsappValidationHandler = read('server/whatsapp/validation.handler.ts');

// WhatsApp: invalidar nunca deve iniciar reserva/validação/reposição automática.
const invalidateBlock = reviewService.slice(
  reviewService.indexOf('async function invalidate(item: QueueReviewItem'),
  reviewService.indexOf('async function lock(batch: QueueReviewBatch)'),
);
ok(invalidateBlock.includes("if (channel === 'Instagram')"), 'invalidação da revisão não diferencia Instagram de WhatsApp');
ok(invalidateBlock.includes('await fillBatch(channel, resource, item.scheduledDate)'), 'Instagram perdeu a reposição automática da revisão');
ok(!invalidateBlock.includes("channel === 'WhatsApp'"), 'invalidação da revisão criou caminho automático específico de WhatsApp');
ok(!queuePage.includes("queueReviewService.pullToCapacity('WhatsApp', scheduledDate, activeChip)"), 'Fila final WhatsApp ainda repõe automaticamente após invalidar');
ok(queuePage.includes("queueReviewService.pullToCapacity('Instagram', scheduledDate, activeProfile)"), 'Fila final Instagram deixou de repor automaticamente');

// WhatsApp só preenche/valida quando o operador aciona o pull explícito.
ok(reviewPanel.includes('queueReviewService.pullToCapacity(channel, scheduledDate, preferredResourceId)'), 'botão Puxar deixou de acionar pull explícito');
ok(reviewPanel.includes('`Puxar ${channel}`'), 'ação Puxar não está disponível na revisão');
ok(reviewService.includes("return fillBatch(channel, resource, scheduledDate, { revalidateExisting: channel === 'WhatsApp' });"), 'pull explícito de WhatsApp deixou de validar/preencher a capacidade');
ok(whatsappValidationHandler.includes('whatsapp_validation_requests'), 'validação WhatsApp deixou de usar o control plane persistente');
ok(!whatsappValidationHandler.includes('WHATSAPP_VALIDATION_WORKER_URL'), 'validação WhatsApp voltou a depender de URL direta do Worker');

// Feedback deixa claro que a vaga WhatsApp fica aberta até novo clique.
ok(reviewPanel.includes('Um novo lead só será puxado quando você clicar em Puxar WhatsApp.'), 'feedback da revisão não informa reposição manual WhatsApp');
ok(queuePage.includes('só será preenchida quando você clicar em Puxar WhatsApp.'), 'feedback da Fila final não informa reposição manual WhatsApp');
ok(queuePage.includes('Uma nova vaga foi enviada para Revisão.'), 'feedback automático do Instagram foi removido indevidamente');

console.log(`R27 reposição manual WhatsApp: PASS (${checks} verificações)`);
