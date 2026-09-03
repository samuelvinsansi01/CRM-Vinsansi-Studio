import { body,failure,humanScope,integer,query,send,text,type HumanScope,type Stage5Request,type Stage5Response } from '../../whatsapp/stage5.js';

const STAGES=['aguardando_resposta','aguardando_previa','previa_enviada','aprovado','recusado'] as const;
type CommercialStage=(typeof STAGES)[number];
const STAGE_SET=new Set<string>(STAGES);
const TRANSITIONS:Record<CommercialStage,readonly CommercialStage[]>={
  aguardando_resposta:['aguardando_resposta','aguardando_previa','recusado'],
  aguardando_previa:['aguardando_previa','previa_enviada','recusado'],
  previa_enviada:['previa_enviada','aprovado','recusado'],
  aprovado:['aprovado'],
  recusado:['recusado'],
};

function stage(value:unknown):CommercialStage|null{
  const raw=text(value).toLowerCase();
  const normalized=raw==='aguardando_design'?'aguardando_previa':raw==='design_enviado'?'previa_enviada':raw==='fechado'?'aprovado':raw;
  return STAGE_SET.has(normalized)?normalized as CommercialStage:null;
}

function dateOnly(value:unknown){
  const normalized=text(value);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(normalized))throw new Error('preview_due_date_invalid');
  const [year,month,day]=normalized.split('-').map(Number);
  const parsed=new Date(Date.UTC(year,month-1,day));
  if(parsed.getUTCFullYear()!==year||parsed.getUTCMonth()!==month-1||parsed.getUTCDate()!==day)throw new Error('preview_due_date_invalid');
  return normalized;
}

function saoPauloToday(){
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const get=(type:Intl.DateTimeFormatPartTypes)=>parts.find((part)=>part.type===type)?.value??'';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

async function read(scope:HumanScope,conversationId:number){
  const conversation=await scope.admin.from('conversations').select('conversations_id,leads_id').eq('organizations_id',scope.context.organizationId).eq('conversations_id',conversationId).maybeSingle();
  if(conversation.error)throw new Error(conversation.error.message);
  if(!conversation.data)throw new Error('conversation_not_found');

  const leadId=Number(conversation.data.leads_id||0);
  if(!leadId)return {
    contractVersion:'conversation-commercial-v0.3',conversationId,linked:false,leadId:null,leadName:'',alternativeName:'',displayName:'',leadStatusId:null,
    stage:null,editable:false,allowedTransitions:[],previewDueDate:null,previewDueDateEditable:false,updatedAt:null,
  };

  const lead=await scope.admin.from('leads').select('leads_id,lead_status_id,leads_name,leads_alternative_name').eq('organizations_id',scope.context.organizationId).eq('leads_id',leadId).maybeSingle();
  if(lead.error)throw new Error(lead.error.message);
  if(!lead.data)throw new Error('lead_not_found');

  const statusId=Number(lead.data.lead_status_id||0);
  let currentStage:CommercialStage|null=null;
  let updatedAt:string|null=null;
  let previewDueDate:string|null=null;
  const permission=await scope.admin.rpc('stage5_member_has_permission',{p_organizations_id:scope.context.organizationId,p_organization_members_id:scope.memberId,p_permission:'leads.edit'});
  const canEdit=!permission.error&&permission.data===true;

  if(statusId===5){
    const commercial=await scope.admin.from('lead_commercial').select('commercial_stage,preview_due_date,lead_commercial_updated_at').eq('organizations_id',scope.context.organizationId).eq('leads_id',leadId).maybeSingle();
    if(commercial.error)throw new Error(`commercial_stage_read_failed:${commercial.error.message}`);
    currentStage=stage(commercial.data?.commercial_stage)||'aguardando_resposta';
    previewDueDate=text(commercial.data?.preview_due_date)||null;
    updatedAt=text(commercial.data?.lead_commercial_updated_at)||null;
  }

  const leadName=text(lead.data.leads_name);
  const alternativeName=text(lead.data.leads_alternative_name);
  const editable=statusId===5&&canEdit;
  return {
    contractVersion:'conversation-commercial-v0.3',conversationId,linked:true,leadId,leadName,alternativeName,displayName:alternativeName||leadName,leadStatusId:statusId,
    stage:currentStage,editable,allowedTransitions:currentStage?TRANSITIONS[currentStage]:[],previewDueDate,designDueDate:previewDueDate,previewDueDateEditable:editable&&currentStage==='aguardando_previa',updatedAt,
  };
}

function assertEditable(context:Awaited<ReturnType<typeof read>>){
  if(!context.linked||!context.leadId)throw new Error('conversation_lead_not_found');
  if(context.leadStatusId!==5)throw new Error('commercial_stage_requires_sent_lead');
  if(!context.editable)throw new Error('conversation_permission_denied:leads.edit');
}

export default async function handler(req:Stage5Request,res:Stage5Response){
  try{
    if(req.method==='GET'){
      const scope=await humanScope(req,'whatsapp.view');
      const conversationId=integer(query(req,'conversationId'),'conversation_id_required') as number;
      return send(res,200,{ok:true,data:await read(scope,conversationId)});
    }
    if(req.method!=='POST')return send(res,405,{ok:false,error:'method_not_allowed'});

    // Alterar o Comercial dentro de uma conversa exige acesso à conversa + leads.edit.
    // Não exigimos whatsapp.reply porque editar o estágio não é enviar mensagem.
    const input=body(req);
    const scope=await humanScope(req,'whatsapp.view');
    const conversationId=integer(input.conversationId,'conversation_id_required') as number;
    const before=await read(scope,conversationId);
    assertEditable(before);
    const action=text(input.action).toLowerCase()||'stage';

    if(action==='stage'){
      const nextStage=stage(input.stage);
      if(!nextStage)throw new Error('commercial_stage_invalid');
      const changed=await scope.client.rpc('set_lead_commercial_stage_r59',{p_leads_id:before.leadId,p_commercial_stage:nextStage});
      if(changed.error)throw new Error(changed.error.message);
      return send(res,200,{ok:true,data:await read(scope,conversationId)});
    }

    if(action==='preview_due_date'||action==='design_due_date'){
      if(before.stage!=='aguardando_previa')throw new Error('preview_due_date_requires_awaiting_preview');
      const rawDate=text(input.previewDueDate);
      const dueDate=rawDate?dateOnly(rawDate):null;
      if(dueDate&&dueDate<saoPauloToday())throw new Error('preview_due_date_past_invalid');
      const changed=await scope.client.rpc('set_lead_preview_due_date_r59',{p_leads_id:before.leadId,p_preview_due_date:dueDate});
      if(changed.error)throw new Error(changed.error.message);
      return send(res,200,{ok:true,data:await read(scope,conversationId)});
    }

    throw new Error('conversation_commercial_action_invalid');
  }catch(error){return failure(res,error);}
}
