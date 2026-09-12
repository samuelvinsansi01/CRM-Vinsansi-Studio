import { readFile } from 'node:fs/promises';
const base=String(process.env.CONTROL_PLANE_URL||process.env.PUBLIC_APP_URL||'').trim().replace(/\/$/,'');
const token=String(process.env.CONTROL_PLANE_RELEASE_ADMIN_TOKEN||'').trim();
if(!base)throw new Error('CONTROL_PLANE_URL_or_PUBLIC_APP_URL_required');
if(!token)throw new Error('CONTROL_PLANE_RELEASE_ADMIN_TOKEN_required');
const manifest=JSON.parse(await readFile(new URL('../R60_CANDIDATE_MANIFEST.json',import.meta.url),'utf8'));
if(manifest.schemaVersion!==2||manifest.releaseStage!=='candidate'||manifest.productionReady!==false||manifest.resumeAllowed!==false)throw new Error('candidate_manifest_not_publishable');
const endpoint=new URL('/api/system?route=release-candidate',base);
const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),20_000);
try{
  const response=await fetch(endpoint,{method:'POST',redirect:'error',signal:controller.signal,headers:{'Content-Type':'application/json','Accept':'application/json','X-Vinsansi-Release-Admin-Token':token},body:JSON.stringify({manifest})});
  const payload=await response.json().catch(()=>({}));
  if(!response.ok||payload.ok!==true)throw new Error(String(payload.error||`publish_http_${response.status}`));
  console.log(`R60 Candidate publicada: ${manifest.releaseId} • sequence ${manifest.releaseSequence} • sha ${payload.canonicalManifestSha256||'n/a'}`);
}finally{clearTimeout(timer);}
