import type { ApiRequest,ApiResponse } from '../../maps/shared.js';
import { send,setCors } from '../../maps/shared.js';
export default async function handler(req:ApiRequest,res:ApiResponse){setCors(req,res);if(req.method==='OPTIONS')return res.status(204).end();return send(req,res,410,{ok:false,error:'instagram_legacy_pair_removed',requiredVersion:'2.0.0',pairing:'/api/tools/browser-pair'});}
