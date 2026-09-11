import { createHash, generateKeyPairSync, sign, verify } from 'node:crypto';
import assert from 'node:assert/strict';

const TEST_KEY_ID='LOCAL_TEST_ONLY';
const now=Date.now();
function stable(value){
  if(Array.isArray(value))return `[${value.map(stable).join(',')}]`;
  if(value&&typeof value==='object')return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
function payload(manifest){const {signature:_signature,...rest}=manifest;return Buffer.from(stable(rest));}
function sha(manifest){return createHash('sha256').update(payload(manifest)).digest('hex');}
function clone(v){return JSON.parse(JSON.stringify(v));}
function validate(manifest,publicKey,{highestPromoted=59,seen=new Set()}={}){
  assert.equal(manifest.signature.algorithm,'ed25519','algorithm');
  assert.equal(manifest.signature.keyId,TEST_KEY_ID,'fixture key id');
  assert.ok(Number.isSafeInteger(manifest.releaseSequence)&&manifest.releaseSequence>=60,'release sequence');
  assert.ok(manifest.releaseSequence>=highestPromoted,'anti downgrade');
  const issued=Date.parse(manifest.issuedAt),expires=Date.parse(manifest.expiresAt);
  assert.ok(Number.isFinite(issued)&&Number.isFinite(expires)&&expires>issued,'time shape');
  assert.ok(issued<=now+5*60_000,'issuedAt future tolerance');
  assert.ok(expires>now,'expiry');
  assert.equal(manifest.schemaTarget,'r60');
  assert.equal(manifest.securityBaseline,'r60-security-baseline-v1');
  if(manifest.resumeAllowed)assert.equal(manifest.productionReady,true,'candidate cannot enable resume');
  if(manifest.productionReady){
    assert.equal(manifest.resumeAllowed,true,'production resume flag');
    assert.ok(verify(null,payload(manifest),publicKey,Buffer.from(manifest.signature.value,'base64')),'signature');
  }
  const id=`${manifest.releaseSequence}:${sha(manifest)}`;
  return {id,replay:seen.has(id)};
}
function sameArtifacts(candidate,production){
  for(const key of ['resources','imageDigests','schemaTarget','securityBaseline','manager','capture','instagram','components'])assert.deepEqual(production[key],candidate[key],`immutable ${key}`);
}
function expectFailure(name,fn){let failed=false;try{fn();}catch{failed=true;}assert.equal(failed,true,name);}

const {publicKey,privateKey}=generateKeyPairSync('ed25519');
const other=generateKeyPairSync('ed25519');
const base={
  schemaVersion:2,generatedAt:new Date(now).toISOString(),releaseSequence:60,issuedAt:new Date(now-60_000).toISOString(),expiresAt:new Date(now+3_600_000).toISOString(),
  productionReady:false,resumeAllowed:false,schemaTarget:'r60',securityBaseline:'r60-security-baseline-v1',
  resources:{manager:{sha256:'a'.repeat(64)},worker:{sha256:'b'.repeat(64)},gateway:{sha256:'c'.repeat(64)},capture:{sha256:'d'.repeat(64)},instagram:{sha256:'e'.repeat(64)}},
  imageDigests:{evolution:'sha256:'+'1'.repeat(64)},
  manager:{toolId:'vinsansi_whatsapp_manager',latestVersion:'1.5.71',minimumSupportedVersion:'1.5.71'},
  capture:{toolId:'vinsansi_capture',latestVersion:'1.0.53',minimumSupportedVersion:'1.0.53'},
  instagram:{toolId:'vinsansi_instagram',latestVersion:'2.0.8',minimumSupportedVersion:'2.0.8'},
  healthPolicy:{runtimeTtlSeconds:180,managerHeartbeatSeconds:30,workerHeartbeatSeconds:30},
  components:{worker:{version:'3.14.6'},gateway:{version:'1.2.30'},evolution:{version:'0.7.2'},cloudflared:{version:'current'}},
  signature:{algorithm:'ed25519',keyId:TEST_KEY_ID,value:''}
};
function signed(input,key=privateKey){const m=clone(input);m.signature.value=sign(null,payload(m),key).toString('base64');return m;}

const candidate=signed(base);
assert.equal(validate(candidate,publicKey).replay,false,'candidate valid');
const production=signed({...clone(base),productionReady:true,resumeAllowed:true});
assert.equal(validate(production,publicKey).replay,false,'production valid signature');
sameArtifacts(candidate,production);

const invalidSig=clone(production);invalidSig.signature.value=Buffer.alloc(64).toString('base64');expectFailure('invalid signature',()=>validate(invalidSig,publicKey));
const tampered=clone(production);tampered.components.gateway.version='9.9.9';expectFailure('tampered payload',()=>validate(tampered,publicKey));
expectFailure('different key',()=>validate(production,other.publicKey));
const expired=signed({...clone(base),productionReady:true,resumeAllowed:true,issuedAt:new Date(now-7200000).toISOString(),expiresAt:new Date(now-3600000).toISOString()});expectFailure('expired',()=>validate(expired,publicKey));
const future=signed({...clone(base),productionReady:true,resumeAllowed:true,issuedAt:new Date(now+600000).toISOString(),expiresAt:new Date(now+7200000).toISOString()});expectFailure('future issuedAt',()=>validate(future,publicKey));
const seen=new Set();const one=validate(production,publicKey,{seen});seen.add(one.id);assert.equal(validate(production,publicKey,{seen}).replay,true,'replay is idempotent identity, not new artifact');
const downgrade=signed({...clone(base),releaseSequence:59,productionReady:true,resumeAllowed:true});expectFailure('downgrade',()=>validate(downgrade,publicKey,{highestPromoted:60}));
const prior=signed({...clone(base),releaseSequence:59});expectFailure('prior candidate',()=>validate(prior,publicKey));
const badCandidate=signed({...clone(base),productionReady:false,resumeAllowed:true});expectFailure('candidate resume',()=>validate(badCandidate,publicKey));
for(const [name,mutate] of [
  ['component hash',m=>{m.resources.worker.sha256='f'.repeat(64)}],['artifact',m=>{m.components.worker.version='3.14.7'}],['schema',m=>{m.schemaTarget='r61'}],['baseline',m=>{m.securityBaseline='r61-security'}]
]){const changed=clone(production);mutate(changed);changed.signature.value=sign(null,payload(changed),privateKey).toString('base64');expectFailure(name,()=>sameArtifacts(candidate,changed));}
sameArtifacts(candidate,production);
console.log('R60_SUPPLY_CHAIN_LOCAL_TEST_ONLY: PASS 15/15');
