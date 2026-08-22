import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const apiRoot = path.join(root, 'api');
const expect = (condition, message) => { if (!condition) throw new Error(message); };
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const expectedFunctions = ['instagram.ts', 'maps.ts', 'organization.ts', 'system.ts', 'tools.ts', 'whatsapp.ts'];
const functions = walk(apiRoot)
  .filter((file) => /\.(?:js|ts)$/.test(file) && !file.endsWith('.d.ts'))
  .map((file) => path.relative(apiRoot, file).replaceAll('\\', '/'))
  .sort();
expect(functions.length <= 8, `Vercel Hobby excedido: ${functions.length} Functions encontradas (${functions.join(', ')}).`);
expect(JSON.stringify(functions) === JSON.stringify(expectedFunctions), `Superfície Vercel divergente: ${functions.join(', ')}.`);

const domains = [
  { entrypoint: 'tools', source: '/api/tools/executor/:action', destination: '/api/tools?route=executor/:action', routes: ['executor/config','executor/context','executor/heartbeat','executor/logout','executor/pair-exchange','executor/pair-start','executor/runtime','executor/switch'] },
  { entrypoint: 'maps', source: '/api/maps/:action', destination: '/api/maps?route=:action', routes: ['extension','pair'] },
  { entrypoint: 'instagram', source: '/api/instagram/:action', destination: '/api/instagram?route=:action', routes: ['extension','pair'] },
  { entrypoint: 'whatsapp', source: '/api/whatsapp/:action', destination: '/api/whatsapp?route=:action', routes: ['batch','dispatch','revalidate','validate','conversations','conversation-messages','conversation-action','conversation-members','conversation-presence','manual-message','conversation-media','queue-operations'] },
  { entrypoint: 'organization', source: '/api/organization/:action', destination: '/api/organization?route=:action', routes: ['invitations'] },
  { entrypoint: 'system', source: '/api/desktop/:action', destination: '/api/system?route=desktop/:action', routes: ['desktop/evolution-instances','desktop/worker-provision'] },
  { entrypoint: 'system', source: '/api/chat/:action', destination: '/api/system?route=chat/:action', routes: ['chat/send'] },
];

const vercel = JSON.parse(read('vercel.json'));
for (const domain of domains) {
  const rewrite = vercel.rewrites?.find((item) => item.source === domain.source);
  expect(rewrite?.destination === domain.destination, `Rewrite ausente/divergente: ${domain.source}.`);
}

const routerFiles = {
  tools: 'server/routes/tools/router.ts',
  maps: 'server/routes/maps/router.ts',
  instagram: 'server/routes/instagram/router.ts',
  whatsapp: 'server/routes/whatsapp/router.ts',
  organization: 'server/routes/organization/router.ts',
  system: 'server/routes/system/router.ts',
};
for (const domain of domains) {
  const source = read(routerFiles[domain.entrypoint]);
  for (const route of domain.routes) expect(source.includes(route.includes('/') ? `'${route}'` : route), `Router ${domain.entrypoint} sem ${route}.`);
}

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'vinsansi-vercel-routes-'));
try {
  const loaded = new Map();
  for (const entrypoint of expectedFunctions.map((file) => file.replace(/\.ts$/, ''))) {
    const outfile = path.join(temporary, `${entrypoint}.mjs`);
    await build({ entryPoints: [path.join(apiRoot, `${entrypoint}.ts`)], outfile, bundle: true, platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent' });
    loaded.set(entrypoint, (await import(`${pathToFileURL(outfile).href}?v=${Date.now()}`)).default);
  }

  const invoke = async (entrypoint, route, method, body = {}) => {
    const state = { status: 200, body: undefined, ended: false, headers: {} };
    const response = {
      status(code) { state.status = code; return this; },
      json(payload) { state.body = payload; },
      setHeader(name, value) { state.headers[String(name).toLowerCase()] = value; },
      end() { state.ended = true; },
    };
    await loaded.get(entrypoint)({ method, body, headers: {}, query: { route } }, response);
    return state;
  };

  const publicRoutes = [];
  for (const domain of domains) {
    for (const route of domain.routes) {
      const state = await invoke(domain.entrypoint, route, 'TRACE');
      expect(state.status === 405, `Smoke local não alcançou ${domain.entrypoint}:${route}; status ${state.status}.`);
      const publicPath = domain.source.replace(':action', route.split('/').at(-1));
      publicRoutes.push(publicPath);
    }
  }
  expect(publicRoutes.length === 28, `Matriz pública incompleta: ${publicRoutes.length}/28.`);

  const contextWithoutSession = await invoke('tools', 'executor/context', 'GET');
  expect(contextWithoutSession.status === 401 && contextWithoutSession.body?.error === 'user_session_required', 'Contexto executor não preservou autenticação humana.');
  const heartbeatWithoutCredential = await invoke('tools', 'executor/heartbeat', 'POST', { version: 'test', capabilities: [] });
  expect(heartbeatWithoutCredential.status === 401 && heartbeatWithoutCredential.body?.error === 'installation_credential_required', 'Heartbeat não preservou credencial técnica.');
  const instagramPairWithoutSession = await invoke('instagram', 'pair', 'POST', { profile_username: 'homologacao', organizationId: 1 });
  expect(instagramPairWithoutSession.status === 401 && instagramPairWithoutSession.body?.error === 'auth_required', 'Pairing Instagram não preservou autenticação humana.');
  const instagramContextWithoutSession = await invoke('instagram', 'extension', 'POST', { action: 'queue', profile_username: 'homologacao' });
  expect(instagramContextWithoutSession.status === 401 && instagramContextWithoutSession.body?.error === 'user_session_required', 'Runtime Instagram não preservou contexto/sessão humana.');
  const conversationsWithoutSession = await invoke('whatsapp', 'conversations', 'GET');
  expect(conversationsWithoutSession.status === 401 && conversationsWithoutSession.body?.error === 'auth_required', 'Conversas não preservaram autenticação humana.');
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

console.log(`Vercel Hobby: ${functions.length} Functions e 28 rotas públicas consolidadas; smoke local aprovado.`);
