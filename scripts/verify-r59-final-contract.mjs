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

const mapsRoute = read('server/routes/maps/extension.ts');
for (const token of ['leads_normalized_phone','leads_normalized_instagram','leads_normalized_domain','leads_normalized_maps']) if (!mapsRoute.includes(token)) fail(`captura_identidade_direta_ausente:${token}`);
const pull = read('src/services/queue-review/queueReview.service.ts');
for (const token of ['pull_queue_review_to_capacity','validatePreparedInitial','capacityToFill','redirectedLeadIds']) if (!pull.includes(token)) fail(`puxada_final_incompleta:${token}`);
const homolog = read(homologSql);
for (const token of [
  '60::bigint esperado',
  'status_antigos_funcoes',
  'revisao_com_canal_invalido',
  'revisao_canal_divergente_batch',
  'enviado_sem_canal_legacy',
  'SOMENTE LEITURA',
]) if (!homolog.includes(token)) fail(`homolog_sql_incompleto:${token}`);
console.log('CRM R59 final contract + homologacao: OK');
