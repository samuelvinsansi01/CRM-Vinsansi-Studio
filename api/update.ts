import { createClient } from '@supabase/supabase-js';

type ApiRequest = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
};

type ApiResponse = {
  status(code: number): ApiResponse;
  json(body: unknown): void;
  setHeader(name: string, value: string): void;
  end(): void;
};

declare const process: {
  env: Record<string, string | undefined>;
};

type QueueRow = Record<string, unknown>;
type RequestBody = Record<string, unknown>;

function envAny(...names: string[]) {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && value !== null && value !== '') return String(value);
  }
  return '';
}

function tableName() {
  return envAny('SUPABASE_TABLE_INSTAGRAM_QUEUE_ITEMS', 'VITE_SUPABASE_TABLE_INSTAGRAM_QUEUE_ITEMS') || 'instagram_dispatch_items';
}

function supabase() {
  const url = envAny('SUPABASE_URL', 'VITE_SUPABASE_URL');
  const key = envAny('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY', 'VITE_SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_ANON_KEY');
  if (!url || !key) throw new Error('Supabase nao configurado no backend para a extensao Instagram.');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function bodyRecord(body: unknown): RequestBody {
  if (typeof body === 'string') {
    try {
      return JSON.parse(body) as RequestBody;
    } catch {
      return {};
    }
  }

  if (body && typeof body === 'object') return body as RequestBody;
  return {};
}

function headerValue(req: ApiRequest, name: string) {
  const headers = req.headers ?? {};
  const direct = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(direct) ? direct[0] ?? '' : String(direct ?? '');
}

function assertExtensionSecret(req: ApiRequest) {
  const expected = envAny('INSTAGRAM_EXTENSION_SECRET', 'EXTENSION_SECRET');
  if (!expected) return;
  const received = headerValue(req, 'x-instagram-extension-secret');
  if (received !== expected) throw new Error('Secret da extensao Instagram invalido.');
}

function dataRecord(row: QueueRow) {
  const data = row.data;
  return data && typeof data === 'object' ? data as QueueRow : {};
}

function text(value: unknown) {
  return String(value ?? '').trim();
}

function numberValue(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function cleanInstagramUsername(value: unknown) {
  return text(value)
    .replace(/^@+/, '')
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
    .replace(/^www\.instagram\.com\//i, '')
    .split(/[/?#]/)[0]
    .replace(/[^a-zA-Z0-9._]/g, '')
    .toLowerCase();
}

function statusOf(value: unknown) {
  const status = text(value).toLowerCase();
  if (['sent', 'enviado'].includes(status)) return 'sent';
  if (['invalid', 'invalidated', 'invalido', 'invalidado'].includes(status)) return 'invalid';
  if (['error', 'erro'].includes(status)) return 'error';
  if (['paused', 'pausado'].includes(status)) return 'paused';
  if (['following', 'seguindo'].includes(status)) return 'following';
  if (['dm_opened', 'dm aberto', 'dm_aberto'].includes(status)) return 'dm_opened';
  return 'queued';
}

function itemFromRow(row: QueueRow) {
  const data = dataRecord(row);
  const instagram = text(row.instagram_url ?? data.instagram_url ?? data.instagram ?? '');
  const username = text(row.instagram_username ?? data.instagram_username ?? cleanInstagramUsername(instagram));
  const blockNumber = numberValue(row.block_number ?? row.batch_number ?? data.block_number ?? data.batch_number, 1);
  const blockSize = numberValue(row.block_size ?? row.batch_limit ?? data.block_size ?? data.batch_limit, 15);
  const position = numberValue(row.position ?? data.position ?? data.order, 1);
  const status = statusOf(row.status ?? data.status ?? 'queued');

  return {
    ...data,
    id: text(row.id ?? data.id),
    item_id: text(row.id ?? data.id),
    queue_item_id: text(row.id ?? data.id),
    lead_id: text(row.lead_id ?? data.lead_id),
    user_id: text(row.user_id ?? data.user_id),
    profile_username: text(row.profile_username ?? data.profile_username ?? data.profile),
    scheduled_date: text(row.scheduled_date ?? data.scheduled_date),
    block_number: blockNumber,
    block_size: blockSize,
    batch_number: blockNumber,
    batch_limit: blockSize,
    position,
    order: position,
    status,
    company_name: text(row.company_name ?? data.company_name ?? data.company),
    parent_category: text(row.parent_category ?? row.branch_name ?? data.parent_category ?? data.branch),
    branch_name: text(row.branch_name ?? row.parent_category ?? data.branch_name ?? data.branch),
    lead_type: text(row.lead_type ?? data.lead_type ?? data.type ?? 'Instagram'),
    instagram_url: instagram,
    instagram_username: username,
    message_1: text(row.message_1 ?? data.message_1 ?? data.message1),
    message_2: text(row.message_2 ?? data.message_2 ?? data.message2),
    image_url: text(row.image_url ?? data.image_url ?? data.imageName),
    image_id: text(row.image_id ?? data.image_id),
    error_message: text(row.error_message ?? data.error_message),
    follow_status: text(row.follow_status ?? data.follow_status),
    sent_at: text(row.sent_at ?? data.sent_at),
    created_at: text(row.created_at ?? data.created_at),
    updated_at: text(row.updated_at ?? data.updated_at),
  };
}

function sortItems(a: ReturnType<typeof itemFromRow>, b: ReturnType<typeof itemFromRow>) {
  return (
    a.block_number - b.block_number ||
    a.position - b.position ||
    text(a.created_at).localeCompare(text(b.created_at)) ||
    text(a.id).localeCompare(text(b.id))
  );
}

function isActiveRow(row: QueueRow) {
  const data = dataRecord(row);
  if (row.active === false || data.active === false) return false;
  return text(row.status ?? data.status).toLowerCase() !== 'deleted';
}

function isQueuedItem(item: ReturnType<typeof itemFromRow>) {
  return ['queued', 'paused', 'following', 'dm_opened'].includes(item.status);
}

async function listInstagramItems(body: RequestBody) {
  const client = supabase();
  let query = client.from(tableName()).select('*');
  const userId = text(body.user_id);
  const profile = cleanInstagramUsername(body.profile_username);
  const scheduledDate = text(body.scheduled_date);

  if (userId) query = query.eq('user_id', userId);
  if (profile) query = query.eq('profile_username', profile);
  if (scheduledDate) query = query.eq('scheduled_date', scheduledDate);

  const { data, error } = await query
    .order('block_number', { ascending: true })
    .order('position', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) throw new Error(error.message);

  return (data ?? [])
    .filter((row) => isActiveRow(row as QueueRow))
    .map((row) => itemFromRow(row as QueueRow))
    .sort(sortItems);
}

function summary(items: Array<ReturnType<typeof itemFromRow>>) {
  return {
    total: items.length,
    queued: items.filter((item) => isQueuedItem(item)).length,
    sent: items.filter((item) => item.status === 'sent').length,
    errors: items.filter((item) => item.status === 'error').length,
    invalid: items.filter((item) => item.status === 'invalid').length,
  };
}

function nextStatus(body: RequestBody) {
  const action = text(body.update_action ?? body.status).toLowerCase();
  if (['sent', 'enviado'].includes(action)) return 'sent';
  if (['error', 'erro'].includes(action)) return 'error';
  if (['invalidated', 'invalid', 'invalido', 'invalidado'].includes(action)) return 'invalid';
  if (['dm_opened', 'dm'].includes(action)) return 'dm_opened';
  if (['follow', 'following'].includes(action)) return 'following';
  return statusOf(body.status ?? 'queued');
}

async function updateInstagramItem(body: RequestBody) {
  const id = text(body.id ?? body.item_id ?? body.queue_item_id);
  if (!id) throw new Error('ID do item Instagram nao informado.');

  const client = supabase();
  const { data, error } = await client.from(tableName()).select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Lead Instagram nao encontrado na fila.');

  const current = itemFromRow(data as QueueRow);
  const status = nextStatus(body);
  const timestamp = new Date().toISOString();
  const reason = text(body.reason ?? body.invalid_reason ?? body.error_message);
  const nextData = {
    ...dataRecord(data as QueueRow),
    ...current,
    status,
    error_message: reason || (status === 'error' || status === 'invalid' ? current.error_message : ''),
    invalid_reason: text(body.invalid_reason ?? body.reason),
    invalid_source: text(body.invalid_source),
    follow_status: text(body.follow_status ?? status),
    sent_at: status === 'sent' ? timestamp : current.sent_at,
    updated_at: timestamp,
  };

  const patch: QueueRow = {
    status,
    error_message: nextData.error_message,
    follow_status: nextData.follow_status,
    sent_at: status === 'sent' ? timestamp : data.sent_at ?? null,
    last_action_at: timestamp,
    updated_at: timestamp,
    data: nextData,
  };

  const { error: updateError } = await client.from(tableName()).update(patch).eq('id', id);
  if (updateError) throw new Error(updateError.message);

  return itemFromRow({ ...(data as QueueRow), ...patch });
}

async function handleInstagramQueue(body: RequestBody) {
  const items = await listInstagramItems(body);
  return { success: true, items, summary: summary(items) };
}

async function handleInstagramNext(body: RequestBody) {
  const items = await listInstagramItems(body);
  const blockNumber = numberValue(body.block_number, 0);
  const item = items.find((candidate) => isQueuedItem(candidate) && (!blockNumber || candidate.block_number === blockNumber)) ?? null;
  return { success: true, item, items, summary: summary(items) };
}

async function handleInstagramUpdate(body: RequestBody) {
  const item = await updateInstagramItem(body);
  return { success: true, item };
}

function setCors(res: ApiResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-instagram-extension-secret');
  res.setHeader('Content-Type', 'application/json');
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ success: false, error: 'Method not allowed' });
    return;
  }

  try {
    assertExtensionSecret(req);
    const body = bodyRecord(req.body);
    const action = text(body.action);

    if (action === 'instagram_queue') {
      res.status(200).json(await handleInstagramQueue(body));
      return;
    }

    if (action === 'instagram_next') {
      res.status(200).json(await handleInstagramNext(body));
      return;
    }

    if (action === 'instagram_update') {
      res.status(200).json(await handleInstagramUpdate(body));
      return;
    }

    res.status(400).json({ success: false, error: `Acao nao suportada: ${action || 'vazia'}` });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Erro na API da extensao Instagram.' });
  }
}
