import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

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
const app = read('src/App.tsx');
const pairApi = read('api/maps/pair.ts');
const platformApi = readExtension('src/platform-api.js');
const config = readExtension('src/config.js');
const sidepanel = readExtension('sidepanel.js');
const sidepanelHtml = readExtension('sidepanel.html');
const background = readExtension('background.js');
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };

const crmMatches = manifest.content_scripts.find((entry) => entry.js.includes('src/crm-bridge.js'))?.matches ?? [];
for (const match of [
  'https://crm-vinsansi-studio.vercel.app/*',
  'https://painel.samuelvinsansi.com.br/*',
  'http://localhost/*',
  'http://127.0.0.1/*',
  'https://localhost/*',
  'https://127.0.0.1/*',
]) assert(crmMatches.includes(match), `crm-bridge.js não é injetado em ${match}.`);
for (const host of ['https://crm-vinsansi-studio.vercel.app/*', 'https://painel.samuelvinsansi.com.br/*']) {
  assert(manifest.host_permissions.includes(host), `Manifest não permite o host ${host}.`);
}
assert(manifest.host_permissions.every((host) => host !== '<all_urls>'), 'Manifest abriu host global desnecessário.');
assert(manifest.background?.service_worker === 'background.js' && background.includes("importScripts('src/config.js', 'src/platform-api.js', 'src/operational.js')"), 'Service worker não carrega configuração, API e protocolo operacional em ordem segura.');
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
assert(!importPage.includes('maps-extension-diagnostic') && !importPage.includes('Enviar execução para extensão'), 'Bridge legado ainda aparece como requisito operacional da Importação.');
assert(app.includes('MapsExtensionAuthorizePage') && pairApi.includes("action === 'authorize'") && platformApi.includes('beginPairing') && platformApi.includes('exchangePairing'), 'Pairing API-first não substituiu o handshake contínuo na experiência ativa.');
assert(config.includes("platformBaseUrl: 'https://crm-vinsansi-studio.vercel.app'") && platformApi.includes('`${PLATFORM_BASE_URL}/api/maps`'), 'PLATFORM_BASE_URL não está centralizada no host operacional atual.');
assert(platformApi.includes("LEGACY_API_BASES = new Set(['https://painel.samuelvinsansi.com.br/api/maps'])") && platformApi.includes('chrome.storage.local.set({ [API_BASE_KEY]: resolved })'), 'Base legada armazenada não é migrada para o origin atual.');
assert(pairApi.includes("'https://crm-vinsansi-studio.vercel.app'"), 'URL de autorização ainda usa o domínio customizado como fallback atual.');
assert(sidepanelHtml.indexOf('src/config.js') < sidepanelHtml.indexOf('src/platform-api.js'), 'Side Panel carrega API antes da configuração central.');
for (const event of ['connect_clicked','pairing_request_started','pairing_request_failed','authorization_opened','exchange_started','connected']) {
  assert(`${platformApi}\n${sidepanel}\n${background}`.includes(event), `Diagnóstico seguro ausente: ${event}.`);
}
for (const code of ['platform_unreachable','pairing_endpoint_not_found','authorization_failed','invalid_api_response','platform_request_timeout','pairing_timeout']) {
  assert(`${platformApi}\n${sidepanel}`.includes(code), `Feedback de conexão ausente para ${code}.`);
}
assert(sidepanelHtml.includes('id="platformConnectionError"') && sidepanel.includes('showPlatformConnectionError(error)') && sidepanel.includes("button.textContent = 'Conectando…'"), 'Falha de pairing não fica visível junto ao estado de conexão.');
assert(platformApi.includes('AbortController') && platformApi.includes('REQUEST_TIMEOUT_MS'), 'Pairing não possui timeout explícito.');

const stored = { gmapsApiBaseV1: 'https://painel.samuelvinsansi.com.br/api/maps' };
const fetchCalls = [];
const openedTabs = [];
const runtimeContext = {
  AbortController,
  clearTimeout,
  console: { info() {}, error() {} },
  crypto: globalThis.crypto,
  fetch: async (url, init) => {
    fetchCalls.push({ url, init });
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        ok: true,
        pairingId: 'pairing-test',
        pairingSecret: 'pairing-secret-test',
        authorizationUrl: 'https://crm-vinsansi-studio.vercel.app/maps-extension-authorize?maps_pairing=pairing-test',
      }),
    };
  },
  setTimeout,
  chrome: {
    storage: { local: {
      async get(key) { return { [key]: stored[key] }; },
      async set(patch) { Object.assign(stored, patch); },
      async remove(key) { delete stored[key]; },
    } },
    runtime: { sendMessage: async () => ({ ok: true }) },
    tabs: { async create(input) { openedTabs.push(input); return { id: 7, ...input }; } },
  },
};
runtimeContext.globalThis = runtimeContext;
vm.runInNewContext(config, runtimeContext, { filename: 'src/config.js' });
vm.runInNewContext(platformApi, runtimeContext, { filename: 'src/platform-api.js' });
await runtimeContext.GMAPS_PLATFORM_API.beginPairing();
assert(fetchCalls[0]?.url === 'https://crm-vinsansi-studio.vercel.app/api/maps/pair', 'Clique Conectar não chama o endpoint Vercel esperado.');
assert(openedTabs[0]?.url === 'https://crm-vinsansi-studio.vercel.app/maps-extension-authorize?maps_pairing=pairing-test', 'Pairing não abre a URL de autorização retornada pela plataforma.');
assert(stored.gmapsApiBaseV1 === 'https://crm-vinsansi-studio.vercel.app/api/maps', 'Base legada armazenada não foi migrada no runtime.');

const sensitive = `${manifestText}\n${bridge}\n${operational}\n${service}\n${platformApi}\n${config}\n${sidepanel}\n${background}`;
for (const forbidden of ['SUPABASE_SERVICE_ROLE', 'WORKER_INTERNAL_TOKEN', 'EVOLUTION_API_KEY', 'INSTAGRAM_EXTENSION_SIGNING_SECRET', 'GMAPS_EXTENSION_SIGNING_SECRET']) {
  assert(!sensitive.includes(forbidden), `Handshake contém secret proibido: ${forbidden}.`);
}
assert(!/apify/i.test(`${bridge}\n${operational}\n${service}`), 'Handshake reintroduziu Apify.');

if (failures.length) {
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('OK: pairing API-first está ativo e bridge/PING/PONG permanecem apenas como compatibilidade sem extensionId fixo.');
