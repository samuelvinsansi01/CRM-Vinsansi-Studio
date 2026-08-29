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
const invalidationPatch = 'APLICAR - CRM R59 BUILD FIX 5 - Corrigir invalidacao.sql';
if (!exists(invalidationPatch)) fail('sql_correcao_invalidacao_ausente');
const invalidationSql = read(invalidationPatch);
for (const token of [
  'CREATE OR REPLACE FUNCTION public.invalidate_final_queue_item',
  'CREATE OR REPLACE FUNCTION public.invalidate_queue_review_item',
  'SET status_id = 6',
  'SET lead_status_id = 6',
  "'contractVersion', 'R59'",
]) if (!invalidationSql.includes(token)) fail(`sql_correcao_invalidacao_incompleto:${token}`);
for (const legacy of ['invalid_status_catalog_missing', "IN ('invalido', 'invalid')", "'contractVersion', 'R58'"]) {
  if (invalidationSql.includes(legacy)) fail(`sql_correcao_invalidacao_legado:${legacy}`);
}

const homolog = read(homologSql);
for (const token of [
  '60::bigint esperado',
  'status_antigos_funcoes',
  'revisao_com_canal_invalido',
  'revisao_canal_divergente_batch',
  'enviado_sem_canal_legacy',
  'status_operacional_divergencias',
  'contrato_invalidacao_r59',
  'SOMENTE LEITURA',
]) if (!homolog.includes(token)) fail(`homolog_sql_incompleto:${token}`);
console.log('CRM R59 final contract + homologacao: OK');
