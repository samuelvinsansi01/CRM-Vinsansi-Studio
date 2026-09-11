import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

declare const process: { env: Record<string, string | undefined> };
type Row = Record<string, unknown>;
export type ToolRelease = { toolId:string; latestVersion:string; minimumSupportedVersion:string };
export type ComponentRelease = { version:string; image?:string; digest?:string };
export type HealthPolicy = { runtimeTtlSeconds:number; managerHeartbeatSeconds:number; workerHeartbeatSeconds:number };
export type ReleaseSignature = { algorithm:'ed25519'; keyId:string; value:string };
export type ReleaseResource = { sha256:string };
export type PlatformReleaseManifest = {
  schemaVersion:number; generatedAt:string; releaseSequence:number; issuedAt:string; expiresAt:string;
  productionReady:boolean; resumeAllowed:boolean; schemaTarget:string; securityBaseline:string;
  signature:ReleaseSignature; resources:Record<string,ReleaseResource>; imageDigests:Record<string,string>;
  manager:ToolRelease; capture:ToolRelease; instagram:ToolRelease; healthPolicy:HealthPolicy;
  components:{worker:ComponentRelease;gateway:ComponentRelease;evolution:ComponentRelease;cloudflared:ComponentRelease};
};
const text=(value:unknown)=>String(value??'').trim();
const object=(value:unknown):Row=>value&&typeof value==='object'&&!Array.isArray(value)?value as Row:{};
function env(...keys:string[]){for(const key of keys){const value=text(process.env[key]);if(value)return value;}return '';}
function serviceClient(){const url=env('SUPABASE_URL','VITE_SUPABASE_URL');const key=env('SUPABASE_SERVICE_ROLE_KEY');if(!url||!key)throw new Error('platform_release_backend_not_configured');return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});}

export function canonicalJson(value:unknown):string{
  if(Array.isArray(value))return `[${value.map(canonicalJson).join(',')}]`;
  if(value&&typeof value==='object')return `{${Object.entries(value as Row).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
export function canonicalManifestPayload(manifest:PlatformReleaseManifest){const {signature:_signature,...payload}=manifest;return Buffer.from(canonicalJson(payload),'utf8');}
export function canonicalManifestSha256(manifest:PlatformReleaseManifest){return createHash('sha256').update(canonicalManifestPayload(manifest)).digest('hex');}
export function verifyManifestEd25519(manifest:PlatformReleaseManifest,publicKeyPem:string){
  if(manifest.signature?.algorithm!=='ed25519'||!manifest.signature.value||!publicKeyPem)return false;
  try{return verifySignature(null,canonicalManifestPayload(manifest),createPublicKey(publicKeyPem),Buffer.from(manifest.signature.value,'base64'));}catch{return false;}
}
function tool(value:unknown,expectedId:string):ToolRelease{const row=object(value);const toolId=text(row.toolId);const latestVersion=text(row.latestVersion);const minimumSupportedVersion=text(row.minimumSupportedVersion);if(toolId!==expectedId||!latestVersion||!minimumSupportedVersion)throw new Error(`platform_release_tool_invalid:${expectedId}`);return{toolId,latestVersion,minimumSupportedVersion};}
function component(value:unknown,key:string):ComponentRelease{const row=object(value);const version=text(row.version);const image=text(row.image);const digest=text(row.digest);if(!version)throw new Error(`platform_release_component_invalid:${key}`);if(digest&&!/^sha256:[0-9a-f]{64}$/i.test(digest))throw new Error(`platform_release_digest_invalid:${key}`);return{version,...(image?{image}:{}),...(digest?{digest}:{})};}
function parseManifest(value:unknown):PlatformReleaseManifest{
  const root=object(value);const signature=object(root.signature);const resources=object(root.resources);const imageDigests=object(root.imageDigests);const components=object(root.components);const health=object(root.healthPolicy);
  const manifest:PlatformReleaseManifest={
    schemaVersion:Number(root.schemaVersion),generatedAt:text(root.generatedAt),releaseSequence:Number(root.releaseSequence),issuedAt:text(root.issuedAt),expiresAt:text(root.expiresAt),productionReady:root.productionReady===true,resumeAllowed:root.resumeAllowed===true,schemaTarget:text(root.schemaTarget),securityBaseline:text(root.securityBaseline),
    signature:{algorithm:text(signature.algorithm) as 'ed25519',keyId:text(signature.keyId),value:text(signature.value)},resources:Object.fromEntries(Object.entries(resources).map(([key,item])=>[key,{sha256:text(object(item).sha256)}])),imageDigests:Object.fromEntries(Object.entries(imageDigests).map(([key,d])=>[key,text(d)])),
    manager:tool(root.manager,'vinsansi_whatsapp_manager'),capture:tool(root.capture,'vinsansi_capture'),instagram:tool(root.instagram,'vinsansi_instagram'),
    healthPolicy:{runtimeTtlSeconds:Number(health.runtimeTtlSeconds),managerHeartbeatSeconds:Number(health.managerHeartbeatSeconds),workerHeartbeatSeconds:Number(health.workerHeartbeatSeconds)},
    components:{worker:component(components.worker,'worker'),gateway:component(components.gateway,'gateway'),evolution:component(components.evolution,'evolution'),cloudflared:component(components.cloudflared,'cloudflared')},
  };
  if(manifest.schemaVersion!==2||!Number.isSafeInteger(manifest.releaseSequence)||manifest.releaseSequence<60||manifest.schemaTarget!=='r60'||manifest.securityBaseline!=='r60-security-baseline-v1'||manifest.signature.algorithm!=='ed25519'||!manifest.signature.keyId)throw new Error('platform_release_schema_invalid');
  const issued=Date.parse(manifest.issuedAt),expires=Date.parse(manifest.expiresAt);if(!Number.isFinite(issued)||!Number.isFinite(expires)||expires<=issued||issued>Date.now()+5*60_000)throw new Error('platform_release_time_invalid');
  for(const key of ['manager','worker','gateway','capture','instagram'])if(!/^[0-9a-f]{64}$/i.test(manifest.resources[key]?.sha256||''))throw new Error(`platform_release_resource_hash_invalid:${key}`);
  return manifest;
}

function enforceManifestTrust(manifest:PlatformReleaseManifest){
  if(!manifest.productionReady&&!manifest.resumeAllowed)return;
  const publicKey=env('VINSANSI_RELEASE_PUBLIC_KEY_PEM');
  if(!publicKey)throw new Error('platform_release_public_key_missing');
  if(!verifyManifestEd25519(manifest,publicKey))throw new Error('platform_release_signature_invalid');
  if(Date.parse(manifest.expiresAt)<=Date.now())throw new Error('platform_release_expired');
}

export async function registerVerifiedReleaseCandidate(manifestInput:unknown){
  const manifest=parseManifest(manifestInput);const client=serviceClient();
  const production=manifest.productionReady||manifest.resumeAllowed;
  if(production)enforceManifestTrust(manifest);
  const sha=canonicalManifestSha256(manifest);
  const registered=await client.rpc('service_register_release_candidate_r60',{p_manifest:manifest,p_canonical_manifest_sha256:sha,p_signature_base64:manifest.signature.value||null});
  if(registered.error)throw new Error(registered.error.message);
  const id=String(registered.data??'');if(!id)throw new Error('platform_release_register_empty');
  if(production){const verified=await client.rpc('service_mark_release_signature_verified_r60',{p_release_candidate_id:id,p_key_id:manifest.signature.keyId});if(verified.error)throw new Error(verified.error.message);}
  return {releaseCandidateId:id,canonicalManifestSha256:sha,signatureVerified:production};
}

export async function loadPlatformRelease():Promise<PlatformReleaseManifest>{
  const client=serviceClient();
  const candidate=await client.from('platform_release_candidates').select('manifest,canonical_manifest_sha256,signature_base64,release_sequence,created_at').is('superseded_at',null).order('release_sequence',{ascending:false}).order('created_at',{ascending:false}).limit(1).maybeSingle();
  if(!candidate.error&&candidate.data?.manifest){
    const manifest=parseManifest(candidate.data.manifest);
    if(Number(candidate.data.release_sequence)!==manifest.releaseSequence)throw new Error('platform_release_sequence_mismatch');
    if(canonicalManifestSha256(manifest)!==text(candidate.data.canonical_manifest_sha256))throw new Error('platform_release_hash_mismatch');
    if(text(candidate.data.signature_base64)&&manifest.signature.value!==text(candidate.data.signature_base64))throw new Error('platform_release_signature_mismatch');
    enforceManifestTrust(manifest);
    return manifest;
  }
  const manager=await client.from('platform_tools').select('release_manifest').eq('tool_id','vinsansi_whatsapp_manager').maybeSingle();
  if(manager.error||!manager.data?.release_manifest)throw new Error('platform_release_r60_not_published');
  const manifest=parseManifest(manager.data.release_manifest);enforceManifestTrust(manifest);return manifest;
}
