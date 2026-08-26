import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (file) => readFileSync(join(root, file), 'utf8');
let checks = 0;
const ok = (value, message) => { checks += 1; assert.ok(value, message); };

const migration = read('supabase/migrations/20260825234000_r26_incremental_queue_approval.sql');
const review = read('src/components/QueueReviewPanel.tsx');
const reviewService = read('src/services/queue-review/queueReview.service.ts');
const queuePage = read('src/pages/QueuePage.tsx');
const finalTable = read('src/components/QueueFinalTable.tsx');
const whatsappHook = read('src/hooks/useWhatsAppQueue.ts');
const instagramHook = read('src/hooks/useInstagramQueue.ts');
const whatsappRepo = read('src/repositories/whatsapp-queue/canonicalWhatsAppQueue.repository.ts');
const instagramRepo = read('src/repositories/instagram-queue/canonicalInstagramQueue.repository.ts');
const queueSchema = read('src/repositories/queueSchema.ts');
const css = read('src/styles/queue.css');

// Capacidade: fila final + revisão nunca ultrapassa o limite do recurso selecionado.
for (const token of [
  'queue_review_resource_capacity',
  'open_queue_review_batch',
  'reserve_queue_review_items',
  'approve_queue_review_item',
  'invalidate_final_queue_item',
]) ok(migration.includes(token), `R26 sem contrato ${token}`);
ok(migration.includes("NOT (qi.status_id=ANY(v_invalid_status_ids))"), 'capacidade final não ignora somente inválidos/cancelados');
ok(migration.includes("'missingCount',greatest(0,v_capacity.available-v_open)"), 'puxada não calcula somente as vagas restantes');
ok(migration.includes('IF v_open>=v_batch.target_count THEN'), 'reserva pode ultrapassar target_count');
ok(migration.includes('SET target_count=v_capacity.available'), 'reserva não recalcula o target pelo uso atual da fila final');
ok((migration.match(/pg_advisory_xact_lock/g) ?? []).length >= 3, 'operações concorrentes não estão serializadas por recurso/data');
ok(migration.includes("v_batch.target_count:=v_capacity.available"), 'reserva não usa capacidade recalculada');

// Aprovação individual sem lock global da fila.
ok(review.includes('<Check size={16}'), 'revisão sem check de aprovação');
ok(review.includes('Aprovar e enviar para a Fila final'), 'ação de aprovação sem semântica de Fila final');
ok(review.includes('queueReviewService.approve(item, channel)'), 'check não aprova item individual');
ok(!review.includes('Trancar fila'), 'botão Trancar fila ainda aparece');
ok(reviewService.includes("rpc('approve_queue_review_item'"), 'aprovação não usa RPC atômica');
ok(reviewService.includes('queuePreparationService.buildReviewLockItems(channel, [item.leadId])'), 'aprovação não passa pela preparação canônica/template');
ok(migration.includes('FROM public.prepare_queue_items('), 'aprovação não cria item pela fila canônica');
ok((migration.match(/SET target_count=v_capacity.available/g) ?? []).length >= 3, 'target da Revisão não é atualizado após aprovação');
ok(!migration.includes('queue_items_payload_snapshot'), 'R26 manipula snapshot manualmente em vez do pipeline canônico');

// Invalidação final libera slot. Instagram mantém replacement automático; WhatsApp foi tornado manual na R27.
ok(whatsappRepo.includes("rpc('invalidate_final_queue_item'"), 'WhatsApp não usa invalidação final canônica');
ok(instagramRepo.includes("rpc('invalidate_final_queue_item'"), 'Instagram não usa invalidação final canônica');
ok(!queuePage.includes("queueReviewService.pullToCapacity('WhatsApp', scheduledDate, activeChip)"), 'WhatsApp voltou a repor automaticamente após invalidação');
ok(queuePage.includes("queueReviewService.pullToCapacity('Instagram', scheduledDate, activeProfile)"), 'invalidação Instagram não repõe a vaga na Revisão');
ok(queuePage.includes('Uma nova vaga foi enviada para Revisão.'), 'feedback de reposição Instagram para Revisão ausente');

// Escopo estrito: nunca agregar todos os recursos nem fallback silencioso.
ok(reviewService.includes('if (!preferredResourceId)'), 'pull não exige recurso selecionado');
ok(!reviewService.includes('availableResources.find((item) => item.available > 0)'), 'Instagram ainda pode cair em outro perfil automaticamente');
ok(queuePage.includes("const chipFilterOptions = chips.map"), 'filtro WhatsApp específico ausente');
ok(queuePage.includes("const profileFilterOptions = profiles.map"), 'filtro Instagram específico ausente');
ok(!queuePage.includes('Todos os chips'), 'a opção Todos os chips ainda existe');
ok(!queuePage.includes('Todos os perfis'), 'a opção Todos os perfis ainda existe');
ok(whatsappHook.includes("chip\n          ? await Promise.all"), 'hook WhatsApp ainda carrega todos os chips sem seleção');
ok(instagramHook.includes("profile\n          ? await Promise.all"), 'hook Instagram ainda carrega todos os perfis sem seleção');
ok(reviewService.includes(".filter((batch) => !scheduledDate || batch.scheduledDate === scheduledDate)"), 'revisão pode misturar datas diferentes');

// Tabs e tabela final paginada por leads.
ok((queuePage.match(/items=\{\['Revisão', 'Fila final'\]\}/g) ?? []).length === 2, 'tabs Revisão/Fila final não existem nos dois canais');
ok(queuePage.includes('Listagem de disparos - {scopeLabel}'), 'card da Fila final não usa título Listagem de disparos');
ok(finalTable.includes('useClientPagination(leads, 20)'), 'Fila final não pagina por leads');
ok(finalTable.includes('<RowsPerPageControl'), 'Fila final sem seletor de linhas');
ok(finalTable.includes('<Pagination'), 'Fila final sem paginação');
for (const label of ['Empresa','Ramo','Estado','Cidade','Nota','Avaliações','Site','Status','Ações']) {
  ok(finalTable.includes(`<th>${label}</th>`), `Fila final sem coluna ${label}`);
}
ok(finalTable.includes('<th>{channel}</th>'), 'Fila final sem coluna do canal');
ok(review.includes('useClientPagination(reviewItems, 20)'), 'Revisão não pagina por leads');
ok(review.includes('<RowsPerPageControl'), 'Revisão sem seletor de linhas');
ok(review.includes('<Pagination'), 'Revisão sem paginação');

// Numeração visual contígua e dados completos.
ok(review.includes('{(page - 1) * rowsPerPage + index + 1}'), 'revisão ainda mostra posição histórica com buracos');
ok(migration.includes('row_number() OVER (PARTITION BY b.queue_review_batches_id'), 'RPC da revisão não renumera itens abertos');
ok(queueSchema.includes('city?: Row;') && queueSchema.includes('state?: Row;'), 'fila canônica sem cidade/estado');
ok(whatsappRepo.includes('rating: Number(lead.leads_score ?? 0)') && whatsappRepo.includes('reviews: Number(lead.leads_reviews_count ?? 0)'), 'fila WhatsApp sem nota/avaliações');
ok(instagramRepo.includes('rating: Number(lead.leads_score ?? 0)') && instagramRepo.includes('reviews: Number(lead.leads_reviews_count ?? 0)'), 'fila Instagram sem nota/avaliações');

// Ações/visual no padrão da tabela.
ok(css.includes('.queue-final-table') && css.includes('table-layout: fixed'), 'Fila final sem layout tabular fixo');
ok(css.includes('.queue-review-approve') && css.includes('var(--action-success'), 'aprovar não usa cor de sucesso');
ok(css.includes('.queue-table-action--view') && css.includes('var(--action-primary)'), 'visualizar não usa cor primária');
ok(css.includes('.queue-table-action--danger') && css.includes('var(--action-danger)'), 'invalidar não usa cor de perigo');

console.log(`R26 revisão incremental + Fila final: PASS (${checks} verificações)`);
