import { createClient, type SupabaseClient } from '@supabase/supabase-js';

type ApiRequest = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
};

type ApiResponse = {
  status(code: number): ApiResponse;
  json(body: unknown): void;
  setHeader(name: string, value: string): void;
};

declare const process: { env: Record<string, string | undefined> };

type RecordValue = Record<string, unknown>;
type BatchAction = 'start' | 'pause' | 'resume' | 'stop' | 'status';

type AuthContext = {
  client: SupabaseClient;
  authUserId: string;
  publicUserId: string;
};

type QueueItem = {
  id: string;
  user_id?: string | number | null;
  status?: string | null;
  chip_instance?: string | null;
  chip_label?: string | null;
  data?: RecordValue | null;
};

function envAny(...names: string[]) {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return '';
}

function requestBody(body: unknown): RecordValue {
  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as RecordValue : {};
    } catch {
      return {};
    }
  }
  return body && typeof body === 'object' && !Array.isArray(body) ? body as RecordValue : {};
}

function headerValue(req: ApiRequest, name: string) {
  const target = name.toLowerCase();
  const headers = req.headers ?? {};
  const key = Object.keys(headers).find((item) => item.toLowerCase() === target);
  const value = key ? headers[key] : undefined;
  return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '');
}

function bearerToken(req: ApiRequest) {
  const match = headerValue(req, 'authorization').trim().match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? '';
}

function normalizeIds(value: unknown) {
  const source = Array.isArray(value) ? value : [];
  return Array.from(new Set(source.map((item) => String(item ?? '').trim()).filter(Boolean)));
}

function normalizeAction(value: unknown): BatchAction | '' {
  const action = String(value ?? '').trim().toLowerCase();
  return ['start', 'pause', 'resume', 'stop', 'status'].includes(action) ? action as BatchAction : '';
}

function queueTable() {
  return envAny('SUPABASE_TABLE_WHATSAPP_QUEUE_ITEMS', 'VITE_SUPABASE_TABLE_WHATSAPP_QUEUE_ITEMS') || 'whatsapp_queue_items';
}

function authConfig() {
  return {
    url: envAny('SUPABASE_URL', 'VITE_SUPABASE_URL').replace(/\/$/, ''),
    anonKey: envAny('SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_PUBLISHABLE_KEY'),
  };
}

function workerBatchConfig() {
  const configured = envAny('WHATSAPP_WORKER_BATCH_URL').replace(/\/$/, '');
  const workerBase = envAny('WHATSAPP_VALIDATION_WORKER_URL', 'WHATSAPP_VALIDATION_WORKER_HEALTH_URL').replace(/\/$/, '');
  return {
    baseUrl: configured || (workerBase ? `${workerBase}/batch/whatsapp` : ''),
    token: envAny('WHATSAPP_WORKER_BATCH_TOKEN', 'WHATSAPP_WORKER_DISPATCH_TOKEN', 'WHATSAPP_VALIDATION_WORKER_TOKEN', 'WHATSAPP_VALIDATION_WORKER_HEALTH_TOKEN'),
    timeoutMs: Math.max(5_000, Number(envAny('WHATSAPP_WORKER_BATCH_TIMEOUT_MS', 'WHATSAPP_WORKER_DISPATCH_TIMEOUT_MS') || 15_000)),
  };
}

function send(res: ApiResponse, status: number, payload: unknown) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json(payload);
}

async function authenticate(req: ApiRequest): Promise<AuthContext> {
  const token = bearerToken(req);
  const config = authConfig();
  if (!token) throw new Error('auth_required');
  if (!config.url || !config.anonKey) throw new Error('supabase_auth_backend_not_configured');

  const client = createClient(config.url, config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: authData, error: authError } = await client.auth.getUser(token);
  if (authError || !authData.user) throw new Error('auth_invalid');

  const { data: publicUser, error: publicUserError } = await client
    .from('users')
    .select('users_id,auth_user_id')
    .eq('auth_user_id', authData.user.id)
    .maybeSingle();
  if (publicUserError || !publicUser?.users_id) throw new Error('public_user_not_found');

  return {
    client,
    authUserId: authData.user.id,
    publicUserId: String(publicUser.users_id),
  };
}

function nestedValue(item: QueueItem, ...keys: string[]) {
  const data = item.data && typeof item.data === 'object' ? item.data : {};
  for (const key of keys) {
    const value = (item as RecordValue)[key] ?? data[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return '';
}

function itemStatus(item: QueueItem) {
  return nestedValue(item, 'status').toLowerCase();
}

function itemChip(item: QueueItem) {
  return nestedValue(item, 'chip_instance', 'chipInstance', 'chip');
}

async function resolveOwnedQueueItems(auth: AuthContext, ids: string[]): Promise<QueueItem[]> {
  const { data, error } = await auth.client
    .from(queueTable())
    .select('id,user_id,status,chip_instance,chip_label,data')
    .eq('user_id', auth.publicUserId)
    .in('id', ids);
  if (error) throw new Error(`queue_authorization_check_failed:${error.message}`);

  const byId = new Map((data ?? []).map((row) => [String(row.id), row as QueueItem]));
  if (byId.size !== ids.length || ids.some((id) => !byId.has(id))) {
    throw new Error('queue_item_not_available_for_current_user');
  }
  return ids.map((id) => byId.get(id)!).filter(Boolean);
}

function assertStartContract(items: QueueItem[], requestedChip: string) {
  const blocked = items.find((item) => !['queued', 'paused'].includes(itemStatus(item)));
  if (blocked) throw new Error(`queue_item_not_dispatchable:${blocked.id}:${itemStatus(blocked) || 'unknown'}`);

  const chips = new Set(items.map(itemChip).filter(Boolean));
  if (chips.size !== 1) throw new Error('batch_multiple_chips_not_supported');
  const chip = Array.from(chips)[0] ?? '';
  if (!chip) throw new Error('batch_chip_required');
  if (requestedChip && requestedChip !== chip) throw new Error('batch_chip_mismatch');
  return chip;
}

function safeWorkerError(payload: unknown, fallback: string) {
  const record = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as RecordValue : null;
  return String(record?.message ?? record?.error ?? fallback).trim() || fallback;
}

async function callWorker(action: BatchAction, publicUserId: string, input: { queueItemIds: string[]; chipInstance: string }) {
  const config = workerBatchConfig();
  if (!config.baseUrl) throw new Error('worker_batch_backend_not_configured');
  if (!config.token) throw new Error('worker_batch_token_not_configured');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(`${config.baseUrl}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Worker-Token': config.token },
      body: JSON.stringify({
        user_id: publicUserId,
        queue_item_ids: input.queueItemIds,
        chip_instance: input.chipInstance,
      }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok === false) {
      const error = new Error(safeWorkerError(payload, `worker_http_${response.status}`));
      (error as Error & { statusCode?: number; payload?: unknown }).statusCode = response.status;
      (error as Error & { statusCode?: number; payload?: unknown }).payload = payload;
      throw error;
    }
    return payload;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('worker_batch_timeout');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method_not_allowed' });

  try {
    const body = requestBody(req.body);
    const action = normalizeAction(body.action);
    if (!action) return send(res, 400, { ok: false, error: 'batch_action_invalid' });

    const auth = await authenticate(req);
    const ids = normalizeIds(body.queue_item_ids ?? body.ids ?? body.queueItemIds);
    let chipInstance = String(body.chip_instance ?? body.chipInstance ?? body.chip ?? '').trim();

    if (action === 'start') {
      if (!ids.length) return send(res, 400, { ok: false, error: 'batch_queue_item_ids_required' });
      if (ids.length > 1000) return send(res, 400, { ok: false, error: 'batch_queue_item_limit_exceeded' });
      const items = await resolveOwnedQueueItems(auth, ids);
      chipInstance = assertStartContract(items, chipInstance);
    } else if (!chipInstance) {
      return send(res, 400, { ok: false, error: 'batch_chip_required', message: 'Informe o chip do lote.' });
    }

    const payload = await callWorker(action, auth.publicUserId, { queueItemIds: ids, chipInstance });
    return send(res, action === 'start' ? 202 : 200, payload);
  } catch (error) {
    const typed = error as Error & { statusCode?: number; payload?: unknown };
    const message = typed instanceof Error ? typed.message : 'worker_batch_proxy_error';
    const status =
      message === 'auth_required' || message === 'auth_invalid' ? 401 :
      message === 'queue_item_not_available_for_current_user' ? 403 :
      message.startsWith('queue_item_not_dispatchable') ||
      ['batch_action_invalid', 'batch_queue_item_ids_required', 'batch_queue_item_limit_exceeded', 'batch_chip_required', 'batch_chip_mismatch', 'batch_multiple_chips_not_supported'].includes(message) ? 400 :
      ['worker_batch_backend_not_configured', 'worker_batch_token_not_configured', 'supabase_auth_backend_not_configured', 'public_user_not_found'].includes(message) ? 503 :
      message === 'worker_batch_timeout' ? 504 :
      Number(typed.statusCode) || 502;

    return send(res, status, {
      ok: false,
      error: message,
      message:
        message === 'worker_batch_backend_not_configured' ? 'Agendador do Worker WhatsApp não configurado no backend.' :
        message === 'worker_batch_token_not_configured' ? 'Token do agendador WhatsApp não configurado no backend.' :
        message === 'queue_item_not_available_for_current_user' ? 'Um ou mais itens da fila não pertencem à sessão atual.' :
        message === 'auth_required' || message === 'auth_invalid' ? 'Sessão inválida. Entre novamente no painel.' :
        message === 'worker_batch_timeout' ? 'O Worker não respondeu dentro do prazo.' :
        safeWorkerError(typed.payload, message),
    });
  }
}
