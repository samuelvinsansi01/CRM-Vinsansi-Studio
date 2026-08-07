import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../src/pages/ValidationRoutingPage.tsx', import.meta.url), 'utf8');
const service = readFileSync(new URL('../src/services/whatsapp-validation/whatsappCapacityValidation.service.ts', import.meta.url), 'utf8');
const validation = readFileSync(new URL('../src/services/whatsapp-validation/whatsappValidation.service.ts', import.meta.url), 'utf8');
const preparation = readFileSync(new URL('../src/services/queue-preparation/queuePreparation.service.ts', import.meta.url), 'utf8');

const assertions = [
  [page.includes('validation-routing__chip-select'), 'seletor de chip ativo ausente na tela de validação'],
  [page.includes('Validar e preencher'), 'botão de validação por capacidade ausente'],
  [page.includes("useLeadCycle('pre-send')"), 'leads aguardando validação não aparecem na tela canônica'],
  [service.includes('validationSlots = Math.max(0, validationSlots - confirmedIds.length)'), 'inválidos estão consumindo vaga de validação'],
  [service.includes('revalidateApprovedWithChip') && service.includes('requiresWhatsAppValidation'), 'legados sem prova não voltam à revalidação operacional'],
  [service.includes("queuePreparationService.enqueueValidated('WhatsApp'"), 'confirmados não são inseridos na fila do chip selecionado'],
  [service.includes('resource.available'), 'capacidade restante do chip não é conferida'],
  [service.includes('LEAD_STATUS.IMPORTED') && service.includes('LEAD_STATUS.PRE_SEND'), 'puxada de importados para validação ausente'],
  [validation.includes('validateInitialWithChip'), 'validação não fixa o chip escolhido pelo operador'],
  [preparation.includes("'sent'"), 'itens enviados não ocupam o limite diário'],
];

const failed = assertions.filter(([ok]) => !ok).map(([, message]) => message);
if (failed.length) {
  console.error(failed.join('\n'));
  process.exit(1);
}
console.log('Validação por capacidade: prova, chip, limite diário, reposição de inválidos e fila automática confirmados.');
