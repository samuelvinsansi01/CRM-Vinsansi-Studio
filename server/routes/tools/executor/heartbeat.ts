import type { ApiRequest,ApiResponse,Row } from '../../../maps/shared.js';
import { body,send,setCors,text } from '../../../maps/shared.js';
import { capabilities,executorStatus,installationScope } from '../../../tools/executor.js';

const PRIMARY_COMPONENT:Record<string,string>={
  vinsansi_whatsapp_manager:'manager',
  vinsansi_capture:'capture',
  vinsansi_instagram:'instagram',
};

// Desde a Fase 3, a instalação do Gerenciador é a raiz operacional da máquina.
// Capture e Instagram continuam podendo manter instalações lógicas próprias para
// sessão/configuração, porém a saúde física da stack é publicada exclusivamente
// pelo Gerenciador. Assim, platform_runtime_heartbeats deixa de representar a
// mesma máquina como várias instalações independentes.
const MANAGER_COMPONENTS=new Set(['worker','gateway','evolution','capture','instagram','realtime']);

function object(value:unknown):Record<string,unknown>{
  return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
}

export default async function handler(req:ApiRequest,res:ApiResponse){
  setCors(req,res);
  if(req.method==='OPTIONS')return res.status(204).end();
  if(req.method!=='POST')return send(req,res,405,{error:'method_not_allowed'});

  try{
    const scope=await installationScope(req);
    const input=body(req);
    const version=text(input.version)||null;

    const touched=await scope.client.rpc('service_touch_tool_installation',{
      p_organizations_id:scope.organizationId,
      p_tool_id:scope.toolId,
      p_external_installation_id:scope.externalInstallationId,
      p_seen:true,
      p_meaningful_activity:Boolean(input.meaningfulActivity),
      p_installed_version:version,
      p_reported_capabilities:capabilities(input.capabilities),
      p_last_seen_member_id:null,
    });
    if(touched.error)throw new Error(touched.error.message);

    const primary=PRIMARY_COMPONENT[scope.toolId];
    // O Gerenciador é o único publicador do runtime físico da máquina.
    // Heartbeats das instalações lógicas de Capture/Instagram somente mantêm
    // a sessão/instalação vivas; não criam mais outra identidade de runtime.
    if(primary&&scope.toolId==='vinsansi_whatsapp_manager'){
      const runtime=await scope.client.rpc('service_runtime_heartbeat',{
        p_organizations_id:scope.organizationId,
        p_component_type:primary,
        p_component_key:scope.externalInstallationId,
        p_component_version:version,
        p_status:text(input.status)||'online',
        p_installation_id:scope.installationId,
        p_metrics:object(input.metrics),
        p_metadata:{toolId:scope.toolId,managedBy:'manager',hostExternalInstallationId:scope.externalInstallationId},
        p_meaningful_activity:Boolean(input.meaningfulActivity),
      });
      if(runtime.error)throw new Error(runtime.error.message);
    }

    if(scope.toolId==='vinsansi_whatsapp_manager'&&Array.isArray(input.components)){
      for(const raw of input.components){
        const item=(raw&&typeof raw==='object'?raw:{}) as Row;
        const type=text(item.type);
        if(!MANAGER_COMPONENTS.has(type))continue;
        const runtime=await scope.client.rpc('service_runtime_heartbeat',{
          p_organizations_id:scope.organizationId,
          p_component_type:type,
          p_component_key:text(item.key)||`${scope.externalInstallationId}:${type}`,
          p_component_version:text(item.version)||null,
          p_status:text(item.status)||'online',
          p_installation_id:scope.installationId,
          p_metrics:object(item.metrics),
          p_metadata:{managedBy:'manager',hostExternalInstallationId:scope.externalInstallationId,...object(item.metadata)},
          p_meaningful_activity:false,
        });
        if(runtime.error)throw new Error(runtime.error.message);
      }
    }

    await scope.client.rpc('refresh_operational_alerts',{p_organizations_id:scope.organizationId});
    return send(req,res,200,{
      ok:true,
      organizationId:scope.organizationId,
      installationId:scope.installationId,
      runtimeAuthority:scope.toolId==='vinsansi_whatsapp_manager'?'manager':'manager-root',
      ttlSeconds:180,
      serverTime:new Date().toISOString(),
    });
  }catch(error){
    return send(req,res,executorStatus(error),{ok:false,error:error instanceof Error?error.message:String(error)});
  }
}
