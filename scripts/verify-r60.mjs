import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const errors=[];const passes=[];
const expectedSql=[
 '00_MAINTENANCE_BOOTSTRAP.sql','01_SUPPLY_CHAIN_BOOTSTRAP.sql','02_PRECHECK.sql','03_RESET_MESSAGING_HOMOLOGATION.sql',
 '04_MESSAGING_SCHEMA_R60.sql','05_CONTACT_IDENTITY_R60.sql','06_MESSAGING_RPC_R60.sql','07_RLS_R60.sql','08_WORKER_GATING_R60.sql',
 '09_SECURITY_ACL_R60.sql','10_PAIRING_R60.sql','10A_RETENTION_R60.sql','10B_SUPPLY_CHAIN_HARDENING_R60.sql','10C_PRODUCTION_RESUME_GATE_R60.sql',
 '11_SCHEMA_GATE.sql','12_HOMOLOGATION_SMOKE.sql'
];
function rel(p){return path.relative(root,p).replaceAll(path.sep,'/');}
function read(p){return fs.readFileSync(path.join(root,p),'utf8');}
function ok(name,cond,detail=''){if(cond)passes.push(name);else errors.push(`${name}${detail?`: ${detail}`:''}`);}
function has(file,...tokens){const s=read(file);return tokens.every(t=>s.includes(t));}
function sha(file){return crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex');}
function treeHash(relativeFiles){
 const payload=[...relativeFiles].sort().map(file=>`${file}\0${sha(file)}\n`).join('');
 return crypto.createHash('sha256').update(payload,'utf8').digest('hex');
}
function walkRelative(dir=root,out=[]){
 for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())walkRelative(p,out);else out.push(rel(p));}
 return out;
}
const generatedHashFiles=new Set(['R60_CANDIDATE_MANIFEST.json','R60_CANDIDATE_HASHES.txt']);
function canonicalSourceHash(){return treeHash(walkRelative().filter(file=>!generatedHashFiles.has(file)));}
const supplyChainFiles=['server/platform/release.ts','server/routes/system/public-config.ts','scripts/r60-supply-chain-test.mjs','sql/r60/01_SUPPLY_CHAIN_BOOTSTRAP.sql','sql/r60/10B_SUPPLY_CHAIN_HARDENING_R60.sql','sql/r60/10C_PRODUCTION_RESUME_GATE_R60.sql'];
function supplyChainHash(){return treeHash(supplyChainFiles);}

// Release/package identity.
const pkg=JSON.parse(read('package.json'));
ok('version:2.4.0-R60',pkg.version==='2.4.0-R60',String(pkg.version));
ok('package:verify:r60',pkg.scripts?.['verify:r60']==='node scripts/verify-r60.mjs');
ok('package:no verify:r59',!JSON.stringify(pkg.scripts??{}).toLowerCase().includes('r59'));

// SQL set and official order.
const sqlDir=path.join(root,'sql/r60');
const actualSql=fs.readdirSync(sqlDir).filter(x=>x.endsWith('.sql'));
ok('sql:16 files',actualSql.length===16,actualSql.join(','));
ok('sql:official set',expectedSql.every(x=>actualSql.includes(x))&&actualSql.every(x=>expectedSql.includes(x)));
const concat=expectedSql.map(x=>fs.readFileSync(path.join(sqlDir,x))).join('\n');
for(const token of ['organization_messaging_state','whatsapp_contacts','whatsapp_contact_aliases','service_arm_messaging_resume_gate_r60','service_schema_gate_r60','service_homologation_smoke_r60'])ok(`sql:${token}`,concat.includes(token));

// Frozen SQL hash ledger, when present, must match every current byte.
const sumsPath=path.join(root,'R60_SQL_SHA256SUMS.txt');
if(fs.existsSync(sumsPath)){
 const lines=fs.readFileSync(sumsPath,'utf8').split(/\r?\n/).filter(Boolean);
 const map=new Map();let aggregate='';
 for(const line of lines){if(line.startsWith('ORDERED_SET_SHA256=')){aggregate=line.split('=')[1]?.trim()||'';continue;}const m=line.match(/^([0-9a-f]{64})\s{2}(.+)$/i);if(m)map.set(m[2],m[1].toLowerCase());}
 ok('sql:hash ledger 16',map.size===16,`entries=${map.size}`);
 for(const file of expectedSql)ok(`sql:hash:${file}`,map.get(`sql/r60/${file}`)===sha(`sql/r60/${file}`));
 const ordered=crypto.createHash('sha256').update(expectedSql.map(file=>`${sha(`sql/r60/${file}`)}  sql/r60/${file}\n`).join('')).digest('hex');
 ok('sql:ordered-set hash',aggregate===ordered,`${aggregate} != ${ordered}`);
}else errors.push('sql:R60_SQL_SHA256SUMS.txt missing');

// Inbox and canonical identity.
ok('inbox:canonical schema',has('sql/r60/04_MESSAGING_SCHEMA_R60.sql','whatsapp_contacts','whatsapp_contact_aliases','whatsapp_contacts_id SET NOT NULL','conversations_org_chip_contact_unique'));
ok('inbox:unknown/ignored/lead',has('sql/r60/04_MESSAGING_SCHEMA_R60.sql',"contact_state IN ('lead','unknown','ignored')"));
ok('inbox:Não cadastrado',read('src/repositories/conversations/conversations.repository.ts').includes('Não cadastrado'));
ok('inbox:ignore restore promote',has('sql/r60/06_MESSAGING_RPC_R60.sql','service_stage5_ignore_contact','service_stage5_restore_contact','service_stage5_promote_unknown_contact'));
ok('inbox:promotion permission',read('sql/r60/06_MESSAGING_RPC_R60.sql').includes("r60_require_actor(p_organizations_id,'leads.create')"));
ok('inbox:cursor conversations',has('sql/r60/06_MESSAGING_RPC_R60.sql','p_cursor_at timestamptz','p_cursor_id bigint'));
ok('inbox:cursor messages',has('sql/r60/06_MESSAGING_RPC_R60.sql','p_before_id bigint','p_after_id bigint'));
const page=read('src/pages/ConversationsPage.tsx');
ok('inbox:Realtime delta',page.includes(".on('postgres_changes'")&&page.includes('applyConversationDelta'));
ok('inbox:no normal periodic reconcile',page.includes('if (!conversationRealtimeReadyRef.current)')&&!/setInterval\([^)]*syncConversationList/s.test(page));
ok('inbox:presence realtime',read('sql/r60/06_MESSAGING_RPC_R60.sql').includes("'realtime_presence'"));
ok('inbox:manual canonical alias',has('server/whatsapp/stage5.ts',"from('whatsapp_contact_aliases')","select('alias_value')"));

// Security/authority.
const actorSql=read('sql/r60/06_MESSAGING_RPC_R60.sql');
ok('security:actor auth.uid',actorSql.includes('auth.uid()')&&actorSql.includes('organizations_id'));
ok('security:no member param authority',!/CREATE OR REPLACE FUNCTION public\.r60_require_actor\([^)]*member/i.test(actorSql));
ok('security:RLS replaces legacy',has('sql/r60/07_RLS_R60.sql','DROP POLICY IF EXISTS','FORCE ROW LEVEL SECURITY'));
ok('security:machine ACL',has('sql/r60/09_SECURITY_ACL_R60.sql','REVOKE ALL ON FUNCTION','service_role','service_ingest_evolution_message'));
ok('security:default privileges',read('sql/r60/09_SECURITY_ACL_R60.sql').includes('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC'));
ok('security:PUBLIC_APP_URL authority',has('server/routes/system/public-config.ts',"PUBLIC_APP_URL",'crmWebUrl')&&!read('server/routes/system/public-config.ts').toLowerCase().includes('x-forwarded-host'));
ok('security:web headers',has('vercel.json','Strict-Transport-Security','X-Content-Type-Options','Referrer-Policy','Permissions-Policy','Content-Security-Policy','frame-ancestors'));
const cloudflareInstall=read('server/platform/cloudflare-installation.ts');
const workerProvision=read('server/routes/system/desktop/worker-provision.ts');
ok('network:single public Gateway surface',cloudflareInstall.includes("DESKTOP_GATEWAY_SERVICE_URL")&&cloudflareInstall.includes('host.docker.internal:8090')&&cloudflareInstall.includes("http_status:404")&&!cloudflareInstall.includes('DESKTOP_WORKER_SERVICE_URL'));
ok('network:no worker public provisioning',!cloudflareInstall.includes('workerPublicUrl')&&!workerProvision.includes('workerPublicUrl')&&!workerProvision.includes('workerTunnelServiceUrl'));
ok('network:legacy worker DNS cleanup',cloudflareInstall.includes('legacyWorkerHostname')&&cloudflareInstall.includes('deleteTunnelDns'));
ok('network:no direct Evolution tunnel origin',!cloudflareInstall.includes('host.docker.internal:8080')&&!workerProvision.includes('host.docker.internal:8080'));
ok('logging:no maps secret metadata log',!read('server/maps/token.ts').includes('[maps-token-config]'));

// Resume/Supply Chain.
ok('resume:candidate cannot arm',has('sql/r60/10B_SUPPLY_CHAIN_HARDENING_R60.sql','candidate_manifest_cannot_allow_resume'));
ok('resume:service gate only',has('sql/r60/00_MAINTENANCE_BOOTSTRAP.sql','vinsansi.r60_resume_gate','resume_allowed_requires_service_arm_messaging_resume_gate_r60'));
ok('resume:production verified',has('sql/r60/10C_PRODUCTION_RESUME_GATE_R60.sql','production_ready','resume_allowed','signature_verified_at','release_sequence<>60','platform_release_promotions'));
ok('supply:ed25519 server',has('server/platform/release.ts',"algorithm:'ed25519'",'verifyManifestEd25519','canonicalManifestSha256'));
ok('supply:anti downgrade immutable',has('sql/r60/10B_SUPPLY_CHAIN_HARDENING_R60.sql','release_downgrade_rejected','immutable_promotion_mismatch'));
ok('supply:LOCAL_TEST_ONLY fixture',read('scripts/r60-supply-chain-test.mjs').includes("LOCAL_TEST_ONLY"));

// Gateway ingress contract implemented on CRM side.
const webhook=read('server/routes/whatsapp/evolution-webhook.ts');
ok('gateway:webhook HMAC',webhook.includes('x-evolution-signature')&&webhook.includes('x-evolution-instance-id')&&webhook.includes("createHmac('sha256'"));
ok('gateway:remoteJidAlt',webhook.includes('remoteJidAlt'));
ok('gateway:non-direct defense',webhook.includes('nonDirect')&&webhook.includes('non_operational_event'));
ok('gateway:text-first',webhook.includes('[Imagem]')&&webhook.includes('[Áudio]')&&webhook.includes('[Figurinha]')&&webhook.includes('[Documento]'));

// Exact Manager/Worker contract snapshot and SQL signatures.
const snap=JSON.parse(read('scripts/r60-manager-contract-snapshot.json'));
ok('contract:manager version',snap.managerVersion==='1.5.71');ok('contract:worker version',snap.workerVersion==='3.14.6');ok('contract:gateway version',snap.gatewayVersion==='1.2.30');
ok('contract:release gate',snap.releaseSequence===60&&snap.schemaTarget==='r60'&&snap.securityBaseline==='r60-security-baseline-v1'&&snap.productionReady===false&&snap.resumeAllowed===false);
const matrix=JSON.parse(read('scripts/r60-contract-matrix.json'));
const byOp=new Map(matrix.contracts.map(x=>[x.operation,x]));
for(const [op,args] of Object.entries(snap.workerRpcCalls)){
 const item=byOp.get(op);ok(`contract:matrix:${op}`,Boolean(item),item?'':'missing');
 if(item)ok(`contract:args:${op}`,JSON.stringify(item.arguments)===JSON.stringify(args),`${JSON.stringify(item.arguments)} != ${JSON.stringify(args)}`);
}
function sqlHeaderArgs(operation){
 const files=expectedSql.map(f=>read(`sql/r60/${f}`)).join('\n');
 const esc=operation.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const m=files.match(new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${esc}\\s*\\(([^)]*)\\)`,'i'));
 if(!m)return null;
 return m[1].split(',').map(x=>x.trim()).filter(Boolean).map(x=>x.match(/^(p_[a-z0-9_]+)/i)?.[1]).filter(Boolean);
}
for(const op of ['worker_claim_dispatch_job','worker_move_dispatch_to_dlq','worker_claim_dispatch_part','worker_complete_dispatch_part','service_stage5_converge_automatic_message','worker_finalize_whatsapp_queue_item','worker_fail_whatsapp_queue_item','worker_start_whatsapp_batch','worker_set_whatsapp_batch_state','worker_recover_stale_whatsapp_v2','worker_claim_next_batch_item','worker_complete_batch_item']){
 const actual=sqlHeaderArgs(op);const expected=snap.workerRpcCalls[op];ok(`contract:sql-signature:${op}`,JSON.stringify(actual)===JSON.stringify(expected),`${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
}
ok('contract:gateway path',snap.gateway.crmPath==='/api/whatsapp/evolution-webhook'&&snap.gateway.hmacHeader==='x-evolution-signature'&&snap.gateway.instanceHeader==='x-evolution-instance-id');

// Frozen Candidate identity and deterministic hashes.
const candidateManifestPath=path.join(root,'R60_CANDIDATE_MANIFEST.json');
const candidateHashesPath=path.join(root,'R60_CANDIDATE_HASHES.txt');
ok('candidate:manifest exists',fs.existsSync(candidateManifestPath));
ok('candidate:hash summary exists',fs.existsSync(candidateHashesPath));
if(fs.existsSync(candidateManifestPath)){
 const manifest=JSON.parse(fs.readFileSync(candidateManifestPath,'utf8'));
 ok('candidate:release identity',manifest.release==='2.4.0-R60'&&manifest.releaseSequence===60&&manifest.productionReady===false&&manifest.resumeAllowed===false&&manifest.schemaTarget==='r60'&&manifest.securityBaseline==='r60-security-baseline-v1');
 ok('candidate:manager authority',manifest.managerAuthority?.version==='1.5.71'&&manifest.managerAuthority?.zipSha256==='008430f0a248847a9f1f8ca5f4cb78ff03f6d19af0e95b6a5c00ca43c895f7d1');
 ok('candidate:component versions',manifest.managerAuthority?.components?.worker==='3.14.6'&&manifest.managerAuthority?.components?.gateway==='1.2.30'&&manifest.managerAuthority?.components?.capture==='1.0.53'&&manifest.managerAuthority?.components?.instagram==='2.0.8');
 ok('candidate:manager component hashes',manifest.managerAuthority?.componentHashes?.manager==='ce9233d1b11f3137ed815b6bbc5dc35b661ef157d2a76268abfb910520b8c8ce'&&manifest.managerAuthority?.componentHashes?.worker==='85481dd54cb7e51f64a960677bed2b0e5b1459c89051ba799320262d02c49b4f'&&manifest.managerAuthority?.componentHashes?.gateway==='06871d8f8aa41ac1f9b2cb6536456a0e19434ccea2bce25b34a0ceed2d8a1a09'&&manifest.managerAuthority?.componentHashes?.capture==='162d0d53307df64f993b00854098b069cff6d59432e8a392ee6fefea0333faf3'&&manifest.managerAuthority?.componentHashes?.instagram==='fbe34cff58a7dec0c0dd506d3b7eae81a2d6afd29d08e3a3c19dfc48b1ab09f9');
 ok('candidate:docker digests external',manifest.dockerDigestsResolved===false);
 const ordered=crypto.createHash('sha256').update(expectedSql.map(file=>`${sha(`sql/r60/${file}`)}  sql/r60/${file}\n`).join('')).digest('hex');
 ok('candidate:sql hash',manifest.hashes?.sqlOrderedSet===ordered);
 ok('candidate:verify hash',manifest.hashes?.verifyR60===sha('scripts/verify-r60.mjs'));
 ok('candidate:supply hash',manifest.hashes?.supplyChain===supplyChainHash());
 ok('candidate:source hash',manifest.hashes?.crmCanonicalSource===canonicalSourceHash());
}
if(fs.existsSync(candidateHashesPath)){
 const entries=new Map(fs.readFileSync(candidateHashesPath,'utf8').split(/\r?\n/).map(line=>line.match(/^([A-Z0-9_]+)=([0-9a-f]{64})$/i)).filter(Boolean).map(m=>[m[1],m[2].toLowerCase()]));
 ok('candidate:summary source',entries.get('CRM_CANONICAL_SOURCE_SHA256')===canonicalSourceHash());
 ok('candidate:summary supply',entries.get('SUPPLY_CHAIN_SHA256')===supplyChainHash());
 ok('candidate:summary verify',entries.get('VERIFY_R60_SHA256')===sha('scripts/verify-r60.mjs'));
 if(fs.existsSync(candidateManifestPath))ok('candidate:summary manifest',entries.get('MANIFEST_SHA256')===sha('R60_CANDIDATE_MANIFEST.json'));
 const ordered=crypto.createHash('sha256').update(expectedSql.map(file=>`${sha(`sql/r60/${file}`)}  sql/r60/${file}\n`).join('')).digest('hex');
 ok('candidate:summary sql',entries.get('SQL_ORDERED_SET_SHA256')===ordered);
 ok('candidate:summary manager zip',entries.get('MANAGER_CANDIDATE_ZIP_SHA256')==='008430f0a248847a9f1f8ca5f4cb78ff03f6d19af0e95b6a5c00ca43c895f7d1');
}

// Schema Gate/Smoke requested coverage.
const gate=read('sql/r60/11_SCHEMA_GATE.sql');
for(const token of ['organization_messaging_state','platform_release_candidates','whatsapp_contacts','whatsapp_contact_aliases','conversations_org_chip_contact_unique','worker_claim_dispatch_job','c.relforcerowsecurity','service_exchange_executor_pairing','service_retention_r60','service_arm_messaging_resume_gate_r60','signature_verified_at','remote_jid_conversation_uniqueness','persistent_presence_writer'])ok(`schema-gate:${token}`,gate.includes(token));
const smoke=read('sql/r60/12_HOMOLOGATION_SMOKE.sql');
for(const token of ['groupDrop','broadcastDrop','statusDrop','newsletterDrop','unknownState','leadLink','ignoredDrop','restore','promotion','jidAccepted','lidAccepted','jidLidSameCanonicalResolver','duplicateNoop','replayProtected','sameStatusNoop','statusMonotonic','textFirst','crossTenantScoped','memberImpersonationBlocked','machineOnlyAcl','vaultNotBrowserExposed','candidateCannotArmResume','wrongSequenceBlocked','productionPromotionPath','authorizedResumePathOnly'])ok(`smoke:${token}`,smoke.includes(`'${token}'`));

// Legacy/public distribution/source garbage.
const toolManifest=JSON.parse(read('public/tools/manifest.json'));
ok('legacy:no public Instagram extension',!fs.existsSync(path.join(root,'public/tools/instagram-extension-latest.zip'))&&!JSON.stringify(toolManifest).includes('instagram-extension-latest.zip'));
function walk(dir,out=[]){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())walk(p,out);else out.push(p);}return out;}
const files=walk(root);
const textFiles=files.filter(f=>/\.(?:ts|tsx|js|mjs|cjs|json|sql|html|css|md|txt)$/i.test(f));
const r59Verifier=textFiles.filter(f=>f!==path.join(root,'scripts/verify-r60.mjs')&&(/verify[-_:]?r59/i.test(fs.readFileSync(f,'utf8'))||/verify[-_]?r59/i.test(path.basename(f))));
ok('legacy:no verify:r59',r59Verifier.length===0,r59Verifier.map(rel).join(','));
ok('legacy:no compiled js in src',!files.some(f=>f.startsWith(path.join(root,'src')+path.sep)&&f.endsWith('.js')));
const garbage=files.filter(f=>/(^|\/)(node_modules|\.env|\.DS_Store)(\/|$)/.test(f.replaceAll('\\','/'))||/\.(log|bak|tmp|map)$/i.test(f)||/\b(?:APPLY|patch)\b/i.test(path.basename(f))||f.endsWith('.zip'));
ok('garbage:none',garbage.length===0,garbage.map(rel).join(','));

// Secret literals: permit variable names and LOCAL_TEST_ONLY fixture, reject actual key material/token-like literals.
const secretHits=[];
for(const f of textFiles){const s=fs.readFileSync(f,'utf8');if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(s))secretHits.push(rel(f)+':private-key');if(/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\b/.test(s))secretHits.push(rel(f)+':jwt');if(/\bsb_secret_[A-Za-z0-9_-]{20,}\b/.test(s))secretHits.push(rel(f)+':supabase-secret');}
ok('secrets:no operational hardcoded secret',secretHits.length===0,secretHits.join(','));

// JSON parse and relative import existence/casing.
const jsonErrors=[];for(const f of files.filter(f=>f.endsWith('.json'))){try{JSON.parse(fs.readFileSync(f,'utf8'));}catch(e){jsonErrors.push(`${rel(f)}:${e.message}`);}}ok('json:parse',jsonErrors.length===0,jsonErrors.join(';'));
const sourceFiles=files.filter(f=>/\.(?:ts|tsx|js|jsx|mjs|cjs)$/i.test(f));
const importErrors=[];const specRe=/(?:import|export)\s+(?:[^'"()]*?\s+from\s+)?['"](\.[^'"]+)['"]|import\s*\(\s*['"](\.[^'"]+)['"]\s*\)|require\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g;
function exactCaseExists(p){const abs=path.resolve(p);const parsed=path.parse(abs);let cur=parsed.root;for(const part of abs.slice(parsed.root.length).split(path.sep).filter(Boolean)){let names;try{names=fs.readdirSync(cur);}catch{return false;}if(!names.includes(part))return false;cur=path.join(cur,part);}return true;}
function resolveRelative(from,spec){
 const base=path.resolve(path.dirname(from),spec);
 const candidates=[base];
 if(/\.js$/i.test(base)){const stem=base.slice(0,-3);candidates.push(stem+'.ts',stem+'.tsx',stem+'.js',stem+'.jsx');}
 else if(/\.mjs$/i.test(base)){const stem=base.slice(0,-4);candidates.push(stem+'.mts',stem+'.ts',stem+'.mjs');}
 else if(/\.cjs$/i.test(base)){const stem=base.slice(0,-4);candidates.push(stem+'.cts',stem+'.ts',stem+'.cjs');}
 candidates.push(...['.ts','.tsx','.js','.jsx','.mjs','.cjs','.json'].map(e=>base+e),...['index.ts','index.tsx','index.js','index.jsx','index.mjs','index.cjs','index.json'].map(x=>path.join(base,x)));
 return candidates.find(p=>fs.existsSync(p)&&fs.statSync(p).isFile());
}
for(const f of sourceFiles){const s=fs.readFileSync(f,'utf8');for(const m of s.matchAll(specRe)){const spec=m[1]||m[2]||m[3];if(!spec)continue;const found=resolveRelative(f,spec);if(!found)importErrors.push(`${rel(f)} -> ${spec} missing`);else if(!exactCaseExists(found))importErrors.push(`${rel(f)} -> ${spec} casing`);}}
ok('imports:relative',importErrors.length===0,importErrors.slice(0,20).join(';'));

if(errors.length){console.error(`verify:r60 FAIL ${passes.length} pass / ${errors.length} fail`);for(const e of errors)console.error(`FAIL ${e}`);process.exit(1);}console.log(`verify:r60 PASS ${passes.length}/${passes.length}`);
