import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };

const tokenSource = read('server/maps/token.ts');
const sharedSource = read('server/maps/shared.ts');
const envExample = read('.env.example');

assert(tokenSource.includes('process.env.GMAPS_EXTENSION_SIGNING_SECRET'), 'Helper não lê o nome canônico da variável server-side.');
assert(tokenSource.includes("state === 'absent' || state === 'empty'"), 'Ausência e vazio não são classificados como not_configured.');
assert(tokenSource.includes("state === 'too_short'"), 'Secret curto não possui classificação invalid distinta.');
assert(tokenSource.includes("console.info('[maps-token-config]'"), 'Diagnóstico seguro do carregamento não está presente.');
assert(!/console\.(?:info|log|warn|error)\([^)]*configuredValue/s.test(tokenSource), 'Diagnóstico pode imprimir o valor do secret.');
assert(sharedSource.includes("/gmaps_extension_signing_secret_(?:not_configured|invalid)/.test(message)) return 503"), 'Erros de configuração do signing secret não retornam 503.');
assert(envExample.includes('GMAPS_EXTENSION_SIGNING_SECRET=') && envExample.includes('Mínimo de 32 caracteres após trim'), '.env.example não documenta nome e tamanho mínimo.');

const emitted = ts.transpileModule(tokenSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: 'server/maps/token.ts',
}).outputText;
const tokenModule = await import(`data:text/javascript;base64,${Buffer.from(emitted).toString('base64')}`);

const originalSecret = process.env.GMAPS_EXTENSION_SIGNING_SECRET;
const originalConsoleInfo = console.info;

async function scenario(value) {
  if (value === undefined) delete process.env.GMAPS_EXTENSION_SIGNING_SECRET;
  else process.env.GMAPS_EXTENSION_SIGNING_SECRET = value;
  const logs = [];
  console.info = (...args) => logs.push(args);
  try {
    const issued = await tokenModule.issueMapsExtensionToken({ userId: 1, installationId: 'installation-for-verifier' });
    return { issued, error: null, logs };
  } catch (error) {
    return { issued: null, error: error instanceof Error ? error.message : String(error), logs };
  } finally {
    console.info = originalConsoleInfo;
  }
}

try {
  const absent = await scenario(undefined);
  const empty = await scenario('');
  const whitespace = await scenario('   ');
  const shortValue = 'present-but-short';
  const invalid = await scenario(shortValue);
  const validValue = 'v'.repeat(32);
  const valid = await scenario(validValue);

  assert(absent.error === 'gmaps_extension_signing_secret_not_configured', 'Env ausente não retorna not_configured.');
  assert(empty.error === 'gmaps_extension_signing_secret_not_configured', 'Env vazia não retorna not_configured.');
  assert(whitespace.error === 'gmaps_extension_signing_secret_not_configured', 'Env só com espaços não retorna not_configured.');
  assert(invalid.error === 'gmaps_extension_signing_secret_invalid', 'Env presente e curta não retorna invalid.');
  assert(valid.error === null && typeof valid.issued?.token === 'string' && valid.issued.token.includes('.'), 'Env válida não permite emitir o token do pairing.');

  const allLogs = [absent, empty, whitespace, invalid, valid].flatMap((result) => result.logs);
  assert(allLogs.every(([label, detail]) => label === '[maps-token-config]' && typeof detail?.signingSecretLength === 'number'), 'Diagnóstico não possui label/comprimento estruturados.');
  const serializedLogs = JSON.stringify(allLogs);
  assert(!serializedLogs.includes(shortValue) && !serializedLogs.includes(validValue), 'Diagnóstico expôs o valor do secret.');
  assert(serializedLogs.includes('absent') && serializedLogs.includes('empty') && serializedLogs.includes('too_short') && serializedLogs.includes('valid'), 'Diagnóstico não diferencia todos os estados seguros.');
} finally {
  if (originalSecret === undefined) delete process.env.GMAPS_EXTENSION_SIGNING_SECRET;
  else process.env.GMAPS_EXTENSION_SIGNING_SECRET = originalSecret;
  console.info = originalConsoleInfo;
}

if (failures.length) {
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('OK: signing secret Maps distingue ausente/vazio, inválido e válido sem expor conteúdo.');
