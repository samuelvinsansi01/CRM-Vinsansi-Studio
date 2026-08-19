import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const extensionCandidates = [
  path.resolve(root, '..', 'maps'),
  path.resolve(root, '..', 'google maps extractor'),
  path.resolve(root, 'google maps extractor'),
];
const extensionRoot = extensionCandidates.find((candidate) => fs.existsSync(path.join(candidate, 'manifest.json'))) || extensionCandidates[0];
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const readExtension = (file) => fs.readFileSync(path.join(extensionRoot, file), 'utf8');
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };

const api = read('api/maps/extension.ts');
const shared = read('server/maps/shared.ts');
const migration = read('supabase/migrations/20260813120000_maps_inventory_multi_execution_priority.sql');
const score = read('src/services/lead-score/leadScore.service.ts');
const canonicalLead = read('src/services/import/canonicalLead.ts');
const history = read('src/pages/MapsSearchesPage.tsx');
const configPage = read('src/pages/ConfigTablePage.tsx');
const operational = readExtension('src/operational.js');
const runner = readExtension('src/runner.js');
const extractor = readExtension('src/extractor.js');
const detail = readExtension('src/detail-extractor.js');
const utils = readExtension('src/utils.js');
const sidepanel = readExtension('sidepanel.js');
const html = readExtension('sidepanel.html');
const background = readExtension('background.js');
const manifest = JSON.parse(readExtension('manifest.json'));

assert(manifest.version === '0.17.1', 'Manifest Maps deve estar em 0.17.1.');
assert(manifest.permissions.includes('alarms'), 'Manifest precisa de alarms para heartbeat multi-execução.');
assert(html.includes('id="targetWhatsappInput"') && html.includes('id="targetInstagramInput"') && html.includes('id="targetUnique"'), 'Side Panel perdeu metas de estoque aditivas.');
assert(!html.includes('id="daysSelect"'), 'Side Panel ainda expõe meta por dias.');
assert(html.includes('Pesquisas ativas: 0 / 5'), 'Side Panel não expõe contador 0/5.');
assert(sidepanel.includes("request('active_executions'") && sidepanel.includes("request('search_create'") && sidepanel.includes('usesBranchDefaultTargets') && sidepanel.includes('targetWhatsapp: usesBranchDefaultTargets ? null : form.targetWhatsapp') && sidepanel.includes('targetInstagram: usesBranchDefaultTargets ? null : form.targetInstagram'), 'Side Panel não cria pesquisa com estoque por ramo/override.');
assert(sidepanel.includes('MAPS_ACTIVE_EXECUTION_LIMIT') && sidepanel.includes('Limite de 5 pesquisas simultâneas'), 'UX da sexta execução não é explícita.');

assert(operational.includes("gmapsOperationalExecutionsV2") && operational.includes("gmapsOperationalTabBindingsV2"), 'Estado local ainda é single-execution.');
assert(operational.includes('tabId') && operational.includes('executionIdForTab') && operational.includes('withExecutionContext'), 'Execução não está isolada por tabId + executionId.');
assert(operational.includes('unique >= state.targets.whatsappCandidates + state.targets.instagramCandidates'), 'Stopping local não exige soma aditiva de leads únicos.');
assert(operational.includes('response.stopAfterCurrentCoverage') && operational.includes("terminationReason = 'candidate_targets_reached'"), 'Extensão pode iniciar outra cobertura depois de bater as metas.');
assert(background.includes('gmapsOperationalHeartbeat') && background.includes('heartbeatAll'), 'Heartbeat de execuções não está ativo.');

assert(api.includes("const EXTENSION_VERSION = '0.17.1'"), 'API Maps não está em contrato 0.17.1.');
assert(api.includes("create_maps_search_execution_v2") && api.includes('activeLimit: 5'), 'API não aplica limite central de cinco execuções.');
assert(migration.includes('pg_advisory_xact_lock(p_users_id)') && migration.includes('IF v_active_count >= 5'), 'Limite 5/usuário não é atômico no banco.');
assert(migration.includes("'google_maps'::text"), 'Migration oficial não adiciona google_maps à origem.');
assert(migration.includes('ADD COLUMN IF NOT EXISTS acquisition_bucket') && migration.includes("acquisition_bucket IN ('whatsapp','instagram')"), 'Bucket único de aquisição não foi persistido.');
assert(api.includes('unique_allocated_count') && api.includes('targetWhatsapp + targetInstagram'), 'API não calcula total único aditivo.');
assert(api.includes('chooseAcquisitionBucket') && api.includes('bucketDeficit'), 'API não aloca candidato de dois canais em somente um bucket.');

assert(utils.includes('parseBusinessStatus') && extractor.includes('businessStatus') && detail.includes('businessStatus'), 'Scraper não detecta status de fechamento.');
assert(runner.includes("item.businessStatus === 'temporarily_closed'") && runner.includes("item.businessStatus === 'permanently_closed'"), 'Runner ainda processa detalhes de empresas fechadas.');
assert(api.includes("eligibilityStatus = closed ? 'closed_business'") && api.includes(".neq('eligibility_status', 'closed_business')"), 'Empresa fechada pode entrar na aba Leads comercial.');

for (const marker of ['placeId','mapsDataId','cid','kgmid','canonicalMapsUrl','identityAliases']) assert(operational.includes(marker) || runner.includes(marker), `Dedupe multi-alias perdeu ${marker}.`);
assert(runner.includes('_executionDuplicate') && runner.includes('processed_in_execution'), 'Runner não marca empresas já processadas para pular detalhe.');
assert(api.includes("action === 'candidate_provenance'") && operational.includes("request('candidate_provenance'"), 'Proveniência entre coberturas não é persistida sem reprocessar o lead.');

assert(api.includes('leads_score: rating') && api.includes('leads_reviews_count: reviews') && api.includes('leads_priority_score:'), 'Promoção Maps não separa nota Google, avaliações e prioridade interna.');
assert(score.includes('normalizeGoogleRating') && score.includes('calculateLeadPriorityScore'), 'Serviço de score não separa rating de prioridade.');
assert(canonicalLead.includes('leads_priority_score') && canonicalLead.includes('normalizeGoogleRating'), 'Importação canônica ainda pode gravar score interno em leads_score.');
assert(migration.includes('leads_priority_score integer'), 'Banco não possui score interno separado.');

assert(configPage.includes('Estoque alvo WhatsApp/telefone') && configPage.includes('Estoque alvo Instagram'), 'Cadastro de ramo não permite definir estoque por canal.');
assert(api.includes('stockTargetWhatsapp') && api.includes('stockTargetInstagram'), 'API não lê metas do ramo.');

assert(history.includes("['Resultados', 'JSON']") || (history.includes("'Resultados'") && history.includes("'JSON'")), 'Drawer de cobertura não possui Resultados + JSON contextual.');
assert(history.includes('selectedCoverage') && (history.includes('coverageId') || history.includes('maps_search_coverage_id')), 'Histórico não navega por cobertura.');
assert(api.includes("contains('coverage_ids_found', [coverageId])") && api.includes("eq('maps_search_coverage_id', coverageId)"), 'history_detail não restringe candidatos/snapshots à cobertura selecionada.');

assert(sidepanel.includes('Motivo:') && sidepanel.includes('failures.find'), 'Salvar Leads ainda esconde o primeiro erro real da API.');
assert(shared.includes("MAPS_ACTIVE_EXECUTION_LIMIT") && shared.includes('409'), 'Erro de limite ativo não tem status HTTP de conflito.');

const importTypes = read('src/services/import/types.ts');
const importRepo = read('src/repositories/import/supabaseImport.repository.ts');
const categoryUtils = read('src/utils/branchCategories.ts');
assert(importTypes.includes('priority_score?: number'), 'ImportLead não carrega prioridade persistida.');
assert(importRepo.includes('rating: Number(row.leads_score ?? 0)') && importRepo.includes('priority_score: Number(row.leads_priority_score ?? 0)'), 'Leads persistidos não reaproveitam rating/prioridade no ranking operacional.');
assert(score.includes('explicit > 0') && score.includes('calculateLeadPriorityScore(lead)'), 'Leads históricos com prioridade 0 não possuem fallback de ranking em runtime.');
assert(categoryUtils.includes('{ associatedCategories: categoriesFromValue(value) }'), 'Metas do ramo podem apagar categorias legadas array/string.');
assert(api.includes('strings([execution.branch_name, candidate.maps_category, candidate.search_terms_found])'), 'Promoção Maps não preserva categoria Maps junto ao ramo/termos.');

if (failures.length) {
  console.error(`Falhas Maps v0.17.1 (${failures.length}):`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log('OK: Maps v0.17.1 cobre estoque aditivo, stop após cobertura atual, fechados, ranking separado, proveniência e até 5 execuções isoladas por usuário.');
