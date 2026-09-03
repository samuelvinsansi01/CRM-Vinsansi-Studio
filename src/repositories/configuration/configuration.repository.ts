import { getSupabaseClient } from '../../lib/supabase';
import { getCurrentUserId, nowIso } from '../supabase.helpers';

export type StatusOption = { id: string; name: string };
export type ChannelOption = { id: string; name: string };

const DELIVERY_CHANNEL_NAMES = new Set(['whatsapp', 'instagram']);

function normalizeChannelChoice(value: unknown) {
  return text(value).trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

export function isDeliveryChannelOption(option: ChannelOption) {
  return DELIVERY_CHANNEL_NAMES.has(normalizeChannelChoice(option.name));
}

async function assertDeliveryChannelId(channelId: number) {
  if (!Number.isSafeInteger(channelId) || channelId <= 0) throw new Error('Canal de envio inválido.');
  const { data, error } = await getSupabaseClient()
    .from('channels')
    .select('channels_name')
    .eq('channels_id', channelId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || !DELIVERY_CHANNEL_NAMES.has(normalizeChannelChoice((data as Row).channels_name))) {
    throw new Error('Selecione um canal de envio válido: WhatsApp ou Instagram. "Sem destino" é apenas um valor técnico interno.');
  }
}

type LevelLimitValidation = {
  allowed?: boolean;
  message?: string;
};

async function assertLevelDailyLimitChangeAllowed(levelId: number, newDailyLimit: number) {
  const { data, error } = await getSupabaseClient().rpc('validate_level_daily_limit_change_r59', {
    p_level_id: levelId,
    p_new_daily_limit: newDailyLimit,
  });
  if (error) throw new Error(error.message);
  const validation = (data && typeof data === 'object' && !Array.isArray(data) ? data : {}) as LevelLimitValidation;
  if (validation.allowed === false) {
    throw new Error(validation.message || 'O novo limite diário é incompatível com a ocupação atual dos recursos deste nível.');
  }
}

export type ContactSourceRecord = {
  id: string;
  kind: 'contact_sources';
  name: string;
  key: string;
  requiresReview: boolean;
  defaultChannelId: string;
  statusId: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type LevelRecord = {
  id: string;
  kind: 'levels';
  name: string;
  channelId: string;
  channelName: string;
  dailyLimit: number;
  queues: number | null;
  statusId: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type InstanceOperationalState = 'online' | 'reconnecting' | 'session_saved' | 'disconnected' | 'unavailable' | 'unknown';

export type InstanceRecord = {
  id: string;
  kind: 'instances';
  name: string;
  url: string;
  statusId: string;
  active: boolean;
  administrativelyActive: boolean;
  operationalState: InstanceOperationalState;
  sessionSaved: boolean;
  socketConnected: boolean;
  jid: string;
  runtimeCheckedAt: string;
  runtimeError: string;
  createdAt: string;
  updatedAt: string;
};

export type TemplateChannelRecord = {
  id: string;
  kind: 'template_channels';
  name: string;
  blockedChannelIds: string[];
  blockedChannelNames: string[];
  statusId: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type TemplateTypeRecord = {
  id: string;
  kind: 'template_types';
  name: string;
  statusId: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CatalogRecord =
  | ContactSourceRecord
  | LevelRecord
  | InstanceRecord
  | TemplateChannelRecord
  | TemplateTypeRecord;

export type CatalogKind = CatalogRecord['kind'];

type Row = Record<string, unknown>;

const text = (value: unknown, fallback = '') => value == null ? fallback : String(value);
const number = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const bool = (value: unknown, fallback = false) => typeof value === 'boolean' ? value : fallback;
const stringArray = (value: unknown) => Array.isArray(value) ? value.map(String) : [];
const statusIsActive = (statusId: unknown) => Number(statusId) === 1;

async function userIdNumber() {
  const id = Number(await getCurrentUserId());
  if (!Number.isSafeInteger(id)) throw new Error('Usuário autenticado inválido.');
  return id;
}

export async function listStatusOptions(): Promise<StatusOption[]> {
  const { data, error } = await getSupabaseClient()
    .from('status')
    .select('status_id,status_name')
    .in('status_id', [1, 2])
    .order('status_id');
  if (error) throw new Error(error.message);
  return ((data ?? []) as Row[]).map((row) => ({ id: text(row.status_id), name: text(row.status_name) }));
}

export async function listChannelOptions(): Promise<ChannelOption[]> {
  const { data, error } = await getSupabaseClient()
    .from('channels')
    .select('channels_id,channels_name')
    .order('channels_id');
  if (error) throw new Error(error.message);
  return ((data ?? []) as Row[]).map((row) => ({ id: text(row.channels_id), name: text(row.channels_name) }));
}

export async function listContactSourceOptions(): Promise<Array<{ id: string; name: string; key: string }>> {
  const userId = await userIdNumber();
  const { data, error } = await getSupabaseClient()
    .from('contact_sources')
    .select('contact_sources_id,contact_sources_name,contact_sources_key')
    .eq('users_id', userId)
    .order('contact_sources_name');
  if (error) throw new Error(error.message);
  return ((data ?? []) as Row[]).map((row) => ({
    id: text(row.contact_sources_id),
    name: text(row.contact_sources_name),
    key: text(row.contact_sources_key),
  }));
}

export async function listCatalogRecords(kind: CatalogKind): Promise<CatalogRecord[]> {
  const client = getSupabaseClient();
  const userId = await userIdNumber();

  if (kind === 'contact_sources') {
    const { data, error } = await client.from('contact_sources')
      .select('contact_sources_id,status_id,contact_sources_name,contact_sources_key,contact_sources_requires_review,contact_sources_default_channel_id,contact_sources_created_at,contact_sources_updated_at')
      .eq('users_id', userId)
      .order('contact_sources_name');
    if (error) throw new Error(error.message);
    return ((data ?? []) as Row[]).map((row): ContactSourceRecord => ({
      id: text(row.contact_sources_id), kind, name: text(row.contact_sources_name), key: text(row.contact_sources_key),
      requiresReview: bool(row.contact_sources_requires_review, true), defaultChannelId: text(row.contact_sources_default_channel_id),
      statusId: text(row.status_id), active: statusIsActive(row.status_id), createdAt: text(row.contact_sources_created_at), updatedAt: text(row.contact_sources_updated_at),
    }));
  }

  if (kind === 'levels') {
    const channels = new Map((await listChannelOptions()).map((item) => [item.id, item.name]));
    const { data, error } = await client.from('levels')
      .select('levels_id,channels_id,status_id,levels_name,levels_daily_limit,levels_queues,levels_created_at,levels_updated_at')
      .eq('users_id', userId)
      .order('levels_name');
    if (error) throw new Error(error.message);
    return ((data ?? []) as Row[]).map((row): LevelRecord => ({
      id: text(row.levels_id), kind, name: text(row.levels_name), channelId: text(row.channels_id),
      channelName: channels.get(text(row.channels_id)) ?? '—', dailyLimit: number(row.levels_daily_limit, 1),
      queues: row.levels_queues == null ? null : number(row.levels_queues), statusId: text(row.status_id),
      active: statusIsActive(row.status_id), createdAt: text(row.levels_created_at), updatedAt: text(row.levels_updated_at),
    }));
  }

  if (kind === 'instances') {
    const [instanceResult, runtimeResult] = await Promise.all([
      client.from('instances')
        .select('instances_id,status_id,instances_name,instances_url,instances_created_at,instances_updated_at')
        .eq('users_id', userId)
        .order('instances_name'),
      client.from('instance_runtime_states')
        .select('instances_id,operational_state,session_saved,socket_connected,jid,last_error,checked_at')
        .eq('users_id', userId),
    ]);
    if (instanceResult.error) throw new Error(instanceResult.error.message);
    if (runtimeResult.error) throw new Error(runtimeResult.error.message);
    const runtimeByInstance = new Map(((runtimeResult.data ?? []) as Row[]).map((runtime) => [text(runtime.instances_id), runtime]));
    return ((instanceResult.data ?? []) as Row[]).map((row): InstanceRecord => {
      const runtime = runtimeByInstance.get(text(row.instances_id)) ?? {};
      const operationalState = text(runtime.operational_state, 'unknown') as InstanceOperationalState;
      const socketConnected = bool(runtime.socket_connected);
      return {
        id: text(row.instances_id), kind, name: text(row.instances_name), url: text(row.instances_url),
        statusId: text(row.status_id), active: socketConnected,
        administrativelyActive: statusIsActive(row.status_id), operationalState,
        sessionSaved: bool(runtime.session_saved), socketConnected,
        jid: text(runtime.jid), runtimeCheckedAt: text(runtime.checked_at), runtimeError: text(runtime.last_error),
        createdAt: text(row.instances_created_at), updatedAt: text(row.instances_updated_at),
      };
    });
  }

  if (kind === 'template_channels') {
    const channels = new Map((await listChannelOptions()).map((item) => [item.id, item.name]));
    const { data, error } = await client.from('template_channels')
      .select('template_channels_id,template_channels_name,template_channels_blocked_channels,status_id,template_channels_created_at,template_channels_updated_at')
      .eq('users_id', userId)
      .order('template_channels_name');
    if (error) throw new Error(error.message);
    return ((data ?? []) as Row[]).map((row): TemplateChannelRecord => {
      const blockedChannelIds = stringArray(row.template_channels_blocked_channels);
      return {
        id: text(row.template_channels_id), kind, name: text(row.template_channels_name), blockedChannelIds,
        blockedChannelNames: blockedChannelIds.map((id) => channels.get(id) ?? id), statusId: text(row.status_id),
        active: statusIsActive(row.status_id), createdAt: text(row.template_channels_created_at), updatedAt: text(row.template_channels_updated_at),
      };
    });
  }

  if (kind === 'template_types') {
    const { data, error } = await client.from('template_types')
      .select('template_types_id,template_types_name,status_id,template_types_created_at,template_types_updated_at')
      .eq('users_id', userId)
      .order('template_types_name');
    if (error) throw new Error(error.message);
    return ((data ?? []) as Row[]).map((row): TemplateTypeRecord => ({
      id: text(row.template_types_id), kind, name: text(row.template_types_name), statusId: text(row.status_id),
      active: statusIsActive(row.status_id), createdAt: text(row.template_types_created_at), updatedAt: text(row.template_types_updated_at),
    }));
  }

  throw new Error(`Catálogo não suportado: ${String(kind)}`);
}

function normalizedKey(value: unknown) {
  return text(value).trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function activeStatusId(input: Record<string, unknown>) {
  return text(input.statusId || (input.active === false ? '2' : '1'), '1') === '2' ? 2 : 1;
}

export async function createCatalogRecord(kind: CatalogKind, input: Record<string, unknown>) {
  const client = getSupabaseClient();
  const usersId = await userIdNumber();
  const statusId = activeStatusId(input);

  if (kind === 'contact_sources') {
    const name = text(input.name).trim();
    const key = normalizedKey(input.key || name);
    if (!name || !key) throw new Error('Nome e chave da fonte são obrigatórios.');
    const defaultChannelId = text(input.defaultChannelId) ? Number(input.defaultChannelId) : null;
    if (defaultChannelId != null) await assertDeliveryChannelId(defaultChannelId);
    const { error } = await client.from('contact_sources').insert({
      users_id: usersId, status_id: statusId, contact_sources_name: name, contact_sources_key: key,
      contact_sources_requires_review: bool(input.requiresReview, true),
      contact_sources_default_channel_id: defaultChannelId,
    });
    if (error) throw new Error(error.message);
    return;
  }

  if (kind === 'levels') {
    const name = text(input.name).trim();
    const channelId = Number(input.channelId);
    const dailyLimit = Math.max(1, number(input.dailyLimit, 1));
    if (!name || !Number.isSafeInteger(channelId)) throw new Error('Nome e canal do nível são obrigatórios.');
    await assertDeliveryChannelId(channelId);
    const { error } = await client.from('levels').insert({
      users_id: usersId, channels_id: channelId, status_id: statusId, levels_name: name,
      levels_daily_limit: dailyLimit, levels_queues: text(input.queues) ? Math.max(1, number(input.queues, 1)) : null,
    });
    if (error) throw new Error(error.message);
    return;
  }

  if (kind === 'instances') {
    const name = text(input.name).trim();
    const url = text(input.url).trim();
    const apiKey = text(input.apiKey).trim();
    if (!name) throw new Error('Nome da instância é obrigatório.');
    if (!url) throw new Error('URL da instância é obrigatória.');
    if (!apiKey) throw new Error('API key é obrigatória para uma nova instância.');
    const { error } = await client.rpc('save_instance_secure', {
      p_instances_id: null,
      p_name: name,
      p_url: url,
      p_api_key: apiKey,
    });
    if (error) throw new Error(error.message);
    return;
  }

  if (kind === 'template_channels') {
    const name = text(input.name).trim();
    if (!name) throw new Error('Nome do canal de template é obrigatório.');
    const { error } = await client.from('template_channels').insert({
      users_id: usersId, status_id: statusId, template_channels_name: name,
      template_channels_blocked_channels: stringArray(input.blockedChannelIds).map(Number),
    });
    if (error) throw new Error(error.message);
    return;
  }

  if (kind === 'template_types') {
    const name = text(input.name).trim();
    if (!name) throw new Error('Nome do tipo de template é obrigatório.');
    const { error } = await client.from('template_types').insert({ users_id: usersId, status_id: statusId, template_types_name: name });
    if (error) throw new Error(error.message);
    return;
  }

  throw new Error(`Catálogo não suportado: ${String(kind)}`);
}

export async function updateCatalogRecord(kind: CatalogKind, id: string, input: Record<string, unknown>) {
  const client = getSupabaseClient();
  const usersId = await userIdNumber();
  const numericId = Number(id);
  const statusId = activeStatusId(input);
  if (!Number.isSafeInteger(numericId)) throw new Error('Identificador inválido.');

  if (kind === 'contact_sources') {
    const name = text(input.name).trim();
    const key = normalizedKey(input.key || name);
    const defaultChannelId = text(input.defaultChannelId) ? Number(input.defaultChannelId) : null;
    if (defaultChannelId != null) await assertDeliveryChannelId(defaultChannelId);
    const { error } = await client.from('contact_sources').update({
      status_id: statusId, contact_sources_name: name, contact_sources_key: key,
      contact_sources_requires_review: bool(input.requiresReview, true),
      contact_sources_default_channel_id: defaultChannelId,
      contact_sources_updated_at: nowIso(),
    }).eq('contact_sources_id', numericId).eq('users_id', usersId);
    if (error) throw new Error(error.message);
    return;
  }

  if (kind === 'levels') {
    const newDailyLimit = Math.max(1, number(input.dailyLimit, 1));
    const channelId = Number(input.channelId);
    await assertDeliveryChannelId(channelId);
    await assertLevelDailyLimitChangeAllowed(numericId, newDailyLimit);
    const { error } = await client.from('levels').update({
      status_id: statusId, levels_name: text(input.name).trim(), channels_id: channelId,
      levels_daily_limit: newDailyLimit,
      levels_queues: text(input.queues) ? Math.max(1, number(input.queues, 1)) : null,
      levels_updated_at: nowIso(),
    }).eq('levels_id', numericId).eq('users_id', usersId);
    if (error) throw new Error(error.message);
    return;
  }

  if (kind === 'instances') {
    const name = text(input.name).trim();
    const url = text(input.url).trim();
    const apiKey = text(input.apiKey).trim();
    if (!name) throw new Error('Nome da instância é obrigatório.');
    if (!url) throw new Error('URL da instância é obrigatória.');
    const { error } = await client.rpc('save_instance_secure', {
      p_instances_id: numericId,
      p_name: name,
      p_url: url,
      p_api_key: apiKey || null,
    });
    if (error) throw new Error(error.message);
    return;
  }

  if (kind === 'template_channels') {
    const { error } = await client.from('template_channels').update({
      status_id: statusId, template_channels_name: text(input.name).trim(),
      template_channels_blocked_channels: stringArray(input.blockedChannelIds).map(Number),
      template_channels_updated_at: nowIso(),
    }).eq('template_channels_id', numericId).eq('users_id', usersId);
    if (error) throw new Error(error.message);
    return;
  }

  if (kind === 'template_types') {
    const { error } = await client.from('template_types').update({
      status_id: statusId, template_types_name: text(input.name).trim(), template_types_updated_at: nowIso(),
    }).eq('template_types_id', numericId).eq('users_id', usersId);
    if (error) throw new Error(error.message);
    return;
  }

  throw new Error(`Catálogo não suportado: ${String(kind)}`);
}

const idColumn: Record<CatalogKind, string> = {
  contact_sources: 'contact_sources_id', levels: 'levels_id', instances: 'instances_id',
  template_channels: 'template_channels_id', template_types: 'template_types_id',
};

export async function deleteCatalogRecord(kind: CatalogKind, id: string) {
  const usersId = await userIdNumber();
  const numericId = Number(id);
  if (!Number.isSafeInteger(numericId)) throw new Error('Identificador inválido.');
  if (kind === 'instances') {
    const { error } = await getSupabaseClient().rpc('delete_instance_secure', { p_instances_id: numericId });
    if (error) throw new Error(error.message);
    return;
  }
  const { error } = await getSupabaseClient().from(kind).delete().eq(idColumn[kind], numericId).eq('users_id', usersId);
  if (error) throw new Error(error.message);
}
