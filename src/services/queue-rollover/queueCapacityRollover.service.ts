import { getSupabaseClient } from '../../lib/supabase';

export type QueueRolloverChannel = 'whatsapp' | 'instagram';

type QueueRolloverResult = {
  unresolvedOverflow?: number;
};

export const queueCapacityRollover = {
  async run(channel: QueueRolloverChannel, targetDate: string) {
    if (!targetDate) return;
    const { data, error } = await getSupabaseClient().rpc('rollover_queue_items_to_capacity', {
      p_channel: channel,
      p_target_date: targetDate,
    });
    if (error) throw new Error(error.message);
    const result = (data ?? {}) as QueueRolloverResult;
    const unresolved = Math.max(0, Number(result.unresolvedOverflow ?? 0));
    if (unresolved > 0) {
      throw new Error(`Capacidade inconsistente após a virada: ${unresolved} item(ns) ainda excedem o limite diário.`);
    }
  },
};
