// Server-only Maps infrastructure shared by the two public route entrypoints.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { sha256, type MapsExtensionScope } from './token.js';
import { ORGANIZATION_HEADER, organizationScopedAuthHeaders, resolveOrganizationContext } from '../organization/context.js';

export type ApiRequest = { method?: string; body?: unknown; headers?: Record<string, string | string[] | undefined> };
export type ApiResponse = { status(code: number): ApiResponse; json(body: unknown): void; setHeader(name: string, value: string): void; end(): void };
export type Row = Record<string, unknown>;
declare const process: { env: Record<string, string | undefined> };

export function text(value: unknown) { return String(value ?? '').trim(); }
export function body(req: ApiRequest): Row { if (typeof req.body === 'string') { try { return JSON.parse(req.body) as Row; } catch { return {}; } } return req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body as Row : {}; }
export function header(req: ApiRequest, name: string) { const key = Object.keys(req.headers ?? {}).find((item) => item.toLowerCase() === name.toLowerCase()); const value = key ? req.headers?.[key] : undefined; return Array.isArray(value) ? text(value[0]) : text(value); }
export function bearer(req: ApiRequest) { return header(req, 'authorization').match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? ''; }
export function serviceClient() { const url = text(process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL); const key = text(process.env.SUPABASE_SERVICE_ROLE_KEY); if (!url || !key) throw new Error('maps_backend_not_configured'); return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }); }
export function setCors(req: ApiRequest, res: ApiResponse) { const origin = header(req, 'origin'); if (/^chrome-extension:\/\/[a-p]{32}$/i.test(origin)) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); } res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'); res.setHeader('Access-Control-Allow-Headers', `Content-Type, Authorization, ${ORGANIZATION_HEADER}, X-Vinsansi-Installation-Credential`); res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); }
export function send(req: ApiRequest, res: ApiResponse, status: number, payload: unknown) { setCors(req, res); return res.status(status).json(payload); }
export function normalize(value: unknown) { return text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' '); }

export async function authenticatedUser(req: ApiRequest) {
  const token = bearer(req);
  if (!token) throw new Error('auth_required');
  const url = text(process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL);
  const key = text(process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY);
  if (!url || !key) throw new Error('supabase_auth_backend_not_configured');
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: organizationScopedAuthHeaders(token, req.headers) } });
  const auth = await client.auth.getUser(token);
  if (auth.error || !auth.data.user) throw new Error('auth_invalid');
  const organization = await resolveOrganizationContext(client);
  const allowed = await client.rpc('has_organization_permission', { p_permission_key: 'capture.use' });
  if (allowed.error || allowed.data !== true) throw new Error('capture_permission_denied');
  return {
    authUserId: auth.data.user.id,
    usersId: organization.scopeUsersId,
    actorUsersId: organization.actorUsersId,
    organizationId: organization.organizationId,
    memberId: organization.memberId,
  };
}

export async function extensionScope(req: ApiRequest, scopes: MapsExtensionScope[]) {
  const raw=bearer(req);if(!raw)throw new Error('token_required');
  const client = serviceClient();
  const cutoff=new Date(Date.now()-30*86_400_000).toISOString();
  const session=await client.from('tool_user_sessions').select('tool_user_sessions_id,auth_users_id,organization_tool_installations!inner(*)').eq('session_hash',await sha256(raw)).is('revoked_at',null).gt('last_used_at',cutoff).maybeSingle();
  if(session.error||!session.data)throw new Error('token_invalid_or_expired');
  const canonical=(session.data as unknown as {organization_tool_installations:Row}).organization_tool_installations;
  if(canonical.tool_id!=='vinsansi_capture'||canonical.registration_status==='revoked')throw new Error('gmaps_extension_installation_revoked');
  const context=await client.rpc('service_executor_member_context',{p_auth_users_id:session.data.auth_users_id,p_organizations_id:Number(canonical.organizations_id),p_tool_id:'vinsansi_capture'});
  if(context.error)throw new Error(context.error.message);
  const payload={installationId:String(canonical.external_installation_id),scopes:[...scopes]};
  const installation = await client.from('maps_extension_installations').select('maps_extension_installations_id,organizations_id,status,scopes').eq('organizations_id', Number(canonical.organizations_id)).eq('extension_type', 'google_maps').eq('installation_id', payload.installationId).maybeSingle();
  if (installation.error || !installation.data || installation.data.status !== 'active') throw new Error('gmaps_extension_installation_revoked');
  const installationScopes = new Set(Array.isArray(installation.data.scopes) ? installation.data.scopes.map(String) : []);
  if (scopes.some((scope) => !installationScopes.has(scope))) throw new Error('gmaps_extension_scope_revoked');
  await client.from('tool_user_sessions').update({last_used_at:new Date().toISOString()}).eq('tool_user_sessions_id',session.data.tool_user_sessions_id);
  await client.from('maps_extension_installations').update({ last_seen_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('maps_extension_installations_id', installation.data.maps_extension_installations_id);
  const canonicalTouch = await client.rpc('service_touch_tool_installation', {
    p_organizations_id: Number(installation.data.organizations_id),
    p_tool_id: 'vinsansi_capture',
    p_external_installation_id: payload.installationId,
    p_seen: true,
    p_meaningful_activity: false,
    p_installed_version: null,
    p_reported_capabilities: null,
    p_last_seen_member_id: null,
  });
  if (canonicalTouch.error) throw new Error(`canonical_installation_touch_failed:${canonicalTouch.error.message}`);
  return { client, usersId: Number((context.data as Row).legacyScopeUsersId),memberId:Number((context.data as Row).memberId),sessionId:String(session.data.tool_user_sessions_id),organizationToolInstallationId:String(canonical.organization_tool_installations_id), organizationId: Number(installation.data.organizations_id), installationId: payload.installationId, installationRowId: String(installation.data.maps_extension_installations_id), token: payload };
}

export function statusForError(message: string) {
  if (/MAPS_ACTIVE_EXECUTION_LIMIT/.test(message)) return 409;
  if (/gmaps_extension_signing_secret_(?:not_configured|invalid)/.test(message)) return 503;
  if (/auth_required|token_required|token_invalid|token_expired/.test(message)) return 401;
  if (/scope_required|revoked|not_available|owner_scope/.test(message)) return 403;
  if (/not_found/.test(message)) return 404;
  if (/invalid|required|mismatch|divergent/.test(message)) return 400;
  if (/not_configured/.test(message)) return 503;
  return 500;
}

export async function queryRows(client: SupabaseClient, table: string, select = '*') {
  const result = await client.from(table).select(select);
  if (result.error) throw new Error(`${table}_query_failed:${result.error.message}`);
  return (result.data ?? []) as unknown as Row[];
}
