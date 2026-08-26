import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const check = (condition, message) => { if (!condition) throw new Error(message); };

const review = read('src/components/QueueReviewPanel.tsx');
check(review.includes('const pendingItemsRef = useRef(new Set<string>())'), 'R41: ações simultâneas precisam de guarda sem deixar a linha travada.');
check(review.includes('const restoreItemLocally = useCallback'), 'R41: falha do backend deve restaurar somente a linha afetada.');
check(!review.includes("const [workingItem, setWorkingItem]"), 'R41: a linha não pode permanecer visível com ações escondidas enquanto aguarda o backend.');

const approveBlock = review.slice(review.indexOf('const approve = async'), review.indexOf('const invalidate = async'));
const invalidateBlock = review.slice(review.indexOf('const invalidate = async'), review.indexOf('const handleAction'));
for (const [label, block, serviceCall] of [
  ['aprovar', approveBlock, 'await queueReviewService.approve'],
  ['invalidar', invalidateBlock, 'await queueReviewService.invalidate'],
]) {
  const removeAt = block.indexOf('removeItemLocally(item.reviewItemId)');
  const awaitAt = block.indexOf(serviceCall);
  const restoreAt = block.indexOf('restoreItemLocally(item, sourceBatch)');
  check(removeAt >= 0 && awaitAt >= 0 && removeAt < awaitAt, `R41: ${label} deve retirar a linha antes de esperar o backend.`);
  check(restoreAt > awaitAt, `R41: ${label} deve restaurar a linha somente se a operação falhar.`);
}
check(review.includes('!reviewItems.length ? <div className="table-message">Nenhum lead aguardando revisão'), 'R41: estado vazio deve reagir imediatamente após remover a última linha.');
check(review.includes('items: [...batch.items, item].sort((a, b) => a.position - b.position)'), 'R41: rollback deve devolver o lead à posição correta.');

console.log('R41: ações da Revisão respondem imediatamente e fazem rollback local em caso de falha.');
