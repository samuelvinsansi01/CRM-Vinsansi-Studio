import fs from 'node:fs';

const page = fs.readFileSync(new URL('../src/pages/ValidationRoutingPage.tsx', import.meta.url), 'utf8');
const rules = fs.readFileSync(new URL('../src/services/lead-cycle/leadRouting.rules.ts', import.meta.url), 'utf8');
const types = fs.readFileSync(new URL('../src/services/lead-cycle/types.ts', import.meta.url), 'utf8');

const requiredPage = [
  "if (lead.statusId === 1) return ['validate', 'edit', 'invalidate'];",
  "if (lead.statusId === 2) return ['return', 'edit', 'invalidate'];",
  "await valid.executeRoutingCommand('invalidate-valid', [lead.id])",
  "await imported.executeRoutingCommand('route-imported-to-instagram', [lead.id])",
  "await imported.executeRoutingCommand('route-imported-to-whatsapp', [lead.id])",
  "whatsappValidationService.validateInitialWithChip([lead.id], selectedChip)",
  "const totalRecords = visible.length;",
];

for (const token of requiredPage) {
  if (!page.includes(token)) throw new Error(`ValidationRoutingPage sem contrato v0.17.9: ${token}`);
}
if (!rules.includes("'invalidate-valid': { expectedStatus: LEAD_STATUS.VALIDATED, targetStatus: LEAD_STATUS.INVALID }")) {
  throw new Error('invalidate-valid não aponta para status INVALID (6).');
}
if (!types.includes("| 'invalidate-valid'")) throw new Error('LeadRoutingCommand não inclui invalidate-valid.');
if (page.includes("if (lead.statusId === 1 && lead.channel === 'Instagram') return ['edit', 'approve'];")) {
  throw new Error('Ação antiga de aprovação específica ainda está ativa nas linhas.');
}

if (!page.includes('value={String(whatsappTotal)} label="WhatsApp"') || !page.includes('value={String(instagramTotal)} label="Instagram"')) {
  throw new Error('ValidationRoutingPage perdeu os cards consolidados WhatsApp/Instagram da v0.18.0.');
}
console.log('Validation routing v0.17.9 compatível com v0.18.0: ações e métricas consolidadas OK.');
