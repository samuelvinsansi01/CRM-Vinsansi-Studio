import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let ts;
try { ts = require('typescript'); }
catch {
  try {
    const globalRoot = execFileSync('npm', ['root', '--global'], { encoding: 'utf8' }).trim();
    ts = require(path.join(globalRoot, 'typescript'));
  } catch {
    console.error('TypeScript nao encontrado. Execute npm ci antes da verificacao.');
    process.exit(1);
  }
}
function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return [full];
  });
}
const sourceRoots = ['src', 'api', 'server']
  .map((relative) => path.join(root, relative))
  .filter((dir) => fs.existsSync(dir));
const files = sourceRoots
  .flatMap(walk)
  .filter((file) => /\.(ts|tsx)$/.test(file) && !file.endsWith('.d.ts'));
if (!files.length) {
  console.error('Nenhum arquivo TypeScript encontrado para verificar.');
  process.exit(1);
}
const diagnostics = [];
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  const result = ts.transpileModule(source, {
    fileName: file,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
      isolatedModules: true,
    },
  });
  for (const diagnostic of result.diagnostics ?? []) {
    if (diagnostic.category === ts.DiagnosticCategory.Error) diagnostics.push({ file, diagnostic });
  }
}
if (diagnostics.length) {
  for (const { file, diagnostic } of diagnostics) {
    console.error(`${path.relative(root, file)}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`);
  }
  process.exit(1);
}
console.log(`Sintaxe TypeScript aprovada em ${files.length} arquivos.`);
