import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const migration = read('supabase/migrations/20260802090000_worker_persistence_idempotency.sql');
const service = read('src/services/whatsapp-queue/whatsappQueue.service.ts');
const dispatchApi = read('api/whatsapp/dispatch.ts');
const batchApi = read('api/whatsapp/batch.ts');
const manifest = JSON.parse(read('public/tools/manifest.json'));
const workerZip = path.join(root, 'public/tools/worker-latest.zip');
const worker = manifest.tools.find((tool) => tool.id === 'worker');
const workerSource = execFileSync('unzip', ['-p', workerZip, `Worker_v${worker?.version}/src/worker.js`], { encoding: 'utf8' });

const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };

assert(migration.includes('CREATE TABLE IF NOT EXISTS public.worker_batches'), 'Tabela de lotes persistentes ausente.');
assert(migration.includes('CREATE TABLE IF NOT EXISTS public.worker_batch_items'), 'Tabela de itens do lote ausente.');
assert(migration.includes('CREATE TABLE IF NOT EXISTS public.queue_item_dispatch_parts'), 'Ledger de partes idempotentes ausente.');
assert(migration.includes('worker_batches_one_active_per_chip'), 'Proteção contra dois lotes ativos no mesmo chip ausente.');
assert(migration.includes('sents_idempotency_key_unique'), 'Unicidade do registro de envio ausente.');
assert(migration.includes('worker_claim_dispatch_part'), 'RPC de claim por parte ausente.');
assert(migration.includes('worker_complete_dispatch_part'), 'RPC de conclusão por parte ausente.');
assert(migration.includes('worker_recover_stale_whatsapp'), 'Recuperação após reinício ausente.');
assert(migration.includes('reconciliation_required_after_worker_restart'), 'Estado conservador para resultado incerto ausente.');
assert(migration.includes('worker_finalize_whatsapp_queue_item'), 'Finalização canônica do item ausente.');

assert(/const VERSION = '3\.[3-9]\.0'/.test(workerSource), 'Worker 3.3.0 ou superior não foi empacotado.');
assert(workerSource.includes(".from('worker_batches')"), 'Scheduler não lê lotes persistentes.');
assert(workerSource.includes('worker_claim_dispatch_part'), 'Worker não reivindica partes idempotentes.');
assert(workerSource.includes('dispatch_part_persistence_uncertain'), 'Worker não protege a janela Evolution/banco.');
assert(workerSource.includes('worker_recover_stale_whatsapp'), 'Worker não executa recuperação periódica.');
assert(!workerSource.includes('const controls = new Map()'), 'Lote ainda depende de Map em memória.');

assert(service.includes('O Worker persiste qualquer item que chegou a reivindicar'), 'Painel ainda pode sobrescrever o estado canônico do Worker.');
assert(!service.includes('Itens movidos para erro e prontos para reprocessamento'), 'Fluxo antigo de erro forçado pelo frontend permanece ativo.');
assert(dispatchApi.includes("payload?.ok===false&&!Array.isArray(payload?.results)"), 'Proxy descarta resultados parciais do Worker.');
assert(batchApi.includes("'state','status'"), 'Proxy de lote não aceita a ação status usada pelo frontend.');

assert(/^3\.(?:[3-9]|[1-9]\d)\.\d+$/.test(String(worker?.version ?? '')), 'Manifesto não publica Worker 3.3.0 ou superior.');

if (failures.length) {
  console.error(`Falhas na persistência/idempotência do Worker (${failures.length}):`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('OK: lotes persistentes, recuperação após reinício e idempotência por parte validados.');
