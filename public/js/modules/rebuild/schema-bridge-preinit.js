(function(){
  'use strict';

  function log(...args){ try { console.info('[schema-bridge-preinit]', ...args); } catch(_){} }

  function safeSetText(id, value){
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function normalizePhone(value = ''){
    let digits = String(value || '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits.startsWith('00')) digits = digits.slice(2);
    if (!digits.startsWith('55') && (digits.length === 10 || digits.length === 11)) digits = '55' + digits;
    return digits;
  }

  function getClient(){
    return window.sbClient || window.crmSupabase || window.supabaseClient || null;
  }

  async function loadCrmDataFromNewSchema(){
    const client = getClient();
    const user = window.currentUser;
    if (!client || !user?.id) return;

    try {
      const [notesRes, eventsRes, followupsRes] = await Promise.all([
        client.from('crm_notes').select('*').eq('user_id', user.id),
        client.from('lead_events').select('*').eq('user_id', user.id),
        client.from('followups').select('*').eq('user_id', user.id)
      ]);

      const store = typeof window.getLeadCrmStore === 'function' ? window.getLeadCrmStore() : {};

      (notesRes.data || []).forEach(note => {
        const id = note.lead_id;
        if (!id) return;
        store[id] = store[id] || { pipelineStatus:'contato_enviado', notes:[], history:[], createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() };
        store[id].notes = Array.isArray(store[id].notes) ? store[id].notes : [];
        const text = note.note || '';
        if (text && !store[id].notes.some(n => n.dbId === note.id || n.text === text)) {
          store[id].notes.push({ dbId:note.id, at: note.created_at || '', text });
        }
      });

      (eventsRes.data || []).forEach(event => {
        const id = event.lead_id;
        if (!id) return;
        store[id] = store[id] || { pipelineStatus:'contato_enviado', notes:[], history:[], createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() };
        store[id].history = Array.isArray(store[id].history) ? store[id].history : [];
        const text = event.event_type || 'Evento registrado';
        if (!store[id].history.some(h => h.dbId === event.id)) {
          store[id].history.push({ dbId:event.id, at:event.created_at || '', text });
        }
      });

      (followupsRes.data || []).forEach(fu => {
        const id = fu.lead_id;
        if (!id) return;
        store[id] = store[id] || { pipelineStatus:'contato_enviado', notes:[], history:[], createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() };
        store[id].followUpDate = fu.followup_at || '';
        store[id].followUpStatus = fu.completed_at ? 'done' : 'future';
      });

      if (typeof window.saveLeadCrmStore === 'function') window.saveLeadCrmStore(store);
      if (typeof window.renderFollowUpsHome === 'function') window.renderFollowUpsHome();
    } catch (error) {
      console.warn('[schema-bridge] CRM novo não carregado:', error?.message || error);
    }
  }

  // Sobrescreve a função antiga que buscava lead_notes, lead_history e lead_followups.
  window.loadSupabaseLeadCrmToLocalState = loadCrmDataFromNewSchema;

  // Evita erro visual quando o badge antigo da inbox não existir.
  window.updateInboxBadgeV41 = window.updateInboxBadgeV41 || function(){
    try {
      const responses = typeof window.getLocalResponsesV34 === 'function' ? window.getLocalResponsesV34() : [];
      const unread = (responses || []).filter(item => item && item.direction !== 'out' && !item.read).length;
      safeSetText('badge-inbox', unread);
    } catch(_) {}
  };

  window.normalizeWhatsappDigitsV66 = normalizePhone;

  log('patch pré-init carregado');
})();
