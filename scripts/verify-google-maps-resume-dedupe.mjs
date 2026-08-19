import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = process.cwd();
const extensionRoot = path.resolve(root, '..', 'google maps extractor');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const readExtension = (file) => fs.readFileSync(path.join(extensionRoot, file), 'utf8');
const fixture = JSON.parse(read('scripts/fixtures/google-maps-resume-dedupe.json'));
const runnerSource = readExtension('src/runner.js');
const operationalSource = readExtension('src/operational.js');
const utilsSource = readExtension('src/utils.js');
const detailSource = readExtension('src/detail-extractor.js');
const apiSource = read('api/maps/extension.ts');
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };
const waitUntil = async (predicate, message) => {
  for (let index = 0; index < 200; index += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error(message);
};

const normalize = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const termsFor = (branch, subcategories) => {
  const seen = new Set();
  return [branch, ...subcategories].filter((term) => { const key = normalize(term); if (!key || seen.has(key)) return false; seen.add(key); return true; });
};
const normalizedTerms = [...new Set(fixture.terms.map(normalize))];
assert(normalizedTerms.length === 4 && normalizedTerms[0] === 'moveis planejados', 'Ramo principal e três subramos não removem duplicatas normalizadas.');
assert(termsFor(fixture.branch, []).length === 1, 'Zero subramos não resulta somente no ramo principal.');
assert(termsFor(fixture.branch, ['Marcenaria Planejada']).length === 2, 'Um subramo não resulta em ramo principal seguido do único subramo.');
assert(termsFor(fixture.branch, ['A', 'B', 'C']).join(',') === `${fixture.branch},A,B,C`, 'N subramos não preservam ramo principal seguido de todos os N termos.');
assert(apiSource.includes('function strings(value: unknown): string[]') && apiSource.includes('if (!key || seen.has(key)) return false'), 'API não preserva o contrato 0/1/N com dedupe normalizado de termos.');
assert(apiSource.includes("hostname === 'facebook.com' || hostname.endsWith('.facebook.com')") && apiSource.includes("return ''"), 'Facebook ainda pode ser promovido ao campo website pela API.');
assert(utilsSource.includes("return { kind: 'facebook', href }") && detailSource.includes("provider === 'facebook' ? 'facebook'"), 'Extrator local ainda classifica Facebook como website.');
assert(operationalSource.includes('processedCountBase: state.items.length') && operationalSource.includes('processedKeys: state.items.map'), 'Orquestrador não entrega dedupe/contagem acumulada ao runner antes do detalhe.');
assert(operationalSource.includes("['completed', 'exhausted'].includes(combo.status)") && operationalSource.includes("'terminal_combination_ignored'"), 'Combinação terminal não possui guard explícito contra callback repetido.');
assert(operationalSource.includes("finishApiFirstCombination(state, combo, message, 'paused')") && operationalSource.includes("state.pauseReason = 'scraper_error'"), 'Erro retomável do scraper não deixa a execução pausada.');
assert(operationalSource.includes("metadata.phase === 'error'") && operationalSource.includes("metadata.mode === 'complete'") && operationalSource.includes("item?.detailProcessed === true"), 'Snapshot parcial pode promover C/D antes de serem processados.');

const utilsContext = vm.createContext({ URL, location: { href: 'https://www.google.com/maps/' }, GMAPS_POC: {}, globalThis: null });
utilsContext.globalThis = utilsContext;
vm.runInContext(utilsSource, utilsContext, { filename: 'src/utils.js' });
assert(utilsContext.GMAPS_POC.utils.classifyOutboundUrl(fixture.facebookLink).kind === 'facebook', 'Classificador real não preserva Facebook fora de website.');

let currentRows = fixture.firstCombination;
let crashBeforeC = true;
let crashDelivered = false;
let currentItem = null;
const detailOpens = [];
const notifications = [];
let checkpoint = null;

const links = () => currentRows.map((row) => ({
  href: `https://www.google.com/maps/place/${row.name}?cid=${row.cid}`,
  getAttribute(name) { return name === 'aria-label' ? row.name : null; },
  removeAttribute() {}, setAttribute() {}, scrollIntoView() {},
  click() { currentItem = row; detailOpens.push(row.name); },
}));
const feed = { innerText: 'Você chegou ao final da lista.', scrollHeight: 900, clientHeight: 450, scrollTop: 0, dispatchEvent() {} };
const makeKey = (item) => item.placeId || item.mapsDataId || item.cid || item.googleMapsUrl || [item.name, item.address, item.phone].map(normalize).join('|');
const context = vm.createContext({
  console, Date, URL, Event: class Event {},
  location: { href: 'https://www.google.com/maps/search/?api=1&query=fixture', pathname: '/maps/search/', search: '?api=1&query=fixture' },
  document: { title: 'Google Maps fixture', body: { innerText: feed.innerText } },
  chrome: { runtime: { async sendMessage(message) { notifications.push(structuredClone(message)); return { ok: true }; } } },
  GMAPS_POC: {
    CONFIG: {
      version: 'fixture', checkpointEveryMs: 0, endPhrases: ['você chegou ao final da lista'], scrollWaitMs: 0,
      maxStagnantRounds: 1, detailVisibleGuard: 100, detailListPasses: 1, detailListScanWaitMs: 0,
      detailListStepRatio: 0.5, inlineCardSeekMaxRounds: 2, inlineCardSeekWaitMs: 0,
      inlinePanelOpenTimeoutMs: 10, inlinePanelCloseTimeoutMs: 10,
    },
    utils: {
      sleep: async () => {}, makeDedupeKey: makeKey, normalizeText: normalize,
      extractStableId: (href) => ({ placeId: null, mapsDataId: null, cid: new URL(href).searchParams.get('cid'), kgmid: null }),
      canonicalMapsUrl: (value) => value || null, visible: () => true,
    },
    storage: {
      async saveCheckpoint(value) { checkpoint = structuredClone(value); },
      async loadCheckpoint() { return checkpoint ? structuredClone(checkpoint) : null; },
    },
    diagnostics: {
      collect: () => ({ fixture: true }), locateFeed: () => feed, detectNoResults: () => false,
      placeLinks: () => {
        if (crashBeforeC && detailOpens.length === 2 && !crashDelivered) {
          crashDelivered = true;
          throw new Error('fixture_dom_interrupted_before_c');
        }
        return links();
      },
    },
    extractor: { extractCard: (link) => ({ ...structuredClone(currentRows.find((row) => row.cid === new URL(link.href).searchParams.get('cid'))), googleMapsUrl: link.href }) },
    detailExtractor: {
      waitUntilReady: async () => true,
      extractCurrent: async () => ({
        ...structuredClone(currentItem), detailProcessed: true, website: null, websiteSource: null,
        publicLinks: currentItem.name === 'A' ? [{ kind: 'facebook', url: fixture.facebookLink }] : [],
        webResults: currentItem.name === 'A' ? [{ kind: 'website', provider: 'facebook', url: fixture.facebookLink }] : [],
      }),
      closeCandidates: () => [{ el: { click() {} } }], waitUntilClosed: async () => true,
    },
  },
});
context.globalThis = context;
vm.runInContext(runnerSource, context, { filename: 'src/runner.js' });
const runner = context.GMAPS_POC.runner;

await runner.start('complete', { executionId: 'acceptance', combinationId: 'main', processedCountBase: 0, processedKeys: [] });
await waitUntil(() => runner.publicState().phase === 'error', 'Runner não chegou ao erro controlado antes de C.').catch((error) => {
  console.error({ state: runner.publicState(), detailOpens, checkpoint, errors: checkpoint?.errorLog });
  throw error;
});
const interrupted = runner.getData();
assert(interrupted.metadata.stats.processed === 2, 'Processadas não permaneceu em 2 após a interrupção.');
assert(detailOpens.join(',') === 'A,B', 'A/B não foram os únicos detalhes abertos antes da interrupção.');
assert(interrupted.items.filter((item) => item.detailProcessed).map((item) => item.name).join(',') === 'A,B', 'Checkpoint não preservou A/B como processados.');
assert(new Set(checkpoint.processedKeys).has('A') && new Set(checkpoint.processedKeys).has('B'), 'processedKeys de A/B não foram persistidos no checkpoint.');
assert(interrupted.items.find((item) => item.name === 'A').website == null && interrupted.items.find((item) => item.name === 'A').publicLinks[0].kind === 'facebook', 'Facebook vazou para website ou não permaneceu no dado bruto/público.');

await new Promise((resolve) => setTimeout(resolve, 20));
assert(detailOpens.join(',') === 'A,B' && runner.publicState().phase === 'error', 'Erro retomou automaticamente sem ação do usuário.');
crashBeforeC = false;
await runner.resume();
await waitUntil(() => runner.publicState().phase === 'completed', 'Continuar não concluiu C/D.');
const resumed = runner.getData();
assert(detailOpens.join(',') === 'A,B,C,D', 'Continuar reabriu A/B ou deixou de processar C/D.');
assert(resumed.metadata.stats.processed === 4, 'processedCount não cresceu monotonicamente de 2 para 4.');
assert(['A','B','C','D'].every((key) => checkpoint.processedKeys.includes(key)), 'Checkpoint final não contém todas as processedKeys.');

currentRows = fixture.secondCombination;
currentItem = null;
await runner.start('complete', { executionId: 'acceptance', combinationId: 'subcategory-1', processedCountBase: 4, processedKeys: ['A','B','C','D'] });
await waitUntil(() => runner.publicState().phase === 'completed', 'Subramo seguinte não concluiu.');
const second = runner.getData();
assert(detailOpens.join(',') === 'A,B,C,D,E', 'B/C foram reabertos no subramo seguinte ou E não foi processado.');
assert(second.items.filter((item) => item._executionDuplicate).map((item) => item.name).join(',') === 'B,C', 'B/C não foram reconhecidos antes do detalhe como duplicatas da execução.');
assert(second.metadata.stats.processed === 5, 'Contagem processada acumulada não chegou monotonicamente a 5 únicos.');
const uniqueLeadKeys = new Set([...resumed.items, ...second.items].map(makeKey));
assert([...uniqueLeadKeys].sort().join(',') === 'A,B,C,D,E', 'A aba Leads conceitual não resulta em A/B/C/D/E únicos.');

const notificationCount = notifications.length;
await new Promise((resolve) => setTimeout(resolve, 20));
assert(runner.publicState().phase === 'completed' && notifications.length === notificationCount, 'Runner terminal reiniciou ou notificou novamente sem comando.');

if (failures.length) {
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log('OK: pausa/retomada preserva processedKeys, dedupe ocorre antes do detalhe, Facebook não vira website e o runner terminal não reinicia.');
