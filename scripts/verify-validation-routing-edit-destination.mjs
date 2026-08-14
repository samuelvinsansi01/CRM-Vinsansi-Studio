import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const page = read('src/pages/ValidationRoutingPage.tsx');
const service = read('src/services/lead-cycle/leadCycle.service.ts');
const types = read('src/services/lead-cycle/types.ts');

assert(types.includes('channel: LeadCycleChannel;'), 'LeadCycleDetailsInput não carrega o destino editável.');
assert(page.includes("options={['WhatsApp', 'Instagram']}"), 'Drawer não oferece seleção manual de destino.');
assert(page.includes("updateLeadDraft('channel'"), 'Drawer não persiste a seleção de destino no draft.');
assert(page.includes("leadDraft.channel === 'Instagram'"), 'Aprovação Instagram não respeita o destino selecionado no drawer.');
assert(service.includes('channels_id: targetChannelId'), 'Serviço não persiste o novo destino em leads.channels_id.');
assert(service.includes('Number(before.channels_id)'), 'Edição de destino não protege contra mudança concorrente de canal.');
assert(service.includes("lead.statusId === LEAD_STATUS.PRE_SEND && input.channel !== lead.channel"), 'Lead em pré-envio pode trocar destino de forma insegura.');
assert(service.includes("Para usar Instagram como destino"), 'Falta validação do contato Instagram ao selecionar esse destino.');
assert(service.includes("Para usar WhatsApp como destino"), 'Falta validação do contato WhatsApp ao selecionar esse destino.');

console.log('Validação e roteamento v0.17.4: destino editável no drawer com persistência e guardas de segurança.');
