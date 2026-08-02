import { getSupabaseClient } from '../../lib/supabase';
import { channelId, currentUserIdNumber, queueStatusId } from '../schemaCatalog';
import { nowIso } from '../supabase.helpers';
import type { DispatchMessageLogInput, EventLogInput, EventLogRecord, EventLogRepository } from './eventLog.repository';

type AuditRow = {
  audit_events_id: number | string;
  source: string;
  action: string;
  entity_type: string;
  entity_id?: string | null;
  lead_id?: number | string | null;
  queue_item_id?: number | string | null;
  channel_id?: number | string | null;
  previous_status_id?: number | string | null;
  target_status_id?: number | string | null;
  message?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
};

function numeric(value?: string) {
  return value && /^\d+$/.test(value) ? Number(value) : null;
}

function mapAudit(row: AuditRow): EventLogRecord {
  const metadata = row.metadata ?? {};
  const channel = metadata.channel === 'instagram' || Number(row.channel_id) === 2 ? 'instagram' : metadata.channel === 'whatsapp' || Number(row.channel_id) === 1 ? 'whatsapp' : undefined;
  return {
    id: String(row.audit_events_id),
    source: row.source,
    action: row.action,
    channel,
    leadId: row.lead_id == null ? undefined : String(row.lead_id),
    queueItemId: row.queue_item_id == null ? undefined : String(row.queue_item_id),
    status: row.target_status_id == null ? undefined : String(row.target_status_id),
    message: row.message ?? undefined,
    metadata: {
      ...metadata,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      previous_status_id: row.previous_status_id,
      target_status_id: row.target_status_id,
    },
    created_at: row.created_at,
    updated_at: row.created_at,
  };
}

export const canonicalEventLogRepository: EventLogRepository = {
  async append(input: EventLogInput) {
    const client = getSupabaseClient();
    const resolvedChannelId = input.channel ? Number(await channelId(input.channel === 'instagram' ? 'Instagram' : 'WhatsApp')) : null;
    const response = await client.rpc('append_audit_event', {
      p_source: input.source,
      p_action: input.action,
      p_entity_type: input.queueItemId ? 'queue_item' : input.leadId ? 'lead' : 'system',
      p_entity_id: input.queueItemId ?? input.leadId ?? null,
      p_lead_id: numeric(input.leadId),
      p_queue_item_id: numeric(input.queueItemId),
      p_channel_id: resolvedChannelId,
      p_previous_status_id: Number(input.metadata?.previous_status_id) || null,
      p_target_status_id: Number(input.metadata?.target_status_id ?? input.status) || null,
      p_message: input.message ?? null,
      p_metadata: { ...(input.metadata ?? {}), channel: input.channel ?? null },
      p_users_id: null,
    });
    if (response.error) throw new Error(`Não foi possível registrar a auditoria: ${response.error.message}`);
    const timestamp = nowIso();
    return { id: String(response.data), created_at: timestamp, updated_at: timestamp, ...input };
  },
  async appendDispatchMessageLog(input: DispatchMessageLogInput) {
    const userId = await currentUserIdNumber();
    const channel = input.responsePayload?.channel === 'instagram' ? 'Instagram' : 'WhatsApp';
    const body = JSON.stringify({
      part: input.part,
      body: input.body ?? '',
      direction: input.direction ?? 'outbound',
      instance: input.instance ?? null,
      phone: input.phone ?? null,
      normalized_phone: input.normalizedPhone ?? null,
      response: input.responsePayload ?? {},
    });
    const { error } = await getSupabaseClient().from('sents').insert({
      users_id: userId,
      leads_id: numeric(input.leadId),
      channels_id: Number(await channelId(channel)),
      chips_id: numeric(input.chipId),
      status_id: await queueStatusId(input.status ?? 'sent'),
      sents_recipient: input.normalizedPhone || input.phone || null,
      sents_body: body,
      sents_attempt: 1,
      sents_error_message: input.status === 'error' ? String(input.responsePayload?.error ?? '') : null,
      sents_sent_at: input.status === 'sent' ? nowIso() : null,
    });
    if (error) throw new Error(`Não foi possível registrar o envio em sents: ${error.message}`);
    await this.append({
      source: 'dispatch', action: 'dispatch_message_recorded', channel: channel === 'Instagram' ? 'instagram' : 'whatsapp',
      leadId: input.leadId, status: input.status, message: input.status === 'error' ? String(input.responsePayload?.error ?? '') : undefined,
      metadata: { part: input.part, direction: input.direction ?? 'outbound', instance: input.instance ?? null },
    });
  },
  async list(limit = 100) {
    const response = await getSupabaseClient()
      .from('audit_events')
      .select('audit_events_id,source,action,entity_type,entity_id,lead_id,queue_item_id,channel_id,previous_status_id,target_status_id,message,metadata,created_at')
      .order('created_at', { ascending: false })
      .order('audit_events_id', { ascending: false })
      .limit(limit);
    if (response.error) throw new Error(`Não foi possível consultar a auditoria: ${response.error.message}`);
    return ((response.data ?? []) as AuditRow[]).map(mapAudit);
  },
};
