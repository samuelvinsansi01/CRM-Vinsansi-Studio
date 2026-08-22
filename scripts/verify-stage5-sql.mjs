import fs from 'node:fs';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';

const root=path.resolve(import.meta.dirname,'..');
const container=`vinsansi-stage5-sql-${process.pid}`;
const run=(args,options={})=>spawnSync('docker',args,{cwd:root,encoding:'utf8',...options});
const checked=(args,options={})=>{const result=run(args,options);if(result.status!==0){process.stderr.write(result.stdout||'');process.stderr.write(result.stderr||'');throw new Error(`docker ${args.join(' ')} failed`);}return result;};
const apply=file=>checked(['exec','-i',container,'psql','-v','ON_ERROR_STOP=1','-U','postgres','-d','vinsansi'],{input:fs.readFileSync(path.join(root,file),'utf8')});
const concurrent=sql=>new Promise(resolve=>{const child=spawn('docker',['exec','-i',container,'psql','-v','ON_ERROR_STOP=1','-U','postgres','-d','vinsansi','-Atc',sql],{cwd:root});let stdout='';let stderr='';child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);child.on('close',code=>resolve({code,stdout,stderr}));});

try{
  checked(['run','-d','--rm','--name',container,'-e','POSTGRES_PASSWORD=postgres','-e','POSTGRES_DB=vinsansi','postgres:16-alpine']);
  let ready=0;for(let attempt=0;attempt<60&&ready<3;attempt+=1){const probe=run(['exec',container,'pg_isready','-U','postgres','-d','vinsansi']);ready=probe.status===0?ready+1:0;await new Promise(resolve=>setTimeout(resolve,400));}
  if(ready<3)throw new Error('PostgreSQL 16 did not become ready');
  apply('scripts/sql/stage5-smoke-base.sql');
  apply('supabase/migrations/20260823120000_whatsapp_manager_conversations.sql');
  checked(['exec',container,'psql','-v','ON_ERROR_STOP=1','-U','postgres','-d','vinsansi','-c',`INSERT INTO public.conversations(conversations_id,users_id,organizations_id,chips_id,instances_id,remote_jid,contact_phone,contact_name,conversation_status,last_message_at,last_message_preview,conversations_created_at,conversations_updated_at) VALUES(3,1,10,501,1001,'119546170073140@lid','119546170073140','Lead inicial','open',now(),'Resposta inbound',now(),now()); INSERT INTO public.conversation_messages(users_id,organizations_id,conversations_id,chips_id,instances_id,external_message_id,remote_jid,direction,from_me,message_type,message_body,message_status,executed_by,raw_payload) VALUES(1,10,3,501,1001,'lid-duplicate-1','119546170073140@lid','inbound',false,'text','Resposta inbound','delivered','system','{"key":{"remoteJid":"119546170073140@lid","remoteJidAlt":"5511999999999@s.whatsapp.net"}}'::jsonb);`]);
  apply('supabase/migrations/20260823170000_whatsapp_conversation_identity_aliases.sql');
  const sql="SELECT public.service_stage5_assign_conversation(10,101,1,'assume',NULL,1);";
  const race=await Promise.all([concurrent(sql),concurrent(sql)]);
  const winners=race.filter(result=>result.code===0);const conflicts=race.filter(result=>result.code!==0&&result.stderr.includes('conversation_version_conflict'));
  if(winners.length!==1||conflicts.length!==1)throw new Error(`real self-assume race invalid: ${JSON.stringify(race)}`);
  const transferRace=await Promise.all([
    concurrent("SELECT public.service_stage5_assign_conversation(10,101,1,'transfer',102,2);"),
    concurrent("SELECT public.service_stage5_assign_conversation(10,101,1,'transfer',101,2);"),
  ]);
  const transferWinners=transferRace.filter(result=>result.code===0);const transferConflicts=transferRace.filter(result=>result.code!==0&&result.stderr.includes('conversation_version_conflict'));
  if(transferWinners.length!==1||transferConflicts.length!==1)throw new Error(`real transfer race invalid: ${JSON.stringify(transferRace)}`);
  checked(['exec',container,'psql','-v','ON_ERROR_STOP=1','-U','postgres','-d','vinsansi','-c',"UPDATE public.conversations SET assigned_to_member_id=101,conversation_version=2 WHERE conversations_id=1;"]);
  apply('scripts/sql/stage5-smoke-assertions.sql');
  console.log('Etapa 5 SQL: migrations reais no PostgreSQL 16, identidade/aliases, race transacional e contratos Fase A aprovados.');
}finally{run(['rm','-f',container]);}
