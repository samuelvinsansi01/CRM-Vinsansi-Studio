import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const extensionRoot = path.resolve(root, '..', 'google maps extractor');
const read = (file) => fs.readFileSync(path.join(extensionRoot, file), 'utf8');
const html = read('sidepanel.html');
const panel = read('sidepanel.js');
const operational = read('src/operational.js');
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };

assert(!html.includes('createSearchBtn') && !html.includes('Criar pesquisa'), 'A ação manual Criar pesquisa ainda está visível.');
assert((html.match(/id="startBtn"/g) || []).length === 1 && html.includes('>Iniciar pesquisa</button>'), 'A UI não possui exatamente um start principal.');
assert(!panel.includes("$('createSearchBtn')") && (panel.match(/request\('search_create'/g) || []).length === 1, 'Criação da execução não foi internalizada em um único caminho.');

const handler = panel.slice(panel.indexOf("$('startBtn').addEventListener"), panel.indexOf("$('pauseBtn').addEventListener"));
assert(handler.includes('if (startInFlight) return') && handler.indexOf('startInFlight = true') < handler.indexOf('await prepareOperationalExecution()'), 'Clique duplo não é bloqueado antes do primeiro await.');
assert(handler.includes('await prepareOperationalExecution()') && handler.includes("type: 'GMAPS_OPERATIONAL_START'"), 'Start único não prepara e inicia em sequência.');
assert(handler.indexOf('await prepareOperationalExecution()') < handler.indexOf('await mapsTab()') && handler.indexOf('await mapsTab()') < handler.indexOf("type: 'GMAPS_OPERATIONAL_START'"), 'Start não preserva a ordem criar/configurar → vincular aba → iniciar.');
assert(handler.includes('finally') && handler.includes('startInFlight = false'), 'Trava do start não é liberada deterministicamente.');
assert(handler.includes("operationalState?.status === 'completed'") && handler.includes("type: 'GMAPS_OPERATIONAL_RESET'"), 'Estado concluído não oferece Nova pesquisa sem apagar o histórico remoto.');

for (const validation of ['platformSession?.token', 'Selecione um Ramo', 'Selecione um Estado', 'Selecione uma Cidade ou Automático', 'entre 1 e 7', 'Modo de extração válido']) {
  assert(panel.includes(validation), `Validação pré-start ausente: ${validation}.`);
}
assert(panel.includes("const PENDING_START_KEY = 'gmapsPendingApiExecutionV1'") && panel.includes('apiExecution: execution'), 'executionId criado antes de falha não é preservado localmente.');
assert(panel.includes("request('next_search'") && panel.includes('pending.apiExecution.maps_search_executions_id'), 'Preparação interrompida pode criar outra execução em vez de recuperar a anterior.');
assert(panel.indexOf('apiExecution: execution') < panel.indexOf('if (!pending.execution)'), 'Execução sem primeira cobertura não é persistida antes do erro.');

for (const label of ['Preparando…', 'Navegando', 'Extraindo', 'Pausar', 'Continuar', 'Parar', 'Nova pesquisa']) {
  assert(`${html}\n${panel}`.includes(label), `Estado/controle visual ausente: ${label}.`);
}
assert(panel.includes("$('pauseBtn').hidden = !running") && panel.includes("$('resumeBtn').hidden = !paused") && panel.includes("$('stopBtn').hidden = !(running || paused)"), 'Controles visuais running/paused não são mutuamente coerentes.');
assert(panel.includes("$('configurationEditor').hidden = configured") && panel.includes("$('configurationSummary').hidden = !configured"), 'Configuração não recolhe durante execução.');
assert(operational.includes("chrome.storage.local.remove(STORAGE_KEY)") && !operational.includes("GMAPS_PLATFORM_API.request('search_delete'"), 'Nova pesquisa apaga estado remoto ou não limpa apenas o checkpoint local.');
assert(!panel.includes('chrome.windows.create') && !panel.includes('chrome.tabs.create'), 'Start único voltou a abrir nova aba/janela.');

if (failures.length) {
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('OK: um clique valida, cria/configura, preserva executionId e inicia na mesma aba sem duplicação.');
