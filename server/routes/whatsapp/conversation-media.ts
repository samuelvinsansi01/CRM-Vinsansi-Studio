import { allowedMedia,body,failure,humanScope,integer,safeFileName,send,text,type Stage5Request,type Stage5Response } from '../../whatsapp/stage5.js';

export default async function handler(req:Stage5Request,res:Stage5Response){
  if(req.method!=='POST')return send(res,405,{ok:false,error:'method_not_allowed'});
  try{
    const input=body(req);const mode=text(input.mode);
    const scope=await humanScope(req,mode==='upload-url'?'whatsapp.reply':'whatsapp.view');
    if(mode==='upload-url'){
      const conversationId=integer(input.conversationId,'conversation_id_required') as number;
      const mime=text(input.mimeType);const size=Number(input.size);
      if(!allowedMedia(mime,size))throw new Error('media_type_or_size_invalid');
      const conversation=await scope.admin.from('conversations').select('conversations_id').eq('organizations_id',scope.context.organizationId).eq('conversations_id',conversationId).maybeSingle();
      if(conversation.error||!conversation.data)throw new Error('conversation_not_found');
      const path=`${scope.context.organizationId}/${conversationId}/pending/${crypto.randomUUID()}-${safeFileName(input.fileName)}`;
      const signed=await scope.admin.storage.from('conversation-media').createSignedUploadUrl(path);
      if(signed.error)throw new Error(`media_upload_url_failed:${signed.error.message}`);
      return send(res,200,{ok:true,path,signedUrl:signed.data.signedUrl,token:signed.data.token,maxBytes:26214400});
    }
    if(mode==='view-url'){
      const path=text(input.path);if(!path.startsWith(`${scope.context.organizationId}/`))throw new Error('media_cross_organization_forbidden');
      const message=await scope.admin.from('conversation_messages').select('conversation_messages_id').eq('organizations_id',scope.context.organizationId).eq('media_storage_path',path).maybeSingle();
      if(message.error||!message.data)throw new Error('media_not_found');
      const signed=await scope.admin.storage.from('conversation-media').createSignedUrl(path,300);
      if(signed.error)throw new Error(`media_signed_url_failed:${signed.error.message}`);
      return send(res,200,{ok:true,signedUrl:signed.data.signedUrl,expiresIn:300});
    }
    throw new Error('media_operation_invalid');
  }catch(error){return failure(res,error);}
}
