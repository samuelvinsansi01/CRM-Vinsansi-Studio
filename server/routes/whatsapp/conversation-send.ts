import { randomBytes } from 'node:crypto';
import { body,failure,humanScope,integer,record,rpc,send,text,type Stage5Request,type Stage5Response } from '../../whatsapp/stage5.js';

function providerMessageId(){return randomBytes(10).toString('hex').toUpperCase();}

export default async function handler(req:Stage5Request,res:Stage5Response){
  if(req.method!=='POST')return send(res,405,{ok:false,error:'method_not_allowed'});
  try{
    const input=body(req);const scope=await humanScope(req,'whatsapp.reply');
    if(text(input.messageType)&&text(input.messageType)!=='text')throw new Error('media_disabled_text_only');
    const conversationId=integer(input.conversationId,'conversation_id_required') as number;
    const currentConversation=await scope.admin.from('conversations').select('conversation_version').eq('organizations_id',scope.context.organizationId).eq('conversations_id',conversationId).maybeSingle();
    if(currentConversation.error)throw new Error(currentConversation.error.message);if(!currentConversation.data)throw new Error('conversation_not_found');
    const expectedVersion=integer(currentConversation.data.conversation_version,'conversation_version_required') as number;
    const prepared=record(await rpc(scope,'service_stage5_prepare_manual_message',{
      p_conversations_id:conversationId,
      p_expected_version:expectedVersion,
      p_client_idempotency_key:text(input.idempotencyKey),
      p_message_body:text(input.body)||null,
      p_message_type:'text',p_media_storage_path:null,p_media_mime_type:null,p_media_file_name:null,p_media_size_bytes:null,
    }));
    const currentStatus=text(prepared.status);
    if(prepared.idempotent===true&&!['pending','sending'].includes(currentStatus)){
      return send(res,['reconciliation_required'].includes(currentStatus)?202:200,{ok:true,prepared,data:prepared,status:currentStatus,external_message_id:text(prepared.externalMessageId)||null});
    }

    const messageId=integer(prepared.messageId,'message_id_required') as number;
    const current=await scope.admin.from('conversation_messages').select('external_message_id,raw_payload,message_status')
      .eq('organizations_id',scope.context.organizationId).eq('conversation_messages_id',messageId).maybeSingle();
    if(current.error||!current.data)throw new Error(current.error?.message||'manual_message_not_found');
    const existingPayload=current.data.raw_payload&&typeof current.data.raw_payload==='object'&&!Array.isArray(current.data.raw_payload)?current.data.raw_payload as Record<string,unknown>:{};
    const reservedMessageId=(text(current.data.external_message_id)||providerMessageId()).toUpperCase();
    if(!/^[A-F0-9]{20}$/.test(reservedMessageId))throw new Error('manual_message_external_id_invalid');
    const queuedAt=new Date().toISOString();
    const rawPayload={...existingPayload,manualDispatchTransport:'worker_local',manualDispatchQueuedAt:queuedAt,manualDispatchVersion:1,manualDispatchNextAttemptAt:null};
    if(currentStatus==='pending'||current.data.message_status==='pending'){
      const queued=await scope.admin.from('conversation_messages').update({external_message_id:reservedMessageId,raw_payload:rawPayload,error_message:null,conversation_messages_updated_at:queuedAt})
        .eq('organizations_id',scope.context.organizationId).eq('conversation_messages_id',messageId).eq('message_status','pending')
        .select('conversation_messages_id,message_status,external_message_id').maybeSingle();
      if(queued.error)throw new Error(queued.error.message);
    }
    return send(res,202,{ok:true,prepared,status:text(current.data.message_status)==='sending'?'sending':'pending',external_message_id:reservedMessageId,queued:true,transport:'worker_local'});
  }catch(error){return failure(res,error);}
}
