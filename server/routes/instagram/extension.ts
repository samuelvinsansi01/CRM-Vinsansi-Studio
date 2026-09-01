import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { normalizeInstagramUsername } from '../../instagram/identity.js';
import { executorStatus, sessionScope } from '../../tools/executor.js';

type ApiRequest = { method?: string; body?: unknown; headers?: Record<string, string | string[] | undefined> };
type ApiResponse = { status(code: number): ApiResponse; json(body: unknown): void; setHeader(name: string, value: string): void; end(): void };
type RecordValue = Record<string, unknown>;
type QueueStatus = 'queued' | 'following' | 'dm_opened' | 'sent' | 'paused' | 'error' | 'invalid';
type InstagramStep = 'queued' | 'claimed' | 'profile_opened' | 'following' | 'followed' | 'dm_opened' | 'messages_sending' | 'media_sending' | 'sent' | 'invalid' | 'error' | 'reconciliation_required';
type TokenScope = { organizationId: number; memberId: number; legacyScopeUsersId: number; profile: string; client: SupabaseClient; installationId: string };
declare const process: { env: Record<string, string | undefined> };

const CATALOG = {
  channels: { INSTAGRAM: 2 },
  status: { PENDING: 3, PROCESSING: 4, COMPLETED: 5, ERROR: 6, PAUSED: 8 },
  leadStatus: { QUEUED: 4, SENT: 5, INVALID: 6 },
} as const;

const QUEUE_STATUS_IDS: Record<QueueStatus, number> = {
  queued: CATALOG.status.PENDING,
  following: CATALOG.status.PROCESSING,
  dm_opened: CATALOG.status.PROCESSING,
  sent: CATALOG.status.COMPLETED,
  paused: CATALOG.status.PAUSED,
  error: CATALOG.status.ERROR,
  invalid: CATALOG.status.ERROR,
};

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
function semanticStatus(name: unknown): QueueStatus {
  const value = normalize(name);
  if (['concluido', 'sent', 'completed', 'enviado'].includes(value)) return 'sent';
  if (['invalid', 'invalidated', 'invalido', 'invalidado'].includes(value)) return 'invalid';
  if (['erro', 'error', 'failed', 'cancelado', 'cancelled'].includes(value)) return 'error';
  if (['pausado', 'paused'].includes(value)) return 'paused';
  if (['processando', 'processing', 'following', 'dm opened', 'sending'].includes(value)) return 'following';
  return 'queued';
}

function utcDate(value: unknown) {
  const raw = text(value);
  if (!raw) return '';
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? raw.slice(0, 10) : parsed.toISOString().slice(0, 10);
}

function displayStatus(queueStatus: QueueStatus, progressStepValue: unknown) {
  const step = text(progressStepValue);
  if (queueStatus === 'sent') return 'sent';
  if (queueStatus === 'invalid') return 'invalid';
  if (queueStatus === 'error') return 'error';
  if (queueStatus === 'paused') return 'paused';
  if (step === 'reconciliation_required') return 'reconciliation_required';
  if (step === 'sent') return 'sent';
  if (step === 'invalid') return 'invalid';
  if (step === 'error' && queueStatus !== 'queued') return 'error';
  if (['claimed', 'profile_opened', 'following', 'followed'].includes(step)) return 'following';
  if (['dm_opened', 'messages_sending', 'media_sending'].includes(step)) return 'dm_opened';
  return 'queued';
}

function queueSummary(items: RecordValue[]) {
  const statuses = items.map((item) => text(item.display_status || item.status));
  return {
    total: items.length,
    queued: statuses.filter((status) => ['queued', 'paused', 'following', 'dm_opened'].includes(status)).length,
    sent: statuses.filter((status) => status === 'sent').length,
    errors: statuses.filter((status) => ['error', 'reconciliation_required'].includes(status)).length,
    invalid: statuses.filter((status) => status === 'invalid').length,
  };
}

async function tokenScope(req: ApiRequest): Promise<TokenScope> {
  const scope=await sessionScope(req);
  if(scope.toolId!=='vinsansi_instagram')throw new Error('tool_scope_mismatch');
  const metadata=(scope.installation.metadata??{}) as RecordValue;
  const profile=normalizeInstagramUsername(metadata.instagramProfile);
  if(!profile)throw new Error('instagram_profile_not_bound');
  return {organizationId:scope.organizationId,memberId:Number(scope.context.memberId),legacyScopeUsersId:Number(scope.context.legacyScopeUsersId),profile,client:scope.client,installationId:scope.installationId};
}

async function catalog(client: SupabaseClient) {
  const response = await client.from('status').select('status_id,status_name');
  if (response.error) throw new Error(`status_catalog_failed:${response.error.message}`);
  const rows = (response.data ?? []) as RecordValue[];
  const nameById = new Map(rows.map((row) => [String(row.status_id), String(row.status_name)]));
  const expected = new Map<number, string>([
    [1, 'ativo'], [2, 'inativo'], [3, 'pendente'], [4, 'processando'],
    [5, 'concluido'], [6, 'erro'], [7, 'cancelado'], [8, 'pausado'],
  ]);
  for (const [id, name] of expected) {
    const found = rows.find((row) => Number(row.status_id) === id);
    if (!found || normalize(found.status_name) !== name) throw new Error(`status_catalog_contract_invalid:${id}:${name}`);
  }
  return { nameById, idFor: (status: QueueStatus) => QUEUE_STATUS_IDS[status] };
}

async function instagramChannelId(client: SupabaseClient) {
  const response = await client.from('channels').select('channels_id,channels_name').eq('channels_id', CATALOG.channels.INSTAGRAM).maybeSingle();
  if (response.error) throw new Error(response.error.message);
  if (!response.data || normalize((response.data as RecordValue).channels_name) !== 'instagram') throw new Error('instagram_channel_contract_invalid');
  return CATALOG.channels.INSTAGRAM;
}

async function socialForScope(client: SupabaseClient, scope: TokenScope) {
  const response = await client.from('socials').select('*').eq('organizations_id', scope.organizationId);
  if (response.error) throw new Error(response.error.message);
  const row = ((response.data ?? []) as RecordValue[]).find((item) => normalizeInstagramUsername(item.socials_username) === scope.profile);
  if (!row) throw new Error('instagram_profile_not_available_for_token');
  return row;
}

async function instagramBatchSize(client: SupabaseClient, scope: TokenScope) {
  const social = await socialForScope(client, scope);
  const levelId = Number(social.levels_id ?? 0);
  if (!Number.isSafeInteger(levelId) || levelId <= 0) throw new Error('instagram_profile_level_missing');
  const response = await client.from('levels')
    .select('levels_daily_limit,levels_queues,status_id')
    .eq('organizations_id', scope.organizationId)
    .eq('levels_id', levelId)
    .eq('status_id', 1)
    .maybeSingle();
  if (response.error) throw new Error(`instagram_level_read_failed:${response.error.message}`);
  if (!response.data) throw new Error('instagram_level_not_available');
  const row = response.data as RecordValue;
  const dailyLimit = Math.max(1, Number(row.levels_daily_limit ?? 1));
  const batches = Math.max(1, Number(row.levels_queues ?? 1));
  return Math.max(1, Math.floor(dailyLimit / batches));
}

async function loadItems(client: SupabaseClient, scope: TokenScope, scheduledDate?: string) {
  const social = await socialForScope(client, scope);
  const [channelId, blockSize] = await Promise.all([instagramChannelId(client), instagramBatchSize(client, scope)]);
  const queuesResponse = await client.from('queues').select('*').eq('organizations_id', scope.organizationId).eq('channels_id', channelId);
  if (queuesResponse.error) throw new Error(queuesResponse.error.message);
  const queues = (queuesResponse.data ?? []) as RecordValue[];
  const queueIds = queues.map((row) => Number(row.queues_id));
  if (!queueIds.length) return [];
  const queueMap = new Map(queues.map((row) => [String(row.queues_id), row]));
  const itemsResponse = await client.from('queue_items').select('*').eq('organizations_id', scope.organizationId).eq('socials_id', Number(social.socials_id)).in('queues_id', queueIds).order('queue_items_position').order('queue_items_id');
  if (itemsResponse.error) throw new Error(itemsResponse.error.message);
  const allItems = (itemsResponse.data ?? []) as RecordValue[];
  const items = scheduledDate
    ? allItems.filter((row) => utcDate(row.queue_items_scheduled_at ?? queueMap.get(String(row.queues_id))?.queues_scheduled_at) === scheduledDate)
    : allItems;
  const unique = (key: string) => Array.from(new Set(items.map((row) => Number(row[key])).filter(Number.isSafeInteger)));
  const load = async (table: string, key: string, values: number[]) => { if (!values.length) return [] as RecordValue[]; const response = await client.from(table).select('*').in(key, values); if (response.error) throw new Error(response.error.message); return (response.data ?? []) as RecordValue[]; };
  const [leads, templates, progressRows] = await Promise.all<RecordValue[]>([
    load('leads','leads_id',unique('leads_id')),
    load('templates','templates_id',unique('templates_id')),
    load('instagram_queue_progress','queue_items_id',items.map((row) => Number(row.queue_items_id))),
  ]);
  const statusesResponse = await client.from('status').select('status_id,status_name');
  if (statusesResponse.error) throw new Error(statusesResponse.error.message);
  const branchIds = Array.from(new Set(leads.map((row: RecordValue) => Number(row.branches_id)).filter(Number.isSafeInteger)));
  const branches: RecordValue[] = await load('branches','branches_id',branchIds);
  const leadMap = new Map<string, RecordValue>(leads.map((row: RecordValue) => [String(row.leads_id), row]));
  const templateMap = new Map<string, RecordValue>(templates.map((row: RecordValue) => [String(row.templates_id), row]));
  const branchMap = new Map<string, RecordValue>(branches.map((row: RecordValue) => [String(row.branches_id), row]));
  const statusMap = new Map<string, string>(((statusesResponse.data ?? []) as RecordValue[]).map((row: RecordValue) => [String(row.status_id), String(row.status_name)]));
  const activeItems = items.filter((item) => !['cancelado', 'cancelled', 'canceled'].includes(normalize(statusMap.get(String(item.status_id)) ?? item.status_id)));
  // A Fila final é a fonte canônica da ordem operacional. O lote/fila de origem
  // permanece apenas como histórico e nunca precede a posição do item.
  const orderedItems = [...activeItems].sort((a, b) =>
    Number(a.queue_items_position ?? 0) - Number(b.queue_items_position ?? 0)
    || Number(a.queue_items_id ?? 0) - Number(b.queue_items_id ?? 0));
  const progressMap = new Map(progressRows.map((row) => [String(row.queue_items_id), row]));
  return orderedItems.map((item, dailyIndex) => {
    const lead = leadMap.get(String(item.leads_id)) ?? {};
    const template = templateMap.get(String(item.templates_id)) ?? {};
    const branch = branchMap.get(String(lead.branches_id)) ?? {};
    const queue = queueMap.get(String(item.queues_id)) ?? {};
    const snapshot = bodyRecord(item.queue_items_payload_snapshot);
    const snapshotLead = bodyRecord(snapshot.lead);
    const snapshotRecipient = bodyRecord(snapshot.recipient);
    const snapshotMessages = bodyRecord(snapshot.messages);
    const snapshotMedia = bodyRecord(snapshot.media);
    const queuePosition = Number(item.queue_items_position ?? 1);
    const position = dailyIndex + 1;
    const progress = progressMap.get(String(item.queue_items_id)) ?? {};
    const statusName = statusMap.get(String(item.status_id)) ?? item.status_id;
    const queueStatus = semanticStatus(statusName);
    const progressStep = text(progress.step);
    // Recovery devolve a fila para pendente sem apagar o checkpoint. O status da
    // fila mantém o item reclamável; resume_step informa de onde continuar.
    const status = queueStatus === 'queued' ? 'queued' : (progressStep || queueStatus);
    const instagramRecipient = text(snapshotRecipient.instagram ?? snapshotLead.instagram ?? lead.leads_instagram);
    const instagramUsername = normalizeInstagramUsername(instagramRecipient);
    const website = text(snapshotLead.site ?? lead.leads_website);
    return {
      id: String(item.queue_items_id),
      queue_item_id: String(item.queue_items_id),
      lead_id: String(item.leads_id),
      profile_username: scope.profile,
      scheduled_date: utcDate(item.queue_items_scheduled_at ?? queue.queues_scheduled_at),
      block_number: Math.floor((position - 1) / blockSize) + 1,
      block_size: blockSize,
      position,
      queue_position: queuePosition,
      status,
      display_status: displayStatus(queueStatus, progressStep),
      claim_token: text(progress.claim_token),
      resume_step: text(progress.step) || 'claimed',
      progress_metadata: bodyRecord(progress.metadata),
      progress_attempts: Number(progress.attempts ?? 0),
      progress_error: text(progress.error_message),
      last_heartbeat_at: text(progress.last_heartbeat_at),
      finished_at: text(progress.finished_at),
      company_name: text(snapshotLead.company_name ?? lead.leads_name),
      phone: text(snapshotLead.phone ?? lead.leads_phone),
      parent_category: text(snapshotLead.branch_name ?? branch.branches_name),
      lead_type: website ? 'Com site' : 'Instagram',
      instagram_username: instagramUsername,
      recipient_error: instagramUsername ? '' : 'invalid_instagram_recipient_contract',
      message_1: text(snapshotMessages.message_1 ?? template.templates_message_1),
      message_2: text(snapshotMessages.message_2 ?? template.templates_message_2),
      message_3: text(snapshotMessages.message_3 ?? template.templates_message_3),
      message_4: text(snapshotMessages.message_4 ?? template.templates_message_4),
      image_url: text(snapshotMedia.name),
      image_name: text(snapshotMedia.name),
      image_required: Boolean(snapshotMedia.required),
      image_sha256: text(snapshotMedia.sha256),
      image_version: text(snapshotMedia.branch_updated_at),
      payload_hash: text(item.queue_items_payload_hash),
      payload_frozen_at: text(item.queue_items_payload_created_at),
      error_message: text(item.queue_items_error_message),
      attempts: Number(item.queue_items_attempts ?? 0),
      updated_at: text(item.queue_items_updated_at),
    };
  });
}

async function claimItem(client: SupabaseClient, scope: TokenScope, id: string, consumerId: string, scheduledDate?: string) {
  const itemBeforeClaim = (await loadItems(client, scope, scheduledDate)).find((row) => row.id === id) ?? null;
  if (!itemBeforeClaim) return null;
  if (!itemBeforeClaim.instagram_username) throw new Error('invalid_instagram_recipient_contract');
  const social = await socialForScope(client, scope);
  const response = await client.rpc('instagram_claim_queue_item_v2', {
    p_organizations_id: scope.organizationId,
    p_queue_item_id: Number(id),
    p_socials_id: Number(social.socials_id),
    p_consumer_id: consumerId || 'vinsansi-instagram',
    p_installation_id: scope.installationId,
    p_member_id: scope.memberId,
  });
  if (response.error) {
    if (/not_claimable|not_pending/i.test(response.error.message)) return null;
    throw new Error(response.error.message);
  }
  const claimed = Array.isArray(response.data) ? response.data[0] : response.data;
  await client.from('queue_items').update({dispatched_by_member_id:scope.memberId}).eq('organizations_id',scope.organizationId).eq('queue_items_id',Number(id)).is('dispatched_by_member_id',null);
  const item = (await loadItems(client, scope, scheduledDate)).find((row) => row.id === id) ?? null;
  return item ? {
    ...item,
    claim_token: text((claimed as RecordValue)?.claim_token),
    status: 'claimed',
    resume_step: text((claimed as RecordValue)?.step ?? item.resume_step) || 'claimed',
  } : null;
}

async function transition(client: SupabaseClient, scope: TokenScope, body: RecordValue) {
  const id = text(body.id);
  const step = text(body.step ?? body.target_status) as InstagramStep;
  const claimToken = text(body.claim_token);
  if (!claimToken) throw new Error('instagram_claim_token_required');
  const response = await client.rpc('instagram_update_queue_progress_v2', {
    p_organizations_id: scope.organizationId,
    p_queue_item_id: Number(id),
    p_claim_token: claimToken,
    p_step: step,
    p_message: text(body.reason ?? body.invalid_reason ?? body.error_message) || null,
    p_metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {},
  });
  if (response.error) throw new Error(response.error.message);
  return (await loadItems(client, scope, text(body.scheduled_date))).find((row) => row.id === id) ?? null;
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method === 'OPTIONS') { setCors(req, res); return res.status(204).end(); }
  if (req.method !== 'POST') return send(req, res, 405, { ok: false, error: 'method_not_allowed' });
  try {
    const scope = await tokenScope(req);
    const body = bodyRecord(req.body);
    const action = text(body.action);
    const requestId = text(body.request_id);
    if (normalizeInstagramUsername(body.profile_username) !== scope.profile) throw new Error('profile_scope_mismatch');
    const client = scope.client;
    const consumerId = text(body.consumer_id) || text(body.browser_id) || 'instagram-extension';
    if (action === 'queue') await client.rpc('instagram_recover_stale_items_v2', { p_organizations_id: scope.organizationId, p_stale_before: new Date(Date.now() - 15 * 60 * 1000).toISOString() });
    if (action === 'queue') {
      const items = await loadItems(client, scope, text(body.scheduled_date));
      return send(req, res, 200, { ok: true, request_id: requestId, items, summary: queueSummary(items) });
    }
    if (action === 'claim_next') {
      const items = await loadItems(client, scope, text(body.scheduled_date));
      const block = Number(body.block_number ?? 0);
      const candidates = items.filter((item) => item.status === 'queued' && (!block || item.block_number === block));
      const skippedInvalidRecipient = candidates
        .filter((item) => !item.instagram_username)
        .map((item) => ({
          id: item.id,
          queue_item_id: item.queue_item_id,
          lead_id: item.lead_id,
          position: item.position,
          block_number: item.block_number,
          error: 'invalid_instagram_recipient_contract',
        }));
      const candidate = items.find((item) => item.status === 'queued' && (!block || item.block_number === block) && Boolean(item.instagram_username));
      const claimedItem = candidate ? await claimItem(client, scope, candidate.id, consumerId, text(body.scheduled_date)) : null;
      const iterationStatus = claimedItem
        ? (skippedInvalidRecipient.length ? 'claimed_with_skipped_invalid_recipient' : 'claimed')
        : candidate
          ? 'claim_unavailable'
          : skippedInvalidRecipient.length
            ? 'invalid_instagram_recipients_only'
            : 'empty';
      return send(req, res, 200, {
        ok: true,
        request_id: requestId,
        item: claimedItem,
        iteration_status: iterationStatus,
        skipped_invalid_recipient: skippedInvalidRecipient,
      });
    }
    if (action === 'claim_item') return send(req, res, 200, { ok: true, request_id: requestId, item: await claimItem(client, scope, text(body.id), consumerId, text(body.scheduled_date)) });
    if (action === 'transition') return send(req, res, 200, { ok: true, request_id: requestId, item: await transition(client, scope, body) });
    return send(req, res, 400, { ok: false, request_id: requestId, error: 'action_invalid' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'instagram_extension_error';
    const status = message === 'invalid_instagram_recipient_contract' ? 422 : executorStatus(error);
    return send(req, res, status, { ok: false, error: message, message });
  }
}
