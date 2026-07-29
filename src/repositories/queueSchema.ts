import { getSupabaseClient } from '../lib/supabase';
import { channelId, currentUserIdNumber, operationalStatusFromName, queueStatusId, queueStatusNameMap } from './schemaCatalog';
import { nowIso } from './supabase.helpers';

type Row = Record<string, unknown>;
export type QueueChannel = 'WhatsApp' | 'Instagram';

export type CanonicalQueueRow = {
  item: Row;
  queue: Row;
  lead: Row;
  chip?: Row;
  instance?: Row;
  social?: Row;
  template?: Row;
  branch?: Row;
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
  const branches = await rowsByIds('branches', 'branches_id', ids(leads, 'branches_id'));
  const queueMap = new Map(queues.map((row) => [String(row.queues_id), row]));
  const leadMap = new Map(leads.map((row) => [String(row.leads_id), row]));
  const chipMap = new Map(chips.map((row) => [String(row.chips_id), row]));
  const instanceMap = new Map(instances.map((row) => [String(row.instances_id), row]));
  const socialMap = new Map(socials.map((row) => [String(row.socials_id), row]));
  const templateMap = new Map(templates.map((row) => [String(row.templates_id), row]));
  const branchMap = new Map(branches.map((row) => [String(row.branches_id), row]));

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
      statusName: statuses.get(String(item.status_id)) ?? String(item.status_id ?? ''),
    };
  });
}

export async function ensureQueue(channel: QueueChannel, resourceId: number, scheduledDate: string) {
  const client = getSupabaseClient();
  const userId = await currentUserIdNumber();
  const channelValue = Number(await channelId(channel));
  const queueName = `${channel.toLowerCase()}:${resourceId}:${scheduledDate}`;
  const existing = await client.from('queues').select('queues_id').eq('users_id', userId).eq('queues_name', queueName).maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data) return Number((existing.data as Row).queues_id);
  const inserted = await client.from('queues').insert({
    users_id: userId,
    channels_id: channelValue,
    status_id: await queueStatusId('queued'),
    queues_name: queueName,
    queues_scheduled_at: `${scheduledDate}T12:00:00.000Z`,
  }).select('queues_id').single();
  if (inserted.error) throw new Error(inserted.error.message);
  return Number((inserted.data as Row).queues_id);
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
