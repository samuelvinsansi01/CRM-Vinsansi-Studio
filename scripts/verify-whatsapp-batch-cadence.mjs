import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const migration = read('../supabase/migrations/20260806110000_preserve_whatsapp_batch_cadence.sql');
const worker = read('../../worker/src/worker.js');
const sql = migration.replace(/\s+/g, ' ').trim().toLowerCase();
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };

function sliceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  return startIndex >= 0 && endIndex > startIndex ? source.slice(startIndex, endIndex) : '';
}

function resumedAt(nowMs, pausedAtMs, nextRunAtMs) {
  if (pausedAtMs == null || nextRunAtMs == null) return nowMs;
  return nowMs + Math.max(nextRunAtMs - pausedAtMs, 0);
}

function recoveredAt(nowMs, nextRunAtMs) {
  return Math.max(nextRunAtMs ?? nowMs, nowMs);
}

function shouldFinalizeBatch(statusId, itemStatusIds) {
  return [4, 8].includes(statusId) && !itemStatusIds.some((status) => status === 3 || status === 4);
}

assert(sql.startsWith('begin;') && sql.endsWith('commit;'), 'Migration não está protegida por transação.');
assert(sql.includes('add column if not exists worker_batches_paused_at timestamptz null'), 'Coluna nullable worker_batches_paused_at não foi criada.');
assert(!sql.includes('worker_batches_paused_at timestamptz default'), 'paused_at não pode possuir valor padrão.');

const stateFunction = sliceBetween(sql, 'create or replace function public.worker_set_whatsapp_batch_state', 'create or replace function public.worker_complete_batch_item');
const pauseTransition = sliceBetween(stateFunction, "if v_action = 'pause' and v_batch.status_id in (3, 4)", "elsif v_action = 'pause' and v_batch.status_id = 8");
const repeatedPause = sliceBetween(stateFunction, "elsif v_action = 'pause' and v_batch.status_id = 8", "elsif v_action = 'resume' and v_batch.status_id = 8");
const resumeTransition = sliceBetween(stateFunction, "elsif v_action = 'resume' and v_batch.status_id = 8", "elsif v_action = 'stop'");
const stopTransition = sliceBetween(stateFunction, "elsif v_action = 'stop'", "elsif v_action not in");

assert(pauseTransition.includes('worker_batches_paused_at = now()'), 'Pause não registra paused_at.');
assert(!pauseTransition.includes('worker_batches_next_run_at = null'), 'Pause ainda limpa next_run_at.');
assert(repeatedPause.includes('then null;') && !repeatedPause.includes('update public.worker_batches'), 'Pause repetido não é idempotente.');
assert(resumeTransition.includes("greatest(worker_batches_next_run_at - worker_batches_paused_at, interval '0 seconds')"), 'Resume não preserva o tempo restante congelado.');
assert(resumeTransition.includes('else now()'), 'Resume sem cadência anterior não parte de now().');
assert(resumeTransition.includes('worker_batches_paused_at = null'), 'Resume não limpa paused_at.');
assert(stopTransition.includes('worker_batches_paused_at = null'), 'Encerramento definitivo não limpa paused_at.');

const pausedAt = Date.parse('2026-08-06T12:00:00.000Z');
const cadenceAt = Date.parse('2026-08-06T12:02:00.000Z');
assert(resumedAt(Date.parse('2026-08-06T12:00:30.000Z'), pausedAt, cadenceAt) === Date.parse('2026-08-06T12:02:30.000Z'), 'Resume curto consumiu parte do intervalo restante.');
assert(resumedAt(Date.parse('2026-08-07T12:00:00.000Z'), pausedAt, cadenceAt) === Date.parse('2026-08-07T12:02:00.000Z'), 'Resume após pausa longa consumiu o intervalo congelado.');
assert(resumedAt(Date.parse('2026-08-06T13:00:00.000Z'), pausedAt, Date.parse('2026-08-06T11:59:00.000Z')) === Date.parse('2026-08-06T13:00:00.000Z'), 'Deadline já expirado não retomou a partir de now().');

const completeFunction = sliceBetween(sql, 'create or replace function public.worker_complete_batch_item', 'create or replace function public.worker_recover_stale_whatsapp');
assert(completeFunction.includes('case when status_id in (4, 8) then p_next_run_at'), 'Conclusão durante pausa não persiste p_next_run_at.');
assert(completeFunction.includes('case when status_id = 8 then now()'), 'Conclusão durante pausa não redefine paused_at.');
assert(completeFunction.includes('worker_batches_paused_at = null') && completeFunction.includes('status_id = 5'), 'Conclusão terminal não limpa paused_at.');
assert(completeFunction.includes('wb.status_id in (4, 8)') && completeFunction.includes('wbi.status_id in (3, 4)'), 'Último item concluído durante pausa não finaliza o lote.');
assert(shouldFinalizeBatch(8, [5, 6]), 'Pausa durante o último item não concluiu o lote após o item terminar.');
assert(!shouldFinalizeBatch(8, [5, 3]), 'Lote pausado com item pendente foi concluído.');

const recoveryFunction = sliceBetween(sql, 'create or replace function public.worker_recover_stale_whatsapp', 'revoke all on function public.worker_set_whatsapp_batch_state');
const recoveryTerminal = sliceBetween(recoveryFunction, 'update public.worker_batches as wb set status_id = 5', 'update public.worker_batches set worker_batches_next_run_at');
const batchRecovery = recoveryFunction.slice(recoveryFunction.lastIndexOf('update public.worker_batches'));
assert(recoveryTerminal.includes('worker_batches_finished_at = now()') && recoveryTerminal.includes('worker_batches_next_run_at = null') && recoveryTerminal.includes('worker_batches_paused_at = null'), 'Finalização pela recuperação não limpa timestamps de cadência e pausa.');
assert(recoveryTerminal.includes('wb.status_id in (4, 8)') && recoveryTerminal.includes('wbi.status_id in (3, 4)'), 'Recuperação não finaliza corretamente o último item de lote pausado.');
assert(shouldFinalizeBatch(8, [5, 6]), 'Recuperação do último item de lote pausado não concluiu o lote.');
assert(!shouldFinalizeBatch(8, [5, 4]) && !shouldFinalizeBatch(8, [5, 3]), 'Recuperação concluiu lote com item pendente ou processando.');
assert(batchRecovery.includes('greatest(coalesce(worker_batches_next_run_at, now()), now())'), 'Recuperação pode reduzir deadline futuro ou não trata deadline nulo/expirado.');
assert(batchRecovery.includes('where status_id = 4'), 'Recuperação pode retomar lote pausado.');
assert(!batchRecovery.includes('status_id = 8'), 'Recuperação inclui lote pausado.');
assert(recoveryFunction.includes("queue_item_dispatch_parts_state = 'reconciliation_required'"), 'reconciliation_required deixou de ser preservado na recuperação.');
assert(!recoveryFunction.includes("set queue_item_dispatch_parts_state = 'pending'"), 'Recuperação deixou reconciliation_required reivindicável novamente.');
assert(recoveryFunction.includes('if v_row.status_id = 5 then') && recoveryFunction.includes('update public.worker_batch_items set status_id = 5'), 'Partes ou itens enviados deixaram de ser preservados.');
const dispatchPartUpdates = [...recoveryFunction.matchAll(/update public\.queue_item_dispatch_parts .*? where .*?;/g)].map((match) => match[0]);
assert(dispatchPartUpdates.length === 2 && dispatchPartUpdates.every((statement) => statement.includes("queue_item_dispatch_parts_state = 'processing'")), 'Recuperação altera partes fora do estado processing.');

const recoveryNow = Date.parse('2026-08-06T13:00:00.000Z');
assert(recoveredAt(recoveryNow, Date.parse('2026-08-06T14:00:00.000Z')) === Date.parse('2026-08-06T14:00:00.000Z'), 'Recuperação reduziu deadline futuro.');
assert(recoveredAt(recoveryNow, null) === recoveryNow, 'Recuperação de deadline nulo não partiu de now().');
assert(recoveredAt(recoveryNow, Date.parse('2026-08-06T12:00:00.000Z')) === recoveryNow, 'Recuperação de deadline expirado não partiu de now().');

for (const signature of [
  'worker_set_whatsapp_batch_state(bigint, text, text, text)',
  'worker_complete_batch_item(bigint, text, text, timestamp with time zone)',
  'worker_recover_stale_whatsapp(timestamp with time zone)',
]) {
  assert(sql.includes(`revoke all on function public.${signature} from public, anon, authenticated`), `REVOKE ausente para ${signature}.`);
  assert(sql.includes(`grant execute on function public.${signature} to service_role`), `GRANT service_role ausente para ${signature}.`);
}

const schedulerStart = worker.indexOf('async function schedulerTick()');
const schedulerEnd = worker.indexOf('async function sendWorkerHeartbeat', schedulerStart);
const scheduler = worker.slice(schedulerStart, schedulerEnd);
const dispatchCalls = worker.match(/dispatchOne\s*\(/g) ?? [];
assert(dispatchCalls.length === 2 && scheduler.includes('dispatchOne('), 'schedulerTick deixou de ser o único chamador de dispatchOne().');

if (failures.length) {
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('WhatsApp batch cadence preservation: OK');
