/* ════════════════════════════
   INÍCIO — RENDER
════════════════════════════ */

/* ════════════════════════════
   RENDER INICIO SAFE V40.11
════════════════════════════ */
function renderCommercialDashboardSafeV4011() {
  try {
    if (typeof renderCommercialDashboard === 'function') {
      return renderCommercialDashboard();
    }
    if (typeof renderDashboard === 'function') {
      return renderDashboard();
    }
    return '';
  } catch (e) {
    console.warn('Dashboard comercial ignorado:', e?.message || e);
    return '';
  }
}

function renderInicio() {
  renderCrmHomeDashboard();
  renderHomeProDashboard();
  const data = ensureWeekData();
  const weekDays = currentWeekDays();
  const today = todayStr();
  if (!weekDays.includes(selectedDay)) selectedDay = today;

  document.getElementById('inicioDayTabs').innerHTML = weekDays.map(day => {
    const emps = data.days[day] || [];
    const active = day === selectedDay;
    return `<div class="day-tab${active?' active':''}" onclick="setDay('${day}')">
      ${dayLabel(day)}${day===today?' <span style="color:var(--accent);font-size:8px">●</span>':''}
      ${emps.length>0?`<span class="day-count">${emps.length}</span>`:''}
    </div>`;
  }).join('');

  const emps = data.days[selectedDay] || [];
  const statusCounts = {};
  STATUS_OPTIONS.forEach(s => { statusCounts[s] = emps.filter(e => (e.status||'Não enviada')===s).length; });
  document.getElementById('inicioStatusTabs').innerHTML = STATUS_OPTIONS.map(s =>
    `<div class="status-tab${selectedStatus===s?' active':''}" onclick="setStatus('${s}')">
      ${s} <span class="st-count">${statusCounts[s]}</span>
    </div>`
  ).join('');

  const filtered = emps.filter(e => (e.status||'Não enviada') === selectedStatus);

  // aplicar busca
  const inicioBuscaEl = document.getElementById('inicioBusca');
  const inicioBuscaQ = inicioBuscaEl ? normalizeStr(inicioBuscaEl.value) : '';
  const filteredFinal = inicioBuscaQ
    ? filtered.filter(e => normalizeStr(e.nome||'').includes(inicioBuscaQ) || normalizeStr(e.site||'').includes(inicioBuscaQ) || (e.whatsapp||'').includes(inicioBuscaQ))
    : filtered;

  const totalItems = filteredFinal.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / INICIO_PG));
  if (inicioPage > totalPages) inicioPage = totalPages;
  const pageItems = filteredFinal.slice((inicioPage-1)*INICIO_PG, inicioPage*INICIO_PG);

  const tbody = document.getElementById('inicioTbody');
  if (!totalItems) {
    tbody.innerHTML = `${renderCommercialDashboardSafeV4011()}<tr><td colspan="7" class="table-empty">${inicioBuscaQ ? `Nenhum resultado para "${inicioBuscaEl.value}"` : `Nenhuma empresa com status "${selectedStatus}" neste dia`}</td></tr>`;
  } else {
    tbody.innerHTML = pageItems.map(e => {
      const googleUrl = e.googleUrl || '';
      const nomeDisplay = googleUrl
        ? `<a href="${escHtml(googleUrl)}" target="_blank" title="Ver perfil Google">${escHtml(e.nome)}</a>`
        : escHtml(e.nome);
      const siteVisitado = e.site && isExcludedDomain(e.site);
      const rowStyle = siteVisitado ? 'background:rgba(240,164,41,0.04);border-left:2px solid rgba(240,164,41,0.4);' : '';
      const siteVisitadoBadge = siteVisitado ? `<span title="Site já visitado" style="display:inline-flex;align-items:center;gap:3px;font-family:'DM Mono',monospace;font-size:8px;color:var(--warning);background:rgba(240,164,41,0.1);border:1px solid rgba(240,164,41,0.25);border-radius:4px;padding:1px 5px;margin-left:4px">👁 visto</span>` : '';
      return `<tr style="${rowStyle}">
        <td class="td-name">${nomeDisplay}${siteVisitadoBadge}</td>
        <td>${e.instagram?`<a href="${escHtml(e.instagram)}" target="_blank" class="q-badge insta" style="text-decoration:none">📸</a>`:'<span class="td-missing">—</span>'}</td>
        <td class="td-link">${e.site?`<a href="${escHtml(e.site)}" target="_blank">${escHtml(e.site.replace(/^https?:\/\/(www\.)?/,'').split('/')[0])}</a>`:'<span class="td-missing">—</span>'}</td>
        <td>${e.whatsapp
          ?`<div style="display:flex;align-items:center;gap:5px">
              <a href="${buildWaLink(e.whatsapp)}" target="_blank" style="font-family:'DM Mono',monospace;font-size:9px;color:var(--ok);text-decoration:none">${escHtml(e.whatsapp)}</a>
              <button onclick="editWhatsapp('${e.id}','${selectedDay}')" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:11px;padding:2px 4px;border-radius:4px" title="Editar">✏️</button>
            </div>`
          :`<div style="display:flex;align-items:center;gap:5px">
              <span class="td-missing">—</span>
              <button onclick="editWhatsapp('${e.id}','${selectedDay}')" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:11px;padding:2px 4px;border-radius:4px" title="Adicionar">✏️</button>
            </div>`
        }</td>
        <td><select class="status-select" onchange="updateStatus('${e.id}','${selectedDay}',this.value)">${getStatusOptions(e.status||'Não enviada').map(s=>`<option value="${s}"${(e.status||'Não enviada')===s?' selected':''}>${s}</option>`).join('')}</select></td>
        <td><button class="btn btn-ghost" style="font-size:9px;padding:4px 9px" onclick="showMsg('${e.id}','${selectedDay}')">Msg</button></td>
        <td style="white-space:nowrap">
          <button onclick="moverParaBacklogZapDoDia('${e.id}','${selectedDay}')" title="Mover para Backlog Zap"
            style="background:none;border:1px solid var(--border2);color:var(--muted);border-radius:5px;font-family:'DM Mono',monospace;font-size:9px;padding:3px 8px;cursor:pointer;margin-right:4px;transition:all 0.15s"
            onmouseover="this.style.borderColor='var(--accent)';this.style.color='var(--accent)'"
            onmouseout="this.style.borderColor='var(--border2)';this.style.color='var(--muted)'">↩ Backlog</button>
          <button class="del-btn" onclick="deleteEmpresa('${e.id}','${selectedDay}')">✕</button>
        </td>
      </tr>`;
    }).join('');
  }
  renderPagination('inicioPagination', inicioPage, totalPages, totalItems, INICIO_PG, 'goInicioPage', 'changeInicioPgSize');

  const sel = document.getElementById('exportDaySelect');
  if (sel) sel.innerHTML = '<option value="">Exportar dia...</option>' + weekDays.map(d => `<option value="${d}">${dayLabel(d)}</option>`).join('');
  renderHistory();
  if (typeof renderLeadBasePanel === 'function') renderLeadBasePanel();
  renderExcluidos();
  renderFollowUpsHome();
}

function setDay(day)    { selectedDay = day; selectedStatus = 'Não enviada'; inicioPage = 1; const b=document.getElementById('inicioBusca'); if(b) b.value=''; renderInicio(); }
function setStatus(st)  { selectedStatus = st; inicioPage = 1; const b=document.getElementById('inicioBusca'); if(b) b.value=''; renderInicio(); }

