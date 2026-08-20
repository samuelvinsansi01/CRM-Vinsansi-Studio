import { createClient, type SupabaseClient } from '@supabase/supabase-js';

type ApiRequest = { method?: string; body?: unknown; headers?: Record<string, string | string[] | undefined> };
type ApiResponse = { status(code: number): ApiResponse; json(body: unknown): void; setHeader(name: string, value: string): void };
type Row = Record<string, unknown>;
declare const process: { env: Record<string, string | undefined> };

export const maxDuration = 45;

function envAny(...names: string[]) {
  for (const name of names) {
    const value = process.env[name];
    if (String(value ?? '').trim()) return String(value).trim();
  }
  return '';
}

function bodyRecord(body: unknown): Row {
  if (typeof body === 'string') {
    try { return JSON.parse(body) as Row; } catch { return {}; }
  }
  return body && typeof body === 'object' && !Array.isArray(body) ? body as Row : {};
}

function header(req: ApiRequest, name: string) {
  const key = Object.keys(req.headers ?? {}).find((item) => item.toLowerCase() === name.toLowerCase());
  const value = key ? req.headers?.[key] : undefined;
  return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '');
}

function bearer(req: ApiRequest) {
  return header(req, 'authorization').match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? '';
}

function send(res: ApiResponse, status: number, payload: unknown) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json(payload);
}

function text(value: unknown) { return String(value ?? '').trim(); }
function row(value: unknown): Row { return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}; }

async function auth(req: ApiRequest): Promise<{ userId: number }> {
  const token = bearer(req);
  const url = envAny('SUPABASE_URL', 'VITE_SUPABASE_URL');
  const key = envAny('SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_PUBLISHABLE_KEY');
  if (!token) throw new Error('auth_required');
  if (!url || !key) throw new Error('supabase_auth_backend_not_configured');
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const authResult = await client.auth.getUser(token);
  if (authResult.error || !authResult.data.user) throw new Error('auth_invalid');
  const userResult = await client.from('users').select('users_id').eq('auth_user_id', authResult.data.user.id).maybeSingle();
  if (userResult.error || !userResult.data?.users_id) throw new Error('public_user_not_found');
  return { userId: Number(userResult.data.users_id) };
}

function serviceClient(): SupabaseClient {
  const url = envAny('SUPABASE_URL', 'VITE_SUPABASE_URL');
  const key = envAny('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('chat_backend_not_configured');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function externalMessageId(payload: unknown) {
  const root = row(payload);
  const data = row(root.data);
  const key = row(root.key);
  const dataKey = row(data.key);
  const message = row(root.message);
  const messageKey = row(message.key);
  return text(key.id ?? dataKey.id ?? messageKey.id ?? root.messageId ?? data.messageId ?? root.id ?? data.id);
}

async function evolutionSend(url: string, instanceName: string, apiKey: string, recipient: string, message: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(`${url.replace(/\/$/, '')}/v1/whatsapp/instances/${encodeURIComponent(instanceName)}/messages/text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', apikey: apiKey },
      body: JSON.stringify({ number: recipient, text: message, delay: 0 }),
      signal: controller.signal,
    });
    const raw = await response.text();
    let payload: unknown = null;
    try { payload = raw ? JSON.parse(raw) : null; } catch { payload = { raw }; }
    if (!response.ok) {
      const detail = text(row(payload).message ?? row(payload).error ?? raw ?? `evolution_http_${response.status}`);
      const error = new Error(detail || `evolution_http_${response.status}`) as Error & { explicit?: boolean; payload?: unknown };
      error.explicit = true;
      error.payload = payload;
      throw error;
    }
    return { payload, externalId: externalMessageId(payload) };
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method_not_allowed' });
  let context: { userId: number } | null = null;
  let messageId = 0;
  let admin: SupabaseClient | null = null;
  try {
    const body = bodyRecord(req.body);
    const conversationId = Number(body.conversation_id ?? body.conversations_id ?? 0);
    const message = text(body.message ?? body.body ?? body.text);
    const idempotencyKey = text(body.idempotency_key ?? body.client_idempotency_key);
    if (!Number.isSafeInteger(conversationId) || conversationId <= 0) return send(res, 400, { ok: false, error: 'conversation_id_required' });
    if (!message || message.length > 4096) return send(res, 400, { ok: false, error: 'message_body_invalid' });
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)) {
      return send(res, 400, { ok: false, error: 'idempotency_key_uuid_required' });
    }

    context = await auth(req);
    admin = serviceClient();
    const prepared = await admin.rpc('service_prepare_outgoing_chat_message', {
      p_users_id: context.userId,
      p_conversations_id: conversationId,
      p_message_body: message,
      p_client_idempotency_key: idempotencyKey,
    });
    if (prepared.error) throw new Error(prepared.error.message);
    const candidate = Array.isArray(prepared.data) ? row(prepared.data[0]) : row(prepared.data);
    messageId = Number(candidate.conversation_messages_id ?? 0);
    if (!messageId) throw new Error('chat_outgoing_prepare_empty');

    const currentStatus = text(candidate.message_status);
    if (['sent', 'delivered', 'read'].includes(currentStatus)) {
      return send(res, 200, { ok: true, idempotent: true, message_id: messageId, external_message_id: candidate.external_message_id, status: currentStatus });
    }
    if (currentStatus === 'reconciliation_required') {
      return send(res, 409, { ok: false, error: 'chat_message_requires_reconciliation', message_id: messageId });
    }

    const instanceUrl = text(candidate.instance_url);
    const instanceName = text(candidate.instance_name);
    const apiKey = text(candidate.api_key);
    const recipient = text(candidate.recipient).replace(/\D/g, '');
    if (!instanceUrl || !instanceName || !apiKey || !recipient) throw new Error('chat_evolution_credentials_or_recipient_missing');

    const sending = await admin.from('conversation_messages').update({
      message_status: 'sending', conversation_messages_updated_at: new Date().toISOString(), error_message: null,
    }).eq('conversation_messages_id', messageId).eq('users_id', context.userId);
    if (sending.error) throw new Error(sending.error.message);

    try {
      const evolution = await evolutionSend(instanceUrl, instanceName, apiKey, recipient, message);
      const completed = await admin.rpc('service_complete_outgoing_chat_message', {
        p_users_id: context.userId,
        p_conversation_messages_id: messageId,
        p_status: 'sent',
        p_external_message_id: evolution.externalId || null,
        p_raw_payload: evolution.payload ?? {},
        p_error_message: null,
      });
      if (completed.error) throw new Error(completed.error.message);
      return send(res, 200, { ok: true, message_id: Number(completed.data ?? messageId), external_message_id: evolution.externalId || null, status: 'sent' });
    } catch (error) {
      const explicit = Boolean((error as Error & { explicit?: boolean }).explicit);
      const status = explicit ? 'failed' : 'reconciliation_required';
      const errorMessage = error instanceof DOMException && error.name === 'AbortError'
        ? 'Tempo limite ao enviar pela Evolution; confirme a entrega antes de tentar novamente.'
        : error instanceof Error ? error.message : 'Falha ao enviar pela Evolution.';
      const rawPayload = (error as Error & { payload?: unknown }).payload ?? {};
      const completed = await admin.rpc('service_complete_outgoing_chat_message', {
        p_users_id: context.userId,
        p_conversation_messages_id: messageId,
        p_status: status,
        p_external_message_id: null,
        p_raw_payload: rawPayload,
        p_error_message: errorMessage,
      });
      if (completed.error) throw new Error(`${errorMessage}; persistence:${completed.error.message}`);
      return send(res, explicit ? 502 : 409, { ok: false, error: status, message: errorMessage, message_id: messageId });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'chat_send_error';
    const status = message.includes('auth_') ? 401
      : message.includes('not_found') || message.includes('archived') ? 403
      : message.includes('required') || message.includes('invalid') ? 400
      : 502;
    if (admin && context && messageId) {
      await admin.from('conversation_messages').update({
        message_status: 'reconciliation_required', error_message: message,
        conversation_messages_updated_at: new Date().toISOString(),
      }).eq('conversation_messages_id', messageId).eq('users_id', context.userId).eq('message_status', 'sending');
    }
    return send(res, status, { ok: false, error: message, message_id: messageId || null });
  }
}
