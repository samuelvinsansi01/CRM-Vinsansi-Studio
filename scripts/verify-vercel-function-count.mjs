import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const apiRoot = path.join(root, 'api');
const functionExtensions = new Set(['.js', '.mjs', '.cjs', '.ts']);
const expectedRoutes = [
  '/api/chat/send',
  '/api/desktop/worker-provision',
  '/api/instagram/extension',
  '/api/instagram/pair',
  '/api/maps/extension',
  '/api/maps/pair',
  '/api/whatsapp/batch',
  '/api/whatsapp/dispatch',
  '/api/whatsapp/revalidate',
  '/api/whatsapp/validate',
];

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => entry.isDirectory()
      ? walk(path.join(directory, entry.name))
      : [path.join(directory, entry.name)]);
}

const entrypoints = walk(apiRoot)
  .filter((file) => functionExtensions.has(path.extname(file)) && !file.endsWith('.d.ts'))
  .map((file) => {
    const relative = path.relative(root, file).replaceAll('\\', '/');
    const route = `/${relative.replace(/\.(?:[cm]?js|ts)$/i, '')}`;
    return { file: relative, route, source: fs.readFileSync(file, 'utf8') };
  })
  .sort((left, right) => left.route.localeCompare(right.route));

const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };
const routes = entrypoints.map(({ route }) => route);

for (const entrypoint of entrypoints) {
  console.log(`FUNCTION ${entrypoint.file} -> ${entrypoint.route}`);
  assert(/export\s+default\s+async\s+function\s+handler\b/.test(entrypoint.source), `${entrypoint.file} nao exporta o handler publico esperado.`);
}

assert(JSON.stringify(routes) === JSON.stringify(expectedRoutes), `Rotas fisicas divergentes. Esperado: ${expectedRoutes.join(', ')}.`);
assert(entrypoints.length <= 12, `Hobby permite no maximo 12 Functions; detectadas ${entrypoints.length}.`);

for (const helper of [
  'api/instagram/identity.ts',
  'api/instagram/token.ts',
  'api/maps/shared.ts',
  'api/maps/token.ts',
  'api/whatsapp/validation.handler.ts',
]) {
  assert(!fs.existsSync(path.join(root, helper)), `${helper} voltou a ser contabilizado como Function.`);
}

for (const helper of [
  'server/instagram/identity.ts',
  'server/instagram/token.ts',
  'server/maps/shared.ts',
  'server/maps/token.ts',
  'server/whatsapp/validation.handler.ts',
]) {
  assert(fs.existsSync(path.join(root, helper)), `Helper server-side ausente: ${helper}.`);
}

const mapsSources = entrypoints.filter(({ route }) => route.startsWith('/api/maps/')).map(({ source }) => source).join('\n');
const instagramSources = entrypoints.filter(({ route }) => route.startsWith('/api/instagram/')).map(({ source }) => source).join('\n');
const validationSources = entrypoints.filter(({ route }) => ['/api/whatsapp/validate', '/api/whatsapp/revalidate'].includes(route)).map(({ source }) => source).join('\n');
assert(mapsSources.includes('../../server/maps/') && !mapsSources.includes('../../server/instagram/') && !mapsSources.includes('../../server/whatsapp/'), 'Entrypoints Maps atravessam boundary de outro dominio.');
assert(instagramSources.includes('../../server/instagram/') && !instagramSources.includes('../../server/maps/') && !instagramSources.includes('../../server/whatsapp/'), 'Entrypoints Instagram atravessam boundary de outro dominio.');
assert(validationSources.includes('../../server/whatsapp/validation.handler.js') && !validationSources.includes('../../server/maps/') && !validationSources.includes('../../server/instagram/'), 'Entrypoints de validacao WhatsApp perderam o handler especifico.');

console.log(`FUNCTION_COUNT = ${entrypoints.length}`);
if (entrypoints.length > 10 && entrypoints.length <= 12) console.warn(`WARNING: ${entrypoints.length} Functions; dentro do Hobby, mas acima da meta preferencial de 10.`);

if (failures.length) {
  console.error(`Falhas no inventario Vercel (${failures.length}):`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('OK: rotas publicas preservadas e helpers server-side nao contam como Vercel Functions.');
