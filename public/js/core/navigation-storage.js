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
const PANELS = ['audit','conversations','responses','chips','whatsappQueue','evolution','inicio','inbox','importar','validacao','atribuicao','instagram','fila-zap','kanban','followups','acompanhamento','redirecionamentos','configuracoes','conta'];
function switchPanel(name) {
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
  if (name==='responses')      renderResponsesPanelV34();
  if (name==='whatsappQueue')  renderWhatsappQueuePanel();
  if (name==='evolution')      renderEvolutionPanel();
  if (name==='kanban')         renderKanban();
  if (name==='followups')      renderFollowups();
  if (name==='acompanhamento') renderAcompanhamento();
  if (name==='conta')          renderMinhaContaV426();
  if (name==='configuracoes')  {
    renderConfiguracoes();
    if (typeof renderWebhookUrlV34 === 'function') renderWebhookUrlV34();
  }
  updateBadges();
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
  _supabaseLeadSyncTimer = setTimeout(() => {
    const pending = Array.from(_pendingSupabaseLeadSyncV426.values());
    _pendingSupabaseLeadSyncV426.clear();
    pending.forEach(lead => upsertLeadToSupabase(lead));
  }, 250);
}

/* ════════════════════════════
   STORAGE — EMPRESAS
════════════════════════════ */
function getStoredArray(key) {
  try {
    const data = JSON.parse(localStorage.getItem(key) || 'null');
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}
function getStoredObject(key) {
  try {
    const data = JSON.parse(localStorage.getItem(key) || 'null');
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
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



/* ════════════════════════════
   DEDUPLICAÇÃO DE LEADS V434
   Evita duplicar leads quando o mesmo JSON é importado mais de uma vez
   ou quando syncs locais reconstroem a base permanente com IDs diferentes.
════════════════════════════ */
function normalizeLeadPhoneV434(value = '') {
  try {
    const digits = String(value || '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits.startsWith('00')) return digits.slice(2);
    if (digits.startsWith('55')) return digits;
    if (digits.length === 10 || digits.length === 11) return '55' + digits;
    return digits;
  } catch { return ''; }
}

function normalizeLeadUrlV434(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return `${url.hostname.replace(/^www\./, '').toLowerCase()}${url.pathname.replace(/\/+$/, '')}`.toLowerCase();
  } catch {
    return raw.replace(/\/+$/, '').toLowerCase();
  }
}

function normalizeLeadTextV434(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toLowerCase();
}

function getLeadIdentityKeyV434(lead = {}) {
  const maps = normalizeLeadUrlV434(lead.googleUrl || lead.mapsUrl || lead.maps_url || lead.url || '');
  if (maps) return `maps:${maps}`;

  const phone = normalizeLeadPhoneV434(lead.whatsapp || lead.phone || lead.telefone || '');
  const name = normalizeLeadTextV434(lead.nome || lead.companyName || lead.company_name || lead.title || '');
  if (phone && name) return `phone-name:${phone}:${name}`;
  if (phone) return `phone:${phone}`;

  const site = normalizeLeadUrlV434(lead.site || lead.website || '');
  if (site) return `site:${site}`;

  if (name) return `name:${name}`;
  return lead?.id ? `id:${lead.id}` : '';
}

function mergeDuplicateLeadPayloadV434(previous = {}, incoming = {}) {
  const next = { ...previous, ...incoming };
  next.id = previous.id || incoming.id;
  ['nome','companyName','title','whatsapp','phone','telefone','instagram','instagramUrl','site','website','googleUrl','mapsUrl','url'].forEach(key => {
    if (!String(next[key] || '').trim() && String(previous[key] || '').trim()) next[key] = previous[key];
  });
  next.status = choosePermanentLeadStatus(previous.status, incoming.status || next.status);
  next.pipelineStatus = incoming.pipelineStatus || previous.pipelineStatus || incoming.pipeline_status || previous.pipeline_status;
  next.crmData = incoming.crmData || previous.crmData || incoming.crm_data || previous.crm_data;
  next.crm_data = incoming.crm_data || previous.crm_data || incoming.crmData || previous.crmData;
  return next;
}

function dedupeLeadArrayV434(items = [], { label = 'lead-array' } = {}) {
  const byKey = new Map();
  const result = [];
  let removed = 0;
  (Array.isArray(items) ? items : []).forEach(item => {
    if (!item) return;
    const key = getLeadIdentityKeyV434(item) || `id:${item.id || result.length}`;
    const existingIndex = byKey.get(key);
    if (existingIndex === undefined) {
      byKey.set(key, result.length);
      result.push(item);
      return;
    }
    result[existingIndex] = mergeDuplicateLeadPayloadV434(result[existingIndex], item);
    removed++;
  });
  if (removed) {
    try { console.warn('[dedupe][leads]', { label, before:items.length, after:result.length, removed }); } catch (_) {}
  }
  return result;
}

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

  const now = new Date().toISOString();
  const base = dedupeLeadArrayV434(getLeadBaseData(), { label:'permanent-base-before-merge' });
  const map = new Map(base.filter(lead => lead?.id).map(lead => [lead.id, lead]));
  const identityToId = new Map(base.map(lead => [getLeadIdentityKeyV434(lead), lead.id]).filter(([key, id]) => key && id));
  const changed = [];

  leads.forEach(rawLead => {
    if (!rawLead?.id) return;
    const identityKey = getLeadIdentityKeyV434(rawLead);
    const existingIdByIdentity = identityKey ? identityToId.get(identityKey) : '';
    const canonicalId = existingIdByIdentity || rawLead.id;
    const lead = canonicalId !== rawLead.id ? { ...rawLead, duplicateOfId: canonicalId } : rawLead;
    const previous = map.get(canonicalId) || {};
    const next = {
      ...previous,
      ...lead,
      id: canonicalId,
      status: choosePermanentLeadStatus(previous.status, lead.status),
      baseSource: metadata.source || lead.baseSource || previous.baseSource || 'Fluxo local',
      permanentCreatedAt: previous.permanentCreatedAt || lead.permanentCreatedAt || lead.created_at || now,
      permanentUpdatedAt: now
    };
    const fields = ['nome','companyName','title','whatsapp','phone','telefone','instagram','instagramUrl','site','website','googleUrl','mapsUrl','url','status','pipelineStatus'];
    if (!previous.id || fields.some(field => String(previous[field] || '') !== String(next[field] || ''))) changed.push(next);
    map.set(canonicalId, next);
    if (identityKey) identityToId.set(identityKey, canonicalId);
  });

  const merged = dedupeLeadArrayV434([...map.values()], { label:'permanent-base-after-merge' });
  localStorage.setItem(LEADS_BASE_KEY, JSON.stringify(merged));

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
  try {
    const data = JSON.parse(localStorage.getItem(EMPRESAS_KEY) || 'null');
    return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}
function saveWeekData(d){
  if (d?.days && typeof d.days === 'object') {
    Object.keys(d.days).forEach(day => { d.days[day] = dedupeLeadArrayV434(d.days[day] || [], { label:`agenda-${day}` }); });
  }
  localStorage.setItem(EMPRESAS_KEY, JSON.stringify(d));
  mergeLeadsIntoPermanentBase(Object.values(d?.days || {}).flat(), { source:'Agenda semanal' });
  scheduleLegacyOperationalSyncV36();
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
      localStorage.setItem(HISTORY_KEY, JSON.stringify({ ...d, archivedAt: todayStr() }));

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
  return d;
}
function getHistoryData() {
  try {
    const data = JSON.parse(localStorage.getItem(HISTORY_KEY) || 'null');
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    data.days = data.days && typeof data.days === 'object' && !Array.isArray(data.days) ? data.days : {};
    return data;
  } catch {
    return null;
  }
}

/* ════════════════════════════
   STORAGE — ACOMPANHAMENTO MENSAL
════════════════════════════ */
function getAcompData()  { return getStoredObject(ACOMP_KEY); }
function saveAcompData(d){
  localStorage.setItem(ACOMP_KEY, JSON.stringify(d));
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
  const clean = dedupeLeadArrayV434(d, { label:'validacao' });
  localStorage.setItem(VAL_KEY, JSON.stringify(clean));
  mergeLeadsIntoPermanentBase(clean, { source:'Validação' });
  scheduleLegacyOperationalSyncV36();
}

/* ════════════════════════════
   STORAGE — BASE DE ATRIBUIÇÃO
════════════════════════════ */
function getAtribuicaoData()  { return getStoredArray(ATRIBUICAO_KEY); }
function saveAtribuicaoData(d){
  const clean = dedupeLeadArrayV434(d, { label:'atribuicao' });
  localStorage.setItem(ATRIBUICAO_KEY, JSON.stringify(clean));
  mergeLeadsIntoPermanentBase(clean, { source:'Atribuição' });
  scheduleLegacyOperationalSyncV36();
}


function getInstaFila()  { return getStoredArray(INSTA_KEY); }
function saveInstaFila(d){
  const clean = dedupeLeadArrayV434(d, { label:'instagram' });
  localStorage.setItem(INSTA_KEY, JSON.stringify(clean));
  mergeLeadsIntoPermanentBase(clean, { source:'Instagram' });
  scheduleLegacyOperationalSyncV36();
}

function recuperarValidacaoZapDoDia() {
  if (localStorage.getItem(RECUPERAR_VALIDACAO_ZAP_KEY) === '1') return 0;

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
      .map(lead => ({
        ...lead,
        canal: 'pendente',
        numStatus: 'pendente',
        importadoEm: lead.importadoEm || lead.criadoEm || hoje,
        diaDestino: null,
        recuperadoDaAtribuicaoEm: hoje,
      }));
    const recuperarIds = new Set(devemVoltar.map(lead => lead.id));
    saveValData([...validacao, ...recuperados]);
    saveAtribuicaoData(atribuicao.filter(lead => !recuperarIds.has(lead.id)));
  }

  localStorage.setItem(RECUPERAR_VALIDACAO_ZAP_KEY, '1');
  return devemVoltar.length;
}

/* ════════════════════════════
   STORAGE — INSTA CRONOGRAMA
════════════════════════════ */
function getInstaSched()  { return getStoredObject(INSTA_SCHED_KEY); }
function saveInstaSched(d){ localStorage.setItem(INSTA_SCHED_KEY, JSON.stringify(d)); scheduleLegacyOperationalSyncV36(); }

/* ════════════════════════════
   STORAGE — CHIPS
════════════════════════════ */
function getChips()  { return getStoredArray(CHIPS_KEY); }
function saveChips(c){
  localStorage.setItem(CHIPS_KEY, JSON.stringify(c));
  localStorage.setItem(LEGACY_CHIPS_UPDATED_AT_KEY_V426, new Date().toISOString());
  uiSyncLogV426('optimistic-update', { entity:'chip', action:'save-legacy-cache', count:Array.isArray(c) ? c.length : 0 });
  scheduleLegacyOperationalSyncV36({ delay:0 });
}
function getChipById(id) { return getChips().find(c => c.id === id); }

/* ════════════════════════════
   STORAGE — RAMOS
════════════════════════════ */
function getRamos()  {
  try {
    const data = JSON.parse(localStorage.getItem(RAMOS_KEY) || 'null');
    return Array.isArray(data) ? data : RAMOS_DEFAULT;
  } catch {
    return RAMOS_DEFAULT;
  }
}
function saveRamos(r){ localStorage.setItem(RAMOS_KEY, JSON.stringify(r)); scheduleLegacyOperationalSyncV36(); }

/* ════════════════════════════
   EXCLUDED DOMAINS
════════════════════════════ */
function getExcludedDomains() { return getStoredArray(EXCLUDED_KEY); }
function saveExcludedDomains(arr) { localStorage.setItem(EXCLUDED_KEY, JSON.stringify(arr)); scheduleLegacyOperationalSyncV36(); }
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

