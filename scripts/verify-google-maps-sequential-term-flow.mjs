import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd(), '..', 'google maps extractor');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const operational = read('src/operational.js');
const content = read('src/content.js');
const sidepanel = read('sidepanel.js');
const manifest = JSON.parse(read('manifest.json'));
const api = fs.readFileSync(path.resolve(process.cwd(), 'api/maps/extension.ts'), 'utf8');
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };

assert(manifest.version === '0.14.0', 'Manifest não está na versão sequencial 0.14.0.');
assert(operational.includes("type: 'GMAPS_POC_SEARCH'") && operational.includes('query: combo.searchQuery'), 'Orquestrador não pesquisa o termo atual pela caixa do Maps.');
assert(!operational.includes('chrome.tabs.update('), 'Fluxo operacional ainda navega por URL em vez de usar a caixa de pesquisa.');
assert(!operational.includes('chrome.windows.create('), 'Fluxo operacional ainda cria janela.');
assert(content.includes("'#searchboxinput'") && content.includes('waitForSearchInput') && content.includes('setNativeInputValue'), 'Content script não possui busca robusta pelo searchbox.');
assert(content.includes('navigationToken') && operational.includes('combo.navigationToken = crypto.randomUUID()'), 'Busca sequencial não correlaciona termo solicitado e readiness.');
assert(api.includes('coverageCreation: \'lazy_one_term_at_a_time\''), 'API não declara cobertura lazy por termo.');
assert(api.includes('async function createCoverageTerm('), 'API não cria cobertura unitária por termo.');
assert(api.includes('async function nextCoverageForCity('), 'API não seleciona próximo termo da cidade de forma sequencial.');
assert(!api.includes('async function createCoverageForCity('), 'API ainda cria todos os termos da cidade antecipadamente.');
assert(api.includes('const sameCityNext = await nextCoverageForCity('), 'Fim de uma busca não pede o próximo subramo da mesma cidade.');
assert(api.includes('next = await nextCoverage(client, execution)'), 'Depois de zerar termos da cidade, API não avança para a próxima cidade.');
assert(api.includes("execution.city_mode !== 'manual'"), 'Modo automático não diferencia cobertura histórica do rerun manual.');
assert(sidepanel.includes('`Termo ${current.termPosition || current.position || 1} / ${termTotal}`'), 'Side Panel não expõe progresso termo a termo.');

if (failures.length) {
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log('OK: fluxo Maps é sequencial cidade → ramo → subramos → próxima cidade, um termo por vez.');
