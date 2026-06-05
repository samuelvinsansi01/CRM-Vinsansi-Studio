/* ════════════════════════════
   MODAL LIMPAR EXCLUÍDOS
════════════════════════════ */
function abrirModalLimparExcluidos() {
  document.getElementById('limparExcluidosModal').classList.add('open');
}
function confirmarLimparExcluidos() {
  saveExcludedDomains([]);
  document.getElementById('limparExcluidosModal').classList.remove('open');
  renderExcluidos(); notify('Lista limpa');
}

/* mantém compatibilidade com chamadas antigas */
function limparExcluidos() { abrirModalLimparExcluidos(); }


/* ════════════════════════════
   MODAL CONFIRMAÇÃO GENÉRICA
════════════════════════════ */
let _confirmCallback = null;
function abrirModalConfirm(msg, callback) {
  document.getElementById('confirmModalMsg').innerHTML = msg;
  _confirmCallback = callback;
  document.getElementById('confirmModal').classList.add('open');
  document.getElementById('confirmModalOk').onclick = () => {
    const cb = _confirmCallback;
    fecharConfirmModal();
    if (cb) cb();
  };
}
function fecharConfirmModal() {
  document.getElementById('confirmModal').classList.remove('open');
  _confirmCallback = null;
}

function notify(msg, type) {
  const el = document.getElementById('notify');
  el.textContent = msg;
  el.className = 'notify show' + (type==='err'?' err':type==='warn'?' warn':'');
  setTimeout(() => el.classList.remove('show'), 3400);
}

/* ════════════════════════════
   SIDEBAR / NAV
════════════════════════════ */
function toggleSidebar() {
  const s = document.getElementById('sidebar');
  const open = !s.classList.contains('collapsed');
  s.classList.toggle('collapsed', open);
  localStorage.setItem(SIDEBAR_KEY, open ? '0' : '1');
}
const ACTIVE_PANEL_KEY_V434 = 'vs_active_panel_v434';
const PANEL_ALIASES_V436 = {
  responses: 'inbox',
  chips: 'configuracoes',
  evolution: 'configuracoes',
  whatsappQueue: 'fila-zap',
  import: 'importar',
  redirects: 'redirecionamentos'
};
const PANELS = ['audit','conversations','inicio','inbox','importar','validacao','atribuicao','instagram','fila-zap','kanban','followups','acompanhamento','redirecionamentos','configuracoes','conta'];
function switchPanel(name, options = {}) {
  name = PANEL_ALIASES_V436[name] || name;
  if (!PANELS.includes(name)) name = 'inicio';
  PANELS.forEach(p => {
    const el = document.getElementById('panel-'+p);
    if (el) el.classList.toggle('active', p===name);
  });
  document.querySelectorAll('.nav-item').forEach(el => {
    const label = el.getAttribute('data-label') || '';
    const panelMap = {'Início':'inicio','Caixa de Entrada':'inbox','Importar':'importar','Validação':'validacao','Atribuição':'atribuicao','WhatsApp':'fila-zap','Instagram':'instagram','Fila WhatsApp':'fila-zap','Conversas':'conversations','Follow-ups':'followups','Kanban':'kanban','Acompanhamento':'acompanhamento','Acompanhamentos':'acompanhamento','Redirecionamentos':'redirecionamentos','Auditoria':'audit','Configurações':'configuracoes','Minha conta':'conta'};
    el.classList.toggle('active', panelMap[label] === name);
  });
  if (name==='inicio')         renderInicio();
  if (name==='importar')       renderImportarPanel();
  if (name==='validacao')      renderValidacao();
  if (name==='atribuicao')     { renderAtribuicao(); updateAtribTabCounts(); if (atribActiveTab==='insta') { renderAtribInstaFila(); updateAtribInstaCorteInfo(); } }
  if (name==='instagram')      renderInstagram();
  if (name==='fila-zap')       renderFilaZap();
  if (name==='inbox')          { renderInboxV41(); fetchEvolutionResponsesV34({ silent:true }); }
  if (name==='conversations')  { renderConversationsV38(); fetchEvolutionResponsesV34({ silent:true }); }
  if (name==='kanban')         renderKanban();
  if (name==='followups')      renderFollowups();
  if (name==='acompanhamento') renderAcompanhamento();
  if (name==='conta')          renderMinhaContaV426();
  if (name==='configuracoes')  {
    renderConfiguracoes();
    if (typeof renderWebhookUrlV34 === 'function') renderWebhookUrlV34();
  }
  if (options.persist !== false) {
    try { localStorage.setItem(ACTIVE_PANEL_KEY_V434, name); } catch(e) {}
  }
  updateBadges();
}

function restoreLastActivePanelV434() {
  let panel = 'inicio';
  try {
    const saved = localStorage.getItem(ACTIVE_PANEL_KEY_V434) || '';
    const normalized = PANEL_ALIASES_V436[saved] || saved;
    if (PANELS.includes(normalized)) panel = normalized;
  } catch(e) {}
  switchPanel(panel, { persist:false });
}

function updateBadges() {
  const data = ensureWeekData();
  const flat = flattenWeekData(data);
  document.getElementById('badge-inicio').textContent = flat.filter(e => (e.status||'Não enviada')==='Não enviada').length;
  document.getElementById('badge-importar').textContent = flat.filter(e => e.status === 'Não enviada').length;
  const val = getValData();
  document.getElementById('badge-validacao').textContent = val.length;
  const atribuicaoEl = document.getElementById('badge-atribuicao');
  if (atribuicaoEl) {
    // Atribuição = zap sem dia + insta sem link ainda
    const instaSemLink = getInstaFila().filter(e => !e.instagram).length;
    atribuicaoEl.textContent = getAtribuicaoData().length + instaSemLink;
  }
  const naoEnv = flat.filter(e => (e.status||'Não enviada')==='Não enviada' && e.whatsapp).length;
  document.getElementById('badge-fila-zap').textContent = naoEnv;
  const instaEl = document.getElementById('badge-instagram');
  if (instaEl) {
    const instaWeek = getInstaWeek();
    const totalInsta = Object.values(instaWeek).flat().length;
    // Backlog = insta com link confirmado ainda não alocado em dia
    const instaBacklog = getInstaFila().filter(e => !!e.instagram).length;
    instaEl.textContent = totalInsta + instaBacklog;
  }
  // Atualiza contadores das abas da base de atribuição
  updateAtribTabCounts();
  const fuBadge = document.getElementById('badge-followups');
  if (fuBadge) {
    const todayIso = new Date().toISOString().slice(0,10);
    const crm = getLeadCrmStore ? getLeadCrmStore() : {};
    fuBadge.textContent = Object.values(crm || {}).filter(item => item?.followUpDate && item.followUpDate <= todayIso).length;
  }

  const acompEl = document.getElementById('badge-acompanhamento');
  if (acompEl) {
    const mk = currentMonthKey();
    const acomp = getAcompData();
    acompEl.textContent = (acomp[mk]||[]).length;
  }
}


let _supabaseLeadSyncTimer = null;
const _pendingSupabaseLeadSyncV426 = new Map();
function scheduleSupabaseLeadSync(leads = []) {
  if (!isSupabaseReady()) return;
  (Array.isArray(leads) ? leads : [leads]).forEach(lead => {
    if (lead?.id) _pendingSupabaseLeadSyncV426.set(lead.id, lead);
  });
  if (!_pendingSupabaseLeadSyncV426.size) return;
  clearTimeout(_supabaseLeadSyncTimer);
  _supabaseLeadSyncTimer = setTimeout(async () => {
    const pending = Array.from(_pendingSupabaseLeadSyncV426.values());
    _pendingSupabaseLeadSyncV426.clear();
    const remotePhoneMap = typeof getRemoteLeadPhoneMapV432 === 'function'
      ? await getRemoteLeadPhoneMapV432()
      : null;
    for (const lead of pending) {
      await upsertLeadToSupabase(lead, { remotePhoneMap });
    }
  }, 250);
}

/* ════════════════════════════
   STORAGE — EMPRESAS
════════════════════════════ */
function getStoredArray(key) {
  if (typeof v48StateGetArray === 'function') return v48StateGetArray(key);
  try {
    const data = JSON.parse(localStorage.getItem(key) || 'null');
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}
function getStoredObject(key) {
  if (typeof v48StateGetObject === 'function') return v48StateGetObject(key);
  try {
    const data = JSON.parse(localStorage.getItem(key) || 'null');
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}
function saveOperationalKeyV481(key, value, reason) {
  if (typeof v48StateSet === 'function' && v48StateSet(key, value, reason)) return;
  localStorage.setItem(key, JSON.stringify(value));
}
function removeOperationalKeyV481(key, reason) {
  if (typeof v48StateRemove === 'function' && v48StateRemove(key, reason)) return;
  localStorage.removeItem(key);
}

const PERMANENT_LEAD_STATUS_RANK = {
  'Não enviada': 0,
  'Em fila': 1,
  'Enviada': 2,
  'Não respondida': 3,
  'Respondida': 4,
  'Recusada': 5,
  'Fechada': 6
};

function getLeadBaseData() {
  return getStoredArray(LEADS_BASE_KEY);
}

function choosePermanentLeadStatus(previous = '', incoming = '') {
  const before = previous || 'Não enviada';
  const next = incoming || before;
  const beforeRank = PERMANENT_LEAD_STATUS_RANK[before] ?? 0;
  const nextRank = PERMANENT_LEAD_STATUS_RANK[next] ?? 0;

  // A base permanente não pode regredir um lead que já recebeu mensagem.
  if (beforeRank >= 2 && nextRank < beforeRank) return before;
  return next;
}

function mergeLeadsIntoPermanentBase(leads = [], metadata = {}, { schedule = true } = {}) {
  if (!Array.isArray(leads) || !leads.length) return getLeadBaseData();
  const source = metadata.source || '';
  const leadsToMerge = typeof filterPersistentLeadsV433 === 'function'
    ? filterPersistentLeadsV433(leads, source)
    : leads;
  if (leadsToMerge.length !== leads.length) {
    try {
      console.warn('[lead-import]', {
        action:'skip-non-persistent-candidates',
        source,
        received:leads.length,
        persisted:leadsToMerge.length,
        skipped:leads.length - leadsToMerge.length
      });
    } catch(e) {}
  }
  if (!leadsToMerge.length) return getLeadBaseData();

  const now = new Date().toISOString();
  const storedBase = getLeadBaseData();
  const filteredStoredBase = typeof filterPersistentLeadsV433 === 'function'
    ? storedBase.filter(lead => isLeadPersistentReadyV433(lead, lead.baseSource || 'Base permanente'))
    : storedBase;
  if (filteredStoredBase.length !== storedBase.length) {
    try { console.warn('[lead-import]', { action:'clean-permanent-base-non-persistent', removed:storedBase.length - filteredStoredBase.length }); } catch(e) {}
  }
  const initial = typeof dedupeLeadArrayV31 === 'function'
    ? dedupeLeadArrayV31(filteredStoredBase, 'permanentBase.beforeMerge')
    : filteredStoredBase;
  const map = new Map();
  initial.filter(lead => lead?.id).forEach(lead => {
    const key = typeof getLeadDedupeKeyV31 === 'function' ? (getLeadDedupeKeyV31(lead) || `id:${lead.id}`) : `id:${lead.id}`;
    map.set(key, lead);
  });
  const changed = [];

  leadsToMerge.forEach(lead => {
    if (!lead?.id) return;
    const key = typeof getLeadDedupeKeyV31 === 'function' ? (getLeadDedupeKeyV31(lead) || `id:${lead.id}`) : `id:${lead.id}`;
    const previous = map.get(key) || {};
    const next = {
      ...previous,
      ...lead,
      id: previous.id || lead.id,
      status: choosePermanentLeadStatus(previous.status, lead.status),
      baseSource: metadata.source || lead.baseSource || previous.baseSource || 'Fluxo local',
      permanentCreatedAt: previous.permanentCreatedAt || lead.permanentCreatedAt || lead.created_at || now,
      permanentUpdatedAt: now
    };
    const fields = ['nome','companyName','title','whatsapp','phone','telefone','instagram','instagramUrl','site','website','googleUrl','mapsUrl','url','status','pipelineStatus'];
    if (!previous.id || fields.some(field => String(previous[field] || '') !== String(next[field] || ''))) changed.push(next);
    map.set(key, next);
  });

  const merged = typeof dedupeLeadArrayV31 === 'function'
    ? dedupeLeadArrayV31([...map.values()], 'permanentBase.afterMerge')
    : [...map.values()];
  saveOperationalKeyV481(LEADS_BASE_KEY, merged, 'permanent-leads-merge');

  if (schedule) {
    if (typeof scheduleSupabaseLeadSync === 'function') scheduleSupabaseLeadSync(changed);
    if (typeof scheduleLegacyOperationalSyncV36 === 'function') scheduleLegacyOperationalSyncV36();
  }

  return merged;
}

function reconcilePermanentLeadBase({ schedule = true } = {}) {
  const gathered = [];
  const collect = (items, source) => {
    (Array.isArray(items) ? items : []).forEach(lead => {
      if (lead?.id) gathered.push({ ...lead, baseSource: lead.baseSource || source });
    });
  };

  try { collect(Object.values(getWeekData()?.days || {}).flat(), 'Agenda semanal'); } catch {}
  try { collect(Object.values(getHistoryData()?.days || {}).flat(), 'Histórico semanal'); } catch {}
  try { collect(getValData(), 'Validação'); } catch {}
  try { collect(getAtribuicaoData(), 'Atribuição'); } catch {}
  try { collect(getInstaFila(), 'Instagram'); } catch {}
  try { collect(getZapBacklog(), 'Backlog WhatsApp'); } catch {}
  try { collect(Object.values(getAcompData() || {}).flat(), 'Acompanhamento'); } catch {}
  try { collect(Object.values(typeof getInstaWeek === 'function' ? getInstaWeek() : {}).flat(), 'Agenda Instagram'); } catch {}
  try { collect(Object.values(filaDisparo || {}).flat(), 'Fila de disparo'); } catch {}

  return mergeLeadsIntoPermanentBase(gathered, {}, { schedule });
}

function getWeekData()  {
  const data = getStoredObject(EMPRESAS_KEY);
  return data && Object.keys(data).length ? data : null;
}
function saveWeekData(d){
  if (typeof dedupeWeeklyLeadsV31 === 'function') {
    d = dedupeWeeklyLeadsV31(d, 'saveWeekData.beforeSave');
  }
  saveOperationalKeyV481(EMPRESAS_KEY, d, 'weekly-leads-save');
  mergeLeadsIntoPermanentBase(Object.values(d?.days || {}).flat(), { source:'Agenda semanal' });
  scheduleLegacyOperationalSyncV36({ reason:'weekly-leads-save' });
}
function ensureWeekData() {
  let d = getWeekData(); const ws = currentWeekStartStr();
  if (!d || d.weekStart !== ws) {
    // Virada de semana detectada
    if (d) {
      const flat = Object.values(d.days||{}).flat();
      mergeLeadsIntoPermanentBase(flat, { source:'Histórico semanal' });

      // Leads pós-envio (Enviada e além) → migrar para base mensal
      const STATUS_MENSAIS = ['Enviada','Respondida','Não respondida','Recusada','Fechada'];
      const paraMes = flat.filter(e => STATUS_MENSAIS.includes(e.status||''));
      if (paraMes.length) {
        migrarParaMes(paraMes);
      }

      // Leads semanais (Não enviada, Em fila) → devolver para Atribuição automaticamente
      const parmaAtrib = flat.filter(e => !e.status || e.status === 'Não enviada' || e.status === 'Em fila');
      if (parmaAtrib.length) {
        const atrib = getAtribuicaoData();
        const atribIds = new Set(atrib.map(a => a.id));
        const novos = parmaAtrib.filter(e => !atribIds.has(e.id)).map(e => ({ ...e, voltouDaSemana: todayStr(), diaDestino: null }));
        saveAtribuicaoData([...atrib, ...novos]);

        // Limpar esses leads das filas de disparo dos chips
        const idsRetornados = new Set(parmaAtrib.map(e => e.id));
        const chips = getChips();
        chips.forEach(c => {
          if (filaDisparo[c.id]) {
            filaDisparo[c.id] = filaDisparo[c.id].filter(f => !idsRetornados.has(f.id));
          }
        });
        saveFilaDisparo();
      }

      // Salva histórico para compatibilidade
      saveOperationalKeyV481(HISTORY_KEY, { ...d, archivedAt: todayStr() }, 'weekly-history-save');

      // ── Virada de semana Instagram: "Não contatado" voltam para fila ──
      const instaWeekData = getInstaWeek();
      const todosInstaLeads = Object.values(instaWeekData).flat();
      if (todosInstaLeads.length) {
        const STATUS_INSTA_MENSAIS = ['DM Enviada','Respondeu','Não respondeu','Fechou','Recusou'];
        const instaParaMes = todosInstaLeads.filter(e => STATUS_INSTA_MENSAIS.includes(e.status||''));
        if (instaParaMes.length) migrarInstaParaMes(instaParaMes);

        const instaNaoContatados = todosInstaLeads.filter(e => !e.status || e.status === 'Não contatado');
        if (instaNaoContatados.length) {
          const filaAtual = getInstaFila();
          const filaIds = new Set(filaAtual.map(f => f.id));
          const voltam = instaNaoContatados
            .filter(e => !filaIds.has(e.id))
            .map(({ status, instagramUrl, atribuidoEm, dmEnviadaEm, ...base }) => ({ ...base, instagram: base.instagram || instagramUrl || '', voltouEm: todayStr() }));
          saveInstaFila([...filaAtual, ...voltam]);
        }
        saveInstaWeek({});
      }
    }
    d = { weekStart: ws, days: {} }; saveWeekData(d);
  }
  if (!d.days || typeof d.days !== 'object' || Array.isArray(d.days)) {
    d.days = {};
    saveWeekData(d);
  }
  if (typeof dedupeWeeklyLeadsV31 === 'function') {
    const before = Object.values(d.days || {}).flat().length;
    const clean = dedupeWeeklyLeadsV31(d, 'ensureWeekData.beforeReturn');
    const after = Object.values(clean.days || {}).flat().length;
    if (after !== before) {
      d = clean;
      try { saveOperationalKeyV481(EMPRESAS_KEY, d, 'weekly-leads-save'); } catch(e) {}
      try { console.warn('[agenda][dedupe-render]', { totalBefore:before, totalAfter:after, removed:before-after }); } catch(e) {}
    }
  }
  return d;
}
function getHistoryData() {
  const data = getStoredObject(HISTORY_KEY);
  if (!data || !Object.keys(data).length) return null;
  data.days = data.days && typeof data.days === 'object' && !Array.isArray(data.days) ? data.days : {};
  return data;
}

/* ════════════════════════════
   STORAGE — ACOMPANHAMENTO MENSAL
════════════════════════════ */
function getAcompData()  { return getStoredObject(ACOMP_KEY); }
function saveAcompData(d){
  saveOperationalKeyV481(ACOMP_KEY, d, 'monthly-tracking-save');
  mergeLeadsIntoPermanentBase(Object.values(d || {}).flat(), { source:'Acompanhamento' });
  scheduleLegacyOperationalSyncV36();
}
function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
}
function monthKeyLabel(key) {
  const [y, m] = key.split('-');
  const months = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  return `${months[parseInt(m,10)-1]}/${y}`;
}
function migrarParaMes(leads) {
  const data = getAcompData();
  const mk = currentMonthKey();
  if (!data[mk]) data[mk] = [];
  const existingIds = new Set(data[mk].map(e => e.id));
  const novos = leads.filter(e => !existingIds.has(e.id)).map(e => ({ ...e, migradoEm: todayStr() }));
  data[mk] = [...data[mk], ...novos];
  saveAcompData(data);
}
function flattenWeekData(d) { return Object.values(d.days||{}).flat(); }
function getAllNomes(d) { return new Set(flattenWeekData(d).map(e => normalizeStr(e.nome))); }
function getAllPhones(d) { return new Set(flattenWeekData(d).map(e => normalizePhone(e.whatsapp||'')).filter(Boolean)); }
function getAllSites(d)  { return new Set(flattenWeekData(d).map(e => extractDomain(e.site||'')).filter(Boolean)); }

/* ════════════════════════════
   STORAGE — VALIDAÇÃO FILA
════════════════════════════ */
function getValData()  { return getStoredArray(VAL_KEY); }
function saveValData(d){
  if (typeof dedupeLeadArrayV31 === 'function') d = dedupeLeadArrayV31(d || [], 'saveValData.beforeSave');
  saveOperationalKeyV481(VAL_KEY, d, 'validation-save');
  mergeLeadsIntoPermanentBase(d, { source:'Validação' });
  scheduleLegacyOperationalSyncV36({ reason:'validation-save' });
}

/* ════════════════════════════
   STORAGE — BASE DE ATRIBUIÇÃO
════════════════════════════ */
function getAtribuicaoData()  { return getStoredArray(ATRIBUICAO_KEY); }
function saveAtribuicaoData(d){
  if (typeof dedupeLeadArrayV31 === 'function') d = dedupeLeadArrayV31(d || [], 'saveAtribuicaoData.beforeSave');
  saveOperationalKeyV481(ATRIBUICAO_KEY, d, 'assignment-save');
  mergeLeadsIntoPermanentBase(d, { source:'Atribuição' });
  scheduleLegacyOperationalSyncV36({ reason:'assignment-save' });
}


function getInstaFila()  { return getStoredArray(INSTA_KEY); }
function saveInstaFila(d){
  if (typeof dedupeLeadArrayV31 === 'function') d = dedupeLeadArrayV31(d || [], 'saveInstaFila.beforeSave');
  saveOperationalKeyV481(INSTA_KEY, d, 'instagram-queue-save');
  mergeLeadsIntoPermanentBase(d, { source:'Instagram' });
  scheduleLegacyOperationalSyncV36({ reason:'instagram-queue-save' });
}


// V48.5 — preserva site/website ao devolver lead da Atribuição para Validação.
// Alguns cards de atribuição antigos podem estar sem site por causa de versões anteriores.
// Antes de salvar na validação, tentamos hidratar pelos campos do próprio lead e pela base permanente.
function hydrateLeadSiteFieldsV485(lead = {}) {
  const rawSite = String(lead.site || lead.website || lead.websiteUrl || lead.website_url || '').trim();
  let source = rawSite ? lead : null;

  if (!source && typeof getLeadBaseData === 'function') {
    try {
      const base = getLeadBaseData() || [];
      const leadPhone = String(lead.whatsapp || lead.phone || lead.telefone || '').replace(/\D/g, '');
      source = base.find(item => {
        if (!item) return false;
        if (lead.id && item.id === lead.id) return true;
        const itemPhone = String(item.whatsapp || item.phone || item.telefone || '').replace(/\D/g, '');
        return leadPhone && itemPhone && leadPhone === itemPhone;
      }) || null;
    } catch(e) { source = null; }
  }

  const site = String(
    rawSite ||
    source?.site ||
    source?.website ||
    source?.websiteUrl ||
    source?.website_url ||
    ''
  ).trim();

  const hydrated = {
    ...lead,
    site,
    website: site,
    websiteUrl: lead.websiteUrl || source?.websiteUrl || site,
    website_url: lead.website_url || source?.website_url || site,
    website_type: lead.website_type || source?.website_type || source?.websiteType || '',
    website_quality: lead.website_quality || source?.website_quality || '',
  };

  const hasOwnSite = typeof leadHasOwnSiteV47 === 'function'
    ? leadHasOwnSiteV47(hydrated)
    : !!site;
  const segment = hasOwnSite ? 'com-site' : 'sem-site';

  hydrated.tipo = segment;
  hydrated.templateType = segment;
  hydrated.siteSegment = segment;
  hydrated.hasOwnSite = hasOwnSite;
  return hydrated;
}

function recuperarValidacaoZapDoDia() {
  if (window.__VS_RECUPERAR_VALIDACAO_ZAP_V481 === '1') return 0;

  const hoje = todayStr();
  const atribuicao = getAtribuicaoData();
  const validacao = getValData();
  const validacaoIds = new Set(validacao.map(lead => lead.id));
  const devemVoltar = atribuicao.filter(lead =>
    lead.canal === 'zap' &&
    lead.validadoEm === hoje &&
    (lead.status || 'Não enviada') === 'Não enviada' &&
    !lead.diaDestino
  );

  if (devemVoltar.length) {
    const recuperados = devemVoltar
      .filter(lead => !validacaoIds.has(lead.id))
      .map(lead => {
        const hydrated = typeof hydrateLeadSiteFieldsV485 === 'function' ? hydrateLeadSiteFieldsV485(lead) : lead;
        return {
          ...hydrated,
          canal: 'pendente',
          numStatus: 'pendente',
          importadoEm: hydrated.importadoEm || hydrated.criadoEm || hoje,
          diaDestino: null,
          recuperadoDaAtribuicaoEm: hoje,
        };
      });
    const recuperarIds = new Set(devemVoltar.map(lead => lead.id));
    saveValData([...validacao, ...recuperados]);
    saveAtribuicaoData(atribuicao.filter(lead => !recuperarIds.has(lead.id)));
  }

  window.__VS_RECUPERAR_VALIDACAO_ZAP_V481 = '1';
  return devemVoltar.length;
}

/* ════════════════════════════
   STORAGE — INSTA CRONOGRAMA
════════════════════════════ */
function getInstaSched()  { return getStoredObject(INSTA_SCHED_KEY); }
function saveInstaSched(d){ saveOperationalKeyV481(INSTA_SCHED_KEY, d, 'instagram-schedule-save'); scheduleLegacyOperationalSyncV36(); }

/* ════════════════════════════
   STORAGE — CHIPS
════════════════════════════ */
function getChips()  {
  const chips = getStoredArray(CHIPS_KEY);
  if (typeof normalizeChipListForStorageV437 !== 'function') return chips;
  const normalized = normalizeChipListForStorageV437(chips);
  try {
    if (JSON.stringify(normalized) !== JSON.stringify(chips)) {
      saveOperationalKeyV481(CHIPS_KEY, normalized, 'chips-normalize-save');
    }
  } catch(e) {}
  return normalized;
}
function saveChips(c){
  const chips = typeof normalizeChipListForStorageV437 === 'function' ? normalizeChipListForStorageV437(c) : c;
  saveOperationalKeyV481(CHIPS_KEY, chips, 'chips-save');
  window.__VS_LEGACY_CHIPS_UPDATED_AT_V481 = new Date().toISOString();
  uiSyncLogV426('optimistic-update', { entity:'chip', action:'save-legacy-cache', count:Array.isArray(chips) ? chips.length : 0 });
  scheduleLegacyOperationalSyncV36({ delay:0 });
}
function getChipById(id) { return getChips().find(c => c.id === id); }

/* ════════════════════════════
   STORAGE — RAMOS
════════════════════════════ */
function getRamos()  {
  const data = getStoredArray(RAMOS_KEY);
  return Array.isArray(data) && data.length ? data : RAMOS_DEFAULT;
}
function saveRamos(r){ saveOperationalKeyV481(RAMOS_KEY, r, 'branches-save'); scheduleLegacyOperationalSyncV36(); }

/* ════════════════════════════
   EXCLUDED DOMAINS
════════════════════════════ */
function getExcludedDomains() { return getStoredArray(EXCLUDED_KEY); }
function saveExcludedDomains(arr) { saveOperationalKeyV481(EXCLUDED_KEY, arr, 'excluded-domains-save'); scheduleLegacyOperationalSyncV36(); }
function extractDomain(site) {
  try { return new URL(site.trim()).hostname.replace(/^www\./,'').toLowerCase(); } catch { return null; }
}
function isExcludedDomain(site) {
  const domain = extractDomain(site);
  if (!domain) return false;
  return getExcludedDomains().includes(domain);
}
function addExcludedDomains(sites) {
  // sites: array de URLs para adicionar à lista de já vistos
  const current = new Set(getExcludedDomains());
  let added = 0;
  sites.forEach(site => {
    const d = extractDomain(site) || site.toLowerCase().trim();
    if (d && !current.has(d)) { current.add(d); added++; }
  });
  if (added) { saveExcludedDomains([...current]); renderExcluidos(); }
  return added;
}

/* ════════════════════════════
   SITE BLOCKLIST
════════════════════════════ */
const SITE_BLOCKLIST_DOMAINS = [
  'google.com','google.com.br','instagram.com','facebook.com','fb.com',
  'twitter.com','x.com','linkedin.com','youtube.com','tiktok.com',
  'whatsapp.com','wa.me','maps.google.com','goo.gl','bit.ly','linktr.ee',
  'wix.com','wordpress.com','blogspot.com','hotmart.com','kiwify.com.br',
  'mercadolivre.com.br','shopify.com','ifood.com.br','booking.com',
  'olx.com.br','gov.br','sebrae.com.br','yelp.com','tripadvisor.com',
  'guiamais.com.br','telelistas.net',
];
function isSiteBlocklisted(site) {
  try {
    const hostname = new URL(site).hostname.replace(/^www\./, '').toLowerCase();
    return SITE_BLOCKLIST_DOMAINS.some(b => hostname === b || hostname.endsWith('.' + b));
  } catch { return false; }
}
