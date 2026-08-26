import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const check = (condition, message) => { if (!condition) throw new Error(message); };

const pkg = JSON.parse(read('package.json'));
check(Boolean(pkg.devDependencies?.['@types/node']), 'R39: @types/node precisa existir para os handlers server-side com node:crypto.');
check(fs.existsSync(path.join(root, 'src/repositories/release/homologation.repository.ts')), 'R39: repository de Homologacao ausente do pacote.');

const review = read('src/components/QueueReviewPanel.tsx');
check(review.includes('removeItemLocally'), 'R39: Revisao deve remover linha localmente.');
check(review.includes('setBatches((current) => current'), 'R39: Revisao precisa de atualizacao otimista/local.');
const approveBlock = review.slice(review.indexOf('const approve = async'), review.indexOf('const invalidate = async'));
const invalidateBlock = review.slice(review.indexOf('const invalidate = async'), review.indexOf('const handleAction'));
check(!approveBlock.includes('await refresh()'), 'R39: aprovar nao pode recarregar/desmontar a tabela.');
check(!invalidateBlock.includes('await refresh()'), 'R39: invalidar nao pode recarregar/desmontar a tabela.');

const waHook = read('src/hooks/useWhatsAppQueue.ts');
const igHook = read('src/hooks/useInstagramQueue.ts');
check(/invalidate[\s\S]*setBatches[\s\S]*refresh\(\)/.test(waHook), 'R39: invalidacao WhatsApp deve remover localmente e sincronizar em background.');
check(/invalidate[\s\S]*setBatches[\s\S]*refresh\(\)/.test(igHook), 'R39: invalidacao Instagram deve remover localmente e sincronizar em background.');

const page = read('src/pages/QueuePage.tsx');
check(!/await invalidate\(lead\);setConfirmLead\(null\);setReviewRefreshKey/.test(page), 'R39: invalidacao da Fila final nao deve forcar reload visual da Revisao.');

console.log('R39: build package + filas otimistas aprovados.');
