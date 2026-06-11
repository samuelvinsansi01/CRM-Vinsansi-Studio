/* ════════════════════════════
   EVOLUTION API V24
════════════════════════════ */
const EVOLUTION_SETTINGS_KEY = 'vs_evolution_settings_v1';

function getEvolutionSettings() {
  try {
    const settings = JSON.parse(localStorage.getItem(EVOLUTION_SETTINGS_KEY) || '{}');
    return settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {};
  } catch {
    return {};
  }
}

function saveEvolutionSettings() {
  const settings = {
    url: (document.getElementById('evoUrl')?.value || '').trim().replace(/\/$/, ''),
    instance: (document.getElementById('evoInstance')?.value || '').trim(),
    apiKey: (document.getElementById('evoApiKey')?.value || '').trim()
  };

  localStorage.setItem(EVOLUTION_SETTINGS_KEY, JSON.stringify(settings));
  renderEvolutionSettings();
  notify('Configuração da Evolution salva.');
}

function renderEvolutionSettings() {
  const settings = getEvolutionSettings();

  const url = document.getElementById('evoUrl');
  const instance = document.getElementById('evoInstance');
  const key = document.getElementById('evoApiKey');

  if (url) url.value = settings.url || '';
  if (instance) instance.value = settings.instance || '';
  if (key) key.value = settings.apiKey || '';

  updateEvolutionStatusCard('warn', 'Não testado', settings.url ? '// configuração carregada' : '// salve os dados da Evolution');
}

function updateEvolutionStatusCard(type, title, text) {
  const card = document.getElementById('evoStatusCard');
  if (!card) return;

  card.classList.remove('ok','err','warn');
  if (type) card.classList.add(type);

  card.innerHTML = `
    <div class="evo-status-icon">${type === 'ok' ? '✅' : type === 'err' ? '⚠️' : '⚡'}</div>
    <div>
      <div class="evo-status-title">${escHtml(title || 'Status')}</div>
      <div class="evo-status-text">${escHtml(text || '')}</div>
    </div>
  `;
}

function getEvolutionHeaders(settings) {
  const headers = { 'Content-Type': 'application/json' };
  if (settings.apiKey) headers.apikey = settings.apiKey;
  return headers;
}

async function testEvolutionConnection() {
  const settings = getEvolutionConfigForChipV405 ? getEvolutionConfigForChipV405() : getEvolutionSettings();

  if (!settings.url || !settings.instance || !settings.apiKey) {
    updateEvolutionStatusCard('err', 'Configuração incompleta', 'Preencha URL, instância e API Key.');
    notify('Preencha URL, instância e API Key.', 'warn');
    return;
  }

  updateEvolutionStatusCard('warn', 'Testando...', 'Consultando status da instância.');

  try {
    const endpoint = `${settings.url}/instance/connectionState/${encodeURIComponent(settings.instance)}`;
    const res = await fetch(endpoint, {
      method: 'GET',
      headers: (typeof getEvolutionHeadersV405 === 'function' ? getEvolutionHeadersV405(settings) : getEvolutionHeaders(settings))
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      updateEvolutionStatusCard('err', 'Falha na conexão', data?.message || `HTTP ${res.status}`);
      return;
    }

    const state = data?.instance?.state || data?.state || data?.status || 'conectado';
    updateEvolutionStatusCard('ok', 'Evolution respondendo', `Status: ${state}`);
    notify('Evolution conectada.');
  } catch (err) {
    updateEvolutionStatusCard('err', 'Erro ao conectar', err?.message || 'Falha desconhecida.');
  }
}

async function validateEvolutionNumber() {
  const settings = getEvolutionConfigForChipV405 ? getEvolutionConfigForChipV405() : getEvolutionSettings();
  const result = document.getElementById('evoTestResult');
  const number = (document.getElementById('evoNumberTest')?.value || '').replace(/\D/g,'');

  if (!settings.url || !settings.instance || !settings.apiKey) {
    if (result) result.textContent = 'Configure a Evolution primeiro.';
    return;
  }

  if (!number || number.length < 10) {
    if (result) result.textContent = 'Informe um número com DDI + DDD.';
    return;
  }

  if (result) result.textContent = 'Validando número...';

  try {
    const endpoint = `${settings.url}/chat/whatsappNumbers/${encodeURIComponent(settings.instance)}`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: (typeof getEvolutionHeadersV405 === 'function' ? getEvolutionHeadersV405(settings) : getEvolutionHeaders(settings)),
      body: JSON.stringify({ numbers: [number] })
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      if (result) result.textContent = `Erro: ${data?.message || 'falha na validação'}`;
      return;
    }

    const item = Array.isArray(data) ? data[0] : (data?.data?.[0] || data?.result?.[0] || data);
    const exists = item?.exists ?? item?.isWhatsapp ?? item?.jid ?? item?.numberExists;

    if (result) {
      result.textContent = exists
        ? `✅ Número válido no WhatsApp: ${number}`
        : `⚠️ Número não confirmado: ${number}`;
    }
  } catch (err) {
    if (result) result.textContent = `Erro: ${err?.message || 'falha desconhecida'}`;
  }
}

function renderEvolutionPanel() {
  renderEvolutionSettings();
  if (typeof renderWebhookUrlV34 === 'function') renderWebhookUrlV34();
}


/* ════════════════════════════
   EVOLUTION LEAD V25
════════════════════════════ */
function normalizePhoneForEvolution(phone) {
  return String(phone || '').replace(/\D/g, '');
}


function whatsappValidationLogV427(event, payload = {}) {
  try { console.log(`[lead-whatsapp][${event}]`, payload); } catch (_) {}
}

function parseWhatsappNumberCheckV427(data = {}) {
  const first = Array.isArray(data) ? data[0] : (data?.data?.[0] || data?.result?.[0] || data?.numbers?.[0] || data);
  const exists = !!(
    first?.exists === true ||
    first?.isWhatsapp === true ||
    first?.numberExists === true ||
    first?.exists === 'true' ||
    first?.isWhatsapp === 'true' ||
    first?.numberExists === 'true' ||
    first?.jid ||
    first?.waId ||
    first?.wa_id
  );
  return { item:first || {}, exists };
}

function applyWhatsappValidationToLeadV427(leadId, phone, status) {
  const patch = {
    whatsapp: phone,
    phone,
    telefone: phone,
    numStatus: status === 'valid' ? 'valido' : status === 'invalid' ? 'invalido' : 'pendente',
    whatsappValidationStatus: status
  };
  try {
    if (typeof updateLeadEverywhereV427 === 'function') updateLeadEverywhereV427(leadId, patch, { render:false });
  } catch (err) {
    whatsappValidationLogV427('lead-patch-error', { leadId, error: err?.message || err });
  }
  try {
    if (typeof syncLeadToCloud === 'function') syncLeadToCloud(leadId, { ...(activeLeadDrawerData || {}), ...patch, id:leadId });
  } catch (err) {
    whatsappValidationLogV427('lead-cloud-error', { leadId, error: err?.message || err });
  }
}

function getLeadWhatsappStatus(leadId) {
  const crm = ensureLeadCrm(leadId, {});
  return crm.whatsappValidation || {
    status: 'pending',
    label: 'Não validado',
    checkedAt: '',
    checkedAtLabel: '',
    number: ''
  };
}

function setLeadWhatsappStatus(leadId, data = {}) {
  const crm = ensureLeadCrm(leadId, activeLeadDrawerData || {});
  crm.whatsappValidation = {
    ...(crm.whatsappValidation || {}),
    ...data,
    checkedAt: new Date().toISOString(),
    checkedAtLabel: crmNowLabel()
  };
  saveLeadCrm(leadId, crm);
  if (leadId === activeLeadDrawerId) {
    if (data.status === 'valid' && activeLeadDrawerData) {
      activeLeadDrawerData.numStatus = 'valido';
      activeLeadDrawerData.whatsappValidationStatus = 'valid';
    }
    try { renderLeadWhatsappValidation(); } catch(e) {}
    try { renderLeadMessageBox(); } catch(e) {}
  }
}

function isLeadWhatsappValidatedForQueue(lead = {}) {
  const phone = normalizePhoneForEvolution(lead.whatsapp || lead.phone || lead.telefone || '');
  if (!phone || phone.length < 10) return false;
  if (lead.numStatus === 'valido' || lead.whatsappValidationStatus === 'valid') return true;
  if (!lead.id) return false;

  const status = getLeadWhatsappStatus(lead.id);
  const checkedPhone = normalizePhoneForEvolution(status.number || '');
  return status.status === 'valid' && (!checkedPhone || checkedPhone === phone);
}

function markLeadWhatsappValidatedForQueue(lead = {}) {
  const phone = normalizePhoneForEvolution(lead.whatsapp || lead.phone || lead.telefone || '');
  if (!lead.id || !phone) return lead;
  lead.numStatus = 'valido';
  lead.whatsappValidationStatus = 'valid';
  setLeadWhatsappStatus(lead.id, {
    status: 'valid',
    label: 'WhatsApp válido',
    number: phone
  });
  return lead;
}


function ensureLeadWhatsappValidationContainer() {
  if (document.getElementById('leadWhatsappValidationBox')) return true;

  const drawer = document.getElementById('leadDrawer');
  if (!drawer) return false;

  const target =
    document.getElementById('leadPresentationsList') ||
    document.getElementById('leadTimelineList') ||
    document.getElementById('leadNotesList') ||
    document.getElementById('leadHistoryList');

  const block = document.createElement('div');
  block.id = 'leadWhatsappValidationBox';

  if (target && target.parentElement) {
    target.parentElement.insertAdjacentElement('beforebegin', block);
  } else {
    drawer.appendChild(block);
  }

  return true;
}

function renderLeadWhatsappValidation() {
  ensureLeadWhatsappValidationContainer();
  const box = document.getElementById('leadWhatsappValidationBox');
  if (!box || !activeLeadDrawerId) return;

  const lead = activeLeadDrawerData || {};
  const phone = normalizePhoneForEvolution(lead.whatsapp || lead.phone || lead.telefone || '');
  const status = getLeadWhatsappStatus(activeLeadDrawerId);

  const statusClass = status.status === 'valid' ? 'valid' : status.status === 'invalid' ? 'invalid' : 'pending';
  const label = status.label || (status.status === 'valid' ? 'WhatsApp válido' : status.status === 'invalid' ? 'Número inválido' : 'Não validado');

  box.innerHTML = `
    <div class="lead-wa-block">
      <div class="lead-wa-top">
        <div class="lead-wa-title">WhatsApp</div>
        <span class="lead-wa-status ${statusClass}">${escHtml(label)}</span>
      </div>
      <div class="lead-wa-meta">
        Número: ${escHtml(phone || 'sem telefone')}<br>
        Última validação: ${escHtml(status.checkedAtLabel || 'nunca')}
      </div>
      <div class="lead-wa-actions">
        <button class="btn btn-primary" style="font-size:10px;padding:7px 12px" onclick="validateActiveLeadWhatsapp()">Validar WhatsApp</button>
        ${phone ? `<a class="btn btn-ghost" style="font-size:10px;padding:7px 12px;text-decoration:none" target="_blank" rel="noopener" href="https://wa.me/${escHtml(phone)}">Abrir conversa</a>` : ''}
      </div>
    </div>
  `;
}

async function validateActiveLeadWhatsapp() {
  if (!activeLeadDrawerId || !activeLeadDrawerData) return;
  whatsappValidationLogV427('start', { leadId:activeLeadDrawerId, lead:activeLeadDrawerData });

  const settings = getEvolutionConfigForChipV405 ? getEvolutionConfigForChipV405() : (getEvolutionSettings ? getEvolutionSettings() : {});
  const phone = normalizePhoneForEvolution(activeLeadDrawerData.whatsapp || activeLeadDrawerData.phone || activeLeadDrawerData.telefone || '');
  whatsappValidationLogV427('phone', { leadId:activeLeadDrawerId, phone });

  if (!phone || phone.length < 10) {
    setLeadWhatsappStatus(activeLeadDrawerId, {
      status: 'invalid',
      label: 'Telefone ausente/inválido',
      number: phone
    });
    addLeadHistory(activeLeadDrawerId, 'WhatsApp: telefone ausente ou inválido', activeLeadDrawerData);
    renderLeadWhatsappValidation();
    if (typeof renderLeadTimeline === 'function') renderLeadTimeline(activeLeadDrawerId);
    notify('Telefone inválido.', 'warn');
    return;
  }

  if (!settings.url || !settings.instance || !settings.apiKey) {
    notify('Configure a Evolution API antes de validar.', 'warn');
    return;
  }

  setLeadWhatsappStatus(activeLeadDrawerId, {
    status: 'pending',
    label: 'Validando...',
    number: phone
  });
  renderLeadWhatsappValidation();

  try {
    const endpoint = `${settings.url}/chat/whatsappNumbers/${encodeURIComponent(settings.instance)}`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: (typeof getEvolutionHeadersV405 === 'function' ? getEvolutionHeadersV405(settings) : getEvolutionHeaders(settings)),
      body: JSON.stringify({ numbers: [phone] })
    });

    const data = await res.json().catch(() => ({}));
    const parsed = parseWhatsappNumberCheckV427(data);
    const item = parsed.item;
    const exists = parsed.exists;
    whatsappValidationLogV427('response', { leadId:activeLeadDrawerId, phone, httpStatus:res.status, exists, data });

    if (!res.ok) {
      setLeadWhatsappStatus(activeLeadDrawerId, {
        status: 'invalid',
        label: 'Erro na validação',
        number: phone,
        raw: data
      });
      addLeadHistory(activeLeadDrawerId, `WhatsApp: erro na validação (${res.status})`, activeLeadDrawerData);
      notify('Erro ao validar WhatsApp.', 'err');
    } else if (exists) {
      setLeadWhatsappStatus(activeLeadDrawerId, {
        status: 'valid',
        label: 'WhatsApp válido',
        number: phone,
        raw: item
      });
      applyWhatsappValidationToLeadV427(activeLeadDrawerId, phone, 'valid');
      addLeadHistory(activeLeadDrawerId, `WhatsApp validado: ${phone}`, activeLeadDrawerData);
      notify('WhatsApp válido.');
    } else {
      setLeadWhatsappStatus(activeLeadDrawerId, {
        status: 'invalid',
        label: 'WhatsApp não confirmado',
        number: phone,
        raw: item
      });
      applyWhatsappValidationToLeadV427(activeLeadDrawerId, phone, 'invalid');
      addLeadHistory(activeLeadDrawerId, `WhatsApp não confirmado: ${phone}`, activeLeadDrawerData);
      notify('WhatsApp não confirmado.', 'warn');
    }
  } catch (err) {
    setLeadWhatsappStatus(activeLeadDrawerId, {
      status: 'invalid',
      label: 'Falha na conexão',
      number: phone,
      error: err?.message || 'erro desconhecido'
    });
    addLeadHistory(activeLeadDrawerId, `WhatsApp: falha na conexão (${err?.message || 'erro'})`, activeLeadDrawerData);
    notify('Falha ao conectar na Evolution.', 'err');
  }

  renderLeadWhatsappValidation();
  if (typeof renderLeadTimeline === 'function') renderLeadTimeline(activeLeadDrawerId);
  if (typeof renderKanban === 'function') renderKanban();
}

function getWhatsappMiniBadge(leadId) {
  const status = getLeadWhatsappStatus(leadId);
  const cls = status.status === 'valid' ? 'valid' : status.status === 'invalid' ? 'invalid' : 'pending';
  const label = status.status === 'valid' ? 'WA válido' : status.status === 'invalid' ? 'WA inválido' : 'WA pendente';
  return `<span class="wa-mini-badge ${cls}">${label}</span>`;
}


/* ════════════════════════════
   EVOLUTION SEND V26
════════════════════════════ */
function buildLeadMessageTemplate(type = 'primeiro_contato') {
  const lead = activeLeadDrawerData || {};
  const nome = lead.nome || lead.companyName || 'tudo bem';

  const templates = {
    primeiro_contato:
`Olá, tudo bem?

Vi a empresa ${nome} e acredito que posso te ajudar com uma presença digital mais profissional.

Posso te enviar uma apresentação rápida?`,

    followup:
`Olá, tudo bem?

Passando para retomar nosso contato sobre a apresentação que te enviei.

Conseguiu dar uma olhada?`,

    apresentacao:
`Olá, tudo bem?

Preparei uma apresentação rápida para mostrar uma possibilidade para a ${nome}.

Segue o link:
[COLE_O_LINK_AQUI]`
  };

  return templates[type] || templates.primeiro_contato;
}

function ensureLeadMessageContainer() {
  const drawer = document.getElementById('leadDrawer');
  if (!drawer) return false;

  const body = drawer.querySelector('.lead-drawer-body');
  const target = document.getElementById('leadWhatsappValidationBox') ||
    document.getElementById('leadPresentationsList') ||
    document.getElementById('leadTimelineList') ||
    document.getElementById('leadNotesList');
  const existing = document.getElementById('leadMessageBox');

  if (existing) {
    if (target) target.insertAdjacentElement('afterend', existing);
    else if (body) body.appendChild(existing);
    return true;
  }

  const block = document.createElement('div');
  block.id = 'leadMessageBox';

  if (target) {
    target.insertAdjacentElement('afterend', block);
  } else if (body) {
    body.appendChild(block);
  } else {
    drawer.appendChild(block);
  }

  return true;
}

function renderLeadMessageBox() {
  ensureLeadMessageContainer();

  const box = document.getElementById('leadMessageBox');
  if (!box || !activeLeadDrawerId) return;

  const lead = activeLeadDrawerData || {};
  const phone = normalizePhoneForEvolution(lead.whatsapp || lead.phone || lead.telefone || '');
  const waStatus = getLeadWhatsappStatus(activeLeadDrawerId);

  box.innerHTML = `
    <div class="lead-message-block">
      <div class="lead-message-title">Enviar mensagem</div>

      <div class="lead-message-template">
        <select id="leadMessageTemplate" onchange="applyLeadMessageTemplate()">
          <option value="primeiro_contato">Primeiro contato</option>
          <option value="followup">Follow-up</option>
          <option value="apresentacao">Apresentação</option>
        </select>
        <button class="btn btn-ghost" style="font-size:10px;padding:7px 12px" onclick="applyLeadMessageTemplate()">Usar modelo</button>
      </div>

      <textarea id="leadMessageText" placeholder="Digite a mensagem para enviar no WhatsApp...">${escHtml(buildLeadMessageTemplate('primeiro_contato'))}</textarea>

      <div class="lead-message-actions">
        <button class="btn btn-primary" style="font-size:10px;padding:7px 12px" onclick="sendActiveLeadWhatsappMessage()">Enviar pela Evolution</button>
        ${phone ? `<a class="btn btn-ghost" style="font-size:10px;padding:7px 12px;text-decoration:none" target="_blank" rel="noopener" href="https://wa.me/${escHtml(phone)}?text=${encodeURIComponent(buildLeadMessageTemplate('primeiro_contato'))}">Abrir no WhatsApp</a>` : ''}
      </div>

      <div class="lead-message-result" id="leadMessageResult">
        ${phone ? `Número: ${escHtml(phone)} · Status: ${escHtml(waStatus.label || 'Não validado')}` : 'Lead sem telefone.'}
      </div>
    </div>
  `;
}

function applyLeadMessageTemplate() {
  const select = document.getElementById('leadMessageTemplate');
  const text = document.getElementById('leadMessageText');
  if (!text) return;

  text.value = buildLeadMessageTemplate(select?.value || 'primeiro_contato');
}

async function sendActiveLeadWhatsappMessage() {
  if (!activeLeadDrawerId || !activeLeadDrawerData) return;

  const settings = getEvolutionSettings ? getEvolutionSettings() : {};
  const result = document.getElementById('leadMessageResult');
  const text = (document.getElementById('leadMessageText')?.value || '').trim();
  const phone = normalizePhoneForEvolution(activeLeadDrawerData.whatsapp || activeLeadDrawerData.phone || activeLeadDrawerData.telefone || '');

  if (!settings.url || !settings.instance || !settings.apiKey) {
    notify('Configure a Evolution API antes de enviar.', 'warn');
    if (result) result.textContent = 'Configuração da Evolution incompleta.';
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
    const endpoint = `${settings.url}/message/sendText/${encodeURIComponent(settings.instance)}`;

    const payload = {
      number: phone,
      text
    };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: (typeof getEvolutionHeadersV405 === 'function' ? getEvolutionHeadersV405(settings) : getEvolutionHeaders(settings)),
      body: JSON.stringify(payload)
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
      response: data
    };
    saveLeadCrm(activeLeadDrawerId, crm);

    addLeadHistory(activeLeadDrawerId, `Mensagem enviada via WhatsApp para ${phone}`, activeLeadDrawerData);

    if (result) result.textContent = `Mensagem enviada em ${crmNowLabel()}.`;
    if (typeof renderLeadTimeline === 'function') renderLeadTimeline(activeLeadDrawerId);

    notify('Mensagem enviada via Evolution.');
  } catch (err) {
    addLeadHistory(activeLeadDrawerId, `WhatsApp: falha ao enviar mensagem (${err?.message || 'erro'})`, activeLeadDrawerData);
    if (result) result.textContent = formatEvolutionErrorV41(err);
    if (typeof renderLeadTimeline === 'function') renderLeadTimeline(activeLeadDrawerId);
    notify('Falha ao conectar na Evolution.', 'err');
  }
}



/* ════════════════════════════
   EVOLUTION LID DEBUG V14
   Diagnóstico seguro: não altera dados, só tenta descobrir se a Evolution
   expõe telefone real para um @lid via endpoints disponíveis.
════════════════════════════ */
function normalizeEvolutionLidV14(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.includes('@')) return raw;
  return `${raw.replace(/\D/g, '')}@lid`;
}

function getEvolutionDebugSettingsV14() {
  const settings = (typeof getEvolutionConfigForChipV405 === 'function')
    ? getEvolutionConfigForChipV405()
    : getEvolutionSettings();
  return {
    url: String(settings?.url || '').replace(/\/$/, ''),
    instance: String(settings?.instance || '').trim(),
    apiKey: String(settings?.apiKey || '').trim()
  };
}

async function fetchEvolutionDebugEndpointV14(label, url, options = {}) {
  const startedAt = Date.now();
  try {
    const res = await fetch(url, options);
    const text = await res.text();
    let data = text;
    try { data = JSON.parse(text); } catch {}
    return {
      label,
      ok: res.ok,
      status: res.status,
      elapsedMs: Date.now() - startedAt,
      url,
      data
    };
  } catch (error) {
    return {
      label,
      ok: false,
      status: 0,
      elapsedMs: Date.now() - startedAt,
      url,
      error: error?.message || String(error)
    };
  }
}

function findPossiblePhonesInObjectV14(value) {
  const found = new Set();
  const visit = (node) => {
    if (node == null) return;
    if (typeof node === 'string' || typeof node === 'number') {
      const str = String(node);
      const matches = str.match(/55\d{10,13}/g) || [];
      matches.forEach((m) => found.add(m));
      return;
    }
    if (Array.isArray(node)) {
      node.slice(0, 5000).forEach(visit);
      return;
    }
    if (typeof node === 'object') {
      Object.values(node).slice(0, 5000).forEach(visit);
    }
  };
  visit(value);
  return Array.from(found);
}

async function debugEvolutionLidV14(lidValue) {
  const settings = getEvolutionDebugSettingsV14();
  const jid = normalizeEvolutionLidV14(lidValue);
  const lidDigits = String(jid).split('@')[0].replace(/\D/g, '');

  if (!settings.url || !settings.instance || !settings.apiKey) {
    console.warn('[evolution][lid-debug] Configuração Evolution incompleta.', settings);
    return { ok: false, error: 'Configuração Evolution incompleta.', settings };
  }
  if (!jid || !lidDigits) {
    console.warn('[evolution][lid-debug] Informe um @lid válido.');
    return { ok: false, error: 'Informe um @lid válido.' };
  }

  const headers = (typeof getEvolutionHeadersV405 === 'function')
    ? getEvolutionHeadersV405(settings)
    : getEvolutionHeaders(settings);

  const encodedJid = encodeURIComponent(jid);
  const encodedInstance = encodeURIComponent(settings.instance);

  const attempts = [
    {
      label: 'contact/profile/jid',
      url: `${settings.url}/contact/profile/${encodedJid}`,
      options: { method: 'GET', headers }
    },
    {
      label: 'contact/profile/instance/jid',
      url: `${settings.url}/contact/profile/${encodedInstance}/${encodedJid}`,
      options: { method: 'GET', headers }
    },
    {
      label: 'chat/whatsappNumbers/lidDigits',
      url: `${settings.url}/chat/whatsappNumbers/${encodedInstance}`,
      options: { method: 'POST', headers, body: JSON.stringify({ numbers: [lidDigits] }) }
    },
    {
      label: 'contacts/fetchContacts/instance',
      url: `${settings.url}/contacts/fetchContacts/${encodedInstance}`,
      options: { method: 'GET', headers }
    },
    {
      label: 'contacts/fetchContacts',
      url: `${settings.url}/contacts/fetchContacts` + `?instance=${encodedInstance}`,
      options: { method: 'GET', headers }
    }
  ];

  console.group('[evolution][lid-debug] resolver LID');
  console.log('input:', lidValue);
  console.log('jid:', jid);
  console.log('settings:', { url: settings.url, instance: settings.instance, hasApiKey: Boolean(settings.apiKey) });

  const results = [];
  for (const attempt of attempts) {
    const result = await fetchEvolutionDebugEndpointV14(attempt.label, attempt.url, attempt.options);
    result.possiblePhones = findPossiblePhonesInObjectV14(result.data);
    results.push(result);
    console.log(result.label, {
      ok: result.ok,
      status: result.status,
      elapsedMs: result.elapsedMs,
      possiblePhones: result.possiblePhones,
      data: result.data,
      error: result.error
    });
  }
  console.groupEnd();

  return { ok: true, jid, lidDigits, results };
}

window.debugEvolutionLidV14 = debugEvolutionLidV14;
