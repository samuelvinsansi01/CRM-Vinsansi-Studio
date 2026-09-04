import { randomBytes } from 'node:crypto';
import { body,evolutionCommand,failure,humanScope,integer,providerRecipientForConversation,record,rpc,send,text,type Stage5Request,type Stage5Response } from '../../whatsapp/stage5.js';

type ProviderError = Error & { explicit?: boolean; uncertain?: boolean; payload?: Record<string,unknown> };

function externalMessageId(payload: Record<string, unknown>) {
  return text(payload.messageId || payload.id || payload.externalMessageId || payload.external_id);
}

function providerMessageId(){return randomBytes(10).toString('hex').toUpperCase();}

async function gatewaySend(instanceUrl:string,instanceName:string,apiKey:string,recipient:string,message:string,reservedMessageId:string){
  if(!instanceUrl||!instanceName||!apiKey||!recipient||!/^[A-F0-9]{20}$/.test(reservedMessageId)){
    const error=new Error('manual_gateway_command_invalid') as ProviderError;error.explicit=true;throw error;
  }
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),30_000);
  try{
    const endpoint=`${instanceUrl.replace(/\/$/,'')}/v1/whatsapp/instances/${encodeURIComponent(instanceName)}/messages/text`;
    const response=await fetch(endpoint,{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json',apikey:apiKey},body:JSON.stringify({number:recipient,text:message,delay:0,messageId:reservedMessageId}),signal:controller.signal});
    const raw=await response.text();let payload:Record<string,unknown>={};try{payload=raw?JSON.parse(raw) as Record<string,unknown>:{};}catch{payload={raw};}
    if(!response.ok){
      const error=new Error(String(payload.error||payload.message||`gateway_http_${response.status}`)) as ProviderError;
      error.payload=payload;
      error.uncertain=payload.uncertain===true;
      error.explicit=!error.uncertain;
      throw error;
    }
    const id=externalMessageId(payload)||reservedMessageId;
    if(id!==reservedMessageId){const error=new Error('manual_gateway_provider_id_mismatch') as ProviderError;error.uncertain=true;error.payload=payload;throw error;}
    return {externalMessageId:reservedMessageId,payload};
  }catch(error){
    if((error as {name?:string})?.name==='AbortError'){const uncertain=new Error('manual_gateway_timeout_uncertain') as ProviderError;uncertain.uncertain=true;throw uncertain;}
    if(error instanceof TypeError){const uncertain=new Error(`manual_gateway_transport_uncertain:${error.message}`) as ProviderError;uncertain.uncertain=true;throw uncertain;}
    throw error;
  }
  finally{clearTimeout(timer);}
}

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
    // Repetir a mesma idempotency key jamais causa um segundo POST ao provider.
    // Isso cobre refresh de sessão, double-click e repetição da mesma requisição.
    if(prepared.idempotent===true)return send(res,['pending','sending','reconciliation_required'].includes(currentStatus)?202:200,{ok:true,prepared,data:prepared,status:currentStatus});

    const messageId=integer(prepared.messageId,'message_id_required') as number;
    const reservedMessageId=(text(prepared.externalMessageId)||providerMessageId()).toUpperCase();
    if(!/^[A-F0-9]{20}$/.test(reservedMessageId))throw new Error('manual_message_external_id_invalid');

    // A identidade do provider é persistida ANTES do primeiro byte sair para o Gateway.
    // Assim, se o webhook chegar primeiro, ele converge na mesma linha do operador.
    await rpc(scope,'service_stage5_report_manual_message',{p_conversation_messages_id:messageId,p_status:'sending',p_external_message_id:reservedMessageId,p_error_message:null,p_provider_payload:{reservedMessageId}});

    let command;
    let recipient='';
    try{
      command=await evolutionCommand(scope,integer(prepared.instancesId,'conversation_instance_required') as number);
      recipient=await providerRecipientForConversation(scope,conversationId,text(prepared.recipient));
      if(!recipient)throw new Error('conversation_recipient_not_found');
    }catch(error){
      await rpc(scope,'service_stage5_report_manual_message',{p_conversation_messages_id:messageId,p_status:'failed',p_external_message_id:reservedMessageId,p_error_message:error instanceof Error?error.message:String(error),p_provider_payload:{}}).catch(()=>undefined);
      throw error;
    }

    let sent:{externalMessageId:string;payload:Record<string,unknown>};
    try{
      sent=await gatewaySend(text(command.instanceUrl),text(command.instanceName),text(command.apiKey),recipient,text(input.body),reservedMessageId);
    }catch(error){
      const providerError=error as ProviderError;
      const status=providerError.uncertain?'reconciliation_required':'failed';
      const providerActualId=text(providerError.payload?.providerMessageId).toUpperCase();
      const convergedMessageId=/^[A-F0-9]{20}$/.test(providerActualId)?providerActualId:reservedMessageId;
      const data=await rpc(scope,'service_stage5_report_manual_message',{p_conversation_messages_id:messageId,p_status:status,p_external_message_id:convergedMessageId,p_error_message:error instanceof Error?error.message:String(error),p_provider_payload:providerError.payload??{}}).catch(()=>null);
      if(providerError.uncertain)return send(res,202,{ok:true,prepared,data,status:'reconciliation_required',external_message_id:convergedMessageId});
      throw error;
    }

    try{
      const data=await rpc(scope,'service_stage5_report_manual_message',{p_conversation_messages_id:messageId,p_status:'sent',p_external_message_id:reservedMessageId,p_error_message:null,p_provider_payload:sent.payload});
      return send(res,200,{ok:true,prepared,data,status:'sent',external_message_id:reservedMessageId});
    }catch(error){
      // O provider confirmou. Se a persistência final falhar, o webhook ainda possui a
      // mesma identidade reservada e concluirá a linha. Nunca reenviar automaticamente.
      await rpc(scope,'service_stage5_report_manual_message',{p_conversation_messages_id:messageId,p_status:'reconciliation_required',p_external_message_id:reservedMessageId,p_error_message:error instanceof Error?error.message:String(error),p_provider_payload:sent.payload}).catch(()=>undefined);
      return send(res,202,{ok:true,prepared,status:'reconciliation_required',external_message_id:reservedMessageId,persistenceError:error instanceof Error?error.message:String(error)});
    }
  }catch(error){return failure(res,error);}
}
