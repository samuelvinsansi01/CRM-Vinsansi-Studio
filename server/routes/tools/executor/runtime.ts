import { randomUUID } from 'node:crypto';
import type { ApiRequest,ApiResponse,Row } from '../../../maps/shared.js';
import { body,send,setCors,text } from '../../../maps/shared.js';
import { executorStatus,installationScope } from '../../../tools/executor.js';

const TABLES=new Set([
  'status','lead_status','channels','chips','levels','instances','instance_runtime_states',
  'queue_items','leads','templates','branches','sents','worker_batches',
]);
const GLOBAL_TABLES=new Set(['status','lead_status','channels']);
const RPCS=new Set([
  'worker_claim_dispatch_job','worker_move_dispatch_to_dlq','worker_claim_dispatch_part','worker_complete_dispatch_part',
  'worker_finalize_whatsapp_queue_item','worker_fail_whatsapp_queue_item','worker_start_whatsapp_batch',
  'worker_set_whatsapp_batch_state','worker_claim_next_batch_item','worker_complete_batch_item',
  'refresh_operational_alerts','service_worker_heartbeat','service_claim_recovery_request',
  'service_complete_recovery_request','worker_recover_stale_whatsapp_v2','instagram_recover_stale_items_v2',
  'service_stage5_converge_automatic_message','worker_claim_manual_message_r60','worker_report_manual_message_r60',
]);
const OPERATORS=new Set(['eq','neq','gt','gte','lt','lte','in','is','not.eq','not.is']);

function object(value:unknown):Record<string,unknown>{
  return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
}

async function markStaleManualDispatches(scope:any){
  const staleBefore=new Date(Date.now()-120_000).toISOString();
  const stale=await scope.client.from('conversation_messages')
    .select('conversation_messages_id,raw_payload,message_status')
    .eq('organizations_id',scope.organizationId)
    .eq('direction','outbound').eq('executed_by','member').eq('message_status','sending')
    .lt('conversation_messages_updated_at',staleBefore).order('conversation_messages_id',{ascending:true}).limit(20);
  if(stale.error)throw new Error(stale.error.message);
  for(const row of stale.data??[]){
    const payload=object(row.raw_payload);
    if(text(payload.manualDispatchTransport)!=='worker_local')continue;
    await scope.client.from('conversation_messages').update({
      message_status:'reconciliation_required',reconciliation_state:'pending',
      error_message:'manual_worker_stale_uncertain',
      raw_payload:{...payload,manualDispatchStaleAt:new Date().toISOString()},
      conversation_messages_updated_at:new Date().toISOString(),
    }).eq('organizations_id',scope.organizationId).eq('conversation_messages_id',Number(row.conversation_messages_id)).eq('message_status','sending');
  }
}

async function claimManualMessage(scope:any,input:Record<string,unknown>){
  const rawArgs=object(input.args);const workerId=text(rawArgs.p_worker_id);
  if(!workerId)throw new Error('manual_worker_id_required');
  await markStaleManualDispatches(scope);
  const candidates=await scope.client.from('conversation_messages')
    .select('conversation_messages_id,conversations_id,instances_id,remote_jid,message_body,message_type,message_status,external_message_id,sent_by_member_id,raw_payload,conversation_messages_created_at')
    .eq('organizations_id',scope.organizationId).eq('direction','outbound').eq('executed_by','member').eq('message_status','pending')
    .order('conversation_messages_id',{ascending:true}).limit(25);
  if(candidates.error)throw new Error(candidates.error.message);
  for(const row of candidates.data??[]){
    const payload=object(row.raw_payload);
    if(text(payload.manualDispatchTransport)!=='worker_local')continue;
    const nextAt=Date.parse(text(payload.manualDispatchNextAttemptAt));
    if(Number.isFinite(nextAt)&&nextAt>Date.now())continue;
    const conversation=await scope.client.from('conversations').select('conversations_id,contact_phone,remote_jid,instances_id')
      .eq('organizations_id',scope.organizationId).eq('conversations_id',Number(row.conversations_id)).maybeSingle();
    if(conversation.error||!conversation.data)throw new Error(conversation.error?.message||'manual_conversation_not_found');
    const org=await scope.client.from('organizations').select('legacy_scope_users_id').eq('organizations_id',scope.organizationId).maybeSingle();
    if(org.error||!org.data?.legacy_scope_users_id)throw new Error(org.error?.message||'manual_legacy_scope_missing');
    const credentials=await scope.client.rpc('service_get_evolution_instances',{
      p_users_id:Number(org.data.legacy_scope_users_id),p_instances_id:Number(row.instances_id),p_instance_name:null,
    });
    if(credentials.error)throw new Error(credentials.error.message);
    const credentialRow=Array.isArray(credentials.data)?credentials.data[0]:credentials.data;
    if(!credentialRow?.instances_name||!credentialRow?.api_key)throw new Error('manual_instance_credentials_missing');
    const claimToken=randomUUID();const now=new Date().toISOString();
    const merged={...payload,manualDispatchClaimToken:claimToken,manualDispatchClaimedBy:workerId,manualDispatchClaimedAt:now};
    const claimed=await scope.client.from('conversation_messages').update({message_status:'sending',error_message:null,raw_payload:merged,conversation_messages_updated_at:now})
      .eq('organizations_id',scope.organizationId).eq('conversation_messages_id',Number(row.conversation_messages_id)).eq('message_status','pending')
      .select('conversation_messages_id,conversations_id,instances_id,remote_jid,message_body,message_type,message_status,external_message_id,sent_by_member_id,raw_payload').maybeSingle();
    if(claimed.error)throw new Error(claimed.error.message);if(!claimed.data)continue;
    return {
      claimToken,
      message:claimed.data,
      command:{instanceName:text(credentialRow.instances_name),apiKey:text(credentialRow.api_key),recipient:text(conversation.data.contact_phone)||text(conversation.data.remote_jid)||text(row.remote_jid)},
    };
  }
  return null;
}

async function reportManualMessage(scope:any,input:Record<string,unknown>){
  const args=object(input.args);const messageId=Number(args.p_conversation_messages_id);const claimToken=text(args.p_claim_token);const status=text(args.p_status).toLowerCase();const workerId=text(args.p_worker_id);
  if(!Number.isSafeInteger(messageId)||messageId<=0||!claimToken||!workerId)throw new Error('manual_worker_report_invalid');
  if(!['pending','sent','failed','reconciliation_required'].includes(status))throw new Error('manual_worker_report_status_invalid');
  const found=await scope.client.from('conversation_messages').select('conversation_messages_id,message_status,external_message_id,sent_by_member_id,raw_payload')
    .eq('organizations_id',scope.organizationId).eq('conversation_messages_id',messageId).maybeSingle();
  if(found.error||!found.data)throw new Error(found.error?.message||'manual_worker_message_not_found');
  const payload=object(found.data.raw_payload);
  if(text(payload.manualDispatchTransport)!=='worker_local')throw new Error('manual_worker_transport_mismatch');
  if(['sent','delivered','read'].includes(text(found.data.message_status)))return {messageId,status:text(found.data.message_status),alreadyFinal:true};
  if(text(payload.manualDispatchClaimToken)!==claimToken)throw new Error('manual_worker_claim_mismatch');
  const attempts=Math.max(0,Number(payload.manualDispatchAttempts||0))+1;
  const providerPayload={...object(args.p_provider_payload),manualDispatchTransport:'worker_local',manualDispatchWorkerId:workerId,manualDispatchAttempts:attempts};
  if(status==='pending'){
    const retryAfter=Math.min(120_000,Math.max(1_000,Number(args.p_retry_after_ms||5_000)));const next=new Date(Date.now()+retryAfter).toISOString();
    const updatedPayload={...payload,...providerPayload,manualDispatchClaimToken:null,manualDispatchClaimedBy:null,manualDispatchClaimedAt:null,manualDispatchNextAttemptAt:next};
    const updated=await scope.client.from('conversation_messages').update({message_status:'pending',error_message:text(args.p_error_message)||null,raw_payload:updatedPayload,conversation_messages_updated_at:new Date().toISOString()})
      .eq('organizations_id',scope.organizationId).eq('conversation_messages_id',messageId).eq('message_status','sending').select('conversation_messages_id,message_status,external_message_id').maybeSingle();
    if(updated.error)throw new Error(updated.error.message);return updated.data??{messageId,status:'pending'};
  }
  const memberId=Number(found.data.sent_by_member_id);if(!Number.isSafeInteger(memberId)||memberId<=0)throw new Error('manual_worker_member_missing');
  const result=await scope.client.rpc('service_stage5_report_manual_message',{
    p_organizations_id:scope.organizationId,p_organization_members_id:memberId,p_conversation_messages_id:messageId,p_status:status,
    p_external_message_id:text(args.p_external_message_id)||text(found.data.external_message_id)||null,p_error_message:text(args.p_error_message)||null,p_provider_payload:providerPayload,
  });
  if(result.error)throw new Error(result.error.message);return result.data;
}

function applyFilters(query:any,filters:unknown,organizationId:number,global:boolean){
  let next=query;
  if(!global)next=next.eq('organizations_id',organizationId);
  for(const raw of Array.isArray(filters)?filters:[]){
    const filter=raw as Row;
    const column=text(filter.column);
    const operator=text(filter.operator);
    if(!column||column==='users_id'||column==='organizations_id'||!OPERATORS.has(operator))continue;
    if(operator==='in')next=next.in(column,Array.isArray(filter.value)?filter.value:[]);
    else if(operator.startsWith('not.'))next=next.not(column,operator.slice(4),filter.value);
    else next=next[operator](column,filter.value);
  }
  return next;
}

export default async function handler(req:ApiRequest,res:ApiResponse){
  setCors(req,res);
  if(req.method==='OPTIONS')return res.status(204).end();
  if(req.method!=='POST')return send(req,res,405,{error:'method_not_allowed'});

  try{
    const scope=await installationScope(req);
    if(scope.toolId!=='vinsansi_whatsapp_manager')throw new Error('tool_scope_mismatch');
    if(scope.installation.registration_status!=='registered')throw new Error('installation_disabled');

    const enabled=await scope.client.from('organization_tools')
      .select('enabled')
      .eq('organizations_id',scope.organizationId)
      .eq('tool_id',scope.toolId)
      .maybeSingle();
    if(enabled.error||enabled.data?.enabled!==true)throw new Error('executor_tool_not_enabled');

    const input=body(req);
    const meaningful=input.operation==='rpc'
      ? !['executor_effective_operational_settings','service_worker_heartbeat'].includes(text(input.name))
      : ['insert','update','upsert','delete'].includes(text(input.operation));

    if(meaningful){
      const touch=await scope.client.rpc('service_touch_tool_installation',{
        p_organizations_id:scope.organizationId,
        p_tool_id:scope.toolId,
        p_external_installation_id:scope.externalInstallationId,
        p_seen:true,
        p_meaningful_activity:true,
        p_installed_version:null,
        p_reported_capabilities:null,
        p_last_seen_member_id:null,
      });
      if(touch.error)throw new Error(touch.error.message);
    }

    if(input.operation==='rpc'){
      const name=text(input.name);
      if(name==='executor_effective_operational_settings'){
        const config=await Promise.all([
          scope.client.from('platform_tools').select('default_settings').eq('tool_id',scope.toolId).single(),
          scope.client.from('organization_tool_settings').select('settings').eq('organizations_id',scope.organizationId).eq('tool_id',scope.toolId).maybeSingle(),
        ]);
        const settings=config[1].data?.settings??config[0].data?.default_settings??{};
        return send(req,res,200,{ok:true,data:{
          dispatch:{whatsapp:settings.whatsapp,chipLevels:settings.chipLevels},
          timezone:settings.operationalTimezone||'America/Sao_Paulo',
          cutoffHour:Number(settings.operationalCutoffHour??22),
        }});
      }

      if(!RPCS.has(name))throw new Error('runtime_rpc_forbidden');
      if(name==='worker_claim_manual_message_r60')return send(req,res,200,{ok:true,data:await claimManualMessage(scope,input as Record<string,unknown>)});
      if(name==='worker_report_manual_message_r60')return send(req,res,200,{ok:true,data:await reportManualMessage(scope,input as Record<string,unknown>)});
      const rawArgs=(input.args&&typeof input.args==='object')?input.args as Row:{};
      const args:{[key:string]:unknown}={...rawArgs,p_organizations_id:scope.organizationId};
      // R60: installation scope is the sole tenant authority. Worker-supplied tenant
      // values are overwritten and no legacy users_id translation exists on the hot path.
      delete args.p_users_id;

      // Fase 4: platform_runtime_heartbeats é a única fonte canônica de saúde.
      // O nome service_worker_heartbeat é mantido no contrato do Worker por
      // compatibilidade, mas a rota não grava mais worker_heartbeats.
      if(name==='service_worker_heartbeat'){
        const runtime=await scope.client.rpc('service_runtime_heartbeat',{
          p_organizations_id:scope.organizationId,
          p_component_type:'worker',
          p_component_key:text(args.p_worker_id),
          p_component_version:text(args.p_worker_version)||null,
          p_status:text(args.p_status)||'online',
          p_installation_id:scope.installationId,
          p_metrics:object(args.p_metrics),
          p_metadata:{managedBy:'manager',hostExternalInstallationId:scope.externalInstallationId,...object(args.p_metadata)},
          p_meaningful_activity:false,
        });
        if(runtime.error)throw new Error(runtime.error.message);
        return send(req,res,200,{ok:true,data:null});
      }

      const result=await scope.client.rpc(name,args);
      if(result.error)throw new Error(result.error.message);
      return send(req,res,200,{ok:true,data:result.data});
    }

    const table=text(input.table);
    if(!TABLES.has(table))throw new Error('runtime_table_forbidden');
    const operation=text(input.operation)||'select';
    if(!['select','insert','update','upsert','delete'].includes(operation))throw new Error('runtime_operation_forbidden');

    const global=GLOBAL_TABLES.has(table);
    let query:any=scope.client.from(table);
    const rawValues=input.values;
    const pin=(value:unknown)=>{
      if(Array.isArray(value))return value.map((row)=>({...row as Row,...(global?{}:{organizations_id:scope.organizationId})}));
      return {...(value as Row),...(global?{}:{organizations_id:scope.organizationId})};
    };

    if(operation==='select')query=query.select(text(input.select)||'*');
    if(operation==='insert')query=query.insert(pin(rawValues));
    if(operation==='upsert')query=query.upsert(pin(rawValues),input.options as any);
    if(operation==='update')query=query.update(pin(rawValues));
    if(operation==='delete')query=query.delete();
    query=applyFilters(query,input.filters,scope.organizationId,global);

    for(const modifier of Array.isArray(input.modifiers)?input.modifiers:[]){
      const m=modifier as Row;
      if(m.type==='order')query=query.order(text(m.column),m.options as any);
      if(m.type==='limit')query=query.limit(Number(m.value));
    }
    if(input.returning)query=query.select(text(input.select)||'*');
    if(input.resultMode==='single')query=query.single();
    if(input.resultMode==='maybeSingle')query=query.maybeSingle();

    const result=await query;
    if(result.error)throw new Error(result.error.message);
    return send(req,res,200,{ok:true,data:result.data});
  }catch(error){
    return send(req,res,executorStatus(error),{ok:false,error:error instanceof Error?error.message:String(error)});
  }
}
