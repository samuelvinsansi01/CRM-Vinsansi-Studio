/* ════════════════════════════
   EXEC DASHBOARD V17
════════════════════════════ */
function getExecutiveMetrics() {
  const crm = getLeadCrmStore ? getLeadCrmStore() : {};
  const items = Object.values(crm || {});

  const contato = items.filter(i => (i.pipelineStatus || 'contato_enviado') === 'contato_enviado').length;
  const respondeu = items.filter(i => i.pipelineStatus === 'respondeu').length;
  const reuniao = items.filter(i => i.pipelineStatus === 'reuniao').length;
  const proposta = items.filter(i => i.pipelineStatus === 'proposta').length;
  const fechado = items.filter(i => i.pipelineStatus === 'fechado').length;

  const base = Math.max(contato + respondeu + reuniao + proposta + fechado, 1);

  return {
    contato,
    respondeu,
    reuniao,
    proposta,
    fechado,
    respostaRate: Math.round((respondeu / base) * 100),
    reuniaoRate: Math.round((reuniao / base) * 100),
    propostaRate: Math.round((proposta / base) * 100),
    fechamentoRate: Math.round((fechado / base) * 100)
  };
}

function renderExecutiveDashboard() {
  const host = document.getElementById('crmHomeDashboardHost');
  if (!host) return;

  const m = getExecutiveMetrics();
  const max = Math.max(m.contato, m.respondeu, m.reuniao, m.proposta, m.fechado, 1);

  host.insertAdjacentHTML('beforeend', `
    <div class="exec-metrics">
      <div class="exec-card"><div class="exec-label">Resposta</div><div class="exec-value">${m.respostaRate}%</div></div>
      <div class="exec-card"><div class="exec-label">Reunião</div><div class="exec-value">${m.reuniaoRate}%</div></div>
      <div class="exec-card"><div class="exec-label">Proposta</div><div class="exec-value">${m.propostaRate}%</div></div>
      <div class="exec-card"><div class="exec-label">Fechamento</div><div class="exec-value">${m.fechamentoRate}%</div></div>
    </div>

    <div class="exec-funnel">
      ${[
        ['Contato',m.contato],
        ['Respondeu',m.respondeu],
        ['Reunião',m.reuniao],
        ['Proposta',m.proposta],
        ['Fechado',m.fechado]
      ].map(([label,val])=>`
        <div class="exec-stage">
          <div class="exec-stage-top"><span>${label}</span><span>${val}</span></div>
          <div class="exec-bar"><div class="exec-fill" style="width:${Math.round((val/max)*100)}%"></div></div>
        </div>
      `).join('')}
    </div>
  `);
}


/* ════════════════════════════
   KANBAN V18
════════════════════════════ */
function findLeadEverywhereSafe(id){
  try { return findLeadEverywhere(id); } catch { return null; }
}

function renderKanban() {
  const board = document.getElementById('kanbanBoard');
  if (!board) return;

  const crm = getLeadCrmStore ? getLeadCrmStore() : {};

  const stages = [
    ['contato_enviado','Contato'],
    ['respondeu','Respondeu'],
    ['reuniao','Reunião'],
    ['proposta','Proposta'],
    ['fechado','Fechado'],
    ['perdido','Perdido']
  ];

  board.innerHTML = stages.map(([key,label]) => {
    const items = Object.entries(crm).filter(([_,v]) => (v.pipelineStatus || 'contato_enviado') === key);

    return `
      <div class="kanban-col">
        <div class="kanban-head">
          <span>${label}</span>
          <span>${items.length}</span>
        </div>

        <div class="kanban-list">
          ${items.map(([leadId]) => {
            const lead = findLeadEverywhereSafe(leadId) || {nome:'Lead'};
            return `
              <div class="kanban-card" onclick="openLeadDrawer('${leadId}')">
                <div class="kanban-card-title">${escHtml(lead.nome || 'Lead')}</div>
                <div class="kanban-card-meta">
                  ${(lead.instagram || '')}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }).join('');
}


/* ════════════════════════════
   PRESENTATION METRICS V19
════════════════════════════ */
function getAllLeadPresentations() {
  const crm = getLeadCrmStore ? getLeadCrmStore() : {};
  const list = [];

  Object.entries(crm || {}).forEach(([leadId, data]) => {
    (data.presentations || []).forEach(p => {
      list.push({ leadId, ...p });
    });
  });

  return list;
}

function getPresentationStatsForLead(leadId) {
  const crm = ensureLeadCrm(leadId, activeLeadDrawerData || {});
  const presentations = Array.isArray(crm.presentations) ? crm.presentations : [];

  const total = presentations.length;
  const viewed = presentations.filter(p => Number(p.views || 0) > 0).length;
  const totalViews = presentations.reduce((sum, p) => sum + Number(p.views || 0), 0);

  return { total, viewed, totalViews };
}

function markLeadPresentationViewed(presentationId) {
  if (!activeLeadDrawerId) return;

  const crm = ensureLeadCrm(activeLeadDrawerId, activeLeadDrawerData || {});
  const p = (crm.presentations || []).find(item => item.id === presentationId);
  if (!p) return;

  p.views = Number(p.views || 0) + 1;
  p.lastViewedAt = new Date().toISOString();
  p.lastViewedAtLabel = crmNowLabel();

  saveLeadCrm(activeLeadDrawerId, crm);
  addLeadHistory(activeLeadDrawerId, `Apresentação visualizada: ${p.title || 'Apresentação'}`, activeLeadDrawerData || {});

  renderLeadPresentations();
  if (typeof renderLeadTimeline === 'function') renderLeadTimeline(activeLeadDrawerId);
  notify('Visualização registrada.');
}

function renderPresentationMetricsHeader() {
  const list = document.getElementById('leadPresentationsList');
  if (!list || !activeLeadDrawerId) return '';

  const stats = getPresentationStatsForLead(activeLeadDrawerId);

  return `
    <div class="presentation-metrics-mini">
      <div class="presentation-metric">
        <div class="presentation-metric-label">Apresentações</div>
        <div class="presentation-metric-value">${stats.total}</div>
      </div>
      <div class="presentation-metric">
        <div class="presentation-metric-label">Visualizadas</div>
        <div class="presentation-metric-value">${stats.viewed}</div>
      </div>
      <div class="presentation-metric">
        <div class="presentation-metric-label">Acessos</div>
        <div class="presentation-metric-value">${stats.totalViews}</div>
      </div>
    </div>
  `;
}


/* ════════════════════════════
   V20 POLIMENTO FINAL CRM
════════════════════════════ */
function emptyStatePro(icon, title, text) {
  return `
    <div class="empty-state-pro">
      <div class="empty-state-pro-icon">${icon || '∅'}</div>
      <div class="empty-state-pro-title">${escHtml(title || 'Nada por aqui')}</div>
      <div class="empty-state-pro-text">${escHtml(text || 'Quando houver dados, eles aparecerão nesta área.')}</div>
    </div>
  `;
}

function clearDevTestLeads() {
  const data = ensureWeekData();
  const days = data.days || {};

  Object.keys(days).forEach(day => {
    days[day] = (days[day] || []).filter(lead => {
      const id = String(lead.id || '').toLowerCase();
      const nome = String(lead.nome || '').toLowerCase();
      return !id.includes('test') && !nome.includes('teste');
    });
  });

  saveWeekData(data);

  const crm = getLeadCrmStore ? getLeadCrmStore() : {};
  Object.keys(crm).forEach(id => {
    if (String(id).toLowerCase().includes('test')) delete crm[id];
  });

  saveLeadCrmStore(crm);

  if (typeof renderInicio === 'function') renderInicio();
  if (typeof updateBadges === 'function') updateBadges();

  notify('Leads de teste removidos do cache local.');
}

function renderProductionReadyNote() {
  const box = document.getElementById('authUserBox');
  if (!box || document.getElementById('productionReadyNote')) return;
  box.insertAdjacentHTML('beforeend', '<br><span id="productionReadyNote" class="production-ready-note">CRM DEV estável</span>');
}


