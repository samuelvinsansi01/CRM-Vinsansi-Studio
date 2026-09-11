import { body,failure,humanScope,integer,rpc,send,text,type Stage5Request,type Stage5Response } from '../../whatsapp/stage5.js';

export default async function handler(req:Stage5Request,res:Stage5Response){
  if(req.method!=='POST')return send(res,405,{ok:false,error:'method_not_allowed'});
  try{
    const input=body(req);const action=text(input.action);
    const permission=action==='transfer'?'whatsapp.assign':action==='read'?'whatsapp.view':action==='promote'?'leads.create':'whatsapp.reply';
    const scope=await humanScope(req,permission);
    const conversationId=integer(input.conversationId,'conversation_id_required');
    let data:unknown;
    if(action==='read'){
      data=await rpc(scope,'service_stage5_mark_read',{p_conversations_id:conversationId,p_last_read_message_id:integer(input.lastReadMessageId,'last_read_message_id_invalid',true)});
    }else if(action==='ignore'){
      data=await rpc(scope,'service_stage5_ignore_contact',{p_conversations_id:conversationId});
    }else if(action==='restore'){
      data=await rpc(scope,'service_stage5_restore_contact',{p_whatsapp_contacts_id:integer(input.contactId,'contact_id_required')});
    }else if(action==='promote'){
      data=await rpc(scope,'service_stage5_promote_unknown_contact',{
        p_conversations_id:conversationId,p_name:text(input.name),p_alternative_name:text(input.alternativeName)||null,
        p_branches_id:integer(input.branchId,'branch_id_required'),p_countries_id:integer(input.countryId,'country_id_required'),
        p_states_id:integer(input.stateId,'state_id_invalid',true),p_cities_id:integer(input.cityId,'city_id_invalid',true),
        p_contact_sources_id:integer(input.contactSourceId,'contact_source_id_required'),p_channels_id:integer(input.channelId,'channel_id_invalid',true)??1,
      });
    }else{
      const expectedVersion=integer(input.expectedVersion,'conversation_version_required');
      if(action==='archive'||action==='unarchive'){
        data=await rpc(scope,'service_stage5_set_archived',{p_conversations_id:conversationId,p_archived:action==='archive',p_expected_version:expectedVersion});
      }else{
        data=await rpc(scope,'service_stage5_assign_conversation',{p_conversations_id:conversationId,p_action:action,p_target_member_id:integer(input.targetMemberId,'target_member_id_invalid',true),p_expected_version:expectedVersion});
      }
    }
    return send(res,200,{ok:true,data});
  }catch(error){return failure(res,error);}
}
