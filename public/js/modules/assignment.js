/* ════════════════════════════
   BASE DE ATRIBUIÇÃO
════════════════════════════ */
let atribSelecionados = new Set();
let atribDiaLote = null;

function diasEmEspera(criadoEm) {
  if (!criadoEm) return 0;
  const [d, m, y] = criadoEm.split('/').map(Number);
  const criado = new Date(y, m - 1, d);
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  return Math.floor((hoje - criado) / 86400000);
}

function renderAtribuicao() {
  const leads = moveUnvalidatedAtribLeadsToValidationV42(getAtribuicaoData());
  const weekDays = currentWeekDays();
  const today = todayStr();
  if (!atribDiaLote || !weekDays.includes(atribDiaLote)) atribDiaLote = today;

  // badge total
  const totalEl = document.getElementById('atribTotalBadge');
  if (totalEl) totalEl.textContent = leads.length ? `(${leads.length} lead${leads.length!==1?'s':''})` : '';

  // day tabs para lote
  const loteTabsEl = document.getElementById('atribLoteDayTabs');
  if (loteTabsEl) {
    loteTabsEl.innerHTML = weekDays.map(day => {
      const data = ensureWeekData();
      const count = (data.days[day]||[]).length;
      const active = day === atribDiaLote;
      return `<div class="day-tab${active?' active':''}" onclick="setAtribDiaLote('${day}')" style="font-size:9px;padding:4px 10px">
        ${dayLabel(day)}${day===today?' <span style="color:var(--accent);font-size:8px">●</span>':''}
        ${count>0?`<span class="day-count">${count}</span>`:''}
      </div>`;
    }).join('');
  }

  // painel de ações em lote
  const acoesEl = document.getElementById('atribAcoesLote');
  const loteLabel = document.getElementById('atribLoteLabel');
  if (acoesEl) {
    const temSel = atribSelecionados.size > 0;
    acoesEl.style.display = temSel ? 'flex' : 'none';
    if (loteLabel) loteLabel.textContent = `${atribSelecionados.size} selecionado${atribSelecionados.size!==1?'s':''}`;
  }

  // lista
  const listEl = document.getElementById('atribList');
  if (!listEl) return;

  const buscaElChk = document.getElementById('atribBusca');
  const buscaQChk = buscaElChk ? buscaElChk.value.trim() : '';
  if (!leads.length) {
    listEl.innerHTML = '<div style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--muted);text-align:center;padding:32px">// nenhum lead aguardando atribuição</div>';
    document.getElementById('atribPagination').innerHTML = '';
    return;
  }

  // Filtro de busca
  const buscaEl = document.getElementById('atribBusca');
  const buscaQ = buscaEl ? buscaEl.value.trim().toLowerCase() : '';
  const leadsFiltrados = buscaQ
    ? leads.filter(l =>
        (l.nome||''      ).toLowerCase().includes(buscaQ) ||
        (l.site||''      ).toLowerCase().includes(buscaQ) ||
        (l.whatsapp||''  ).toLowerCase().includes(buscaQ)
      )
    : leads;

  const totalAtrib = leadsFiltrados.length;
  const totalAtribPages = Math.max(1, Math.ceil(totalAtrib / ATRIB_PG));
  if (atribPage > totalAtribPages) atribPage = totalAtribPages;
  const pageLeads = leadsFiltrados.slice((atribPage-1)*ATRIB_PG, atribPage*ATRIB_PG);

  if (!leadsFiltrados.length) {
    listEl.innerHTML = `<div style="font-family:'DM Mono',monospace;font-size:10px;color:var(--muted);text-align:center;padding:32px">// nenhum resultado para "<span style="color:var(--text2)">${escHtml(buscaQ)}</span>"</div>`;
    document.getElementById('atribPagination').innerHTML = '';
    return;
  }

  listEl.innerHTML = '<div class="ext-list">' + pageLeads.map(lead => {
    const sel = atribSelecionados.has(lead.id);
    const dias = diasEmEspera(lead.validadoEm || lead.criadoEm);
    const voltou = lead.voltouDaSemana;
    const canal = lead.canal && lead.canal !== 'pendente' ? lead.canal : (lead.whatsapp ? 'zap' : 'insta'); // legado: inferir canal pelo whatsapp
    const isInsta = canal === 'insta';

    let ageBadge = '';
    if (dias >= 2) {
      ageBadge = `<span style="display:inline-flex;align-items:center;gap:3px;font-family:'DM Mono',monospace;font-size:8px;color:var(--warning);background:rgba(240,164,41,0.1);border:1px solid rgba(240,164,41,0.25);border-radius:4px;padding:2px 7px">⏳ há ${dias} dia${dias!==1?'s':''}</span>`;
    } else if (dias === 1) {
      ageBadge = `<span style="display:inline-flex;align-items:center;gap:3px;font-family:'DM Mono',monospace;font-size:8px;color:var(--warning);background:rgba(240,164,41,0.08);border:1px solid rgba(240,164,41,0.2);border-radius:4px;padding:2px 7px">⏳ desde ontem</span>`;
    }

    let voltouBadge = '';
    if (voltou) {
      voltouBadge = `<span style="display:inline-flex;align-items:center;gap:3px;font-family:'DM Mono',monospace;font-size:8px;color:var(--text2);background:var(--surface3);border:1px solid var(--border2);border-radius:4px;padding:2px 7px">↩ voltou da semana</span>`;
    }

    const canalBadge = isInsta
      ? `<span style="display:inline-flex;align-items:center;gap:3px;font-family:'DM Mono',monospace;font-size:8px;color:var(--insta);background:rgba(225,48,108,0.08);border:1px solid rgba(225,48,108,0.3);border-radius:4px;padding:2px 7px">📸 INSTA</span>`
      : `<span style="display:inline-flex;align-items:center;gap:3px;font-family:'DM Mono',monospace;font-size:8px;color:var(--ok);background:rgba(78,203,113,0.08);border:1px solid rgba(78,203,113,0.3);border-radius:4px;padding:2px 7px">💬 ZAP</span>`;

    const cardBorder = sel
      ? 'border-color:var(--accent);background:var(--accent-dim)'
      : isInsta ? 'border-color:rgba(225,48,108,0.2)' : dias >= 1 ? 'border-color:rgba(240,164,41,0.3)' : '';

    // Ações específicas por canal
    let actionsHtml = '';
    if (isInsta) {
      // Lead INSTA: campo para colar Instagram + botão → Fila Insta
      const temInsta = !!(lead.instagram);
      actionsHtml = `<div style="display:flex;flex-direction:column;gap:5px;align-items:flex-end;min-width:160px">
        <div style="display:flex;gap:5px;align-items:center;width:100%">
          <input id="atrib-insta-input-${lead.id}" type="url" placeholder="instagram.com/empresa" value="${escHtml(lead.instagram||'')}"
            style="flex:1;background:rgba(225,48,108,0.06);border:1px solid rgba(225,48,108,0.25);border-radius:6px;color:var(--text);font-family:'DM Mono',monospace;font-size:9px;padding:5px 8px;outline:none;width:0"
            onfocus="this.style.borderColor='var(--insta)'" onblur="this.style.borderColor='rgba(225,48,108,0.25)'"
            onkeydown="if(event.key==='Enter')mandarParaFilaInsta('${lead.id}')"/>
          <button onclick="atribPromoverParaZap('${lead.id}')" title="Inserir número e promover para ZAP"
            style="background:none;border:1px solid var(--border2);color:var(--muted);border-radius:6px;font-size:9px;padding:5px 7px;cursor:pointer;transition:all 0.18s;flex-shrink:0"
            onmouseover="this.style.borderColor='var(--ok)';this.style.color='var(--ok)'" onmouseout="this.style.borderColor='var(--border2)';this.style.color='var(--muted)'">✏️</button>
        </div>
        <button onclick="mandarParaFilaInsta('${lead.id}')"
          style="background:var(--insta);color:#fff;border:none;border-radius:6px;font-family:'DM Mono',monospace;font-size:9px;font-weight:700;padding:5px 11px;cursor:pointer;white-space:nowrap;transition:opacity 0.18s;width:100%;opacity:${temInsta?'1':'0.5'}"
          onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='${temInsta?'1':'0.5'}'">
          → Fila Insta
        </button>
        <button class="del-btn" onclick="removerDaAtribuicao('${lead.id}')">✕</button>
      </div>`;
    } else {
      // Lead ZAP: botão → Fila Zap (Backlog)
      actionsHtml = `<div class="empresa-actions" style="flex-direction:column;gap:5px;align-items:flex-end">
        <button onclick="mandarParaBacklogZap('${lead.id}')"
          style="background:var(--accent);color:#0a0a0d;border:none;border-radius:7px;font-family:'DM Mono',monospace;font-size:9px;font-weight:700;padding:5px 12px;cursor:pointer;white-space:nowrap;transition:opacity 0.18s"
          onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'">
          → Fila Zap
        </button>
        <button class="del-btn" onclick="removerDaAtribuicao('${lead.id}')">✕</button>
      </div>`;
    }

    return `<div class="empresa-card" id="atrib-card-${lead.id}" style="${cardBorder}">
      <!-- checkbox de seleção (só ZAP) -->
      ${!isInsta ? `<div style="flex-shrink:0;margin-right:4px">
        <div onclick="toggleAtribSel('${lead.id}')"
          style="width:18px;height:18px;border-radius:4px;border:2px solid ${sel?'var(--accent)':'var(--border2)'};
          background:${sel?'var(--accent)':'transparent'};cursor:pointer;display:flex;align-items:center;justify-content:center;
          transition:all 0.15s;flex-shrink:0">
          ${sel?`<svg width="10" height="10" viewBox="0 0 12 12" fill="none"><polyline points="2,6 5,9 10,3" stroke="#0a0a0d" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`:''}
        </div>
      </div>` : ''}
      <div class="empresa-info">
        <div class="empresa-nome">
          ${lead.googleUrl
            ? `<a href="${escHtml(lead.googleUrl)}" target="_blank" style="color:var(--text);text-decoration:none">${escHtml(lead.nome)}</a>`
            : escHtml(lead.nome)}
        </div>
        <div class="empresa-meta">
          ${canalBadge}
          ${!isInsta && lead.whatsapp ? `<div class="empresa-phone">📱 ${escHtml(lead.whatsapp)}</div>` : ''}
          ${ageBadge}
          ${voltouBadge}
        </div>
      </div>
      ${actionsHtml}
    </div>`;
  }).join('') + '</div>';
  renderPagination('atribPagination', atribPage, totalAtribPages, totalAtrib, ATRIB_PG, 'goAtribPage', 'changeAtribPgSize');
}


function toggleAtribSel(id) {
  if (atribSelecionados.has(id)) atribSelecionados.delete(id);
  else atribSelecionados.add(id);
  renderAtribuicao();
}

function selecionarTodos() {
  const leads = getAtribuicaoData();
  leads.forEach(l => atribSelecionados.add(l.id));
  renderAtribuicao();
}

function deselecionarTodos() {
  atribSelecionados.clear();
  renderAtribuicao();
}

function setAtribDiaLote(day) {
  atribDiaLote = day;
  renderAtribuicao();
}

function toggleAtribDropdown(id) {
  const dd = document.getElementById(`atrib-dd-${id}`);
  if (!dd) return;
  // fecha todos os outros
  document.querySelectorAll('[id^="atrib-dd-"]').forEach(el => { if (el.id !== `atrib-dd-${id}`) el.style.display = 'none'; });
  dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
}

// Fecha dropdowns ao clicar fora
document.addEventListener('click', e => {
  if (!e.target.closest('[id^="atrib-dd-"]') && !e.target.closest('[onclick*="toggleAtribDropdown"]')) {
    document.querySelectorAll('[id^="atrib-dd-"]').forEach(el => el.style.display = 'none');
  }
});

function atribuirParaDia(ids, day) {
  const data = ensureWeekData();
  if (!data.days[day]) data.days[day] = [];
  const atrib = getAtribuicaoData();
  const diasSemana = currentWeekDays();
  let atribuidos = 0;
  const atribuidosIds = new Set();

  ids.forEach(id => {
    const lead = atrib.find(a => a.id === id);
    if (!lead) return;
    if (!isLeadWhatsappValidatedForQueue(lead)) {
      notify(`// valide o WhatsApp de ${lead.nome} antes de atribuir`, 'warn');
      return;
    }

    // encontra dia com vaga (máx = 60 × nº de chips)
    const dailyLimit = getDailyLimit();
    let diaFinal = day;
    let idx = diasSemana.indexOf(day);
    while ((data.days[diaFinal]||[]).length >= dailyLimit) {
      idx++;
      if (idx >= diasSemana.length) { notify(`// semana cheia — ${lead.nome} não atribuído`,'warn'); return; }
      diaFinal = diasSemana[idx];
      if (!data.days[diaFinal]) data.days[diaFinal] = [];
    }

    if (!data.days[diaFinal]) data.days[diaFinal] = [];
    data.days[diaFinal].push({
      id: lead.id, nome: lead.nome, site: lead.site || '',
      whatsapp: lead.whatsapp || '', instagram: lead.instagram || '',
      googleUrl: lead.googleUrl || '',
      ramoId: lead.ramoId || null,
      numStatus: 'valido',
      whatsappValidationStatus: 'valid',
      status: 'Não enviada', criadoEm: lead.criadoEm || todayStr(),
    });
    addLeadHistory(lead.id, `Atribuído para ${dayLabel(diaFinal)}`, lead);
    atribuidosIds.add(lead.id);
    atribuidos++;
  });

  saveWeekData(data);
  const novaAtrib = atrib.filter(a => !atribuidosIds.has(a.id));
  saveAtribuicaoData(novaAtrib);
  atribSelecionados.clear();
  renderAtribuicao(); updateBadges();
  return atribuidos;
}

function atribuirIndividual(id, day) {
  document.querySelectorAll('[id^="atrib-dd-"]').forEach(el => el.style.display = 'none');
  const atrib = getAtribuicaoData();
  const lead = atrib.find(a => a.id === id);
  const n = atribuirParaDia([id], day);
  if (n > 0) notify(`✓ ${lead?.nome} → ${dayLabel(day)}`);
}

function atribuirLote() {
  if (!atribSelecionados.size) { notify('// selecione ao menos 1 lead','warn'); return; }
  if (!atribDiaLote) { notify('// selecione um dia','warn'); return; }
  const ids = [...atribSelecionados];
  const n = atribuirParaDia(ids, atribDiaLote);
  if (n > 0) notify(`✓ ${n} lead${n!==1?'s':''} → ${dayLabel(atribDiaLote)}`);
}

function removerDaAtribuicao(id) {
  const lead = getAtribuicaoData().find(a => a.id === id);
  abrirModalConfirm(
    `Remover <strong>${lead ? escHtml(lead.nome) : 'este lead'}</strong> da Base de Atribuição?`,
    () => {
      saveAtribuicaoData(getAtribuicaoData().filter(a => a.id !== id));
      atribSelecionados.delete(id);
      renderAtribuicao(); updateBadges();
      notify('Lead removido');
    }
  );
}

/* ════════════════════════════
   BACKLOG FILA ZAP
════════════════════════════ */
const ZAP_BACKLOG_KEY = 'vin_zap_backlog';
function getZapBacklog()   { return getStoredArray(ZAP_BACKLOG_KEY); }
function saveZapBacklog(d) {
  localStorage.setItem(ZAP_BACKLOG_KEY, JSON.stringify(d));
  if (typeof mergeLeadsIntoPermanentBase === 'function') mergeLeadsIntoPermanentBase(d, { source:'Backlog WhatsApp' });
  scheduleLegacyOperationalSyncV36();
}

function mandarParaBacklogZap(id) {
  const atrib = getAtribuicaoData();
  const lead  = atrib.find(a => a.id === id);
  if (!lead) return;
  if (!isLeadWhatsappValidatedForQueue(lead)) {
    notify('// valide o WhatsApp antes de enviar para a fila Zap', 'warn');
    return;
  }

  const backlog = getZapBacklog();
  if (backlog.find(b => b.id === id)) { notify('// já está no Backlog ZAP','warn'); return; }

  backlog.push({
    id: lead.id, nome: lead.nome, whatsapp: lead.whatsapp || '',
    instagram: lead.instagram || '', googleUrl: lead.googleUrl || '',
    canal: 'zap', criadoEm: lead.criadoEm || todayStr(),
    entradaBacklogEm: todayStr(),
  });
  saveZapBacklog(backlog);
  saveAtribuicaoData(atrib.filter(a => a.id !== id));
  atribSelecionados.delete(id);
  renderAtribuicao(); updateBadges();
  addLeadHistory(lead.id, 'Movido para Fila WhatsApp', lead);
  notify(`✓ ${lead.nome} → Backlog Fila Zap`);
}
function moverParaBacklogZapDoDia(id, day) {
  const data = ensureWeekData();
  const lead = (data.days[day]||[]).find(e => e.id === id);
  if (!lead) { notify('// lead não encontrado','warn'); return; }
  if (!isLeadWhatsappValidatedForQueue(lead)) {
    notify('// valide o WhatsApp antes de enviar para a fila Zap', 'warn');
    return;
  }
  const backlog = getZapBacklog();
  if (backlog.find(b => b.id === id)) { notify('// já está no Backlog ZAP','warn'); return; }
  backlog.push({
    id: lead.id, nome: lead.nome, whatsapp: lead.whatsapp || '',
    instagram: lead.instagram || '', googleUrl: lead.googleUrl || '',
    site: lead.site || '', ramoId: lead.ramoId || null,
    canal: 'zap', criadoEm: lead.criadoEm || todayStr(),
    entradaBacklogEm: todayStr(),
  });
  saveZapBacklog(backlog);
  data.days[day] = data.days[day].filter(e => e.id !== id);
  saveWeekData(data);
  renderInicio(); renderDisparoEmpresas(); updateBadges();
  notify(`↩ ${lead.nome} → Backlog Fila Zap`);
}

function moverParaBacklogInstaDoInsta(id, key) {
  // key = 'week' (vem de um dia do insta) | 'fila' (vem da fila pendente)
  // Para fila pendente, a função existente instaVoltarBacklog não se aplica (já está na fila)
  // Aqui é para mover do dia para o backlog insta — alias para instaVoltarBacklog
  // mas também serve para remover da fila instaFila para voltar ao backlog atrib se necessário.
  // Na prática: do dia de insta → backlog insta já existe (instaVoltarBacklog).
  // Do renderFilaInsta (lista pendente da fila) → não há opção de "backlog", só remover.
  // Não há segundo backlog Insta — a fila pendente IS o backlog.
  notify('// lead já está no backlog Insta', 'warn');
}




/* ════════════════════════════
   MANUAL LEAD (Importar panel)
════════════════════════════ */
let manualValChipId = null;
let manualLeadLastValidation = null;

function normalizeManualWhatsappV42(value) {
  const raw = normalizePhone(value || '');
  if (!raw) return '';
  return raw.startsWith('55') ? raw : `55${raw}`;
}

function manualLeadWasJustValidatedV42(phone) {
  const normalized = normalizeManualWhatsappV42(phone);
  if (!normalized || !manualLeadLastValidation) return false;
  return manualLeadLastValidation.valid === true && manualLeadLastValidation.phone === normalized;
}

function moveUnvalidatedAtribLeadsToValidationV42(leads) {
  const validAtrib = [];
  const toValidation = [];
  leads.forEach(lead => {
    const canal = lead.canal && lead.canal !== 'pendente' ? lead.canal : (lead.whatsapp ? 'zap' : 'insta');
    if (canal === 'zap' && !isLeadWhatsappValidatedForQueue(lead)) {
      toValidation.push({
        ...lead,
        whatsapp: normalizeManualWhatsappV42(lead.whatsapp || lead.phone || lead.telefone || ''),
        phone: normalizeManualWhatsappV42(lead.whatsapp || lead.phone || lead.telefone || ''),
        tipo: lead.tipo || 'sem-site',
        canal: 'zap',
        numStatus: lead.numStatus === 'invalido' ? 'invalido' : 'pendente',
        whatsappValidationStatus: lead.whatsappValidationStatus || 'pending',
        importadoEm: lead.importadoEm || lead.criadoEm || todayStr(),
        origem: lead.origem || 'Atribuição não validada'
      });
    } else {
      validAtrib.push(lead);
    }
  });

  if (!toValidation.length) return leads;

  const val = getValData();
  const existing = new Set(val.map(v => v.id));
  toValidation.forEach(lead => {
    if (!existing.has(lead.id)) val.push(lead);
  });
  saveValData(val);
  saveAtribuicaoData(validAtrib);
  atribSelecionados.clear();
  notify(`↩ ${toValidation.length} lead${toValidation.length !== 1 ? 's' : ''} sem WhatsApp validado voltou para Validação`, 'warn');
  return validAtrib;
}

function renderManualValChips() {
  const chips = getChips();
  const el = document.getElementById('manualValChipTabs');
  if (!el) return;
  if (!chips.length) { el.innerHTML = '<span style="font-size:9px;color:var(--muted)">// nenhum chip configurado</span>'; return; }
  if (!manualValChipId) manualValChipId = chips[0].id;
  el.innerHTML = chips.map(c => `
    <div onclick="manualValChipId='${c.id}';renderManualValChips()"
      style="padding:4px 10px;border-radius:6px;font-family:'DM Mono',monospace;font-size:9px;cursor:pointer;border:1px solid ${manualValChipId===c.id?'var(--accent)':'var(--border2)'};background:${manualValChipId===c.id?'var(--accent-dim)':'var(--bg)'};color:${manualValChipId===c.id?'var(--accent)':'var(--muted)'};transition:all 0.18s">
      ${escHtml(c.nome)}
    </div>`).join('');
}

async function validarNumeroManual() {
  const phone = (document.getElementById('manualLeadPhone')?.value || '').trim();
  const resultEl = document.getElementById('manualValResult');
  const spinnerEl = document.getElementById('manualValSpinner');
  if (!phone) { notify('// insira um número para validar','warn'); return; }
  const chip = getChipById(manualValChipId) || getChips()[0];
  if (!chip) { notify('// nenhum chip configurado','warn'); return; }
  const numero = normalizePhone(phone);
  if (!numero || numero.length < 10) { notify('// número inválido','err'); return; }
  const numFull = numero.startsWith('55') ? numero : '55' + numero;
  if (spinnerEl) spinnerEl.style.display = 'inline-block';
  if (resultEl) resultEl.style.display = 'none';
  try {
    const res = await fetch(`${chip.url}/chat/whatsappNumbers/${chip.instance}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': chip.key },
      body: JSON.stringify({ numbers: [numFull] })
    });
    const data = await res.json();
    const r = Array.isArray(data) ? data[0] : data;
    const valido = r?.exists === true;
    manualLeadLastValidation = { phone: numFull, valid: valido, checkedAt: new Date().toISOString(), chipId: chip.id };
    if (resultEl) {
      resultEl.style.display = 'block';
      resultEl.style.background = valido ? 'rgba(78,203,113,0.1)' : 'rgba(255,92,92,0.1)';
      resultEl.style.border = `1px solid ${valido ? 'rgba(78,203,113,0.3)' : 'rgba(255,92,92,0.3)'}`;
      resultEl.style.color = valido ? 'var(--ok)' : 'var(--error)';
      resultEl.textContent = valido ? '✓ número válido no WhatsApp' : '✗ número não encontrado no WhatsApp';
    }
  } catch(e) {
    notify('// erro ao validar número','err');
  } finally {
    if (spinnerEl) spinnerEl.style.display = 'none';
  }
}

function adicionarLeadManual() {
  const nome = (document.getElementById('manualLeadNome')?.value || '').trim();
  if (!nome) { notify('// nome da empresa é obrigatório','warn'); return; }
  const phoneRaw = (document.getElementById('manualLeadPhone')?.value || '').trim();
  const phone = normalizeManualWhatsappV42(phoneRaw);
  const googleUrl = (document.getElementById('manualLeadGoogleUrl')?.value || '').trim();
  const instagram = (document.getElementById('manualLeadInsta')?.value || '').trim();
  const id = 'manual_' + Date.now();
  const baseLead = {
    id,
    nome,
    whatsapp: phone,
    phone,
    googleUrl,
    instagram,
    site: '',
    ramoId: null,
    canal: phone ? 'zap' : 'insta',
    criadoEm: todayStr(),
    importadoEm: todayStr(),
    origem: 'manual'
  };

  if (phone) {
    const isValidated = manualLeadWasJustValidatedV42(phone);
    if (isValidated) {
      const lead = markLeadWhatsappValidatedForQueue({
        ...baseLead,
        numStatus: 'valido',
        whatsappValidationStatus: 'valid',
        validadoEm: todayStr()
      });
      const atrib = getAtribuicaoData();
      if (!atrib.find(a => a.id === lead.id)) atrib.push(lead);
      saveAtribuicaoData(atrib);
      notify(`✓ ${nome} validado → Base de Atribuição`);
    } else {
      const val = getValData();
      val.push({
        ...baseLead,
        tipo: 'sem-site',
        numStatus: 'pendente',
        whatsappValidationStatus: 'pending'
      });
      saveValData(val);
      notify(`✓ ${nome} → Validação. Valide o WhatsApp antes da atribuição.`);
    }
  } else {
    const lead = { ...baseLead, canal: 'insta' };
    const atrib = getAtribuicaoData();
    if (!atrib.find(a => a.id === lead.id)) atrib.push(lead);
    saveAtribuicaoData(atrib);
    notify(`✓ ${nome} → Atribuição Instagram`);
  }

  // Limpa os campos
  ['manualLeadNome','manualLeadPhone','manualLeadGoogleUrl','manualLeadInsta'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  manualLeadLastValidation = null;
  const resultEl = document.getElementById('manualValResult');
  if (resultEl) resultEl.style.display = 'none';
  renderAtribuicao();
  if (typeof renderValidacao === 'function') renderValidacao();
  updateBadges();
}

/* ════════════════════════════
   ATRIBUIÇÃO — funções INSTA
════════════════════════════ */
function mandarParaFilaInsta(id) {
  const atrib = getAtribuicaoData();
  const lead = atrib.find(a => a.id === id);
  if (!lead) return;
  const inputEl = document.getElementById(`atrib-insta-input-${id}`);
  if (inputEl) lead.instagram = inputEl.value.trim() || lead.instagram || '';
  const fila = getInstaFila();
  if (fila.find(f => f.id === id)) { notify('// já está na Fila Insta','warn'); return; }
  fila.push({
    id: lead.id, nome: lead.nome, instagram: lead.instagram || '',
    googleUrl: lead.googleUrl || '', whatsapp: lead.whatsapp || '',
    status: 'pendente', criadoEm: lead.criadoEm || todayStr(),
  });
  saveInstaFila(fila);
  saveAtribuicaoData(atrib.filter(a => a.id !== id));
  atribSelecionados.delete(id);
  renderAtribuicao(); updateBadges();
  addLeadHistory(lead.id, 'Movido para Fila Instagram', lead);
  notify(`✓ ${lead.nome} → Fila Insta`);
}

function atribPromoverParaZap(id) {
  const atrib = getAtribuicaoData();
  const lead = atrib.find(a => a.id === id);
  if (!lead) return;
  const inputEl = document.getElementById(`atrib-insta-input-${id}`);
  const novoNum = inputEl ? inputEl.value.trim() : '';
  if (!novoNum) { notify('// insira um número WhatsApp no campo e tente novamente','warn'); return; }
  lead.whatsapp = normalizePhone(novoNum);
  lead.canal = 'zap';
  saveAtribuicaoData(atrib);
  renderAtribuicao();
  notify(`✓ ${lead.nome} promovido para ZAP`);
}

/* ════════════════════════════
   FILA ZAP — RENDER BACKLOG
════════════════════════════ */
function renderZapBacklogPanel() {
  // Oculta elementos de dia normal, mostra conteúdo de backlog no disparoEmpresasList
  const statusEl = document.getElementById('disparoStatusTabs');
  const statsEl  = document.getElementById('disparoStats');
  const listEl   = document.getElementById('disparoEmpresasList');

  if (statusEl) statusEl.innerHTML = '';
  if (statsEl)  statsEl.innerHTML  = '';
  if (!listEl)  return;

  const backlog = getZapBacklog();
  if (!backlog.length) {
    listEl.innerHTML = `<div class="fila-empty">// Backlog vazio — mande leads da Atribuição</div>`;
    return;
  }

  listEl.innerHTML = backlog.map(item => `
    <div class="empresa-card" id="backlog-card-${item.id}" style="display:flex;align-items:center;gap:12px;padding:12px 14px">
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
          ${item.googleUrl ? `<a href="${escHtml(item.googleUrl)}" target="_blank" style="color:var(--text);text-decoration:none">${escHtml(item.nome)}</a>` : escHtml(item.nome)}
        </div>
        <div style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted);margin-top:3px">
          ${item.whatsapp ? `📱 ${escHtml(item.whatsapp)}` : '// sem número'} · entrada: ${escHtml(item.entradaBacklogEm||'')}
        </div>
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0">
        ${item.whatsapp ? `
          <a href="https://wa.me/${item.whatsapp.replace(/\D/g,'')}" target="_blank"
            style="background:var(--ok);color:#fff;border:none;border-radius:7px;font-family:'DM Mono',monospace;font-size:9px;font-weight:700;padding:5px 11px;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center">
            📲 Abrir ZAP
          </a>` : ''}
        <button onclick="removerDoBacklogZap('${item.id}')" class="del-btn" title="Remover do backlog">✕</button>
      </div>
    </div>`).join('');
}

function removerDoBacklogZap(id) {
  const backlog = getZapBacklog().filter(b => b.id !== id);
  saveZapBacklog(backlog);
  renderFilaZap(); updateBadges();
  notify('// removido do backlog');
}

