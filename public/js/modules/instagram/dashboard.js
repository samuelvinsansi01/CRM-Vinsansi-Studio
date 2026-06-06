/* ════════════════════════════
   INSTAGRAM — RENDER PRINCIPAL
════════════════════════════ */

/* ── alocar automaticamente: preenche o dia mais próximo disponível ── */
function instaAlocarAuto(id) {
  const fila = getInstaFila();
  const emp  = fila.find(e => e.id === id);
  if (!emp) return;
  const week = getInstaWeek();
  const days = instaWeekDays();
  const hora = new Date().getHours();
  const hoje = todayStr();
  const hojeIdx = days.indexOf(hoje);

  // Dias disponíveis: apenas de hoje em diante (ou amanhã se após 19h)
  const startIdx = hojeIdx >= 0 ? hojeIdx : 0;
  const diasDisponiveis = hora >= INSTA_CUTOFF_HOUR
    ? days.slice(startIdx + 1)   // após 19h: só de amanhã em diante
    : days.slice(startIdx);      // antes das 19h: de hoje em diante

  const dia = diasDisponiveis.find(d => (week[d]||[]).length < INSTA_DIA_LIMIT);
  if (!dia) { notify('// todos os dias disponíveis estão cheios (60/dia)','warn'); return; }

  if (!week[dia]) week[dia] = [];
  week[dia].push({ ...emp, status: 'Não contatado', instagramUrl: emp.instagram || '', atribuidoEm: todayStr() });
  saveInstaWeek(week);
  saveInstaFila(fila.filter(e => e.id !== id));
  notify(`✓ ${emp.nome} → ${dia}`);
  renderInstagram(); updateBadges();
}

function renderInstagram() {
  renderInstaTabBar();
  renderInstaTabContent();
  updateBadges();
}

/* ── barra de abas ── */
function renderInstaTabBar() {
  const bar = document.getElementById('instaTabBar');
  if (!bar) return;
  const week = getInstaWeek();
  const days = instaWeekDays();
  const backlogCount = getInstaFila().filter(e => !!e.instagram).length;

  const tabStyle = (active, color) => `background:none;border:none;border-bottom:2px solid ${active?color:'transparent'};color:${active?color:'var(--muted)'};font-family:'DM Mono',monospace;font-size:10px;padding:8px 16px;cursor:pointer;font-weight:700;transition:all 0.18s;margin-bottom:-1px;white-space:nowrap`;

  const backlogActive = instaActiveTab === 'backlog';
  let html = `<button onclick="instaSetTab('backlog')" style="${tabStyle(backlogActive,'var(--insta)')}">`
    + `📦 Backlog${backlogCount?` <span style="opacity:0.65;font-weight:400">(${backlogCount})</span>`:''}` + `</button>`;

  days.forEach(day => {
    const count  = instaCountForDay(week, day);
    const active = instaActiveTab === day;
    const dt     = instaParseDay(day);
    const lbl    = dt.toLocaleDateString('pt-BR',{weekday:'short',day:'numeric'}).replace('.','');
    const full   = count >= INSTA_DIA_LIMIT;
    const color  = full ? 'var(--warning)' : 'var(--accent)';
    html += `<button onclick="instaSetTab('${day}')" style="${tabStyle(active, color)}">`
      + `${lbl}${count?` <span style="opacity:0.65;font-weight:400">${count}</span>`:''}` + `</button>`;
  });

  bar.innerHTML = html;
}

function instaSetTab(tab) {
  instaActiveTab = tab;
  instaBacklogPg = 0;
  renderInstagram();
}

/* ── conteúdo da aba ── */
function renderInstaTabContent() {
  const el = document.getElementById('instaTabContent');
  if (!el) return;
  if (instaActiveTab === 'backlog') {
    renderInstaBacklog(el);
  } else {
    renderInstaDia(el, instaActiveTab);
  }
}

/* ── ABA BACKLOG ── */
function renderInstaBacklog(container) {
  // Apenas leads com link do Instagram já confirmado na Atribuição
  const filaAll = getInstaFila().filter(e => !!(e.instagram));

  if (!filaAll.length) {
    container.innerHTML = `<div class="stretch-card" style="flex:1">
      <div style="font-family:'DM Mono',monospace;font-size:10px;color:var(--muted);text-align:center;padding:48px">
        // backlog vazio · confirme o link do Instagram na aba Atribuição para os leads aparecerem aqui
      </div></div>`;
    return;
  }

  const totalPags = Math.max(1, Math.ceil(filaAll.length / INSTA_PAGE_SIZE));
  if (instaBacklogPg >= totalPags) instaBacklogPg = totalPags - 1;
  const page = filaAll.slice(instaBacklogPg * INSTA_PAGE_SIZE, (instaBacklogPg + 1) * INSTA_PAGE_SIZE);

  const rows = page.map(e => {
    const stars   = e.totalScore   ? `⭐ ${Number(e.totalScore).toFixed(1)}` : '';
    const reviews = e.reviewsCount ? `(${e.reviewsCount} av.)` : '';
    const instaUrl = e.instagram || e.instagramUrl || '';
    return `<div style="display:flex;align-items:center;gap:10px;padding:9px 14px;border-bottom:1px solid var(--border)">
      <!-- Nome clicável no instagram -->
      <div style="flex:1;min-width:0">
        ${instaUrl
          ? `<a href="${escHtml(instaUrl)}" target="_blank" style="font-weight:700;font-size:12px;color:var(--text);text-decoration:none" onmouseover="this.style.color='var(--insta)'" onmouseout="this.style.color='var(--text)'">${escHtml(e.nome||'—')}</a>`
          : `<span style="font-weight:700;font-size:12px">${escHtml(e.nome||'—')}</span>`}
        ${stars||e.categoria?`<div style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted);margin-top:1px">${[stars&&(stars+(reviews?` ${reviews}`:'')),'',e.categoria].filter(Boolean).join(' · ')}</div>`:''}
      </div>
      <!-- Botão alocar -->
      <button onclick="instaAlocarAuto('${e.id}')"
        style="background:var(--insta);color:#fff;border:none;border-radius:7px;font-family:'DM Mono',monospace;font-size:9px;font-weight:700;padding:6px 14px;cursor:pointer;white-space:nowrap;flex-shrink:0;transition:opacity 0.18s"
        onmouseover="this.style.opacity='0.82'" onmouseout="this.style.opacity='1'">
        → Alocar
      </button>
      <!-- Excluir -->
      <button onclick="excluirInstaFila('${e.id}')" title="Excluir"
        style="background:none;border:1px solid transparent;color:var(--muted);border-radius:6px;font-size:11px;padding:4px 8px;cursor:pointer;flex-shrink:0;transition:all 0.18s"
        onmouseover="this.style.borderColor='var(--error)';this.style.color='var(--error)';this.style.background='rgba(255,92,92,0.06)'"
        onmouseout="this.style.borderColor='transparent';this.style.color='var(--muted)';this.style.background='none'">✕</button>
    </div>`;
  }).join('');

  const pag = totalPags > 1 ? `<div style="display:flex;gap:6px;justify-content:center;padding:12px;flex-wrap:wrap">
    ${instaBacklogPg>0?`<button class="btn btn-ghost" style="font-size:9px;padding:5px 12px" onclick="instaBacklogPg--;renderInstaTabContent()">← Anterior</button>`:''}
    <span style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted);align-self:center">${instaBacklogPg+1} / ${totalPags}</span>
    ${instaBacklogPg<totalPags-1?`<button class="btn btn-ghost" style="font-size:9px;padding:5px 12px" onclick="instaBacklogPg++;renderInstaTabContent()">Próxima →</button>`:''}
  </div>` : '';

  container.innerHTML = `<div class="stretch-card" style="flex:1;display:flex;flex-direction:column;min-height:0;overflow:hidden">
    <div class="card-title" style="flex-shrink:0">
      Backlog
      <span style="font-size:10px;color:var(--muted);font-weight:400;text-transform:none;letter-spacing:0">· ${filaAll.length} empresa${filaAll.length>1?'s':''} aguardando</span>
    </div>
    <div style="flex:1;overflow-y:auto">${rows}</div>
    ${pag}
  </div>`;
}

/* ── ABA DIA ── */
function renderInstaDia(container, day) {
  const week  = getInstaWeek();
  const leads = week[day] || [];
  const full  = leads.length >= INSTA_DIA_LIMIT;
  const statusColor = { 'Não contatado':'var(--muted)', 'DM Enviada':'var(--insta)', 'Respondeu':'var(--ok)', 'Não respondeu':'var(--muted)', 'Fechou':'var(--ok)', 'Recusou':'var(--error)' };

  const header = `<div class="card-title" style="flex-shrink:0">
    Leads do dia
    <span style="font-size:10px;color:${full?'var(--warning)':'var(--muted)'};font-weight:400;text-transform:none;letter-spacing:0">· ${leads.length}/${INSTA_DIA_LIMIT}</span>
    <button onclick="instaLimparDia('${day}')"
      style="margin-left:auto;background:none;border:1px solid var(--border2);color:var(--muted);border-radius:6px;font-family:'DM Mono',monospace;font-size:8px;padding:3px 9px;cursor:pointer"
      onmouseover="this.style.color='var(--error)';this.style.borderColor='var(--error)'"
      onmouseout="this.style.color='var(--muted)';this.style.borderColor='var(--border2)'">Limpar dia</button>
  </div>`;

  if (!leads.length) {
    container.innerHTML = `<div class="stretch-card" style="flex:1;display:flex;flex-direction:column;min-height:0">${header}
      <div style="font-family:'DM Mono',monospace;font-size:10px;color:var(--muted);text-align:center;padding:48px">// nenhum lead atribuído neste dia</div>
    </div>`; return;
  }

  const rows = leads.map((e, i) => {
    const stColor = statusColor[e.status] || 'var(--muted)';
    const instaUrl = e.instagramUrl || e.instagram || '';
    return `<div style="display:flex;align-items:center;gap:8px;padding:9px 14px;border-bottom:1px solid var(--border)">
      <span style="font-family:'DM Mono',monospace;font-size:8px;color:var(--muted);width:18px;flex-shrink:0">${i+1}.</span>
      <!-- Nome = link direto para o instagram -->
      <div style="flex:1;min-width:0">
        ${instaUrl
          ? `<a href="${escHtml(instaUrl)}" target="_blank" style="font-weight:700;font-size:12px;color:var(--text);text-decoration:none" onmouseover="this.style.color='var(--insta)'" onmouseout="this.style.color='var(--text)'" title="Abrir Instagram">${escHtml(e.nome||'—')}</a>`
          : `<span style="font-weight:700;font-size:12px;color:var(--text2)">${escHtml(e.nome||'—')}</span>`}
        ${e.categoria?`<div style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted);margin-top:1px">${escHtml(e.categoria)}</div>`:''}
      </div>
      <!-- Ações -->
      <div style="display:flex;align-items:center;gap:5px;flex-shrink:0">
        <!-- Copiar mensagem -->
        <button onclick="copiarInstaMsg('${escHtml(e.nome||'').replace(/'/g,"\\'")}')" title="Copiar mensagem"
          style="background:none;border:1px solid rgba(225,48,108,0.3);color:var(--insta);border-radius:6px;font-size:13px;padding:3px 8px;cursor:pointer;transition:all 0.18s;flex-shrink:0"
          onmouseover="this.style.background='rgba(225,48,108,0.1)'"
          onmouseout="this.style.background='none'">📋</button>
        <!-- Select status -->
        <select onchange="instaUpdateStatus('${e.id}','${day}',this.value)"
          style="font-family:'DM Mono',monospace;font-size:8px;padding:3px 6px;background:var(--surface2);border:1px solid var(--border2);border-radius:6px;color:${stColor};outline:none;cursor:pointer">
          ${INSTA_STATUS.map(s => `<option value="${s}" ${e.status===s?'selected':''}>${s}</option>`).join('')}
        </select>
        ${e.dmEnviadaEm?`<span style="font-family:'DM Mono',monospace;font-size:8px;color:var(--muted);white-space:nowrap">${e.dmEnviadaEm}</span>`:''}
        <!-- Voltar para backlog -->
        <button onclick="instaVoltarBacklog('${e.id}','${day}')" title="Voltar para o backlog"
          style="background:none;border:1px solid var(--border2);color:var(--muted);border-radius:6px;font-family:'DM Mono',monospace;font-size:9px;padding:3px 7px;cursor:pointer;transition:all 0.15s"
          onmouseover="this.style.borderColor='var(--insta)';this.style.color='var(--insta)'"
          onmouseout="this.style.borderColor='var(--border2)';this.style.color='var(--muted)'">↩</button>
        <!-- Excluir -->
        <button onclick="abrirModalExcluirInstaLead('${e.id}','${day}')" title="Excluir permanentemente"
          style="background:none;border:1px solid transparent;color:var(--muted);border-radius:6px;font-size:10px;padding:3px 7px;cursor:pointer;transition:all 0.18s"
          onmouseover="this.style.borderColor='var(--error)';this.style.color='var(--error)';this.style.background='rgba(255,92,92,0.06)'"
          onmouseout="this.style.borderColor='transparent';this.style.color='var(--muted)';this.style.background='none'">✕</button>
      </div>
    </div>`;
  }).join('');

  container.innerHTML = `<div class="stretch-card" style="flex:1;display:flex;flex-direction:column;min-height:0;overflow:hidden">
    ${header}
    <div style="flex:1;overflow-y:auto">${rows}</div>
  </div>`;
}

/* ── VOLTAR PARA BACKLOG ── */
function instaVoltarBacklog(id, day) {
  const week = getInstaWeek();
  const lead = (week[day]||[]).find(e => e.id === id);
  if (!lead) return;
  week[day] = week[day].filter(e => e.id !== id);
  saveInstaWeek(week);
  const fila = getInstaFila();
  if (!fila.find(e => e.id === id)) {
    const { status, instagramUrl, atribuidoEm, dmEnviadaEm, ...base } = lead;
    // Garante que e.instagram (usado pelo backlog) está presente
    if (!base.instagram && instagramUrl) base.instagram = instagramUrl;
    saveInstaFila([...fila, base]);
  }
  renderInstagram();
  notify(`↩ ${lead.nome} voltou ao backlog`);
}

/* ── EXCLUIR DO BACKLOG ── */
function excluirInstaFila(id) {
  const fila = getInstaFila();
  const lead = fila.find(e => e.id === id);
  if (!lead) return;
  abrirModalConfirm(
    `Excluir <strong>${escHtml(lead.nome)}</strong> permanentemente?`,
    () => {
      saveInstaFila(getInstaFila().filter(e => e.id !== id));
      renderInstagram(); updateBadges();
      notify(`✕ ${lead.nome} excluído`);
    }
  );
}

/* ── STATUS ── */
function instaUpdateStatus(id, day, status) {
  const week = getInstaWeek();
  const lead = (week[day]||[]).find(e => e.id === id);
  if (!lead) return;
  lead.status = status;
  if (status === 'DM Enviada' && !lead.dmEnviadaEm) lead.dmEnviadaEm = todayStr();
  saveInstaWeek(week);
  renderInstaDia(document.getElementById('instaTabContent'), day);
  notify(`✓ ${status}`);
}

/* ── LIMPAR DIA ── */
function instaLimparDia(day) {
  const week  = getInstaWeek();
  const leads = week[day] || [];
  const naoContatados = leads.filter(e => !e.status || e.status === 'Não contatado');
  const outros = leads.filter(e => e.status && e.status !== 'Não contatado');
  const aviso = naoContatados.length
    ? `<br><br><span style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted)">${naoContatados.length} "Não contatado" voltarão ao backlog. ${outros.length} com status ficam no histórico.</span>`
    : '';
  abrirModalConfirm(`Limpar todos os leads de <strong>${day}</strong>?${aviso}`, () => {
    const w = getInstaWeek();
    const STATUS_HIST = ['DM Enviada','Respondeu','Não respondeu','Fechou','Recusou'];
    const paraMes = (w[day]||[]).filter(e => STATUS_HIST.includes(e.status||''));
    if (paraMes.length) migrarInstaParaMes(paraMes);
    const voltam = (w[day]||[]).filter(e => !e.status || e.status === 'Não contatado');
    if (voltam.length) {
      const filaAtual = getInstaFila();
      const filaIds   = new Set(filaAtual.map(f => f.id));
      const novos = voltam.filter(e => !filaIds.has(e.id))
        .map(({ status, instagramUrl, atribuidoEm, dmEnviadaEm, ...base }) => ({ ...base, instagram: base.instagram || instagramUrl || '', voltouEm: todayStr() }));
      saveInstaFila([...filaAtual, ...novos]);
    }
    delete w[day]; saveInstaWeek(w);
    instaActiveTab = 'backlog';
    renderInstagram(); renderAtribInstaFila(); updateBadges();
    let msg = `✓ Dia ${day} limpo`;
    if (voltam.length)  msg += ` · ${voltam.length} → backlog`;
    if (paraMes.length) msg += ` · ${paraMes.length} → acompanhamento`;
    notify(msg);
  });
}

/* ── EXCLUIR LEAD DO DIA ── */
function abrirModalExcluirInstaLead(id, day) {
  const week = getInstaWeek();
  const lead = (week[day]||[]).find(e => e.id === id);
  if (!lead) return;
  abrirModalConfirm(
    `Excluir <strong>${escHtml(lead.nome)}</strong> permanentemente?`,
    () => {
      const w = getInstaWeek();
      if (w[day]) { w[day] = w[day].filter(e => e.id !== id); saveInstaWeek(w); }
      saveInstaFila(getInstaFila().filter(e => e.id !== id));
      if (lead.site) addExcludedDomains([lead.site]);
      renderInstagram(); updateBadges();
      notify(`✕ ${lead.nome} excluído`);
    }
  );
}

/* ── MIGRAR PARA ACOMPANHAMENTO ── */
function migrarInstaParaMes(leads) {
  const data = getAcompData();
  const mk   = currentMonthKey();
  if (!data[mk]) data[mk] = {};
  if (!data[mk].instagram) data[mk].instagram = [];
  const existingIds = new Set(data[mk].instagram.map(e => e.id));
  const novos = leads.filter(e => !existingIds.has(e.id)).map(e => ({ ...e, migradoEm: todayStr(), fonte: 'instagram' }));
  data[mk].instagram = [...data[mk].instagram, ...novos];
  saveAcompData(data);
}

