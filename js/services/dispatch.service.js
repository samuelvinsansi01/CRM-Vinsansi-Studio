import { db } from '../core/supabase-client.js';
import { rpc } from './database.service.js';

export async function fillDay(queueDate = null, channel = null) {
  return rpc('rpc_fill_day', { p_queue_date: queueDate, p_channel: channel });
}

export async function listDispatchItems({ queueDate = null, status = null } = {}) {
  let q = db
    .from('dispatch_items')
    .select('*, leads(*), whatsapp_instances(*), dispatch_batches(*)')
    .is('deleted_at', null)
    .order('scheduled_at', { ascending: true });
  if (status) q = q.eq('status', status);
  if (queueDate) q = q.eq('dispatch_batches.queue_date', queueDate);
  const { data, error } = await q;
  if (error) throw error;
  return data;
}

export async function markSent(dispatchItemId, externalIds = {}) {
  return rpc('rpc_mark_sent', { p_dispatch_item_id: dispatchItemId, p_external_ids: externalIds });
}

export async function removeDispatchItem(dispatchItemId, reason = null) {
  return rpc('rpc_remove_dispatch_item', { p_dispatch_item_id: dispatchItemId, p_reason: reason });
}
