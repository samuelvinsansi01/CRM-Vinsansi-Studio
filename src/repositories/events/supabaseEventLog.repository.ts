import { getSupabaseClient, getSupabaseConfig } from '../../lib/supabase';
import { createUuid, getCurrentUserId, nowIso } from '../supabase.helpers';
import type { EventLogInput, EventLogRecord, EventLogRepository } from './eventLog.repository';

function table() {
  return getSupabaseConfig().tables.events;
}

function rowToEvent(row: Record<string, unknown>): EventLogRecord {
  const data = (row.data && typeof row.data === 'object' ? row.data : row.metadata && typeof row.metadata === 'object' ? row.metadata : {}) as Partial<EventLogRecord>;
  return {
    id: String(row.id),
    source: String(row.source ?? data.source ?? 'react'),
    action: String(row.action ?? row.event_type ?? data.action ?? ''),
    channel: (row.channel ?? data.channel) as EventLogRecord['channel'],
    leadId: String(row.lead_id ?? data.leadId ?? ''),
    queueItemId: String(row.queue_item_id ?? data.queueItemId ?? ''),
    status: String(row.status ?? data.status ?? ''),
    message: String(row.message_template ?? data.message ?? ''),
    metadata: (row.metadata ?? data.metadata ?? {}) as Record<string, unknown>,
    created_at: String(row.created_at ?? data.created_at ?? nowIso()),
    updated_at: String(row.updated_at ?? data.updated_at ?? row.created_at ?? nowIso()),
  };
}

function uuidOrNull(value: unknown) {
  const text = String(value ?? '');
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(text) ? text : null;
}

export const supabaseEventLogRepository: EventLogRepository = {
  async append(input: EventLogInput) {
    const userId = await getCurrentUserId();
    const timestamp = nowIso();
    const record: EventLogRecord = {
      id: createUuid(),
      created_at: timestamp,
      updated_at: timestamp,
      ...input,
    };
    const { error } = await getSupabaseClient().from(table()).insert({
      id: record.id,
      user_id: userId,
      lead_id: record.leadId || null,
      company_name: String(record.metadata?.company_name ?? ''),
      normalized_phone: String(record.metadata?.normalized_phone ?? ''),
      website: String(record.metadata?.website ?? ''),
      instagram_url: String(record.metadata?.instagram_url ?? ''),
      maps_url: String(record.metadata?.maps_url ?? ''),
      channel: record.channel ?? 'whatsapp',
      source: record.source,
      action: record.action,
      event_type: record.action,
      status: record.status ?? 'sent',
      message_template: record.message ?? '',
      sent_at: timestamp,
      created_at: timestamp,
      updated_at: timestamp,
      metadata: { ...record.metadata, message: record.message, queueItemId: record.queueItemId },
      data: record,
      active: true,
      kind: 'event',
      queue_item_id: record.queueItemId,
    });
    if (error) throw new Error(error.message);
    return record;
  },

  async appendDispatchMessageLog(input) {
    const timestamp = nowIso();
    const { error } = await getSupabaseClient().from('dispatch_message_logs').insert({
      id: createUuid(),
      user_id: await getCurrentUserId(),
      lead_id: input.leadId || null,
      chip_id: uuidOrNull(input.chipId),
      instance: input.instance || null,
      phone: input.phone || null,
      normalized_phone: input.normalizedPhone || null,
      direction: input.direction ?? 'outbound',
      part: input.part,
      body: input.body ?? '',
      status: input.status ?? 'sent',
      response_payload: input.responsePayload ?? {},
      created_at: timestamp,
    });
    if (error) throw new Error(error.message);
  },

  async list(limit = 100) {
    const { data, error } = await getSupabaseClient().from(table()).select('*').order('created_at', { ascending: false }).limit(limit);
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => rowToEvent(row));
  },
};
