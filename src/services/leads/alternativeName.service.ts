import { getSupabaseClient } from '../../lib/supabase';
import { eventBus } from '../../lib/events';

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
    eventBus.emit('import:changed', { source: 'move' });
    return data;
  },
};
