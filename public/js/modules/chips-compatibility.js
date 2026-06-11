/* Override seguro V40.6 */
async function validateEvolutionNumber() {
  const result = document.getElementById('evoTestResult');
  const number = (document.getElementById('evoNumberTest')?.value || '').replace(/\D/g,'');

  if (result) result.textContent = 'Validando número...';

  try {
    const r = await validateNumberByChipV406(number);
    if (!r.ok) {
      if (result) result.textContent = `Erro: ${r.error}`;
      notify('Erro ao validar número.', 'warn');
      return;
    }

    if (result) {
      result.textContent = r.exists
        ? `✅ Número existe no WhatsApp: ${number}`
        : `⚠️ Número não confirmado: ${number}`;
    }
  } catch(err) {
    if (result) result.textContent = `Erro: ${err?.message || 'falha desconhecida'}`;
  }
}


/* ════════════════════════════
   CHIP DEBUG + FIX V40.7
════════════════════════════ */
function setChipDebugV407(text, type='') {
  const el = document.getElementById('chipDebugV407');
  if (!el) return;
  el.classList.remove('ok','err');
  if (type) el.classList.add(type);
  el.textContent = text;
}

function getChipFormValuesV407() {
  const byId = id => document.getElementById(id);
  const findInput = terms => {
    const inputs = Array.from(document.querySelectorAll('input'));
    return inputs.find(input => {
      const hay = `${input.id||''} ${input.name||''} ${input.placeholder||''}`.toLowerCase();
      return terms.some(t => hay.includes(t));
    });
  };

  const nameEl = byId('chipName') || findInput(['nome do chip','nome']);
  const urlEl = byId('chipUrl') || byId('evoUrl') || findInput(['url da evolution','url evolution','url']);
  const instanceEl = byId('chipInstance') || byId('evoInstance') || findInput(['instância','instancia','instance']);
  const keyEl = byId('chipApiKey') || byId('evoApiKey') || byId('evoKey') || findInput(['api key','apikey','chave']);

  return {
    name: String(nameEl?.value || '').trim(),
    url: String(urlEl?.value || '').trim().replace(/\/$/, ''),
    instance: String(instanceEl?.value || '').trim(),
    key: String(keyEl?.value || '').trim(),
    dailyLimit: Number(document.getElementById('chipDailyLimit')?.value || WHATSAPP_CHIP_DAILY_LIMIT_V426),
    blockSize: Number(document.getElementById('chipBlockSize')?.value || WHATSAPP_CHIP_BLOCK_SIZE_V426),
    intervalSeconds: Number(document.getElementById('chipInterval')?.value || WHATSAPP_CHIP_INTERVAL_SECONDS_V426),
    blocks: (document.getElementById('chipBlocks')?.value || WHATSAPP_CHIP_BLOCKS_V426.join(',')).split(',').map(v=>v.trim()).filter(Boolean),
    found: {
      name: !!nameEl,
      url: !!urlEl,
      instance: !!instanceEl,
      key: !!keyEl
    }
  };
}

async function testEvolutionChipConnectionV407(form=null) {
  const f = form || getChipFormValuesV407();

  const missing = [];
  if (!f.name) missing.push('nome');
  if (!f.url) missing.push('url');
  if (!f.instance) missing.push('instância');
  if (!f.key) missing.push('api key');

  if (missing.length) {
    const msg = `Campos ausentes: ${missing.join(', ')}\nEncontrados no DOM: ${JSON.stringify(f.found)}\nValores lidos:\nURL=${f.url}\nInstância=${f.instance}\nNome=${f.name}\nAPI Key=${f.key ? 'preenchida' : 'vazia'}`;
    setChipDebugV407(msg, 'err');
    notify('Preencha todos os campos obrigatórios.', 'warn');
    return { ok:false, error:msg };
  }

  const endpoint = `${f.url}/instance/connectionState/${encodeURIComponent(f.instance)}`;
  setChipDebugV407(`Testando conexão...\nGET ${endpoint}\nHeader apikey: ${f.key ? 'preenchido' : 'vazio'}`);

  try {
    const res = await fetch(endpoint, {
      method:'GET',
      headers:{ apikey:f.key }
    });
    const text = await res.text();
    let data = {};
    try { data = JSON.parse(text); } catch { data = { raw:text }; }

    const state = data?.instance?.state || data?.state || '';

    if (!res.ok) {
      const msg = `Falha HTTP ${res.status}\n${text}`;
      setChipDebugV407(msg, 'err');
      return { ok:false, error:msg, data };
    }

    const ok = state === 'open' || state === 'connected' || !!state;
    setChipDebugV407(`Conexão OK\nState: ${state || 'sem state'}\nResposta: ${JSON.stringify(data, null, 2)}`, ok ? 'ok' : 'err');
    return { ok, state, data };
  } catch(err) {
    const msg = `Erro fetch: ${err?.message || err}`;
    setChipDebugV407(msg, 'err');
    return { ok:false, error:msg };
  }
}

async function saveChipWithConnectionTestV407() {
  const f = getChipFormValuesV407();
  const test = await testEvolutionChipConnectionV407(f);
  if (!test.ok) return;

  const chips = getWhatsappChipsV29();
  const existing = chips.find(chip => chip.name === f.name || chip.instance === f.instance);

  const payload = {
    id: existing?.id || 'chip_' + Date.now(),
    name: f.name,
    url: f.url,
    instance: f.instance,
    key: f.key,
    apiKey: f.key,
    dailyLimit: f.dailyLimit,
    blockSize: f.blockSize,
    intervalSeconds: f.intervalSeconds,
    blocks: f.blocks,
    status:'active',
    paused:false,
    connectionState:test.state || 'open',
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  if (existing) Object.assign(existing, payload);
  else chips.push(payload);

  saveWhatsappChipsV29(chips);
  if (typeof renderChipsPanel === 'function') renderChipsPanel();
  setChipDebugV407(`Chip salvo com sucesso:\n${f.name}\n${f.url}\n${f.instance}`, 'ok');
  notify('Chip salvo e conectado.');
}

function addWhatsappChip(){
  return saveChipWithConnectionTestV407();
}

function testEvolutionChipConnectionV406(){
  return testEvolutionChipConnectionV407();
}


/* ════════════════════════════
   CHIP IDS FIX V40.8
   Corrige campos duplicados:
   chipNome, chipUrl, chipLegacyInstance preenchido, chipKey
════════════════════════════ */
function getInputValueSmartV408(candidates = [], terms = []) {
  const inputs = Array.from(document.querySelectorAll('input'));

  for (const id of candidates) {
    const matches = inputs.filter(i => i.id === id);
    const filled = matches.find(i => String(i.value || '').trim());
    if (filled) return String(filled.value || '').trim();
  }

  const termFilled = inputs.find(input => {
    const hay = `${input.id||''} ${input.name||''} ${input.placeholder||''}`.toLowerCase();
    return terms.some(t => hay.includes(t)) && String(input.value || '').trim();
  });
  if (termFilled) return String(termFilled.value || '').trim();

  for (const id of candidates) {
    const el = inputs.find(i => i.id === id);
    if (el) return String(el.value || '').trim();
  }

  return '';
}

function getChipFormValuesV407() {
  const name = getInputValueSmartV408(['chipNome', 'chipName'], ['nome do chip', 'nome']);
  const url = getInputValueSmartV408(['chipUrl', 'evoUrl'], ['url da evolution', 'url evolution', 'url']);
  const instance = getInputValueSmartV408(['chipLegacyInstance', 'chipInstance', 'evoInstance'], ['instância', 'instancia', 'instance']);
  const key = getInputValueSmartV408(['chipKey', 'chipApiKey', 'evoApiKey', 'evoKey'], ['api key', 'apikey', 'chave']);

  return {
    name,
    url: String(url || '').trim().replace(/\/$/, ''),
    instance,
    key,
    dailyLimit: Number(document.getElementById('chipDailyLimit')?.value || WHATSAPP_CHIP_DAILY_LIMIT_V426),
    blockSize: Number(document.getElementById('chipBlockSize')?.value || WHATSAPP_CHIP_BLOCK_SIZE_V426),
    intervalSeconds: Number(document.getElementById('chipInterval')?.value || WHATSAPP_CHIP_INTERVAL_SECONDS_V426),
    blocks: (document.getElementById('chipBlocks')?.value || WHATSAPP_CHIP_BLOCKS_V426.join(',')).split(',').map(v=>v.trim()).filter(Boolean),
    found: {
      name: !!document.querySelector('#chipNome, #chipName'),
      url: !!document.querySelector('#chipUrl, #evoUrl'),
      instance: !!document.querySelector('#chipLegacyInstance, #chipInstance, #evoInstance'),
      key: !!document.querySelector('#chipKey, #chipApiKey, #evoApiKey, #evoKey')
    }
  };
}


/* ════════════════════════════
   CHIP UNIFICADO V40.9
   Salva chip no modelo antigo e no novo.
════════════════════════════ */
function getLegacyChipFormV409() {
  const smart = (ids) => {
    const inputs = Array.from(document.querySelectorAll('input'));
    for (const id of ids) {
      const filled = inputs.filter(i => i.id === id).find(i => String(i.value || '').trim());
      if (filled) return String(filled.value || '').trim();
    }
    for (const id of ids) {
      const el = inputs.find(i => i.id === id);
      if (el) return String(el.value || '').trim();
    }
    return '';
  };

  return {
    nome: smart(['chipNome', 'chipName']),
    url: smart(['chipUrl', 'evoUrl']).replace(/\/$/, ''),
    instance: smart(['chipLegacyInstance', 'chipInstance', 'evoInstance']),
    key: smart(['chipKey', 'chipApiKey', 'evoApiKey'])
  };
}

async function testarChipLegacyV409(chip) {
  const endpoint = `${chip.url}/instance/connectionState/${encodeURIComponent(chip.instance)}`;

  const res = await fetch(endpoint, {
    method: 'GET',
    headers: { apikey: chip.key }
  });

  const data = await res.json().catch(() => ({}));
  const state = data?.instance?.state || data?.state || '';

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (!state) throw new Error('Evolution respondeu sem estado');

  return { state, data };
}

function syncLegacyChipToV29V409(legacyChip) {
  if (typeof getWhatsappChipsV29 !== 'function' || typeof saveWhatsappChipsV29 !== 'function') return;

  const chipsV29 = getWhatsappChipsV29();
  const existing = chipsV29.find(c => c.instance === legacyChip.instance || c.name === legacyChip.nome);

  const mapped = {
    id: existing?.id || legacyChip.id || 'chip_' + Date.now(),
    name: legacyChip.nome,
    nome: legacyChip.nome,
    url: legacyChip.url,
    instance: legacyChip.instance,
    key: legacyChip.key,
    apiKey: legacyChip.key,
    dailyLimit: WHATSAPP_CHIP_DAILY_LIMIT_V426,
    blockSize: WHATSAPP_CHIP_BLOCK_SIZE_V426,
    intervalSeconds: WHATSAPP_CHIP_INTERVAL_SECONDS_V426,
    blocks: [...WHATSAPP_CHIP_BLOCKS_V426],
    status: 'active',
    paused: false,
    connectionState: legacyChip.status || 'open',
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  if (existing) Object.assign(existing, mapped);
  else chipsV29.push(mapped);

  saveWhatsappChipsV29(chipsV29);
}

function salvarChip() {
  const form = getLegacyChipFormV409();

  if (!form.nome || !form.url || !form.instance || !form.key) {
    notify('// preencha todos os campos', 'err');
    console.warn('[chip v40.9] campos lidos:', form);
    return;
  }

  const chips = typeof getChips === 'function' ? getChips() : [];
  const existing = chips.find(c => c.instance === form.instance || c.nome === form.nome);
  const chipPayload = {
    id: existing?.id || (typeof genId === 'function' ? genId() : 'chip_' + Date.now()),
    nome: form.nome,
    url: form.url,
    instance: form.instance,
    key: form.key,
    status: 'verificando conexão'
  };

  if (existing) Object.assign(existing, chipPayload);
  else chips.push(chipPayload);

  if (typeof saveChips === 'function') saveChips(chips);
  syncLegacyChipToV29V409(chipPayload);
  uiSyncLogV426('optimistic-update', { entity:'chip', action:'create-or-update', id:chipPayload.id, instance:chipPayload.instance });

  if (typeof fecharChipModal === 'function') fecharChipModal();
  if (typeof renderConfiguracoes === 'function') renderConfiguracoes();
  if (typeof renderChipsPanel === 'function') renderChipsPanel();
  if (typeof updateBadges === 'function') updateBadges();
  notify('// chip exibido. Testando conexão em segundo plano...', 'warn');

  Promise.resolve().then(async () => {
    const test = await testarChipLegacyV409(form);
    chipPayload.status = test.state === 'open' ? 'conectado' : test.state;
    const latest = typeof getChips === 'function' ? getChips() : [];
    const saved = latest.find(c => c.id === chipPayload.id || c.instance === chipPayload.instance);
    if (saved) Object.assign(saved, chipPayload);
    else latest.push(chipPayload);
    if (typeof saveChips === 'function') saveChips(latest);
    syncLegacyChipToV29V409(chipPayload);
    if (typeof renderConfiguracoes === 'function') renderConfiguracoes();
    if (typeof renderChipsPanel === 'function') renderChipsPanel();
    notify(`✓ Chip conectado: ${test.state}`);
  }).catch(err => {
    chipPayload.status = 'erro: ' + (err?.message || 'falha');
    const latest = typeof getChips === 'function' ? getChips() : [];
    const saved = latest.find(c => c.id === chipPayload.id || c.instance === chipPayload.instance);
    if (saved) Object.assign(saved, chipPayload);
    else latest.push(chipPayload);
    if (typeof saveChips === 'function') saveChips(latest);
    syncLegacyChipToV29V409(chipPayload);
    if (typeof renderConfiguracoes === 'function') renderConfiguracoes();
    if (typeof renderChipsPanel === 'function') renderChipsPanel();
    console.error('[chip v40.9] erro ao testar conexão:', err);
    notify('// chip salvo, mas a conexão falhou: ' + (err?.message || 'falha'), 'err');
  });
}

function addWhatsappChip() {
  return salvarChip();
}


/* ════════════════════════════
   FIX VALIDAÇÃO + DASHBOARD V40.10
════════════════════════════ */
function getAnySavedChipV4010() {
  try {
    const chipsNew = typeof getWhatsappChipsV29 === 'function' ? getWhatsappChipsV29() : [];
    const activeNew = chipsNew.find(c => c && c.status !== 'disabled' && !c.paused) || chipsNew[0];
    if (activeNew) return activeNew;
  } catch(e) {}

  try {
    const chipsOld = typeof getChips === 'function' ? getChips() : [];
    const activeOld = chipsOld.find(c => c && c.status !== 'desconectado') || chipsOld[0];
    if (activeOld) {
      return {
        name: activeOld.nome || activeOld.name,
        url: activeOld.url,
        instance: activeOld.instance,
        key: activeOld.key,
        apiKey: activeOld.key,
        status: 'active'
      };
    }
  } catch(e) {}

  return null;
}

function getEvolutionConfigForChipV405(chip = null) {
  const global = typeof getEvolutionSettings === 'function' ? getEvolutionSettings() : {};
  const selected = chip || getAnySavedChipV4010() || {};

  return {
    url: normalizeEvolutionBaseUrlV405(selected.url || selected.baseUrl || selected.evolutionUrl || global.url || ''),
    instance: selected.instance || selected.instanceName || selected.chipInstance || global.instance || '',
    apiKey: selected.key || selected.apiKey || selected.apikey || global.apiKey || '',
    chip: selected
  };
}

if (typeof renderCommercialDashboard !== 'function') {
  function renderCommercialDashboardSafeV4011() {
    try {
      if (typeof renderDashboard === 'function') return renderDashboard();
      return '';
    } catch(e) {
      console.warn('renderCommercialDashboard fallback:', e);
      return '';
    }
  }
}

async function validateActiveLeadWhatsapp() {
  if (!activeLeadDrawerId || !activeLeadDrawerData) return;
  whatsappValidationLogV427('start', { leadId:activeLeadDrawerId, lead:activeLeadDrawerData });

  const cfg = getEvolutionConfigForChipV405();
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

  if (!cfg.url || !cfg.instance || !cfg.apiKey) {
    notify('Cadastre e conecte um chip antes de validar.', 'warn');
    return;
  }

  setLeadWhatsappStatus(activeLeadDrawerId, {
    status: 'pending',
    label: 'Validando...',
    number: phone
  });
  renderLeadWhatsappValidation();

  try {
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


