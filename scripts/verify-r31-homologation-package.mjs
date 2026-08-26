import fs from 'node:fs';
import path from 'node:path';
const root=process.cwd();
const page=fs.readFileSync(path.join(root,'src/pages/HomologationPage.tsx'),'utf8');
const repoPath=path.join(root,'src/repositories/release/homologation.repository.ts');
const failures=[];
if(!fs.existsSync(repoPath)) failures.push('homologation.repository.ts ausente');
else {
  const repo=fs.readFileSync(repoPath,'utf8');
  for (const name of ['getHomologationSnapshot','getProductionReadiness','startHomologation','setHomologationCheck','promoteStableRelease']) {
    if(!repo.includes(`function ${name}`)) failures.push(`função ${name} ausente no repository`);
  }
  if(!repo.includes('export type HomologationCheck')) failures.push('tipo HomologationCheck ausente');
  if(!repo.includes('export type HomologationSnapshot')) failures.push('tipo HomologationSnapshot ausente');
}
if(!page.includes("../repositories/release/homologation.repository")) failures.push('HomologationPage não importa repository canônico');
if(!page.includes('(acc:HomologationSummary,item:HomologationCheck)')) failures.push('reduce da HomologationPage sem tipos explícitos');
if(failures.length){console.error(failures.join('\n'));process.exit(1)}
console.log('R31 homologation package: OK');
