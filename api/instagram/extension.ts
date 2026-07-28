import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { normalizeInstagramProfile, verifyInstagramExtensionToken } from './token';

type ApiRequest = { method?: string; body?: unknown; headers?: Record<string, string | string[] | undefined> };
type ApiResponse = { status(code: number): ApiResponse; json(body: unknown): void; setHeader(name: string, value: string): void; end(): void };
type RecordValue = Record<string, unknown>;
type QueueStatus = 'queued' | 'following' | 'dm_opened' | 'sent' | 'paused' | 'error' | 'invalid';
type TokenScope = { userId: string; profile: string };
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
function text(value: unknown) { return String(value ?? '').trim(); }
function numberValue(value: unknown, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function booleanValue(value: unknown, fallback = false) {
  if (typeof value === 'boolean') return value;
  const normalized = text(value).toLowerCase();
  if (['true', '1', 'yes', 'sim'].includes(normalized)) return true;
  if (['false', '0', 'no', 'nao', 'não'].includes(normalized)) return false;
  return fallback;
}
function queueTable() { return envAny('SUPABASE_TABLE_INSTAGRAM_QUEUE_ITEMS', 'VITE_SUPABASE_TABLE_INSTAGRAM_QUEUE_ITEMS') || 'instagram_queue_items'; }
function leadsTable() { return envAny('SUPABASE_TABLE_IMPORT_LEADS', 'VITE_SUPABASE_TABLE_IMPORT_LEADS') || 'leads'; }
function serviceClient() {
  const url = envAny('SUPABASE_URL', 'VITE_SUPABASE_URL');
  const key = envAny('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('instagram_extension_backend_not_configured');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
function requestOrigin(req: ApiRequest) { return header(req, 'origin').trim(); }
function isAllowedOrigin(req: ApiRequest) {
  const origin = requestOrigin(req);
  return !origin || /^chrome-extension:\/\/[a-p]{32}$/i.test(origin);
}
function setCors(req: ApiRequest, res: ApiResponse) {
  const origin = requestOrigin(req);
  if (/^chrome-extension:\/\/[a-p]{32}$/i.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
}
function send(req: ApiRequest, res: ApiResponse, status: number, payload: unknown) { setCors(req, res); return res.status(status).json(payload); }
function normalizeStatus(value: unknown): QueueStatus {
  const status = text(value).toLowerCase();
  if (['following', 'seguindo'].includes(status)) return 'following';
  if (['dm_opened', 'dm_aberto', 'dm aberto'].includes(status)) return 'dm_opened';
  if (['sent', 'enviado'].includes(status)) return 'sent';
  if (['paused', 'pausado'].includes(status)) return 'paused';
  if (['error', 'erro'].includes(status)) return 'error';
  if (['invalid', 'invalidated', 'invalido', 'invalidado'].includes(status)) return 'invalid';
  return 'queued';
}
function rowData(row: RecordValue) { return row.data && typeof row.data === 'object' && !Array.isArray(row.data) ? row.data as RecordValue : {}; }
function queueItem(row: RecordValue) {
  const data = rowData(row);
  const instagramUrl = text(row.instagram_url ?? data.instagram_url ?? data.instagram);
  const username = normalizeInstagramProfile(row.instagram_username ?? data.instagram_username ?? instagramUrl);
  const message = (number: number) => text(row[`message_${number}`] ?? data[`message_${number}`] ?? data[`message${number}`]);
  return {
    id: text(row.id),
    queue_item_id: text(row.id),
    lead_id: text(row.lead_id ?? data.lead_id),
    profile_username: normalizeInstagramProfile(row.profile_username ?? data.profile_username ?? data.profile),
    scheduled_date: text(row.scheduled_date ?? data.scheduled_date),
    block_number: numberValue(row.block_number ?? row.batch_number ?? data.block_number ?? data.batch_number, 1),
    block_size: numberValue(row.block_size ?? row.batch_limit ?? data.block_size ?? data.batch_limit, 15),
    position: numberValue(row.position ?? data.position ?? data.order, 1),
    status: normalizeStatus(row.status ?? data.status),
    company_name: text(row.company_name ?? data.company_name ?? data.company),
    phone: text(row.phone ?? data.phone),
    parent_category: text(row.parent_category ?? row.branch_name ?? data.parent_category ?? data.branch),
    branch_name: text(row.branch_name ?? row.parent_category ?? data.branch_name ?? data.branch),
    lead_type: text(row.lead_type ?? data.lead_type ?? data.type ?? 'Instagram'),
    instagram_url: instagramUrl,
    instagram_username: username,
    message_1: message(1),
    message_2: message(2),
    message_3: message(3),
    message_4: message(4),
    image_name: text(data.imageName ?? data.image_name ?? row.image_url),
    image_required: booleanValue(data.imageRequired ?? data.image_required, Boolean(row.image_url)),
    image_url: text(row.image_url ?? data.image_url ?? data.imageName),
    error_message: text(row.error_message ?? data.error_message),
    sent_at: text(row.sent_at ?? data.sent_at),
    created_at: text(row.created_at ?? data.created_at),
    updated_at: text(row.updated_at ?? data.updated_at),
  };
}
function isActive(row: RecordValue) {
  const data = rowData(row);
  return row.active !== false && data.active !== false && text(row.status ?? data.status).toLowerCase() !== 'deleted';
}
function sortItems(a: ReturnType<typeof queueItem>, b: ReturnType<typeof queueItem>) {
  return a.block_number - b.block_number || a.position - b.position || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);
}
function summary(items: Array<ReturnType<typeof queueItem>>) {
  return {
    total: items.length,
    queued: items.filter((item) => ['queued', 'paused', 'following', 'dm_opened'].includes(item.status)).length,
    sent: items.filter((item) => item.status === 'sent').length,
    errors: items.filter((item) => item.status === 'error').length,
    invalid: items.filter((item) => item.status === 'invalid').length,
  };
}
async function scope(req: ApiRequest): Promise<TokenScope> {
  const token = bearer(req);
  if (!token) throw new Error('instagram_extension_token_required');
  const payload = await verifyInstagramExtensionToken(token);
  return { userId: payload.sub, profile: payload.profile };
}
async function listItems(client: SupabaseClient, tokenScope: TokenScope, body: RecordValue) {
  let query = client.from(queueTable()).select('*').eq('user_id', tokenScope.userId);
  const date = text(body.scheduled_date);
  if (date) query = query.eq('scheduled_date', date);
  const { data, error } = await query.order('block_number', { ascending: true }).order('position', { ascending: true }).order('created_at', { ascending: true });
  if (error) throw new Error(`instagram_queue_read_failed:${error.message}`);
  return (data ?? [])
    .filter((row) => isActive(row as RecordValue) && normalizeInstagramProfile((row as RecordValue).profile_username ?? rowData(row as RecordValue).profile_username ?? rowData(row as RecordValue).profile) === tokenScope.profile)
    .map((row) => queueItem(row as RecordValue))
    .sort(sortItems);
}
async function loadOwnedItem(client: SupabaseClient, tokenScope: TokenScope, id: string) {
  const { data, error } = await client.from(queueTable()).select('*').eq('id', id).eq('user_id', tokenScope.userId).maybeSingle();
  if (error) throw new Error(`instagram_queue_item_read_failed:${error.message}`);
  if (!data) throw new Error('instagram_queue_item_not_available');
  const row = data as RecordValue;
  const rowProfile = normalizeInstagramProfile(row.profile_username ?? rowData(row).profile_username ?? rowData(row).profile);
  if (rowProfile !== tokenScope.profile) throw new Error('instagram_queue_item_not_available');
  return row;
}
async function claimRow(client: SupabaseClient, tokenScope: TokenScope, row: RecordValue) {
  const contract = queueItem(row);
  const missingMessages = [contract.message_1, contract.message_2, contract.message_3, contract.message_4].map((value, index) => value ? null : index + 1).filter(Boolean);
  if (!contract.instagram_username || missingMessages.length) {
    throw new Error(`instagram_queue_contract_incomplete:${contract.id}:${missingMessages.join(',') || 'instagram'}`);
  }
  const id = text(row.id);
  const timestamp = new Date().toISOString();
  const data = rowData(row);
  const patch = {
    status: 'following',
    follow_status: 'following',
    error_message: '',
    last_action_at: timestamp,
    updated_at: timestamp,
    data: { ...data, status: 'following', follow_status: 'following', error_message: '', updated_at: timestamp },
  };
  const { data: claimed, error } = await client.from(queueTable()).update(patch)
    .eq('id', id).eq('user_id', tokenScope.userId).eq('status', 'queued').select('*').maybeSingle();
  if (error) throw new Error(`instagram_queue_claim_failed:${error.message}`);
  return claimed ? queueItem(claimed as RecordValue) : null;
}
async function claim(client: SupabaseClient, tokenScope: TokenScope, body: RecordValue) {
  const requestedId = text(body.id ?? body.queue_item_id);
  if (requestedId) {
    const row = await loadOwnedItem(client, tokenScope, requestedId);
    const current = queueItem(row);
    if (current.status === 'following') return current;
    if (current.status !== 'queued') throw new Error(`instagram_queue_item_not_claimable:${current.status}`);
    const claimed = await claimRow(client, tokenScope, row);
    if (!claimed) throw new Error('instagram_queue_claim_conflict');
    return claimed;
  }

  const items = await listItems(client, tokenScope, body);
  const block = numberValue(body.block_number, 0);
  const candidates = items.filter((item) => item.status === 'queued' && (!block || item.block_number === block)).slice(0, 20);
  for (const candidate of candidates) {
    const row = await loadOwnedItem(client, tokenScope, candidate.id);
    const claimed = await claimRow(client, tokenScope, row);
    if (claimed) return claimed;
  }
  return null;
}
const allowedTransitions: Record<QueueStatus, QueueStatus[]> = {
  queued: ['following', 'paused', 'error', 'invalid'],
  following: ['dm_opened', 'error', 'invalid'],
  dm_opened: ['sent', 'error', 'invalid'],
  sent: [],
  paused: ['queued', 'error', 'invalid'],
  error: ['queued', 'invalid'],
  invalid: [],
};
async function syncCanonicalLead(client: SupabaseClient, tokenScope: TokenScope, item: ReturnType<typeof queueItem>, target: QueueStatus) {
  if (!/^\d+$/.test(item.lead_id)) return { status: 'skipped', reason: 'lead_id_not_numeric' };
  const desired = target === 'sent' ? 5 : target === 'invalid' ? 6 : null;
  if (!desired) return { status: 'skipped' };
  const { data: current, error: readError } = await client.from(leadsTable()).select('leads_id,users_id,lead_status_id').eq('leads_id', Number(item.lead_id)).eq('users_id', tokenScope.userId).maybeSingle();
  if (readError) throw new Error(`instagram_lead_sync_read_failed:${readError.message}`);
  if (!current) return { status: 'missing' };
  if (Number(current.lead_status_id) === desired) return { status: 'already_synced' };
  if (Number(current.lead_status_id) !== 4) return { status: 'conflict', observed_status_id: current.lead_status_id };
  const { data: updated, error } = await client.from(leadsTable()).update({ lead_status_id: desired, leads_updated_at: new Date().toISOString() })
    .eq('leads_id', Number(item.lead_id)).eq('users_id', tokenScope.userId).eq('lead_status_id', 4).select('leads_id').maybeSingle();
  if (error) throw new Error(`instagram_lead_sync_failed:${error.message}`);
  return updated ? { status: 'synced' } : { status: 'conflict' };
}
async function transition(client: SupabaseClient, tokenScope: TokenScope, body: RecordValue) {
  const id = text(body.id ?? body.queue_item_id);
  if (!id) throw new Error('instagram_queue_item_id_required');
  const row = await loadOwnedItem(client, tokenScope, id);
  const current = queueItem(row);
  const rawTarget = text(body.target_status ?? body.status ?? body.update_action);
  if (!rawTarget) throw new Error('instagram_queue_target_status_required');
  const target = normalizeStatus(rawTarget);
  const expected = normalizeStatus(body.expected_status ?? current.status);
  if (current.status === target) {
    const leadSync = await syncCanonicalLead(client, tokenScope, current, target);
    return { item: current, idempotent: true, lead_sync: leadSync };
  }
  if (current.status !== expected) throw new Error(`instagram_queue_transition_conflict:${current.status}`);
  if (!allowedTransitions[current.status].includes(target)) throw new Error(`instagram_queue_transition_invalid:${current.status}:${target}`);

  const timestamp = new Date().toISOString();
  const reason = text(body.error_message ?? body.reason ?? body.invalid_reason);
  const data = rowData(row);
  const patch = {
    status: target,
    follow_status: target,
    error_message: ['error', 'invalid'].includes(target) ? reason || (target === 'invalid' ? 'Outros' : 'Erro operacional') : '',
    sent_at: target === 'sent' ? timestamp : row.sent_at ?? null,
    last_action_at: timestamp,
    updated_at: timestamp,
    data: {
      ...data,
      status: target,
      follow_status: target,
      error_message: ['error', 'invalid'].includes(target) ? reason || (target === 'invalid' ? 'Outros' : 'Erro operacional') : '',
      invalid_reason: target === 'invalid' ? reason || 'Outros' : text(data.invalid_reason),
      sent_at: target === 'sent' ? timestamp : text(data.sent_at),
      updated_at: timestamp,
    },
  };
  const { data: updated, error } = await client.from(queueTable()).update(patch)
    .eq('id', id).eq('user_id', tokenScope.userId).eq('status', current.status).select('*').maybeSingle();
  if (error) throw new Error(`instagram_queue_transition_failed:${error.message}`);
  if (!updated) throw new Error('instagram_queue_transition_conflict');
  const item = queueItem(updated as RecordValue);
  const leadSync = await syncCanonicalLead(client, tokenScope, item, target);
  return { item, idempotent: false, lead_sync: leadSync };
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (!isAllowedOrigin(req)) return res.status(403).json({ ok: false, error: 'instagram_extension_origin_not_allowed' });
  setCors(req, res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') return send(req, res, 405, { ok: false, error: 'method_not_allowed' });
  try {
    const tokenScope = await scope(req);
    const body = bodyRecord(req.body);
    const requestedProfile = normalizeInstagramProfile(body.profile_username);
    if (requestedProfile && requestedProfile !== tokenScope.profile) return send(req, res, 403, { ok: false, error: 'instagram_extension_profile_scope_mismatch' });
    const client = serviceClient();
    const action = text(body.action).toLowerCase();
    const requestId = text(body.request_id);
    if (!requestId || requestId.length > 128) return send(req, res, 400, { ok: false, error: 'instagram_extension_request_id_required' });

    if (action === 'queue') {
      const items = await listItems(client, tokenScope, body);
      return send(req, res, 200, { ok: true, request_id: requestId, items, summary: summary(items) });
    }
    if (action === 'claim_next' || action === 'claim_item') {
      const item = await claim(client, tokenScope, body);
      return send(req, res, 200, { ok: true, request_id: requestId, item });
    }
    if (action === 'transition') {
      const result = await transition(client, tokenScope, body);
      return send(req, res, 200, { ok: true, request_id: requestId, ...result });
    }
    return send(req, res, 400, { ok: false, error: 'instagram_extension_action_invalid' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'instagram_extension_api_error';
    const status = ['instagram_extension_token_required', 'instagram_extension_token_invalid', 'instagram_extension_token_expired'].includes(message) ? 401
      : ['instagram_extension_profile_scope_mismatch', 'instagram_queue_item_not_available'].includes(message) ? 403
      : message.includes('_required') || message.includes('_invalid') || message.includes('_not_claimable:') || message.includes('_transition_invalid:') || message.includes('_contract_incomplete:') ? 400
      : message.includes('_conflict') ? 409
      : message === 'instagram_extension_backend_not_configured' ? 503
      : 500;
    return send(req, res, status, { ok: false, error: message, message });
  }
}
