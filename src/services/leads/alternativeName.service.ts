import { getSupabaseClient } from '../../lib/supabase';
import { eventBus } from '../../lib/events';

type Row = Record<string, unknown>;

export type AlternativeNameUpdateResult = {
  alternativeName: string;
  originalCompanyName: string;
  sendCompanyName: string;
  queueItemId: string;
  snapshotRefreshed: boolean;
  message1: string;
  message2: string;
  message3: string;
  message4: string;
};

function text(value: unknown) {
  return value == null ? '' : String(value);
}

function normalizeResult(data: unknown): AlternativeNameUpdateResult {
  const row = (data && typeof data === 'object' ? data : {}) as Row;
  const messages = (row.messages && typeof row.messages === 'object' ? row.messages : {}) as Row;
  return {
    alternativeName: text(row.alternativeName),
    originalCompanyName: text(row.originalCompanyName),
    sendCompanyName: text(row.sendCompanyName),
    queueItemId: text(row.queueItemId),
    snapshotRefreshed: Boolean(row.snapshotRefreshed),
    message1: text(messages.message_1),
    message2: text(messages.message_2),
    message3: text(messages.message_3),
    message4: text(messages.message_4),
  };
}

export const alternativeNameService = {
  async update(leadId: string, alternativeName: string, queueItemId?: string) {
    const numericLeadId = Number(leadId);
    const numericQueueItemId = queueItemId ? Number(queueItemId) : null;
    if (!Number.isSafeInteger(numericLeadId) || numericLeadId <= 0) throw new Error('Lead inválido.');
    if (numericQueueItemId != null && (!Number.isSafeInteger(numericQueueItemId) || numericQueueItemId <= 0)) throw new Error('Item de fila inválido.');
    const { data, error } = await getSupabaseClient().rpc('update_lead_alternative_name', {
      p_lead_id: numericLeadId,
      p_alternative_name: alternativeName.trim() || null,
      p_queue_item_id: numericQueueItemId,
    });
    if (error) throw new Error(error.message);
    const result = normalizeResult(data);
    eventBus.emit('import:changed', { source: 'move' });
    return result;
  },
};
