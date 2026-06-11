/* ════════════════════════════
   HOME PRO DASHBOARD V12.1
════════════════════════════ */
function getHomeProStats() {
  const data = ensureWeekData();
  const leads = flattenWeekData(data);
  const crm = getLeadCrmStore ? getLeadCrmStore() : {};
  const crmItems = Object.values(crm || {});

  const todayIso = new Date().toISOString().slice(0,10);
  const followHoje = crmItems.filter(item => item && item.followUpDate === todayIso).length;
  const followAtrasados = crmItems.filter(item => item && item.followUpDate && item.followUpDate < todayIso).length;

  const pipelineCounts = {
    contato_enviado: 0,
    respondeu: 0,
    reuniao: 0,
    proposta: 0,
    fechado: 0,
    perdido: 0
  };

  crmItems.forEach(item => {
    const key = item?.pipelineStatus || 'contato_enviado';
    if (pipelineCounts[key] !== undefined) pipelineCounts[key]++;
  });

  const aguardandoResposta = leads.filter(l => {
    const st = l.status || 'Não enviada';
    return st === 'Enviada' || st === 'Em fila';
  }).length;

  return {
    totalLeads: leads.length,
    followHoje,
    followAtrasados,
    aguardandoResposta,
    fechados: pipelineCounts.fechado || leads.filter(l => (l.status || '') === 'Fechada').length,
    pipelineCounts
  };
}

function renderHomeProDashboard() {
  const host = document.getElementById('homeProDashboardHost');
  if (!host) return;

  const s = getHomeProStats();
  const max = Math.max(
    s.pipelineCounts.contato_enviado,
    s.pipelineCounts.respondeu,
    s.pipelineCounts.reuniao,
    s.pipelineCounts.proposta,
    s.pipelineCounts.fechado,
    1
  );

  const pct = (n) => Math.max(4, Math.round((n / max) * 100));

  const stages = [
    ['Contato', s.pipelineCounts.contato_enviado],
    ['Respondeu', s.pipelineCounts.respondeu],
    ['Reunião', s.pipelineCounts.reuniao],
    ['Proposta', s.pipelineCounts.proposta],
    ['Fechado', s.pipelineCounts.fechado],
  ];

  host.innerHTML = `
    <div class="home-pro-dashboard">
      <div class="home-pro-card">
        <div class="home-pro-label">Leads ativos</div>
        <div class="home-pro-value acc">${s.totalLeads}</div>
        <div class="home-pro-hint">// base carregada</div>
      </div>
      <div class="home-pro-card">
        <div class="home-pro-label">Follow-ups hoje</div>
        <div class="home-pro-value ${s.followHoje ? 'warn' : ''}">${s.followHoje}</div>
        <div class="home-pro-hint">${s.followAtrasados ? `${s.followAtrasados} atrasado(s)` : '// nada atrasado'}</div>
      </div>
      <div class="home-pro-card">
        <div class="home-pro-label">Aguardando resposta</div>
        <div class="home-pro-value">${s.aguardandoResposta}</div>
        <div class="home-pro-hint">// enviados ou em fila</div>
      </div>
      <div class="home-pro-card">
        <div class="home-pro-label">Fechados</div>
        <div class="home-pro-value ok">${s.fechados}</div>
        <div class="home-pro-hint">// pipeline comercial</div>
      </div>
    </div>

    <div class="home-pro-funnel">
      <div class="home-pro-funnel-head">
        <div class="home-pro-funnel-title">Funil comercial</div>
        <div class="home-pro-funnel-sub">// visão resumida do pipeline</div>
      </div>
      <div class="home-pro-funnel-grid">
        ${stages.map(([label,count]) => `
          <div class="home-pro-stage">
            <div class="home-pro-stage-top">
              <div class="home-pro-stage-name">${escHtml(label)}</div>
              <div class="home-pro-stage-count">${count}</div>
            </div>
            <div class="home-pro-bar">
              <div class="home-pro-bar-fill" style="width:${pct(count)}%"></div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}


/* ════════════════════════════
   HOME CRM CLEAN V12.2
════════════════════════════ */
function getCrmHomeStats() {
  const data = ensureWeekData();
  const leads = flattenWeekData(data);
  const crm = getLeadCrmStore ? getLeadCrmStore() : {};
  const crmItems = Object.values(crm || {});
  const todayIso = new Date().toISOString().slice(0,10);

  const pipelineCounts = {
    contato_enviado: 0,
    respondeu: 0,
    reuniao: 0,
    proposta: 0,
    fechado: 0,
    perdido: 0
  };

  crmItems.forEach(item => {
    const key = item?.pipelineStatus || 'contato_enviado';
    if (pipelineCounts[key] !== undefined) pipelineCounts[key]++;
  });

  const followHoje = crmItems.filter(item => item?.followUpDate === todayIso).length;
  const followAtrasados = crmItems.filter(item => item?.followUpDate && item.followUpDate < todayIso).length;
  const aguardandoResposta = leads.filter(lead => ['Enviada','Em fila'].includes(lead.status || '')).length;
  const fechadosStatus = leads.filter(lead => (lead.status || '') === 'Fechada').length;

  return {
    totalLeads: leads.length,
    followHoje,
    followAtrasados,
    aguardandoResposta,
    fechados: Math.max(pipelineCounts.fechado || 0, fechadosStatus),
    pipelineCounts
  };
}

function ensureCrmHomeHost() {
  const panel = document.getElementById('panel-inicio');
  if (!panel) return null;

  let host = document.getElementById('crmHomeDashboardHost');
  if (host) return host;

  const header = panel.querySelector('.page-header');
  if (!header) return null;

  host = document.createElement('div');
  host.id = 'crmHomeDashboardHost';
  host.style.flexShrink = '0';
  header.insertAdjacentElement('afterend', host);
  return host;
}


function getPresentationHomeStats() {
  const presentations = getAllLeadPresentations();
  return {
    sent: presentations.length,
    viewed: presentations.filter(p => Number(p.views || 0) > 0).length,
    views: presentations.reduce((sum, p) => sum + Number(p.views || 0), 0)
  };
}

function renderCrmHomeDashboard() {
  const host = ensureCrmHomeHost();
  if (!host) return;

  const s = getCrmHomeStats();
  const stages = [
    ['Contato', s.pipelineCounts.contato_enviado || 0],
    ['Respondeu', s.pipelineCounts.respondeu || 0],
    ['Reunião', s.pipelineCounts.reuniao || 0],
    ['Proposta', s.pipelineCounts.proposta || 0],
    ['Fechado', s.fechados || 0],
  ];

  const max = Math.max(...stages.map(([, count]) => count), 1);
  const pct = (value) => Math.max(value > 0 ? 8 : 0, Math.round((value / max) * 100));

  host.innerHTML = `
    <div id="devToolsHost" class="crm-home-card dev-tools-card" style="margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;gap:12px;grid-column:1/-1">
      <div><div class="crm-home-card-label">Ambiente DEV</div><div class="crm-home-card-hint">// use apenas para limpeza de testes locais</div></div>
      <button class="btn btn-ghost" onclick="clearDevTestLeads()">Limpar testes locais</button>
    </div>
    <div class="crm-home-summary">
      <div class="crm-home-card"><div class="crm-home-card-label">Leads ativos</div><div class="crm-home-card-value acc">${s.totalLeads}</div><div class="crm-home-card-hint">// base carregada</div></div>
      <div class="crm-home-card"><div class="crm-home-card-label">Follow-ups hoje</div><div class="crm-home-card-value ${s.followHoje ? 'warn' : ''}">${s.followHoje}</div><div class="crm-home-card-hint">${s.followAtrasados ? `${s.followAtrasados} atrasado(s)` : '// nada atrasado'}</div></div>
      <div class="crm-home-card"><div class="crm-home-card-label">Aguardando resposta</div><div class="crm-home-card-value">${s.aguardandoResposta}</div><div class="crm-home-card-hint">// enviados ou em fila</div></div>
      <div class="crm-home-card"><div class="crm-home-card-label">Fechados</div><div class="crm-home-card-value ok">${s.fechados}</div><div class="crm-home-card-hint">// pipeline comercial</div></div>
    </div>
    <div class="crm-funnel-card">
      <div class="crm-funnel-header"><div><div class="crm-funnel-title">Funil comercial</div><div class="crm-funnel-sub">// visão rápida do relacionamento com os leads</div></div></div>
      <div class="crm-funnel-grid">
        ${stages.map(([label, count]) => `
          <div class="crm-funnel-stage">
            <div class="crm-funnel-stage-top"><div class="crm-funnel-stage-name">${escHtml(label)}</div><div class="crm-funnel-stage-count">${count}</div></div>
            <div class="crm-funnel-bar"><div class="crm-funnel-fill" style="width:${pct(count)}%"></div></div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}


