import { body,evolutionCommand,failure,humanScope,integer,record,rpc,send,text,type Stage5Request,type Stage5Response } from '../../whatsapp/stage5.js';
export default async function handler(req:Stage5Request,res:Stage5Response){
  if(req.method!=='POST')return send(res,405,{ok:false,error:'method_not_allowed'});
  try{
    const input=body(req);const operation=text(input.operation);const scope=await humanScope(req,'whatsapp.reply');
    if(operation==='report'){
      const data=await rpc(scope,'service_stage5_report_manual_message',{p_conversation_messages_id:integer(input.messageId,'message_id_required'),p_status:text(input.status),p_external_message_id:text(input.externalMessageId)||null,p_error_message:text(input.errorMessage)||null,p_provider_payload:record(input.providerPayload)});
      return send(res,200,{ok:true,data});
    }
    if(operation!=='prepare')throw new Error('manual_message_operation_invalid');
    const messageType=text(input.messageType)||'text';
    if(messageType!=='text'||text(input.mediaStoragePath)||text(input.mediaMimeType)||text(input.mediaFileName)||input.mediaSizeBytes!==undefined&&input.mediaSizeBytes!==null)throw new Error('media_disabled_text_only');
    const prepared=record(await rpc(scope,'service_stage5_prepare_manual_message',{p_conversations_id:integer(input.conversationId,'conversation_id_required'),p_expected_version:integer(input.expectedVersion,'conversation_version_required'),p_client_idempotency_key:text(input.idempotencyKey),p_message_body:text(input.body)||null,p_message_type:'text',p_media_storage_path:null,p_media_mime_type:null,p_media_file_name:null,p_media_size_bytes:null}));
    if(prepared.idempotent===true&&['sent','delivered','read','reconciliation_required'].includes(text(prepared.status)))return send(res,200,{ok:true,prepared,command:null});
    const command=await evolutionCommand(scope,integer(prepared.instancesId,'conversation_instance_required') as number);
    return send(res,200,{ok:true,prepared,command:{...command,recipient:text(prepared.recipient)}});
  }catch(error){return failure(res,error);}
}
