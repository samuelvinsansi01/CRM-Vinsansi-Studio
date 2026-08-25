import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=dirname(dirname(fileURLToPath(import.meta.url)));
const scripts=['tests/stage11-r21-fixture.sql','supabase/migrations/20260825170000_r21_stage11_observability_recovery_hardening.sql','tests/stage11-r22-pre-migration.sql','supabase/migrations/20260825203000_r22_current_tool_installation_lifecycle.sql','tests/stage11-r22-integration.sql'].map(path=>readFileSync(join(root,path),'utf8'));
const name=`codex-stage11-r22-${process.pid}`;
function docker(args,options={}){const result=spawnSync('docker',args,{encoding:'utf8',...options});if(result.status!==0)throw new Error(`docker ${args.join(' ')} failed\n${result.stdout??''}\n${result.stderr??''}`);return result.stdout??'';}
function psql(sql){return docker(['exec','-i',name,'psql','-v','ON_ERROR_STOP=1','-U','postgres','-d','stage11'],{input:sql});}
try{
  docker(['run','--name',name,'-e','POSTGRES_PASSWORD=stage11','-e','POSTGRES_DB=stage11','-d','postgres:17-alpine']);
  let ready=false,consecutive=0;
  for(let attempt=0;attempt<60;attempt+=1){const probe=spawnSync('docker',['exec',name,'psql','-U','postgres','-d','stage11','-Atqc','select 1'],{encoding:'utf8'});consecutive=probe.status===0&&probe.stdout.trim()==='1'?consecutive+1:0;if(consecutive>=2){ready=true;break;}Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,250);}
  assert.equal(ready,true,'PostgreSQL de teste não ficou pronto.');
  for(const sql of scripts.slice(0,-1))psql(sql);
  const output=psql(scripts.at(-1));
  assert.match(output,/stage11_r22_integration_pass/);
  console.log('Etapa 11 R22 PostgreSQL integration: PASS');
}finally{spawnSync('docker',['rm','-f',name],{encoding:'utf8'});}
