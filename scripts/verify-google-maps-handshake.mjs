import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const extensionRoot = path.resolve(root, '..', 'google maps extractor');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const readExtension = (file) => fs.readFileSync(path.join(extensionRoot, file), 'utf8');
const manifestText = readExtension('manifest.json');
const manifest = JSON.parse(manifestText);
const bridge = readExtension('src/crm-bridge.js');
const operational = readExtension('src/operational.js');
const service = read('src/services/google-maps-extension/googleMapsExtension.service.ts');
const importPage = read('src/pages/ImportPage.tsx');
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };

const crmMatches = manifest.content_scripts.find((entry) => entry.js.includes('src/crm-bridge.js'))?.matches ?? [];
for (const match of [
  'https://painel.samuelvinsansi.com.br/*',
  'http://localhost/*',
  'http://127.0.0.1/*',
  'https://localhost/*',
  'https://127.0.0.1/*',
]) assert(crmMatches.includes(match), `crm-bridge.js não é injetado em ${match}.`);
assert(manifest.background?.service_worker === 'background.js' && readExtension('background.js').includes("importScripts('src/operational.js')"), 'Service worker não carrega o protocolo operacional.');
assert(!manifest.externally_connectable, 'Handshake sem ID passou a depender de externally_connectable sem necessidade.');
assert(!/extensionId|extension_id|[a-p]{32}/i.test(service + bridge), 'CRM/bridge contém extensionId local hardcoded.');

assert(service.includes("type: 'GMAPS_EXTENSION_PING'") && operational.includes("type: 'GMAPS_EXTENSION_PONG'"), 'Handshake PING/PONG está incompleto.');
assert(operational.includes('extensionVersion: EXTENSION_VERSION') && operational.includes('operationalAvailable: true') && operational.includes('configured: state.configured'), 'PONG não expõe o contrato mínimo.');
assert(service.indexOf('await pingExtension();') < service.indexOf("type: 'GMAPS_OPERATIONAL_CONFIGURE', execution"), 'CRM configura antes de receber PONG.');
assert(operational.includes("type: 'GMAPS_OPERATIONAL_CONFIGURE_ACK'") && operational.includes('executionId: state.executionId') && operational.includes('configured: true'), 'Background não envia ACK explícito do configure.');
assert(service.includes("response.type !== 'GMAPS_OPERATIONAL_CONFIGURE_ACK'") && service.includes('response.executionId !== execution.executionId'), 'CRM aceita ACK não correlacionado ao executionId.');

assert(bridge.includes("type: 'bridge_ready'") && bridge.includes('announceBridge();'), 'Content script não anuncia que a bridge foi carregada.');
assert(bridge.includes('chrome.runtime.sendMessage(message.payload)') && bridge.includes("code: 'extension_runtime_unavailable'"), 'Bridge não encaminha mensagens ou não diferencia falha do runtime.');
assert(service.includes("'bridge_unavailable'") && service.includes("'extension_version_incompatible'") && service.includes('operational_execution_in_progress_or_unsynced'), 'CRM não diferencia timeout, versão e execução ativa.');
assert(service.includes('PING_TIMEOUT_MS') && service.includes('REQUEST_TIMEOUT_MS') && service.includes('window.removeEventListener'), 'Timeout do handshake/configure não é explícito ou não limpa listener.');
assert(importPage.includes('maps-extension-diagnostic') && importPage.includes('Extensão detectada') && importPage.includes('Bridge ativa') && importPage.includes('Último ping') && importPage.includes('Último erro'), 'CRM não apresenta o diagnóstico local do handshake.');

const sensitive = `${manifestText}\n${bridge}\n${operational}\n${service}`;
for (const forbidden of ['SUPABASE_SERVICE_ROLE', 'WORKER_INTERNAL_TOKEN', 'EVOLUTION_API_KEY', 'INSTAGRAM_EXTENSION_SIGNING_SECRET']) {
  assert(!sensitive.includes(forbidden), `Handshake contém secret proibido: ${forbidden}.`);
}
assert(!/apify/i.test(`${bridge}\n${operational}\n${service}`), 'Handshake reintroduziu Apify.');

if (failures.length) {
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('OK: bridge CRM, PING/PONG, versão, configure ACK, diagnósticos e erros explícitos foram validados sem extensionId fixo.');
