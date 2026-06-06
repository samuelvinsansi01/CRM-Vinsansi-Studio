(function(){
  'use strict';

  function getClient(){ return window.sbClient || window.crmSupabase || window.supabaseClient || null; }
  function normalizePhone(value = ''){
    let digits = String(value || '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits.startsWith('00')) digits = digits.slice(2);
    if (!digits.startsWith('55') && (digits.length === 10 || digits.length === 11)) digits = '55' + digits;
    return digits;
  }

  function normalizeNewWhatsappRow(row = {}){
    const externalId = row.external_message_id || row.external_id || row.id || '';
    const raw = row.payload_original || row.raw_payload || {};
    const phone = normalizePhone(row.phone_real || raw.phone || raw.phone_real || row.remote_jid || row.sender_jid || '');
    const occurredAt = row.occurred_at || row.created_at || new Date().toISOString();
    return {
      id: externalId,
      dbId: row.id || '',
      externalId,
      leadId: row.lead_id || '',
      direction: row.direction || 'in',
      messageType: row.message_type || 'text',
      body: row.body || raw.body || raw.text || '',
      text: row.body || raw.body || raw.text || '',
      phone,
      phone_normalized: phone,
      receivedAt: occurredAt,
      occurredAt,
      at: occurredAt,
      read: !!row.read_at,
      rawPayload: raw
    };
  }

  window.updateInboxBadgeV41 = window.updateInboxBadgeV41 || function(){
    try {
      const responses = typeof window.getLocalResponsesV34 === 'function' ? window.getLocalResponsesV34() : [];
      const unread = (responses || []).filter(item => item && item.direction !== 'out' && !item.read).length;
      const el = document.getElementById('badge-inbox');
      if (el) el.textContent = String(unread || 0);
    } catch(_) {}
  };

  // Substitui a busca antiga que selecionava external_id/instance/phone_normalized/raw_payload.
  window.fetchEvolutionResponsesV34 = async function(options = {}){
    const silent = !!options.silent;
    const client = getClient();
    const user = window.currentUser;
    if (!client || !user?.id) return [];

    try {
      const { data, error } = await client
        .from('whatsapp_messages')
        .select('id,external_message_id,lead_id,whatsapp_instance_id,contact_map_id,direction,remote_jid,sender_jid,body,media_asset_id,payload_original,occurred_at,created_at')
        .eq('user_id', user.id)
        .order('occurred_at', { ascending:false })
        .limit(500);

      if (error) throw error;
      const normalized = (data || []).map(normalizeNewWhatsappRow);

      if (typeof window.saveSupabaseWhatsappMessagesCacheV412 === 'function') {
        window.saveSupabaseWhatsappMessagesCacheV412(normalized);
      }

      if (typeof window.getLocalResponsesV34 === 'function' && typeof window.saveLocalResponsesV34 === 'function') {
        const localMap = new Map((window.getLocalResponsesV34() || []).map(item => [item.id, item]));
        normalized.forEach(msg => {
          if (msg.direction === 'in') localMap.set(msg.id, { ...(localMap.get(msg.id) || {}), ...msg, applied: !!msg.leadId });
        });
        window.saveLocalResponsesV34(Array.from(localMap.values()).sort((a,b) => String(b.receivedAt || '').localeCompare(String(a.receivedAt || ''))).slice(0,500));
      }

      try { window.renderResponsesV34?.(); } catch(_) {}
      try { window.renderInbox?.(); } catch(_) {}
      try { window.renderConversations?.(); } catch(_) {}
      try { window.updateBadges?.(); } catch(_) {}
      if (!silent) window.notify?.('Respostas atualizadas.');
      return data || [];
    } catch(error) {
      console.warn('[schema-bridge] whatsapp_messages:', error?.message || error);
      if (!silent) window.notify?.('Erro ao buscar respostas do Supabase.', 'err');
      return [];
    }
  };

  // Evita 500 visual do contact-map enquanto a Fase 7 definitiva não entra.
  window.fetchContactMapsV418 = async function(){ return []; };

  console.info('[schema-bridge-postinit] patch pós-init carregado');
})();
