import type { ApiRequest,ApiResponse,Row } from '../../../maps/shared.js';
import { body,send,setCors,text } from '../../../maps/shared.js';
import { capabilities,executorStatus,installationScope } from '../../../tools/executor.js';

const PRIMARY_COMPONENT:Record<string,string>={vinsansi_whatsapp_manager:'manager',vinsansi_capture:'capture',vinsansi_instagram:'instagram'};
const MANAGER_COMPONENTS=new Set(['gateway','evolution','realtime']);

export default async function handler(req:ApiRequest,res:ApiResponse){
  setCors(req,res);if(req.method==='OPTIONS')return res.status(204).end();if(req.method!=='POST')return send(req,res,405,{error:'method_not_allowed'});
  try{
    const scope=await installationScope(req);const input=body(req);const version=text(input.version)||null;
    const touched=await scope.client.rpc('service_touch_tool_installation',{p_organizations_id:scope.organizationId,p_tool_id:scope.toolId,p_external_installation_id:scope.externalInstallationId,p_seen:true,p_meaningful_activity:Boolean(input.meaningfulActivity),p_installed_version:version,p_reported_capabilities:capabilities(input.capabilities),p_last_seen_member_id:null});
    if(touched.error)throw new Error(touched.error.message);
    const primary=PRIMARY_COMPONENT[scope.toolId];
    if(primary){
      const runtime=await scope.client.rpc('service_runtime_heartbeat',{p_organizations_id:scope.organizationId,p_component_type:primary,p_component_key:scope.externalInstallationId,p_component_version:version,p_status:text(input.status)||'online',p_installation_id:scope.installationId,p_metrics:(input.metrics&&typeof input.metrics==='object'?input.metrics:{}),p_metadata:{toolId:scope.toolId},p_meaningful_activity:Boolean(input.meaningfulActivity)});
      if(runtime.error)throw new Error(runtime.error.message);
    }
    if(scope.toolId==='vinsansi_whatsapp_manager'&&Array.isArray(input.components)){
      for(const raw of input.components){
        const item=(raw&&typeof raw==='object'?raw:{}) as Row;const type=text(item.type);if(!MANAGER_COMPONENTS.has(type))continue;
        const runtime=await scope.client.rpc('service_runtime_heartbeat',{p_organizations_id:scope.organizationId,p_component_type:type,p_component_key:text(item.key)||`${scope.externalInstallationId}:${type}`,p_component_version:text(item.version)||null,p_status:text(item.status)||'online',p_installation_id:scope.installationId,p_metrics:(item.metrics&&typeof item.metrics==='object'?item.metrics:{}),p_metadata:(item.metadata&&typeof item.metadata==='object'?item.metadata:{}),p_meaningful_activity:false});
        if(runtime.error)throw new Error(runtime.error.message);
      }
    }
    await scope.client.rpc('refresh_operational_alerts',{p_organizations_id:scope.organizationId});
    return send(req,res,200,{ok:true,organizationId:scope.organizationId,installationId:scope.installationId,ttlSeconds:180,serverTime:new Date().toISOString()});
  }catch(error){return send(req,res,executorStatus(error),{ok:false,error:error instanceof Error?error.message:String(error)});}
}
