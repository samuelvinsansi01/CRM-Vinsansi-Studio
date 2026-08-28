import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260828223000_r54_fast_scheduled_queue_pull.sql'), 'utf8');
const service = fs.readFileSync(path.join(root, 'src/services/queue-review/queueReview.service.ts'), 'utf8');
const validation = fs.readFileSync(path.join(root, 'src/services/whatsapp-validation/whatsappValidation.service.ts'), 'utf8');
const home = fs.readFileSync(path.join(root, 'src/pages/HomePage.tsx'), 'utf8');
const queue = fs.readFileSync(path.join(root, 'src/pages/QueuePage.tsx'), 'utf8');
const allSrc = fs.readdirSync(path.join(root, 'src'), { recursive: true })
  .filter((name) => typeof name === 'string' && /\.(ts|tsx)$/.test(name))
  .map((name) => fs.readFileSync(path.join(root, 'src', name), 'utf8'))
  .join('\n');

function check(ok, message) { if (!ok) { console.error(message); process.exitCode = 1; } }

check(migration.includes('CREATE OR REPLACE FUNCTION public.list_queue_review_resources'), 'R54: falta lista leve de recursos.');
check(migration.includes('CREATE OR REPLACE FUNCTION public.open_queue_review_batch_by_key'), 'R54: falta abertura de lote por recurso/data.');
check(migration.includes('CREATE OR REPLACE FUNCTION public.reserve_next_queue_review_items'), 'R54: falta reserva atomica de proximos leads.');
check(migration.includes('FOR UPDATE OF l SKIP LOCKED'), 'R54: reserva nao usa lock concorrente seguro.');
check(migration.includes('p_limit integer') && !migration.includes('p_limit integer DEFAULT'), 'R54: quantidade da ação deve ser explícita, sem default oculto no banco.');
check(migration.includes('greatest(0,coalesce(p_limit,0))'), 'R54: reserva não respeita estritamente a quantidade solicitada.');
check(!migration.includes('p_exclude_lead_ids'), 'R54: ainda existe mecanismo de múltiplas passadas no mesmo clique.');
check(migration.includes("ri.review_status IN ('invalidated','locked')"), 'R54: terminal do mesmo lote deve continuar bloqueando.');
check(!migration.includes("ri.queue_review_batches_id=p_batch_id\n            AND ri.review_status IN ('released'"), 'R54: released nao pode ficar bloqueado.');
check(migration.includes('ORDER BY coalesce(l.leads_score,0) DESC,coalesce(l.leads_reviews_count,0) DESC,l.leads_id ASC'), 'R54: ordem de qualidade foi alterada.');
check(migration.includes('CREATE OR REPLACE FUNCTION public.reconcile_queue_review_whatsapp_validation'), 'R54: falta reconciliacao WhatsApp atomica.');
check(migration.includes('CREATE OR REPLACE FUNCTION public.list_queue_review_for_resource'), 'R54: revisao continua lendo o canal inteiro.');
check(migration.includes('DROP FUNCTION IF EXISTS public.queue_review_candidate_ids'), 'R54: RPC antiga de candidatos nao foi removida.');
check(migration.includes('DROP FUNCTION IF EXISTS public.reserve_queue_review_items'), 'R54: RPC antiga de reserva nao foi removida.');
check(migration.includes('DROP FUNCTION IF EXISTS public.open_queue_review_batch'), 'R54: abertura antiga nao foi removida.');
check(migration.includes('DROP FUNCTION IF EXISTS public.release_queue_review_items'), 'R54: release antiga nao foi removida.');
check(migration.includes('DROP FUNCTION IF EXISTS public.list_open_queue_review'), 'R54: leitura ampla antiga nao foi removida.');
check(migration.includes('DROP FUNCTION IF EXISTS public.lock_queue_review_batch'), 'R54: lock em massa antigo nao foi removido.');
check(migration.includes('queue_items_whatsapp_scheduled_capacity_idx'), 'R54: falta indice de capacidade WhatsApp.');
check(migration.includes('final_usage AS') && migration.includes('review_usage AS'), 'R54: lista de recursos nao agrega capacidade de forma set-based.');
const listFn = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.list_queue_review_resources'), migration.indexOf('REVOKE ALL ON FUNCTION public.list_queue_review_resources'));
check(!listFn.includes('target_count integer'), 'R54: lista leve ainda devolve target_count sem consumidor.');
const openFn = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.open_queue_review_batch_by_key'), migration.indexOf('REVOKE ALL ON FUNCTION public.open_queue_review_batch_by_key'));
check(!openFn.includes('list_queue_review_resources'), 'R54: abertura de um recurso ainda calcula todos os recursos.');
const reserveFn = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.reserve_next_queue_review_items'), migration.indexOf('REVOKE ALL ON FUNCTION public.reserve_next_queue_review_items'));
check(reserveFn.includes('pg_advisory_xact_lock'), 'R54: reserva não serializa capacidade por recurso/data.');
check(reserveFn.includes('FOR UPDATE;'), 'R54: reserva não trava o lote antes de recalcular capacidade.');
check(reserveFn.includes('greatest(0,coalesce(p_limit,0))') && reserveFn.includes('greatest(0,v_batch.target_count-v_open)'), 'R54: reserva pode ultrapassar pedido ou capacidade restante.');
check(reserveFn.includes('LIMIT v_wanted'), 'R54: seleção não possui limite físico igual ao pedido permitido.');
check(!/^\s*\*\s/m.test(migration), 'R54: migration contém bullet solto que quebra SQL.');
check(migration.includes('leads_queue_pull_whatsapp_priority_idx'), 'R54: falta indice de prioridade WhatsApp.');
check(migration.includes('leads_queue_pull_instagram_priority_idx'), 'R54: falta indice de prioridade Instagram.');

check(service.includes("rpc('list_queue_review_resources'"), 'R54: resources ainda nao usa caminho leve.');
check(service.includes("rpc('open_queue_review_batch_by_key'"), 'R54: pull nao usa lote por chave/data.');
check(service.includes("rpc('reserve_next_queue_review_items'"), 'R54: selecao/reserva nao foi consolidada.');
check(service.includes("rpc('reconcile_queue_review_whatsapp_validation'"), 'R54: reconciliacao continua fragmentada.');
check(service.includes("rpc('list_queue_review_for_resource'"), 'R54: listagem de revisao nao foi escopada.');
check(!service.includes('queuePreparationService.snapshot'), 'R54: Puxar ainda hidrata snapshot completo.');
check(!service.includes('revalidateExisting'), 'R54: Puxar ainda revalida itens ja abertos.');
check(!fs.existsSync(path.join(root, 'src/hooks/useQueuePreparation.ts')), 'R54: hook morto da preparacao antiga ainda existe.');
check(!fs.existsSync(path.join(root, 'src/services/queue-preparation/queuePreparation.rules.ts')), 'R54: regras mortas da preparacao antiga ainda existem.');
check(!allSrc.includes('QueuePreparationResource'), 'R54: tipo legado de recurso da preparacao ainda acopla a puxada nova.');
check(!service.includes('queuePreparationService.snapshot'), 'R54: snapshot pesado voltou ao caminho de Puxar.');
check(service.includes('validatePreparedInitial'), 'R54: validacao recarrega leads/chips desnecessariamente.');
check(service.includes('movedLeadIds: Array.from(movedLeadIds)'), 'R54: pull nao devolve delta para atualizacao local da Home.');
const pullStart = service.indexOf('async function pullRequested(');
const pullEnd = service.indexOf('\nasync function pull(', pullStart);
const pullBlock = service.slice(pullStart, pullEnd);
check(pullStart >= 0, 'R54: falta operação explícita de puxada.');
check(!pullBlock.includes('while ('), 'R54: Puxar não pode ter loop/refill automático.');
check((pullBlock.match(/await reserveNext\(/g) ?? []).length === 1, 'R54: um clique deve executar exatamente uma reserva.');
check(pullBlock.includes('Math.min(requested, batch.missingCount)'), 'R54: pedido não está limitado pela capacidade real do recurso/data.');
check(service.includes('requested: reserved.length') === false, 'R54: resultado não pode mascarar quantidade solicitada como quantidade reservada.');
check(!allSrc.includes("rpc('queue_review_candidate_ids'"), 'R54: frontend ainda chama RPC removida queue_review_candidate_ids.');
check(!allSrc.includes("rpc('reserve_queue_review_items'"), 'R54: frontend ainda chama RPC removida reserve_queue_review_items.');
check(!allSrc.includes("rpc('open_queue_review_batch'"), 'R54: frontend ainda chama RPC removida open_queue_review_batch.');
check(!allSrc.includes("rpc('release_queue_review_items'"), 'R54: frontend ainda chama RPC removida release_queue_review_items.');
check(!allSrc.includes("rpc('restore_queue_review_whatsapp_valid'"), 'R54: frontend ainda chama RPC removida restore_queue_review_whatsapp_valid.');
check(!allSrc.includes("rpc('prune_queue_review_items'"), 'R54: frontend ainda chama RPC removida prune_queue_review_items.');

check(validation.includes('validatePreparedInitial'), 'R54: falta fast path da validacao preparada.');
check(home.includes('Data da fila'), 'R54: Home nao possui calendario da data alvo.');
check(home.includes('imported.removeLocally(result.movedLeadIds)'), 'R54: Home ainda recarrega a base inteira depois da puxada em vez de aplicar o delta local.');
check(!home.includes('const [, resources] = await Promise.all'), 'R54: Home ainda faz refresh pesado pos-puxada.');
check(home.includes("queueReviewService.pull(channel, scheduledDate, resourceId, requestedCount)"), 'R54: Home não envia data/recurso/quantidade explícita ao pull.');
check(home.includes('label="Qtd."') && home.includes('whatsappPullCount') && home.includes('instagramPullCount'), 'R54: Home não expõe quantidade explícita por canal.');
check(home.includes("resources('WhatsApp', scheduledDate)"), 'R54: capacidade WhatsApp da Home nao acompanha a data.');
check(home.includes("resources('Instagram', scheduledDate)"), 'R54: capacidade Instagram da Home nao acompanha a data.');
check(queue.includes('min={todayInputValue()}'), 'R54: Fila permite puxada acidental para data passada pela UI.');
check(queue.includes("queueReviewService.pull('WhatsApp',scheduledDate,activeChip,Number(pullCount))"), 'R54: Fila WhatsApp não envia data/recurso/quantidade.');
check(queue.includes("queueReviewService.pull('Instagram',scheduledDate,activeProfile,Number(pullCount))"), 'R54: Fila Instagram não envia data/recurso/quantidade.');
check((queue.match(/label="Qtd\."/g) ?? []).length >= 2, 'R54: telas de fila não expõem quantidade explícita.');
check(!service.includes('pullToCapacity'), 'R54: API antiga pullToCapacity ainda está ativa.');

if (!process.exitCode) console.log('R54 OK: puxada agendada, atômica, leve, quantidade explícita, uma reserva por clique e sem refill/retry automático.');
