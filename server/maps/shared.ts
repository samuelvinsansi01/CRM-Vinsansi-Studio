// Server-only Maps infrastructure shared by the two public route entrypoints.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { verifyMapsExtensionToken, type MapsExtensionScope } from './token.js';

export type ApiRequest = { method?: string; body?: unknown; headers?: Record<string, string | string[] | undefined> };
export type ApiResponse = { status(code: number): ApiResponse; json(body: unknown): void; setHeader(name: string, value: string): void; end(): void };
export type Row = Record<string, unknown>;
declare const process: { env: Record<string, string | undefined> };

export function text(value: unknown) { return String(value ?? '').trim(); }
export function body(req: ApiRequest): Row { if (typeof req.body === 'string') { try { return JSON.parse(req.body) as Row; } catch { return {}; } } return req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body as Row : {}; }
export function header(req: ApiRequest, name: string) { const key = Object.keys(req.headers ?? {}).find((item) => item.toLowerCase() === name.toLowerCase()); const value = key ? req.headers?.[key] : undefined; return Array.isArray(value) ? text(value[0]) : text(value); }
export function bearer(req: ApiRequest) { return header(req, 'authorization').match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? ''; }
export function serviceClient() { const url = text(process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL); const key = text(process.env.SUPABASE_SERVICE_ROLE_KEY); if (!url || !key) throw new Error('maps_backend_not_configured'); return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }); }
export function setCors(req: ApiRequest, res: ApiResponse) { const origin = header(req, 'origin'); if (/^chrome-extension:\/\/[a-p]{32}$/i.test(origin)) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); } res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization'); res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); }
export function send(req: ApiRequest, res: ApiResponse, status: number, payload: unknown) { setCors(req, res); return res.status(status).json(payload); }
export function normalize(value: unknown) { return text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' '); }

export async function authenticatedUser(req: ApiRequest) {
  const token = bearer(req);
  if (!token) throw new Error('auth_required');
  const url = text(process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL);
  const key = text(process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY);
  if (!url || !key) throw new Error('supabase_auth_backend_not_configured');
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
  const auth = await client.auth.getUser(token);
  if (auth.error || !auth.data.user) throw new Error('auth_invalid');
  const result = await client.from('users').select('users_id').eq('auth_user_id', auth.data.user.id).maybeSingle();
  if (result.error || !result.data?.users_id) throw new Error('public_user_not_found');
  return { authUserId: auth.data.user.id, usersId: Number(result.data.users_id) };
}

export async function extensionScope(req: ApiRequest, scopes: MapsExtensionScope[]) {
  const payload = await verifyMapsExtensionToken(bearer(req), scopes);
  const client = serviceClient();
  const installation = await client.from('maps_extension_installations').select('maps_extension_installations_id,status,scopes').eq('users_id', Number(payload.sub)).eq('extension_type', 'google_maps').eq('installation_id', payload.installationId).maybeSingle();
  if (installation.error || !installation.data || installation.data.status !== 'active') throw new Error('gmaps_extension_installation_revoked');
  const installationScopes = new Set(Array.isArray(installation.data.scopes) ? installation.data.scopes.map(String) : []);
  if (payload.scopes.some((scope) => !installationScopes.has(scope))) throw new Error('gmaps_extension_scope_revoked');
  await client.from('maps_extension_installations').update({ last_seen_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('maps_extension_installations_id', installation.data.maps_extension_installations_id);
  return { client, usersId: Number(payload.sub), installationId: payload.installationId, installationRowId: String(installation.data.maps_extension_installations_id), token: payload };
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
