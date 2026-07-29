import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { normalizeInstagramProfile, verifyInstagramExtensionToken } from './token';

type ApiRequest = { method?: string; body?: unknown; headers?: Record<string, string | string[] | undefined> };
type ApiResponse = { status(code: number): ApiResponse; json(body: unknown): void; setHeader(name: string, value: string): void; end(): void };
type RecordValue = Record<string, unknown>;
type QueueStatus = 'queued' | 'following' | 'dm_opened' | 'sent' | 'paused' | 'error' | 'invalid';
type TokenScope = { userId: string; profile: string };
declare const process: { env: Record<string, string | undefined> };

function envAny(...names: string[]) { for (const name of names) { const value = process.env[name]; if (String(value ?? '').trim()) return String(value).trim(); } return ''; }
function bodyRecord(body: unknown): RecordValue { if (typeof body === 'string') { try { return JSON.parse(body) as RecordValue; } catch { return {}; } } return body && typeof body === 'object' && !Array.isArray(body) ? body as RecordValue : {}; }
function header(req: ApiRequest, name: string) { const key = Object.keys(req.headers ?? {}).find((item) => item.toLowerCase() === name.toLowerCase()); const value = key ? req.headers?.[key] : undefined; return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? ''); }
function bearer(req: ApiRequest) { return header(req, 'authorization').match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? ''; }
function text(value: unknown) { return String(value ?? '').trim(); }
function requestOrigin(req: ApiRequest) { return header(req, 'origin').trim(); }
function setCors(req: ApiRequest, res: ApiResponse) { const origin = requestOrigin(req); if (/^chrome-extension:\/\/[a-p]{32}$/i.test(origin)) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); } res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization'); res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); }
function send(req: ApiRequest, res: ApiResponse, status: number, payload: unknown) { setCors(req, res); return res.status(status).json(payload); }
function serviceClient() { const url = envAny('SUPABASE_URL', 'VITE_SUPABASE_URL'); const key = envAny('SUPABASE_SERVICE_ROLE_KEY'); if (!url || !key) throw new Error('instagram_extension_backend_not_configured'); return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }); }
function normalize(value: unknown) { return text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' '); }
function semanticStatus(name: unknown): QueueStatus { const value = normalize(name); if (value.includes('enviad') || value.includes('sent') || value.includes('conclu')) return 'sent'; if (value.includes('erro') || value.includes('error') || value.includes('falh')) return 'error'; if (value.includes('invalid') || value.includes('inval')) return 'invalid'; if (value.includes('paus')) return 'paused'; if (value.includes('dm')) return 'dm_opened'; if (value.includes('segu')) return 'following'; return 'queued'; }

async function tokenScope(req: ApiRequest): Promise<TokenScope> {
  const token = bearer(req);
  if (!token) throw new Error('extension_token_required');
  const payload = await verifyInstagramExtensionToken(token);
  return { userId: String(payload.sub), profile: normalizeInstagramProfile(payload.profile) };
}

async function catalog(client: SupabaseClient) {
  const response = await client.from('status').select('status_id,status_name');
  if (response.error) throw new Error(`status_catalog_failed:${response.error.message}`);
  const rows = (response.data ?? []) as RecordValue[];
  const nameById = new Map(rows.map((row) => [String(row.status_id), String(row.status_name)]));
  const idFor = (status: QueueStatus) => {
    const candidates: Record<QueueStatus, string[]> = {
      queued: ['na fila','fila','queued','pendente','ativo'],
      following: ['seguindo','following','processando'],
      dm_opened: ['dm aberta','dm aberto','dm_opened','processando'],
      sent: ['enviado','sent','concluido','finalizado'],
      paused: ['pausado','paused'],
      error: ['erro','error','falhou'],
      invalid: ['invalido','invalid'],
    };
    const found = rows.find((row) => candidates[status].some((candidate) => normalize(row.status_name).includes(normalize(candidate))));
    if (!found) throw new Error(`status_not_found:${status}`);
    return Number(found.status_id);
  };
  return { nameById, idFor };
}

async function instagramChannelId(client: SupabaseClient) {
  const response = await client.from('channels').select('channels_id,channels_name');
  if (response.error) throw new Error(response.error.message);
  const row = ((response.data ?? []) as RecordValue[]).find((item) => normalize(item.channels_name).includes('instagram'));
  if (!row) throw new Error('instagram_channel_not_found');
  return Number(row.channels_id);
}

async function socialForScope(client: SupabaseClient, scope: TokenScope) {
  const response = await client.from('socials').select('*').eq('users_id', Number(scope.userId));
  if (response.error) throw new Error(response.error.message);
  const row = ((response.data ?? []) as RecordValue[]).find((item) => normalizeInstagramProfile(item.socials_username) === scope.profile);
  if (!row) throw new Error('instagram_profile_not_available_for_token');
  return row;
}

async function loadItems(client: SupabaseClient, scope: TokenScope, scheduledDate?: string) {
  const social = await socialForScope(client, scope);
  const channelId = await instagramChannelId(client);
  let queuesQuery = client.from('queues').select('*').eq('users_id', Number(scope.userId)).eq('channels_id', channelId);
  if (scheduledDate) queuesQuery = queuesQuery.gte('queues_scheduled_at', `${scheduledDate}T00:00:00.000Z`).lt('queues_scheduled_at', `${scheduledDate}T23:59:59.999Z`);
  const queuesResponse = await queuesQuery;
  if (queuesResponse.error) throw new Error(queuesResponse.error.message);
  const queues = (queuesResponse.data ?? []) as RecordValue[];
  const queueIds = queues.map((row) => Number(row.queues_id));
  if (!queueIds.length) return [];
  const itemsResponse = await client.from('queue_items').select('*').eq('users_id', Number(scope.userId)).eq('socials_id', Number(social.socials_id)).in('queues_id', queueIds).order('queue_items_position');
  if (itemsResponse.error) throw new Error(itemsResponse.error.message);
  const items = (itemsResponse.data ?? []) as RecordValue[];
  const unique = (key: string) => Array.from(new Set(items.map((row) => Number(row[key])).filter(Number.isSafeInteger)));
  const load = async (table: string, key: string, values: number[]) => { if (!values.length) return [] as RecordValue[]; const response = await client.from(table).select('*').in(key, values); if (response.error) throw new Error(response.error.message); return (response.data ?? []) as RecordValue[]; };
  const [leads, templates] = await Promise.all<RecordValue[]>([
    load('leads','leads_id',unique('leads_id')),
    load('templates','templates_id',unique('templates_id')),
  ]);
  const statusesResponse = await client.from('status').select('status_id,status_name');
  if (statusesResponse.error) throw new Error(statusesResponse.error.message);
  const branchIds = Array.from(new Set(leads.map((row: RecordValue) => Number(row.branches_id)).filter(Number.isSafeInteger)));
  const branches: RecordValue[] = await load('branches','branches_id',branchIds);
  const leadMap = new Map<string, RecordValue>(leads.map((row: RecordValue) => [String(row.leads_id), row]));
  const templateMap = new Map<string, RecordValue>(templates.map((row: RecordValue) => [String(row.templates_id), row]));
  const branchMap = new Map<string, RecordValue>(branches.map((row: RecordValue) => [String(row.branches_id), row]));
  const statusMap = new Map<string, string>(((statusesResponse.data ?? []) as RecordValue[]).map((row: RecordValue) => [String(row.status_id), String(row.status_name)]));
  const queueMap = new Map(queues.map((row) => [String(row.queues_id), row]));
  return items.map((item) => {
    const lead = leadMap.get(String(item.leads_id)) ?? {};
    const template = templateMap.get(String(item.templates_id)) ?? {};
    const branch = branchMap.get(String(lead.branches_id)) ?? {};
    const queue = queueMap.get(String(item.queues_id)) ?? {};
    const position = Number(item.queue_items_position ?? 1);
    const blockSize = 15;
    const status = semanticStatus(statusMap.get(String(item.status_id)) ?? item.status_id);
    const instagramUrl = text(lead.leads_instagram);
    return {
      id: String(item.queue_items_id),
      queue_item_id: String(item.queue_items_id),
      lead_id: String(item.leads_id),
      profile_username: scope.profile,
      scheduled_date: text(item.queue_items_scheduled_at ?? queue.queues_scheduled_at).slice(0,10),
      block_number: Math.floor((position - 1) / blockSize) + 1,
      block_size: blockSize,
      position,
      status,
      company_name: text(lead.leads_name),
      phone: text(lead.leads_phone),
      parent_category: text(branch.branches_name),
      lead_type: lead.leads_website ? 'Com site' : 'Instagram',
      instagram_url: instagramUrl,
      instagram_username: normalizeInstagramProfile(instagramUrl),
      message_1: text(template.templates_message_1),
      message_2: text(template.templates_message_2),
      message_3: text(template.templates_message_3),
      message_4: text(template.templates_message_4),
      image_url: '',
      error_message: text(item.queue_items_error_message),
      attempts: Number(item.queue_items_attempts ?? 0),
      updated_at: text(item.queue_items_updated_at),
    };
  });
}

async function claimItem(client: SupabaseClient, scope: TokenScope, id: string, expected: QueueStatus = 'queued') {
  const items = await loadItems(client, scope);
  const item = items.find((row) => row.id === id);
  if (!item || semanticStatus(item.status) !== expected) return null;
  const statuses = await catalog(client);
  const response = await client.from('queue_items').update({ status_id: statuses.idFor('following'), queue_items_started_at: new Date().toISOString(), queue_items_updated_at: new Date().toISOString() }).eq('queue_items_id', Number(id)).eq('users_id', Number(scope.userId)).eq('status_id', statuses.idFor(expected)).select('queue_items_id').maybeSingle();
  if (response.error) throw new Error(response.error.message);
  if (!response.data) return null;
  return (await loadItems(client, scope)).find((row) => row.id === id) ?? null;
}

async function transition(client: SupabaseClient, scope: TokenScope, body: RecordValue) {
  const id = text(body.id);
  const target = semanticStatus(body.target_status) as QueueStatus;
  const expected = semanticStatus(body.expected_status) as QueueStatus;
  const statuses = await catalog(client);
  const patch: RecordValue = {
    status_id: statuses.idFor(target),
    queue_items_updated_at: new Date().toISOString(),
    queue_items_error_message: ['error','invalid'].includes(target) ? text(body.reason ?? body.invalid_reason) : null,
  };
  if (['sent','error','invalid'].includes(target)) patch.queue_items_finished_at = new Date().toISOString();
  const response = await client.from('queue_items').update(patch).eq('queue_items_id', Number(id)).eq('users_id', Number(scope.userId)).eq('status_id', statuses.idFor(expected)).select('leads_id').maybeSingle();
  if (response.error) throw new Error(response.error.message);
  if (!response.data) throw new Error('queue_transition_conflict');
  if (target === 'sent' || target === 'invalid') {
    const leadTarget = target === 'sent' ? 5 : 6;
    await client.from('leads').update({ lead_status_id: leadTarget, leads_updated_at: new Date().toISOString() }).eq('leads_id', Number((response.data as RecordValue).leads_id)).eq('users_id', Number(scope.userId)).eq('lead_status_id', 4);
  }
  return (await loadItems(client, scope)).find((row) => row.id === id) ?? null;
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method === 'OPTIONS') { setCors(req, res); return res.status(204).end(); }
  if (req.method !== 'POST') return send(req, res, 405, { ok: false, error: 'method_not_allowed' });
  try {
    const scope = await tokenScope(req);
    const body = bodyRecord(req.body);
    const action = text(body.action);
    const requestId = text(body.request_id);
    if (normalizeInstagramProfile(body.profile_username) !== scope.profile) throw new Error('profile_scope_mismatch');
    const client = serviceClient();
    if (action === 'queue') return send(req, res, 200, { ok: true, request_id: requestId, items: await loadItems(client, scope, text(body.scheduled_date)) });
    if (action === 'claim_next') {
      const items = await loadItems(client, scope, text(body.scheduled_date));
      const block = Number(body.block_number ?? 0);
      const candidate = items.find((item) => item.status === 'queued' && (!block || item.block_number === block));
      return send(req, res, 200, { ok: true, request_id: requestId, item: candidate ? await claimItem(client, scope, candidate.id) : null });
    }
    if (action === 'claim_item') return send(req, res, 200, { ok: true, request_id: requestId, item: await claimItem(client, scope, text(body.id)) });
    if (action === 'transition') return send(req, res, 200, { ok: true, request_id: requestId, item: await transition(client, scope, body) });
    return send(req, res, 400, { ok: false, request_id: requestId, error: 'action_invalid' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'instagram_extension_error';
    const status = message.includes('token') ? 401 : message.includes('scope') || message.includes('not_available') ? 403 : message.includes('conflict') ? 409 : message.includes('not_configured') ? 503 : 500;
    return send(req, res, status, { ok: false, error: message, message });
  }
}
