/* ════════════════════════════
   CONVERSAS V38
════════════════════════════ */
let activeConversationLeadV38 = null;

function getAllConversationLeadsV38() {
  const crm = getLeadCrmStore ? getLeadCrmStore() : {};
  const queue = getWhatsappQueueV27 ? getWhatsappQueueV27() : [];
  const responses = getLocalResponsesV34 ? getLocalResponsesV34() : [];
  const map = new Map();

  Object.entries(crm || {}).forEach(([leadId, data]) => {
    const hasMessages = Array.isArray(data.messages) && data.messages.length;
    const hasResponse = !!data.lastResponseAt || data.pipelineStatus === 'respondeu';
    if (hasMessages || hasResponse) {
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
    if (crmData.messages?.length || crmData.lastWhatsappMessage || item.sentAt) {
      map.set(item.leadId, { leadId: item.leadId, lead, crm: crmData });
    }
  });

  return Array.from(map.values()).sort((a,b) => {
    const ad = a.crm.lastResponseAt || a.crm.lastWhatsappMessage?.sentAt || '';
    const bd = b.crm.lastResponseAt || b.crm.lastWhatsappMessage?.sentAt || '';
    return String(bd).localeCompare(String(ad));
  });
}

function getConversationMessagesV38(leadId) {
  const crm = ensureLeadCrm(leadId, findLeadEverywhere(leadId) || {});
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

  if (crm.lastWhatsappMessage) {
    messages.push({
      id: 'last_' + leadId,
      direction: 'out',
      text: crm.lastWhatsappMessage.text || '',
      at: crm.lastWhatsappMessage.sentAt || '',
      atLabel: crm.lastWhatsappMessage.sentAtLabel || '',
      chipName: crm.lastWhatsappMessage.chipName || ''
    });
  }

  (crm.messages || []).forEach(msg => messages.push(msg));

  const unique = new Map();
  messages.forEach(m => {
    const key = m.id || `${m.direction}_${m.at}_${m.text}`;
    unique.set(key, m);
  });

  return Array.from(unique.values()).sort((a,b) => String(a.at || '').localeCompare(String(b.at || '')));
}

function formatConversationListDateV38(value = '') {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / 86400000);
  if (diffDays === 0) return date.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' });
  if (diffDays === 1) return 'Ontem';
  if (diffDays > 1 && diffDays < 7) return date.toLocaleDateString('pt-BR', { weekday:'long' });
  return date.toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit' });
}

function renderConversationListV38() {
  const box = document.getElementById('conversationListV38');
  if (!box) return;

  const items = getAllConversationLeadsV38();

  if (!items.length) {
    box.innerHTML = '<div class="conversation-empty-v38">// nenhuma conversa ainda</div>';
    updateConversationsBadgeV38();
    return;
  }

  if (!activeConversationLeadV38) activeConversationLeadV38 = items[0].leadId;

  box.innerHTML = items.map(item => {
    const messages = getConversationMessagesV38(item.leadId);
    const last = messages[messages.length - 1];
    const active = item.leadId === activeConversationLeadV38 ? 'active' : '';
    const title = item.lead.nome || item.lead.name || 'Lead';
    const preview = (last?.text || 'Sem mensagens').replace(/\s+/g, ' ').trim();
    const dateLabel = formatConversationListDateV38(last?.at || item.lastAt || '');
    return `
      <div class="conversation-item-v38 ${active}" onclick="openConversationV38('${escHtml(item.leadId)}')">
        <div class="conversation-item-v38-main">
          <div class="conversation-item-v38-top">
            <div class="conversation-item-v38-title">${escHtml(title)}</div>
            <div class="conversation-item-v38-date">${escHtml(dateLabel)}</div>
          </div>
          <div class="conversation-item-v38-preview">${escHtml(preview)}</div>
        </div>
      </div>
    `;
  }).join('');

  updateConversationsBadgeV38();
}

function openConversationV38(leadId) {
  activeConversationLeadV38 = leadId;
  renderConversationsV38();
}

function renderConversationChatV38() {
  const box = document.getElementById('conversationChatV38');
  if (!box) return;

  if (!activeConversationLeadV38) {
    box.innerHTML = '<div class="conversation-empty-v38">// selecione uma conversa</div>';
    return;
  }

  const lead = findLeadEverywhere(activeConversationLeadV38) || { nome:'Lead' };
  const messages = getConversationMessagesV38(activeConversationLeadV38);
  const phone = normalizePhoneForEvolution(lead.whatsapp || lead.phone || lead.telefone || '');

  box.innerHTML = `
    <div class="conversation-chat-header-v38">
      <div class="conversation-chat-title-v38">${escHtml(lead.nome || lead.name || 'Lead')}</div>
      <div class="conversation-chat-meta-v38">${escHtml(phone || 'sem telefone')}</div>
    </div>

    <div class="conversation-messages-v38">
      ${messages.length ? messages.map(msg => `
        <div class="message-bubble-v38 ${msg.direction === 'out' ? 'out' : 'in'}">
          ${escHtml(msg.text || '[mensagem sem texto]')}
          <div class="message-time-v38">${escHtml(msg.atLabel || (msg.at ? new Date(msg.at).toLocaleString('pt-BR') : ''))}${msg.chipName ? ' · ' + escHtml(msg.chipName) : ''}</div>
        </div>
      `).join('') : '<div class="conversation-empty-v38">// sem mensagens registradas</div>'}
    </div>

    <div class="conversation-reply-v38">
      <textarea id="conversationReplyTextV38" placeholder="Responder este lead..."></textarea>
      <button class="btn btn-primary" onclick="sendConversationReplyV38()">Responder</button>
    </div>
  `;
}

async function sendConversationReplyV38() {
  if (!activeConversationLeadV38) return;

  const lead = findLeadEverywhere(activeConversationLeadV38) || {};
  const text = (document.getElementById('conversationReplyTextV38')?.value || '').trim();
  const phone = normalizePhoneForEvolution(lead.whatsapp || lead.phone || lead.telefone || '');
  const settings = getEvolutionSettings ? getEvolutionSettings() : {};

  if (!text) {
    notify('Digite uma resposta.', 'warn');
    return;
  }

  if (!phone) {
    notify('Lead sem telefone.', 'warn');
    return;
  }

  if (!settings.url || !settings.apiKey) {
    notify('Configure a Evolution antes de responder.', 'warn');
    return;
  }

  const queue = getWhatsappQueueV27 ? getWhatsappQueueV27() : [];
  const lastSent = queue.filter(item => item.leadId === activeConversationLeadV38 && item.chipInstance).slice(-1)[0];
  const instance = lastSent?.chipInstance || settings.instance;

  if (!instance) {
    notify('Instância não encontrada para resposta.', 'warn');
    return;
  }

  try {
    const endpoint = `${settings.url}/message/sendText/${encodeURIComponent(instance)}`;
    const res = await fetch(endpoint, {
      method:'POST',
      headers:(typeof getEvolutionHeadersV405 === 'function' ? getEvolutionHeadersV405(settings) : getEvolutionHeaders(settings)),
      body:JSON.stringify({ number: phone, textMessage: { text } })
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) throw new Error(data?.message || data?.error || `HTTP ${res.status}`);

    const crm = ensureLeadCrm(activeConversationLeadV38, lead);
    crm.messages = Array.isArray(crm.messages) ? crm.messages : [];
    crm.messages.push({
      id:'reply_' + Date.now(),
      direction:'out',
      text,
      phone,
      at:new Date().toISOString(),
      atLabel:crmNowLabel(),
      chipName:lastSent?.chipName || instance,
      response:data
    });
    saveLeadCrm(activeConversationLeadV38, crm);
    addLeadHistory(activeConversationLeadV38, `Resposta enviada pela Central de Conversas`, lead);

    renderConversationsV38();
    notify('Resposta enviada.');
  } catch (err) {
    notify('Erro ao responder: ' + (err?.message || 'falha'), 'err');
  }
}

function renderConversationsV38() {
  renderConversationListV38();
  renderConversationChatV38();
}

function updateConversationsBadgeV38() {
  const badge = document.getElementById('badge-conversations');
  if (!badge) return;
  badge.textContent = getAllConversationLeadsV38().length;
}


/* ════════════════════════════
   EVOLUTION CHIP MODEL V40.5
   Compatível com sistema antigo: chip.url + chip.instance + chip.key
════════════════════════════ */
function normalizeEvolutionBaseUrlV405(url = '') {
  return String(url || '').trim().replace(/\/$/, '');
}

function getPrimaryEvolutionChipV405() {
  const chips = typeof getWhatsappChipsV29 === 'function' ? getWhatsappChipsV29() : [];
  return chips.find(chip => chip.status !== 'disabled' && !chip.paused) || chips[0] || null;
}

function getEvolutionConfigForChipV405(chip = null) {
  const global = typeof getEvolutionSettings === 'function' ? getEvolutionSettings() : {};
  const selected = chip || getPrimaryEvolutionChipV405() || {};

  return {
    url: normalizeEvolutionBaseUrlV405(selected.url || selected.baseUrl || selected.evolutionUrl || global.url || ''),
    instance: selected.instance || selected.instanceName || selected.chipInstance || global.instance || '',
    apiKey: selected.key || selected.apiKey || selected.apikey || global.apiKey || '',
    chip: selected
  };
}

function getEvolutionHeadersV405(config = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const key = config.apiKey || config.key || config.apikey || '';
  if (key) headers.apikey = key;
  return headers;
}

function isValidEvolutionConfigV405(config = {}) {
  return !!(config.url && config.instance && config.apiKey);
}


/* ════════════════════════════
   EVOLUTION ROTAS CORRIGIDAS V40.6
   Rotas validadas:
   GET /instance/connectionState/:instance
   POST /chat/whatsappNumbers/:instance
════════════════════════════ */
function getChipFormValuesV406() {
  const pick = (ids, selector) => {
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el && String(el.value || '').trim()) return String(el.value || '').trim();
    }
    if (selector) {
      const el = document.querySelector(selector);
      if (el && String(el.value || '').trim()) return String(el.value || '').trim();
    }
    return '';
  };

  return {
    name: pick(['chipName'], 'input[placeholder*="Nome"]'),
    url: normalizeEvolutionBaseUrlV405(pick(['chipUrl', 'evoUrl'], 'input[placeholder*="URL"]')),
    instance: pick(['chipInstance', 'evoInstance'], 'input[placeholder*="Instância"],input[placeholder*="Instance"]'),
    key: pick(['chipApiKey', 'evoApiKey', 'evoKey'], 'input[placeholder*="API Key"],input[placeholder*="api key"]'),
    dailyLimit: Number(document.getElementById('chipDailyLimit')?.value || WHATSAPP_CHIP_DAILY_LIMIT_V426),
    blockSize: Number(document.getElementById('chipBlockSize')?.value || WHATSAPP_CHIP_BLOCK_SIZE_V426),
    intervalSeconds: Number(document.getElementById('chipInterval')?.value || WHATSAPP_CHIP_INTERVAL_SECONDS_V426),
    blocks: (document.getElementById('chipBlocks')?.value || WHATSAPP_CHIP_BLOCKS_V426.join(',')).split(',').map(v => v.trim()).filter(Boolean)
  };
}

async function testEvolutionChipConnectionV406(chipLike = null) {
  const chip = chipLike || getChipFormValuesV406();
  const cfg = {
    url: normalizeEvolutionBaseUrlV405(chip.url || chip.baseUrl || chip.evolutionUrl || ''),
    instance: chip.instance || chip.instanceName || '',
    apiKey: chip.key || chip.apiKey || chip.apikey || ''
  };

  if (!cfg.url || !cfg.instance || !cfg.apiKey) {
    notify('Preencha URL, instância e API Key.', 'warn');
    return { ok:false, error:'Campos obrigatórios ausentes' };
  }

  const endpoint = `${cfg.url}/instance/connectionState/${encodeURIComponent(cfg.instance)}`;

  try {
    const res = await fetch(endpoint, {
      method: 'GET',
      headers: { apikey: cfg.apiKey }
    });

    const data = await res.json().catch(() => ({}));
    const state = data?.instance?.state || data?.state || '';

    if (!res.ok) return { ok:false, error:`HTTP ${res.status}`, data };

    return {
      ok: state === 'open' || state === 'connected' || !!state,
      state,
      data
    };
  } catch (err) {
    return { ok:false, error:err?.message || 'Falha ao conectar' };
  }
}

async function saveChipWithConnectionTestV406() {
  const form = getChipFormValuesV406();

  if (!form.name || !form.url || !form.instance || !form.key) {
    notify('Preencha nome, URL, instância e API Key do chip.', 'warn');
    return;
  }

  const test = await testEvolutionChipConnectionV406(form);

  if (!test.ok) {
    notify('Não foi possível conectar este chip: ' + (test.error || 'erro'), 'warn');
    console.warn('[Evolution chip test]', test);
    return;
  }

  const chips = getWhatsappChipsV29();
  const existing = chips.find(chip => chip.id === form.name || chip.name === form.name || chip.instance === form.instance);

  const payload = {
    id: existing?.id || 'chip_' + Date.now(),
    name: form.name,
    url: form.url,
    instance: form.instance,
    key: form.key,
    apiKey: form.key,
    dailyLimit: form.dailyLimit,
    blockSize: form.blockSize,
    intervalSeconds: form.intervalSeconds,
    blocks: form.blocks,
    status: 'active',
    paused: false,
    connectionState: test.state || 'open',
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  if (existing) Object.assign(existing, payload);
  else chips.push(payload);

  saveWhatsappChipsV29(chips);
  if (typeof renderChipsPanel === 'function') renderChipsPanel();
  notify(`Chip salvo e conectado: ${test.state || 'open'}`);
}

async function validateNumberByChipV406(number, chipLike = null) {
  const chip = chipLike || getPrimaryEvolutionChipV405();
  const cfg = getEvolutionConfigForChipV405(chip);

  const phone = String(number || '').replace(/\D/g, '');

  if (!phone || phone.length < 10) {
    return { ok:false, error:'Número inválido' };
  }

  if (!cfg.url || !cfg.instance || !cfg.apiKey) {
    return { ok:false, error:'Chip/Evolution incompleto' };
  }

  const endpoint = `${cfg.url}/chat/whatsappNumbers/${encodeURIComponent(cfg.instance)}`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      apikey: cfg.apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ numbers: [phone] })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok:false, error:`HTTP ${res.status}`, data };

  const item = Array.isArray(data) ? data[0] : (data?.data?.[0] || data?.result?.[0] || data);
  return {
    ok:true,
    exists: !!item?.exists,
    item,
    data
  };
}
