
function debugDispatchPersistV413(step, data = {}) {
  try {
    console.groupCollapsed(`[dispatch][persist] ${step}`);
    console.log(data);
    console.groupEnd();
  } catch (e) {
    console.log(`[dispatch][persist] ${step}`, data);
  }
}


const MANUAL_WHATSAPP_SEND_LOCKS_V434 = window.__MANUAL_WHATSAPP_SEND_LOCKS_V434 || (window.__MANUAL_WHATSAPP_SEND_LOCKS_V434 = new Map());

function getManualWhatsappSendLockKeyV434({ leadId, instance, phone, text }) {
  const raw = `${leadId || ''}|${instance || ''}|${phone || ''}|${String(text || '').trim()}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) hash = ((hash << 5) - hash + raw.charCodeAt(i)) | 0;
  return `manual:${Math.abs(hash)}`;
}

function acquireManualWhatsappSendLockV434(key, ttlMs = 20000) {
  const now = Date.now();
  const expires = MANUAL_WHATSAPP_SEND_LOCKS_V434.get(key);
  if (expires && expires > now) return false;
  MANUAL_WHATSAPP_SEND_LOCKS_V434.set(key, now + ttlMs);
  return true;
}
function releaseManualWhatsappSendLockV434(key) { try { MANUAL_WHATSAPP_SEND_LOCKS_V434.delete(key); } catch (_) {} }

/* ════════════════════════════
   ENVIO MANUAL FIX V40.12
════════════════════════════ */
function getManualSendEvolutionConfigV4012() {
  try {
    const cfg = typeof getEvolutionConfigForChipV405 === 'function'
      ? getEvolutionConfigForChipV405()
      : null;

    if (cfg && cfg.url && cfg.instance && cfg.apiKey) return cfg;
  } catch(e) {}

  try {
    const chip = typeof getAnySavedChipV4010 === 'function' ? getAnySavedChipV4010() : null;
    if (chip) {
      return {
        url: String(chip.url || '').replace(/\/$/, ''),
        instance: chip.instance || '',
        apiKey: chip.key || chip.apiKey || '',
        chip
      };
    }
  } catch(e) {}

  const settings = typeof getEvolutionSettings === 'function' ? getEvolutionSettings() : {};
  return {
    url: String(settings.url || '').replace(/\/$/, ''),
    instance: settings.instance || '',
    apiKey: settings.apiKey || '',
    chip: null
  };
}

async function sendActiveLeadWhatsappMessage() {
  if (!activeLeadDrawerId || !activeLeadDrawerData) return;

  const result = document.getElementById('leadMessageResult');
  const text = (document.getElementById('leadMessageText')?.value || '').trim();
  const phone = normalizePhoneForEvolution(activeLeadDrawerData.whatsapp || activeLeadDrawerData.phone || activeLeadDrawerData.telefone || '');
  const cfg = getManualSendEvolutionConfigV4012();

  if (!cfg.url || !cfg.instance || !cfg.apiKey) {
    notify('Cadastre/conecte um chip antes de enviar.', 'warn');
    if (result) result.textContent = 'Chip/Evolution não configurado.';
    return;
  }

  if (!phone || phone.length < 10) {
    notify('Telefone inválido para envio.', 'warn');
    if (result) result.textContent = 'Telefone inválido.';
    return;
  }

  if (!text) {
    notify('Digite uma mensagem antes de enviar.', 'warn');
    if (result) result.textContent = 'Mensagem vazia.';
    return;
  }

  const lockKey = getManualWhatsappSendLockKeyV434({ leadId:activeLeadDrawerId, instance:cfg.instance, phone, text });
  if (!acquireManualWhatsappSendLockV434(lockKey, 25000)) {
    debugDispatchPersistV413('manual-duplicate-send-blocked', { leadId:activeLeadDrawerId, instance:cfg.instance, phone, lockKey });
    notify('Envio duplicado bloqueado: mensagem já está em processamento.', 'warn');
    if (result) result.textContent = 'Envio em andamento. Aguarde antes de clicar novamente.';
    return;
  }

  if (result) result.textContent = 'Enviando mensagem...';

  try {
    const endpoint = `${cfg.url}/message/sendText/${encodeURIComponent(cfg.instance)}`;

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        apikey: cfg.apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(buildEvolutionTextPayloadV4013(phone, text))
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const msg = data?.message || data?.error || `HTTP ${res.status}`;
      addLeadHistory(activeLeadDrawerId, `WhatsApp: erro ao enviar mensagem (${msg})`, activeLeadDrawerData);
      if (result) result.textContent = `Erro ao enviar: ${msg}`;
      if (typeof renderLeadTimeline === 'function') renderLeadTimeline(activeLeadDrawerId);
      notify('Erro ao enviar mensagem.', 'err');
      return;
    }

    const crm = ensureLeadCrm(activeLeadDrawerId, activeLeadDrawerData || {});
    crm.lastWhatsappMessage = {
      text,
      phone,
      sentAt: new Date().toISOString(),
      sentAtLabel: crmNowLabel(),
      chipName: cfg.chip?.name || cfg.chip?.nome || cfg.instance,
      instance: cfg.instance,
      response: data
    };

    crm.messages = Array.isArray(crm.messages) ? crm.messages : [];
    crm.messages.push({
      id: 'manual_' + Date.now(),
      direction: 'out',
      text,
      phone,
      at: new Date().toISOString(),
      atLabel: crmNowLabel(),
      chipName: cfg.chip?.name || cfg.chip?.nome || cfg.instance,
      response: data
    });

    saveLeadCrm(activeLeadDrawerId, crm);
    addLeadHistory(activeLeadDrawerId, `Mensagem enviada via WhatsApp por ${cfg.chip?.name || cfg.chip?.nome || cfg.instance}`, activeLeadDrawerData);

    if (result) result.textContent = `Mensagem enviada em ${crmNowLabel()}.`;
    if (typeof renderLeadTimeline === 'function') renderLeadTimeline(activeLeadDrawerId);
    if (typeof renderConversationsV38 === 'function') renderConversationsV38();

    notify('Mensagem enviada via Evolution.');
  } catch (err) {
    addLeadHistory(activeLeadDrawerId, `WhatsApp: falha ao enviar mensagem (${err?.message || 'erro'})`, activeLeadDrawerData);
    if (result) result.textContent = formatEvolutionErrorV41(err);
    if (typeof renderLeadTimeline === 'function') renderLeadTimeline(activeLeadDrawerId);
    notify('Falha ao conectar na Evolution.', 'err');
  } finally {
    releaseManualWhatsappSendLockV434(lockKey);
  }
}


/* ════════════════════════════
   EVOLUTION TEXTMESSAGE PAYLOAD V40.13
   Evolution v1.8.2 usa:
   { number, textMessage: { text } }
════════════════════════════ */
function buildEvolutionTextPayloadV4013(number, text) {
  return {
    number: String(number || '').replace(/\D/g, ''),
    textMessage: {
      text: String(text || '')
    }
  };
}

async function sendEvolutionTextV4013({ url, instance, apiKey, number, text }) {
  const endpoint = `${String(url || '').replace(/\/$/, '')}/message/sendText/${encodeURIComponent(instance || '')}`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      apikey: apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(buildEvolutionTextPayloadV4013(number, text))
  });

  const raw = await res.text();
  let data = {};
  try { data = JSON.parse(raw); } catch { data = { raw }; }

  if (!res.ok) {
    const msg = data?.message || data?.error || raw || `HTTP ${res.status}`;
    throw new Error(msg);
  }

  return data;
}

async function sendActiveLeadWhatsappMessage() {
  if (!activeLeadDrawerId || !activeLeadDrawerData) return;

  const result = document.getElementById('leadMessageResult');
  const text = (document.getElementById('leadMessageText')?.value || '').trim();
  const phone = normalizePhoneForEvolution(activeLeadDrawerData.whatsapp || activeLeadDrawerData.phone || activeLeadDrawerData.telefone || '');
  const cfg = getManualSendEvolutionConfigV4012 ? getManualSendEvolutionConfigV4012() : (getEvolutionConfigForChipV405 ? getEvolutionConfigForChipV405() : {});

  if (!cfg.url || !cfg.instance || !cfg.apiKey) {
    notify('Cadastre/conecte um chip antes de enviar.', 'warn');
    if (result) result.textContent = 'Chip/Evolution não configurado.';
    return;
  }

  if (!phone || phone.length < 10) {
    notify('Telefone inválido para envio.', 'warn');
    if (result) result.textContent = 'Telefone inválido.';
    return;
  }

  if (!text) {
    notify('Digite uma mensagem antes de enviar.', 'warn');
    if (result) result.textContent = 'Mensagem vazia.';
    return;
  }

  if (result) result.textContent = 'Enviando mensagem...';

  try {
    const data = await sendEvolutionTextV4013({
      url: cfg.url,
      instance: cfg.instance,
      apiKey: cfg.apiKey,
      number: phone,
      text
    });

    const crm = ensureLeadCrm(activeLeadDrawerId, activeLeadDrawerData || {});
    const sentAt = new Date().toISOString();
    const sentAtLabel = crmNowLabel();

    crm.lastWhatsappMessage = {
      text,
      phone,
      sentAt,
      sentAtLabel,
      chipName: cfg.chip?.name || cfg.chip?.nome || cfg.instance,
      instance: cfg.instance,
      response: data
    };

    const messageId = typeof buildOutgoingWhatsappExternalIdV412 === 'function'
      ? buildOutgoingWhatsappExternalIdV412('manual', data)
      : 'manual_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);

    crm.messages = Array.isArray(crm.messages) ? crm.messages : [];
    crm.messages.push({
      id: messageId,
      direction: 'out',
      text,
      phone,
      at: sentAt,
      atLabel: sentAtLabel,
      chipName: cfg.chip?.name || cfg.chip?.nome || cfg.instance,
      instance: cfg.instance,
      response: data
    });

    saveLeadCrm(activeLeadDrawerId, crm);

    let persistence = { ok:false, pending:false };
    debugDispatchPersistV413('persist-function-check', { file: 'whatsapp-manual-send.js', available: typeof persistOutgoingWhatsappMessageV412 === 'function' });
      if (typeof persistOutgoingWhatsappMessageV412 === 'function') {
      persistence = await persistOutgoingWhatsappMessageV412({
        id: messageId,
        leadId: activeLeadDrawerId,
        instance: cfg.instance,
        phone,
        text,
        occurredAt: sentAt
      });
    }

    addLeadHistory(activeLeadDrawerId, `Mensagem enviada via WhatsApp por ${cfg.chip?.name || cfg.chip?.nome || cfg.instance}`, activeLeadDrawerData);

    if (result) result.textContent = persistence.ok ? `Mensagem enviada e salva em ${sentAtLabel}.` : `Mensagem enviada em ${sentAtLabel}. Sincronização com banco pendente.`;
    if (typeof renderLeadTimeline === 'function') renderLeadTimeline(activeLeadDrawerId);
    if (typeof renderConversationsV38 === 'function') renderConversationsV38();

    notify(persistence.ok ? 'Mensagem enviada e salva.' : 'Mensagem enviada. Sincronização com banco pendente.', persistence.ok ? undefined : 'warn');
  } catch (err) {
    addLeadHistory(activeLeadDrawerId, `WhatsApp: falha ao enviar mensagem (${err?.message || 'erro'})`, activeLeadDrawerData);
    if (result) result.textContent = formatEvolutionErrorV41(err);
    if (typeof renderLeadTimeline === 'function') renderLeadTimeline(activeLeadDrawerId);
    notify(formatEvolutionErrorV41(err), 'err');
  }
}


/* ════════════════════════════
   DRAWER WHATSAPP STATE V40.14
════════════════════════════ */
async function markLeadWhatsappSentV4014(leadId, lead, payload = {}) {
  if (!leadId) return;

  const crm = ensureLeadCrm(leadId, lead || {});
  const now = payload.occurredAt || new Date().toISOString();
  const label = crmNowLabel();
  const messageId = payload.messageId || (typeof buildOutgoingWhatsappExternalIdV412 === 'function'
    ? buildOutgoingWhatsappExternalIdV412('manual', payload.response || {})
    : 'manual_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8));

  crm.whatsappStatus = {
    status: 'sent',
    label: 'Mensagem enviada',
    number: payload.phone || '',
    updatedAt: now,
    updatedAtLabel: label
  };

  crm.lastWhatsappMessage = {
    text: payload.text || '',
    phone: payload.phone || '',
    sentAt: now,
    sentAtLabel: label,
    chipName: payload.chipName || payload.instance || '',
    instance: payload.instance || '',
    response: payload.response || null
  };

  crm.messages = Array.isArray(crm.messages) ? crm.messages : [];
  const localMessage = {
    id: messageId,
    direction: 'out',
    text: payload.text || '',
    phone: payload.phone || '',
    at: now,
    atLabel: label,
    chipName: payload.chipName || payload.instance || '',
    instance: payload.instance || '',
    response: payload.response || null,
    status:'saving'
  };
  const existingMessage = crm.messages.find(item => item.id === messageId);
  if (existingMessage) Object.assign(existingMessage, localMessage);
  else crm.messages.push(localMessage);

  crm.pipelineStatus = crm.pipelineStatus || 'contato_enviado';

  saveLeadCrm(leadId, crm);
  if (typeof upsertLocalOutgoingWhatsappMessageV426 === 'function') {
    upsertLocalOutgoingWhatsappMessageV426({
      id:messageId,
      leadId,
      instance:payload.instance || '',
      phone:payload.phone || '',
      text:payload.text || '',
      occurredAt:now,
      response:payload.response || null,
      status:'saving'
    }, { log:payload.optimisticRendered !== true, skipCrm:true });
  }
  let persistence = { ok:false, pending:true };
  debugDispatchPersistV413('persist-function-check', { file: 'whatsapp-manual-send.js', available: typeof persistOutgoingWhatsappMessageV412 === 'function' });
  if (typeof persistOutgoingWhatsappMessageV412 === 'function') {
    persistOutgoingWhatsappMessageV412({
      id: messageId,
      leadId,
      instance: payload.instance || '',
      phone: payload.phone || '',
      text: payload.text || '',
      occurredAt: now,
      response: payload.response || null
    }).then(result => {
      if (typeof updateLocalOutgoingWhatsappMessageStatusV426 === 'function') {
        updateLocalOutgoingWhatsappMessageStatusV426(messageId, result.ok ? 'sent' : 'pending', { leadId, response:payload.response || null });
      }
      if (!result.ok) notify('Mensagem enviada. Sincronização com banco pendente.', 'warn');
    }).catch(error => {
      if (typeof updateLocalOutgoingWhatsappMessageStatusV426 === 'function') {
        updateLocalOutgoingWhatsappMessageStatusV426(messageId, 'pending', { leadId, response:payload.response || null });
      }
      uiSyncLogV426('supabase-save-error', { entity:'message', id:messageId, error:error?.message || error });
      notify('Mensagem enviada. Sincronização com banco pendente.', 'warn');
    });
  }

  try {
    addLeadHistory(leadId, `Mensagem enviada via WhatsApp por ${payload.chipName || payload.instance || 'Evolution'}`, lead || {});
  } catch(e) {}

  try { renderLeadWhatsappValidation(); } catch(e) {}
  try { renderLeadQueueBox(); } catch(e) {}
  try { renderLeadTimeline(leadId); } catch(e) {}
  try { renderConversationsV38(); } catch(e) {}
  try { updateConversationsBadgeV38(); } catch(e) {}
  try { renderKanban(); } catch(e) {}
  return persistence;
}

function openLeadConversationV4014() {
  if (!activeLeadDrawerId) return;
  activeConversationLeadV38 = activeLeadDrawerId;
  if (typeof switchPanel === 'function') switchPanel('conversations');
  else { try { renderConversationsV38(); } catch(e) {} }
}

async function sendActiveLeadWhatsappMessage() {
  if (!activeLeadDrawerId || !activeLeadDrawerData) return;

  const result = document.getElementById('leadMessageResult');
  const text = (document.getElementById('leadMessageText')?.value || '').trim();
  const phone = normalizePhoneForEvolution(activeLeadDrawerData.whatsapp || activeLeadDrawerData.phone || activeLeadDrawerData.telefone || '');
  const cfg = getManualSendEvolutionConfigV4012 ? getManualSendEvolutionConfigV4012() : (getEvolutionConfigForChipV405 ? getEvolutionConfigForChipV405() : {});

  if (!cfg.url || !cfg.instance || !cfg.apiKey) {
    notify('Cadastre/conecte um chip antes de enviar.', 'warn');
    if (result) result.textContent = 'Chip/Evolution não configurado.';
    return;
  }

  if (!phone || phone.length < 10) {
    notify('Telefone inválido para envio.', 'warn');
    if (result) result.textContent = 'Telefone inválido.';
    return;
  }

  if (!text) {
    notify('Digite uma mensagem antes de enviar.', 'warn');
    if (result) result.textContent = 'Mensagem vazia.';
    return;
  }

  if (result) result.textContent = 'Enviando mensagem...';
  const optimisticMessageId = typeof buildOutgoingWhatsappExternalIdV412 === 'function'
    ? buildOutgoingWhatsappExternalIdV412('manual')
    : 'manual_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  const optimisticOccurredAt = new Date().toISOString();
  if (typeof upsertLocalOutgoingWhatsappMessageV426 === 'function') {
    upsertLocalOutgoingWhatsappMessageV426({
      id:optimisticMessageId,
      leadId:activeLeadDrawerId,
      instance:cfg.instance,
      phone,
      text,
      occurredAt:optimisticOccurredAt,
      status:'sending'
    });
  }

  try {
    const data = await sendEvolutionTextV4013({
      url: cfg.url,
      instance: cfg.instance,
      apiKey: cfg.apiKey,
      number: phone,
      text
    });

    const persistence = await markLeadWhatsappSentV4014(activeLeadDrawerId, activeLeadDrawerData, {
      text,
      phone,
      instance: cfg.instance,
      chipName: cfg.chip?.name || cfg.chip?.nome || cfg.instance,
      response: data,
      messageId:optimisticMessageId,
      occurredAt:optimisticOccurredAt,
      optimisticRendered:true
    });

    if (result) result.textContent = persistence?.pending ? `Mensagem enviada em ${crmNowLabel()}. Sincronização com banco em segundo plano.` : `Mensagem enviada e salva em ${crmNowLabel()}.`;
    notify(persistence?.pending ? 'Mensagem enviada via Evolution. Salvando no banco...' : 'Mensagem enviada e salva.', persistence?.pending ? 'warn' : undefined);
  } catch (err) {
    if (typeof removeLocalOutgoingWhatsappMessageV426 === 'function') {
      removeLocalOutgoingWhatsappMessageV426(optimisticMessageId, activeLeadDrawerId);
    }
    try {
      addLeadHistory(activeLeadDrawerId, `WhatsApp: falha ao enviar mensagem (${err?.message || 'erro'})`, activeLeadDrawerData);
      renderLeadTimeline(activeLeadDrawerId);
    } catch(e) {}
    if (result) result.textContent = formatEvolutionErrorV41(err);
    notify(formatEvolutionErrorV41(err), 'err');
  }
}
