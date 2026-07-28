import { createClient, type SupabaseClient } from '@supabase/supabase-js';

type ApiRequest = { method?: string; body?: unknown; headers?: Record<string, string | string[] | undefined> };
type ApiResponse = { status(code: number): ApiResponse; json(body: unknown): void; setHeader(name: string, value: string): void };
declare const process: { env: Record<string, string | undefined> };
export const maxDuration = 60;

type RecordValue = Record<string, unknown>;
type AuthContext = { client: SupabaseClient; publicUserId: string };

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
function idsOf(value: unknown) { return Array.from(new Set((Array.isArray(value) ? value : []).map(String).map((item) => item.trim()).filter(Boolean))); }
function queueTable() { return envAny('SUPABASE_TABLE_WHATSAPP_QUEUE_ITEMS', 'VITE_SUPABASE_TABLE_WHATSAPP_QUEUE_ITEMS') || 'whatsapp_queue_items'; }
function send(res: ApiResponse, status: number, payload: unknown) { res.setHeader('Cache-Control', 'no-store'); return res.status(status).json(payload); }

async function auth(req: ApiRequest): Promise<AuthContext> {
  const token = bearer(req);
  const url = envAny('SUPABASE_URL', 'VITE_SUPABASE_URL');
  const key = envAny('SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_PUBLISHABLE_KEY');
  if (!token) throw new Error('auth_required');
  if (!url || !key) throw new Error('supabase_auth_backend_not_configured');
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) throw new Error('auth_invalid');
  const { data: publicUser, error: publicError } = await client.from('users').select('users_id').eq('auth_user_id', data.user.id).maybeSingle();
  if (publicError || !publicUser?.users_id) throw new Error('public_user_not_found');
  return { client, publicUserId: String(publicUser.users_id) };
}

async function assertOwned(authContext: AuthContext, ids: string[]) {
  const { data, error } = await authContext.client.from(queueTable()).select('id,user_id,status').eq('user_id', authContext.publicUserId).in('id', ids);
  if (error) throw new Error(`queue_authorization_check_failed:${error.message}`);
  const returned = new Set((data ?? []).map((row) => String(row.id)));
  if (returned.size !== ids.length || ids.some((id) => !returned.has(id))) throw new Error('queue_item_not_available_for_current_user');
}

async function callWorker(ids: string[], publicUserId: string) {
  const base = envAny('WHATSAPP_WORKER_DISPATCH_URL') || `${envAny('WHATSAPP_VALIDATION_WORKER_URL', 'WHATSAPP_VALIDATION_WORKER_HEALTH_URL').replace(/\/$/, '')}/dispatch/whatsapp`;
  const token = envAny('WHATSAPP_WORKER_DISPATCH_TOKEN', 'WHATSAPP_WORKER_BATCH_TOKEN', 'WHATSAPP_VALIDATION_WORKER_TOKEN', 'WHATSAPP_VALIDATION_WORKER_HEALTH_TOKEN');
  if (!base || base === '/dispatch/whatsapp') throw new Error('worker_dispatch_backend_not_configured');
  if (!token) throw new Error('worker_dispatch_token_not_configured');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(5_000, Number(envAny('WHATSAPP_WORKER_DISPATCH_TIMEOUT_MS') || 55_000)));
  try {
    const response = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Worker-Token': token },
      body: JSON.stringify({ user_id: publicUserId, queue_item_ids: ids }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok === false) throw new Error(String(payload?.message ?? payload?.error ?? `worker_http_${response.status}`));
    return payload;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('worker_dispatch_timeout');
    throw error;
  } finally { clearTimeout(timer); }
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method_not_allowed' });
  try {
    const body = bodyRecord(req.body);
    const ids = idsOf(body.queue_item_ids ?? body.ids ?? body.queueItemIds);
    if (!ids.length) return send(res, 400, { ok: false, error: 'queue_item_ids_required' });
    if (ids.length > 30) return send(res, 400, { ok: false, error: 'queue_item_limit_exceeded' });
    const authContext = await auth(req);
    await assertOwned(authContext, ids);
    return send(res, 200, await callWorker(ids, authContext.publicUserId));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'worker_dispatch_proxy_error';
    const status = message === 'auth_required' || message === 'auth_invalid' ? 401 : message === 'queue_item_not_available_for_current_user' ? 403 : message === 'queue_item_ids_required' || message === 'queue_item_limit_exceeded' ? 400 : message === 'worker_dispatch_timeout' ? 504 : 502;
    return send(res, status, { ok: false, error: message, message });
  }
}
