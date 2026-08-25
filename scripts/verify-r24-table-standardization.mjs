import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
let checks = 0;
function ok(condition, message) {
  checks += 1;
  if (!condition) throw new Error(message);
}

const home = read('src/pages/HomePage.tsx');
const base = read('src/pages/BasePage.tsx');
const cycle = read('src/services/lead-cycle/leadCycle.service.ts');
const cycleTypes = read('src/services/lead-cycle/types.ts');
const repoTypes = read('src/repositories/lead-cycle/leadCycle.repository.ts');

for (const label of ['Empresa', 'Ramo', 'Estado', 'Cidade', 'Nota', 'Avaliações', 'Número', 'Instagram', 'Status']) {
  ok(home.includes(`label: '${label}'`), `Home sem coluna ${label}`);
}
ok(home.includes("availabilityTag(Boolean((lead.whatsapp || lead.rawPhone)"), 'Home não padroniza Número em Sim/Não');
ok(home.includes("availabilityTag(Boolean(lead.instagram.trim()))"), 'Home não padroniza Instagram em Sim/Não');
ok(home.includes('<Tag tone="neutral">Importado</Tag>'), 'Home sem status Importado padronizado');
ok(home.includes("'edit' as const"), 'Home sem ação Editar');
ok(home.includes("'invalidate' as const"), 'Home sem ação Invalidar');
ok(!home.includes("'approve' as const"), 'Home voltou a expor aprovação');
ok(home.includes('O lead continua Importado e sem destino'), 'Edição da Home não explicita ausência de destino');
ok(home.includes("executeRoutingCommand('invalidate-imported'"), 'Invalidar na Home não usa transição canônica');

ok(cycleTypes.includes('branchId: string;'), 'LeadCycleLead sem branchId');
ok(repoTypes.includes('branches_id: number;'), 'Patch do lead não suporta ramo pai por ID');
ok(repoTypes.includes('channels_id: number | null;'), 'Patch do lead não consegue preservar Importado sem destino');
ok(cycle.includes('branchId: String(row.branches_id)'), 'Lead não resolve ramo pelo ID canônico');
ok(cycle.includes('lead.statusId === LEAD_STATUS.IMPORTED'), 'Edição não diferencia Importado');
ok(cycle.includes('channels_id: targetChannelId'), 'Edição não persiste destino nulo no Importado');
ok(cycle.includes('branches_id: branchId'), 'Edição não persiste ramo pai por ID');

for (const label of ['Nome da empresa', 'Ramo', 'Estado', 'Cidade', 'Canal de envio', 'Instagram', 'WhatsApp', 'Data de envio', 'Status']) {
  ok(base.includes(`label: '${label}'`), `Base Permanente sem coluna ${label}`);
}
ok(base.includes("if (lead.origin !== 'Instagram' || !lead.instagram) return '—';"), 'Base mostra Instagram fora do canal Instagram');
ok(base.includes("if (lead.origin !== 'WhatsApp') return '—';"), 'Base mostra WhatsApp fora do canal WhatsApp');
ok(base.includes('sentAt: formatDateTime(lead.lastSentAt)'), 'Base não usa Data de envio real');
ok(base.includes("actions={['view']}"), 'Base Permanente deve ter somente ação de consulta');
ok(base.includes('actionsLabel="Ações"'), 'Base Permanente sem cabeçalho Ações');
ok(!base.includes("actions={['view', 'edit'"), 'Base Permanente voltou a permitir edição');
ok(!base.includes("actions={['view', 'edit', 'delete']"), 'Base Permanente voltou a permitir exclusão');
ok(!/baseService\.(update|remove|delete|archive)/.test(base), 'Base Permanente possui escrita direta');

console.log(`R24 padronização de tabelas: PASS (${checks} verificações)`);
