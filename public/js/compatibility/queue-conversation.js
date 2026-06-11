/* ════════════════════════════
   FILA + CONVERSAS FIX V40.15
════════════════════════════ */
function getWhatsappQueueControl() {
  try {
    const raw = localStorage.getItem(WHATSAPP_QUEUE_CONTROL_KEY);
    const data = raw ? JSON.parse(raw) : null;
    if (!data || typeof data !== 'object') return { paused:false };
    return { paused: !!data.paused, updatedAt: data.updatedAt || null };
  } catch {
    return { paused:false };
  }
}

function renderQueueControlBar() {
  const host = document.getElementById('queueControlBar');
  if (!host) return;

  const control = getWhatsappQueueControl ? getWhatsappQueueControl() : { paused:false };
  const queue = getWhatsappQueueV27 ? getWhatsappQueueV27() : [];
  const pending = queue.filter(i => i.status === 'Pendente').length;
  const ready = queue.filter(i => i.status === 'Pronto').length;
  const sent = queue.filter(i => i.status === 'Enviado').length;
  const errors = queue.filter(i => i.status === 'Erro').length;

  host.innerHTML = `
    <div class="queue-control-bar">
      <div class="queue-control-left">
        <div class="queue-control-icon">${control.paused ? '⏸️' : '▶️'}</div>
        <div>
          <div class="queue-control-title">
            Fila ${control.paused ? 'pausada' : 'ativa'}
            <span class="queue-state-pill ${control.paused ? 'paused' : 'running'}">${control.paused ? 'PAUSADA' : 'ATIVA'}</span>
          </div>
          <div class="queue-control-text">
            ${pending} pendente(s) · ${ready} pronto(s) · ${sent} enviado(s) · ${errors} erro(s)
          </div>
        </div>
      </div>
      <div class="queue-control-actions">
        <button class="btn btn-ghost" onclick="toggleWhatsappQueuePause()">${control.paused ? 'Retomar fila' : 'Pausar fila'}</button>
        <button class="btn btn-primary" onclick="prepareQueueTemplates()">Sortear templates</button>
      </div>
    </div>
  `;
}

function getLeadCrmStoreSafeV4015() {
  try {
    if (typeof getLeadCrmStore === 'function') return getLeadCrmStore() || {};
  } catch(e) {}
  try {
    return JSON.parse(localStorage.getItem('vs_lead_crm_v1') || '{}') || {};
  } catch {
    return {};
  }
}

function getAllConversationLeadsV38() {
  const crm = getLeadCrmStoreSafeV4015();
  const queue = getWhatsappQueueV27 ? getWhatsappQueueV27() : [];
  const responses = getLocalResponsesV34 ? getLocalResponsesV34() : [];
  const map = new Map();

  Object.entries(crm || {}).forEach(([leadId, data]) => {
    const hasMessages = Array.isArray(data.messages) && data.messages.length;
    const hasResponse = !!data.lastResponseAt || data.pipelineStatus === 'respondeu';
    const hasLast = !!data.lastWhatsappMessage;
    if (hasMessages || hasResponse || hasLast) {
      const lead = findLeadEverywhere(leadId) || { id: leadId, nome: data.nome || 'Lead' };
      map.set(leadId, { leadId, lead, crm: data });
    }
  });

  responses.forEach(resp => {
    if (!resp.leadId) return;
    const lead = findLeadEverywhere(resp.leadId) || { id: resp.leadId, nome: 'Lead' };
    const crmData = crm[resp.leadId] || {};
    map.set(resp.leadId, { leadId: resp.leadId, lead, crm: crmData });
  });

  queue.forEach(item => {
    if (!item.leadId || item.status !== 'Enviado') return;
    const lead = findLeadEverywhere(item.leadId) || { id: item.leadId, nome: item.nome || 'Lead' };
    const crmData = crm[item.leadId] || {};
    map.set(item.leadId, { leadId: item.leadId, lead, crm: crmData });
  });

  return Array.from(map.values()).sort((a,b) => {
    const ad = a.crm?.lastResponseAt || a.crm?.lastWhatsappMessage?.sentAt || a.crm?.messages?.slice?.(-1)?.[0]?.at || '';
    const bd = b.crm?.lastResponseAt || b.crm?.lastWhatsappMessage?.sentAt || b.crm?.messages?.slice?.(-1)?.[0]?.at || '';
    return String(bd).localeCompare(String(ad));
  });
}

function getConversationMessagesV38(leadId) {
  const crmStore = getLeadCrmStoreSafeV4015();
  const crm = crmStore[leadId] || (typeof ensureLeadCrm === 'function' ? ensureLeadCrm(leadId, findLeadEverywhere(leadId) || {}) : {});
  const queue = getWhatsappQueueV27 ? getWhatsappQueueV27() : [];
  const messages = [];

  queue.filter(item => item.leadId === leadId && item.status === 'Enviado').forEach(item => {
    messages.push({
      id: item.id,
      direction: 'out',
      text: item.templateText || item.templateName || 'Mensagem enviada',
      at: item.sentAt || item.updatedAt || item.createdAt || '',
      atLabel: item.sentAtLabel || item.createdAtLabel || '',
      chipName: item.chipName || ''
    });
  });

  if (crm?.lastWhatsappMessage) {
    messages.push({
      id: 'last_' + leadId,
      direction: 'out',
      text: crm.lastWhatsappMessage.text || '',
      at: crm.lastWhatsappMessage.sentAt || '',
      atLabel: crm.lastWhatsappMessage.sentAtLabel || '',
      chipName: crm.lastWhatsappMessage.chipName || ''
    });
  }

  (crm?.messages || []).forEach(msg => messages.push(msg));

  const unique = new Map();
  messages.forEach(m => {
    const key = m.id || `${m.direction}_${m.at}_${m.text}`;
    unique.set(key, m);
  });

  return Array.from(unique.values()).sort((a,b) => String(a.at || '').localeCompare(String(b.at || '')));
}

function openLeadConversationV4014() {
  if (!activeLeadDrawerId) return;
  activeConversationLeadV38 = activeLeadDrawerId;
  if (typeof switchPanel === 'function') switchPanel('conversations');
  else { try { renderConversationsV38(); } catch(e) {} }
}

function removeLeadFromWhatsappQueue(leadId) {
  const queue = getWhatsappQueueV27 ? getWhatsappQueueV27() : [];
  const next = queue.filter(item => item.leadId !== leadId || item.status === 'Enviado');
  if (typeof saveWhatsappQueueV27 === 'function') saveWhatsappQueueV27(next);

  if (activeLeadDrawerId === leadId) {
    try { addLeadHistory(leadId, 'Removido da fila WhatsApp', activeLeadDrawerData || {}); } catch(e) {}
    try { renderLeadQueueBox(); } catch(e) {}
    try { renderLeadTimeline(leadId); } catch(e) {}
  }

  try { renderWhatsappQueuePanel(); } catch(e) { console.warn('render fila ignorado:', e?.message || e); }
}


