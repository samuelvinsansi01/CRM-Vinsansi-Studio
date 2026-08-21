import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { organizationScopedAuthHeaders, resolveOrganizationContext } from '../../organization/context.js';

type ApiRequest = { method?: string; body?: unknown; headers?: Record<string, string | string[] | undefined> };
type ApiResponse = { status(code: number): ApiResponse; json(body: unknown): void; setHeader(name: string, value: string): void };
type RecordValue = Record<string, unknown>;
type AuthContext = { client: SupabaseClient; publicUserId: number; organizationId:number };
declare const process: { env: Record<string, string | undefined> };

function envAny(...names: string[]) { for (const name of names) { const value = process.env[name]; if (String(value ?? '').trim()) return String(value).trim(); } return ''; }
function bodyRecord(body: unknown): RecordValue { if (typeof body === 'string') { try { return JSON.parse(body) as RecordValue; } catch { return {}; } } return body && typeof body === 'object' && !Array.isArray(body) ? body as RecordValue : {}; }
function header(req: ApiRequest, name: string) { const key = Object.keys(req.headers ?? {}).find((item) => item.toLowerCase() === name.toLowerCase()); const value = key ? req.headers?.[key] : undefined; return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? ''); }
function bearer(req: ApiRequest) { return header(req, 'authorization').match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? ''; }
function idsOf(value: unknown) { return Array.from(new Set((Array.isArray(value) ? value : []).map(Number).filter(Number.isSafeInteger))); }
function send(res: ApiResponse, status: number, payload: unknown) { res.setHeader('Cache-Control', 'no-store'); return res.status(status).json(payload); }

async function authenticate(req: ApiRequest): Promise<AuthContext> {
  const token = bearer(req);
  const url = envAny('SUPABASE_URL', 'VITE_SUPABASE_URL');
  const key = envAny('SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_PUBLISHABLE_KEY');
  if (!token) throw new Error('auth_required');
  if (!url || !key) throw new Error('supabase_auth_backend_not_configured');
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: organizationScopedAuthHeaders(token, req.headers) } });
  const auth = await client.auth.getUser(token);
  if (auth.error || !auth.data.user) throw new Error('auth_invalid');
  const organization = await resolveOrganizationContext(client);
  const allowed = await client.rpc('has_organization_permission', { p_permission_key: 'queues.control' });
  if (allowed.error || allowed.data !== true) throw new Error('queue_control_permission_denied');
  return { client, publicUserId: organization.scopeUsersId,organizationId:organization.organizationId };
}

async function ownedItems(auth: AuthContext, ids: number[]) {
  const response = await auth.client.from('queue_items').select('queue_items_id,chips_id').eq('organizations_id',auth.organizationId).in('queue_items_id', ids);
  if (response.error) throw new Error(`queue_authorization_check_failed:${response.error.message}`);
  const rows = (response.data ?? []) as RecordValue[];
  if (rows.length !== ids.length) throw new Error('queue_item_not_available_for_current_user');
  return rows;
}

async function chipInstance(auth: AuthContext, items: RecordValue[], provided: string) {
  const chipIds = Array.from(new Set(items.map((row) => Number(row.chips_id)).filter(Number.isSafeInteger)));
  if (chipIds.length !== 1) throw new Error('batch_multiple_chips_not_supported');
  const chip = await auth.client.from('chips').select('chips_id,instances_id').eq('organizations_id',auth.organizationId).eq('chips_id', chipIds[0]).single();
  if (chip.error) throw new Error(`chip_not_found:${chip.error.message}`);
  const instance = await auth.client.from('instances').select('instances_name').eq('organizations_id',auth.organizationId).eq('instances_id', Number((chip.data as RecordValue).instances_id)).single();
  if (instance.error) throw new Error(`instance_not_found:${instance.error.message}`);
  const name = String((instance.data as RecordValue).instances_name ?? '');
  if (provided && provided !== name) throw new Error('batch_chip_mismatch');
  return name;
}

async function callWorker(action: string, ids: number[], chip: string) {
  const base = envAny('WHATSAPP_WORKER_BATCH_URL') || `${envAny('WHATSAPP_VALIDATION_WORKER_URL').replace(/\/$/, '')}/batch/whatsapp`;
  const token = envAny('WHATSAPP_WORKER_BATCH_TOKEN', 'WHATSAPP_VALIDATION_WORKER_TOKEN');
  if (!base || base === '/batch/whatsapp') throw new Error('worker_batch_backend_not_configured');
  if (!token) throw new Error('worker_batch_token_not_configured');
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${base.replace(/\/$/, '')}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Worker-Token': token }, body: JSON.stringify({ queue_item_ids: ids, chip_instance: chip }), signal: controller.signal });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok === false) throw new Error(String(payload?.message ?? payload?.error ?? `worker_http_${response.status}`));
    return payload;
  } finally { clearTimeout(timer); }
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method_not_allowed' });
  try {
    const body = bodyRecord(req.body);
    const action = String(body.action ?? '').toLowerCase();
    if (!['start','pause','resume','stop','state','status'].includes(action)) return send(res, 400, { ok: false, error: 'batch_action_invalid' });
    const auth = await authenticate(req);
    const ids = idsOf(body.queue_item_ids ?? body.ids ?? body.queueItemIds);
    let chip = String(body.chip_instance ?? body.chipInstance ?? '').trim();
    if (action === 'start') {
      if (!ids.length) return send(res, 400, { ok: false, error: 'batch_queue_item_ids_required' });
      const items = await ownedItems(auth, ids);
      chip = await chipInstance(auth, items, chip);
    } else if (!chip) return send(res, 400, { ok: false, error: 'batch_chip_required' });
    return send(res, action === 'start' ? 202 : 200, await callWorker(action, ids, chip));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'worker_batch_proxy_error';
    const status = message.includes('auth_') ? 401 : message.includes('not_available') ? 403 : message.includes('required') || message.includes('mismatch') || message.includes('multiple') ? 400 : 502;
    return send(res, status, { ok: false, error: message, message });
  }
}
