import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (path) => readFileSync(join(root, path), 'utf8');
const migration = read('supabase/migrations/20260825220000_r23_open_queue_review.sql');
const home = read('src/pages/HomePage.tsx');
const review = read('src/components/QueueReviewPanel.tsx');
const reviewService = read('src/services/queue-review/queueReview.service.ts');
const queuePage = read('src/pages/QueuePage.tsx');
const maps = read('server/routes/maps/extension.ts');
const canonical = read('src/services/import/canonicalLead.ts');
const importValidation = read('src/services/import/importValidation.ts');
const app = read('src/App.tsx');
const registry = read('src/pages/pageRegistry.ts');
const cleanup = read('SQL - R23 - Limpar destino dos Importados.sql');
const leadMapper = read('src/mappers/lead.mapper.ts');
const leadCycle = read('src/services/lead-cycle/leadCycle.service.ts');
const queuePreparation = read('src/services/queue-preparation/queuePreparation.service.ts');
const importRepository = read('src/repositories/import/supabaseImport.repository.ts');
const configRepository = read('src/repositories/config/canonicalConfig.repository.ts');
let checks = 0;
const ok = (value, message) => { checks += 1; assert.ok(value, message); };

for (const token of ['queue_review_batches','queue_review_items','open_queue_review_batch','queue_review_candidate_ids','reserve_queue_review_items','invalidate_queue_review_item','lock_queue_review_batch']) {
  ok(migration.includes(token), `R23 sem contrato ${token}`);
}
ok(migration.includes("ORDER BY coalesce(l.leads_score,0) DESC,coalesce(l.leads_reviews_count,0) DESC"), 'candidatos não seguem nota → avaliações');
ok(migration.includes("coalesce(nullif(trim(v_lead.leads_whatsapp),''),v_lead.leads_phone,''"), 'WhatsApp não prioriza leads_whatsapp com fallback de telefone');
ok(migration.includes("ri.review_status='open' OR ri.queue_review_batches_id=p_batch_id"), 'lead pode ser repetido/reselecionado na mesma revisão');
ok(migration.includes("review_status='invalidated'"), 'invalidação não encerra item da revisão');
ok(migration.includes('release_queue_review_items'), 'falha técnica pode deixar reserva presa');
ok(migration.includes("lead_status_id=1,channels_id=NULL"), 'release não devolve lead técnico para Importado sem destino');
ok((migration.match(/public\.prepare_queue_items\(/g) ?? []).length === 1, 'prepare_queue_items deve existir somente no lock');
ok(!migration.includes('queue_items_payload_snapshot'), 'snapshot está sendo manipulado antes do pipeline canônico');
ok(!/\b(?:insert\s+into|update|delete\s+from)\s+public\.permanent_records\b/i.test(migration), 'R23 escreve na Base Permanente');
ok(migration.includes('FROM public.permanent_records pr'), 'Base Permanente não bloqueia nova prospecção');

ok(home.includes('Puxar WhatsApp') && home.includes('Puxar Instagram'), 'Home sem os dois botões de pull');
ok(home.includes('b.rating - a.rating || b.reviews - a.reviews'), 'Home não ordena nota → avaliações');
ok(review.includes('Trancar fila'), 'revisão sem botão Trancar fila');
ok(review.includes('Invalidar lead'), 'revisão sem ação Invalidar');
ok(!review.includes('Aprovar'), 'revisão ainda exige aprovação manual');
ok(queuePage.includes('<QueueReviewPanel') && queuePage.includes('channel="WhatsApp"') && queuePage.includes('channel="Instagram"'), 'filas não exibem revisão aberta nos dois canais');
ok(reviewService.includes('whatsappValidationService.validateInitialWithChip'), 'pull WhatsApp não valida via recurso selecionado');
ok(reviewService.includes('queuePreparationService.buildReviewLockItems'), 'lock não valida template/contrato antes da fila definitiva');

ok(maps.includes('channels_id: null'), 'Captura ainda grava destino em lead Importado');
ok(canonical.includes('channels_id: statusId === LEAD_STATUS.IMPORTED ? null : lookup.channelId'), 'importação canônica ainda grava destino em Importado');
ok(importValidation.includes("draft.status = 'pending';"), 'importação aceita ainda cria status pré-validado');
ok(!app.includes('ValidationRoutingPage'), 'App ainda monta Validação e roteamento');
ok(!registry.includes("id: 'validation-routing'"), 'menu ainda expõe Validação e roteamento');
ok(!existsSync(join(root, 'src/pages/ValidationRoutingPage.tsx')), 'página legada de validação ainda existe');
ok(!existsSync(join(root, 'src/components/ApprovedLeadsQueueDrawer.tsx')), 'drawer legado Puxar aprovados ainda existe');
ok(!existsSync(join(root, 'src/services/whatsapp-validation/whatsappCapacityValidation.service.ts')), 'serviço legado de validação/capacidade ainda existe');

ok(cleanup.includes('lead_status_id = 1'), 'SQL de limpeza não limita a Importados');
ok(cleanup.includes('channels_id = NULL'), 'SQL de limpeza não remove somente o destino');
ok(cleanup.includes('NOT EXISTS') && cleanup.includes('public.permanent_records'), 'SQL de limpeza não protege Base Permanente');
ok(!/\b(?:insert\s+into|update|delete\s+from)\s+public\.permanent_records\b/i.test(cleanup), 'SQL de limpeza escreve na Base Permanente');

ok(canonical.includes('branches_id: lookup.branchId'), 'lead nao persiste o ramo pai por branches_id');
ok(canonical.includes('leads_categories: compactCategories([lead.subcategoria])'), 'lead ainda duplica o nome mutavel do ramo pai em leads_categories');
ok(!maps.includes('strings([execution.branch_name, candidate.maps_category'), 'Captura ainda duplica o nome do ramo pai em leads_categories');
ok(leadMapper.includes("branch: branch?.branches_name ?? ''"), 'mapper de lead nao resolve ramo pelo relacionamento branches_id');
ok(leadCycle.includes("branch: branch?.branches_name ?? ''"), 'ciclo de lead ainda usa texto de categoria como identidade de ramo');
ok(queuePreparation.includes("return one(row.branches)?.branches_name ?? '';"), 'preparacao da fila ainda usa categoria textual como fallback de ramo');
ok(importRepository.includes('const matchedCategory = categories.find'), 'leitura de sub-ramo nao e compativel com historico e novo formato');
ok(configRepository.includes("const table = kind === 'branches' ? 'branches'"), 'configuracao de ramos sem fluxo canonico');
ok(configRepository.includes(".update({ status_id: statusId })"), 'ramo nao usa desativacao logica para preservar referencias');
ok(migration.includes('branch_id bigint,branch_name text'), 'revisao aberta nao retorna nome atual do ramo pelo ID');
ok(migration.includes("LEFT JOIN public.branches br ON br.branches_id=l.branches_id"), 'revisao aberta nao resolve ramo diretamente da tabela branches');
ok(reviewService.includes("branch: String(row.branch_name ?? '')"), 'servico de revisao nao usa nome atual do ramo retornado pelo banco');
ok(review.includes("<th>Ramo</th>") && review.includes("{item.branch || '-'}"), 'tabela de revisao nao exibe o ramo pai atual');



console.log(`R23 revisão aberta: PASS (${checks} verificações)`);
