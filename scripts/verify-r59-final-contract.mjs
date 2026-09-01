import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const exists = (relative) => fs.existsSync(path.join(root, relative));
const fail = (message) => { throw new Error(`R59:${message}`); };

const homologRepo = 'src/repositories/release/homologation.repository.ts';
const homologPage = 'src/pages/HomologationPage.tsx';
const homologSql = 'CHECK - CRM R59 - Homologacao final.sql';
for (const file of [homologRepo, homologPage, homologSql]) if (!exists(file)) fail(`arquivo_obrigatorio_ausente:${file}`);
if (!read(homologRepo).includes("const RELEASE = '2.4.0-R59'")) fail('homologacao_release_incorreta');
if (!read(homologPage).includes("from '../repositories/release/homologation.repository'")) fail('pagina_homologacao_sem_repositorio');

const handler = read('server/whatsapp/validation.handler.ts');
for (const token of [
  '/numbers/check',
  'lead_status_id: 1',
  'lead_status_id: 3',
  'channels.semDestino',
  'review_item_id',
  'mutateReviewWithLeadRollback',
  'rollbackLeadToWhatsappReview',
  "requestedMode !== 'initial'",
  "requestedOperation !== 'validate'",
]) if (!handler.includes(token)) fail(`validacao_direta_incompleta:${token}`);
if (exists('server/routes/whatsapp/revalidate.ts')) fail('rota_revalidacao_ainda_existe');
const whatsappRouter = read('server/routes/whatsapp/router.ts');
if (/\brevalidate\b/i.test(whatsappRouter)) fail('router_ainda_expoe_revalidacao');
const validateRoute = read('server/routes/whatsapp/validate.ts');
if (!validateRoute.includes('handleValidationRequest(req, res)')) fail('rota_validate_nao_usa_handler_final');
const validationService = read('src/services/whatsapp-validation/whatsappValidation.service.ts');
for (const token of ['validatePreparedInitial','validateInitial(ids)','revalidateApproved','revalidation']) {
  if (token !== 'validatePreparedInitial' && validationService.includes(token)) fail(`servico_validacao_legado:${token}`);
}
if (!validationService.includes('validatePreparedInitial')) fail('servico_validacao_sem_fluxo_preparado');
for (const token of ['technicalErrors', 'providerResult.errorMessage']) if (!validationService.includes(token)) fail(`diagnostico_whatsapp_ausente:${token}`);
const queueReview = read('src/services/queue-review/queueReview.service.ts');
for (const token of ['technicalReasons', 'validation.technicalErrors']) if (!queueReview.includes(token)) fail(`diagnostico_fila_whatsapp_ausente:${token}`);
const validationGateway = read('src/services/whatsapp-validation/whatsappValidation.gateway.ts');
const technicalOutcomeIndex = validationGateway.indexOf("if (outcome === 'error')");
const invalidOutcomeIndex = validationGateway.indexOf("if (explicit === false || invalidStatus)");
if (technicalOutcomeIndex < 0 || invalidOutcomeIndex < 0 || technicalOutcomeIndex > invalidOutcomeIndex) {
  fail('resultado_tecnico_whatsapp_interpretado_como_invalido');
}

// Regression guards for the R59 build errors reported during the real TypeScript build.
if (handler.includes("let query = auth.admin.from('queue_review_items')")) fail('builder_supabase_mutavel_regrediu');
for (const token of ["let deleteQuery = auth.admin", "let updateQuery = auth.admin"]) {
  if (!handler.includes(token)) fail(`builder_supabase_final_ausente:${token}`);
}
const header = read('src/design-system/layouts/Header.tsx');
for (const token of ["canAccessPage('audit')", "navigate('audit')", 'ClipboardList']) {
  if (header.includes(token)) fail(`header_auditoria_regrediu:${token}`);
}
if (header.includes('<select') && header.includes('organization-switcher')) fail('seletor_organizacao_nativo_regrediu');
for (const token of ['organization-switcher__trigger','organization-switcher__dropdown','organization-switcher__option']) {
  if (!header.includes(token)) fail(`seletor_organizacao_custom_ausente:${token}`);
}
const catalog = read('src/pages/CatalogCrudPage.tsx');
if ((catalog.match(/return \{ name: record\.name, statusId: record\.statusId \};/g) ?? []).length > 1) fail('catalog_never_fallback_regrediu');
const repositoryIndex = read('src/repositories/index.ts');
for (const token of ["from './events'", "export * from './events'", 'canonicalEventLogRepository']) {
  if (repositoryIndex.includes(token)) fail(`repositorio_eventos_regrediu:${token}`);
}

const runtimeRoots = ['src','server','api'];
const extensions = new Set(['.ts','.tsx','.js','.mjs']);
const files = [];
for (const base of runtimeRoots) {
  const walk = (dir) => { for (const entry of fs.readdirSync(dir,{withFileTypes:true})) { const full=path.join(dir,entry.name); if(entry.isDirectory()) walk(full); else if(extensions.has(path.extname(entry.name))) files.push(full); } };
  walk(path.join(root,base));
}
const runtime = files.map((file)=>fs.readFileSync(file,'utf8')).join('\n');
const forbidden = [
  'whatsapp_validation_requests','whatsapp_validation_proofs','record_current_whatsapp_validation_proof','current_user_whatsapp_validation_proofs','reconcile_queue_review_whatsapp_validation',
  'rollover_pending_queue_work','lead_identity_registry','contact_suppressions','maps_search_snapshots','capture_execution_events','service_record_capture_memory','service_orchestrate_ready_leads',
  'audit_events','production_homologation','platform_production_readiness','platform_schema_health','platform_schema_releases','platform_schema_contracts','platform_release_channels',
  'template_variables','instances_apikey','apify_import_jobs_id','queueRolloverService',
  '/api/whatsapp/revalidate','whatsapp-revalidation-review','whatsapp-revalidate'
];
for (const token of forbidden) if (runtime.includes(token)) fail(`referencia_removida:${token}`);
for (const token of ["repositories.events", "canAccessPage('audit')", "navigate('audit')"]) {
  if (runtime.includes(token)) fail(`residuo_codigo_removido:${token}`);
}
if (exists('src/repositories/events')) fail('repositorio_eventos_legado_ainda_existe');

const mapsRoute = read('server/routes/maps/extension.ts');
for (const token of ['leads_normalized_phone','leads_normalized_instagram','leads_normalized_domain','leads_normalized_maps']) if (!mapsRoute.includes(token)) fail(`captura_identidade_direta_ausente:${token}`);
const pull = read('src/services/queue-review/queueReview.service.ts');
for (const token of ['pull_queue_review_to_capacity','validatePreparedInitial','capacityToFill','redirectedLeadIds']) if (!pull.includes(token)) fail(`puxada_final_incompleta:${token}`);
const homePage = read('src/pages/HomePage.tsx');
for (const token of ['label="Importados"', 'label="Sem destino"', 'label="WhatsApp"', 'label="Instagram"', 'imported.summary.total', 'imported.summary.noDestination', 'imported.summary.whatsapp', 'imported.summary.instagram']) {
  if (!homePage.includes(token)) fail(`cards_inicio_incompletos:${token}`);
}
for (const legacyCard of ['label="Com número"', 'label="Com Instagram"', 'label="Com site"']) {
  if (homePage.includes(legacyCard)) fail(`card_inicio_legado:${legacyCard}`);
}
const invalidationPatch = 'APLICAR - CRM R59 BUILD FIX 6 - Corrigir invalidacao.sql';
if (!exists(invalidationPatch)) fail('sql_correcao_invalidacao_ausente');
const invalidationSql = read(invalidationPatch);
for (const token of [
  'CREATE OR REPLACE FUNCTION public.invalidate_final_queue_item',
  'CREATE OR REPLACE FUNCTION public.invalidate_queue_review_item',
  'SET status_id = 7',
  'SET lead_status_id = 6',
  "'contractVersion', 'R59'",
]) if (!invalidationSql.includes(token)) fail(`sql_correcao_invalidacao_incompleto:${token}`);
for (const legacy of ['invalid_status_catalog_missing', "IN ('invalido', 'invalid')", "'contractVersion', 'R58'"]) {
  if (invalidationSql.includes(legacy)) fail(`sql_correcao_invalidacao_legado:${legacy}`);
}
const schemaCatalog = read('src/repositories/schemaCatalog.ts');
for (const token of [
  'invalid: CANONICAL_CATALOG.status.CANCELED',
  "if (normalized === 'cancelado' || normalized === 'canceled' || normalized === 'cancelled') return 'invalid';",
]) if (!schemaCatalog.includes(token)) fail(`contrato_cancelamento_fila_incompleto:${token}`);
if (schemaCatalog.includes('invalid: CANONICAL_CATALOG.status.ERROR')) fail('invalidacao_ainda_mapeada_como_erro');
const queueSchema = read('src/repositories/queueSchema.ts');
if (!queueSchema.includes(".neq('status_id', CANONICAL_CATALOG.status.CANCELED)")) fail('cancelados_ainda_retornam_na_fila_ativa');
const whatsappQueueHook = read('src/hooks/useWhatsAppQueue.ts');
for (const token of [
  'await whatsappQueueService.invalidate(lead.id);',
  'await whatsappQueueService.page({ chip, scheduledDate }, { page: targetPage, pageSize: rowsPerPage })',
  'setBatches(result.batches);',
  'setTotal(result.total);',
  'setSummary(result.summary);',
]) if (!whatsappQueueHook.includes(token)) fail(`compactacao_whatsapp_pos_invalidacao_incompleta:${token}`);
if (whatsappQueueHook.includes("leads: batch.leads.filter((candidate) => candidate.id !== lead.id)")) fail('whatsapp_ainda_compacta_apenas_a_pagina_local');
const instagramQueueHook = read('src/hooks/useInstagramQueue.ts');
for (const token of [
  'await instagramQueueService.invalidate(lead.id);',
  'await instagramQueueService.page({ profile, scheduledDate }, { page: targetPage, pageSize: rowsPerPage })',
  'setBatches(result.batches);',
  'setTotal(result.total);',
  'setSummary(result.summary);',
]) if (!instagramQueueHook.includes(token)) fail(`compactacao_instagram_pos_invalidacao_incompleta:${token}`);
if (instagramQueueHook.includes("leads: batch.leads.filter((candidate) => candidate.id !== lead.id)")) fail('instagram_ainda_compacta_apenas_a_pagina_local');
const instagramExtensionOrder = read('server/routes/instagram/extension.ts');
if (instagramExtensionOrder.includes('queueOrder')) fail('instagram_ainda_prioriza_fila_de_origem_na_ordem');
for (const token of [".order('queue_items_position').order('queue_items_id')", 'Number(a.queue_items_position ?? 0) - Number(b.queue_items_position ?? 0)', 'Number(a.queue_items_id ?? 0) - Number(b.queue_items_id ?? 0)']) {
  if (!instagramExtensionOrder.includes(token)) fail(`instagram_ordem_canonica_ausente:${token}`);
}

const queueFinalTable = read('src/components/QueueFinalTable.tsx');
for (const token of ['const displayLeads=useMemo<FinalLead[]>', 'const offset=(page-1)*rowsPerPage;', '.map((lead,index)=>({...lead,position:offset+index+1}))', 'displayLeads.find']) {
  if (!queueFinalTable.includes(token)) fail(`posicao_operacional_fila_final_incompleta:${token}`);
}
if (queueFinalTable.includes('()=>leads.map((lead)=>({ id:lead.id, position:lead.position')) fail('fila_final_ainda_exibe_posicao_historica');

const alternativePatch = 'APLICAR - CRM R59 BUILD FIX 8 - Nome alternativo e snapshot.sql';
if (!exists(alternativePatch)) fail('sql_nome_alternativo_fix8_ausente');
const alternativeSql = read(alternativePatch);
for (const token of [
  'CREATE OR REPLACE FUNCTION public.update_lead_alternative_name',
  'build_queue_item_payload_snapshot',
  "set_config('vinsansi.allow_queue_snapshot_refresh', 'on', true)",
  "'contractVersion', 'R59'",
  "'originalCompanyName'",
  "'sendCompanyName'",
  "'messages'",
  'CREATE OR REPLACE FUNCTION public.approve_queue_review_item',
]) if (!alternativeSql.includes(token)) fail(`sql_nome_alternativo_fix8_incompleto:${token}`);
if (alternativeSql.includes("'contractVersion', 'R58'")) fail('sql_nome_alternativo_fix8_contrato_r58');

const whatsappQueueRepository = read('src/repositories/whatsapp-queue/canonicalWhatsAppQueue.repository.ts');
const instagramQueueRepository = read('src/repositories/instagram-queue/canonicalInstagramQueue.repository.ts');
for (const [name, source] of [['whatsapp', whatsappQueueRepository], ['instagram', instagramQueueRepository]]) {
  for (const token of [
    'const sendCompanyName = String(snapshotLead.company_name ?? (alternativeName || originalCompany));',
    'const company = originalCompany;',
    'company_name: sendCompanyName,',
  ]) if (!source.includes(token)) fail(`nome_original_fila_${name}_incompleto:${token}`);
  if (source.includes('const company = String(snapshotLead.company_name ?? (alternativeName || originalCompany));')) fail(`nome_alternativo_ainda_substitui_empresa_${name}`);
}
const leadCycleService = read('src/services/lead-cycle/leadCycle.service.ts');
if (!leadCycleService.includes('displayCompany: row.leads_name,')) fail('nome_alternativo_ainda_substitui_empresa_no_ciclo');
const alternativeService = read('src/services/leads/alternativeName.service.ts');
for (const token of ['AlternativeNameUpdateResult', 'sendCompanyName', 'message1: text(messages.message_1)', 'snapshotRefreshed']) {
  if (!alternativeService.includes(token)) fail(`retorno_nome_alternativo_incompleto:${token}`);
}
const queuePage = read('src/pages/QueuePage.tsx');
for (const token of [
  'company:original',
  'company_name:result.sendCompanyName||result.alternativeName||original',
  'message1:result.message1',
  'message4:result.message4',
  'Nome usado no envio" value={lead.company_name||lead.alternative_name||lead.original_company_name||lead.company}',
]) if (!queuePage.includes(token)) fail(`ui_nome_alternativo_incompleta:${token}`);
if (queuePage.includes('const displayName=alternativeName||original')) fail('ui_nome_alternativo_legado_ainda_presente');
for (const successNotice of [
  'As mensagens deste item foram regeneradas. A tabela mantém o nome original da empresa.',
  'saiu da Fila final. Os itens seguintes subiram uma posição.',
]) if (queuePage.includes(successNotice)) fail(`aviso_sucesso_fila_ainda_presente:${successNotice}`);
const queueReviewPanel = read('src/components/QueueReviewPanel.tsx');
for (const token of [
  "onToast('Lead aprovado','Lead enviado para a Fila final.','success')",
  "onToast('Lead invalidado','Lead movido para a Base Permanente.','success')",
]) if (!queueReviewPanel.includes(token)) fail(`toast_revisao_ausente:${token}`);
for (const legacyNotice of ['foi persistido na Fila final.', 'Aprovando lead…', 'A vaga foi liberada. Um novo lead só será puxado', 'queue-action-notice']) {
  if (queueReviewPanel.includes(legacyNotice)) fail(`aviso_inline_revisao_ainda_presente:${legacyNotice}`);
}

const pullDrawer = read('src/components/QueuePullDrawer.tsx');
for (const token of [
  'Puxar leads',
  'Leads compatíveis com os filtros',
  'Serão puxados',
  "site: siteFilter",
  "instagram: channel === 'Instagram' ? 'any' : instagramFilter",
  'queueReviewService.preview',
  'queueReviewService.pull',
  'Puxar ${preview?.willPull ?? 0}',
]) if (!pullDrawer.includes(token)) fail(`drawer_puxada_incompleto:${token}`);
for (const token of [
  '(preview?.resource.available ?? 0) <= 0',
  'preview.resource.available > preview.eligible',
]) if (!pullDrawer.includes(token)) fail(`drawer_puxada_capacidade_incompleta:${token}`);
if (/preview\?*\.available/.test(pullDrawer)) fail('drawer_puxada_available_fora_de_resource');
if (!pullDrawer.includes('<Drawer')) fail('drawer_puxada_nao_usa_design_system');
if (pullDrawer.includes('<Modal')) fail('modal_central_puxada_ainda_presente');
if (!pullDrawer.includes('iconLeft={ListPlus}')) fail('cta_drawer_puxada_sem_icone');
if (!pullDrawer.includes('options={siteOptions}') || !pullDrawer.includes('options={instagramOptions}')) fail('filtros_puxada_nao_usam_select_padrao');
const homePull = read('src/pages/HomePage.tsx');
if (!homePull.includes('iconLeft={ListPlus}')) fail('botao_puxar_inicio_sem_icone');
if (!homePull.includes('<QueuePullDrawer')) fail('inicio_sem_drawer_puxada');
if (!homePull.includes("placeholder=\"Site\"") || !homePull.includes("placeholder=\"Instagram\"")) fail('filtros_site_instagram_inicio_ausentes');
if (!homePull.includes('BRAZIL_STATE_OPTIONS')) fail('estado_dropdown_sem_nome_completo');
if (!homePull.includes('site: siteFilter') || !homePull.includes('instagram: instagramFilter')) fail('filtros_site_instagram_inicio_sem_logica');
const componentsCss = read('src/styles/components.css');
for (const token of ['text-overflow: ellipsis;', 'white-space: nowrap;', 'min-width: max(100%, 220px);']) {
  if (!componentsCss.includes(token)) fail(`select_dropdown_sem_truncamento_padrao:${token}`);
}
const queuePullUi = read('src/pages/QueuePage.tsx');
if (!queuePullUi.includes('iconLeft={ListPlus}')) fail('botao_puxar_fila_sem_icone');
if ((queuePullUi.match(/label=\"Revisão\"/g) ?? []).length < 2) fail('card_revisao_ausente_nas_duas_filas');
if ((queuePullUi.match(/metric-grid--6/g) ?? []).length < 2) fail('grid_metricas_filas_nao_comporta_revisao');
if ((queuePullUi.match(/onReviewCountChange=\{setReviewCount\}/g) ?? []).length < 2) fail('card_revisao_sem_contagem_viva');
const queueReviewPanelForCount = read('src/components/QueueReviewPanel.tsx');
if (!queueReviewPanelForCount.includes('onReviewCountChange?.(total)')) fail('painel_revisao_nao_publica_contagem');
for (const legacyPull of ['Puxar WhatsApp', 'Puxar Instagram', 'home-pull-date', 'home-pull-group']) {
  if (homePull.includes(legacyPull)) fail(`puxada_inicio_legada:${legacyPull}`);
}
const pullPatch = 'APLICAR - CRM R59 BUILD FIX 10 - Modal e filtros da puxada.sql';
if (!exists(pullPatch)) fail('sql_puxada_filtrada_fix10_ausente');
const pullSql = read(pullPatch);
for (const token of [
  'CREATE FUNCTION public.pull_queue_review_to_capacity',
  'CREATE OR REPLACE FUNCTION public.preview_queue_review_pull',
  'p_site_filter text DEFAULT',
  'p_instagram_filter text DEFAULT',
  "'contractVersion','R59'",
  'leads_website',
  'leads_instagram',
  "FOR UPDATE OF l SKIP LOCKED",
]) if (!pullSql.includes(token)) fail(`sql_puxada_filtrada_fix10_incompleto:${token}`);
if (pullSql.includes("'contractVersion','R58'")) fail('sql_puxada_filtrada_fix10_contrato_r58');

const homolog = read(homologSql);
for (const token of [
  '60::bigint esperado',
  'status_antigos_funcoes',
  'revisao_com_canal_invalido',
  'revisao_canal_divergente_batch',
  'enviado_sem_canal_legacy',
  'status_operacional_divergencias',
  'contrato_invalidacao_r59',
  'invalidacao_manual_marcada_como_erro',
  'contrato_nome_alternativo_r59',
  'contrato_aprovacao_r59',
  'contrato_puxada_filtrada_r59',
  'contrato_rollover_capacidade_r59',
  'contrato_paginacao_server_side_r59',
  'contrato_lotes_e_ramos_r59',
  'contrato_protecao_downgrade_nivel_r59',
  'SOMENTE LEITURA',
]) if (!homolog.includes(token)) fail(`homolog_sql_incompleto:${token}`);


// R59 midnight rollover contract: corte 00:00 e capacidade canônica no banco.
{
  const whatsappRollover = read('src/services/whatsapp-queue/whatsappQueue.service.ts');
  const instagramRollover = read('src/services/instagram-queue/instagramQueue.service.ts');
  const rolloverService = read('src/services/queue-rollover/queueCapacityRollover.service.ts');
  const midnightHook = read('src/hooks/useMidnightRefresh.ts');
  const rolloverPatch = read('APLICAR - CRM R59 BUILD FIX 17 - Aprovacao e rollover.sql');
  if (!whatsappRollover.includes("return toLocalDateInputValue();")) fail('rollover_whatsapp_sem_meia_noite');
  if (!instagramRollover.includes("return toLocalDateInputValue();")) fail('rollover_instagram_sem_meia_noite');
  if (whatsappRollover.includes('getHours() >= 22')) fail('rollover_whatsapp_ainda_antecipa_22h');
  if (instagramRollover.includes('getHours() >= 22')) fail('rollover_instagram_ainda_antecipa_22h');
  if (!rolloverService.includes("rpc('rollover_queue_items_to_capacity'")) fail('rollover_nao_canonico_no_banco');
  for (const token of ['list_queue_review_resources', "('pendente', 'pending', 'queued', 'pausado', 'paused')", "'unresolvedOverflow'", "'contractVersion', 'R59'"]) {
    if (!rolloverPatch.includes(token)) fail(`rollover_fix17_incompleto:${token}`);
  }
  if (!midnightHook.includes('next.setHours(24, 0, 1, 0)')) fail('rollover_sem_refresh_meia_noite');
}

// R59 FIX 17: template único por aprovação + FK de ramo canônica + melhorias da fila.
{
  const selector = read('src/services/templates/templateSelector.ts');
  const preparation = read('src/services/queue-preparation/queuePreparation.service.ts');
  const reviewTable = read('src/components/QueueReviewPanel.tsx');
  const finalTable = read('src/components/QueueFinalTable.tsx');
  const queueCss = read('src/styles/queue.css');
  const queuePage17 = read('src/pages/QueuePage.tsx');
  const fix17 = read('APLICAR - CRM R59 BUILD FIX 17 - Aprovacao e rollover.sql');
  if (!selector.includes('leadBranchId && templateBranchId && leadBranchId === templateBranchId')) fail('template_branch_id_nao_canonico');
  if (selector.includes('leadBranch && templateBranch && leadBranch === templateBranch')) fail('template_ainda_autoriza_por_nome');
  if (!preparation.includes('const selection = selectTemplateForLead(context, templates);')) fail('template_selecao_unica_ausente');
  if (preparation.includes('templateIdForLead(')) fail('template_segundo_sorteio_ainda_presente');
  if (!fix17.includes("'templateFallbackUsed'")) fail('template_fallback_canonico_ausente');
  if (fix17.includes('queue_review_resource_capacity_reached')) fail('aprovacao_ainda_exige_segunda_vaga');
  if (!reviewTable.includes("label:'Instagram'")) fail('instagram_revisao_whatsapp_ausente');
  if (!finalTable.includes("label:'Instagram'")) fail('instagram_fila_final_whatsapp_ausente');
  if (!queueCss.includes('width: max-content;')) fail('tabs_fila_ainda_largas');
  if ((queuePage17.match(/<SegmentedControl compact items=\{\['Revisão','Fila final'\]\}/g) ?? []).length < 2) fail('tabs_fila_nao_compactas');
}


// R59 FIX 18: leitura operacional paginada no banco, sem paginação visual sobre coleções completas.
{
  const home18 = read('src/pages/HomePage.tsx');
  const base18 = read('src/pages/BasePage.tsx');
  const review18 = read('src/components/QueueReviewPanel.tsx');
  const final18 = read('src/components/QueueFinalTable.tsx');
  const leadRepo18 = read('src/repositories/lead-cycle/supabaseLeadCycle.repository.ts');
  const baseRepo18 = read('src/repositories/base/supabaseBase.repository.ts');
  const waRepo18 = read('src/repositories/whatsapp-queue/canonicalWhatsAppQueue.repository.ts');
  const igRepo18 = read('src/repositories/instagram-queue/canonicalInstagramQueue.repository.ts');
  const reviewService18 = read('src/services/queue-review/queueReview.service.ts');
  const sql18 = read('APLICAR - CRM R59 BUILD FIX 18 - Paginacao server-side.sql');
  for (const [name, source] of [['home',home18],['base',base18],['review',review18],['final',final18]]) {
    if (source.includes('useClientPagination')) fail(`paginacao_cliente_operacional_ainda_presente:${name}`);
  }
  for (const token of ['useDebouncedValue(search, 300)', 'imported.total', 'imported.summary.total']) if (!home18.includes(token)) fail(`inicio_server_side_incompleto:${token}`);
  for (const token of ['useDebouncedValue(search, 300)', 'total', 'refreshing']) if (!base18.includes(token)) fail(`base_server_side_incompleta:${token}`);
  if (!leadRepo18.includes("rpc('list_imported_leads_page_r59'")) fail('inicio_sem_rpc_paginada');
  if (!baseRepo18.includes("rpc('list_base_permanent_page_r59'")) fail('base_sem_rpc_paginada');
  if (!waRepo18.includes("rpc('list_queue_final_page_r59'")) fail('fila_whatsapp_sem_rpc_paginada');
  if (!igRepo18.includes("rpc('list_queue_final_page_r59'")) fail('fila_instagram_sem_rpc_paginada');
  if (!reviewService18.includes("rpc('list_queue_review_page_r59'")) fail('revisao_sem_rpc_paginada');
  if (!reviewService18.includes("rpc('queue_review_count_r59'")) fail('card_revisao_ainda_carrega_lista');
  for (const token of ['list_imported_leads_page_r59','list_base_permanent_page_r59','list_queue_review_page_r59','queue_review_count_r59','list_queue_final_page_r59','queue_final_retryable_ids_r59']) {
    if (!sql18.includes(`FUNCTION public.${token}`)) fail(`sql_fix18_incompleto:${token}`);
  }
  if (!sql18.includes("coalesce(ip.step,'')='reconciliation_required'")) fail('reprocessamento_instagram_nao_cobre_reconciliacao');
  if (!review18.includes('Mostrando ${rows.length} de ${total}')) fail('revisao_footer_nao_server_side');
  if (!final18.includes('Mostrando ${rows.length} de ${total}')) fail('fila_final_footer_nao_server_side');
}


// R59 FIX 19: page size real, filtro multi-ramos, navegação semântica e lotes visuais.
{
  const paginationTypes19 = read('src/services/pagination/types.ts');
  const rowsControl19 = read('src/design-system/components/navigation/RowsPerPageControl.tsx');
  const pullDrawer19 = read('src/components/QueuePullDrawer.tsx');
  const queueReviewService19 = read('src/services/queue-review/queueReview.service.ts');
  const header19 = read('src/design-system/layouts/Header.tsx');
  const registry19 = read('src/pages/pageRegistry.ts');
  const componentsCss19 = read('src/styles/components.css');
  const dataTable19 = read('src/design-system/components/data-display/DataTable.tsx');
  const finalTable19 = read('src/components/QueueFinalTable.tsx');
  const sql19 = read('APLICAR - CRM R59 BUILD FIX 19 - Paginacao, ramos e lotes.sql');

  for (const token of ['[10, 20, 50, 100]', "options={['10', '20', '50', '100']}"]) {
    const source = token.startsWith('[') && token.includes(', 20') ? paginationTypes19 : rowsControl19;
    if (!source.includes(token)) fail(`page_size_10_ausente:${token}`);
  }
  for (const token of ['MultiSelectField', 'branchIds', 'Ramos', 'Todos os ramos']) if (!pullDrawer19.includes(token)) fail(`drawer_ramos_incompleto:${token}`);
  for (const token of ["rpc('list_queue_review_branches_r59'", 'p_branch_ids: filters.branchIds']) if (!queueReviewService19.includes(token)) fail(`servico_ramos_incompleto:${token}`);
  if (!header19.includes('ChevronRight')) fail('submenu_interno_sem_chevron_direita');
  if (!componentsCss19.includes('left: calc(100% - var(--space-02));')) fail('submenu_interno_nao_abre_direita');
  if ((registry19.match(/label: 'Filas'/g) ?? []).length < 2) fail('menus_disparos_nao_renomeados_para_filas');
  if (!dataTable19.includes(`<span className="sr-only">{actionsLabel ?? 'Ações'}</span>`)) fail('cabecalho_acoes_sem_rotulo_acessivel');
  if (dataTable19.includes('<th className="data-table__actions">Ações</th>')) fail('cabecalho_acoes_visivel');
  for (const token of ['actionColumnWidth', 'data-table__actions-list', 'getRowClassName']) if (!dataTable19.includes(token)) fail(`tabela_acoes_proporcionais_incompleta:${token}`);
  for (const token of ["label:'Lote'", 'dispatch_batch_position', 'lotStart', 'data-table__row--group-start']) if (!finalTable19.includes(token)) fail(`lotes_visuais_incompletos:${token}`);
  for (const token of ['p_branch_ids bigint[] DEFAULT NULL', 'list_queue_review_branches_r59', 'dispatch_batch_number', 'levels_queues', 'dispatch_batch_position', 'p_page_size IN(10,20,50,100)', 'v_wanted:=greatest(0,coalesce(v_capacity.available,0));', 'v_available_after:=greatest(0,coalesce(v_capacity.available,0)-v_reserved_count);']) {
    if (!sql19.includes(token)) fail(`sql_fix19_incompleto:${token}`);
  }
  if (!sql19.includes('l.branches_id=ANY(v_branch_ids)')) fail('sql_fix19_filtro_ramo_nao_atomico');
  if (!sql19.includes("WHEN r.display_position > (v_batch_size * greatest(0,v_batch_count-1))")) fail('sql_fix19_ultimo_lote_nao_absorve_resto');
}


// R59 FIX 20: downgrade de nível respeita ocupação canônica em hoje + datas futuras.
{
  const canonicalConfig20 = read('src/repositories/config/canonicalConfig.repository.ts');
  const catalogConfig20 = read('src/repositories/configuration/configuration.repository.ts');
  const sql20 = read('APLICAR - CRM R59 BUILD FIX 20 - Protecao de nivel, paginacao, ramos e lotes.sql');
  for (const token of ["rpc('validate_resource_level_change_r59'", "assertResourceLevelChangeAllowed('whatsapp'", "assertResourceLevelChangeAllowed('instagram'"]) {
    if (!canonicalConfig20.includes(token)) fail(`frontend_protecao_nivel_recurso_incompleta:${token}`);
  }
  for (const token of ["rpc('validate_level_daily_limit_change_r59'", 'assertLevelDailyLimitChangeAllowed']) {
    if (!catalogConfig20.includes(token)) fail(`frontend_protecao_limite_nivel_incompleta:${token}`);
  }
  for (const token of [
    'FUNCTION public._resource_capacity_conflict_r59',
    'FUNCTION public.validate_resource_level_change_r59',
    'FUNCTION public.validate_level_daily_limit_change_r59',
    'trg_chips_level_capacity_r59',
    'trg_socials_level_capacity_r59',
    'trg_levels_daily_limit_capacity_r59',
    "i.review_status='open'",
    "'concluido','completed','sent'",
    'p_from_date',
    'queue_operational_today_r59',
  ]) if (!sql20.includes(token)) fail(`sql_fix20_protecao_nivel_incompleta:${token}`);
  if (!sql20.includes('v_new_limit>=coalesce(v_current_limit,0)')) fail('fix20_aumento_nivel_nao_livre');
}


// R59 FIX 21: Worker pode ler o nível operacional do chip pelo runtime organizacional.
const executorRuntimeFix21 = read('server/routes/tools/executor/runtime.ts');
if (!executorRuntimeFix21.includes("'chips','levels','instances'")) fail('runtime_worker_sem_levels_para_lotes');


// R59 FIX 23: palavra-chave literal no nome precisa valer igualmente na prévia e na reserva real.
{
  const pullDrawer23 = read('src/components/QueuePullDrawer.tsx');
  const queueReviewTypes23 = read('src/services/queue-review/types.ts');
  const queueReviewService23 = read('src/services/queue-review/queueReview.service.ts');
  const sql23 = read('APLICAR - CRM R59 BUILD FIX 23 - Palavra-chave no nome da puxada.sql');
  for (const token of ['Palavra-chave no nome', 'useDebouncedValue(nameKeyword, 300)', 'keywordLength', 'keywordValid', 'Digite ao menos 3 caracteres']) {
    if (!pullDrawer23.includes(token)) fail(`drawer_palavra_chave_incompleto:${token}`);
  }
  if (!queueReviewTypes23.includes('nameKeyword: string;')) fail('tipo_filtro_palavra_chave_ausente');
  for (const token of ['p_name_keyword: filters.nameKeyword.trim() || null']) {
    if ((queueReviewService23.match(new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length < 2) fail(`servico_palavra_chave_preview_pull_incompleto:${token}`);
  }
  for (const token of ['p_name_keyword text DEFAULT NULL', 'queue_review_name_keyword_min_3', 'leads_name', 'public.unaccent', 'strpos(', "'nameKeyword',nullif(v_name_keyword,'')"]) {
    if (!sql23.includes(token)) fail(`sql_fix23_palavra_chave_incompleto:${token}`);
  }
}


// R59 FIX 24: níveis do WhatsApp são canônicos; somente delays/fuso continuam globais na ferramenta.
{
  const toolsPage24 = read('src/pages/ToolsPage.tsx');
  const toolsService24 = read('src/services/tools/tools.service.ts');
  const whatsappQueue24 = read('src/services/whatsapp-queue/whatsappQueue.service.ts');
  const platformConfig24 = read('src/services/platform-config/platformConfig.service.ts');
  for (const token of ['WhatsApp · Regras globais', 'Níveis dos chips · fonte canônica', 'Configurações → Filas → Níveis', 'Intervalo entre lotes (minutos)', 'whatsappLevelDistribution']) {
    if (!toolsPage24.includes(token)) fail(`fix24_editor_niveis_incompleto:${token}`);
  }
  if (!toolsService24.includes('async operationalLevels(organizationId: string)')) fail('fix24_sem_leitura_niveis_canonicos');
  if (whatsappQueue24.includes('settings.chipLevels')) fail('fix24_fila_whatsapp_ainda_sobrescreve_nivel');
  if (platformConfig24.includes('dispatch.chipLevels')) fail('fix24_runtime_legado_ainda_sobrescreve_nivel');
  for (const token of ['dailyLimit: chip.dailyLimit', 'blockSize: chip.blockSize', 'batches: chip.batches']) {
    if (!platformConfig24.includes(token)) fail(`fix24_platform_config_nao_canonico:${token}`);
  }
}


// R59 FIX 25: filtro multiestado precisa valer igualmente na prévia e na reserva real.
{
  const pullDrawer25 = read('src/components/QueuePullDrawer.tsx');
  const queueReviewTypes25 = read('src/services/queue-review/types.ts');
  const queueReviewService25 = read('src/services/queue-review/queueReview.service.ts');
  const field25 = read('src/design-system/components/forms/Field.tsx');
  const sql25 = read('APLICAR - CRM R59 BUILD FIX 25 - Filtro por estados na puxada.sql');
  for (const token of ['Estados', 'Todos os estados', 'stateIds', 'queueReviewService.states()', 'selectedNoun="estados"']) {
    if (!pullDrawer25.includes(token)) fail(`drawer_estados_incompleto:${token}`);
  }
  if (!queueReviewTypes25.includes('stateIds: string[];')) fail('tipo_filtro_estados_ausente');
  for (const token of [".from('states')", 'p_state_ids: filters.stateIds']) {
    if (!queueReviewService25.includes(token)) fail(`servico_estados_incompleto:${token}`);
  }
  if ((queueReviewService25.match(/p_state_ids: filters\.stateIds/g) ?? []).length < 2) fail('servico_estados_preview_pull_divergente');
  for (const token of ['selectedNoun', '${values.length} ${selectedNoun} selecionados']) {
    if (!field25.includes(token)) fail(`multiselect_generico_incompleto:${token}`);
  }
  for (const token of ['p_state_ids bigint[] DEFAULT NULL', "v_state_ids bigint[]:=coalesce(p_state_ids,'{}'::bigint[])", 'l.states_id=ANY(v_state_ids)', "'stateIds',to_jsonb(v_state_ids)"]) {
    if (!sql25.includes(token)) fail(`sql_estados_incompleto:${token}`);
  }
  const statePredicates = (sql25.match(/l\.states_id=ANY\(v_state_ids\)/g) || []).length;
  if (statePredicates < 4) fail(`sql_estados_preview_pull_divergente:${statePredicates}`);
}


// R59 BUILD FIX 26: modo Automático não pode fazer N+1 por cidade e o gate
// não deve reler a própria Revisão corrente a cada candidato.
{
  const mapsExtension26 = read('server/routes/maps/extension.ts');
  for (const token of [
    'R59 BUILD FIX 26',
    'const [cities, currentCoverageRows, historicalCoverageRows] = await Promise.all([',
    "client.from('maps_search_coverage')",
    "currentByCity",
    "historicalByCity",
    "activeReviewQuery = activeReviewQuery.neq('maps_search_executions_id', text(currentExecutionId))",
    ".select('maps_search_candidates_id').single()",
  ]) {
    if (!mapsExtension26.includes(token)) fail(`fix26_maps_automatico_incompleto:${token}`);
  }
  const automaticTail = mapsExtension26.slice(mapsExtension26.indexOf('R59 BUILD FIX 26'));
  if (/for \(const cityRow of cities\.data \?\? \[\]\) \{\s*const next = await nextCoverageForCity/.test(automaticTail)) {
    fail('fix26_n_plus_one_automatico_ainda_presente');
  }
}


// R59 BUILD FIX 27: Instagram usa a mesma contagem canônica da Fila final e,
// como no WhatsApp, nível é autoridade de limite/lotes enquanto delays são globais.
{
  const instagramExtension27 = read('server/routes/instagram/extension.ts');
  const toolsPage27 = read('src/pages/ToolsPage.tsx');
  for (const token of [
    'function displayStatus(',
    'function queueSummary(',
    'display_status: displayStatus(queueStatus, progressStep)',
    'summary: queueSummary(items)',
    'instagramBatchSize(client: SupabaseClient, scope: TokenScope)',
    "from('levels')",
    'levels_daily_limit,levels_queues,status_id',
    'utcDate(row.queue_items_scheduled_at ?? queueMap.get(String(row.queues_id))?.queues_scheduled_at) === scheduledDate',
  ]) {
    if (!instagramExtension27.includes(token)) fail(`fix27_instagram_fila_canonica_incompleta:${token}`);
  }
  if (instagramExtension27.includes("effectiveConfig(client, organizationId, 'vinsansi_instagram')")) fail('fix27_instagram_lote_ainda_vem_da_config_global');
  for (const token of [
    'Instagram · Regras globais',
    'Níveis dos perfis · fonte canônica',
    'Intervalo entre lotes (minutos)',
    'Somente os tempos de execução são globais',
    "selectedToolId === 'vinsansi_whatsapp_manager' || selectedToolId === 'vinsansi_instagram'",
    "selectedToolId === 'vinsansi_instagram'",
  ]) {
    if (!toolsPage27.includes(token)) fail(`fix27_editor_instagram_incompleto:${token}`);
  }
}

console.log('CRM R59 final contract + homologacao: OK');
