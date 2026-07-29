import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { issueInstagramExtensionToken, normalizeInstagramProfile } from './token';

type ApiRequest = { method?: string; body?: unknown; headers?: Record<string, string | string[] | undefined> };
type ApiResponse = { status(code: number): ApiResponse; json(body: unknown): void; setHeader(name: string, value: string): void };
type RecordValue = Record<string, unknown>;
declare const process: { env: Record<string, string | undefined> };

function envAny(...names: string[]) { for (const name of names) { const value = process.env[name]; if (String(value ?? '').trim()) return String(value).trim(); } return ''; }
function bodyRecord(body: unknown): RecordValue { if (typeof body === 'string') { try { return JSON.parse(body) as RecordValue; } catch { return {}; } } return body && typeof body === 'object' && !Array.isArray(body) ? body as RecordValue : {}; }
function header(req: ApiRequest, name: string) { const key = Object.keys(req.headers ?? {}).find((item) => item.toLowerCase() === name.toLowerCase()); const value = key ? req.headers?.[key] : undefined; return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? ''); }
function bearer(req: ApiRequest) { return header(req, 'authorization').match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? ''; }
function send(res: ApiResponse, status: number, payload: unknown) { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); return res.status(status).json(payload); }

async function authenticate(req: ApiRequest): Promise<{ client: SupabaseClient; publicUserId: number }> {
  const token = bearer(req);
  const url = envAny('SUPABASE_URL', 'VITE_SUPABASE_URL');
  const key = envAny('SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_PUBLISHABLE_KEY');
  if (!token) throw new Error('auth_required');
  if (!url || !key) throw new Error('supabase_auth_backend_not_configured');
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
  const auth = await client.auth.getUser(token);
  if (auth.error || !auth.data.user) throw new Error('auth_invalid');
  const user = await client.from('users').select('users_id').eq('auth_user_id', auth.data.user.id).maybeSingle();
  if (user.error || !user.data?.users_id) throw new Error('public_user_not_found');
  return { client, publicUserId: Number(user.data.users_id) };
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method_not_allowed' });
  try {
    const auth = await authenticate(req);
    const body = bodyRecord(req.body);
    const profile = normalizeInstagramProfile(body.profile_username ?? body.profile);
    if (!profile) return send(res, 400, { ok: false, error: 'instagram_profile_required' });
    const profiles = await auth.client.from('socials').select('socials_id,socials_username').eq('users_id', auth.publicUserId);
    if (profiles.error) throw new Error(`instagram_profile_authorization_failed:${profiles.error.message}`);
    const available = ((profiles.data ?? []) as Array<{ socials_username?: unknown }>).some((row) => normalizeInstagramProfile(row.socials_username) === profile);
    if (!available) return send(res, 403, { ok: false, error: 'instagram_profile_not_available_for_current_user' });
    const issued = await issueInstagramExtensionToken({ userId: String(auth.publicUserId), profile });
    return send(res, 200, { ok: true, token: issued.token, profile_username: issued.payload.profile, expires_at: new Date(issued.payload.exp * 1000).toISOString() });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'instagram_pairing_error';
    const status = ['auth_required', 'auth_invalid'].includes(message) ? 401 : message.includes('not_available') ? 403 : message.includes('not_configured') ? 503 : 500;
    return send(res, status, { ok: false, error: message, message });
  }
}
