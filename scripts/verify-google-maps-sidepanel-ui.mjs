import fs from 'node:fs';
import path from 'node:path';

const extensionRoot = path.resolve(process.cwd(), '..', 'google maps extractor');
const read = (file) => fs.readFileSync(path.join(extensionRoot, file), 'utf8');
const html = read('sidepanel.html');
const css = read('sidepanel.css');
const panel = read('sidepanel.js');
const operational = read('src/operational.js');
const bridge = read('src/crm-bridge.js');
const manifestText = read('manifest.json');
const manifest = JSON.parse(manifestText);
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };

const requiredIds = [
  'manualPanel', 'operationalPanel', 'modeEyebrow', 'opExecutionStatus', 'opBranch',
  'opExecutionId', 'opSubcategory', 'opLocation', 'opCombination', 'opSubcategories',
  'opLocations', 'opCompleted', 'opRemaining', 'opExhausted', 'opCurrentStatus',
  'opWhatsapp', 'opInstagram', 'opTotal', 'opAccepted', 'opRejected', 'opDuplicates',
  'opConfirmedBatches', 'opPendingBatches', 'opPendingEvents', 'opCrmState', 'opSyncReason',
  'startBtn', 'pauseBtn', 'resumeBtn', 'stopBtn', 'syncBtn', 'jsonBtn', 'csvBtn', 'diagBtn',
];
for (const id of requiredIds) {
  assert(html.includes(`id="${id}"`), `Side Panel não declara #${id}.`);
  assert(panel.includes(`$('${id}')`) || ['manualPanel', 'operationalPanel'].includes(id), `Side Panel não renderiza/controla #${id}.`);
}

assert(html.includes('Sem execução do CRM') && html.includes('Modo manual'), 'Estado sem execução CRM não está visível.');
assert(html.includes('Execução CRM') && html.includes('Busca atual') && html.includes('Sincronização'), 'Modo operacional não possui suas seções explícitas.');
assert(panel.includes("configured ? 'EXECUÇÃO CRM' : 'MODO MANUAL'") && panel.includes("$('manualPanel').hidden = configured"), 'UI não alterna deterministicamente entre manual e operacional.');
assert(panel.includes("chrome.runtime.sendMessage({ type: 'GMAPS_OPERATIONAL_STATE' })"), 'Side Panel não solicita o snapshot operacional central.');
assert(/GMAPS_POC_PING'[\s\S]{0,300}render\(r\.state\)/.test(panel), 'Ping do scraper não atualiza métricas manuais separadamente.');
assert(!/GMAPS_POC_PING'[\s\S]{0,300}renderActionState\(r\.state\)/.test(panel), 'Estado genérico do scraper pode sobrescrever e ocultar o snapshot CRM.');
assert(panel.includes('chrome.storage.onChanged.addListener') && panel.includes('changes.gmapsOperationalExecutionV1'), 'Side Panel não reage em tempo real ao checkpoint operacional.');
assert(panel.includes('timer = setInterval(refreshMaps, 1000)') && !panel.includes('setInterval(refreshOperational'), 'Estado operacional voltou a depender de polling periódico.');
assert(operational.includes("const STORAGE_KEY = 'gmapsOperationalExecutionV1'") && operational.includes('function getOperationalUiSnapshot(state)'), 'Snapshot central não lê o checkpoint canônico.');
assert(operational.includes('normalizeOperationalState') && operational.includes('Array.isArray(sync.pendingEvents)'), 'Checkpoint legado pode voltar a impedir a renderização.');
assert(operational.includes("ready: 'Configurada'") && operational.includes("completed: 'Concluída'") && operational.includes("paused: 'Pausada'"), 'Snapshot não cobre configurada, concluída e pausada.');
assert(operational.includes('confirmedBatches') && operational.includes('pendingBatches') && operational.includes('crmStateLabel'), 'Snapshot não expõe o contrato visual de sincronização.');
assert(css.includes('.operational-group') && css.includes('.sync-reason') && css.includes('.configuration-preview'), 'Estilos operacionais não cobrem configuração, métricas e motivo de sync.');
assert(bridge.includes('chrome.runtime.sendMessage(message.payload)') && bridge.includes("message.type !== 'request'"), 'Bridge CRM → extensão não encaminha a configuração operacional recebida.');
assert(manifest.name === 'Captação Google Maps' && manifest.version === '0.12.0', 'Manifest carregável ainda expõe identificação de POC ou versão anterior.');

const finalUx = `${html}\n${manifestText}`;
assert(!/POC INDEPENDENTE|Google Maps Extractor POC/i.test(finalUx), 'Linguagem de POC permanece na UX final.');
assert(!/apify/i.test(`${html}\n${panel}\n${operational}\n${bridge}`), 'Apify reapareceu no Side Panel operacional.');
for (const secret of ['SUPABASE_SERVICE_ROLE', 'WORKER_INTERNAL_TOKEN', 'EVOLUTION_API_KEY', 'INSTAGRAM_EXTENSION_SIGNING_SECRET']) {
  assert(!`${html}\n${panel}\n${operational}\n${bridge}`.includes(secret), `Secret proibido apareceu na extensão: ${secret}.`);
}

if (failures.length) {
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('OK: Side Panel distingue modo manual/CRM, renderiza a operação completa e acompanha o checkpoint por evento de storage.');
