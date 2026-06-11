/* ════════════════════════════
   SINCRONIZAR FILA — corrige status de itens já enviados
════════════════════════════ */
function devolverZapNaoValidadoParaValidacao() {
  const data = ensureWeekData();
  const weekLeadById = new Map(
    Object.values(data.days || {}).flat().filter(lead => lead?.id).map(lead => [lead.id, lead])
  );
  const validacao = getValData();
  const validacaoIds = new Set(validacao.map(lead => lead.id));
  const devolvidosIds = new Set();
  let filaEnriquecida = false;

  const devolver = (lead = {}) => {
    if (!lead.id || devolvidosIds.has(lead.id)) return;
    devolvidosIds.add(lead.id);
    if (validacaoIds.has(lead.id)) return;
    validacaoIds.add(lead.id);
    validacao.push({
      ...lead,
      canal: 'pendente',
      numStatus: 'pendente',
      status: 'Não enviada',
      diaDestino: null,
      recuperadoDaFilaZapEm: todayStr(),
    });
  };

  Object.keys(data.days || {}).forEach(day => {
    data.days[day] = (data.days[day] || []).filter(lead => {
      const aguardando = !lead.status || lead.status === 'Não enviada' || lead.status === 'Em fila';
      if (!aguardando || isLeadWhatsappValidatedForQueue(lead)) return true;
      devolver(lead);
      return false;
    });
  });

  const backlog = getZapBacklog();
  const backlogValido = backlog.filter(lead => {
    if (isLeadWhatsappValidatedForQueue(lead)) return true;
    devolver(lead);
    return false;
  });

  const filaOperacional = getWhatsappQueueV27();
  const filaOperacionalValida = filaOperacional.filter(item => {
    if (item.status === 'Enviado') return true;
    const lead = findLeadEverywhere(item.leadId) || {
      id: item.leadId,
      nome: item.nome,
      whatsapp: item.telefone
    };
    if (isLeadWhatsappValidatedForQueue(lead)) return true;
    devolver(lead);
    return false;
  });

  Object.keys(filaDisparo || {}).forEach(chipId => {
    filaDisparo[chipId] = (filaDisparo[chipId] || []).filter(item => {
      const weekLead = weekLeadById.get(item.id) || {};
      const validationCandidate = {
        ...weekLead,
        ...item,
        numStatus: item.numStatus || weekLead.numStatus,
        whatsappValidationStatus: item.whatsappValidationStatus || weekLead.whatsappValidationStatus
      };
      if (item.status === 'enviado' || isLeadWhatsappValidatedForQueue(validationCandidate)) {
        if (!item.numStatus && validationCandidate.numStatus) {
          item.numStatus = validationCandidate.numStatus;
          filaEnriquecida = true;
        }
        if (!item.whatsappValidationStatus && validationCandidate.whatsappValidationStatus) {
          item.whatsappValidationStatus = validationCandidate.whatsappValidationStatus;
          filaEnriquecida = true;
        }
        return true;
      }
      devolver(validationCandidate);
      return false;
    });
  });

  if (devolvidosIds.size) {
    saveWeekData(data);
    saveZapBacklog(backlogValido);
    if (filaOperacionalValida.length !== filaOperacional.length) saveWhatsappQueueV27(filaOperacionalValida);
    saveFilaDisparo();
    saveValData(validacao);
    updateBadges();
  } else if (filaEnriquecida) {
    saveFilaDisparo({ delay:0, reason:'dispatch-queue-validation-hydrate' });
  }

  return devolvidosIds.size;
}

function sincronizarFilaComEnviados(){
  try {
    const data = typeof ensureWeekData === 'function' ? ensureWeekData() : {};
    const safe = data && typeof data === 'object' ? data : {};
    const days = safe.days && typeof safe.days === 'object' ? safe.days : {};
    const fila = typeof getWhatsappQueueV27 === 'function' ? getWhatsappQueueV27() : [];

    // Garante que a função nunca quebre se a semana vier nula do Supabase.
    const enviados = [];
    Object.values(days || {}).forEach(dayList => {
      if (!Array.isArray(dayList)) return;
      dayList.forEach(lead => {
        if (lead && (lead.status === 'enviado' || lead.whatsappStatus === 'sent')) enviados.push(lead);
      });
    });

    return { fila: Array.isArray(fila) ? fila : [], enviados };
  } catch(e) {
    console.warn('sincronizarFilaComEnviados protegido V41.7:', e?.message || e);
    return { fila: [], enviados: [] };
  }
}

function getFilaChip(chipId) {
  if (!filaDisparo[chipId]) filaDisparo[chipId] = [];
  return filaDisparo[chipId];
}

function saveFilaDisparo({ delay = 250, reason = 'dispatch-queue-save' } = {}) {
  const updatedAt = new Date().toISOString();
  try {
    localStorage.setItem(FILA_DISPARO_KEY, JSON.stringify(filaDisparo));
    localStorage.setItem(FILA_DISPARO_UPDATED_AT_KEY_V431, updatedAt);
  } catch(e) {
    console.warn('saveFilaDisparo error', e);
  }
  uiSyncLogV426('optimistic-update', {
    entity:'dispatch-queue',
    action:'save-local-cache',
    reason,
    updatedAt,
    count:Object.values(filaDisparo || {}).flat().length
  });
  scheduleLegacyOperationalSyncV36({ delay, reason });
}

function createDispatchQueueItemV433(emp = {}, overrides = {}) {
  return {
    id: emp.id,
    nome: emp.nome,
    site: emp.site || '',
    whatsapp: emp.whatsapp,
    mensagem: '',
    templateIdx: -1,
    ramoId: null,
    numStatus: emp.numStatus || '',
    whatsappValidationStatus: emp.whatsappValidationStatus || '',
    status: 'aguardando',
    aberto: false,
    ...overrides
  };
}

function hydrateRecoveredDispatchMessagesV433(chipId) {
  if (!chipId || typeof getLoteRamo !== 'function' || typeof pickTemplate !== 'function') return 0;
  const fila = getFilaChip(chipId);
  const data = ensureWeekData();
  let hydrated = 0;

  Object.keys(data.days || {}).forEach(day => {
    const idsNoDia = new Set((data.days[day] || []).map(lead => lead.id));
    fila.filter(item => idsNoDia.has(item.id)).forEach((item, index) => {
      if (String(item.mensagem || '').trim()) return;
      const loteNum = Math.floor(index / getLoteSize()) + 1;
      const ramoId = getLoteRamo(chipId, loteNum);
      if (!ramoId) return;
      const { text, idx } = pickTemplate(item.nome, ramoId);
      item.ramoId = ramoId;
      item.mensagem = text;
      item.templateIdx = idx;
      hydrated++;
    });
  });

  return hydrated;
}

function recoverSingleChipQueueAssignmentsV431() {
  const chips = getChips();
  if (chips.length !== 1) return 0;

  const fila = getFilaChip(chips[0].id);
  const filaIds = new Set(fila.map(item => item.id));
  const data = ensureWeekData();
  const recovered = [];

  Object.values(data.days || {}).flat().forEach(emp => {
    if (!emp?.id || !emp.whatsapp || emp.status !== 'Em fila' || filaIds.has(emp.id)) return;
    filaIds.add(emp.id);
    recovered.push(createDispatchQueueItemV433(emp));
  });

  if (!recovered.length) return 0;
  fila.push(...recovered);
  const hydrated = hydrateRecoveredDispatchMessagesV433(chips[0].id);
  saveFilaDisparo({ delay:0, reason:'dispatch-single-chip-orphan-recovery' });
  uiSyncLogV426('optimistic-update', {
    entity:'dispatch-queue',
    action:'recover-single-chip-orphans',
    chipId:chips[0].id,
    count:recovered.length,
    hydrated
  });
  return recovered.length;
}

const CHIP_LIMIT = WHATSAPP_CHIP_DAILY_LIMIT_V426; // maximo de leads por chip por dia

function getFilaChipNoDia(chipId, day) {
  // Retorna apenas os itens da fila do chip que pertencem ao dia informado
  const data = ensureWeekData();
  const idsNoDia = new Set((data.days[day]||[]).map(e => e.id));
  return getFilaChip(chipId).filter(f => idsNoDia.has(f.id));
}

function toggleFilaSlotEmpresa(slot, empId) {
  const chips = getChips();
  const chip = chips[slot] || null;
  if (!chip) { notify('// chip ' + (slot+1) + ' não configurado','warn'); return; }
  const fila = getFilaChip(chip.id);
  const idx = fila.findIndex(f => f.id === empId);
  const data = ensureWeekData();

  if (idx >= 0) {
    // ── REMOVER da fila ──
    fila.splice(idx, 1);
    const emOutraFila = chips.some((c, s) => s !== slot && getFilaChip(c.id).some(f => f.id === empId));
    if (!emOutraFila) {
      Object.keys(data.days).forEach(day => {
        const emp = (data.days[day]||[]).find(e => e.id === empId);
        if (emp && emp.status === 'Em fila') emp.status = 'Não enviada';
      });
      saveWeekData(data);
    }
    saveFilaDisparo({ delay:0, reason:'dispatch-chip-assignment-remove' });
    renderDisparoEmpresas();
    chips.forEach((_, s) => renderFilaSlot(s, disparoDay));
    updateBadges();
    return;
  }

  // ── ADICIONAR à fila ──
  const all = Object.values(data.days).flat();
  const emp = all.find(e => e.id === empId);
  if (!emp || !emp.whatsapp) { notify('// empresa sem WhatsApp','warn'); return; }
  if (!isLeadWhatsappValidatedForQueue(emp)) {
    notify('// valide o WhatsApp antes de adicionar ao chip', 'warn');
    return;
  }

  // Verificar se o chip alvo tem vaga no dia atual
  const filaChipNoDia = getFilaChipNoDia(chip.id, disparoDay);
  if (filaChipNoDia.length >= CHIP_LIMIT) {
    // Chip alvo cheio — procurar próximo chip com vaga (ordem circular a partir do slot+1)
    let slotDestino = -1;
    for (let i = 1; i <= chips.length; i++) {
      const s = (slot + i) % chips.length;
      const c = chips[s];
      if (c && getFilaChipNoDia(c.id, disparoDay).length < CHIP_LIMIT) {
        slotDestino = s;
        break;
      }
    }

    if (slotDestino === -1) {
      notify(`// todos os chips estão cheios (${CHIP_LIMIT} leads/chip) neste dia`, 'warn');
      return;
    }

    const chipDestino = chips[slotDestino];
    notify(`// Chip ${slot+1} cheio → adicionando ao Chip ${slotDestino+1} (${chipDestino.nome})`, 'warn');
    // Redireciona para o chip com vaga
    toggleFilaSlotEmpresa(slotDestino, empId);
    return;
  }

  // Chip tem vaga — adicionar normalmente
  const slotExistente = chips.findIndex((c, s) =>
    s !== slot && getFilaChip(c.id).some(item => item.id === empId && item.status !== 'enviado')
  );
  if (slotExistente >= 0) {
    notify(`// empresa já está na fila do Chip ${slotExistente + 1}`, 'warn');
    return;
  }
  const jaEnviado = ['Enviada','Respondida','Não respondida','Recusada','Fechada'].includes(emp.status||'');
  const filaStatus = jaEnviado ? 'enviado' : 'aguardando';
  fila.push(createDispatchQueueItemV433(emp, { status:filaStatus }));
  if (!jaEnviado) {
    Object.keys(data.days).forEach(day => {
      const e = (data.days[day]||[]).find(e => e.id === empId);
      if (e) e.status = 'Em fila';
    });
    saveWeekData(data);
  }
  saveFilaDisparo({ delay:0, reason:'dispatch-chip-assignment-add' });
  renderDisparoEmpresas();
  chips.forEach((_, s) => renderFilaSlot(s, disparoDay));
  updateBadges();
}

function toggleFila(empId) {
  const chipId = disparoChipId;
  if (!chipId) { notify('// selecione um chip primeiro','warn'); return; }
  const fila = getFilaChip(chipId);
  const idx = fila.findIndex(f => f.id === empId);
  const data = ensureWeekData();
  if (idx >= 0) {
    fila.splice(idx, 1);
    Object.keys(data.days).forEach(day => {
      const emp = (data.days[day]||[]).find(e => e.id === empId);
      if (emp && emp.status === 'Em fila') emp.status = 'Não enviada';
    });
    saveWeekData(data);
  } else {
    const all  = Object.values(data.days).flat();
    const emp  = all.find(e => e.id === empId);
    if (!emp || !emp.whatsapp) return;
    if (!isLeadWhatsappValidatedForQueue(emp)) {
      notify('// valide o WhatsApp antes de adicionar ao chip', 'warn');
      return;
    }
    const jaEnviado = emp.status === 'Enviada' || emp.status === 'Respondida' || emp.status === 'Não respondida' || emp.status === 'Recusada' || emp.status === 'Fechada';
    const filaStatus = jaEnviado ? 'enviado' : 'aguardando';
    fila.push(createDispatchQueueItemV433(emp, { status:filaStatus }));
    if (!jaEnviado) {
      Object.keys(data.days).forEach(day => {
        const e = (data.days[day]||[]).find(e => e.id === empId);
        if (e) e.status = 'Em fila';
      });
      saveWeekData(data);
    }
  }
  saveFilaDisparo({ delay:0, reason:'dispatch-chip-assignment-toggle-legacy' });
  renderDisparoEmpresas(); renderFila(); updateBadges();
}

function renderFila() {
  const countEl = document.getElementById('filaCount');
  const vaziEl  = document.getElementById('filaVazia');
  const itensEl = document.getElementById('filaItens');
  const filaAtual = getFilaChip(disparoChipId);
  countEl.textContent = `(${filaAtual.length} empresa${filaAtual.length!==1?'s':''})`;
  const vazia = filaAtual.length === 0;
  vaziEl.style.display  = vazia ? 'block' : 'none';
  itensEl.style.display = vazia ? 'none'  : 'flex';
  if (vazia) { itensEl.innerHTML = ''; return; }

  itensEl.innerHTML = filaAtual.map((item, i) => {
    const waNum = item.whatsapp.replace(/\D/g,'');
    const chip = getChipById(disparoChipId);
    const chipBadge = chip ? `<span class="q-badge ok" style="font-size:7px;margin-left:4px">📱 ${escHtml(chip.nome)}</span>` : '';
    const labels = { aguardando:'aguardando', enviando:'enviando...', enviado:'✓ enviado', erro:'✗ erro' };
    const aberto = item.aberto || false;
    return `<div class="fila-item ${item.status}" id="fila-item-${item.id}">
      <div class="fila-item-header" onclick="toggleFilaItem('${item.id}')" style="cursor:pointer;user-select:none">
        <div class="fila-item-num">${i+1}</div>
        <div class="fila-item-nome">${item.site ? `<a href="${escHtml(item.site)}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none" title="${escHtml(item.site)}" onclick="event.stopPropagation()">${escHtml(item.nome)}</a>` : escHtml(item.nome)}</div>
        <div class="fila-item-wa">+${waNum}${chipBadge}</div>
        <button class="lead-drawer-open-btn" onclick="event.stopPropagation();openLeadDrawer('${item.id}')">Ficha</button>
        <div style="color:var(--muted);font-size:12px;margin-left:4px;transition:transform 0.2s;transform:rotate(${aberto?'90':'0'}deg)">▶</div>
        <button class="fila-remove-btn" style="position:static;top:auto;right:auto;width:22px;height:22px" onclick="event.stopPropagation();removerFila('${item.id}')">×</button>
      </div>
      <div class="fila-item-body" style="display:${aberto?'flex':'none'}">
        <div style="width:100%">
          <div style="font-family:'DM Mono',monospace;font-size:8px;color:var(--muted);margin-bottom:4px">① APRESENTAÇÃO</div>
          <textarea class="fila-msg-area" id="fila-msg-${item.id}" style="background:var(--surface2);border-radius:8px;padding:10px 12px;font-family:'DM Mono',monospace;font-size:9px;color:var(--text2);line-height:1.7;min-height:80px;border:1px solid var(--border2);resize:vertical;width:100%;outline:none" oninput="atualizarMsgFila('${item.id}',this.value)">${escHtml(item.mensagem)}</textarea>
          <button class="fila-msg-shuffle" onclick="shuffleFilaMsg('${item.id}')">↻ sortear</button>
        </div>
      </div>
    </div>`
  }).join('');
}

function toggleFilaItem(id) {
  const fila = getFilaChip(disparoChipId);
  const item = fila.find(f => f.id === id);
  if (!item) return;
  item.aberto = !item.aberto;
  renderFila();
}

function atualizarMsgFila(id, val) {
  const fila = getFilaChip(disparoChipId);
  const item = fila.find(f => f.id === id);
  if (item) { item.mensagem = val; saveFilaDisparo({ reason:'dispatch-message-update' }); }
}

function shuffleFilaMsgSlot(slot, id) {
  const chip = getChipBySlot(slot); if (!chip) return;
  const fila = getFilaChip(chip.id);
  const item = fila.find(f => f.id === id);
  if (!item) return;
  const itemIdx = fila.findIndex(f => f.id === id);
  const loteNum = Math.floor(itemIdx / getLoteSize()) + 1;
  const { text, idx } = pickOtherTemplate(item.nome, item.templateIdx, item.ramoId || null);
  item.mensagem = text; item.templateIdx = idx;
  const el = document.getElementById(`fila-msg-${slot}-${id}`);
  if (el) el.value = item.mensagem;
  saveFilaDisparo();
}
function shuffleFilaMsg(id) {
  const fila = getFilaChip(disparoChipId);
  const item = fila.find(f => f.id === id);
  if (!item) return;
  const itemIdx = fila.findIndex(f => f.id === id);
  const loteNum = Math.floor(itemIdx / getLoteSize()) + 1;
  const { text, idx } = pickOtherTemplate(item.nome, item.templateIdx, item.ramoId || null);
  item.mensagem = text; item.templateIdx = idx;
  const el = document.getElementById(`fila-msg-${id}`);
  if (el) el.value = item.mensagem;
  saveFilaDisparo({ reason:'dispatch-message-shuffle' });
}
function onRamoFilaChange(id, ramoId) {
  const fila = getFilaChip(disparoChipId);
  const item = fila.find(f => f.id === id);
  if (!item) return;
  item.ramoId = ramoId || null;
  saveFilaDisparo();
  // Sortear automaticamente com o novo ramo
  const { text, idx } = pickTemplate(item.nome, item.ramoId);
  item.mensagem = text; item.templateIdx = idx;
  saveFilaDisparo();
  const el = document.getElementById(`fila-msg-${id}`);
  if (el) el.value = item.mensagem;
}
function onImgChange(id, input, slot) {
  const file = input.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const fila = getFilaChip(disparoChipId);
    const item = fila.find(f => f.id === id);
    if (!item) return;
    if (slot === '2') {
      item.imagem2Base64 = e.target.result; item.imagem2Nome = file.name;
    } else {
      item.imagemBase64 = e.target.result; item.imagemNome = file.name;
    }
    saveFilaDisparo({ reason:'dispatch-image-update' });
    renderFila();
  };
  reader.readAsDataURL(file);
}
function removerImagem(id, slot) {
  const fila = getFilaChip(disparoChipId);
  const item = fila.find(f => f.id === id);
  if (!item) return;
  if (slot === '2') {
    delete item.imagem2Base64; delete item.imagem2Nome;
  } else {
    delete item.imagemBase64; delete item.imagemNome;
  }
  saveFilaDisparo({ reason:'dispatch-image-remove' });
  renderFila();
}
function removerFila(id) {
  if (!filaDisparo[disparoChipId]) return;
  const item = filaDisparo[disparoChipId].find(f => f.id === id);
  abrirModalConfirm(
    `Remover <strong>${item ? escHtml(item.nome) : 'esta empresa'}</strong> da fila?`,
    () => {
      if (!filaDisparo[disparoChipId]) return;
      filaDisparo[disparoChipId] = filaDisparo[disparoChipId].filter(f => f.id !== id);
      const data = ensureWeekData();
      Object.keys(data.days).forEach(day => {
        const emp = (data.days[day]||[]).find(e => e.id === id);
        if (emp && emp.status === 'Em fila') emp.status = 'Não enviada';
      });
      saveWeekData(data); saveFilaDisparo({ delay:0, reason:'dispatch-chip-assignment-remove-legacy' }); updateBadges(); renderDisparoEmpresas(); renderFila();
    }
  );
}
function limparFila() {
  if (disparoEmAndamento) { notify('// disparo em andamento','warn'); return; }
  if (aguardandoLote) cancelarLotes();
  const chipId = disparoChipId;
  if (chipId && filaDisparo[chipId]) {
    const data = ensureWeekData();
    Object.keys(data.days).forEach(day => {
      (data.days[day]||[]).forEach(emp => { if (emp.status === 'Em fila') emp.status = 'Não enviada'; });
    });
    saveWeekData(data);
    filaDisparo[chipId] = [];
    saveFilaDisparo({ delay:0, reason:'dispatch-chip-queue-clear-legacy' });
  }
  updateBadges(); renderDisparoEmpresas(); renderFila();
}

