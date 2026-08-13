import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = process.cwd();
const extensionRoot = path.resolve(root, '..', 'google maps extractor');
const readExtension = (file) => fs.readFileSync(path.join(extensionRoot, file), 'utf8');
const acceptanceFixture = JSON.parse(fs.readFileSync(path.join(root, 'scripts/fixtures/google-maps-resume-dedupe.json'), 'utf8'));
const operationalSource = readExtension('src/operational.js');
const sidepanelSource = readExtension('sidepanel.js');
const contentSource = readExtension('src/content.js');
const runnerSource = readExtension('src/runner.js');
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };

const coverage = (id, cityName, searchTerm, position, options = {}) => ({
  maps_search_coverage_id: id,
  branches_id: 42,
  branch_name: options.branchName || 'Contabilidade',
  states_id: 25,
  state_name: options.stateName || 'São Paulo',
  state_code: options.stateCode || 'SP',
  cities_id: cityName === 'Mauá' ? 1 : 2,
  city_name: cityName,
  search_term: searchTerm,
  search_query: `${searchTerm} em ${cityName} ${options.stateCode || 'SP'}`,
  term_position: position,
});

async function runScenario(name, coverages, cityMode) {
  const storage = {};
  const runtimeListeners = [];
  const updatedListeners = [];
  const removedListeners = [];
  const navigations = [];
  const runnerCommands = [];
  const diagnostics = [];
  const platformRequests = [];
  let currentUrl = 'https://www.google.com/maps/';
  let terminalCoverageIndex = 0;
  let tabCreates = 0;
  let windowCreates = 0;

  const chrome = {
    storage: { local: {
      async get(key) { return { [key]: storage[key] }; },
      async set(value) { Object.assign(storage, structuredClone(value)); },
    } },
    runtime: { onMessage: { addListener(listener) { runtimeListeners.push(listener); } } },
    tabs: {
      onUpdated: { addListener(listener) { updatedListeners.push(listener); } },
      onRemoved: { addListener(listener) { removedListeners.push(listener); } },
      async get(id) { return id === 77 ? { id, url: currentUrl, active: true } : null; },
      async query() { return [{ id: 77, url: currentUrl, active: true }]; },
      async create() { tabCreates += 1; throw new Error('tabs_create_forbidden'); },
      async update(id, update) {
        assert(id === 77, `${name}: navegação migrou para outra aba.`);
        currentUrl = update.url;
        navigations.push({ id, url: update.url });
        setTimeout(() => updatedListeners.forEach((listener) => listener(id, { status: 'complete', url: update.url }, { id, url: update.url })), 0);
        return { id, url: update.url };
      },
      async sendMessage(id, message) {
        assert(id === 77, `${name}: comando foi enviado para outra aba.`);
        if (message.type === 'GMAPS_POC_SEARCH') {
          currentUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(message.query)}`;
          navigations.push({ id, query: message.query, url: currentUrl, token: message.navigationToken });
          return { ok: true, committed: true, navigationToken: message.navigationToken, requestedQuery: message.query, pageUrl: currentUrl, pageQuery: message.query };
        }
        if (message.type === 'GMAPS_POC_PING') return { ok: true, mapsReady: true, pageQuery: new URL(currentUrl).searchParams.get('query') || '', mapsLayout: { kind: 'feed', noResults: false, detailDetected: false }, lastOperationalSearch: { token: navigations.at(-1)?.token, committed: true }, state: { phase: 'idle', operationalContext: null } };
        if (message.type === 'GMAPS_POC_START' || message.type === 'GMAPS_POC_RESUME') {
          runnerCommands.push(structuredClone(message));
          return { ok: true, state: { phase: 'running', operationalContext: message.operationalContext } };
        }
        return { ok: true };
      },
    },
    windows: { async create() { windowCreates += 1; throw new Error('windows_create_forbidden'); } },
  };

  const platformApi = {
    async request(action, payload) {
      platformRequests.push({ action, payload: structuredClone(payload) });
      if (action === 'coverage_transition' && ['completed', 'exhausted'].includes(payload.status)) {
        terminalCoverageIndex += 1;
        return { ok: true, targetsReached: false, next: { coverage: coverages[terminalCoverageIndex] || null } };
      }
      return { ok: true, confirmed: true, accepted: 0, rejected: 0, duplicates: 0 };
    },
  };
  const safeConsole = { ...console, info(_label, event, details) { diagnostics.push({ event, details }); } };
  const context = vm.createContext({
    chrome, console: safeConsole, crypto, structuredClone, setTimeout, clearTimeout, Date, URL, encodeURIComponent,
    TextEncoder, GMAPS_PLATFORM_API: platformApi, globalThis: null,
  });
  context.globalThis = context;
  vm.runInContext(operationalSource, context, { filename: 'src/operational.js' });

  const dispatch = (message) => new Promise((resolve, reject) => {
    const handled = runtimeListeners[0]?.(message, {}, resolve);
    if (handled !== true) reject(new Error(`${name}: mensagem não tratada: ${message.type}`));
  });
  const waitUntil = async (predicate, message) => {
    const started = Date.now();
    while (!predicate() && Date.now() - started < 2_000) await new Promise((resolve) => setTimeout(resolve, 5));
    assert(predicate(), `${name}: ${message}`);
  };

  await dispatch({
    type: 'GMAPS_OPERATIONAL_CONFIGURE',
    execution: {
      apiFirst: true,
      executionId: `execution-${name}`,
      branchesId: 42,
      branchName: coverages[0].branch_name,
      statesId: 25,
      stateName: coverages[0].state_name,
      stateCode: coverages[0].state_code,
      cityMode,
      requestedDays: 1,
      mode: 'complete',
      targets: { whatsappCandidates: 100, instagramCandidates: 100 },
      initialCoverage: coverages[0],
    },
  });
  await dispatch({ type: 'GMAPS_OPERATIONAL_START', tabId: 77 });

  for (let index = 0; index < coverages.length; index += 1) {
    await waitUntil(() => runnerCommands.length > index, `runner não iniciou a combinação ${index + 1}.`);
    const command = runnerCommands[index];
    const items = name === 'manual'
      ? (index === 0 ? acceptanceFixture.firstCombination : index === 1 ? acceptanceFixture.secondCombination : [])
      : [];
    await dispatch({
      type: 'GMAPS_POC_RUN_FINISHED',
      data: { metadata: { phase: 'completed', searchSignature: `signature-${index}`, operationalContext: command.operationalContext }, items, errors: [] },
    });
  }
  await waitUntil(() => storage.gmapsOperationalExecutionV1?.status === 'completed', 'execução não chegou a completed.');

  const queries = navigations.map(({ query }) => query);
  assert(JSON.stringify(queries) === JSON.stringify(coverages.map((item) => item.search_query)), `${name}: ordem/query divergente: ${JSON.stringify(queries)}.`);
  assert(navigations.every(({ id }) => id === 77) && runnerCommands.length === coverages.length, `${name}: nem todas as combinações usaram a mesma aba/runner.`);
  assert(storage.gmapsOperationalExecutionV1.activeMapsTabId === 77, `${name}: mapsTabId não permaneceu persistido.`);
  assert(tabCreates === 0 && windowCreates === 0, `${name}: abriu aba ou janela durante a execução.`);
  if (name === 'manual') {
    assert(runnerCommands[1].operationalContext.processedKeys.length === 4, 'manual: segundo termo não recebeu A/B/C/D para dedupe anterior ao detalhe.');
    assert(runnerCommands[1].operationalContext.processedCountBase === 4, 'manual: contagem acumulada não foi entregue ao segundo termo.');
    assert(storage.gmapsOperationalExecutionV1.items.map((item) => item.name).sort().join(',') === 'A,B,C,D,E', 'manual: estado operacional não preservou A/B/C/D/E únicos.');
    assert(platformRequests.filter((entry) => entry.action === 'batch_sync').length === 2, 'manual: dedupe B/C não resultou em apenas um novo batch para E.');
    const terminalNavigations = navigations.length;
    const terminalRunnerCommands = runnerCommands.length;
    const terminalBatches = platformRequests.filter((entry) => entry.action === 'batch_sync').length;
    const virtualTimers = [];
    context.setTimeout = (callback, delay) => { virtualTimers.push({ callback, delay }); return virtualTimers.length; };
    const lastCommand = runnerCommands.at(-1);
    await dispatch({
      type: 'GMAPS_POC_RUN_FINISHED',
      data: { metadata: { phase: 'completed', searchSignature: 'terminal-repeat', operationalContext: lastCommand.operationalContext }, items: [], errors: [] },
    });
    assert(navigations.length === terminalNavigations && runnerCommands.length === terminalRunnerCommands, 'manual: callback terminal repetido reiniciou query/runner.');
    assert(platformRequests.filter((entry) => entry.action === 'batch_sync').length === terminalBatches, 'manual: callback terminal repetido criou batch duplicado.');
    assert(virtualTimers.length === 0, 'manual: combinação terminal agendou trabalho capaz de reiniciar durante a janela virtual de 60s.');
  }
  for (const event of ['execution_started', 'combination_selected', 'maps_navigation_started', 'maps_ready', 'scraper_started', 'scraper_finished', 'execution_completed']) {
    assert(diagnostics.some((entry) => entry.event === event), `${name}: log ${event} ausente.`);
  }
}

await runScenario('manual', [
  ...acceptanceFixture.terms.slice(0, 4).map((term, index) => coverage(`manual-${index + 1}`, acceptanceFixture.city, term, index + 1, {
    branchName: acceptanceFixture.branch,
    stateName: 'Minas Gerais',
    stateCode: acceptanceFixture.state,
  })),
], 'manual');

await runScenario('automatic', [
  coverage('auto-1', 'Mauá', 'Contabilidade', 1),
  coverage('auto-2', 'Mauá', 'Contador', 2),
  coverage('auto-3', 'Santo André', 'Contabilidade', 1),
  coverage('auto-4', 'Santo André', 'Contador', 2),
], 'automatic');

assert(!sidepanelSource.includes('chrome.windows.create') && !sidepanelSource.includes('chrome.tabs.create'), 'Start do Side Panel ainda cria aba/janela.');
assert(sidepanelSource.includes('tabId: currentMapsTab.id'), 'Side Panel não envia a aba Maps atual ao orquestrador.');
assert(operationalSource.includes("type: 'GMAPS_POC_SEARCH'") && contentSource.includes('waitForSearchInput') && contentSource.includes('mapsReady: layout.ready'), 'Start não altera a caixa de pesquisa e aguarda o contexto semântico real.');
assert(!operationalSource.includes('chrome.tabs.onUpdated.addListener') && !operationalSource.includes('chrome.tabs.update('), 'Orquestrador ainda depende de navegação de aba em vez da busca sequencial no campo do Maps.');
assert(operationalSource.includes('await launchCurrent(state, tab.id, false)'), 'Navegação não é dona do start determinístico da combinação.');
assert(contentSource.includes('await restorePromise'), 'Mensagem pode disputar com a restauração do checkpoint do runner.');
assert(runnerSource.includes('incomingCombinationId === currentCombinationId'), 'Runner ainda bloqueia silenciosamente uma nova combinação por checkpoint anterior.');
for (const state of ['idle', 'starting', 'navigating', 'waiting_maps_ready', 'scraping', 'finishing_search', 'syncing', 'next_search', 'paused', 'completed', 'error', 'stopped']) {
  assert(`${operationalSource}\n${sidepanelSource}`.includes(`'${state}'`) || `${operationalSource}\n${sidepanelSource}`.includes(`${state}:`), `Estado operacional ausente: ${state}.`);
}
for (const event of ['search_start_clicked', 'execution_started', 'combination_selected', 'maps_navigation_started', 'maps_ready', 'scraper_started', 'scraper_finished', 'batch_sync_started', 'batch_sync_confirmed', 'next_combination', 'execution_completed']) {
  assert(`${operationalSource}\n${sidepanelSource}`.includes(`'${event}'`), `Log diagnóstico ausente: ${event}.`);
}

if (failures.length) {
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('OK: execução Maps usa a mesma aba e percorre cidade→termos com ready, runner, sync e avanço automático.');
