import { createHash, generateKeyPairSync, sign, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const TEST_ONLY_MARKER='LOCAL_TEST_ONLY';
const manifestPath=new URL('../R60_CANDIDATE_MANIFEST.json',import.meta.url);
const schemaPath=new URL('../R60_RELEASE_MANIFEST_SCHEMA_V2.json',import.meta.url);
const publishedCandidate=JSON.parse(readFileSync(manifestPath,'utf8'));
const schema=JSON.parse(readFileSync(schemaPath,'utf8'));
const now=Date.now();let passed=0;
const pass=(name,fn)=>{fn();passed++;console.log(`PASS ${String(passed).padStart(2,'0')} ${name}`);};
function stable(value){if(Array.isArray(value))return `[${value.map(stable).join(',')}]`;if(value&&typeof value==='object')return `{${Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>`${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;return JSON.stringify(value);}
function payload(manifest){const {signature:_signature,...rest}=manifest;return Buffer.from(stable(rest));}
function sha(manifest){return createHash('sha256').update(payload(manifest)).digest('hex');}
function clone(v){return JSON.parse(JSON.stringify(v));}
function requiredFields(m){for(const key of schema.required)assert.ok(Object.hasOwn(m,key),`missing ${key}`);}
function candidateShape(m){requiredFields(m);assert.equal(m.schemaVersion,2);assert.equal(m.releaseStage,'candidate');assert.equal(m.releaseSequence,60);assert.equal(m.productionReady,false);assert.equal(m.resumeAllowed,false);assert.equal(m.schemaTarget,'r60');assert.equal(m.securityBaseline,'r60-security-baseline-v1');assert.deepEqual(m.signature,{algorithm:'ed25519',keyId:null,signature:null});assert.ok(Date.parse(m.expiresAt)>now);for(const k of ['manager','worker','gateway','capture','instagram'])assert.match(m.resources[k].sha256,/^[0-9a-f]{64}$/i);}
function productionShape(m,publicKey,{highestPromoted=59,seen=new Set()}={}){requiredFields(m);assert.equal(m.schemaVersion,2);assert.equal(m.releaseStage,'production');assert.equal(m.productionReady,true);assert.equal(m.resumeAllowed,true);assert.equal(m.signature.algorithm,'ed25519');assert.ok(m.signature.keyId);assert.notEqual(m.signature.keyId,TEST_ONLY_MARKER);assert.ok(m.signature.signature);assert.ok(m.releaseSequence>=60&&m.releaseSequence>=highestPromoted);const issued=Date.parse(m.issuedAt),generated=Date.parse(m.generatedAt),expires=Date.parse(m.expiresAt);assert.ok(Number.isFinite(issued)&&Number.isFinite(generated)&&Number.isFinite(expires)&&expires>now&&expires>issued&&issued<=now+5*60_000&&generated<=now+5*60_000);assert.equal(m.schemaTarget,'r60');assert.equal(m.securityBaseline,'r60-security-baseline-v1');for(const k of ['manager','worker','gateway','capture','instagram'])assert.match(m.resources[k].sha256,/^[0-9a-f]{64}$/i);for(const k of ['worker','gateway','evolution','cloudflared'])assert.match(m.imageDigests[k],/^sha256:[0-9a-f]{64}$/i);assert.match(m.distribution.manager.url,/^https:\/\//);assert.match(m.distribution.manager.sha256,/^[0-9a-f]{64}$/i);assert.ok(verify(null,payload(m),publicKey,Buffer.from(m.signature.signature,'base64')));const id=`${m.releaseSequence}:${sha(m)}`;return {id,replay:seen.has(id)};}
function homologationReady(m){return m.releaseStage==='candidate'&&m.productionReady===false&&m.resumeAllowed===false&&['worker','gateway','evolution','cloudflared'].every((k)=>/^sha256:[0-9a-f]{64}$/i.test(m.imageDigests[k]||''))&&/^https:\/\//.test(m.distribution?.manager?.url||'')&&/^[0-9a-f]{64}$/i.test(m.distribution?.manager?.sha256||'');}
function immutableProjection(m){return {releaseId:m.releaseId,release:m.release,resources:m.resources,imageDigests:m.imageDigests,schemaTarget:m.schemaTarget,securityBaseline:m.securityBaseline,manager:m.manager,capture:m.capture,instagram:m.instagram,components:m.components,distribution:m.distribution};}
function expectFailure(name,fn){assert.throws(fn,undefined,name);}
function signProduction(input,keyId,privateKey){const m=clone(input);m.releaseStage='production';m.productionReady=true;m.resumeAllowed=true;m.signature={algorithm:'ed25519',keyId,signature:null};m.signature.signature=sign(null,payload(m),privateKey).toString('base64');return m;}

const {publicKey,privateKey}=generateKeyPairSync('ed25519');const other=generateKeyPairSync('ed25519');
pass('schema contract is v2',()=>{assert.equal(schema.properties.schemaVersion.const,2);assert.ok(schema.required.includes('releaseId'));assert.ok(schema.required.includes('resources'));assert.ok(schema.required.includes('imageDigests'));});
pass('published Candidate is canonical schema 2, unsigned and closed',()=>candidateShape(publishedCandidate));
pass('published Candidate resource hashes are non-placeholder',()=>{for(const k of ['manager','worker','gateway','capture','instagram'])assert.doesNotMatch(publishedCandidate.resources[k].sha256,/^0{64}$/);});
pass('published Candidate is registrable but not falsely homologation-ready before Docker/build gates',()=>assert.equal(homologationReady(publishedCandidate),false));
pass('missing required field rejected',()=>{const m=clone(publishedCandidate);delete m.releaseId;expectFailure('missing',()=>candidateShape(m));});
pass('wrong schemaVersion rejected',()=>{const m=clone(publishedCandidate);m.schemaVersion=1;expectFailure('schema',()=>candidateShape(m));});
pass('wrong release sequence rejected',()=>{const m=clone(publishedCandidate);m.releaseSequence=59;expectFailure('sequence',()=>candidateShape(m));});
pass('wrong schema target rejected',()=>{const m=clone(publishedCandidate);m.schemaTarget='r61';expectFailure('schema target',()=>candidateShape(m));});
pass('wrong security baseline rejected',()=>{const m=clone(publishedCandidate);m.securityBaseline='other';expectFailure('baseline',()=>candidateShape(m));});
pass('wrong resource hash rejected',()=>{const m=clone(publishedCandidate);m.resources.worker.sha256='bad';expectFailure('hash',()=>candidateShape(m));});
pass('candidate cannot set productionReady',()=>{const m=clone(publishedCandidate);m.productionReady=true;expectFailure('candidate production',()=>candidateShape(m));});
pass('candidate cannot arm resume',()=>{const m=clone(publishedCandidate);m.resumeAllowed=true;expectFailure('candidate resume',()=>candidateShape(m));});
pass('candidate cannot carry signature',()=>{const m=clone(publishedCandidate);m.signature={algorithm:'ed25519',keyId:'some-key',signature:'abc'};expectFailure('candidate signature',()=>candidateShape(m));});
pass('expired Candidate rejected',()=>{const m=clone(publishedCandidate);m.expiresAt=new Date(now-1000).toISOString();expectFailure('expired candidate',()=>candidateShape(m));});
const homologationCandidate=clone(publishedCandidate);homologationCandidate.imageDigests={worker:'sha256:'+'1'.repeat(64),gateway:'sha256:'+'2'.repeat(64),evolution:'sha256:'+'3'.repeat(64),cloudflared:'sha256:'+'4'.repeat(64)};homologationCandidate.distribution.manager={kind:'windows-nsis',url:'https://updates.example.invalid/vinsansi-r60.exe',sha256:'5'.repeat(64)};
pass('resolved Candidate becomes homologation-ready without production signature',()=>assert.equal(homologationReady(homologationCandidate),true));
const production=signProduction(homologationCandidate,'fixture-production-key',privateKey);
pass('production fixture signature verifies',()=>assert.equal(productionShape(production,publicKey).replay,false));
pass('production without signature rejected',()=>{const m=clone(production);m.signature.signature=null;expectFailure('missing sig',()=>productionShape(m,publicKey));});
pass('LOCAL_TEST_ONLY key id is never accepted as production',()=>{const m=signProduction(homologationCandidate,TEST_ONLY_MARKER,privateKey);expectFailure('local test key',()=>productionShape(m,publicKey));});
pass('invalid signature rejected',()=>{const m=clone(production);m.signature.signature=Buffer.alloc(64).toString('base64');expectFailure('bad sig',()=>productionShape(m,publicKey));});
pass('tampered payload rejected',()=>{const m=clone(production);m.components.gateway.version='9.9.9';expectFailure('tamper',()=>productionShape(m,publicKey));});
pass('different key rejected',()=>expectFailure('key',()=>productionShape(production,other.publicKey)));
pass('expired production manifest rejected',()=>{const m=signProduction({...clone(homologationCandidate),issuedAt:new Date(now-7200000).toISOString(),expiresAt:new Date(now-3600000).toISOString()},'fixture-production-key',privateKey);expectFailure('expired',()=>productionShape(m,publicKey));});
pass('issuedAt future tolerance enforced',()=>{const m=signProduction({...clone(homologationCandidate),issuedAt:new Date(now+600000).toISOString(),expiresAt:new Date(now+7200000).toISOString()},'fixture-production-key',privateKey);expectFailure('future',()=>productionShape(m,publicKey));});
pass('wrong image digest rejected',()=>{const m=clone(production);m.imageDigests.worker='sha256:bad';expectFailure('digest',()=>productionShape(m,publicKey));});
pass('replay has same canonical identity',()=>{const seen=new Set();const one=productionShape(production,publicKey,{seen});seen.add(one.id);assert.equal(productionShape(production,publicKey,{seen}).replay,true);});
pass('downgrade rejected',()=>{const m=signProduction({...clone(homologationCandidate),releaseSequence:59},'fixture-production-key',privateKey);expectFailure('downgrade',()=>productionShape(m,publicKey,{highestPromoted:60}));});
pass('promotion preserves immutable artifacts',()=>assert.deepEqual(immutableProjection(production),immutableProjection(homologationCandidate)));
for(const [name,mutate] of [
  ['component hash immutable',m=>{m.resources.worker.sha256='f'.repeat(64)}],
  ['component version immutable',m=>{m.components.worker.version='3.99.0'}],
  ['schema immutable',m=>{m.schemaTarget='r61'}],
  ['baseline immutable',m=>{m.securityBaseline='r61-security'}],
  ['Docker digest immutable',m=>{m.imageDigests.worker='sha256:'+'9'.repeat(64)}],
  ['manager artifact immutable',m=>{m.distribution.manager.sha256='8'.repeat(64)}],
])pass(name,()=>{const changed=clone(production);mutate(changed);assert.notDeepEqual(immutableProjection(changed),immutableProjection(homologationCandidate));});
pass('canonicalization deterministic ASCII ordering',()=>assert.equal(stable({z:1,A:2,a:3}),'\{"A\":2,\"a\":3,\"z\":1\}'));
pass('SQL rejects LOCAL_TEST_ONLY production key',()=>assert.match(readFileSync(new URL('../sql/r60/10B_SUPPLY_CHAIN_HARDENING_R60.sql',import.meta.url),'utf8'),/key_id='LOCAL_TEST_ONLY'/));
console.log(`R60_SUPPLY_CHAIN_LOCAL_TEST_ONLY: PASS ${passed}/${passed}`);
