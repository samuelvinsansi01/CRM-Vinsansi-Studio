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
  const globalRoot = execFileSync('npm', ['root', '--global'], { encoding: 'utf8' }).trim();
  ts = require(path.join(globalRoot, 'typescript'));
}

const source = fs.readFileSync(path.join(root, 'src/utils/branchCategories.ts'), 'utf8');
const output = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
  },
}).outputText;

const runtimeModule = { exports: {} };
new Function('module', 'exports', output)(runtimeModule, runtimeModule.exports);
const {
  categoriesFormValue,
  mergeCategoriesJson,
  normalizeCategoryList,
  parseCategoriesJson,
} = runtimeModule.exports;

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const normalized = normalizeCategoryList(' Contador, contador , CONTADOR; Escritório  Contábil\nserviços contábeis, ');
assert(JSON.stringify(normalized) === JSON.stringify(['contador', 'escritório contábil', 'serviços contábeis']), 'Normalização de categorias falhou.');

const accentInsensitive = normalizeCategoryList('Escritório, escritorio');
assert(accentInsensitive.length === 1 && accentInsensitive[0] === 'escritório', 'Deduplicação sem diferenciar acentos falhou.');

const current = JSON.stringify({
  slug: 'contabilidade',
  minRating: 4.5,
  imageRequired: true,
  associated_categories: ['antiga'],
});
const merged = parseCategoriesJson(mergeCategoriesJson(current, 'Contador, Serviços Contábeis'));
assert(merged.slug === 'contabilidade' && merged.minRating === 4.5 && merged.imageRequired === true, 'Chaves JSON não relacionadas foram perdidas.');
assert(JSON.stringify(merged.associatedCategories) === JSON.stringify(['contador', 'serviços contábeis']), 'Campo canônico associatedCategories não foi atualizado.');
assert(JSON.stringify(merged.associated_categories) === JSON.stringify(['contador', 'serviços contábeis']), 'Alias legado associated_categories ficou desatualizado.');

const legacy = categoriesFormValue(['Contador', 'CONTADOR', 'Escritório contábil']);
const legacyJson = parseCategoriesJson(legacy.categoriesJson);
assert(legacy.categoriesText === 'contador, escritório contábil', 'Array legado não foi convertido para o textarea humano.');
assert(JSON.stringify(legacyJson.associatedCategories) === JSON.stringify(['contador', 'escritório contábil']), 'Array legado não foi convertido para a estrutura canônica.');

console.log('Editor de categorias aprovado: entrada humana normalizada, JSON somente gerado e metadados preservados.');
