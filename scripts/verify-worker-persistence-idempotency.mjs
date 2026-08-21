import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const migration = read('supabase/migrations/20260802090000_worker_persistence_idempotency.sql');
const service = read('src/services/whatsapp-queue/whatsappQueue.service.ts');
const dispatchApi = read('api/whatsapp/dispatch.ts');
const batchApi = read('api/whatsapp/batch.ts');
const manifest = JSON.parse(read('public/tools/manifest.json'));

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

assert(service.includes('O Worker persiste qualquer item que chegou a reivindicar'), 'Painel ainda pode sobrescrever o estado canônico do Worker.');
assert(!service.includes('Itens movidos para erro e prontos para reprocessamento'), 'Fluxo antigo de erro forçado pelo frontend permanece ativo.');
assert(dispatchApi.includes('send(res,410') && !dispatchApi.includes('callWorker'), 'Endpoint direto do WhatsApp não foi descontinuado de forma fail-closed.');
assert(batchApi.includes("'state','status'"), 'Proxy de lote não aceita a ação status usada pelo frontend.');
assert(!manifest.tools.some((tool) => tool.id === 'worker'), 'Worker standalone ainda está publicado em Ferramentas.');
assert(!fs.existsSync(path.join(root, 'public/tools/worker-latest.zip')), 'ZIP standalone do Worker ainda está publicado.');

if (failures.length) {
  console.error(`Falhas na persistência/idempotência do Worker (${failures.length}):`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('OK: backend de lotes/idempotência preservado e Worker standalone removido; runtime oficial pertence ao Gerenciador.');
