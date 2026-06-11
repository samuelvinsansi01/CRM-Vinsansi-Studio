/* ════════════════════════════
   FOLLOWUP CENTER V14
════════════════════════════ */
let followupFilter = 'hoje';

function dateOnlyToday() {
  return new Date().toISOString().slice(0,10);
}

function addDaysIso(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0,10);
}

function getFollowupStatusInfo(dateIso) {
  const today = dateOnlyToday();
  if (!dateIso) return { key:'none', label:'Sem data', className:'' };
  if (dateIso < today) return { key:'atrasado', label:'Atrasado', className:'overdue' };
  if (dateIso === today) return { key:'hoje', label:'Hoje', className:'today' };
  return { key:'futuro', label:'Futuro', className:'future' };
}

function getAllFollowupItems() {
  const crm = getLeadCrmStore ? getLeadCrmStore() : {};
  const items = [];

  Object.entries(crm || {}).forEach(([leadId, data]) => {
    if (!data?.followUpDate) return;
    const lead = findLeadEverywhere(leadId);
    const normalized = lead ? normalizeLeadForDrawer(lead) : {
      id: leadId,
      nome: 'Lead sem nome',
      whatsapp: '',
      instagram: '',
      site: '',
      status: ''
    };

    const info = getFollowupStatusInfo(data.followUpDate);
    items.push({
      leadId,
      lead: normalized,
      date: data.followUpDate,
      info
    });
  });

  return items.sort((a,b) => String(a.date).localeCompare(String(b.date)));
}

function getFilteredFollowups() {
  const items = getAllFollowupItems();
  const today = dateOnlyToday();
  const next7 = addDaysIso(7);

  if (followupFilter === 'hoje') return items.filter(i => i.date === today);
  if (followupFilter === 'atrasados') return items.filter(i => i.date < today);
  if (followupFilter === 'proximos') return items.filter(i => i.date > today && i.date <= next7);
  return items;
}

function renderFollowupDashboard() {
  const box = document.getElementById('followupDashboard');
  if (!box) return;

  const items = getAllFollowupItems();
  const today = dateOnlyToday();
  const next7 = addDaysIso(7);

  const hoje = items.filter(i => i.date === today).length;
  const atrasados = items.filter(i => i.date < today).length;
  const proximos = items.filter(i => i.date > today && i.date <= next7).length;

  box.innerHTML = `
    <div class="followup-stat">
      <div class="followup-stat-label">Hoje</div>
      <div class="followup-stat-value warn">${hoje}</div>
      <div class="followup-stat-hint">// retornos do dia</div>
    </div>
    <div class="followup-stat">
      <div class="followup-stat-label">Atrasados</div>
      <div class="followup-stat-value err">${atrasados}</div>
      <div class="followup-stat-hint">// precisam de atenção</div>
    </div>
    <div class="followup-stat">
      <div class="followup-stat-label">Próximos 7 dias</div>
      <div class="followup-stat-value acc">${proximos}</div>
      <div class="followup-stat-hint">// agenda próxima</div>
    </div>
  `;
}

function renderFollowupList() {
  const list = document.getElementById('followupList');
  if (!list) return;

  document.querySelectorAll('.followup-tab').forEach(btn => btn.classList.remove('active'));
  const map = {
    hoje: 'fuTabHoje',
    atrasados: 'fuTabAtrasados',
    proximos: 'fuTabProximos',
    todos: 'fuTabTodos'
  };
  const active = document.getElementById(map[followupFilter]);
  if (active) active.classList.add('active');

  const items = getFilteredFollowups();

  if (!items.length) {
    list.innerHTML = emptyStatePro('⏰','Nenhum follow-up nesta visão','Quando você agendar retornos na ficha do lead, eles aparecerão aqui.');
    return;
  }

  list.innerHTML = items.map(item => {
    const lead = item.lead;
    return `
      <div class="followup-item ${item.info.className}">
        <div class="followup-item-main">
          <div class="followup-item-name">${escHtml(lead.nome)}</div>
          <div class="followup-item-meta">
            ${lead.whatsapp ? `<span>📱 ${escHtml(lead.whatsapp)}</span>` : ''}
            ${lead.instagram ? `<span>📸 ${escHtml(lead.instagram)}</span>` : ''}
            ${lead.site ? `<span>🌐 ${escHtml(lead.site)}</span>` : ''}
            ${lead.status ? `<span>${escHtml(lead.status)}</span>` : ''}
          </div>
        </div>
        <span class="followup-pill ${item.info.className}">${escHtml(item.info.label)} · ${escHtml(item.date)}</span>
        <button class="btn btn-ghost" style="font-size:10px;padding:7px 12px" onclick="openLeadDrawer('${escHtml(item.leadId)}')">Abrir ficha</button>
      </div>
    `;
  }).join('');
}

function renderFollowups() {
  renderFollowupDashboard();
  renderFollowupList();
}

function setFollowupFilter(filter) {
  followupFilter = filter;
  renderFollowups();
}


