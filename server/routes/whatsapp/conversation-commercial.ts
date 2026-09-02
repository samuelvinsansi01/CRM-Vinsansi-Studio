import { body,failure,humanScope,integer,query,send,text,type Stage5Request,type Stage5Response } from '../../whatsapp/stage5.js';

const STAGES=new Set(['aguardando_resposta','aguardando_design','design_enviado','fechado','recusado']);
async function read(scope:Awaited<ReturnType<typeof humanScope>>,conversationId:number){
  const conversation=await scope.admin.from('conversations').select('conversations_id,leads_id').eq('organizations_id',scope.context.organizationId).eq('conversations_id',conversationId).maybeSingle();
  if(conversation.error)throw new Error(conversation.error.message);if(!conversation.data)throw new Error('conversation_not_found');
  const leadId=Number(conversation.data.leads_id||0);if(!leadId)return {linked:false,leadId:null,leadName:'',alternativeName:'',leadStatusId:null,stage:null,editable:false,updatedAt:null};
  const lead=await scope.admin.from('leads').select('leads_id,lead_status_id,leads_name,leads_alternative_name').eq('organizations_id',scope.context.organizationId).eq('leads_id',leadId).maybeSingle();
  if(lead.error)throw new Error(lead.error.message);if(!lead.data)throw new Error('lead_not_found');
  const statusId=Number(lead.data.lead_status_id||0);let stage:string|null=null,updatedAt:string|null=null;
  const permission=await scope.admin.rpc('stage5_member_has_permission',{p_organizations_id:scope.context.organizationId,p_organization_members_id:scope.memberId,p_permission:'leads.edit'});
  const canEdit=!permission.error&&permission.data===true;
  if(statusId===5){
    const commercial=await scope.admin.from('lead_commercial').select('commercial_stage,lead_commercial_updated_at').eq('organizations_id',scope.context.organizationId).eq('leads_id',leadId).maybeSingle();
    if(commercial.error)throw new Error(`commercial_stage_read_failed:${commercial.error.message}`);
    stage=text(commercial.data?.commercial_stage)||'aguardando_resposta';updatedAt=text(commercial.data?.lead_commercial_updated_at)||null;
  }
  return {linked:true,leadId,leadName:text(lead.data.leads_name),alternativeName:text(lead.data.leads_alternative_name),leadStatusId:statusId,stage,editable:statusId===5&&canEdit,updatedAt};
}
export default async function handler(req:Stage5Request,res:Stage5Response){
  try{
    if(req.method==='GET'){
      const scope=await humanScope(req,'whatsapp.view');const conversationId=integer(query(req,'conversationId'),'conversation_id_required') as number;
      return send(res,200,{ok:true,data:await read(scope,conversationId)});
    }
    if(req.method!=='POST')return send(res,405,{ok:false,error:'method_not_allowed'});
    const input=body(req);const scope=await humanScope(req,'whatsapp.reply');const conversationId=integer(input.conversationId,'conversation_id_required') as number;const stage=text(input.stage).toLowerCase();if(!STAGES.has(stage))throw new Error('commercial_stage_invalid');
    const before=await read(scope,conversationId);if(!before.leadId)throw new Error('conversation_lead_not_found');
    const changed=await scope.client.rpc('set_lead_commercial_stage_r59',{p_leads_id:before.leadId,p_commercial_stage:stage});if(changed.error)throw new Error(changed.error.message);
    return send(res,200,{ok:true,data:await read(scope,conversationId)});
  }catch(error){return failure(res,error);}
}
