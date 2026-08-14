import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const migration = read('supabase/migrations/20260813130000_instagram_dispatch_operational.sql');
const api = read('api/instagram/extension.ts');
const repository = read('src/repositories/instagram-queue/canonicalInstagramQueue.repository.ts');
const queuePage = read('src/pages/QueuePage.tsx');
const validation = read('src/pages/ValidationRoutingPage.tsx');
const approved = read('src/components/ApprovedLeadsQueueDrawer.tsx');

for (const token of [
  "v_existing.step IN ('sent','invalid','error','reconciliation_required')",
  'v_item.status_id<>3',
  'INSERT INTO public.sents',
  'sents_idempotency_key',
  'instagram_error_after_dispatch_requires_reconciliation',
  'instagram_reprocess_queue_items',
  "v_progress.step<>'error'",
  'instagram_invalidate_queue_item',
]) assert(migration.includes(token), `Migration Instagram v0.17.3 sem contrato: ${token}`);

assert(api.includes("queueStatus === 'queued' && progressStep === 'error'"), 'API não protege retry após reprocessamento.');
assert(repository.includes("step === 'reconciliation_required'"), 'CRM não distingue reconciliação de erro reprocessável.');
assert(repository.includes("rpc('instagram_reprocess_queue_items'"), 'CRM não usa RPC segura de reprocessamento Instagram.');
assert(repository.includes("rpc('instagram_invalidate_queue_item'"), 'CRM não usa RPC atômica de invalidação Instagram.');
assert(queuePage.includes("lead.status === 'error'"), 'Botão Reprocessar erros não está restrito a erro seguro.');
assert(queuePage.includes('Reconciliação necessária'), 'Fila não identifica reconciliação manual.');
assert(validation.includes('Aprovar Instagram ('), 'Validação não possui aprovação Instagram em lote explícita.');
assert(approved.includes('Adicionar até {capacity} vaga(s)'), 'Drawer de aprovados não possui inclusão rápida até a capacidade.');

console.log('Instagram operacional v0.17.3: OK — base, retry seguro, reconciliação, fila rápida e sents idempotente.');
