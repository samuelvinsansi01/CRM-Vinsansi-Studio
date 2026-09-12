import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let ts;
try { ts = require('typescript'); }
catch {
  const globalRoot = execFileSync('npm', ['root', '--global'], { encoding: 'utf8' }).trim();
  ts = require(path.join(globalRoot, 'typescript'));
}
const pass = [];
const fail = [];
const ok = (name, condition, detail = '') => condition ? pass.push(name) : fail.push(`${name}${detail ? `: ${detail}` : ''}`);

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}
function scriptKind(file) {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (file.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (file.endsWith('.js') || file.endsWith('.mjs') || file.endsWith('.cjs')) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}
function jsonTypeAttribute(node) {
  const attrs = node.attributes ?? node.assertClause;
  if (!attrs?.elements) return false;
  return attrs.elements.some((element) => {
    const name = element.name?.text ?? element.name?.escapedText;
    const value = element.value?.text;
    return name === 'type' && value === 'json';
  });
}
function dynamicJsonAttribute(call) {
  const options = call.arguments?.[1];
  if (!options || !ts.isObjectLiteralExpression(options)) return false;
  const withProp = options.properties.find((p) => ts.isPropertyAssignment(p) && (p.name?.text ?? p.name?.escapedText) === 'with');
  if (!withProp || !ts.isPropertyAssignment(withProp) || !ts.isObjectLiteralExpression(withProp.initializer)) return false;
  return withProp.initializer.properties.some((p) => ts.isPropertyAssignment(p) && (p.name?.text ?? p.name?.escapedText) === 'type' && ts.isStringLiteral(p.initializer) && p.initializer.text === 'json');
}
function sourceFile(file) {
  return ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, scriptKind(file));
}
function moduleSpecifiers(file) {
  const sf = sourceFile(file);
  const specs = [];
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      specs.push({ spec: node.moduleSpecifier.text, node, dynamic: false });
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
      specs.push({ spec: node.arguments[0].text, node, dynamic: true });
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return specs;
}

// Gate 1: no bare JSON import/export/dynamic import in Node ESM server code.
const serverFiles = ['api', 'server'].flatMap((dir) => walk(path.join(root, dir)))
  .filter((file) => /\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(file) && !file.endsWith('.d.ts'));
let jsonImports = 0;
for (const file of serverFiles) {
  for (const item of moduleSpecifiers(file)) {
    if (!item.spec.endsWith('.json')) continue;
    jsonImports += 1;
    const safe = item.dynamic ? dynamicJsonAttribute(item.node) : jsonTypeAttribute(item.node);
    ok(`json-import-attribute:${path.relative(root, file).replaceAll('\\', '/')}:${item.spec}`, safe, 'JSON import in Node ESM requires type=json import attribute');
  }
}
ok('json-imports:present-and-audited', jsonImports >= 1, `found=${jsonImports}`);

// Gate 2: prove this Node runtime rejects bare JSON and accepts the standard import attribute.
const probe = fs.mkdtempSync(path.join(os.tmpdir(), 'vinsansi-node22-json-probe-'));
try {
  fs.writeFileSync(path.join(probe, 'package.json'), '{"type":"module"}\n');
  fs.writeFileSync(path.join(probe, 'data.json'), '{"ok":true}\n');
  fs.writeFileSync(path.join(probe, 'bare.mjs'), "import data from './data.json';\nconsole.log(data.ok);\n");
  fs.writeFileSync(path.join(probe, 'safe.mjs'), "import data from './data.json' with { type: 'json' };\nconsole.log(data.ok);\n");
  const bare = spawnSync(process.execPath, [path.join(probe, 'bare.mjs')], { encoding: 'utf8' });
  const safe = spawnSync(process.execPath, [path.join(probe, 'safe.mjs')], { encoding: 'utf8' });
  ok('node-runtime:bare-json-rejected', bare.status !== 0 && `${bare.stderr}\n${bare.stdout}`.includes('ERR_IMPORT_ATTRIBUTE_MISSING'), `status=${bare.status}`);
  ok('node-runtime:json-attribute-accepted', safe.status === 0 && safe.stdout.trim() === 'true', `${safe.stderr}\n${safe.stdout}`.trim());
} finally {
  fs.rmSync(probe, { recursive: true, force: true });
}

// Gate 3: transpile the real /api/system dependency graph without bundling and make Node load it.
// Only @supabase/supabase-js is external in this graph; it is stubbed because this test verifies
// pre-handler ESM/module loading, not database behavior.
function resolveRelative(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates = [base];
  if (base.endsWith('.js')) candidates.push(base.slice(0, -3) + '.ts', base.slice(0, -3) + '.tsx');
  if (!path.extname(base)) candidates.push(`${base}.ts`, `${base}.tsx`, `${base}.js`, path.join(base, 'index.ts'));
  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) ?? null;
}
const entry = path.join(root, 'api', 'system.ts');
const graph = new Set();
const stack = [entry];
const externals = new Set();
while (stack.length) {
  const file = stack.pop();
  if (graph.has(file)) continue;
  graph.add(file);
  if (file.endsWith('.json')) continue;
  for (const { spec } of moduleSpecifiers(file)) {
    if (spec.startsWith('.')) {
      const resolved = resolveRelative(file, spec);
      if (!resolved) throw new Error(`runtime-test-relative-import-missing:${path.relative(root, file)}:${spec}`);
      stack.push(resolved);
    } else if (!spec.startsWith('node:')) externals.add(spec);
  }
}
ok('api-system:only-known-external', [...externals].every((item) => item === '@supabase/supabase-js'), [...externals].join(','));

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'vinsansi-node22-system-tree-'));
try {
  fs.writeFileSync(path.join(temporary, 'package.json'), '{"type":"module"}\n');
  for (const file of graph) {
    const relative = path.relative(root, file);
    if (file.endsWith('.json')) {
      const target = path.join(temporary, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(file, target);
      continue;
    }
    const outputRelative = relative.replace(/\.(?:ts|tsx)$/, '.js');
    const target = path.join(temporary, outputRelative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      fileName: file,
      reportDiagnostics: true,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.ReactJSX,
        isolatedModules: true,
      },
    });
    const errors = (compiled.diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error);
    if (errors.length) throw new Error(`runtime-test-transpile:${relative}:${errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('|')}`);
    fs.writeFileSync(target, compiled.outputText);
  }
  const stubDir = path.join(temporary, 'node_modules', '@supabase', 'supabase-js');
  fs.mkdirSync(stubDir, { recursive: true });
  fs.writeFileSync(path.join(stubDir, 'package.json'), JSON.stringify({ name: '@supabase/supabase-js', version: '0.0.0-runtime-test', type: 'module', exports: './index.js' }));
  fs.writeFileSync(path.join(stubDir, 'index.js'), 'export function createClient(){ return {}; }\n');
  const target = path.join(temporary, 'api', 'system.js');
  const loader = spawnSync(process.execPath, ['--input-type=module', '--eval', `const m=await import(${JSON.stringify(pathToFileURL(target).href)}); if(typeof m.default!==\"function\") process.exit(7);`], { encoding: 'utf8' });
  ok('api-system:node22-module-load-before-handler', loader.status === 0, `${loader.stderr}\n${loader.stdout}`.trim());
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

if (fail.length) {
  console.error(`Node/Vercel runtime compatibility FAIL ${pass.length} pass / ${fail.length} fail`);
  for (const item of fail) console.error(`FAIL ${item}`);
  process.exit(1);
}
console.log(`Node/Vercel runtime compatibility PASS ${pass.length}/${pass.length} (Node ${process.version}, JSON imports audited: ${jsonImports}).`);
