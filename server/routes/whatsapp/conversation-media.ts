import { body,failure,humanScope,send,text,type Stage5Request,type Stage5Response } from '../../whatsapp/stage5.js';

export default async function handler(req:Stage5Request,res:Stage5Response){
  if(req.method!=='POST')return send(res,405,{ok:false,error:'method_not_allowed'});
  try{
    const input=body(req);const mode=text(input.mode);
    await humanScope(req,mode==='upload-url'?'whatsapp.reply':'whatsapp.view');
    return send(res,410,{ok:false,error:'media_disabled_text_only'});
  }catch(error){return failure(res,error);}
}
