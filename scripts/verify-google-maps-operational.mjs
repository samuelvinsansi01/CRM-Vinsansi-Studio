import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = process.cwd();
const extensionRoot = path.resolve(root, '..', 'google maps extractor');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const readExtension = (file) => fs.readFileSync(path.join(extensionRoot, file), 'utf8');
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };
const fixture = JSON.parse(read('scripts/fixtures/google-maps-operational-execution.json'));
const operationalSource = readExtension('src/operational.js');
const runner = readExtension('src/runner.js');
const content = readExtension('src/content.js');
const diagnostics = readExtension('src/diagnostics.js');
const config = readExtension('src/config.js');
const bridge = readExtension('src/crm-bridge.js');
const sidepanel = readExtension('sidepanel.js');
const manifest = JSON.parse(readExtension('manifest.json'));
const crmService = read('src/services/google-maps-extension/googleMapsExtension.service.ts');
const importPage = read('src/pages/ImportPage.tsx');
const validation = read('src/services/import/importValidation.ts');

assert(fixture.branchName === 'Móveis Planejados' && fixture.branchesId === 42, 'Fixture não preserva ramo/branchesId do cenário P0.');
assert(fixture.subcategories.join('|') === 'Cozinhas Planejadas|Marcenaria', 'Fixture não contém os dois subramos esperados.');
assert(fixture.locations.join('|') === 'Campinas/SP|Valinhos/SP', 'Fixture não contém os dois locais esperados.');
assert(fixture.targets.whatsappCandidates === 10 && fixture.targets.instagramCandidates === 5, 'Fixture não contém as metas separadas por canal.');

const storage = {};
const runtimeListeners = [];
const tabListeners = [];
const tabRemovedListeners = [];
const syncRequests = [];
const tabCommands = [];
let activeMapUrl = 'https://www.google.com/maps/';
const chrome = {
  storage: { local: {
    async get(key) { return { [key]: storage[key] }; },
    async set(value) { Object.assign(storage, structuredClone(value)); },
    async remove(key) { delete storage[key]; },
  } },
  runtime: { onMessage: { addListener(listener) { runtimeListeners.push(listener); } } },
  tabs: {
    onUpdated: { addListener(listener) { tabListeners.push(listener); } },
    onRemoved: { addListener(listener) { tabRemovedListeners.push(listener); } },
    async query(query) {
      if (query.url) return [{ id: 9, url: 'https://painel.samuelvinsansi.com.br/' }];
      return [{ id: 7, url: activeMapUrl, active: true }];
    },
    async get(id) {
      if (id === 9) return { id, url: 'https://painel.samuelvinsansi.com.br/' };
      if (id === 7) return { id, url: activeMapUrl };
      return null;
    },
    async update(id, update) { activeMapUrl = update.url; return { id, url: activeMapUrl }; },
    async sendMessage(id, message) {
      tabCommands.push({ id, message });
      if (message.type === 'GMAPS_CRM_SYNC_BATCH') {
        syncRequests.push(structuredClone(message));
        return { ok: true, confirmed: true, accepted: message.payload.items.length, rejected: 0, duplicates: 0 };
      }
      if (message.type === 'GMAPS_CRM_EXECUTION_EVENT') return { ok: true, confirmed: true, eventId: message.payload.eventId };
      if (message.type === 'GMAPS_POC_PING') return { ok: true, mapsReady: true, state: { phase: 'idle', operationalContext: null } };
      return { ok: true, state: { phase: 'running' } };
    },
  },
};

const context = vm.createContext({ chrome, console, crypto, structuredClone, setTimeout, clearTimeout, Date, URL, encodeURIComponent, globalThis: null });
context.globalThis = context;
vm.runInContext(operationalSource, context, { filename: 'src/operational.js' });

function dispatch(message, sender = { tab: { id: 9 } }) {
  return new Promise((resolve, reject) => {
    const listener = runtimeListeners[0];
    if (!listener) return reject(new Error('Listener operacional não registrado.'));
    const handled = listener(message, sender, resolve);
    if (handled !== true) reject(new Error(`Mensagem não tratada: ${message.type}`));
  });
}

const manualState = (await dispatch({ type: 'GMAPS_OPERATIONAL_STATE' })).state;
assert(manualState.configured === false && manualState.uiMode === 'manual', 'Snapshot sem checkpoint não identifica o modo manual.');
assert(manualState.statusLabel === 'Sem pesquisa ativa' && manualState.sync.canSync === false, 'Estado sem pesquisa ativa não é explícito ou habilita sync indevidamente.');

const pong = await dispatch({ type: 'GMAPS_EXTENSION_PING' });
assert(pong.ok && pong.type === 'GMAPS_EXTENSION_PONG', 'Background não responde ao handshake PING/PONG.');
assert(pong.extensionVersion === '0.13.0' && pong.operationalAvailable === true && pong.configured === false, 'PONG não informa versão, disponibilidade operacional e estado configurado.');

const invalidConfigure = await dispatch({ type: 'GMAPS_OPERATIONAL_CONFIGURE', execution: {} });
assert(invalidConfigure.ok === false && invalidConfigure.code === 'invalid_execution_identity' && invalidConfigure.message, 'Payload inválido não retorna erro explícito e codificado.');

const configured = await dispatch({ type: 'GMAPS_OPERATIONAL_CONFIGURE', execution: fixture });
assert(configured.ok && configured.state.combinationsTotal === 4, 'Fila cartesiana ramo/subramo/local não gerou quatro combinações.');
assert(configured.type === 'GMAPS_OPERATIONAL_CONFIGURE_ACK' && configured.configured === true && configured.executionId === fixture.executionId, 'Configure não retorna ACK explícito e correlacionado à execução.');
assert(configured.state.combinations.every((item) => item.status === 'pending'), 'Combinações novas não começam pending.');
assert(configured.state.uiMode === 'operational' && configured.state.statusLabel === 'Configurada', 'Snapshot não expõe a execução CRM configurada antes do start.');
assert(configured.state.current.position === 1 && configured.state.current.subcategory === 'Cozinhas Planejadas' && configured.state.current.location === 'Campinas/SP', 'Snapshot pré-start não expõe a primeira combinação.');
assert(configured.state.whatsappCandidates === 0 && configured.state.instagramCandidates === 0, 'Snapshot pré-start não começa as metas em zero.');
assert(configured.state.controls.canStart && !configured.state.controls.canPause, 'Controles do snapshot configurado estão incoerentes.');
await dispatch({ type: 'GMAPS_OPERATIONAL_START', tabId: 7 });
let state = (await dispatch({ type: 'GMAPS_OPERATIONAL_STATE' })).state;
assert(state.status === 'running' && state.current.status === 'running', 'Start não inicia a combinação atual.');
const activeConfigure = await dispatch({ type: 'GMAPS_OPERATIONAL_CONFIGURE', execution: { ...fixture, executionId: 'blocked-active-fixture' } });
assert(activeConfigure.ok === false && activeConfigure.code === 'operational_execution_in_progress_or_unsynced', 'Execução já ativa não retorna causa explícita.');

const firstContext = {
  executionId: fixture.executionId,
  combinationId: state.current.combinationId,
  branchesId: fixture.branchesId,
  branchName: fixture.branchName,
  subcategory: state.current.subcategory,
  location: state.current.location,
};
const duplicate = {
  name: 'Empresa A', category: 'Loja de móveis', phone: '(19) 99999-0000', website: null,
  instagram: null, googleMapsUrl: 'https://www.google.com/maps/place/a', mapsDataId: '0x1:0x2', address: 'Campinas/SP',
};
await dispatch({
  type: 'GMAPS_POC_RUN_FINISHED',
  data: { metadata: { operationalContext: firstContext, searchSignature: 'fixture-search-1' }, items: [duplicate, { ...duplicate }], errors: [] },
}, { tab: { id: 7 } });
await new Promise((resolve) => setTimeout(resolve, 20));
state = (await dispatch({ type: 'GMAPS_OPERATIONAL_STATE' })).state;
assert(state.totalCollected === 1 && state.whatsappCandidates === 1, 'Dedupe local contou a mesma empresa mais de uma vez na meta.');
assert(state.combinations[0].status === 'exhausted' && state.combinations[0].terminationReason === 'search_exhausted', 'Cobertura/exaustão não foi registrada para a primeira busca.');
assert(state.currentIndex === 1, 'Fila não avançou automaticamente à próxima combinação.');
assert(syncRequests.length === 1 && syncRequests[0].payload.items.length === 1, 'Sync não usa lote deduplicado e controlado.');
const synced = syncRequests[0].payload.items[0];
assert(synced.mapsCategory === 'Loja de móveis' && synced.categoryName === 'Cozinhas Planejadas', 'Categoria bruta não foi preservada separada do subramo canônico.');
assert(synced.crmContext.branchesId === 42 && synced.crmContext.location === 'Campinas/SP', 'Payload de sync perdeu ownership de ramo/local.');

for (let index = 1; index < 4; index += 1) {
  state = (await dispatch({ type: 'GMAPS_OPERATIONAL_STATE' })).state;
  const current = state.current;
  await dispatch({
    type: 'GMAPS_POC_RUN_FINISHED',
    data: { metadata: { operationalContext: {
      executionId: fixture.executionId,
      combinationId: current.combinationId,
      branchesId: fixture.branchesId,
      branchName: fixture.branchName,
      subcategory: current.subcategory,
      location: current.location,
    }, searchSignature: `fixture-search-${index + 1}` }, items: [], errors: [] },
  }, { tab: { id: 7 } });
}
state = (await dispatch({ type: 'GMAPS_OPERATIONAL_STATE' })).state;
assert(state.status === 'completed' && state.combinationsCompleted === 4, 'Execução somente exaurida não chega ao estado terminal.');
assert(state.statusLabel === 'Concluída' && state.combinationsExhausted === 4, 'Resumo concluído não expõe status e cobertura exaurida.');
await dispatch({ type: 'GMAPS_OPERATIONAL_SYNC' });
const reset = await dispatch({ type: 'GMAPS_OPERATIONAL_RESET' });
assert(reset.ok && reset.state.configured === false && !storage.gmapsOperationalExecutionV1, 'Nova pesquisa não limpa somente o checkpoint terminal local.');

await dispatch({ type: 'GMAPS_OPERATIONAL_CONFIGURE', execution: { ...fixture, executionId: 'pause-fixture' } });
await dispatch({ type: 'GMAPS_OPERATIONAL_START', tabId: 7 });
await dispatch({ type: 'GMAPS_OPERATIONAL_PAUSE' });
state = (await dispatch({ type: 'GMAPS_OPERATIONAL_STATE' })).state;
assert(state.status === 'paused' && state.current.status === 'paused', 'Pause não preserva fila/combinação como pausada.');
assert(state.controls.canResume && state.current.statusLabel === 'Pausada', 'Snapshot pausado não preserva contexto nem habilita continuar.');
await dispatch({ type: 'GMAPS_OPERATIONAL_RESUME' });
state = (await dispatch({ type: 'GMAPS_OPERATIONAL_STATE' })).state;
assert(state.status === 'running' && state.controls.canPause, 'Resume não retoma a execução operacional.');
await dispatch({ type: 'GMAPS_OPERATIONAL_STOP' });
state = (await dispatch({ type: 'GMAPS_OPERATIONAL_STATE' })).state;
assert(state.status === 'stopped', 'Stop não impede novas buscas.');
await dispatch({
  type: 'GMAPS_POC_RUN_FINISHED',
  data: { metadata: { phase: 'stopped', operationalContext: {
    executionId: 'pause-fixture', combinationId: state.current.combinationId,
    branchesId: fixture.branchesId, branchName: fixture.branchName,
    subcategory: state.current.subcategory, location: state.current.location,
  } }, items: [], errors: [] },
}, { tab: { id: 7 } });
state = (await dispatch({ type: 'GMAPS_OPERATIONAL_STATE' })).state;
assert(state.current.status === 'paused' && state.combinationsCompleted === 0, 'Stop marcou incorretamente uma busca parcial como exaurida/concluída.');
await dispatch({ type: 'GMAPS_OPERATIONAL_SYNC' });

await dispatch({ type: 'GMAPS_OPERATIONAL_CONFIGURE', execution: { ...fixture, executionId: 'resumable-error-fixture' } });
await dispatch({ type: 'GMAPS_OPERATIONAL_START', tabId: 7 });
state = (await dispatch({ type: 'GMAPS_OPERATIONAL_STATE' })).state;
await dispatch({
  type: 'GMAPS_POC_RUN_FINISHED',
  data: { metadata: { phase: 'error', mode: 'complete', operationalContext: {
    executionId: 'resumable-error-fixture', combinationId: state.current.combinationId,
    branchesId: fixture.branchesId, branchName: fixture.branchName,
    subcategory: state.current.subcategory, location: state.current.location,
  } }, items: [
    { ...duplicate, mapsDataId: '0x10:0x1', name: 'Empresa A', detailProcessed: true },
    { ...duplicate, mapsDataId: '0x10:0x2', name: 'Empresa B', detailProcessed: true },
    { ...duplicate, mapsDataId: '0x10:0x3', name: 'Empresa C', detailProcessed: false },
    { ...duplicate, mapsDataId: '0x10:0x4', name: 'Empresa D', detailProcessed: false },
  ], errors: [{ message: 'fixture_dom_interrupted_before_c' }] },
}, { tab: { id: 7 } });
await new Promise((resolve) => setTimeout(resolve, 20));
state = (await dispatch({ type: 'GMAPS_OPERATIONAL_STATE' })).state;
assert(state.status === 'paused' && state.current.status === 'paused' && state.totalCollected === 2, 'Erro retomável não pausa preservando A/B coletados.');
assert(state.controls.canResume && state.current.lastError === 'fixture_dom_interrupted_before_c', 'Erro retomável não habilita Continuar com diagnóstico preservado.');
await dispatch({ type: 'GMAPS_OPERATIONAL_STOP' });
await dispatch({ type: 'GMAPS_OPERATIONAL_SYNC' });
await dispatch({ type: 'GMAPS_OPERATIONAL_RESET' });

await dispatch({ type: 'GMAPS_OPERATIONAL_CONFIGURE', execution: {
  ...fixture,
  executionId: 'target-fixture',
  targets: { whatsappCandidates: 1, instagramCandidates: 0 },
} });
await dispatch({ type: 'GMAPS_OPERATIONAL_START', tabId: 7 });
state = (await dispatch({ type: 'GMAPS_OPERATIONAL_STATE' })).state;
await dispatch({
  type: 'GMAPS_POC_RUN_FINISHED',
  data: { metadata: { operationalContext: {
    executionId: 'target-fixture', combinationId: state.current.combinationId,
    branchesId: fixture.branchesId, branchName: fixture.branchName,
    subcategory: state.current.subcategory, location: state.current.location,
  } }, items: [{ ...duplicate, mapsDataId: '0x9:0x9', googleMapsUrl: 'https://www.google.com/maps/place/target' }], errors: [] },
}, { tab: { id: 7 } });
await new Promise((resolve) => setTimeout(resolve, 20));
state = (await dispatch({ type: 'GMAPS_OPERATIONAL_STATE' })).state;
assert(state.status === 'completed' && state.current.terminationReason === 'candidate_targets_reached' && state.combinationsRemaining === 3, 'Meta atingida não encerra a execução antes das combinações restantes.');
await dispatch({ type: 'GMAPS_OPERATIONAL_SYNC' });

await dispatch({ type: 'GMAPS_OPERATIONAL_CONFIGURE', execution: { ...fixture, executionId: 'restart-fixture' } });
await dispatch({ type: 'GMAPS_OPERATIONAL_START', tabId: 7 });
await context.GMAPS_OPERATIONAL.pauseAfterBrowserRestart();
state = (await dispatch({ type: 'GMAPS_OPERATIONAL_STATE' })).state;
assert(state.status === 'paused', 'Reinício do navegador não converte execução ativa em pausada.');
assert(state.branchName === fixture.branchName && state.current.subcategory && state.current.location, 'Reinício não preserva ramo/subramo/local visíveis no snapshot.');

const legacyCheckpoint = structuredClone(storage.gmapsOperationalExecutionV1);
delete legacyCheckpoint.sync.pendingEvents;
delete legacyCheckpoint.sync.eventSequence;
delete legacyCheckpoint.sync.syncingEvents;
storage.gmapsOperationalExecutionV1 = legacyCheckpoint;
state = (await dispatch({ type: 'GMAPS_OPERATIONAL_STATE' })).state;
assert(state.configured && state.sync.pendingEvents === 0, 'Checkpoint anterior sem pendingEvents quebra o snapshot operacional.');

for (const fragment of ['executionId', 'combinations', 'currentIndex', 'items', 'targets', 'confirmedKeys', 'searchSignature', 'terminationReason']) {
  assert(operationalSource.includes(fragment), `Checkpoint operacional perdeu ${fragment}.`);
}
assert(operationalSource.includes('function getOperationalUiSnapshot(state)') && operationalSource.includes('function normalizeOperationalState(rawState)'), 'Estado operacional não possui snapshot único e compatível com checkpoints anteriores.');
assert(operationalSource.includes('MAX_BATCH_SIZE = 25') && operationalSource.includes('pendingBatch'), 'Sync não mantém lote pequeno/idempotente para retry.');
assert(operationalSource.includes("new Set(['about', 'accounts', 'direct', 'explore', 'p', 'reel', 'reels', 'stories', 'tv'])") && operationalSource.includes("parts.length !== 1"), 'Meta Instagram aceita path não canônico ou host/perfil inválido.');
assert(runner.includes("type: 'GMAPS_POC_RUN_FINISHED'") && content.includes('message.operationalContext'), 'Scraper não entrega conclusão/contexto ao orquestrador sem ser reescrito.');
assert(diagnostics.includes('function detectLayout()') && diagnostics.includes("'feed_with_detail'") && diagnostics.includes("'detail_only'") && diagnostics.includes("'no_results'"), 'Readiness não diferencia feed, detalhe, carregamento e ausência de resultados.');
assert(diagnostics.includes('placeLinks(el).length >= 1') && !/innerWidth|clientWidth\s*[<>]/.test(diagnostics), 'Feed depende de múltiplos cards ou largura visual.');
assert(config.includes('noResultsPhrases') && runner.includes('ns.diagnostics.detectNoResults()'), 'Estado sem resultados não conclui imediatamente como busca vazia.');
assert(runner.includes('history.back()') && runner.includes('waitForFeed') && runner.includes('waitUntilClosed'), 'Modo completo perdeu o retorno semântico do detalhe para o feed.');
assert(sidepanel.includes('async function exportPayload()') && sidepanel.includes("send('GMAPS_POC_GET_DATA')") && sidepanel.includes('toCsv(data.items || [])') && sidepanel.includes('JSON.stringify(data, null, 2)'), 'JSON/CSV de backup foram removidos.');
assert(bridge.includes('event.origin !== location.origin') && bridge.includes('chrome.runtime.sendMessage'), 'Ponte CRM não valida origem local antes de falar com a extensão.');
assert(manifest.permissions.includes('tabs') && manifest.host_permissions.every((host) => !host.includes('<all_urls>')), 'Manifest não possui navegação mínima ou abriu host global.');

assert(crmService.includes('importService.importFromJson') && crmService.includes('importService.persistLeads'), 'Sync não reutiliza preview/persistência canônicos.');
assert(crmService.includes('processExecutionEvent') && crmService.includes("google-maps-execution:changed") && crmService.includes('window.sessionStorage.setItem'), 'CRM não confirma estado/cobertura/conclusão da execução sem banco.');
assert(crmService.includes('whatsappValidationService.validateInitial') && !crmService.includes('SUPABASE_SERVICE_ROLE'), 'CRM não encaminha novos candidatos WhatsApp à validação existente ou expõe service role.');
assert(crmService.includes('confirmed: false') && crmService.includes("error: 'crm_simulation_mode'"), 'SimulationMode pode confirmar falsamente um lote não persistido.');
assert(validation.includes("['branchesId', 'branches_id', 'crmContext.branchesId']"), 'Parser ignora branchesId canônico fornecido pela execução.');
assert(!importPage.includes('googleMapsExtensionService.configure') && !importPage.includes('Enviar execução para extensão'), 'CRM ainda mantém o configurador Maps como fluxo operacional ativo.');

const sensitive = [operationalSource, bridge, sidepanel].join('\n');
for (const forbidden of ['SUPABASE_SERVICE_ROLE', 'WORKER_INTERNAL_TOKEN', 'EVOLUTION_API_KEY', 'INSTAGRAM_EXTENSION_SIGNING_SECRET']) {
  assert(!sensitive.includes(forbidden), `Extensão contém segredo ou nome de segredo proibido: ${forbidden}.`);
}
assert(!/apify/i.test([operationalSource, bridge, sidepanel, crmService, importPage].join('\n')), 'Caminho operacional Google Maps possui dependência/fallback Apify.');
assert(!/evolution/i.test(operationalSource + bridge), 'Extensão tenta validar WhatsApp diretamente na Evolution.');
assert(operationalSource.includes("GMAPS_PLATFORM_API.request('batch_sync'") && operationalSource.includes('state.apiFirst'), 'Execução API-first não sincroniza diretamente com a plataforma.');

class FixtureElement {}
const noResultsContext = vm.createContext({
  document: {
    body: { innerText: 'Nenhum resultado encontrado' },
    querySelector(selector) {
      return selector === '[role="main"]' ? { innerText: 'Nenhum resultado encontrado' } : null;
    },
    querySelectorAll() {
      return [];
    },
  },
  location: { pathname: '/maps/search/' },
  Element: FixtureElement,
  Date,
  GMAPS_POC: {
    CONFIG: {
      version: 'fixture',
      selectors: { feed: [], placeLinks: [] },
      noResultsPhrases: ['nenhum resultado encontrado'],
    },
    utils: {
      cleanText: (value) => String(value || '').trim(),
      visible: () => true,
      findScrollableAncestor: () => null,
    },
    detailExtractor: { diagnostic: () => null },
  },
});
vm.runInContext(diagnostics, noResultsContext, { filename: 'src/diagnostics.js' });
const noResultsLayout = noResultsContext.GMAPS_POC.diagnostics.detectLayout();
assert(noResultsLayout.ready && noResultsLayout.kind === 'no_results' && noResultsLayout.noResults, 'Fixture sem resultados não fica pronta imediatamente, sem aguardar timeout.');

if (failures.length) {
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log('OK: scraper legado, checkpoint, metas, dedupe, sync em lote e caminho API-first foram validados localmente.');
