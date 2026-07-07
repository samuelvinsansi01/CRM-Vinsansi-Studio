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

/**
 * Este módulo atende a extensão diretamente no runtime serverless. Mantemos a
 * interpolação local para não depender de imports do diretório src/, que a
 * Vercel não inclui de forma confiável para esta função.
 */
type TemplateVariableContext = {
  company?: string;
  company_name?: string;
  empresa?: string;
  branch?: string;
  ramo?: string;
  city?: string;
  cidade?: string;
  state?: string;
  estado?: string;
  phone?: string;
  whatsapp?: string;
  instagram?: string;
  site?: string;
};

function cleanTemplateValue(value: unknown) {
  return String(value ?? '').trim();
}

function normalizeTemplateKey(value: unknown) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function templateVariables(context: TemplateVariableContext) {
  const company = cleanTemplateValue(context.company ?? context.company_name ?? context.empresa);
  const branch = cleanTemplateValue(context.branch ?? context.ramo);
  const city = cleanTemplateValue(context.city ?? context.cidade);
  const state = cleanTemplateValue(context.state ?? context.estado);
  const phone = cleanTemplateValue(context.phone ?? context.whatsapp);

  return new Map<string, string>([
    ['EMPRESA', company],
    ['NOME_EMPRESA', company],
    ['NOME_DA_EMPRESA', company],
    ['COMPANY', company],
    ['COMPANY_NAME', company],
    ['RAMO', branch],
    ['BRANCH', branch],
    ['CIDADE', city],
    ['CITY', city],
    ['ESTADO', state],
    ['STATE', state],
    ['TELEFONE', phone],
    ['WHATSAPP', phone],
    ['PHONE', phone],
    ['INSTAGRAM', cleanTemplateValue(context.instagram)],
    ['SITE', cleanTemplateValue(context.site)],
  ]);
}

function renderTemplateVariables(message: string, context: TemplateVariableContext) {
  const variables = templateVariables(context);
  const pattern = /\{\{\s*([^{}[\]]+?)\s*\}\}|\{\s*([^{}[\]]+?)\s*\}|\[\s*([^\[\]{}]+?)\s*\]|%\s*([A-Za-z0-9_ -]+?)\s*%/g;

  return String(message ?? '').replace(pattern, (match, doubleBrace, brace, bracket, percent) => {
    const rawKey = doubleBrace ?? brace ?? bracket ?? percent;
    const replacement = variables.get(normalizeTemplateKey(rawKey));
    return replacement || match;
  });
}

function renderLeadMessages<T extends TemplateVariableContext>(
  lead: T,
  messages: { message1?: string; message2?: string; message_1?: string; message_2?: string },
) {
  const message1 = renderTemplateVariables(messages.message1 ?? messages.message_1 ?? '', lead);
  const message2 = renderTemplateVariables(messages.message2 ?? messages.message_2 ?? '', lead);
  return { message1, message2, message_1: message1, message_2: message2 };
}

function envAny(...names: string[]) {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && value !== null && value !== '') return String(value);
  }
  return '';
}

function tableName() {
  return envAny('SUPABASE_TABLE_INSTAGRAM_QUEUE_ITEMS', 'VITE_SUPABASE_TABLE_INSTAGRAM_QUEUE_ITEMS') || 'instagram_queue_items';
}

function companionTable(envName: string, viteEnvName: string, fallback: string) {
  return envAny(envName, viteEnvName) || fallback;
}

function baseTableName() {
  return companionTable('SUPABASE_TABLE_BASE_PERMANENTE', 'VITE_SUPABASE_TABLE_BASE_PERMANENTE', 'base_permanente');
}

function sentContactsTableName() {
  return companionTable('SUPABASE_TABLE_SENT_CONTACTS', 'VITE_SUPABASE_TABLE_SENT_CONTACTS', 'sent_contacts');
}

function preSendTableName() {
  return companionTable('SUPABASE_TABLE_PRE_SEND_LEADS', 'VITE_SUPABASE_TABLE_PRE_SEND_LEADS', 'pre_send_leads');
}

function importTableName() {
  return companionTable('SUPABASE_TABLE_IMPORT_LEADS', 'VITE_SUPABASE_TABLE_IMPORT_LEADS', 'leads');
}

function eventsTableName() {
  return companionTable('SUPABASE_TABLE_EVENTS', 'VITE_SUPABASE_TABLE_EVENTS', 'lead_events');
}

/**
 * Esta rota usa apenas o REST/PostgREST do Supabase. O cliente JS, porem,
 * inicializa internamente o modulo Realtime mesmo quando nenhuma assinatura
 * de canal e criada. Em runtimes serverless sem WebSocket nativo isso derruba
 * a funcao antes da primeira consulta.
 *
 * Fornecemos um transporte que so seria usado se alguem tentasse abrir um
 * canal Realtime nesta rota. Como a extensao nao usa Realtime, as operacoes
 * HTTP da fila continuam normais e independentes de WebSocket.
 */
class ServerlessOnlyRealtimeTransport {
  constructor() {
    throw new Error('Realtime nao e utilizado pela rota serverless da extensao Instagram.');
  }
}

function supabase() {
  const url = envAny('SUPABASE_URL', 'VITE_SUPABASE_URL');
  const key = envAny('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY', 'VITE_SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_ANON_KEY');
  if (!url || !key) throw new Error('Supabase nao configurado no backend para a extensao Instagram.');

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: {
      transport: ServerlessOnlyRealtimeTransport as never,
    },
  });
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
  if (!expected) throw new Error('INSTAGRAM_EXTENSION_SECRET deve ser configurado no backend antes de liberar a extensao Instagram.');
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

  const item = {
    ...data,
    id: text(row.id ?? data.id),
    item_id: text(row.id ?? data.id),
    queue_item_id: text(row.id ?? data.id),
    lead_id: text(row.lead_id ?? data.lead_id),
    source_pre_send_id: text(row.source_pre_send_id ?? data.sourcePreSendId),
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
    phone: text(row.phone ?? data.phone),
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
  const messages = renderLeadMessages(item, item);
  return { ...item, ...messages };
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

function safePhone(value: unknown) {
  let digits = text(value).replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('55')) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

function uniqueId(prefix: string, source: string) {
  const safe = source.replace(/[^a-zA-Z0-9_-]/g, '').slice(-80) || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${safe}`;
}

function normalizeInstagram(value: unknown) {
  return cleanInstagramUsername(value);
}

async function syncSentInstagramLead(client: ReturnType<typeof supabase>, item: ReturnType<typeof itemFromRow>, timestamp: string) {
  const userId = item.user_id || null;
  const sourceLeadId = item.lead_id || item.source_pre_send_id || item.id;
  const normalizedPhone = safePhone(item.phone);
  const normalizedInstagram = normalizeInstagram(item.instagram_url || item.instagram_username);
  const baseId = uniqueId('base-instagram', item.id);
  const sentContactId = uniqueId('sent-instagram', item.id);
  const history = [{
    id: uniqueId('history', `${item.id}-${timestamp}`),
    date: timestamp.slice(0, 10),
    title: 'Lead enviado pelo Instagram',
    description: 'Confirmado pela extensao/worker Instagram.',
  }];

  const baseData = {
    id: baseId,
    sourceLeadId,
    company: item.company_name,
    branch: item.parent_category || item.branch_name,
    branch_id: '',
    branch_slug: '',
    state: '',
    city: '',
    phone: item.phone,
    normalizedPhone,
    site: '',
    normalizedSite: '',
    instagram: item.instagram_url,
    normalizedInstagram,
    mapsUrl: '',
    origin: 'Instagram',
    destination: 'Instagram',
    status: 'sent',
    sentAt: timestamp,
    template: [item.message_1, item.message_2].filter(Boolean).join('\n\n'),
    chipOrProfile: item.profile_username,
    notes: item.instagram_url,
    history,
  };

  const { error: baseError } = await client.from(baseTableName()).upsert({
    id: baseId,
    user_id: userId,
    company_name: item.company_name || null,
    phone: item.phone || null,
    normalized_phone: normalizedPhone || null,
    instagram_url: item.instagram_url || null,
    instagram_username: normalizedInstagram || null,
    source: 'Instagram',
    branch_name: item.branch_name || item.parent_category || null,
    destination: 'Instagram',
    status: 'sent',
    sent_at: timestamp,
    last_contact_at: timestamp,
    last_channel: 'Instagram',
    source_instance: item.profile_username || null,
    instagram_sent_at: timestamp,
    active: true,
    kind: 'base',
    channel: 'instagram',
    data: baseData,
    updated_at: timestamp,
    created_at: timestamp,
  }, { onConflict: 'id' });
  if (baseError) throw new Error(`Falha ao persistir Base Permanente: ${baseError.message}`);

  const sentData = {
    id: sentContactId,
    sourceLeadId,
    company: item.company_name,
    phone: item.phone,
    normalizedPhone,
    site: '',
    normalizedSite: '',
    instagram: item.instagram_url,
    normalizedInstagram,
    mapsUrl: '',
    sentAt: timestamp,
    origin: 'Instagram',
    queueItemId: item.id,
  };
  const { error: contactError } = await client.from(sentContactsTableName()).upsert({
    id: sentContactId,
    user_id: userId,
    lead_id: sourceLeadId,
    company_name: item.company_name || null,
    phone: item.phone || null,
    normalized_phone: normalizedPhone || null,
    instagram_username: normalizedInstagram || null,
    sent_at: timestamp,
    dispatched_at: timestamp,
    source: 'Instagram',
    active: true,
    data: sentData,
    updated_at: timestamp,
    created_at: timestamp,
  }, { onConflict: 'id' });
  if (contactError) throw new Error(`Falha ao registrar contato enviado: ${contactError.message}`);

  if (item.source_pre_send_id) {
    const { data: preSendRow, error: preSendReadError } = await client.from(preSendTableName()).select('*').eq('id', item.source_pre_send_id).maybeSingle();
    if (preSendReadError) throw new Error(`Falha ao localizar pre-envio: ${preSendReadError.message}`);
    if (preSendRow) {
      const preData = dataRecord(preSendRow as QueueRow);
      const sourceImportId = text(preData.sourceImportId ?? (preSendRow as QueueRow).source_import_id);
      const { error: preSendUpdateError } = await client.from(preSendTableName()).update({
        status: 'sent',
        data: { ...preData, status: 'sent', sentAt: timestamp },
        updated_at: timestamp,
      }).eq('id', item.source_pre_send_id);
      if (preSendUpdateError) throw new Error(`Falha ao concluir pre-envio: ${preSendUpdateError.message}`);

      if (sourceImportId) {
        const { data: importRow, error: importReadError } = await client.from(importTableName()).select('*').eq('id', sourceImportId).maybeSingle();
        if (importReadError) throw new Error(`Falha ao localizar importacao: ${importReadError.message}`);
        if (importRow) {
          const importData = dataRecord(importRow as QueueRow);
          const { error: importUpdateError } = await client.from(importTableName()).update({
            status: 'sent',
            current_status: 'sent',
            pipeline_status: 'sent',
            data: { ...importData, status: 'sent', motivo: 'Envio confirmado pelo worker/extensao Instagram.', sent_at: timestamp },
            updated_at: timestamp,
          }).eq('id', sourceImportId);
          if (importUpdateError) throw new Error(`Falha ao concluir importacao: ${importUpdateError.message}`);
        }
      }
    }
  }

  const { error: eventError } = await client.from(eventsTableName()).insert({
    id: uniqueId('event-instagram', `${item.id}-${timestamp}`),
    user_id: userId,
    source: 'instagram-extension',
    action: 'sent_confirmed',
    channel: 'instagram',
    status: 'sent',
    lead_id: sourceLeadId,
    queue_item_id: item.id,
    company_name: item.company_name || null,
    instagram_url: item.instagram_url || null,
    event_type: 'sent_confirmed',
    sent_at: timestamp,
    data: { queue_item_id: item.id, profile: item.profile_username, source: 'extension' },
    metadata: { queue_item_id: item.id, profile: item.profile_username, source: 'extension' },
    created_at: timestamp,
    updated_at: timestamp,
  });
  if (eventError) throw new Error(`Falha ao registrar auditoria: ${eventError.message}`);
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

  if (status === 'sent' && current.status !== 'sent') {
    if (!['queued', 'paused', 'following', 'dm_opened'].includes(current.status)) {
      throw new Error(`Transicao Instagram invalida: ${current.status} -> sent.`);
    }
    // Base, contatos e etapas anteriores sao gravados antes da fila ficar visivel como enviada.
    await syncSentInstagramLead(client, current, timestamp);
  }
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
