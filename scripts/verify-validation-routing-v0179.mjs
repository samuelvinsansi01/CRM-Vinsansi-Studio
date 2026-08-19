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
  "const whatsappMetric = metricFor((lead) => lead.channel === 'WhatsApp');",
  "const instagramMetric = metricFor((lead) => lead.channel === 'Instagram');",
  "const ownSiteMetric = metricFor((lead) => lead.contactSourceId === SOURCE_OWN_SITE);",
  "const aggregatorMetric = metricFor((lead) => lead.contactSourceId === SOURCE_AGGREGATOR);",
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

console.log('Validation routing v0.17.9: ações, requisitos por destino e métricas filtradas OK.');
