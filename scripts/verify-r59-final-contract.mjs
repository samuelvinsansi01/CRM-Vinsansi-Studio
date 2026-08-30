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
for (const token of ['label="Importados"', 'label="Sem destino"', 'label="WhatsApp"', 'label="Instagram"', "lead.channel === 'Sem destino'", "lead.channel === 'WhatsApp'", "lead.channel === 'Instagram'"]) {
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
if (!whatsappQueueHook.includes('total: Math.max(0, current.total - 1)')) fail('resumo_whatsapp_nao_remove_invalidado_do_total');
const queueFinalTable = read('src/components/QueueFinalTable.tsx');
for (const token of ['const displayLeads=useMemo<FinalLead[]>', '.map((lead,index)=>({...lead,position:index+1}))', 'displayLeads.find']) {
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
for (const successNotice of [
  'Lead aprovado',
  'foi persistido na Fila final.',
  'Aprovando lead…',
  'A vaga foi liberada. Um novo lead só será puxado',
  'queue-action-notice',
]) if (queueReviewPanel.includes(successNotice)) fail(`aviso_sucesso_revisao_ainda_presente:${successNotice}`);

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
  'SOMENTE LEITURA',
]) if (!homolog.includes(token)) fail(`homolog_sql_incompleto:${token}`);
console.log('CRM R59 final contract + homologacao: OK');
