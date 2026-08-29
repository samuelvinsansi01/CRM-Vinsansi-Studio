import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const migrationPath = path.join(root, 'supabase/migrations/20260828235500_r55_capacity_only_queue_pull.sql');
const migration = fs.readFileSync(migrationPath, 'utf8');
const standalone = fs.readFileSync(path.join(root, 'SQL - CRM R55 - Puxada por capacidade sem quantidade manual.sql'), 'utf8');
const supabaseStandalone = fs.readFileSync(path.join(root, 'supabase/SQL/SQL - CRM R55 - Puxada por capacidade sem quantidade manual.sql'), 'utf8');
const service = fs.readFileSync(path.join(root, 'src/services/queue-review/queueReview.service.ts'), 'utf8');
const types = fs.readFileSync(path.join(root, 'src/services/queue-review/types.ts'), 'utf8');
const home = fs.readFileSync(path.join(root, 'src/pages/HomePage.tsx'), 'utf8');
const queue = fs.readFileSync(path.join(root, 'src/pages/QueuePage.tsx'), 'utf8');
const allSrc = fs.readdirSync(path.join(root, 'src'), { recursive: true })
  .filter((name) => typeof name === 'string' && /\.(ts|tsx)$/.test(name))
  .map((name) => fs.readFileSync(path.join(root, 'src', name), 'utf8'))
  .join('\n');

function check(ok, message) { if (!ok) { console.error(message); process.exitCode = 1; } }

check(migration === standalone && migration === supabaseStandalone, 'R55: os tres exemplares do SQL nao sao identicos.');
check(migration.includes('CREATE OR REPLACE FUNCTION public.pull_queue_review_to_capacity'), 'R55: falta RPC unica de puxada por capacidade.');
check(migration.includes('p_channel text') && migration.includes('p_resource_key text') && migration.includes('p_scheduled_date date'), 'R55: contrato nao e somente canal + recurso + data.');
const pullFnStart = migration.indexOf('CREATE OR REPLACE FUNCTION public.pull_queue_review_to_capacity');
const pullFnEnd = migration.indexOf('REVOKE ALL ON FUNCTION public.pull_queue_review_to_capacity', pullFnStart);
const pullFn = migration.slice(pullFnStart, pullFnEnd);
check(pullFnStart >= 0 && pullFnEnd > pullFnStart, 'R55: nao foi possivel isolar a RPC de puxada.');
check(!pullFn.includes('p_limit') && !pullFn.includes('p_quantity') && !pullFn.includes('p_count'), 'R55: RPC ainda recebe quantidade manual.');
check(pullFn.includes('pg_advisory_xact_lock'), 'R55: puxada nao serializa recurso/data.');
check(pullFn.includes('FOR UPDATE OF l SKIP LOCKED'), 'R55: candidatos nao usam lock concorrente seguro.');
check(pullFn.includes('v_wanted:=greatest(0,coalesce(v_capacity.available,0)-coalesce(v_review_open_before,0))'), 'R55: quantidade nao deriva exclusivamente da capacidade restante.');
check((pullFn.match(/LIMIT v_wanted/g) ?? []).length === 2, 'R55: cada canal deve limitar fisicamente a selecao a capacidade restante.');
check(pullFn.includes("ri.review_status='open'"), 'R55: lead em revisao aberta nao esta bloqueado.');
check(pullFn.includes("ri.review_status IN ('invalidated','locked')"), 'R55: invalidated/locked do mesmo lote nao estao bloqueados.');
check(!/review_status\s+IN\s*\([^)]*released/i.test(pullFn), 'R55: released ficou bloqueado e nao pode reentrar em nova acao.');
check((pullFn.match(/ORDER BY\s*\n\s*coalesce\(l\.leads_score,0\) DESC,\s*\n\s*coalesce\(l\.leads_reviews_count,0\) DESC,\s*\n\s*l\.leads_id ASC/g) ?? []).length === 2, 'R55: ordem nota -> avaliacoes -> id nao esta identica nos dois canais.');
check(!pullFn.includes('WHILE ') && !pullFn.includes('LOOP\n      SELECT') && !pullFn.includes('refill'), 'R55: existe indicio de refill/segunda passagem na RPC.');
check(pullFn.includes("'capacityToFill',v_wanted") && pullFn.includes("'reserved',v_reserved"), 'R55: RPC nao devolve capacidade/reserva de forma explicita.');
check(!pullFn.includes("'used',") && !pullFn.includes("'targetCount',") && !pullFn.includes("'openCount',") && !pullFn.includes("'missingCount',"), 'R55: retorno da RPC ainda expoe contadores redundantes/contrato antigo.');
check(!pullFn.includes('v_used_after'), 'R55: variavel morta de uso agregado permaneceu na RPC.');

check(migration.includes('CREATE INDEX IF NOT EXISTS queue_items_whatsapp_legacy_capacity_idx'), 'R55: falta indice legado especifico de WhatsApp.');
check(migration.includes('CREATE INDEX IF NOT EXISTS queue_items_instagram_legacy_capacity_idx'), 'R55: falta indice legado especifico de Instagram.');
check(migration.includes('DROP INDEX IF EXISTS public.queue_items_legacy_schedule_capacity_idx'), 'R55: indice legado generico redundante nao foi removido.');
const capStart = migration.indexOf('CREATE OR REPLACE FUNCTION public.queue_review_resource_capacity');
const capEnd = migration.indexOf('REVOKE ALL ON FUNCTION public.queue_review_resource_capacity', capStart);
const capFn = migration.slice(capStart, capEnd);
check(!capFn.includes(' OR\n'), 'R55: helper de capacidade voltou a juntar moderno/legado por OR.');
check(capFn.includes('v_used_modern') && capFn.includes('v_used_legacy'), 'R55: helper nao separa caminhos moderno e legado.');
check(migration.includes('REVOKE ALL ON FUNCTION public.queue_review_resource_capacity(text,bigint,date) FROM PUBLIC,anon,authenticated'), 'R55: helper interno ainda esta exposto ao frontend autenticado.');

check(migration.includes('DROP FUNCTION IF EXISTS public.open_queue_review_batch_by_key(text,text,date)'), 'R55: RPC intermediaria de abertura da R54 nao foi removida.');
check(migration.includes('DROP FUNCTION IF EXISTS public.reserve_next_queue_review_items(bigint,integer)'), 'R55: RPC intermediaria de reserva da R54 nao foi removida.');
check(migration.includes('DROP FUNCTION IF EXISTS public.reserve_next_queue_review_items(bigint)'), 'R55: overload residual de reserva nao esta protegido pela limpeza.');
check(migration.includes('DROP FUNCTION IF EXISTS public.queue_review_candidate_ids(bigint,integer)'), 'R55: RPC antiga de candidatos nao esta protegida pela limpeza final.');
check(migration.includes('DROP FUNCTION IF EXISTS public.reserve_queue_review_items(bigint,bigint[])'), 'R55: RPC antiga de reserva nao esta protegida pela limpeza final.');
check(migration.includes('DROP FUNCTION IF EXISTS public.open_queue_review_batch(text,bigint,date)'), 'R55: RPC antiga de abertura nao esta protegida pela limpeza final.');
check(migration.includes('DROP FUNCTION IF EXISTS public.release_queue_review_items(bigint,bigint[])'), 'R55: RPC antiga de liberacao nao esta protegida pela limpeza final.');
check(migration.includes('DROP FUNCTION IF EXISTS public.restore_queue_review_whatsapp_valid(bigint,bigint[])'), 'R55: RPC antiga de restore WhatsApp nao esta protegida pela limpeza final.');
check(migration.includes('DROP FUNCTION IF EXISTS public.prune_queue_review_items(bigint)'), 'R55: RPC antiga de prune nao esta protegida pela limpeza final.');
check(migration.includes('DROP FUNCTION IF EXISTS public.list_open_queue_review(text)'), 'R55: RPC antiga de listagem nao esta protegida pela limpeza final.');
check(migration.includes('DROP FUNCTION IF EXISTS public.lock_queue_review_batch(bigint,jsonb)'), 'R55: RPC antiga de lock nao esta protegida pela limpeza final.');
check(!/^\s*\*\s/m.test(migration), 'R55: migration contem bullet solto que quebra SQL.');

check(service.includes("rpc('pull_queue_review_to_capacity'"), 'R55: frontend nao usa a RPC unica.');
check((service.match(/rpc\('pull_queue_review_to_capacity'/g) ?? []).length === 1, 'R55: existem multiplos caminhos de chamada para a RPC de puxada.');
check(!service.includes("rpc('open_queue_review_batch_by_key'") && !service.includes("rpc('reserve_next_queue_review_items'"), 'R55: servico ainda usa RPCs intermediarias removidas.');
check(service.includes('async function pull(channel: QueueReviewChannel, scheduledDate: string, preferredResourceId: string)'), 'R55: assinatura do pull ainda recebe quantidade.');
check(!service.includes('requestedCount') && !service.includes('capacityLimited'), 'R55: contrato TypeScript ainda carrega quantidade manual/limitacao do pedido.');
check(service.includes('validatePreparedInitial(reserved, context.providerKey)'), 'R55: WhatsApp nao valida exatamente o conjunto reservado.');
const servicePullStart = service.indexOf('async function pullToCapacity(');
const servicePullEnd = service.indexOf('\nasync function pull(', servicePullStart);
const servicePull = service.slice(servicePullStart, servicePullEnd);
check(servicePullStart >= 0, 'R55: falta fluxo de puxada por capacidade no servico.');
check(!servicePull.includes('while ('), 'R55: frontend possui loop/refill automatico.');
check((servicePull.match(/await pullCapacity\(/g) ?? []).length === 1, 'R55: um clique deve reservar uma unica vez.');
check(!types.includes('requested: number') && !types.includes('capacityLimited'), 'R55: tipos ainda expõem quantidade manual antiga.');
check(types.includes('capacityToFill: number'), 'R55: resultado nao informa a capacidade calculada pelo banco.');

check(home.includes('Data da fila'), 'R55: Home perdeu a data alvo.');
check(!home.includes('label="Qtd."') && !home.includes('whatsappPullCount') && !home.includes('instagramPullCount'), 'R55: Home ainda possui quantidade manual.');
check(home.includes('queueReviewService.pull(channel, scheduledDate, resourceId)'), 'R55: Home nao chama pull somente com canal/data/recurso.');
check(home.includes('whatsappAvailable <= 0') && home.includes('instagramAvailable <= 0'), 'R55: Home nao desabilita puxada quando a capacidade exibida e zero.');
check(home.includes('imported.removeLocally(result.movedLeadIds)'), 'R55: Home perdeu atualizacao local por delta.');
check(!queue.includes('label="Qtd."') && !queue.includes('pullCount'), 'R55: tela de Fila/Revisao ainda possui quantidade manual.');
check(queue.includes("queueReviewService.pull('WhatsApp',scheduledDate,activeChip)"), 'R55: Fila WhatsApp nao usa contrato canal/data/recurso.');
check(queue.includes("queueReviewService.pull('Instagram',scheduledDate,activeProfile)"), 'R55: Fila Instagram nao usa contrato canal/data/recurso.');

check(!allSrc.includes("rpc('open_queue_review_batch_by_key'"), 'R55: algum codigo ainda chama abertura intermediaria removida.');
check(!allSrc.includes("rpc('reserve_next_queue_review_items'"), 'R55: algum codigo ainda chama reserva intermediaria removida.');
check(!allSrc.includes('home-pull-quantity') && !allSrc.includes('queue-pull-quantity'), 'R55: classes/markup mortos da quantidade manual ainda existem.');

if (!process.exitCode) console.log('R55 OK: puxada por capacidade do recurso/data, uma RPC/uma reserva, sem quantidade manual, sem refill e com limpeza dos RPCs/indice obsoletos.');
