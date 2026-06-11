/* ════════════════════════════
   EXCEL EXPORT
════════════════════════════ */
function buildSheet(wb, sheetName, rows) {
  const headers = ['Empresa','Site','WhatsApp','Status','Criado em','Enviado em'];
  const aoa = [headers, ...rows.map(e => [e.nome||'', e.site||'', e.whatsapp||'', e.status||'Não enviada', e.criadoEm||'', e.enviadoEm||''])];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{wch:30},{wch:36},{wch:22},{wch:16},{wch:12},{wch:12}];
  XLSX.utils.book_append_sheet(wb, ws, sheetName.substring(0,31));
}
function downloadWb(wb, filename) {
  try {
    XLSX.writeFile(wb, filename);
  } catch(e) {
    try {
      const out = XLSX.write(wb, {bookType:'xlsx', type:'array'});
      const blob = new Blob([out], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch(e2) { notify('// erro ao gerar Excel: ' + e2.message, 'err'); }
  }
}
function exportExcel() {
  const data = ensureWeekData(); const weekDays = currentWeekDays();
  if (!weekDays.some(d => (data.days[d]||[]).length > 0)) { notify('Nenhuma empresa para exportar','err'); return; }
  const wb = XLSX.utils.book_new();
  weekDays.forEach(day => { if ((data.days[day]||[]).length) buildSheet(wb, dayLabelShort(day), data.days[day]); });
  downloadWb(wb, `prospeccao-semana.xlsx`); notify('✓ Excel gerado');
}
function exportExcelDay() {
  const day = document.getElementById('exportDaySelect').value; if (!day) { notify('Selecione um dia','warn'); return; }
  const data = ensureWeekData(); const rows = data.days[day]||[];
  if (!rows.length) { notify('Nenhuma empresa neste dia','err'); return; }
  const wb = XLSX.utils.book_new(); buildSheet(wb, dayLabelShort(day), rows);
  downloadWb(wb, `prospeccao-${day.replace(/\//g,'-')}.xlsx`); notify(`✓ Excel gerado`);
}
function exportExcelHistory() {
  const hist = getHistoryData(); if (!hist) { notify('Nenhum histórico','err'); return; }
  const wb = XLSX.utils.book_new();
  Object.keys(hist.days).sort().forEach(day => { if ((hist.days[day]||[]).length) buildSheet(wb, dayLabelShort(day), hist.days[day]); });
  downloadWb(wb, `prospeccao-anterior.xlsx`); notify('✓ Excel histórico gerado');
}

/* ════════════════════════════
   ACOMPANHAMENTO — RENDER
════════════════════════════ */
let acompTab        = 'lista';
let acompMes        = currentMonthKey();
let acompMesMetricas = currentMonthKey();
let acompFiltroSt   = null; // null = todos
let acompFollowFiltro = 'todos'; // todos | hoje | atrasados | proximos
let acompPage       = 1; let ACOMP_PG = 20;

function setAcompTab(tab) {
  acompTab = tab;
  document.getElementById('acompPainelLista').style.display    = tab==='lista'    ? 'flex' : 'none';
  document.getElementById('acompPainelMetricas').style.display = tab==='metricas' ? 'flex' : 'none';
  const bLista    = document.getElementById('acompTabLista');
  const bMetricas = document.getElementById('acompTabMetricas');
  bLista.style.borderColor    = tab==='lista'    ? 'var(--accent-border)' : 'var(--border2)';
  bLista.style.background     = tab==='lista'    ? 'var(--accent-dim)'    : 'var(--bg)';
  bLista.style.color          = tab==='lista'    ? 'var(--accent)'        : 'var(--muted)';
  bMetricas.style.borderColor = tab==='metricas' ? 'var(--accent-border)' : 'var(--border2)';
  bMetricas.style.background  = tab==='metricas' ? 'var(--accent-dim)'    : 'var(--bg)';
  bMetricas.style.color       = tab==='metricas' ? 'var(--accent)'        : 'var(--muted)';
  if (tab==='metricas') renderAcompMetricas();
  else renderAcompLista();
}

function renderAcompanhamento() {
  // Verificar leads elegíveis na semana atual para o banner de migração
  const STATUS_MENSAIS = ['Enviada','Respondida','Não respondida','Recusada','Fechada'];
  const data = ensureWeekData();
  const flat = flattenWeekData(data);
  const elegiveis = flat.filter(e => STATUS_MENSAIS.includes(e.status||''));

  // Checar quais ainda não estão no acompanhamento deste mês
  const acomp = getAcompData();
  const mk = currentMonthKey();
  const jaNoMes = new Set((acomp[mk]||[]).map(e => e.id));
  const novosElegiveis = elegiveis.filter(e => !jaNoMes.has(e.id));

  const banner = document.getElementById('acompMigracaoBanner');
  if (novosElegiveis.length > 0) {
    banner.style.display = 'flex';
    const porStatus = {};
    novosElegiveis.forEach(e => { porStatus[e.status] = (porStatus[e.status]||0) + 1; });
    const desc = Object.entries(porStatus).map(([s,n]) => `${n} ${s}`).join(' · ');
    document.getElementById('acompMigracaoDesc').textContent = `${novosElegiveis.length} lead${novosElegiveis.length!==1?'s':''} com status pós-envio ainda não importados → ${desc}`;
  } else {
    banner.style.display = 'none';
  }

  setAcompTab(acompTab);
}

function migrarLeadsAtuais() {
  const STATUS_MENSAIS = ['Enviada','Respondida','Não respondida','Recusada','Fechada'];
  const data = ensureWeekData();
  const flat = flattenWeekData(data);
  const elegiveis = flat.filter(e => STATUS_MENSAIS.includes(e.status||''));

  const acomp = getAcompData();
  const mk = currentMonthKey();
  const jaNoMes = new Set((acomp[mk]||[]).map(e => e.id));
  const novos = elegiveis.filter(e => !jaNoMes.has(e.id)).map(e => ({ ...e, migradoEm: todayStr() }));

  if (!novos.length) { notify('// nenhum lead novo para importar','warn'); return; }

  if (!acomp[mk]) acomp[mk] = [];
  acomp[mk] = [...acomp[mk], ...novos];
  saveAcompData(acomp);

  updateBadges();
  renderAcompanhamento();
  notify(`✓ ${novos.length} lead${novos.length!==1?'s':''} importados para Acompanhamento`);
}

function renderAcompMesesTabs(containerId, activeMes, onClickFn) {
  const data = getAcompData();
  const meses = Object.keys(data).sort().reverse();
  const mk = currentMonthKey();
  // garantir mês atual mesmo sem dados
  if (!meses.includes(mk)) meses.unshift(mk);
  document.getElementById(containerId).innerHTML = meses.map(m =>
    `<div class="day-tab${m===activeMes?' active':''}" onclick="${onClickFn}('${m}')" style="font-size:9px;padding:4px 12px">
      ${monthKeyLabel(m)}${m===mk?' <span style="color:var(--accent);font-size:8px">●</span>':''}
      <span class="day-count">${(data[m]||[]).length}</span>
    </div>`
  ).join('');
}

function setAcompMes(m) {
  acompMes = m;
  acompFiltroSt = null;
  acompFollowFiltro = 'todos';
  acompPage = 1;
  const b = document.getElementById('acompBusca'); if (b) b.value = '';
  renderAcompLista();
}

function setAcompMesMetricas(m) {
  acompMesMetricas = m;
  renderAcompMetricas();
}

function setAcompFiltro(st) {
  acompFiltroSt = (acompFiltroSt === st) ? null : st;
  acompPage = 1;
  renderAcompLista();
}

function setAcompFollowFiltro(filtro) {
  acompFollowFiltro = filtro || 'todos';
  acompPage = 1;
  renderAcompLista();
}

function renderAcompFollowTabs(leads) {
  const el = document.getElementById('acompFollowTabs');
  if (!el) return;

  const counts = { todos: leads.length, hoje: 0, atrasados: 0, proximos: 0 };
  leads.forEach(lead => {
    const crm = ensureLeadCrm(lead.id, lead);
    const bucket = getFollowUpBucket(crm.followUpDate || '');
    if (bucket === 'today') counts.hoje++;
    if (bucket === 'late') counts.atrasados++;
    if (bucket === 'upcoming') counts.proximos++;
  });

  const tabs = [
    ['todos', 'Todos', counts.todos],
    ['hoje', 'Hoje', counts.hoje],
    ['atrasados', 'Atrasados', counts.atrasados],
    ['proximos', 'Próximos', counts.proximos],
  ];

  el.innerHTML = tabs.map(([id, label, count]) => `
    <div class="status-tab${acompFollowFiltro===id?' active':''}" onclick="setAcompFollowFiltro('${id}')" style="font-size:8px;padding:3px 10px">
      ${label} <span class="st-count">${count}</span>
    </div>
  `).join('');
}

function renderAcompLista() {
  renderAcompMesesTabs('acompMesesTabs', acompMes, 'setAcompMes');
  const data = getAcompData();
  const leads = (data[acompMes]||[]).slice().reverse(); // mais recente primeiro
  const STATUS_ACOMP = ['Enviada','Respondida','Não respondida','Recusada','Fechada'];

  // filtro de status
  const counts = {};
  STATUS_ACOMP.forEach(s => { counts[s] = leads.filter(e => (e.status||'Enviada')===s).length; });
  document.getElementById('acompFiltroStatus').innerHTML = STATUS_ACOMP.map(s =>
    `<div class="status-tab${acompFiltroSt===s?' active':''}" onclick="setAcompFiltro('${s}')" style="font-size:8px;padding:3px 10px">
      ${s} <span class="st-count">${counts[s]}</span>
    </div>`
  ).join('');

  let filtered = acompFiltroSt ? leads.filter(e => (e.status||'Enviada')===acompFiltroSt) : leads;

  renderAcompFollowTabs(leads);

  if (acompFollowFiltro && acompFollowFiltro !== 'todos') {
    filtered = filtered.filter(e => {
      const crm = ensureLeadCrm(e.id, e);
      const bucket = getFollowUpBucket(crm.followUpDate || '');
      if (acompFollowFiltro === 'hoje') return bucket === 'today';
      if (acompFollowFiltro === 'atrasados') return bucket === 'late';
      if (acompFollowFiltro === 'proximos') return bucket === 'upcoming';
      return true;
    });
  }

  // busca
  const buscaEl = document.getElementById('acompBusca');
  const buscaQ  = buscaEl ? normalizeStr(buscaEl.value) : '';
  const filteredFinal = buscaQ
    ? filtered.filter(e => normalizeStr(e.nome||'').includes(buscaQ) || normalizeStr(e.site||'').includes(buscaQ) || (e.whatsapp||'').includes(buscaQ))
    : filtered;

  const totalItems = filteredFinal.length;
  const totalPages = Math.max(1, Math.ceil(totalItems/ACOMP_PG));
  if (acompPage > totalPages) acompPage = totalPages;
  const pageItems = filteredFinal.slice((acompPage-1)*ACOMP_PG, acompPage*ACOMP_PG);

  const tbody = document.getElementById('acompTbody');
  if (!totalItems) {
    tbody.innerHTML = `<tr><td colspan="6" class="table-empty">${buscaQ ? `Nenhum resultado para "${buscaEl.value}"` : `Nenhum lead neste mês${acompFiltroSt?' com este status':''}`}</td></tr>`;
  } else {
    tbody.innerHTML = pageItems.map(e => {
      const statusOpts = ['Enviada','Respondida','Não respondida','Recusada','Fechada'];
      return `<tr>
        <td class="td-name">${e.googleUrl?`<a href="${escHtml(e.googleUrl)}" target="_blank">${escHtml(e.nome)}</a>`:escHtml(e.nome)}</td>
        <td class="td-link">${e.site?`<a href="${escHtml(e.site)}" target="_blank">${escHtml(e.site.replace(/^https?:\/\/(www\.)?/,'').split('/')[0])}</a>`:'<span class="td-missing">—</span>'}</td>
        <td style="font-family:'DM Mono',monospace;font-size:9px">${e.whatsapp?`<a href="${buildWaLink(e.whatsapp)}" target="_blank" style="color:var(--ok);text-decoration:none">${escHtml(e.whatsapp)}</a>`:'—'}</td>
        <td style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted)">${e.enviadoEm||e.migradoEm||'—'}</td>
        <td>${(() => { const crm = ensureLeadCrm(e.id, e); const info = getFollowUpInfo(crm.followUpDate || ''); return `<span class="lead-followup-status ${info.className}" style="display:inline-flex">${escHtml(info.label)}</span>`; })()}</td>
        <td><select class="status-select" onchange="updateAcompStatus('${e.id}','${acompMes}',this.value)">
          ${statusOpts.map(s=>`<option value="${s}"${(e.status||'Enviada')===s?' selected':''}>${s}</option>`).join('')}
        </select></td>
        <td style="white-space:nowrap">
          <button class="lead-drawer-open-btn" onclick="openLeadDrawer('${e.id}')">Ficha</button>
          <button class="del-btn" title="Remover do acompanhamento" onclick="deleteAcompLead('${e.id}','${acompMes}')">✕</button>
        </td>
      </tr>`;
    }).join('');
  }
  renderPagination('acompPagination', acompPage, totalPages, totalItems, ACOMP_PG, 'goAcompPage', 'changeAcompPgSize');
}

function goAcompPage(p)       { acompPage=p; renderAcompLista(); }
function changeAcompPgSize(n) { ACOMP_PG=n; acompPage=1; renderAcompLista(); }

function updateAcompStatus(id, mes, status) {
  const data = getAcompData();
  if (!data[mes]) return;
  const lead = data[mes].find(e => e.id === id);
  if (!lead) return;
  lead.status = status;
  saveAcompData(data);
  renderAcompLista();
  updateBadges();
  notify(`✓ Status atualizado: ${status}`);
}

function deleteAcompLead(id, mes) {
  const data = getAcompData();
  if (!data[mes]) return;
  const lead = data[mes].find(e => e.id === id);
  abrirModalConfirm(
    `Remover <strong>${lead ? escHtml(lead.nome) : 'este lead'}</strong> do acompanhamento?`,
    () => {
      const d = getAcompData();
      if (!d[mes]) return;
      d[mes] = d[mes].filter(e => e.id !== id);
      saveAcompData(d);
      renderAcompLista();
      updateBadges();
      notify('Lead removido do acompanhamento');
    }
  );
}

function renderAcompMetricas() {
  renderAcompMesesTabs('acompMesesTabsMetricas', acompMesMetricas, 'setAcompMesMetricas');
  const data = getAcompData();
  const leads = data[acompMesMetricas] || [];
  const total = leads.length;
  const resp  = leads.filter(e => e.status==='Respondida').length;
  const nresp = leads.filter(e => e.status==='Não respondida').length;
  const fech  = leads.filter(e => e.status==='Fechada').length;
  const recus = leads.filter(e => e.status==='Recusada').length;
  const env   = leads.filter(e => e.status==='Enviada').length;
  const txResp = total ? Math.round((resp/total)*100) : 0;
  const txFech = resp  ? Math.round((fech/resp)*100)  : 0;

  document.getElementById('acompStatsRow').innerHTML = `
    <div class="stat-chip"><div class="stat-chip-val">${total}</div><div class="stat-chip-label">TOTAL ENVIADOS</div></div>
    <div class="stat-chip"><div class="stat-chip-val" style="color:var(--accent)">${env}</div><div class="stat-chip-label">AGUARDANDO RESP.</div></div>
    <div class="stat-chip"><div class="stat-chip-val" style="color:var(--ok)">${resp}</div><div class="stat-chip-label">RESPONDIDAS</div></div>
    <div class="stat-chip"><div class="stat-chip-val" style="color:var(--muted)">${nresp}</div><div class="stat-chip-label">NÃO RESPONDIDAS</div></div>
    <div class="stat-chip"><div class="stat-chip-val" style="color:var(--error)">${recus}</div><div class="stat-chip-label">RECUSADAS</div></div>
    <div class="stat-chip"><div class="stat-chip-val" style="color:var(--ok)">${fech}</div><div class="stat-chip-label">FECHADAS</div></div>
    <div class="stat-chip"><div class="stat-chip-val" style="color:var(--accent)">${txResp}%</div><div class="stat-chip-label">TAXA DE RESPOSTA</div></div>
    <div class="stat-chip"><div class="stat-chip-val" style="color:var(--ok)">${txFech}%</div><div class="stat-chip-label">CONVERSÃO (resp→fecha)</div></div>
  `;

  // Comparativo por mês
  const meses = Object.keys(data).sort();
  if (meses.length > 1) {
    document.getElementById('acompComparativoCard').style.display = 'block';
    document.getElementById('acompComparativoTabela').innerHTML = `
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>Mês</th><th>Enviados</th><th>Respondidos</th><th>Não resp.</th><th>Recusados</th><th>Fechados</th><th>Tx. resposta</th><th>Tx. fechamento</th>
          </tr></thead>
          <tbody>
            ${meses.map(m => {
              const ls = data[m]||[];
              const t  = ls.length;
              const r  = ls.filter(e=>e.status==='Respondida').length;
              const f  = ls.filter(e=>e.status==='Fechada').length;
              const nr = ls.filter(e=>e.status==='Não respondida').length;
              const rc = ls.filter(e=>e.status==='Recusada').length;
              const tr = t ? Math.round((r/t)*100) : 0;
              const tf = r ? Math.round((f/r)*100) : 0;
              const isActive = m===acompMesMetricas;
              return `<tr style="${isActive?'background:var(--accent-dim);':''}">
                <td style="font-family:'DM Mono',monospace;font-size:9px;font-weight:700;color:${isActive?'var(--accent)':'var(--text2)'}">${monthKeyLabel(m)}</td>
                <td style="font-family:'DM Mono',monospace;font-size:10px">${t}</td>
                <td style="font-family:'DM Mono',monospace;font-size:10px;color:var(--ok)">${r}</td>
                <td style="font-family:'DM Mono',monospace;font-size:10px;color:var(--muted)">${nr}</td>
                <td style="font-family:'DM Mono',monospace;font-size:10px;color:var(--error)">${rc}</td>
                <td style="font-family:'DM Mono',monospace;font-size:10px;color:var(--ok)">${f}</td>
                <td style="font-family:'DM Mono',monospace;font-size:10px;color:var(--accent);font-weight:700">${tr}%</td>
                <td style="font-family:'DM Mono',monospace;font-size:10px;color:var(--ok);font-weight:700">${tf}%</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;
  } else {
    document.getElementById('acompComparativoCard').style.display = meses.length > 1 ? 'block' : 'none';
  }
}

/* ════════════════════════════
   EXCLUIR LEAD — TOTAL
════════════════════════════ */
let _excluirLeadId  = null;
let _excluirLeadDay = null;

function abrirModalExcluirLead(id, day) {
  const data = ensureWeekData();
  const emp  = (data.days[day]||[]).find(e => e.id === id);
  if (!emp) return;
  _excluirLeadId  = id;
  _excluirLeadDay = day;

  document.getElementById('excluirLeadNome').textContent = emp.nome;

  // Calcular reposição prévia para mostrar no modal
  const limite   = getDailyLimit();
  const totalDia = (data.days[day]||[]).length;
  const faltarão = Math.max(0, limite - (totalDia - 1)); // após remover 1
  const infoEl   = document.getElementById('excluirLeadReposicaoInfo');

  if (faltarão > 0) {
    const substituto = encontrarSubstituto(day, data);
    if (substituto) {
      infoEl.style.display = 'block';
      infoEl.textContent   = `↑ Reposição automática: "${substituto.nome}" (${dayLabel(substituto.diaOrigem)}) será movido para hoje.`;
    } else {
      infoEl.style.display = 'block';
      infoEl.style.color   = 'var(--muted)';
      infoEl.textContent   = '// nenhum lead disponível nos dias seguintes para reposição.';
    }
  } else {
    infoEl.style.display = 'none';
  }

  document.getElementById('excluirLeadModal').classList.add('open');
}

function encontrarSubstituto(day, data) {
  // Percorre dias seguintes na semana procurando o primeiro lead "Não enviada"
  const weekDays = currentWeekDays();
  const idx = weekDays.indexOf(day);
  for (let i = idx + 1; i < weekDays.length; i++) {
    const nextDay = weekDays[i];
    const leads   = data.days[nextDay] || [];
    const cand    = leads.find(e => (e.status||'Não enviada') === 'Não enviada' && isLeadWhatsappValidatedForQueue(e));
    if (cand) return { ...cand, diaOrigem: nextDay };
  }
  return null;
}

function confirmarExcluirLead() {
  const id  = _excluirLeadId;
  const day = _excluirLeadDay;
  if (!id || !day) return;

  document.getElementById('excluirLeadModal').classList.remove('open');

  const data = ensureWeekData();
  const emp  = (data.days[day]||[]).find(e => e.id === id);
  if (!emp) return;

  const limite   = getDailyLimit();
  const totalDia = (data.days[day]||[]).length;

  // 1. Remover de todas as fontes
  // a) semana atual
  Object.keys(data.days).forEach(d => {
    data.days[d] = (data.days[d]||[]).filter(e => e.id !== id);
  });
  saveWeekData(data);

  // b) base de atribuição
  saveAtribuicaoData(getAtribuicaoData().filter(e => e.id !== id));

  // c) validação
  saveValData(getValData().filter(e => e.id !== id));

  // d) filas de disparo dos chips (in-memory + localStorage)
  const chips = getChips();
  chips.forEach(c => {
    if (filaDisparo[c.id]) {
      filaDisparo[c.id] = filaDisparo[c.id].filter(f => f.id !== id);
    }
  });
  saveFilaDisparo();

  // e) adicionar site à lista de já vistos
  if (emp.site) addExcludedDomains([emp.site]);

  // 2. Reposição automática se o dia ficou abaixo do limite
  const weekDays = currentWeekDays();
  const dataAtual = ensureWeekData(); // recarregar após salvar
  const faltam = limite - (dataAtual.days[day]||[]).length;

  let repostos = 0;
  for (let qtd = 0; qtd < faltam; qtd++) {
    const sub = encontrarSubstituto(day, dataAtual);
    if (!sub) break;
    // Move do dia de origem para o dia atual
    dataAtual.days[sub.diaOrigem] = (dataAtual.days[sub.diaOrigem]||[]).filter(e => e.id !== sub.id);
    if (!dataAtual.days[day]) dataAtual.days[day] = [];
    const { diaOrigem, ...leadLimpo } = sub;
    dataAtual.days[day].push(leadLimpo);
    repostos++;
  }
  if (repostos > 0) saveWeekData(dataAtual);

  renderFilaZap();
  renderInicio();
  updateBadges();

  const msgs = [`✕ ${emp.nome} excluído`];
  if (emp.site) msgs.push(extractDomain(emp.site)||emp.site);
  if (repostos > 0) msgs.push(`${repostos} lead${repostos>1?'s':''} reposto${repostos>1?'s':''}`);
  notify(msgs.join(' · '));

  _excluirLeadId  = null;
  _excluirLeadDay = null;
}

