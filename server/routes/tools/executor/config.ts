import type { ApiRequest,ApiResponse } from '../../../maps/shared.js';
import { send,setCors } from '../../../maps/shared.js';
import { effectiveConfig,executorStatus,installationScope,sessionScope } from '../../../tools/executor.js';
export default async function handler(req:ApiRequest,res:ApiResponse){setCors(req,res);if(req.method==='OPTIONS')return res.status(204).end();if(req.method!=='GET')return send(req,res,405,{error:'method_not_allowed'});try{const scope=await sessionScope(req).catch(()=>installationScope(req));return send(req,res,200,{ok:true,config:await effectiveConfig(scope.client,scope.organizationId,scope.toolId)});}catch(error){return send(req,res,executorStatus(error),{ok:false,error:error instanceof Error?error.message:String(error)});}}
