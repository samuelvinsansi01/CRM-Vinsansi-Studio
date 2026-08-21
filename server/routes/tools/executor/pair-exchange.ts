import type { ApiRequest,ApiResponse } from '../../../maps/shared.js';
import { body,send,setCors } from '../../../maps/shared.js';
import { exchangePairing,executorStatus } from '../../../tools/executor.js';
export default async function handler(req:ApiRequest,res:ApiResponse){setCors(req,res);if(req.method==='OPTIONS')return res.status(204).end();if(req.method!=='POST')return send(req,res,405,{error:'method_not_allowed'});try{return send(req,res,200,{ok:true,...await exchangePairing(body(req))});}catch(error){return send(req,res,executorStatus(error),{ok:false,error:error instanceof Error?error.message:String(error)});}}
