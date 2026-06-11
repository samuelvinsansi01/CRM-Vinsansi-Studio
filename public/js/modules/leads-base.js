/* ════════════════════════════
   BASE PERMANENTE DE LEADS
   Inventário independente da agenda semanal.
════════════════════════════ */
let leadBaseFilter = 'fora_agenda';
let leadBasePage = 1;
let LEAD_BASE_PG = 20;
const leadBaseSelected = new Set();

function isPermanentLeadSent(lead = {}) {
  const status = normalizeStr(lead.status || '');
  return ['enviada','enviado','respondida','nao respondida','recusada','fechada'].includes(status);
}

function getPermanentLeadDate(lead = {}) {
  const raw = lead.criadoEm || lead.importadoEm || lead.permanentCreatedAt || '';
  const br = String(raw).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1]));
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isPermanentLeadOlderThanCurrentWeek(lead = {}) {
  const date = getPermanentLeadDate(lead);
  return !date || date < getWeekStart();
}

function getCurrentWeekLeadIds() {
  try {
    return new Set(Object.values(getWeekData()?.days || {}).flat().map(lead => lead?.id).filter(Boolean));
  } catch {
    return new Set();
  }
}

function buildPermanentLeadWorkflowIndex() {
  const map = new Map();
  const add = (items, label, panel) => {
    (Array.isArray(items) ? items : []).forEach(lead => {
      if (lead?.id && !map.has(lead.id)) map.set(lead.id, { label, panel });
    });
  };

  try { add(Object.values(getWeekData()?.days || {}).flat(), 'Agenda semanal', 'inicio'); } catch {}
  try { add(getValData(), 'Validação', 'validacao'); } catch {}
  try { add(getAtribuicaoData(), 'Atribuição', 'atribuicao'); } catch {}
  try { add(getZapBacklog(), 'Backlog WhatsApp', 'fila-zap'); } catch {}
  try { add(getInstaFila(), 'Instagram', 'instagram'); } catch {}
  try { add(Object.values(typeof getInstaWeek === 'function' ? getInstaWeek() : {}).flat(), 'Agenda Instagram', 'instagram'); } catch {}
  try { add(Object.values(filaDisparo || {}).flat(), 'Fila de disparo', 'fila-zap'); } catch {}
  try { add(Object.values(getAcompData() || {}).flat(), 'Acompanhamento', 'acompanhamento'); } catch {}

  return map;
}

function isPermanentLeadOutsideSchedule(lead = {}, currentWeekIds = getCurrentWeekLeadIds()) {
  return !isPermanentLeadSent(lead) && !currentWeekIds.has(lead.id);
}

function getFilteredPermanentLeads() {
  const leads = getLeadBaseData();
  const currentWeekIds = getCurrentWeekLeadIds();
  const query = normalizeStr(document.getElementById('leadBaseSearch')?.value || '');

  return leads
    .filter(lead => {
      const outside = isPermanentLeadOutsideSchedule(lead, currentWeekIds);
      if (leadBaseFilter === 'fora_agenda' && !outside) return false;
      if (leadBaseFilter === 'antigos' && !(outside && isPermanentLeadOlderThanCurrentWeek(lead))) return false;
      if (leadBaseFilter === 'nao_enviados' && isPermanentLeadSent(lead)) return false;
      if (leadBaseFilter === 'enviados' && !isPermanentLeadSent(lead)) return false;

      if (!query) return true;
      return normalizeStr([
        lead.nome,
        lead.site,
        lead.whatsapp,
        lead.instagram,
        lead.status,
        lead.baseSource
      ].filter(Boolean).join(' ')).includes(query);
    })
    .sort((a, b) => {
      const outsideDiff = Number(isPermanentLeadOutsideSchedule(b, currentWeekIds))
        - Number(isPermanentLeadOutsideSchedule(a, currentWeekIds));
      if (outsideDiff) return outsideDiff;
      return (getPermanentLeadDate(a)?.getTime() || 0) - (getPermanentLeadDate(b)?.getTime() || 0);
    });
}

function setLeadBaseFilter(filter) {
  leadBaseFilter = filter;
  leadBasePage = 1;
  renderLeadBasePanel();
}

function togglePermanentLeadSelection(id) {
  if (leadBaseSelected.has(id)) leadBaseSelected.delete(id);
  else leadBaseSelected.add(id);
  renderLeadBasePanel();
}

function selectVisiblePermanentPendingLeads() {
  const currentWeekIds = getCurrentWeekLeadIds();
  getFilteredPermanentLeads()
    .filter(lead => isPermanentLeadOutsideSchedule(lead, currentWeekIds))
    .forEach(lead => leadBaseSelected.add(lead.id));
  renderLeadBasePanel();
}

function goLeadBasePage(page) {
  leadBasePage = page;
  renderLeadBasePanel();
}

function changeLeadBasePgSize(size) {
  LEAD_BASE_PG = size;
  leadBasePage = 1;
  renderLeadBasePanel();
}

function getPermanentLeadAction(location = {}) {
  if (location.panel === 'validacao') return ['Abrir validação', 'validacao'];
  if (location.panel === 'atribuicao') return ['Abrir atribuição', 'atribuicao'];
  if (location.panel === 'fila-zap') return ['Abrir WhatsApp', 'fila-zap'];
  if (location.panel === 'instagram') return ['Abrir Instagram', 'instagram'];
  if (location.panel === 'inicio') return ['Ver agenda', 'inicio'];
  if (location.panel === 'acompanhamento') return ['Acompanhamento', 'acompanhamento'];
  return null;
}

function preparePermanentLeads(ids = []) {
  const base = new Map(getLeadBaseData().filter(lead => lead?.id).map(lead => [lead.id, lead]));
  const currentWeekIds = getCurrentWeekLeadIds();
  const workflow = buildPermanentLeadWorkflowIndex();
  const attribution = getAtribuicaoData();
  const validation = getValData();
  const attributionIds = new Set(attribution.map(lead => lead.id));
  const validationIds = new Set(validation.map(lead => lead.id));
  let toAttribution = 0;
  let toValidation = 0;
  let alreadyRouted = 0;
  let ignored = 0;

  [...new Set(ids)].forEach(id => {
    const lead = base.get(id);
    if (!lead || !isPermanentLeadOutsideSchedule(lead, currentWeekIds)) {
      ignored++;
      return;
    }

    const current = workflow.get(id);
    if (current && current.label !== 'Base permanente') {
      alreadyRouted++;
      return;
    }

    const restored = {
      ...lead,
      status: 'Não enviada',
      diaDestino: null,
      voltouDaSemana: todayStr()
    };

    if (typeof isLeadWhatsappValidatedForQueue === 'function' && isLeadWhatsappValidatedForQueue(restored)) {
      if (!attributionIds.has(id)) {
        attribution.push({ ...restored, canal:'zap' });
        attributionIds.add(id);
        toAttribution++;
      }
      return;
    }

    if (!validationIds.has(id)) {
      validation.push({
        ...restored,
        canal: 'pendente',
        numStatus: restored.numStatus === 'valido' ? 'valido' : 'pendente',
        importadoEm: restored.importadoEm || restored.criadoEm || todayStr()
      });
      validationIds.add(id);
      toValidation++;
    }
  });

  if (toAttribution) saveAtribuicaoData(attribution);
  if (toValidation) saveValData(validation);
  leadBaseSelected.clear();
  renderLeadBasePanel();
  updateBadges();

  const summary = [];
  if (toAttribution) summary.push(`${toAttribution} → Atribuição`);
  if (toValidation) summary.push(`${toValidation} → Validação`);
  if (alreadyRouted) summary.push(`${alreadyRouted} já encaminhado${alreadyRouted !== 1 ? 's' : ''}`);
  if (ignored) summary.push(`${ignored} ignorado${ignored !== 1 ? 's' : ''}`);
  notify(summary.length ? summary.join(' · ') : 'Nenhum lead precisava ser recuperado.', summary.length ? '' : 'warn');
}

function prepareSelectedPermanentLeads() {
  if (!leadBaseSelected.size) {
    notify('Selecione ao menos um lead pendente fora da agenda.', 'warn');
    return;
  }
  preparePermanentLeads([...leadBaseSelected]);
}

function renderLeadBasePanel() {
  const tbody = document.getElementById('leadBaseTbody');
  const tabs = document.getElementById('leadBaseFilterTabs');
  const totalBadge = document.getElementById('leadBaseTotalBadge');
  const selectedLabel = document.getElementById('leadBaseSelectedLabel');
  if (!tbody || !tabs) return;

  const all = getLeadBaseData();
  const currentWeekIds = getCurrentWeekLeadIds();
  const workflow = buildPermanentLeadWorkflowIndex();
  const counts = {
    todos: all.length,
    fora_agenda: all.filter(lead => isPermanentLeadOutsideSchedule(lead, currentWeekIds)).length,
    antigos: all.filter(lead => isPermanentLeadOutsideSchedule(lead, currentWeekIds) && isPermanentLeadOlderThanCurrentWeek(lead)).length,
    nao_enviados: all.filter(lead => !isPermanentLeadSent(lead)).length,
    enviados: all.filter(isPermanentLeadSent).length
  };
  const labels = [
    ['fora_agenda', 'Fora da agenda'],
    ['antigos', 'Pendentes antigos'],
    ['todos', 'Todos'],
    ['nao_enviados', 'Não enviados'],
    ['enviados', 'Enviados']
  ];

  tabs.innerHTML = labels.map(([id, label]) => `
    <button class="status-tab${leadBaseFilter === id ? ' active' : ''}" onclick="setLeadBaseFilter('${id}')">
      ${label} <span class="st-count">${counts[id]}</span>
    </button>
  `).join('');
  if (totalBadge) totalBadge.textContent = `${all.length} lead${all.length !== 1 ? 's' : ''}`;
  if (selectedLabel) selectedLabel.textContent = `${leadBaseSelected.size} selecionado${leadBaseSelected.size !== 1 ? 's' : ''}`;

  const filtered = getFilteredPermanentLeads();
  const totalPages = Math.max(1, Math.ceil(filtered.length / LEAD_BASE_PG));
  if (leadBasePage > totalPages) leadBasePage = totalPages;
  const pageItems = filtered.slice((leadBasePage - 1) * LEAD_BASE_PG, leadBasePage * LEAD_BASE_PG);

  if (!pageItems.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="table-empty">Nenhum lead encontrado neste filtro.</td></tr>';
  } else {
    tbody.innerHTML = pageItems.map(lead => {
      const location = workflow.get(lead.id) || { label:'Base permanente', panel:'' };
      const outside = isPermanentLeadOutsideSchedule(lead, currentWeekIds);
      const action = getPermanentLeadAction(location);
      return `
        <tr>
          <td>
            ${outside ? `<input type="checkbox" onchange="togglePermanentLeadSelection('${escHtml(lead.id)}')" ${leadBaseSelected.has(lead.id) ? 'checked' : ''}>` : ''}
          </td>
          <td class="td-name">${escHtml(lead.nome || 'Lead sem nome')}</td>
          <td style="font-family:'DM Mono',monospace;font-size:9px">${escHtml(lead.whatsapp || '—')}</td>
          <td><span class="q-badge ${outside ? 'warn' : 'info'}">${escHtml(location.label)}</span></td>
          <td><span class="q-badge ${isPermanentLeadSent(lead) ? 'ok' : 'warn'}">${escHtml(lead.status || 'Não enviada')}</span></td>
          <td style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted)">${escHtml(lead.baseSource || 'Fluxo local')}</td>
          <td style="white-space:nowrap">
            <button class="btn btn-ghost" style="font-size:9px;padding:4px 8px" onclick="openLeadDrawer('${escHtml(lead.id)}')">Ficha</button>
            ${outside && location.label === 'Base permanente'
              ? `<button class="btn btn-primary" style="font-size:9px;padding:4px 8px" onclick="preparePermanentLeads(['${escHtml(lead.id)}'])">Recuperar</button>`
              : action
                ? `<button class="btn btn-ghost" style="font-size:9px;padding:4px 8px" onclick="switchPanel('${action[1]}')">${action[0]}</button>`
                : ''}
          </td>
        </tr>
      `;
    }).join('');
  }

  renderPagination('leadBasePagination', leadBasePage, totalPages, filtered.length, LEAD_BASE_PG, 'goLeadBasePage', 'changeLeadBasePgSize');
}
