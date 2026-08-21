import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root=path.resolve(import.meta.dirname,'..');
let container='';
const run=(args,options={})=>spawnSync('docker',args,{cwd:root,encoding:'utf8',...options});
const checked=(args,options={})=>{const result=run(args,options);if(result.status!==0)throw new Error(String(result.stderr||result.stdout));return result;};
const apply=(file)=>checked(['exec','-i',container,'psql','-v','ON_ERROR_STOP=1','-U','postgres','-d','vinsansi'],{input:fs.readFileSync(path.join(root,file),'utf8')});

const scenarios=[
  {
    name:'migrations-patch',
    files:[
      'scripts/sql/stage3-smoke-base.sql',
      'supabase/migrations/20260821190000_tools_control_plane.sql',
      'PATCH-CORRETIVO-v1.2.0-RPC-RETURNS-TABLE.sql',
      'scripts/sql/stage3-smoke-assertions.sql',
      'supabase/migrations/20260822120000_executor_organization_context.sql',
      'PATCH-CORRETIVO-ETAPA-4-CONTEXTO-MEMBERSHIP.sql',
      'PATCH-CORRETIVO-FINAL-ETAPA-4-IDENTIDADE.sql',
      'scripts/sql/stage4-smoke-assertions.sql',
    ],
  },
  {
    name:'consolidated-v1.3.0',
    files:[
      'scripts/sql/stage3-smoke-base.sql',
      'APLICAR-NO-SUPABASE-v1.3.0.sql',
      'scripts/sql/stage3-smoke-assertions.sql',
      'scripts/sql/stage4-smoke-assertions.sql',
    ],
  },
];

for(const scenario of scenarios){
  container=`vinsansi-stage4-sql-${scenario.name}-${process.pid}`;
  try{
    checked(['run','-d','--rm','--name',container,'-e','POSTGRES_PASSWORD=postgres','-e','POSTGRES_DB=vinsansi','postgres:16-alpine']);
    let consecutiveReady=0;
    for(let attempt=0;attempt<60&&consecutiveReady<3;attempt+=1){const probe=run(['exec',container,'pg_isready','-U','postgres','-d','vinsansi']);consecutiveReady=probe.status===0?consecutiveReady+1:0;await new Promise(resolve=>setTimeout(resolve,500));}
    if(consecutiveReady<3)throw new Error(`PostgreSQL de smoke test não ficou estável: ${scenario.name}`);
    for(const file of scenario.files)apply(file);
  }finally{
    run(['rm','-f',container]);
  }
}

console.log('Etapa 4 SQL: migrations, patch incremental e consolidado v1.3.0 aprovados.');
