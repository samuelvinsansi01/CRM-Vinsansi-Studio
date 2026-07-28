import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { issueInstagramExtensionToken, normalizeInstagramProfile } from './token';

type ApiRequest = { method?: string; body?: unknown; headers?: Record<string, string | string[] | undefined> };
type ApiResponse = { status(code: number): ApiResponse; json(body: unknown): void; setHeader(name: string, value: string): void };
type RecordValue = Record<string, unknown>;
declare const process: { env: Record<string, string | undefined> };

function envAny(...names: string[]) {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return '';
}
function bodyRecord(body: unknown): RecordValue {
  if (typeof body === 'string') { try { return JSON.parse(body) as RecordValue; } catch { return {}; } }
  return body && typeof body === 'object' && !Array.isArray(body) ? body as RecordValue : {};
}
function header(req: ApiRequest, name: string) {
  const key = Object.keys(req.headers ?? {}).find((item) => item.toLowerCase() === name.toLowerCase());
  const value = key ? req.headers?.[key] : undefined;
  return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '');
}
function bearer(req: ApiRequest) { return header(req, 'authorization').match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? ''; }
function queueTable() { return envAny('SUPABASE_TABLE_INSTAGRAM_QUEUE_ITEMS', 'VITE_SUPABASE_TABLE_INSTAGRAM_QUEUE_ITEMS') || 'instagram_queue_items'; }
function send(res: ApiResponse, status: number, payload: unknown) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json(payload);
}

async function authenticate(req: ApiRequest): Promise<{ client: SupabaseClient; publicUserId: string }> {
  const token = bearer(req);
  const url = envAny('SUPABASE_URL', 'VITE_SUPABASE_URL');
  const key = envAny('SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_ANON_KEY');
  if (!token) throw new Error('auth_required');
  if (!url || !key) throw new Error('supabase_auth_backend_not_configured');
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) throw new Error('auth_invalid');
  const { data: publicUser, error: publicError } = await client.from('users').select('users_id').eq('auth_user_id', data.user.id).maybeSingle();
  if (publicError || !publicUser?.users_id) throw new Error('public_user_not_found');
  return { client, publicUserId: String(publicUser.users_id) };
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method_not_allowed' });
  try {
    const auth = await authenticate(req);
    const body = bodyRecord(req.body);
    const profile = normalizeInstagramProfile(body.profile_username ?? body.profile);
    if (!profile) return send(res, 400, { ok: false, error: 'instagram_profile_required' });

    const { data, error } = await auth.client
      .from(queueTable())
      .select('profile_username')
      .eq('user_id', auth.publicUserId)
      .limit(1000);
    if (error) throw new Error(`instagram_profile_authorization_failed:${error.message}`);
    const available = (data ?? []).some((row) => normalizeInstagramProfile(row.profile_username) === profile);
    if (!available) return send(res, 403, { ok: false, error: 'instagram_profile_not_available_for_current_user' });

    const issued = await issueInstagramExtensionToken({ userId: auth.publicUserId, profile });
    return send(res, 200, {
      ok: true,
      token: issued.token,
      profile_username: issued.payload.profile,
      expires_at: new Date(issued.payload.exp * 1000).toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'instagram_pairing_error';
    const status = ['auth_required', 'auth_invalid'].includes(message) ? 401
      : message === 'instagram_profile_not_available_for_current_user' ? 403
      : message === 'instagram_profile_required' ? 400
      : message === 'instagram_extension_signing_secret_not_configured' ? 503
      : 500;
    return send(res, status, { ok: false, error: message, message });
  }
}
