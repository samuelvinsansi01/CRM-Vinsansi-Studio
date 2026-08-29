import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260828223000_r54_fast_scheduled_queue_pull.sql'), 'utf8');
function check(ok, message) { if (!ok) { console.error(message); process.exitCode = 1; } }

// R54 e uma migration historica. A UI/contrato de quantidade explicita foi
// deliberadamente substituida pela R55; aqui preservamos apenas os invariantes
// estruturais que a R55 continua usando como fundacao.
check(migration.includes('CREATE OR REPLACE FUNCTION public.list_queue_review_resources'), 'R54: falta lista leve de recursos.');
check(migration.includes('CREATE OR REPLACE FUNCTION public.queue_review_resource_capacity'), 'R54: falta capacidade por recurso/data.');
check(migration.includes('CREATE OR REPLACE FUNCTION public.reconcile_queue_review_whatsapp_validation'), 'R54: falta reconciliacao WhatsApp atomica.');
check(migration.includes('CREATE OR REPLACE FUNCTION public.list_queue_review_for_resource'), 'R54: falta leitura escopada da revisao.');
check(migration.includes('FOR UPDATE OF l SKIP LOCKED'), 'R54: fundacao de reserva nao usa lock concorrente seguro.');
check(migration.includes("ri.review_status IN ('invalidated','locked')"), 'R54: terminal do mesmo lote deve continuar bloqueando.');
check(migration.includes('ORDER BY coalesce(l.leads_score,0) DESC,coalesce(l.leads_reviews_count,0) DESC,l.leads_id ASC'), 'R54: ordem de qualidade foi alterada.');
check(migration.includes('DROP FUNCTION IF EXISTS public.queue_review_candidate_ids'), 'R54: RPC antiga de candidatos nao foi removida.');
check(migration.includes('DROP FUNCTION IF EXISTS public.reserve_queue_review_items'), 'R54: RPC antiga de reserva nao foi removida.');
check(migration.includes('DROP FUNCTION IF EXISTS public.open_queue_review_batch'), 'R54: abertura antiga nao foi removida.');
check(migration.includes('DROP FUNCTION IF EXISTS public.release_queue_review_items'), 'R54: release antiga nao foi removida.');
check(migration.includes('DROP FUNCTION IF EXISTS public.list_open_queue_review'), 'R54: leitura ampla antiga nao foi removida.');
check(migration.includes('DROP FUNCTION IF EXISTS public.lock_queue_review_batch'), 'R54: lock em massa antigo nao foi removido.');
check(migration.includes('queue_items_whatsapp_scheduled_capacity_idx'), 'R54: falta indice de capacidade WhatsApp.');
check(migration.includes('queue_items_instagram_scheduled_capacity_idx'), 'R54: falta indice de capacidade Instagram.');
check(migration.includes('leads_queue_pull_whatsapp_priority_idx'), 'R54: falta indice de prioridade WhatsApp.');
check(migration.includes('leads_queue_pull_instagram_priority_idx'), 'R54: falta indice de prioridade Instagram.');
check(!/^\s*\*\s/m.test(migration), 'R54: migration contem bullet solto que quebra SQL.');

if (!process.exitCode) console.log('R54 OK: fundacao historica de capacidade, indices, reserva concorrente, reconciliacao e limpeza preservada.');
