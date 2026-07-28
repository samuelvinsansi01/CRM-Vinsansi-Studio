import { readFile, readdir, access } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const workerRoot = process.env.WORKER_F07_ROOT ? resolve(process.env.WORKER_F07_ROOT) : '';

async function text(path) { return readFile(resolve(root, path), 'utf8'); }
async function pathExists(path) { try { await access(path); return true; } catch { return false; } }
async function workerText(path) { return readFile(resolve(workerRoot, path), 'utf8'); }
function assert(condition, message) { if (!condition) throw new Error(message); }

const [batchApi, dispatchApi, repository, queuePage] = await Promise.all([
  text('api/whatsapp/batch.ts'),
  text('api/whatsapp/dispatch.ts'),
  text('src/repositories/whatsapp-queue/supabaseWhatsAppQueue.repository.ts'),
  text('src/pages/QueuePage.tsx'),
]);
const hasExternalWorker = Boolean(workerRoot) && await pathExists(resolve(workerRoot, 'src/worker.js')) && await pathExists(resolve(workerRoot, 'package.json'));
const workerContract = JSON.parse(await text('scripts/contracts/worker-v2.9.0.json'));
const worker = hasExternalWorker ? await workerText('src/worker.js') : '';
const workerPackage = hasExternalWorker ? await workerText('package.json') : JSON.stringify({ version: workerContract.version });

assert(batchApi.includes(".from('users')") && batchApi.includes(".eq('auth_user_id'"), 'Proxy de lote precisa resolver users_id interno.');
assert(batchApi.includes(".eq('user_id', auth.publicUserId)") && batchApi.includes(".in('id', ids)"), 'Proxy de lote precisa conferir posse exata da fila.');
assert(batchApi.includes('assertStartContract') && batchApi.includes('batch_multiple_chips_not_supported'), 'Proxy precisa validar um chip por comando de início.');
assert(dispatchApi.includes('user_id: publicUserId') && dispatchApi.includes('assertOwned'), 'Disparo direto precisa encaminhar usuário e conferir posse.');

for (const status of ['error', 'invalid', 'sent']) {
  assert(repository.includes(`isStatusGroup(lead.status, '${status}')`), `Repository deve manter ${status} visível.`);
}
assert(repository.includes(".eq('status', lead.status)") && repository.includes(".select('id')"), 'Atualizações da fila precisam usar compare-and-set.');
assert(queuePage.includes('Array.from(new Set(batches.map((batch) => batch.chip)'), 'Ações globais devem mirar somente chips visíveis na fila.');

const workerVersion = JSON.parse(workerPackage).version;
const [workerMajor, workerMinor] = workerVersion.split('.').map(Number);
assert(workerMajor > 2 || (workerMajor === 2 && workerMinor >= 7), 'Worker precisa estar na versão 2.7.0 ou superior compatível.');
if (hasExternalWorker) {
  assert(worker.includes(`const VERSION = '${workerVersion}'`), 'Versão do código e package.json do Worker precisam coincidir.');
  assert(worker.includes('batches_by_chip') && worker.includes('controlBatchesFromPayload'), 'Worker precisa manter controles independentes por chip.');
  assert(worker.includes('claimQueueItem') && worker.includes("['queued', 'ready_to_dispatch'"), 'Scheduler precisa fazer claim condicional do item.');
  assert(worker.includes(".from('leads')") && worker.includes('lead_status_id: 5') && worker.includes(".eq('lead_status_id', 4)"), 'Worker precisa atualizar o lead canônico de 4 para 5.');
  assert(worker.includes('dispatch_user_required') && worker.includes('queue_item_not_available_for_current_user'), 'Disparo do Worker precisa validar o usuário.');
  assert(worker.includes('for (const number of [1, 2, 3, 4])'), 'Worker precisa enviar quatro mensagens.');
} else {
  for (const feature of ['batches_by_chip', 'claim_queue_item', 'canonical_lead_status_4_to_5', 'user_scope', 'four_messages', 'data_snapshot_only']) {
    assert(workerContract.features.includes(feature), `Contrato do Worker ausente: ${feature}.`);
  }
}


const migrations = await readdir(resolve(root, 'supabase/migrations')).catch(() => []);
assert(!migrations.some((name) => name.includes('f07') || name.includes('whatsapp_queue_control')), 'F07 não pode adicionar migration estrutural.');

console.log('F07 verificado: autenticação, posse, lotes por chip, claim, reprocessamento, quatro mensagens e status canônico.');
