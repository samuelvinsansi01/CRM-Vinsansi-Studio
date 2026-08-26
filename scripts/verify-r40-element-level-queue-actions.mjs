import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const check = (condition, message) => { if (!condition) throw new Error(message); };

const review = read('src/components/QueueReviewPanel.tsx');
check(review.includes('const toastRef = useRef(onToast)'), 'R40: callbacks visuais da pagina pai precisam ficar fora das dependencias do carregamento da Revisao.');
check(review.includes('}, [channel, preferredResourceId, scheduledDate]);'), 'R40: carregamento da Revisao deve depender somente do escopo real da consulta.');
check(!review.includes('[channel, onToast, preferredResourceId, scheduledDate]'), 'R40: toast nao pode provocar nova consulta da tabela.');
check(review.includes('const scopeChanged = scopeRef.current !== scopeKey'), 'R40: loading visual so pode ser reaberto em mudanca real de chip/perfil/data.');

const approveBlock = review.slice(review.indexOf('const approve = async'), review.indexOf('const invalidate = async'));
const reviewInvalidateBlock = review.slice(review.indexOf('const invalidate = async'), review.indexOf('const handleAction'));
check(approveBlock.includes('removeItemLocally(item.reviewItemId)'), 'R40: aprovacao precisa retirar apenas a linha acionada.');
check(reviewInvalidateBlock.includes('removeItemLocally(item.reviewItemId)'), 'R40: invalidacao da Revisao precisa retirar apenas a linha acionada.');
check(!approveBlock.includes('setLoading(true)'), 'R40: aprovacao nao pode ligar loading da tabela.');
check(!reviewInvalidateBlock.includes('setLoading(true)'), 'R40: invalidacao da Revisao nao pode ligar loading da tabela.');

for (const [label, rel] of [['WhatsApp', 'src/hooks/useWhatsAppQueue.ts'], ['Instagram', 'src/hooks/useInstagramQueue.ts']]) {
  const hook = read(rel);
  const start = hook.indexOf('const invalidate = useCallback');
  const end = hook.indexOf('return {', start);
  const block = hook.slice(start, end);
  check(block.includes('setBatches((current)'), `R40: ${label} deve remover a linha da Fila final localmente.`);
  check(block.includes('setSummary((current)'), `R40: ${label} deve ajustar os cards localmente.`);
  check(!block.includes('refresh();'), `R40: invalidacao ${label} nao pode recarregar a colecao inteira.`);
  check(hook.includes('const patchLeadLocally = useCallback'), `R40: ${label} deve permitir editar somente a linha alterada.`);
}

const page = read('src/pages/QueuePage.tsx');
check(page.includes('patchLeadLocally(nameLead.id'), 'R40: edicao de nome deve atualizar apenas o item local.');
const drawerSavedOccurrences = page.match(/onSaved=\{\(alternativeName\)=>\{/g) ?? [];
check(drawerSavedOccurrences.length === 2, 'R40: WhatsApp e Instagram devem usar save local do nome alternativo.');
check(!/onSaved=\{\(alternativeName\)=>\{[^}]*refresh\(\)/.test(page), 'R40: salvar nome nao pode recarregar a tabela.');

console.log('R40: acoes das filas atualizam somente o elemento afetado, sem refresh visual da tabela.');
