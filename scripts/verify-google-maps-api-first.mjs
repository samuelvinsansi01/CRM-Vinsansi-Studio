import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const extensionRoot = path.resolve(root, '..', 'google maps extractor');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const readExtension = (file) => fs.readFileSync(path.join(extensionRoot, file), 'utf8');
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };

const fixture = JSON.parse(read('scripts/fixtures/google-maps-api-first.json'));
const migration = read('supabase/migrations/20260813090000_google_maps_api_first.sql');
const fallbackMigration = read('supabase/migrations/20260813100000_whatsapp_invalid_to_instagram_review.sql');
const token = read('api/maps/token.ts');
const pair = read('api/maps/pair.ts');
const api = read('api/maps/extension.ts');
const shared = read('api/maps/shared.ts');
const app = read('src/App.tsx');
const importPage = read('src/pages/ImportPage.tsx');
const history = read('src/pages/MapsSearchesPage.tsx');
const validationRouting = read('src/pages/ValidationRoutingPage.tsx');
const leadCycle = read('src/services/lead-cycle/leadCycle.service.ts');
const authorize = read('src/pages/MapsExtensionAuthorizePage.tsx');
const platform = readExtension('src/platform-api.js');
const operational = readExtension('src/operational.js');
const sidepanel = readExtension('sidepanel.js');
const sidepanelHtml = readExtension('sidepanel.html');
const extensionFiles = [readExtension('manifest.json'), readExtension('background.js'), platform, operational, sidepanel, ...fs.readdirSync(path.join(extensionRoot, 'src')).filter((name) => name.endsWith('.js')).map((name) => readExtension(`src/${name}`))].join('\n');

for (const table of ['maps_extension_installations','maps_extension_pairings','maps_search_executions','maps_search_coverage','maps_search_candidates','maps_search_batches','maps_search_snapshots']) {
  assert(migration.includes(`public.${table}`), `Migration não cria/protege ${table}.`);
}
assert(migration.includes('ADD COLUMN IF NOT EXISTS leads_whatsapp text') && !/leads_whatsapp\s+text[^;]*default/i.test(migration), 'leads_whatsapp não é forward-only nullable sem DEFAULT.');
assert(migration.includes('ADD COLUMN IF NOT EXISTS maps_search_candidates_id uuid'), 'Promoção não possui referência idempotente candidato → lead.');
for (const forbidden of [/UPDATE\s+public\.leads/i, /DELETE\s+FROM\s+public\.leads/i, /INSERT\s+INTO\s+public\.leads/i, /FROM\s+public\.leads[\s\S]{0,200}INSERT/i]) {
  assert(!forbidden.test(migration), 'Migration Maps toca ou deriva backfill da base histórica de leads.');
}
assert(migration.includes('ENABLE ROW LEVEL SECURITY') && migration.includes('auth.uid()') && migration.includes('FROM PUBLIC, anon, authenticated'), 'Novas tabelas não possuem RLS/grants owner-only mínimos.');
assert(!/USING\s*\(\s*true\s*\)/i.test(migration), 'Migration abriu policy autenticada global.');

assert(token.includes('GMAPS_EXTENSION_SIGNING_SECRET') && token.includes("extensionType: 'google_maps'") && token.includes('installationId') && token.includes('scopes') && token.includes('iat') && token.includes('exp'), 'Token Maps não contém assinatura/claims mínimos.');
assert(pair.includes("action === 'initiate'") && pair.includes("action === 'authorize'") && pair.includes("action === 'exchange'"), 'Pairing não possui as três fases.');
assert(authorize.includes('auth.getSession()') && authorize.includes("action: 'authorize'"), 'Autorização web não deriva a sessão Supabase autenticada.');
assert(shared.includes("extension_type', 'google_maps'") && shared.includes("status !== 'active'"), 'API não valida instalação ativa junto com o token.');
assert(shared.includes('payload.scopes.some') && shared.includes('gmaps_extension_scope_revoked'), 'API não confronta scopes assinados com os scopes vigentes da instalação.');
assert(api.includes('scopes: scope.token.scopes'), 'Renovação de sessão pode ampliar scopes da instalação.');

const requiredScopes = ['maps:catalogs:read','maps:targets:read','maps:searches:read','maps:searches:write','maps:candidates:read','maps:candidates:write','maps:leads:promote'];
for (const scope of requiredScopes) assert(token.includes(scope), `Scope ausente: ${scope}.`);
for (const action of ['catalogs','cities','targets','search_create','next_search','batch_sync','coverage_transition','execution_transition','candidates_list','candidate_update','candidate_exclude','candidate_restore','leads_promote','history','history_detail']) {
  assert(api.includes(`'${action}'`), `Ação API ausente: ${action}.`);
}
assert(api.includes(".eq('users_id', usersId)") && !api.includes('input.usersId'), 'Queries operacionais não são tenant-scoped pelo token.');
assert(api.includes("lead_status_id: 1") && api.includes("leads_origin: 'google_maps'"), 'Promoção não cria lead IMPORTADO com origem Google Maps.');
assert(api.includes("destination = phoneWhatsapp ? 'whatsapp' : 'instagram'") && api.includes('leads_whatsapp:'), 'Destino inicial ou WhatsApp separado divergiu.');
assert(api.includes("sourceKey = destination === 'instagram' ? 'instagram'"), 'Lead cujo único destino operacional é Instagram não usa a fonte canônica instagram.');
assert(!/evolution/i.test(api + platform + operational + sidepanel), 'Extensão/API Maps chama ou acopla Evolution.');
assert(!/apify/i.test(api + extensionFiles + importPage), 'Fluxo Maps reintroduziu Apify.');

assert(sidepanelHtml.includes('>Pesquisa<') && sidepanelHtml.includes('>Leads '), 'Side Panel não possui as duas abas internas.');
for (const id of ['branchSelect','stateSelect','citySelect','daysSelect','candidateList','detailPhone','detailWhatsapp','detailInstagram','detailWebsite','saveSelectedBtn']) assert(sidepanelHtml.includes(`id="${id}"`), `UI da extensão perdeu #${id}.`);
assert(sidepanel.includes('beginPairing') && sidepanel.includes("request('search_create'") && sidepanel.includes('chrome.windows.create') && sidepanel.includes('chrome.sidePanel.open'), 'Extensão não conecta/cria pesquisa/inicia janela dedicada diretamente.');
assert(!sidepanel.includes("$('startBtn').disabled = !operationalState?.configured || !connected"), 'Iniciar pesquisa API-first ainda exige uma aba Maps previamente conectada e não consegue criar a janela dedicada.');
assert(sidepanel.includes('tabId: dedicatedTabId') && operational.includes('mapsTab(preferredTabId)'), 'Janela dedicada depende de currentWindow e pode iniciar na aba errada.');
assert(sidepanel.includes("request('candidate_update'") && sidepanel.includes("request('leads_promote'"), 'Revisão e salvamento não usam a API direta.');
assert(operational.includes("GMAPS_PLATFORM_API.request('batch_sync'") && operational.includes('pendingBatch') && operational.includes('MAX_PENDING_ITEMS = 500'), 'Sync idempotente/backlog seguro não está no checkpoint.');
assert(operational.includes("state.status = 'paused'") && operational.includes("pauseReason = 'platform_sync_backlog_limit'"), 'Backlog indisponível não pausa automaticamente.');
assert(operational.includes('pendingApiCompletion') && operational.includes("pauseReason = 'platform_sync_required'") && operational.includes('!state.sync.confirmedKeys.includes'), 'Cobertura pode avançar antes da confirmação do lote de candidatos.');
assert(sidepanel.includes("request('search_get'") && operational.includes('execution_paused_after_browser_restart'), 'Restart não pausa e reconcilia com a API.');

const terms = [fixture.branch, ...fixture.subcategories];
const ordered = fixture.cities.flatMap((city) => terms.map((term) => `${city}:${term}`));
assert(ordered.slice(0, terms.length).every((entry) => entry.startsWith('Mauá:')) && ordered[terms.length].startsWith('Santo André:'), 'Fixture cidade→ramo+subramos não comprova a ordem fechada.');
const afterFirst = fixture.firstCoverage;
const reachedAfterFirst = afterFirst.phoneWhatsapp >= fixture.targets.phoneWhatsapp && afterFirst.instagram >= fixture.targets.instagram;
const final = { phoneWhatsapp: afterFirst.phoneWhatsapp + fixture.secondCoverage.phoneWhatsapp, instagram: afterFirst.instagram + fixture.secondCoverage.instagram };
assert(!reachedAfterFirst && final.phoneWhatsapp === fixture.expectedFinal.phoneWhatsapp && final.instagram === fixture.expectedFinal.instagram, 'Metas mínimas/overshoot não preservam o cenário 10/4 → 18/5.');
assert(api.includes("item.placeId || item.mapsDataId || item.cid || item.googleMapsUrl") && operational.includes('new Set(state.items.map'), 'Dedupe por execução perdeu a prioridade canônica.');
assert(api.includes("excluded_by_user', false") && api.includes("eligibility_status', 'ready_to_save'"), 'Promoção não exclui candidatos rejeitados/inelegíveis.');
assert(api.includes(".eq('maps_search_candidates_id', candidateId)") && migration.includes('leads_maps_search_candidates_id_unique'), 'Salvar novamente pode duplicar o lead promovido.');

assert(fallbackMigration.includes("ELSIF p_outcome = 'invalid'") && fallbackMigration.includes('v_target_status_id := 1') && fallbackMigration.includes('v_target_channel_id := v_instagram_channel_id'), 'WhatsApp não encontrado não retorna a IMPORTADO/Instagram.');
assert(fallbackMigration.includes('FOR UPDATE') && fallbackMigration.includes('v_current_phone <> v_validated_phone'), 'Fallback posterior perdeu lock/snapshot contra resposta antiga.');
assert(fallbackMigration.includes("coalesce(nullif(trim(lead.leads_whatsapp), ''), lead.leads_phone)") && fallbackMigration.includes("coalesce(nullif(trim(v_lead.leads_whatsapp), ''), v_lead.leads_phone)"), 'Prova/RPC não usam WhatsApp separado antes do telefone legado.');
assert(!/UPDATE\s+public\.leads[\s\S]*?;\s*(?![\s\S]*CREATE OR REPLACE FUNCTION)/i.test(fallbackMigration.split('CREATE OR REPLACE FUNCTION')[0]), 'Migration posterior executa UPDATE histórico fora da função futura.');
assert(validationRouting.includes('Adicionar Instagram') && validationRouting.includes('Corrigir Instagram') && validationRouting.includes("'route-imported-to-instagram'") && leadCycle.includes('updateImportedInstagram'), 'CRM não expõe pendência/edição/aprovação manual de Instagram.');

assert(app.includes('MapsExtensionAuthorizePage') && app.includes("activePage === 'maps-searches'") && history.includes("items={['Resultados', 'Cobertura', 'JSON']}"), 'CRM não possui autorização/histórico final de Maps.');
assert(!importPage.includes('googleMapsExtensionService') && !importPage.includes('Enviar execução para extensão') && !importPage.includes('Bridge ativa'), 'UX ativa do CRM ainda controla a execução Maps.');
assert(importPage.includes('Importar backup JSON (diagnóstico)'), 'JSON manual não ficou restrito a fallback diagnóstico.');

for (const forbidden of ['GMAPS_EXTENSION_SIGNING_SECRET','SUPABASE_SERVICE_ROLE_KEY','WORKER_HTTP_TOKEN','EVOLUTION_API_KEY','INSTAGRAM_EXTENSION_SIGNING_SECRET']) {
  assert(!extensionFiles.includes(forbidden), `Extensão contém nome/secret server-side proibido: ${forbidden}.`);
}

if (failures.length) {
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log('OK: Maps API-first cobre auth escopada, catálogos/metas, cidade→termos, persistência, revisão, sync idempotente, promoção e zero mutação histórica.');
