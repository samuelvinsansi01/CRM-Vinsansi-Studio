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
  const headers = req.headers ?? {};
  const value = headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
  return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '');
}

function bearerToken(req: ApiRequest) {
  const authorization = headerValue(req, 'authorization').trim();
  const match = authorization.match(/^Bearer\s+(.+)$/i);
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
    anonKey: envAny('SUPABASE_ANON_KEY', 'VITE_SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_ANON_KEY'),
  };
}

function workerBatchConfig() {
  const configured = envAny('WHATSAPP_WORKER_BATCH_URL').replace(/\/$/, '');
  const healthBase = envAny('WHATSAPP_VALIDATION_WORKER_HEALTH_URL').replace(/\/$/, '');
  return {
    baseUrl: configured || (healthBase ? `${healthBase}/batch/whatsapp` : ''),
    token: envAny('WHATSAPP_WORKER_BATCH_TOKEN', 'WHATSAPP_WORKER_DISPATCH_TOKEN', 'WHATSAPP_VALIDATION_WORKER_HEALTH_TOKEN'),
    timeoutMs: Math.max(5_000, Number(envAny('WHATSAPP_WORKER_BATCH_TIMEOUT_MS', 'WHATSAPP_WORKER_DISPATCH_TIMEOUT_MS') || 15_000)),
  };
}

function send(res: ApiResponse, status: number, payload: unknown) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json(payload);
}

async function assertAuthenticatedUser(req: ApiRequest) {
  const token = bearerToken(req);
  const config = authConfig();
  if (!token) throw new Error('auth_required');
  if (!config.url || !config.anonKey) throw new Error('supabase_auth_backend_not_configured');

  const response = await fetch(`${config.url}/auth/v1/user`, {
    headers: { apikey: config.anonKey, Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error('auth_invalid');
  const payload = await response.json().catch(() => null) as RecordValue | null;
  const id = String(payload?.id ?? '').trim();
  if (!id) throw new Error('auth_invalid');
  return { id, token, config };
}

async function assertQueueOwnership(ids: string[], accessToken: string, config: { url: string; anonKey: string }) {
  const escapedIds = ids.map((id) => JSON.stringify(id)).join(',');
  const url = `${config.url}/rest/v1/${queueTable()}?select=id&id=in.(${encodeURIComponent(escapedIds)})`;
  const response = await fetch(url, { headers: { apikey: config.anonKey, Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error('queue_authorization_check_failed');
  const rows = await response.json().catch(() => []) as Array<RecordValue>;
  const returned = new Set(rows.map((row) => String(row?.id ?? '').trim()).filter(Boolean));
  if (returned.size !== ids.length || ids.some((id) => !returned.has(id))) throw new Error('queue_item_not_available_for_current_user');
}

function safeWorkerError(payload: unknown, fallback: string) {
  const record = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as RecordValue : null;
  return String(record?.message ?? record?.error ?? fallback).trim() || fallback;
}

async function callWorker(action: BatchAction, userId: string, input: RecordValue) {
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
        user_id: userId,
        queue_item_ids: input.queue_item_ids,
        chip_instance: input.chip_instance,
      }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(safeWorkerError(payload, `worker_http_${response.status}`));
      (error as Error & { statusCode?: number; payload?: unknown }).statusCode = response.status;
      (error as Error & { statusCode?: number; payload?: unknown }).payload = payload;
      throw error;
    }
    return payload;
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
    const auth = await assertAuthenticatedUser(req);
    const ids = normalizeIds(body.queue_item_ids ?? body.ids ?? body.queueItemIds);
    const chipInstance = String(body.chip_instance ?? body.chipInstance ?? body.chip ?? '').trim();

    if (action === 'start') {
      if (!ids.length) return send(res, 400, { ok: false, error: 'batch_queue_item_ids_required' });
      if (ids.length > 1000) return send(res, 400, { ok: false, error: 'batch_queue_item_limit_exceeded' });
      await assertQueueOwnership(ids, auth.token, auth.config);
    }

    const payload = await callWorker(action, auth.id, { queue_item_ids: ids, chip_instance: chipInstance });
    return send(res, action === 'start' ? 202 : 200, payload);
  } catch (error) {
    const typed = error as Error & { statusCode?: number; payload?: unknown };
    const message = typed instanceof Error ? typed.message : 'worker_batch_proxy_error';
    const status =
      message === 'auth_required' || message === 'auth_invalid' ? 401 :
      message === 'queue_item_not_available_for_current_user' ? 403 :
      message === 'batch_action_invalid' || message === 'batch_queue_item_ids_required' || message === 'batch_queue_item_limit_exceeded' ? 400 :
      message === 'worker_batch_backend_not_configured' || message === 'worker_batch_token_not_configured' || message === 'supabase_auth_backend_not_configured' ? 503 :
      Number(typed.statusCode) || 502;

    return send(res, status, {
      ok: false,
      error: message,
      message: message === 'worker_batch_backend_not_configured'
        ? 'Agendador do Worker WhatsApp não configurado no backend.'
        : message === 'worker_batch_token_not_configured'
          ? 'Token do agendador WhatsApp não configurado no backend.'
          : message === 'queue_item_not_available_for_current_user'
            ? 'Um ou mais itens da fila não pertencem à sessão atual.'
            : message === 'auth_required' || message === 'auth_invalid'
              ? 'Sessão inválida. Entre novamente no painel.'
              : safeWorkerError(typed.payload, message),
    });
  }
}
