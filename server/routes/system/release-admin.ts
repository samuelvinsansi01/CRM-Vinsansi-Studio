import type {RoutedRequest,RoutedResponse} from '../dispatch.js';
import {adminTokenMatches,armMessagingResume,bundledPlatformRelease,canonicalManifestSha256,homologateReleaseCandidate,promoteReleaseCandidate,registerVerifiedReleaseCandidate} from '../../platform/release.js';
type Row=Record<string,unknown>;
const body=(v:unknown):Row=>{if(typeof v==='string'){try{return JSON.parse(v) as Row}catch{return{}}}return v&&typeof v==='object'&&!Array.isArray(v)?v as Row:{}};
const header=(req:RoutedRequest,n:string)=>{const k=Object.keys(req.headers??{}).find(x=>x.toLowerCase()===n.toLowerCase());const v=k?req.headers?.[k]:undefined;return Array.isArray(v)?String(v[0]??''):String(v??'')};
const storageUnavailable=(e:unknown)=>/schema cache|could not query the database|connection timeout|connection terminated|database.*unavailable|pgrst|control_plane_storage_timeout/i.test(e instanceof Error?e.message:String(e));
const withTimeout=<T>(promise:Promise<T>,ms:number,label:string)=>Promise.race<T>([promise,new Promise<T>((_,reject)=>setTimeout(()=>reject(new Error(label)),ms))]);
export default async function handler(req:RoutedRequest,res:RoutedResponse){
  res.setHeader('Cache-Control','no-store, max-age=0');
  if(!adminTokenMatches(header(req,'x-vinsansi-release-admin-token')))return res.status(401).json({ok:false,error:'release_admin_unauthorized'});
  try{
    const bundled=bundledPlatformRelease();
    // Token/deploy probe must NEVER depend on PostgREST. This endpoint is used by the
    // Windows finalizer specifically to prove that the new deployment + env token are live.
    if(req.method==='GET')return res.status(200).json({ok:true,tokenAccepted:true,databaseAvailable:null,bundledReleaseId:bundled.releaseId,candidates:[],promotions:[]});
    if(req.method!=='POST')return res.status(405).json({ok:false,error:'method_not_allowed'});
    const p=body(req.body),action=String(p.action??'');
    if(action==='publish'){
      const requested=body(p.manifest);
      try{
        return res.status(200).json({ok:true,persistence:'database',...await withTimeout(registerVerifiedReleaseCandidate(p.manifest),3500,'control_plane_storage_timeout')});
      }catch(error){
        if(storageUnavailable(error)&&String(requested.releaseId??'')===bundled.releaseId){
          return res.status(200).json({ok:true,persistence:'deferred',releaseCandidateId:null,canonicalManifestSha256:canonicalManifestSha256(bundled),databaseError:error instanceof Error?error.message:String(error)});
        }
        throw error;
      }
    }
    if(action==='homologate')return res.status(200).json({ok:true,result:await homologateReleaseCandidate(String(p.releaseCandidateId??''))});
    if(action==='promote')return res.status(200).json({ok:true,result:await promoteReleaseCandidate(String(p.releaseCandidateId??''),String(p.actor??'release-admin'))});
    if(action==='arm')return res.status(200).json({ok:true,result:await armMessagingResume({organizationId:Number(p.organizationId),releaseCandidateId:String(p.releaseCandidateId??''),installationId:String(p.installationId??'')})});
    return res.status(400).json({ok:false,error:'release_admin_action_invalid'});
  }catch(e){return res.status(400).json({ok:false,error:e instanceof Error?e.message:String(e)})}
}
