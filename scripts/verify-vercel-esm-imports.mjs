import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = process.cwd();
const runtimeRoots = ['api', 'server'];
const validRuntimeExtensions = new Set(['.js', '.mjs', '.cjs', '.json', '.node']);
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => entry.isDirectory()
      ? walk(path.join(directory, entry.name))
      : [path.join(directory, entry.name)]);
}

function relativeSpecifiers(source) {
  return [...new Set(
    ts.preProcessFile(source, true, true).importedFiles
      .map((entry) => entry.fileName)
      .filter((specifier) => specifier.startsWith('.')),
  )];
}

const runtimeFiles = runtimeRoots
  .flatMap((directory) => walk(path.join(root, directory)))
  .filter((file) => file.endsWith('.ts') && !file.endsWith('.d.ts'))
  .sort();

for (const file of runtimeFiles) {
  const source = fs.readFileSync(file, 'utf8');
  for (const specifier of relativeSpecifiers(source)) {
    const extension = path.extname(specifier.split(/[?#]/, 1)[0]);
    const label = `${path.relative(root, file).replaceAll('\\', '/')}: ${specifier}`;
    assert(validRuntimeExtensions.has(extension), `Import ESM relativo sem extensao runtime valida: ${label}.`);
    if (extension === '.js') {
      const emittedTarget = path.resolve(path.dirname(file), specifier);
      const sourceTarget = emittedTarget.replace(/\.js$/i, '.ts');
      assert(fs.existsSync(sourceTarget) || fs.existsSync(emittedTarget), `Import ESM nao resolve para source/runtime existente: ${label}.`);
    }
  }
}

const chains = {
  mapsPair: 'api/maps/pair.ts',
  mapsExtension: 'api/maps/extension.ts',
  instagramPair: 'api/instagram/pair.ts',
  instagramExtension: 'api/instagram/extension.ts',
  whatsappValidate: 'api/whatsapp/validate.ts',
  whatsappRevalidate: 'api/whatsapp/revalidate.ts',
};

for (const file of Object.values(chains)) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  assert(relativeSpecifiers(source).every((specifier) => validRuntimeExtensions.has(path.extname(specifier))), `${file} ainda possui specifier relativo extensionless.`);
}

const emitted = new Map();
for (const file of runtimeFiles) {
  const relative = path.relative(root, file).replaceAll('\\', '/').replace(/\.ts$/i, '.js');
  const source = fs.readFileSync(file, 'utf8');
  const output = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      isolatedModules: true,
    },
  }).outputText;
  emitted.set(relative, output);
  for (const specifier of relativeSpecifiers(output)) {
    assert(validRuntimeExtensions.has(path.extname(specifier)), `Output ESM de ${relative} preservou import relativo extensionless: ${specifier}.`);
  }
}

assert(emitted.get('api/maps/pair.js')?.includes("from '../../server/maps/token.js'"), 'Output Maps pair nao referencia token.js.');
assert(emitted.get('api/maps/extension.js')?.includes("from '../../server/maps/shared.js'"), 'Output Maps extension nao referencia shared.js.');
assert(emitted.get('api/instagram/pair.js')?.includes("from '../../server/instagram/token.js'"), 'Output Instagram pair nao referencia token.js.');
assert(emitted.get('api/instagram/extension.js')?.includes("from '../../server/instagram/identity.js'"), 'Output Instagram extension nao referencia identity.js.');
assert(emitted.get('api/whatsapp/validate.js')?.includes("from '../../server/whatsapp/validation.handler.js'"), 'Output WhatsApp validate nao referencia validation.handler.js.');
assert(emitted.get('api/whatsapp/revalidate.js')?.includes("from '../../server/whatsapp/validation.handler.js'"), 'Output WhatsApp revalidate nao referencia validation.handler.js.');

if (!failures.length) {
  const temporaryRoot = path.join(root, `.vercel-esm-check-${process.pid}-${Date.now()}`);
  try {
    fs.mkdirSync(temporaryRoot, { recursive: false });
    fs.writeFileSync(path.join(temporaryRoot, 'package.json'), '{"type":"module"}\n');
    for (const [relative, output] of emitted) {
      const target = path.join(temporaryRoot, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, output);
    }
    for (const entrypoint of Object.values(chains).map((file) => file.replace(/\.ts$/i, '.js'))) {
      await import(`${pathToFileURL(path.join(temporaryRoot, entrypoint)).href}?check=${Date.now()}`);
    }
  } catch (error) {
    failures.push(`Output ESM nao foi importavel como no runtime Node: ${error instanceof Error ? error.stack || error.message : String(error)}`);
  } finally {
    if (fs.existsSync(temporaryRoot)) fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

if (failures.length) {
  console.error(`Falhas nos imports ESM Vercel (${failures.length}):`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`OK: ${runtimeFiles.length} modulos server-side auditados sem imports relativos extensionless.`);
console.log('OK: output ESM de Maps, Instagram e WhatsApp foi emitido e importado pelo Node com specifiers .js.');
