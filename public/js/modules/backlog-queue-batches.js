// CRM Rebuild Fase 5 — Backlog, Fila e Lotes
// Módulo frontend leve. O banco continua sendo a fonte da verdade.

(function () {
  'use strict';

  const CRM = window.CRM || (window.CRM = {});

  function getSupabase() {
    if (CRM.supabase) return CRM.supabase;
    if (window.supabaseClient) return window.supabaseClient;
    if (window.supabase) return window.supabase;
    throw new Error('Cliente Supabase não encontrado. Configure o core antes de usar a Fase 5.');
  }

  async function ensureDispatchSettings() {
    const sb = getSupabase();
    const { error } = await sb.rpc('rpc_ensure_dispatch_settings');
    if (error) throw error;
    return true;
  }

  async function listBacklog(channel = null) {
    const sb = getSupabase();
    let query = sb.from('v_backlog_fifo').select('*');
    if (channel) query = query.eq('channel', channel);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  async function listQueue(channel = null) {
    const sb = getSupabase();
    let query = sb.from('v_queue_pending').select('*');
    if (channel) query = query.eq('channel', channel);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  async function addLeadToBacklog(leadId, channel = null, reason = null) {
    const sb = getSupabase();
    const { data, error } = await sb.rpc('rpc_add_to_backlog_safe', {
      p_lead_id: leadId,
      p_channel: channel,
      p_reason: reason
    });
    if (error) throw error;
    return data;
  }

  async function moveBacklogToQueue(backlogItemId, scheduledFor = null, priority = 0) {
    const sb = getSupabase();
    const { data, error } = await sb.rpc('rpc_move_backlog_to_queue', {
      p_backlog_item_id: backlogItemId,
      p_scheduled_for: scheduledFor,
      p_priority: priority
    });
    if (error) throw error;
    return data;
  }

  async function addLeadToQueue(leadId, channel = null, scheduledFor = null, priority = 0) {
    const sb = getSupabase();
    const { data, error } = await sb.rpc('rpc_add_to_queue_safe', {
      p_lead_id: leadId,
      p_channel: channel,
      p_scheduled_for: scheduledFor,
      p_priority: priority
    });
    if (error) throw error;
    return data;
  }

  async function createBatchFromQueue(instanceId, options = {}) {
    const sb = getSupabase();
    const { data, error } = await sb.rpc('rpc_create_dispatch_batch_from_queue', {
      p_whatsapp_instance_id: instanceId,
      p_channel: options.channel || 'whatsapp',
      p_batch_date: options.batchDate || new Date().toISOString().slice(0, 10),
      p_batch_number: options.batchNumber || 1,
      p_max_items: options.maxItems || null
    });
    if (error) throw error;
    return data;
  }

  async function cancelQueueItem(queueItemId, reason = null) {
    const sb = getSupabase();
    const { error } = await sb.rpc('rpc_cancel_queue_item', {
      p_queue_item_id: queueItemId,
      p_reason: reason
    });
    if (error) throw error;
    return true;
  }

  async function listTodayBatches() {
    const sb = getSupabase();
    const { data, error } = await sb.from('v_dispatch_batches_today').select('*');
    if (error) throw error;
    return data || [];
  }

  CRM.backlogQueueBatches = {
    ensureDispatchSettings,
    listBacklog,
    listQueue,
    addLeadToBacklog,
    moveBacklogToQueue,
    addLeadToQueue,
    createBatchFromQueue,
    cancelQueueItem,
    listTodayBatches
  };
})();
