import { bool,failure,humanScope,integer,query,rpc,send,type Stage5Request,type Stage5Response } from '../../whatsapp/stage5.js';

export default async function handler(req:Stage5Request,res:Stage5Response){
  if(req.method!=='GET')return send(res,405,{ok:false,error:'method_not_allowed'});
  try{
    const scope=await humanScope(req,'whatsapp.view');
    const data=await rpc(scope,'service_stage5_list_conversations',{
      p_chip_id:integer(query(req,'chipId'),'chip_id_invalid',true),p_scope:query(req,'scope')||'all',
      p_unread_only:bool(query(req,'unreadOnly')),p_archived:bool(query(req,'archived')),p_search:query(req,'search')||null,
      p_cursor_at:query(req,'cursorAt')||null,p_cursor_id:integer(query(req,'cursorId'),'cursor_id_invalid',true),
      p_limit:Math.min(100,Math.max(1,Number(query(req,'limit')||50))),
    });
    return send(res,200,{ok:true,...(data as object)});
  }catch(error){return failure(res,error);}
}
