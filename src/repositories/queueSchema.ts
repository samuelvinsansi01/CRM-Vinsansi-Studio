import { getSupabaseClient } from '../lib/supabase';
import { channelId, currentUserIdNumber, operationalStatusFromName, queueStatusId, queueStatusNameMap } from './schemaCatalog';
import { nowIso } from './supabase.helpers';

type Row = Record<string, unknown>;
export type QueueChannel = 'WhatsApp' | 'Instagram';


export type QueuePayloadSnapshot = {
  schema_version?: number;
  frozen_at?: string;
  channel?: string;
  recipient?: Record<string, unknown>;
  lead?: Record<string, unknown>;
  variables?: Record<string, unknown>;
  template?: Record<string, unknown>;
  messages?: Record<string, unknown>;
  media?: Record<string, unknown>;
};

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function queuePayloadSnapshot(value: unknown): QueuePayloadSnapshot | null {
  const payload = objectValue(value);
  if (!Object.keys(payload).length) return null;
  return payload as QueuePayloadSnapshot;
}

export function queueSnapshotPart(snapshot: QueuePayloadSnapshot | null, section: keyof QueuePayloadSnapshot) {
  return objectValue(snapshot?.[section]);
}

export function queueSnapshotMessage(snapshot: QueuePayloadSnapshot | null, number: 1 | 2 | 3 | 4) {
  const messages = queueSnapshotPart(snapshot, 'messages');
  return String(messages[`message_${number}`] ?? '').trim();
}

export type AtomicQueuePreparationInput = {
  leadId: string;
  templateId: string;
};

export type AtomicQueuePreparationRow = {
  leadId: string;
  queueItemId: string;
  outcome: 'queued' | 'reconciled' | 'conflict' | 'blocked' | 'failed';
  reason: string;
  queueId: string;
  position: number | null;
};

export async function loadCurrentWhatsAppValidationProofs(leadIds: string[]): Promise<Set<string>> {
  const numeric = Array.from(new Set(leadIds.map(Number).filter((value) => Number.isSafeInteger(value) && value > 0)));
  if (!numeric.length) return new Set();
  const { data, error } = await getSupabaseClient().rpc('current_user_whatsapp_validation_proofs', {
    p_lead_ids: numeric,
  });
  if (error) throw new Error(`Não foi possível conferir as provas de validação WhatsApp: ${error.message}`);
  return new Set(((data ?? []) as Row[])
    .filter((row) => row.has_valid_proof === true)
    .map((row) => String(row.lead_id)));
}

function positiveInteger(value: unknown, label: string) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${label} inválido.`);
  return parsed;
}

export async function prepareQueueItems(
  channel: QueueChannel,
  resourceId: string | number,
  scheduledDate: string,
  items: AtomicQueuePreparationInput[],
): Promise<AtomicQueuePreparationRow[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) throw new Error('Data de agendamento inválida.');
  if (!items.length) return [];

  const normalizedItems = items.map((item) => ({
    lead_id: positiveInteger(item.leadId, 'Identificador do lead'),
    template_id: positiveInteger(item.templateId, 'Identificador do template'),
  }));

  const { data, error } = await getSupabaseClient().rpc('prepare_queue_items', {
    p_channel: channel,
    p_resource_id: positiveInteger(resourceId, channel === 'WhatsApp' ? 'Chip' : 'Perfil Instagram'),
    p_scheduled_date: scheduledDate,
    p_items: normalizedItems,
  });

  if (error) throw new Error(`Não foi possível preparar a fila de forma transacional: ${error.message}`);

  return ((data ?? []) as Row[]).map((row) => ({
    leadId: String(row.lead_id ?? ''),
    queueItemId: String(row.queue_item_id ?? ''),
    outcome: String(row.outcome ?? 'failed') as AtomicQueuePreparationRow['outcome'],
    reason: String(row.reason ?? ''),
    queueId: String(row.queue_id ?? ''),
    position: row.queue_position == null ? null : Number(row.queue_position),
  }));
}

export type CanonicalQueueRow = {
  item: Row;
  queue: Row;
  lead: Row;
  chip?: Row;
  instance?: Row;
  social?: Row;
  template?: Row;
  branch?: Row;
  city?: Row;
  state?: Row;
  statusName: string;
};

function ids(rows: Row[], key: string) {
  return Array.from(new Set(rows.map((row) => Number(row[key])).filter((value) => Number.isSafeInteger(value) && value > 0)));
}

async function rowsByIds(table: string, key: string, values: number[]) {
  if (!values.length) return [] as Row[];
  const { data, error } = await getSupabaseClient().from(table).select('*').in(key, values);
  if (error) throw new Error(`Nao foi possivel carregar ${table}: ${error.message}`);
  return (data ?? []) as Row[];
}

export async function loadCanonicalQueue(channel: QueueChannel): Promise<CanonicalQueueRow[]> {
  const client = getSupabaseClient();
  const userId = await currentUserIdNumber();
  const channelValue = Number(await channelId(channel));
  const queueResponse = await client.from('queues').select('*').eq('users_id', userId).eq('channels_id', channelValue);
  if (queueResponse.error) throw new Error(`Nao foi possivel carregar as filas de ${channel}: ${queueResponse.error.message}`);
  const queues = (queueResponse.data ?? []) as Row[];
  const queueIds = ids(queues, 'queues_id');
  if (!queueIds.length) return [];
  const itemResponse = await client.from('queue_items').select('*').eq('users_id', userId).in('queues_id', queueIds);
  if (itemResponse.error) throw new Error(`Nao foi possivel carregar os itens de ${channel}: ${itemResponse.error.message}`);
  const items = (itemResponse.data ?? []) as Row[];
  const [leads, chips, socials, templates, statuses] = await Promise.all([
    rowsByIds('leads', 'leads_id', ids(items, 'leads_id')),
    rowsByIds('chips', 'chips_id', ids(items, 'chips_id')),
    rowsByIds('socials', 'socials_id', ids(items, 'socials_id')),
    rowsByIds('templates', 'templates_id', ids(items, 'templates_id')),
    queueStatusNameMap(),
  ]);
  const instances = await rowsByIds('instances', 'instances_id', ids(chips, 'instances_id'));
  const [branches, cities, states] = await Promise.all([
    rowsByIds('branches', 'branches_id', ids(leads, 'branches_id')),
    rowsByIds('cities', 'cities_id', ids(leads, 'cities_id')),
    rowsByIds('states', 'states_id', ids(leads, 'states_id')),
  ]);
  const queueMap = new Map(queues.map((row) => [String(row.queues_id), row]));
  const leadMap = new Map(leads.map((row) => [String(row.leads_id), row]));
  const chipMap = new Map(chips.map((row) => [String(row.chips_id), row]));
  const instanceMap = new Map(instances.map((row) => [String(row.instances_id), row]));
  const socialMap = new Map(socials.map((row) => [String(row.socials_id), row]));
  const templateMap = new Map(templates.map((row) => [String(row.templates_id), row]));
  const branchMap = new Map(branches.map((row) => [String(row.branches_id), row]));
  const cityMap = new Map(cities.map((row) => [String(row.cities_id), row]));
  const stateMap = new Map(states.map((row) => [String(row.states_id), row]));

  return items.map((item) => {
    const lead = leadMap.get(String(item.leads_id)) ?? {};
    const chip = chipMap.get(String(item.chips_id));
    return {
      item,
      queue: queueMap.get(String(item.queues_id)) ?? {},
      lead,
      chip,
      instance: chip ? instanceMap.get(String(chip.instances_id)) : undefined,
      social: socialMap.get(String(item.socials_id)),
      template: templateMap.get(String(item.templates_id)),
      branch: branchMap.get(String(lead.branches_id)),
      city: cityMap.get(String(lead.cities_id)),
      state: stateMap.get(String(lead.states_id)),
      statusName: statuses.get(String(item.status_id)) ?? String(item.status_id ?? ''),
    };
  });
}

export function canonicalQueueStatus(row: CanonicalQueueRow) {
  return operationalStatusFromName(row.statusName);
}

export function dateOnly(value: unknown) {
  const text = String(value ?? '');
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : new Date().toISOString().slice(0, 10);
}

export async function updateQueueItemStatus(ids: string[], status: string) {
  const numeric = ids.map(Number).filter(Number.isSafeInteger);
  if (!numeric.length) return;
  const userId = await currentUserIdNumber();
  const patch: Row = { status_id: await queueStatusId(status), queue_items_updated_at: nowIso() };
  if (status === 'sending' || status === 'following' || status === 'dm_opened') patch.queue_items_started_at = nowIso();
  if (status === 'sent' || status === 'invalid' || status === 'error') patch.queue_items_finished_at = nowIso();
  const { error } = await getSupabaseClient().from('queue_items').update(patch).eq('users_id', userId).in('queue_items_id', numeric);
  if (error) throw new Error(error.message);
}
