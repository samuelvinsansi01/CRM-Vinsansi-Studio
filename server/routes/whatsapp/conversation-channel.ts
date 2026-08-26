import { body,evolutionCommand,failure,humanScope,integer,send,text,type Stage5Request,type Stage5Response } from '../../whatsapp/stage5.js';

export default async function handler(req:Stage5Request,res:Stage5Response){
  if(req.method!=='POST')return send(res,405,{ok:false,error:'method_not_allowed'});
  try{
    const input=body(req);const scope=await humanScope(req,'whatsapp.reply');const conversationId=integer(input.conversationId,'conversation_id_required') as number;
    const found=await scope.admin.from('conversations').select('conversations_id,instances_id,contact_phone,remote_jid,conversation_status,assigned_to_member_id').eq('organizations_id',scope.context.organizationId).eq('conversations_id',conversationId).maybeSingle();
    if(found.error||!found.data)throw new Error('conversation_not_found');
    if(text(found.data.conversation_status)==='archived')throw new Error('conversation_archived');
    const assigned=Number(found.data.assigned_to_member_id||0);if(assigned&&assigned!==scope.memberId)throw new Error('conversation_assigned_to_other_member');
    const command=await evolutionCommand(scope,Number(found.data.instances_id));const recipient=text(found.data.remote_jid)||text(found.data.contact_phone);
    if(!recipient)throw new Error('conversation_recipient_not_found');
    return send(res,200,{ok:true,command:{...command,recipient}});
  }catch(error){return failure(res,error);}
}
