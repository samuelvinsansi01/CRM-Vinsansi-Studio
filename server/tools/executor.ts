import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { ApiRequest } from '../maps/shared.js';
import { bearer, header, serviceClient, text } from '../maps/shared.js';

declare const process: { env: Record<string, string | undefined> };
export const EXECUTOR_ORGANIZATION_HEADER = 'x-vinsansi-organization-id';
export const INSTALLATION_CREDENTIAL_HEADER = 'x-vinsansi-installation-credential';
export const SESSION_IDLE_DAYS = 30;

export type ToolId = 'vinsansi_capture' | 'vinsansi_instagram' | 'vinsansi_whatsapp_manager';
const TOOLS = new Set<ToolId>(['vinsansi_capture','vinsansi_instagram','vinsansi_whatsapp_manager']);

export async function sha256(value: string) { const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join(''); }
export function opaqueToken(prefix: string) { const bytes=crypto.getRandomValues(new Uint8Array(32));const encoded=btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');return `${prefix}_${encoded}`; }
export function numericId(value: unknown, code = 'organization_required') { const parsed=Number(value); if (!Number.isSafeInteger(parsed)||parsed<=0) throw new Error(code); return parsed; }
export function toolId(value: unknown): ToolId { const id=text(value) as ToolId; if (!TOOLS.has(id)) throw new Error('tool_id_invalid'); return id; }
export function capabilities(value: unknown) { return Array.isArray(value) ? [...new Set(value.map(text).filter(Boolean))].sort() : []; }

async function authenticatedAuthUser(req: ApiRequest) {
  const token=bearer(req); if (!token) throw new Error('auth_required');
  const url=text(process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL);
  const key=text(process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY);
  if (!url||!key) throw new Error('supabase_auth_backend_not_configured');
  const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const auth=await client.auth.getUser(token);
  if (auth.error||!auth.data.user) throw new Error('auth_invalid');
  return auth.data.user;
}

async function memberContext(client: SupabaseClient, authUserId: string, organizationId: number, id: ToolId) {
  const result=await client.rpc('service_executor_member_context',{p_auth_users_id:authUserId,p_organizations_id:organizationId,p_tool_id:id});
  if (result.error) throw new Error(result.error.message);
  return result.data as Record<string, unknown>;
}

export async function startPairing(req: ApiRequest, input: Record<string, unknown>) {
  const user=await authenticatedAuthUser(req);
  const client=serviceClient();
  const id=toolId(input.toolId);
  const organizationId=numericId(input.organizationId ?? header(req,EXECUTOR_ORGANIZATION_HEADER));
  const externalInstallationId=text(input.externalInstallationId);
  if (!externalInstallationId||externalInstallationId.length>200) throw new Error('external_installation_id_invalid');
  const context=await memberContext(client,user.id,organizationId,id);
  if (id==='vinsansi_whatsapp_manager' && !(context.permissions as unknown[]).includes('tools.manage')) throw new Error('tools_manage_required_for_desktop_registration');
  const requested=capabilities(input.capabilities);
  const catalog=await client.from('platform_tools').select('capability_catalog').eq('tool_id',id).single();
  if (catalog.error) throw new Error(`tool_catalog_query_failed:${catalog.error.message}`);
  const allowed=new Set((catalog.data.capability_catalog ?? []).map(String));
  if (requested.some((item)=>!allowed.has(item))) throw new Error('reported_capability_not_supported');
  const code=opaqueToken('pair');
  const expiresAt=new Date(Date.now()+10*60_000).toISOString();
  const inserted=await client.from('tool_executor_pairings').insert({
    tool_id:id,external_installation_id:externalInstallationId,pairing_code_hash:await sha256(code),auth_users_id:user.id,
    users_id:Number(context.userId),organizations_id:organizationId,organization_members_id:Number(context.memberId),
    requested_version:text(input.version)||null,requested_capabilities:requested,expires_at:expiresAt,
  }).select('tool_executor_pairings_id').single();
  if (inserted.error) throw new Error(`pairing_create_failed:${inserted.error.message}`);
  return {pairingId:inserted.data.tool_executor_pairings_id,pairingCode:code,expiresAt};
}

export async function exchangePairing(input: Record<string, unknown>) {
  const client=serviceClient(); const code=text(input.pairingCode); if (!code) throw new Error('pairing_code_required');
  const installationCredential=opaqueToken('vic');const userSession=opaqueToken('vus');
  const exchanged=await client.rpc('service_exchange_executor_pairing',{p_pairing_code_hash:await sha256(code),p_credential_hash:await sha256(installationCredential),p_session_hash:await sha256(userSession)});
  if(exchanged.error)throw new Error(exchanged.error.message);const result=exchanged.data as Record<string,unknown>;
  return {toolId:toolId(result.toolId),organizationId:Number(result.organizationId),memberId:Number(result.memberId),organizationToolInstallationId:String(result.organizationToolInstallationId),installationCredential,userSession};
}

export async function issueExecutorCredentials(input:{client?:SupabaseClient;toolId:ToolId;organizationId:number;externalInstallationId:string;authUserId:string;usersId:number;memberId:number;version?:unknown;capabilities?:unknown}){
  const client=input.client??serviceClient();
  await memberContext(client,input.authUserId,input.organizationId,input.toolId);
  const registered=await client.rpc('service_register_tool_installation',{
    p_organizations_id:input.organizationId,p_tool_id:input.toolId,p_external_installation_id:input.externalInstallationId,
    p_installed_version:text(input.version)||null,p_reported_capabilities:capabilities(input.capabilities),
    p_registered_by_member_id:input.memberId,p_metadata:{pairing:'stage4'},
  });
  if (registered.error) throw new Error(`installation_register_failed:${registered.error.message}`);
  const installationCredential=opaqueToken('vic'); const userSession=opaqueToken('vus');
  const issue=await client.from('tool_installation_credentials').insert({
    organization_tool_installations_id:registered.data,credential_hash:await sha256(installationCredential),issued_to_external_installation_id:input.externalInstallationId,
  });
  if (issue.error) throw new Error(`installation_credential_issue_failed:${issue.error.message}`);
  const session=await client.from('tool_user_sessions').insert({
    organization_tool_installations_id:registered.data,auth_users_id:input.authUserId,users_id:input.usersId,session_hash:await sha256(userSession),
  });
  if (session.error) throw new Error(`user_session_issue_failed:${session.error.message}`);
  return {installationCredential,userSession,organizationToolInstallationId:String(registered.data)};
}

export async function installationScope(req: ApiRequest) {
  const raw=header(req,INSTALLATION_CREDENTIAL_HEADER)||bearer(req); if (!raw) throw new Error('installation_credential_required');
  const client=serviceClient();
  const row=await client.from('tool_installation_credentials').select('tool_installation_credentials_id,organization_tool_installations_id,revoked_at,organization_tool_installations!inner(*)').eq('credential_hash',await sha256(raw)).is('revoked_at',null).maybeSingle();
  if (row.error||!row.data) throw new Error('installation_credential_invalid');
  const installation=(row.data as unknown as {organization_tool_installations: Record<string,unknown>}).organization_tool_installations;
  if (installation.registration_status==='revoked') throw new Error('installation_revoked');
  await client.from('tool_installation_credentials').update({last_used_at:new Date().toISOString()}).eq('tool_installation_credentials_id',row.data.tool_installation_credentials_id);
  await client.from('organization_tool_installations').update({last_seen_at:new Date().toISOString()}).eq('organization_tool_installations_id',row.data.organization_tool_installations_id);
  return {client,credentialId:String(row.data.tool_installation_credentials_id),installationId:String(row.data.organization_tool_installations_id),organizationId:Number(installation.organizations_id),toolId:toolId(installation.tool_id),externalInstallationId:String(installation.external_installation_id),installation};
}

export async function sessionScope(req: ApiRequest) {
  const raw=bearer(req); if (!raw) throw new Error('user_session_required'); const client=serviceClient();
  const cutoff=new Date(Date.now()-SESSION_IDLE_DAYS*86_400_000).toISOString();
  const row=await client.from('tool_user_sessions').select('*,organization_tool_installations!inner(*)').eq('session_hash',await sha256(raw)).is('revoked_at',null).gt('last_used_at',cutoff).maybeSingle();
  if (row.error||!row.data) throw new Error('user_session_invalid_or_expired');
  const installation=(row.data as unknown as {organization_tool_installations: Record<string,unknown>}).organization_tool_installations;
  const organizationId=numericId(header(req,EXECUTOR_ORGANIZATION_HEADER)||installation.organizations_id);
  if (organizationId!==Number(installation.organizations_id)) throw new Error('session_organization_mismatch');
  const context=await memberContext(client,String(row.data.auth_users_id),organizationId,toolId(installation.tool_id));
  await client.from('tool_user_sessions').update({last_used_at:new Date().toISOString()}).eq('tool_user_sessions_id',row.data.tool_user_sessions_id);
  const eligible=await client.rpc('service_executor_eligible_organizations',{p_auth_users_id:row.data.auth_users_id,p_tool_id:installation.tool_id});
  if (eligible.error) throw new Error(`eligible_organizations_failed:${eligible.error.message}`);
  return {client,sessionId:String(row.data.tool_user_sessions_id),installationId:String(row.data.organization_tool_installations_id),toolId:toolId(installation.tool_id),externalInstallationId:String(installation.external_installation_id),organizationId,context,eligibleOrganizations:eligible.data,installation};
}

export async function effectiveConfig(client: SupabaseClient, organizationId: number, id: ToolId) {
  const [tool,settings,entitlements,enabled]=await Promise.all([
    client.from('platform_tools').select('settings_schema_version,default_settings,default_entitlements').eq('tool_id',id).eq('catalog_status','active').single(),
    client.from('organization_tool_settings').select('settings,settings_version').eq('organizations_id',organizationId).eq('tool_id',id).maybeSingle(),
    client.from('organization_tool_entitlements').select('entitlements,entitlements_version').eq('organizations_id',organizationId).eq('tool_id',id).maybeSingle(),
    client.from('organization_tools').select('enabled').eq('organizations_id',organizationId).eq('tool_id',id).maybeSingle(),
  ]);
  if (tool.error||!tool.data||enabled.data?.enabled!==true) throw new Error('tool_not_enabled');
  return {toolId:id,organizationId,settings:settings.data?.settings??tool.data.default_settings,entitlements:entitlements.data?.entitlements??tool.data.default_entitlements,settingsVersion:Number(settings.data?.settings_version??0),entitlementsVersion:Number(entitlements.data?.entitlements_version??0),settingsSchemaVersion:Number(tool.data.settings_schema_version),generatedAt:new Date().toISOString()};
}

export function executorStatus(error: unknown) { const m=error instanceof Error?error.message:String(error); if (/required|invalid|expired|auth_/.test(m)) return 401; if (/membership|permission|forbidden|disabled|revoked|not_enabled|not_available|mismatch/.test(m)) return 403; if (/not_found/.test(m)) return 404; if (/capability|semver|organization_|tool_id|external_/.test(m)) return 400; return 500; }
