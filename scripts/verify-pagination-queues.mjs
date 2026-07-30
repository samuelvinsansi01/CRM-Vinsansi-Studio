import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };

const paginatedFiles = [
  'src/pages/BasePage.tsx',
  'src/pages/PreSendPage.tsx',
  'src/pages/ValidationRoutingPage.tsx',
  'src/pages/CatalogCrudPage.tsx',
  'src/pages/ChannelsPage.tsx',
  'src/pages/AuditPage.tsx',
  'src/pages/ImportPage.tsx',
  'src/pages/QueuePage.tsx',
  'src/components/QueuePreparationPanel.tsx',
  'src/components/ApprovedLeadsQueueDrawer.tsx',
];

for (const file of paginatedFiles) {
  const source = read(file);
  assert(source.includes('RowsPerPageControl'), `${file} perdeu o seletor de linhas por página.`);
  assert(source.includes('Pagination') || source.includes('page={'), `${file} perdeu os controles de paginação.`);
}

const queuePage = read('src/pages/QueuePage.tsx');
assert((queuePage.match(/Puxar aprovados/g) ?? []).length === 2, 'WhatsApp e Instagram precisam exibir o botão Puxar aprovados.');
assert(queuePage.includes('channel="WhatsApp"'), 'Fila WhatsApp perdeu o drawer de leads aprovados.');
assert(queuePage.includes('channel="Instagram"'), 'Fila Instagram perdeu o drawer de leads aprovados.');

const drawer = read('src/components/ApprovedLeadsQueueDrawer.tsx');
assert(drawer.includes('Adicionar à fila'), 'Drawer perdeu a ação de inclusão na fila.');
assert(drawer.includes('resource.id === preferredResourceId || resource.label === preferredResourceId'), 'Seleção de chip/perfil não aceita o filtro atual da fila.');

const preparation = read('src/services/queue-preparation/queuePreparation.service.ts');
assert(preparation.includes('listByStatuses([LEAD_STATUS.VALIDATED]'), 'A preparação deixou de buscar apenas leads validados.');
assert(preparation.includes('compareAndSet(id, LEAD_STATUS.VALIDATED'), 'A preparação perdeu a transição condicional do lead validado.');

if (failures.length) {
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('Paginação e puxada de leads aprovados confirmadas nas filas WhatsApp e Instagram.');
