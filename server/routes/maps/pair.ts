import type { ApiRequest,ApiResponse } from '../../maps/shared.js';
import { send,setCors } from '../../maps/shared.js';
export default async function handler(req:ApiRequest,res:ApiResponse){if(req.method==='OPTIONS'){setCors(req,res);res.status(204).end();return;}return send(req,res,410,{ok:false,code:'maps_pairing_deprecated',message:'Atualize para Vinsansi Captura 1.0.1 e use /api/tools/browser-pair.'});}
