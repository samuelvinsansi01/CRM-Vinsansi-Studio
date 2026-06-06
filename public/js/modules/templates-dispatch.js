// Fase 6 — Templates, Imagens e Disparo
// Módulo frontend leve. O banco continua sendo a fonte da verdade.

(function () {
  'use strict';

  async function getSupabase() {
    if (window.crmSupabase) return window.crmSupabase;
    if (window.supabaseClient) return window.supabaseClient;
    if (window.supabase) return window.supabase;
    throw new Error('Cliente Supabase não encontrado no frontend.');
  }

  async function createTemplate({ name, channel = 'whatsapp', message1 = '', message2 = '', variables = [] }) {
    const supabase = await getSupabase();
    const { data, error } = await supabase.rpc('rpc_create_message_template', {
      p_name: name,
      p_channel: channel,
      p_message_1: message1,
      p_message_2: message2,
      p_variables: variables
    });
    if (error) throw error;
    return data;
  }

  async function createTemplateVersion({ templateId, message1 = '', message2 = '', variables = [] }) {
    const supabase = await getSupabase();
    const { data, error } = await supabase.rpc('rpc_create_template_version', {
      p_template_id: templateId,
      p_message_1: message1,
      p_message_2: message2,
      p_variables: variables
    });
    if (error) throw error;
    return data;
  }

  async function registerMediaAsset({ name, storageKey, mimeType, sizeBytes, hash }) {
    const supabase = await getSupabase();
    const { data, error } = await supabase.rpc('rpc_register_media_asset', {
      p_name: name,
      p_storage_key: storageKey,
      p_mime_type: mimeType,
      p_size_bytes: sizeBytes,
      p_hash: hash
    });
    if (error) throw error;
    return data;
  }

  async function startDispatchItem(dispatchItemId, whatsappInstanceId = null) {
    const supabase = await getSupabase();
    const { error } = await supabase.rpc('rpc_start_dispatch_item', {
      p_dispatch_item_id: dispatchItemId,
      p_whatsapp_instance_id: whatsappInstanceId
    });
    if (error) throw error;
  }

  async function logDispatchStep({
    dispatchItemId,
    stepName,
    templateVersionId = null,
    mediaAssetId = null,
    status = 'sent',
    externalMessageId = null,
    errorMessage = null,
    providerPayload = {}
  }) {
    const supabase = await getSupabase();
    const { data, error } = await supabase.rpc('rpc_log_dispatch_step', {
      p_dispatch_item_id: dispatchItemId,
      p_step_name: stepName,
      p_template_version_id: templateVersionId,
      p_media_asset_id: mediaAssetId,
      p_status: status,
      p_external_message_id: externalMessageId,
      p_error_message: errorMessage,
      p_provider_payload: providerPayload
    });
    if (error) throw error;
    return data;
  }

  async function markDispatchItemSent(dispatchItemId) {
    const supabase = await getSupabase();
    const { data, error } = await supabase.rpc('rpc_mark_dispatch_item_sent', {
      p_dispatch_item_id: dispatchItemId
    });
    if (error) throw error;
    return data;
  }

  async function markDispatchItemFailed(dispatchItemId, errorMessage) {
    const supabase = await getSupabase();
    const { error } = await supabase.rpc('rpc_mark_dispatch_item_failed', {
      p_dispatch_item_id: dispatchItemId,
      p_error_message: errorMessage || null
    });
    if (error) throw error;
  }

  async function getNextDispatchStep(dispatchItemId) {
    const supabase = await getSupabase();
    const { data, error } = await supabase.rpc('rpc_get_next_dispatch_step', {
      p_dispatch_item_id: dispatchItemId
    });
    if (error) throw error;
    return data;
  }

  async function listReadyDispatchItems(limit = 50) {
    const supabase = await getSupabase();
    const { data, error } = await supabase
      .from('v_dispatch_ready_items')
      .select('*')
      .order('batch_date', { ascending: true })
      .order('batch_number', { ascending: true })
      .order('sequence_number', { ascending: true })
      .limit(limit);
    if (error) throw error;
    return data || [];
  }

  async function listLatestTemplateVersions() {
    const supabase = await getSupabase();
    const { data, error } = await supabase
      .from('v_template_versions_latest')
      .select('*')
      .eq('active', true)
      .order('template_name', { ascending: true });
    if (error) throw error;
    return data || [];
  }

  window.CRMTemplatesDispatch = {
    createTemplate,
    createTemplateVersion,
    registerMediaAsset,
    startDispatchItem,
    logDispatchStep,
    markDispatchItemSent,
    markDispatchItemFailed,
    getNextDispatchStep,
    listReadyDispatchItems,
    listLatestTemplateVersions
  };
})();
