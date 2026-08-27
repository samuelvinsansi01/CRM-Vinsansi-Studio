import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const repository = path.join(root, 'src/repositories/release/homologation.repository.ts');
const page = path.join(root, 'src/pages/HomologationPage.tsx');

if (!fs.existsSync(repository)) {
  throw new Error('R48: homologation.repository.ts ausente do pacote.');
}

const repoSource = fs.readFileSync(repository, 'utf8');
const pageSource = fs.readFileSync(page, 'utf8');

for (const token of [
  'export type HomologationStatus',
  'export type HomologationCheck',
  'export type HomologationSnapshot',
  'getHomologationSnapshot',
  'getProductionReadiness',
  'promoteStableRelease',
]) {
  if (!repoSource.includes(token)) throw new Error(`R48: contrato de homologacao incompleto: ${token}`);
}

if (!pageSource.includes("const status: HomologationCheck['status'] = item.status;")) {
  throw new Error('R48: resumo de homologacao nao fixa o tipo da chave de status.');
}

if (!pageSource.includes('acc[status] += 1;')) {
  throw new Error('R48: resumo de homologacao nao usa a chave tipada.');
}

console.log('R48 homologation build guard: ok');
