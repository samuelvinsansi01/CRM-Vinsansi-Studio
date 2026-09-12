import bundledCandidateJson from '../../R60_CANDIDATE_MANIFEST.json' with { type: 'json' };
import { createHash, createPublicKey, timingSafeEqual, verify as verifySignature } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

declare const process: { env: Record<string, string | undefined> };
type Row = Record<string, unknown>;
export type ReleaseStage='candidate'|'production';
export type ToolRelease = { toolId:string; latestVersion:string; minimumSupportedVersion:string };
export type ComponentRelease = { version:string; image?:string; digest?:string };
export type HealthPolicy = { runtimeTtlSeconds:number; managerHeartbeatSeconds:number; workerHeartbeatSeconds:number };
export type ReleaseSignature = { algorithm:'ed25519'; keyId:string|null; signature:string|null };
export type ReleaseResource = { sha256:string };
export type ReleaseDistribution = { manager:{kind:'windows-nsis';url:string|null;sha256:string|null} };
export type PlatformReleaseManifest = {
  schemaVersion:2; releaseId:string; release:string; releaseStage:ReleaseStage; generatedAt:string; releaseSequence:number; issuedAt:string; expiresAt:string;
  productionReady:boolean; resumeAllowed:boolean; schemaTarget:string; securityBaseline:string;
  signature:ReleaseSignature; resources:Record<string,ReleaseResource>; imageDigests:Record<string,string>; distribution:ReleaseDistribution;
  manager:ToolRelease; capture:ToolRelease; instagram:ToolRelease; healthPolicy:HealthPolicy;
  components:{worker:ComponentRelease;gateway:ComponentRelease;evolution:ComponentRelease;cloudflared:ComponentRelease};
};
const text=(value:unknown)=>String(value??'').trim();
const nullableText=(value:unknown)=>{const valueText=text(value);return valueText||null;};
const object=(value:unknown):Row=>value&&typeof value==='object'&&!Array.isArray(value)?value as Row:{};
function env(...keys:string[]){for(const key of keys){const value=text(process.env[key]);if(value)return value;}return '';}
function serviceClient(){const url=env('SUPABASE_URL','VITE_SUPABASE_URL');const key=env('SUPABASE_SERVICE_ROLE_KEY');if(!url||!key)throw new Error('platform_release_backend_not_configured');return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});}

export function canonicalJson(value:unknown):string{
  if(Array.isArray(value))return `[${value.map(canonicalJson).join(',')}]`;
  if(value&&typeof value==='object')return `{${Object.entries(value as Row).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>`${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
export function canonicalManifestPayload(manifest:PlatformReleaseManifest){const {signature:_signature,...payload}=manifest;return Buffer.from(canonicalJson(payload),'utf8');}
export function canonicalManifestSha256(manifest:PlatformReleaseManifest){return createHash('sha256').update(canonicalManifestPayload(manifest)).digest('hex');}
export function verifyManifestEd25519(manifest:PlatformReleaseManifest,publicKeyPem:string){
  const signature=manifest.signature?.signature;
  if(manifest.signature?.algorithm!=='ed25519'||!signature||!manifest.signature.keyId||!publicKeyPem)return false;
  try{return verifySignature(null,canonicalManifestPayload(manifest),createPublicKey(publicKeyPem),Buffer.from(signature,'base64'));}catch{return false;}
}
function tool(value:unknown,expectedId:string):ToolRelease{const row=object(value);const toolId=text(row.toolId);const latestVersion=text(row.latestVersion);const minimumSupportedVersion=text(row.minimumSupportedVersion);if(toolId!==expectedId||!latestVersion||!minimumSupportedVersion)throw new Error(`platform_release_tool_invalid:${expectedId}`);return{toolId,latestVersion,minimumSupportedVersion};}
function component(value:unknown,key:string):ComponentRelease{const row=object(value);const version=text(row.version);const image=text(row.image);const digest=text(row.digest);if(!version)throw new Error(`platform_release_component_invalid:${key}`);if(digest&&!/^sha256:[0-9a-f]{64}$/i.test(digest))throw new Error(`platform_release_digest_invalid:${key}`);return{version,...(image?{image}:{}),...(digest?{digest}:{})};}
function parseDistribution(value:unknown):ReleaseDistribution{const row=object(value);const manager=object(row.manager);const kind=text(manager.kind)||'windows-nsis';const url=nullableText(manager.url);const sha256=nullableText(manager.sha256);if(kind!=='windows-nsis')throw new Error('platform_release_distribution_kind_invalid');if(sha256&&!/^[0-9a-f]{64}$/i.test(sha256))throw new Error('platform_release_distribution_hash_invalid');if(url){let parsed:URL;try{parsed=new URL(url);}catch{throw new Error('platform_release_distribution_url_invalid');}if(parsed.protocol!=='https:')throw new Error('platform_release_distribution_url_invalid');}return {manager:{kind:'windows-nsis',url,sha256}};}
export function parsePlatformReleaseManifest(value:unknown):PlatformReleaseManifest{
  const root=object(value);
  const required=['schemaVersion','releaseId','release','releaseStage','generatedAt','releaseSequence','issuedAt','expiresAt','productionReady','resumeAllowed','schemaTarget','securityBaseline','signature','resources','imageDigests','distribution','manager','capture','instagram','healthPolicy','components'];
  if(required.some((key)=>!(key in root)))throw new Error('platform_release_required_field_missing');
  const signature=object(root.signature);const resources=object(root.resources);const imageDigests=object(root.imageDigests);const components=object(root.components);const health=object(root.healthPolicy);
  if(!('algorithm' in signature)||!('keyId' in signature)||!('signature' in signature)||!('manager' in object(root.distribution)))throw new Error('platform_release_required_field_missing');
  const manifest:PlatformReleaseManifest={
    schemaVersion:Number(root.schemaVersion) as 2,releaseId:text(root.releaseId),release:text(root.release),releaseStage:text(root.releaseStage) as ReleaseStage,generatedAt:text(root.generatedAt),releaseSequence:Number(root.releaseSequence),issuedAt:text(root.issuedAt),expiresAt:text(root.expiresAt),productionReady:root.productionReady===true,resumeAllowed:root.resumeAllowed===true,schemaTarget:text(root.schemaTarget),securityBaseline:text(root.securityBaseline),
    signature:{algorithm:text(signature.algorithm) as 'ed25519',keyId:nullableText(signature.keyId),signature:nullableText(signature.signature)},resources:Object.fromEntries(Object.entries(resources).map(([key,item])=>[key,{sha256:text(object(item).sha256)}])),imageDigests:Object.fromEntries(Object.entries(imageDigests).map(([key,d])=>[key,text(d)])),distribution:parseDistribution(root.distribution),
    manager:tool(root.manager,'vinsansi_whatsapp_manager'),capture:tool(root.capture,'vinsansi_capture'),instagram:tool(root.instagram,'vinsansi_instagram'),
    healthPolicy:{runtimeTtlSeconds:Number(health.runtimeTtlSeconds),managerHeartbeatSeconds:Number(health.managerHeartbeatSeconds),workerHeartbeatSeconds:Number(health.workerHeartbeatSeconds)},
    components:{worker:component(components.worker,'worker'),gateway:component(components.gateway,'gateway'),evolution:component(components.evolution,'evolution'),cloudflared:component(components.cloudflared,'cloudflared')},
  };
  if(manifest.schemaVersion!==2||!manifest.releaseId||!manifest.release||!['candidate','production'].includes(manifest.releaseStage)||!Number.isSafeInteger(manifest.releaseSequence)||manifest.releaseSequence<60||manifest.schemaTarget!=='r60'||manifest.securityBaseline!=='r60-security-baseline-v1'||manifest.signature.algorithm!=='ed25519')throw new Error('platform_release_schema_invalid');
  const generated=Date.parse(manifest.generatedAt),issued=Date.parse(manifest.issuedAt),expires=Date.parse(manifest.expiresAt);if(!Number.isFinite(generated)||!Number.isFinite(issued)||!Number.isFinite(expires)||expires<=issued||expires<=Date.now()||issued>Date.now()+5*60_000||generated>Date.now()+5*60_000)throw new Error('platform_release_time_invalid');
  for(const key of ['manager','worker','gateway','capture','instagram'])if(!/^[0-9a-f]{64}$/i.test(manifest.resources[key]?.sha256||''))throw new Error(`platform_release_resource_hash_invalid:${key}`);
  for(const [key,digest] of Object.entries(manifest.imageDigests)){if(digest&&!/^sha256:[0-9a-f]{64}$/i.test(digest))throw new Error(`platform_release_image_digest_invalid:${key}`);}
  if(manifest.releaseStage==='candidate'){
    if(manifest.productionReady||manifest.resumeAllowed)throw new Error('candidate_release_flags_invalid');
    if(manifest.signature.keyId!==null||manifest.signature.signature!==null)throw new Error('candidate_release_must_be_unsigned');
  }else{
    if(!manifest.productionReady||!manifest.resumeAllowed||!manifest.signature.keyId||manifest.signature.keyId==='LOCAL_TEST_ONLY'||!manifest.signature.signature)throw new Error('production_release_flags_invalid');
    if(!manifest.distribution.manager.url||!manifest.distribution.manager.sha256)throw new Error('production_release_distribution_required');
    for(const key of ['worker','gateway','evolution','cloudflared'])if(!/^sha256:[0-9a-f]{64}$/i.test(manifest.imageDigests[key]||''))throw new Error(`production_release_digest_required:${key}`);
  }
  return manifest;
}

function enforceManifestTrust(manifest:PlatformReleaseManifest){
  if(manifest.releaseStage==='candidate')return;
  const publicKey=env('VINSANSI_RELEASE_PUBLIC_KEY_PEM');
  if(!publicKey)throw new Error('platform_release_public_key_missing');
  if(!verifyManifestEd25519(manifest,publicKey))throw new Error('platform_release_signature_invalid');
  if(Date.parse(manifest.expiresAt)<=Date.now())throw new Error('platform_release_expired');
}
async function reconcileLegacyToolCatalog(client:ReturnType<typeof serviceClient>,manifest:PlatformReleaseManifest){
  const projections=[manifest.manager,manifest.capture,manifest.instagram];
  for(const item of projections){
    const updated=await client.from('platform_tools').update({latest_version:item.latestVersion,minimum_supported_version:item.minimumSupportedVersion,updated_at:new Date().toISOString()}).eq('tool_id',item.toolId);
    if(updated.error)throw new Error(`platform_tools_projection_failed:${item.toolId}:${updated.error.message}`);
  }
}
function missingRpc(error:{message?:string}|null|undefined){return /could not find the function|function .* does not exist|schema cache|not found/i.test(String(error?.message||''));}
async function directBootstrapCandidate(client:ReturnType<typeof serviceClient>,manifest:PlatformReleaseManifest,sha:string){
  if(manifest.releaseStage!=='candidate')throw new Error('platform_release_hardening_required_for_production');
  const row={release_sequence:manifest.releaseSequence,schema_version:2,schema_target:manifest.schemaTarget,security_baseline:manifest.securityBaseline,issued_at:manifest.issuedAt,expires_at:manifest.expiresAt,production_ready:false,resume_allowed:false,manifest,canonical_manifest_sha256:sha,signature_algorithm:'ed25519',signature_base64:null,signature_key_id:null,signature_verified_at:null,component_hashes:manifest.resources,docker_digests:manifest.imageDigests};
  const inserted=await client.from('platform_release_candidates').upsert(row,{onConflict:'release_sequence,canonical_manifest_sha256'}).select('release_candidate_id').single();
  if(inserted.error)throw new Error(`platform_release_bootstrap_register_failed:${inserted.error.message}`);
  return String(inserted.data?.release_candidate_id||'');
}

export async function registerVerifiedReleaseCandidate(manifestInput:unknown){
  const manifest=parsePlatformReleaseManifest(manifestInput);const client=serviceClient();
  enforceManifestTrust(manifest);
  const sha=canonicalManifestSha256(manifest);
  const registered=await client.rpc('service_register_release_candidate_r60',{p_manifest:manifest,p_canonical_manifest_sha256:sha,p_signature_base64:manifest.signature.signature});
  let id='';
  if(registered.error){if(missingRpc(registered.error))id=await directBootstrapCandidate(client,manifest,sha);else throw new Error(registered.error.message);}else id=String(registered.data??'');
  if(!id)throw new Error('platform_release_register_empty');
  if(manifest.releaseStage==='production'){
    const verified=await client.rpc('service_mark_release_signature_verified_r60',{p_release_candidate_id:id,p_key_id:manifest.signature.keyId});if(verified.error)throw new Error(verified.error.message);
  }
  await reconcileLegacyToolCatalog(client,manifest);
  return {releaseCandidateId:id,canonicalManifestSha256:sha,signatureVerified:manifest.releaseStage==='production'};
}

async function readCandidate(client:ReturnType<typeof serviceClient>,promoted:boolean){
  let query=client.from('platform_release_candidates').select('manifest,canonical_manifest_sha256,signature_base64,release_sequence,production_ready,promoted_at,created_at').is('superseded_at',null);
  query=promoted?query.not('promoted_at','is',null):query.eq('production_ready',false);
  const result=await query.order('release_sequence',{ascending:false}).order(promoted?'promoted_at':'created_at',{ascending:false}).limit(1).maybeSingle();
  if(result.error)throw new Error(`platform_release_read_failed:${result.error.message}`);return result.data;
}
function validateStoredCandidate(candidate:Row){
  const manifest=parsePlatformReleaseManifest(candidate.manifest);
  if(Number(candidate.release_sequence)!==manifest.releaseSequence)throw new Error('platform_release_sequence_mismatch');
  if(canonicalManifestSha256(manifest)!==text(candidate.canonical_manifest_sha256))throw new Error('platform_release_hash_mismatch');
  const storedSignature=nullableText(candidate.signature_base64);if(storedSignature!==manifest.signature.signature)throw new Error('platform_release_signature_mismatch');
  enforceManifestTrust(manifest);return manifest;
}
export async function loadPlatformRelease():Promise<PlatformReleaseManifest>{
  const client=serviceClient();
  const promoted=await readCandidate(client,true);if(promoted?.manifest)return validateStoredCandidate(promoted as Row);
  const bundled=parsePlatformReleaseManifest(bundledCandidateJson);
  if(bundled.releaseStage!=='candidate')throw new Error('bundled_release_must_be_candidate');
  const bundledSha=canonicalManifestSha256(bundled);
  let candidate=await readCandidate(client,false);
  if(candidate?.manifest){
    const current=validateStoredCandidate(candidate as Row);
    const currentSha=text(candidate.canonical_manifest_sha256);
    const currentGenerated=Date.parse(current.generatedAt);
    const bundledGenerated=Date.parse(bundled.generatedAt);
    const shouldBootstrapBundled=current.releaseSequence<bundled.releaseSequence
      ||(current.releaseSequence===bundled.releaseSequence&&currentSha!==bundledSha&&bundledGenerated>currentGenerated);
    if(!shouldBootstrapBundled)return current;
  }
  // Bootstrap/upgrade canônico de Candidate: um deployment mais novo pode
  // registrar sua própria Candidate fechada sem token administrativo. Uma
  // Candidate armazenada mais nova nunca é rebaixada por rollback de código.
  await registerVerifiedReleaseCandidate(bundled);
  candidate=await readCandidate(client,false);if(candidate?.manifest)return validateStoredCandidate(candidate as Row);
  throw new Error('platform_release_r60_not_published');
}

export function adminTokenMatches(provided:string){
  const expected=env('CONTROL_PLANE_RELEASE_ADMIN_TOKEN');if(!expected||!provided)return false;
  const a=Buffer.from(expected),b=Buffer.from(provided);return a.length===b.length&&timingSafeEqual(a,b);
}
