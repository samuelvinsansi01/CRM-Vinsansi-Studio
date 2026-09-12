import type { RoutedRequest, RoutedResponse } from '../dispatch.js';
import { adminTokenMatches, registerVerifiedReleaseCandidate } from '../../platform/release.js';

type Row=Record<string,unknown>;
function body(value:unknown):Row{if(typeof value==='string'){try{return JSON.parse(value) as Row;}catch{return {};}}return value&&typeof value==='object'&&!Array.isArray(value)?value as Row:{};}
function header(req:RoutedRequest,name:string){const key=Object.keys(req.headers??{}).find((item)=>item.toLowerCase()===name.toLowerCase());const value=key?req.headers?.[key]:undefined;return Array.isArray(value)?String(value[0]??''):String(value??'');}
export default async function handler(req:RoutedRequest,res:RoutedResponse){
  res.setHeader('Cache-Control','no-store, max-age=0');
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'method_not_allowed'});
  if(!adminTokenMatches(header(req,'x-vinsansi-release-admin-token')))return res.status(401).json({ok:false,error:'release_admin_unauthorized'});
  try{
    const payload=body(req.body);const manifest=payload.manifest;
    if(!manifest)return res.status(400).json({ok:false,error:'release_manifest_required'});
    const result=await registerVerifiedReleaseCandidate(manifest);
    return res.status(200).json({ok:true,...result});
  }catch(error){return res.status(400).json({ok:false,error:error instanceof Error?error.message:String(error)});}
}
