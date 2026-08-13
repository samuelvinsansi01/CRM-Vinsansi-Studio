import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const extensionRoot = path.resolve(root, '..', 'google maps extractor');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const readExtension = (file) => fs.readFileSync(path.join(extensionRoot, file), 'utf8');
const failures = [];
const warnings = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };

const preflight = read('scripts/production-google-maps-preflight.sql');
const postcheck = read('scripts/production-google-maps-postcheck.sql');
const mapsMigration = read('supabase/migrations/20260813090000_google_maps_api_first.sql');
const fallbackMigration = read('supabase/migrations/20260813100000_whatsapp_invalid_to_instagram_review.sql');
const whatsappCompatibilityMigration = read('supabase/migrations/20260813110000_forward_only_whatsapp_contact_compatibility.sql');
const api = read('api/maps/extension.ts');
const pair = read('api/maps/pair.ts');
const shared = read('server/maps/shared.ts');
const token = read('server/maps/token.ts');
const historyPage = read('src/pages/MapsSearchesPage.tsx');
const importPage = read('src/pages/ImportPage.tsx');
const queueService = read('src/services/queue-preparation/queuePreparation.service.ts');
const routingRules = read('src/services/lead-cycle/leadRouting.rules.ts');
const leadCycleService = read('src/services/lead-cycle/leadCycle.service.ts');
const queueRepository = read('src/repositories/whatsapp-queue/canonicalWhatsAppQueue.repository.ts');
const whatsappContact = read('src/services/leads/leadContact.ts');
const platformApi = readExtension('src/platform-api.js');
const operational = readExtension('src/operational.js');
const extensionFiles = [
  readExtension('manifest.json'), readExtension('background.js'), readExtension('sidepanel.js'),
  platformApi, operational,
  ...fs.readdirSync(path.join(extensionRoot, 'src')).filter((name) => name.endsWith('.js')).map((name) => readExtension(`src/${name}`)),
].join('\n');

function structuralSql(sql, resultAlias, label) {
  const withoutComments = sql.replace(/--.*$/gm, '');
  const withoutStrings = withoutComments.replace(/'(?:''|[^'])*'/g, "''");
  const normalized = withoutComments.toLowerCase().replace(/\s+/g, ' ').trim();
  assert(/^with\b/i.test(withoutComments.trim()), `${label} deve iniciar por WITH.`);
  assert((withoutComments.match(/;/g) ?? []).length === 1, `${label} deve conter um unico statement.`);
  assert(normalized.endsWith(`as ${resultAlias};`), `${label} nao retorna a celula JSONB esperada.`);
  assert(/select\s+jsonb_build_object\s*\(/i.test(withoutComments), `${label} nao retorna JSONB unico.`);
  assert(!/\b(?:insert|update|delete|alter|create|drop|truncate|grant|revoke|merge|copy|call|do|execute|perform|setval|nextval)\b/i.test(withoutStrings), `${label} contem comando mutavel.`);
  assert(!/\b(?:begin|commit|rollback)\b/i.test(withoutStrings), `${label} controla transacao.`);
  assert(!/\b(?:query_to_xml|xmltable|xmlparse|xpath)\b/i.test(withoutComments), `${label} usa XML.`);
  assert(!/\b(?:from|join)\s+public\.leads\b/i.test(withoutComments), `${label} consulta linhas de public.leads.`);
  assert(!/\b(?:vault|secret|password|token_value|apikey)\b/i.test(withoutComments), `${label} referencia secrets ou Vault.`);
}

structuralSql(preflight, 'production_google_maps_preflight', 'Preflight Maps');
structuralSql(postcheck, 'production_google_maps_postcheck', 'Postcheck Maps');
assert(preflight.includes("'readyForMapsMigrations'") && preflight.includes("'doesNotInspectLeadRows', true"), 'Preflight nao classifica prontidao e privacidade.');
for (const requirement of ['leads_whatsapp','maps_search_candidates_id','whatsapp','instagram','sem_site','dominio_proprio','agregador','importado','normalize_identity_phone','record_whatsapp_validation_result','chips','socials','levels']) {
  assert(preflight.toLowerCase().includes(requirement), `Preflight nao verifica ${requirement}.`);
}
assert(preflight.includes('source.users_id = branch.users_id') && preflight.includes('contact_source_missing_tenants'), 'Preflight aceita contact_sources espalhadas entre tenants diferentes.');
for (const requirement of ['readyForMapsDeploy','rls_enabled','owner_select','unexpected_policies','authenticated_dml','service_destructive','coverage_identity','candidate_identity','batch_identity','snapshot_identity','proof_prefers_whatsapp','fallback_contract','whatsapp_only_runtime_ready','whatsappContactCompatibility','no_apify_column']) {
  assert(postcheck.toLowerCase().includes(requirement.toLowerCase()), `Postcheck nao verifica ${requirement}.`);
}
assert(postcheck.includes('source.users_id = branch.users_id') && postcheck.includes("'unexpectedCount'"), 'Postcheck nao bloqueia catalogo cross-tenant ou policy autenticada adicional.');

assert(!/\bUPDATE\s+public\.leads\b/i.test(mapsMigration), 'Migration Maps executa UPDATE public.leads.');
assert(!/\bDELETE\s+FROM\s+public\.leads\b/i.test(mapsMigration), 'Migration Maps executa DELETE public.leads.');
assert(!/\bINSERT\s+INTO\s+public\.leads\b/i.test(mapsMigration), 'Migration Maps executa INSERT/backfill em public.leads.');
assert(/ADD COLUMN IF NOT EXISTS leads_whatsapp text\s*;/i.test(mapsMigration) && !/leads_whatsapp\s+text[^;]*\bDEFAULT\b/i.test(mapsMigration), 'leads_whatsapp nao e nullable sem DEFAULT.');
assert(/ADD COLUMN IF NOT EXISTS maps_search_candidates_id uuid\s*;/i.test(mapsMigration), 'Referencia de promocao nao e nullable/forward-only.');
assert(!/\bapify\b/i.test(mapsMigration), 'Migration Maps depende de Apify.');
assert(!/USING\s*\(\s*true\s*\)/i.test(mapsMigration), 'Migration Maps possui policy global USING(true).');
for (const table of ['maps_extension_installations','maps_extension_pairings','maps_search_executions','maps_search_coverage','maps_search_candidates','maps_search_batches','maps_search_snapshots']) {
  assert(mapsMigration.includes(`public.${table}`), `Objeto Maps ausente na migration: ${table}.`);
  assert(mapsMigration.includes(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`), `RLS ausente em ${table}.`);
}

const beforeFunctionDefinitions = fallbackMigration.split(/CREATE OR REPLACE FUNCTION/i)[0];
assert(!/\b(?:UPDATE|DELETE\s+FROM|INSERT\s+INTO)\s+public\.leads\b/i.test(beforeFunctionDefinitions), 'Migration fallback altera leads durante aplicacao.');
assert(fallbackMigration.includes("ELSIF p_outcome = 'invalid'") && fallbackMigration.includes('v_target_status_id := 1') && fallbackMigration.includes('v_target_channel_id := v_instagram_channel_id'), 'Fallback nao_encontrado nao preserva IMPORTADO/Instagram.');
assert(fallbackMigration.includes("IF p_outcome <> 'technical_error' THEN"), 'Erro tecnico pode alterar destino/status.');
assert(fallbackMigration.includes('FOR UPDATE') && fallbackMigration.includes('whatsapp_validation_channel_changed') && fallbackMigration.includes('whatsapp_validation_status_changed'), 'RPC perdeu lock/guards contra resposta antiga ou repetida.');

assert(token.includes("aud: 'google-maps-extension'") && token.includes("extensionType: 'google_maps'") && token.includes("hash: 'SHA-256'") && token.includes('mismatch |='), 'Token Maps perdeu HMAC SHA-256/audience/comparacao integral.');
assert(token.includes('installationId') && token.includes('scopes') && token.includes('iat') && token.includes('exp') && token.includes('jti'), 'Claims do token Maps incompletos.');
assert(pair.includes("action === 'initiate'") && pair.includes("action === 'authorize'") && pair.includes("action === 'exchange'") && pair.includes('pairing_secret_hash'), 'Pairing nao usa fases e secret hash.');
assert(shared.includes('verifyMapsExtensionToken') && shared.includes(".eq('users_id', Number(payload.sub))") && shared.includes(".eq('installation_id', payload.installationId)"), 'Sessao Maps nao vincula token, tenant e instalacao.');
assert(shared.includes('payload.scopes.some') && api.includes('scopes: scope.token.scopes'), 'Refresh pode ampliar scopes ou ignorar revogacao parcial.');
assert(!extensionFiles.includes('GMAPS_EXTENSION_SIGNING_SECRET'), 'Signing secret apareceu na extensao.');
for (const forbidden of ['SUPABASE_SERVICE_ROLE_KEY','WORKER_INTERNAL_TOKEN','EVOLUTION_API_KEY','INSTAGRAM_EXTENSION_SIGNING_SECRET','lead_validation_attempts']) {
  assert(!extensionFiles.includes(forbidden), `Extensao contem integracao/credencial proibida: ${forbidden}.`);
}

assert(api.includes('const { client, usersId } = scope') && !api.includes('input.usersId'), 'API Maps confia em usersId do payload.');
assert(/ownedExecution[\s\S]*?\.eq\('users_id', usersId\)/.test(api), 'ExecutionId nao e resolvido com owner scope.');
assert(/maps_search_candidates'[\s\S]*?\.eq\('maps_search_candidates_id', candidateId\)\.eq\('users_id', usersId\)/.test(api), 'CandidateId pode atravessar tenant.');
assert(/maps_search_snapshots'[\s\S]*?\.eq\('users_id', usersId\)\.eq\('maps_search_executions_id'/.test(api), 'Snapshots nao sao owner-scoped.');
assert(/maps_search_candidates'[\s\S]*?\.eq\('users_id', usersId\)\.eq\('maps_search_executions_id'/.test(api), 'Promocao/listagem nao limita candidatos ao tenant.');

assert(api.includes("maps_search_executions_id: execution.maps_search_executions_id, batch_id: batchId") && api.includes('maps_batch_payload_divergent'), 'Batch retry nao vincula executionId+batchId ou nao rejeita payload divergente.');
assert(mapsMigration.includes('UNIQUE (maps_search_executions_id, dedupe_key)') && mapsMigration.includes('UNIQUE (maps_search_executions_id, batch_id)') && mapsMigration.includes('leads_maps_search_candidates_id_unique'), 'Constraints de idempotencia incompletas.');
assert(api.includes("item.placeId || item.mapsDataId || item.cid || item.googleMapsUrl") && api.includes('search_terms_found'), 'Dedupe por execucao perdeu identidade/prioridade ou diagnostico de termos.');

assert(api.includes(".in('status', ['completed','exhausted'])") && api.includes(".eq('status', 'error')"), 'Cobertura automatica confunde error com completed/exhausted.');
assert(api.includes("if (execution.city_mode === 'manual')") && api.includes('normalized_search_term'), 'Rerun manual ou unidade de cobertura divergiram.');
assert(api.includes('Math.max(0, whatsappCapacityPerDay * days - whatsappStock)') && api.includes('Math.max(0, instagramCapacityPerDay * days - instagramStock)'), 'Formula de metas divergiu.');
assert(api.includes('row.effective_phone || row.effective_whatsapp'), 'Phone/WhatsApp nao contam como uma unidade.');

const openBlock = historyPage.slice(historyPage.indexOf('const open ='), historyPage.indexOf('const changeTab ='));
const changeTabBlock = historyPage.slice(historyPage.indexOf('const changeTab ='), historyPage.indexOf('const rows ='));
assert(!openBlock.includes('maps_search_snapshots') && changeTabBlock.includes("nextTab !== 'JSON'") && changeTabBlock.includes("from('maps_search_snapshots')"), 'Snapshots nao sao carregados somente ao abrir a tab JSON.');
assert(!openBlock.includes("maps_search_candidates').select('*')") && !openBlock.includes('raw_payload'), 'Drawer carrega raw_payload automaticamente.');
assert(importPage.includes('Importar backup JSON (diagnóstico)') && !importPage.includes('googleMapsExtensionService'), 'ImportPage reativou configurador/bridge Maps.');

assert(api.includes("destination = phoneWhatsapp ? 'whatsapp' : 'instagram'"), 'Destino inicial nao usa phone/WhatsApp antes de Instagram.');
assert(api.includes("sourceKey = destination === 'instagram' ? 'instagram'") && api.includes("website_classification || 'sem_site'"), 'Contact source divergiu do contrato canonico.');
assert(api.includes("lead_status_id: 1") && api.includes("leads_origin: 'google_maps'"), 'Promocao nao cria IMPORTADO de origem google_maps.');
assert(api.includes(".eq('excluded_by_user', false).eq('eligibility_status', 'ready_to_save')"), 'Promocao aceita candidato excluido ou inelegivel.');

const identitySupportsWhatsapp = /OLD\.leads_identity_contract_version IS DISTINCT FROM 1/i.test(whatsappCompatibilityMigration)
  && /normalize_identity_phone\([\s\S]*?NEW\.leads_whatsapp[\s\S]*?NEW\.leads_phone/i.test(whatsappCompatibilityMigration)
  && /register_lead_identity[\s\S]*?NEW\.leads_normalized_phone/i.test(whatsappCompatibilityMigration)
  && /CREATE TRIGGER prepare_lead_identity_trigger[\s\S]*?leads_whatsapp/i.test(whatsappCompatibilityMigration)
  && /CREATE TRIGGER register_lead_identity_trigger[\s\S]*?leads_whatsapp/i.test(whatsappCompatibilityMigration);
const queueSupportsWhatsapp = /prepare_queue_items_without_whatsapp_validation_proof[\s\S]*?v_effective_expression[\s\S]*?v_lead\.leads_whatsapp[\s\S]*?v_lead\.leads_phone/i.test(whatsappCompatibilityMigration)
  && /build_queue_item_payload_snapshot[\s\S]*?v_effective_whatsapp_phone[\s\S]*?v_lead\.leads_whatsapp/i.test(whatsappCompatibilityMigration)
  && queueService.includes('getEffectiveWhatsAppPhone(row)')
  && routingRules.includes('getEffectiveWhatsAppPhone(row)')
  && leadCycleService.includes('phone: getEffectiveWhatsAppPhone(row)')
  && queueRepository.includes('snapshotLead.whatsapp')
  && queueRepository.includes('getEffectiveWhatsAppPhone(lead)')
  && whatsappContact.indexOf('lead.leads_whatsapp') < whatsappContact.indexOf('lead.leads_phone');
assert(postcheck.includes('whatsapp_only_runtime_ready') && postcheck.includes('identity_uses_whatsapp') && postcheck.includes('queue_uses_whatsapp') && postcheck.includes('snapshot_uses_whatsapp'), 'Postcheck nao bloqueia deploy quando WhatsApp separado nao e consumido por identity/fila.');
if (!identitySupportsWhatsapp || !queueSupportsWhatsapp) failures.push('NO-GO: leads WhatsApp-only ainda nao entram integralmente em identity/dedup e preparacao/snapshot da fila.');
assert(/MAX_SNAPSHOT_BYTES\s*=\s*1_500_000/.test(api) && api.indexOf('snapshotBytes > MAX_SNAPSHOT_BYTES') < api.indexOf("from('maps_search_coverage').update(patch)"), 'Limite de snapshot nao e aplicado antes da mutacao de cobertura.');
assert(/MAX_SNAPSHOT_BYTES\s*=\s*1_500_000/.test(operational) && operational.includes('snapshotForApi(message.data)') && operational.includes("compactionReason: 'snapshot_size_limit'"), 'Extensao nao reduz snapshot grande preservando o checkpoint/sync normal.');
if (!/rate.?limit|attempt_count|failed_attempt/i.test(pair)) warnings.push('Risco: pairing usa secret de alta entropia, mas nao possui rate-limit/contador de tentativas explicito.');

if (failures.length) {
  console.error(`Falhas na auditoria Maps (${failures.length}):`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  warnings.forEach((warning) => console.warn(`- ${warning}`));
  console.error('AUDIT_DECISION=NO_GO');
  process.exit(1);
}

console.log('OK: preflight/postcheck sao read-only, single-statement e nao leem linhas de leads ou secrets.');
console.log('OK: migrations, auth, tenant isolation, idempotencia, cobertura, metas, UX e extensao foram auditados estruturalmente.');
warnings.forEach((warning) => console.warn(`- ${warning}`));
console.log(warnings.some((warning) => warning.startsWith('NO-GO:')) ? 'AUDIT_DECISION=NO_GO' : 'AUDIT_DECISION=GO');
