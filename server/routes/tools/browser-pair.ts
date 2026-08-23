import { createClient } from '@supabase/supabase-js';
import type { ApiRequest,ApiResponse,Row } from '../../maps/shared.js';
import { bearer,body,send,serviceClient,setCors,text } from '../../maps/shared.js';
import { capabilities,issueExecutorCredentials,toolId,type ToolId } from '../../tools/executor.js';

declare const process:{env:Record<string,string|undefined>};

function randomSecret(){const bytes=crypto.getRandomValues(new Uint8Array(32));return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'');}
async function sha256(value:string){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');}
function panelUrl(){return text(process.env.PUBLIC_APP_URL??process.env.VITE_PUBLIC_APP_URL)||'https://painel.samuelvinsansi.com.br';}
async function authUser(req:ApiRequest){const token=bearer(req);if(!token)throw new Error('auth_required');const url=text(process.env.SUPABASE_URL??process.env.VITE_SUPABASE_URL);const key=text(process.env.SUPABASE_ANON_KEY??process.env.SUPABASE_PUBLISHABLE_KEY??process.env.VITE_SUPABASE_PUBLISHABLE_KEY);if(!url||!key)throw new Error('supabase_auth_backend_not_configured');const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});const r=await client.auth.getUser(token);if(r.error||!r.data.user)throw new Error('auth_invalid');return r.data.user;}
function statusFor(message:string){if(/auth_|secret_invalid|expired/.test(message))return 401;if(/membership|permission|not_available|revoked|not_enabled|profile_not_available/.test(message))return 403;if(/not_found/.test(message))return 404;if(/invalid|required|capability|context|organization/.test(message))return 400;return 500;}

export default async function handler(req:ApiRequest,res:ApiResponse){
  if(req.method==='OPTIONS'){setCors(req,res);res.status(204).end();return;}
  if(req.method!=='POST')return send(req,res,405,{ok:false,error:'method_not_allowed'});
  try{
    const input=body(req);const action=text(input.action);const client=serviceClient();
    if(action==='initiate'){
      const id=toolId(input.toolId);if(id==='vinsansi_whatsapp_manager')throw new Error('browser_pair_tool_invalid');
      const externalInstallationId=text(input.externalInstallationId);if(externalInstallationId.length<16||externalInstallationId.length>200)throw new Error('external_installation_id_invalid');
      const version=text(input.version)||null;const requested=capabilities(input.capabilities);
      const catalog=await client.from('platform_tools').select('capability_catalog,catalog_status').eq('tool_id',id).single();if(catalog.error||catalog.data.catalog_status!=='active')throw new Error('tool_not_available');
      const allowed=new Set((catalog.data.capability_catalog??[]).map(String));if(requested.some(x=>!allowed.has(x)))throw new Error('reported_capability_not_supported');
      const secret=randomSecret(),pairingId=crypto.randomUUID(),expiresAt=new Date(Date.now()+10*60_000).toISOString();
      const created=await client.from('tool_browser_pairings').insert({tool_browser_pairings_id:pairingId,tool_id:id,external_installation_id:externalInstallationId,pairing_secret_hash:await sha256(secret),requested_version:version,requested_capabilities:requested,requested_metadata:(input.metadata&&typeof input.metadata==='object'?input.metadata:{}),status:'pending',expires_at:expiresAt});
      if(created.error)throw new Error(`browser_pair_create_failed:${created.error.message}`);
      const url=new URL(panelUrl());url.searchParams.set('tool_pairing',pairingId);
      return send(req,res,200,{ok:true,pairingId,pairingSecret:secret,authorizationUrl:url.toString(),expiresAt});
    }
    if(action==='authorize'){
      const pairingId=text(input.pairingId),organizationId=Number(input.organizationId);if(!pairingId||!Number.isSafeInteger(organizationId)||organizationId<=0)throw new Error('pairing_authorization_invalid');
      const user=await authUser(req);const current=await client.from('tool_browser_pairings').select('*').eq('tool_browser_pairings_id',pairingId).maybeSingle();if(current.error||!current.data)throw new Error('pairing_not_found');
      if(current.data.status!=='pending'||Date.parse(String(current.data.expires_at))<=Date.now())throw new Error('pairing_not_pending');
      const id=toolId(current.data.tool_id);const ctx=await client.rpc('service_executor_member_context',{p_auth_users_id:user.id,p_organizations_id:organizationId,p_tool_id:id});if(ctx.error||!ctx.data)throw new Error(ctx.error?.message??'executor_context_not_found');const context=ctx.data as Row;
      if(id==='vinsansi_instagram'){
        const profile=text((current.data.requested_metadata as Row)?.instagramProfile).replace(/^@/,'').toLowerCase();
        if(profile){const profiles=await client.from('socials').select('socials_id,socials_username').eq('organizations_id',organizationId).eq('status_id',1);if(profiles.error)throw new Error(`instagram_profile_authorization_failed:${profiles.error.message}`);if(!(profiles.data??[]).some((r:{socials_username?:unknown})=>text(r.socials_username).replace(/^@/,'').toLowerCase()===profile))throw new Error('instagram_profile_not_available_for_organization');}
      }
      const updated=await client.from('tool_browser_pairings').update({organizations_id:organizationId,auth_users_id:user.id,users_id:Number(context.userId),organization_members_id:Number(context.memberId),status:'authorized',authorized_at:new Date().toISOString()}).eq('tool_browser_pairings_id',pairingId).eq('status','pending').select('tool_browser_pairings_id').maybeSingle();if(updated.error||!updated.data)throw new Error('pairing_authorization_conflict');
      return send(req,res,200,{ok:true,authorized:true,toolId:id});
    }
    if(action==='exchange'){
      const pairingId=text(input.pairingId),secret=text(input.pairingSecret),externalInstallationId=text(input.externalInstallationId);const current=await client.from('tool_browser_pairings').select('*').eq('tool_browser_pairings_id',pairingId).maybeSingle();if(current.error||!current.data)throw new Error('pairing_not_found');
      if(current.data.external_installation_id!==externalInstallationId||current.data.pairing_secret_hash!==await sha256(secret))throw new Error('pairing_secret_invalid');if(Date.parse(String(current.data.expires_at))<=Date.now())throw new Error('pairing_expired');if(current.data.status!=='authorized'||!current.data.auth_users_id)return send(req,res,202,{ok:true,pending:true});
      const id=toolId(current.data.tool_id);const issued=await issueExecutorCredentials({client,toolId:id,organizationId:Number(current.data.organizations_id),externalInstallationId,authUserId:String(current.data.auth_users_id),expectedUsersId:Number(current.data.users_id),expectedMemberId:Number(current.data.organization_members_id),version:current.data.requested_version,capabilities:current.data.requested_capabilities});
      const metadata={...((current.data.requested_metadata??{}) as Row),pairing:'browser-v1',pairedAt:new Date().toISOString()};await client.from('organization_tool_installations').update({metadata}).eq('organization_tool_installations_id',issued.organizationToolInstallationId);
      const consumed=await client.from('tool_browser_pairings').update({status:'consumed',consumed_at:new Date().toISOString()}).eq('tool_browser_pairings_id',pairingId).eq('status','authorized').select('tool_browser_pairings_id').maybeSingle();if(consumed.error||!consumed.data)throw new Error('pairing_exchange_conflict');
      return send(req,res,200,{ok:true,toolId:id,userSession:issued.userSession,token:issued.userSession,installationCredential:issued.installationCredential,organizationId:issued.organizationId,memberId:issued.memberId,organizationToolInstallationId:issued.organizationToolInstallationId,externalInstallationId,metadata});
    }
    return send(req,res,400,{ok:false,error:'browser_pair_action_invalid'});
  }catch(error){const message=error instanceof Error?error.message:String(error);return send(req,res,statusFor(message),{ok:false,error:message.split(':')[0],message});}
}
