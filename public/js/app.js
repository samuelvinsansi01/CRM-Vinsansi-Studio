/* ════════════════════════════
   CONSTANTS & KEYS
════════════════════════════ */
const EMPRESAS_KEY   = 'vs_empresas_v2';
const HISTORY_KEY    = 'vs_history_v2';
const ACOMP_KEY      = 'vs_acompanhamento_v1'; // base de resultados mensais
const EVO_KEY        = 'vs_evo_config_v2';
const SIDEBAR_KEY    = 'vs_sidebar';
const EXCLUDED_KEY   = 'vs_excluded_domains';
const CHIPS_KEY      = 'vs_chips_v2';
const RAMOS_KEY      = 'vs_ramos_v2';
const TEMPLATES_KEY  = 'vs_templates_v2';
const TEMPLATES_RAMO_KEY = 'vs_templates_ramo_v1'; // templates por ramo+tipo
const VAL_KEY        = 'vs_validacao_v2';   // fila de validação
const ATRIBUICAO_KEY = 'vs_atribuicao_v1';  // base de atribuição (leads validados sem dia)
const INSTA_KEY      = 'vs_insta_fila_v2';  // fila instagram aguardando atribuição
const INSTA_WEEK_KEY = 'vs_insta_week_v1';  // leads instagram atribuídos por dia
const INSTA_SCHED_KEY = 'vs_insta_sched_v1'; // cronograma instagram
const FILA_DISPARO_KEY = 'vs_fila_disparo_v1'; // fila de disparo WhatsApp
const LEAD_CRM_KEY   = 'vs_lead_crm_v1'; // notas, histórico e pipeline comercial

// Supabase — usado primeiro apenas para login Google.
// Ainda não mexe nos leads e ainda não substitui o localStorage.
const SUPABASE_URL = 'https://txyknazfufashgzlxkqh.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_ClGVAmaiS4tNWe8W_4EPew_aPvAzK0E';
const sbClient = window.supabase
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
  : null;
let currentUser = null;
const supabaseDataAdapter = (sbClient && window.SupabaseAdapter)
  ? new window.SupabaseAdapter(sbClient)
  : null;

const STATUS_OPTIONS = ['Não enviada','Em fila','Enviada','Respondida','Não respondida','Recusada','Fechada'];
const WEEKDAY_NAMES  = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];



/* ════════════════════════════
   AUTH GATE V20.2 FIXED
════════════════════════════ */
function isAuthenticated() {
  return !!(currentUser && currentUser.id);
}

function showAuthGate() {
  const gate = document.getElementById('authGate');
  if (gate) gate.classList.add('open');
  document.documentElement.classList.add('auth-locked');
  document.body.classList.add('auth-locked');
}

function hideAuthGate() {
  const gate = document.getElementById('authGate');
  if (gate) gate.classList.remove('open');
  document.documentElement.classList.remove('auth-locked');
  document.body.classList.remove('auth-locked');
}

function updateAuthGate() {
  if (isAuthenticated()) hideAuthGate();
  else showAuthGate();
}

document.addEventListener('DOMContentLoaded', () => {
  showAuthGate();
});

/* ════════════════════════════
   AUTH — SUPABASE / GOOGLE
   Por enquanto só identifica o usuário.
   Não salva leads no banco ainda.
════════════════════════════ */
function getAuthRedirectUrl() {
  if (window.location.protocol === 'file:') {
    notify('Abra pelo domínio publicado, não pelo arquivo direto.', 'warn');
    return window.location.origin;
  }

  return window.location.origin;
}

function getUserDisplayName(user) {
  if (!user) return '';
  return user.user_metadata?.full_name || user.user_metadata?.name || user.email || 'Usuário';
}


function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderAuthUser(user) {
  const box = document.getElementById('authUserBox');
  const loginBtn = document.getElementById('authLoginBtn');
  const logoutBtn = document.getElementById('authLogoutBtn');
  if (!box || !loginBtn || !logoutBtn) return;

  if (user) {
    const name = getUserDisplayName(user);
    box.innerHTML = `<strong>Conectado</strong><br>${escapeHtml(name)}`;
    loginBtn.style.display = 'none';
    logoutBtn.style.display = 'inline-flex';
  } else {
    box.innerHTML = '<strong>Conta</strong><br>não conectado';
    loginBtn.style.display = 'inline-flex';
    logoutBtn.style.display = 'none';
  }
}

function clearLocalSessionData() {
  localStorage.removeItem('vs_empresas_v2');
  localStorage.removeItem('vs_lead_crm_v1');
  localStorage.removeItem(SYNC_STATE_KEY);
  updateAuthGate();
  try { rebuildSidebarV40(); } catch(e){}
}

async function initAuth() {
  if (!sbClient) {
    console.warn('[auth] Supabase SDK não carregou.');
    renderAuthUser(null);
    showAuthGate();
    return;
  }

  const { data, error } = await sbClient.auth.getSession();
  if (error) console.warn('[auth] getSession:', error.message);
  currentUser = data?.session?.user || null;
  
  if (!currentUser) {
    clearLocalSessionData();
  }
renderAuthUser(currentUser);
  updateAuthGate();
  renderProductionReadyNote();

  sbClient.auth.onAuthStateChange(async (_event, session) => {
    currentUser = session?.user || null;
    renderAuthUser(currentUser);
    updateAuthGate();

    if (currentUser) {
      if (typeof loadSupabaseAsPrimarySource === 'function') {
        await loadSupabaseAsPrimarySource();
      try { await loadOperationalDataFromSupabaseV36(); } catch(e){}
      } else if (typeof loadSupabaseLeadsToLocalState === 'function') {
        await loadSupabaseLeadsToLocalState();
      }
    } else {
      if (typeof clearLocalSessionData === 'function') clearLocalSessionData();
      localStorage.removeItem('vs_empresas_v2');
      localStorage.removeItem('vs_lead_crm_v1');
      if (typeof renderInicio === 'function') renderInicio();
      if (typeof updateBadges === 'function') updateBadges();
    }
  });

  if (currentUser) {
    await loadSupabaseAsPrimarySource();
  }
}

async function loginGoogle() {
  if (!sbClient) {
    notify('Supabase não carregou. Recarregue a página.', 'err');
    return;
  }

  const { error } = await sbClient.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: getAuthRedirectUrl() }
  });

  if (error) {
    console.error('[auth] loginGoogle:', error);
    notify('Erro ao entrar com Google', 'err');
  }
}

async function logoutSupabase() {
  if (!sbClient) return;

  const { error } = await sbClient.auth.signOut();

  if (error) {
    console.error('[auth] logout:', error);
    notify('Erro ao sair da conta', 'err');
    return;
  }

  localStorage.removeItem('vs_empresas_v2');
  localStorage.removeItem('vs_lead_crm_v1');

  currentUser = null;

  renderAuthUser(null);

  if (typeof renderInicio === 'function') renderInicio();
  if (typeof updateBadges === 'function') updateBadges();

  showAuthGate();
  notify('Conta desconectada');
}



/* ════════════════════════════
   CRM — FICHA DO LEAD
   V1: drawer lateral com pipeline, notas e histórico.
   Salva somente metadados no localStorage, sem mexer no fluxo atual.
════════════════════════════ */
const PIPELINE_STEPS = [
  { id: 'contato_enviado', label: 'Contato enviado' },
  { id: 'respondeu', label: 'Respondeu' },
  { id: 'reuniao', label: 'Reunião' },
  { id: 'proposta', label: 'Proposta' },
  { id: 'fechado', label: 'Fechado' },
  { id: 'perdido', label: 'Perdido' },
];
let activeLeadDrawerId = null;
let activeLeadDrawerData = null;

function getLeadCrmStore() {
  try { return LeadService.getLeadCrmStore(); }
  catch { return {}; }
}

function saveLeadCrmStore(store) {
  localStorage.setItem(LEAD_CRM_KEY, JSON.stringify(store || {}));
}

function crmNowLabel() {
  return new Date().toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
}

function todayIsoDate() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function formatIsoDateBR(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

function getFollowUpInfo(dateIso) {
  if (!dateIso) return { className: 'empty', label: '// sem follow-up agendado' };
  const today = todayIsoDate();
  if (dateIso === today) return { className: 'today', label: `Hoje · ${formatIsoDateBR(dateIso)}` };
  if (dateIso < today) return { className: 'late', label: `Atrasado · ${formatIsoDateBR(dateIso)}` };
  return { className: 'future', label: `Futuro · ${formatIsoDateBR(dateIso)}` };
}

function getFollowUpBucket(dateIso) {
  if (!dateIso) return 'none';
  const today = todayIsoDate();
  if (dateIso === today) return 'today';
  if (dateIso < today) return 'late';
  return 'upcoming';
}

function getAllFollowUps() {
  const store = getLeadCrmStore();
  return Object.entries(store)
    .filter(([, crm]) => crm && crm.followUpDate)
    .map(([id, crm]) => {
      const raw = findLeadEverywhere(id) || {};
      const lead = normalizeLeadForDrawer({ id, ...raw });
      const info = getFollowUpInfo(crm.followUpDate);
      return {
        id,
        date: crm.followUpDate,
        bucket: getFollowUpBucket(crm.followUpDate),
        label: info.label,
        className: info.className,
        lead,
        crm
      };
    })
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}


async function loadSupabaseLeadCrmToLocalState() {
  if (!sbClient || !currentUser) return;

  const [notesRes, historyRes, followupsRes] = await Promise.all([
    sbClient.from('lead_notes').select('*').eq('user_id', currentUser.id),
    sbClient.from('lead_history').select('*').eq('user_id', currentUser.id),
    sbClient.from('lead_followups').select('*').eq('user_id', currentUser.id)
  ]);

  if (notesRes.error) console.warn('[supabase] notes:', notesRes.error.message);
  if (historyRes.error) console.warn('[supabase] history:', historyRes.error.message);
  if (followupsRes.error) console.warn('[supabase] followups:', followupsRes.error.message);

  const store = getLeadCrmStore ? getLeadCrmStore() : {};

  (notesRes.data || []).forEach(note => {
    if (!store[note.lead_id]) {
      store[note.lead_id] = {
        pipelineStatus: 'contato_enviado',
        notes: [],
        history: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
    }

    store[note.lead_id].notes = Array.isArray(store[note.lead_id].notes) ? store[note.lead_id].notes : [];
    store[note.lead_id].notes.push({
      at: note.created_at ? new Date(note.created_at).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : crmNowLabel(),
      text: note.note || ''
    });
  });

  (historyRes.data || []).forEach(item => {
    if (!store[item.lead_id]) {
      store[item.lead_id] = {
        pipelineStatus: 'contato_enviado',
        notes: [],
        history: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
    }

    store[item.lead_id].history = Array.isArray(store[item.lead_id].history) ? store[item.lead_id].history : [];
    store[item.lead_id].history.push({
      at: item.created_at ? new Date(item.created_at).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : crmNowLabel(),
      text: item.event || ''
    });
  });

  (followupsRes.data || []).forEach(fu => {
    if (!store[fu.lead_id]) {
      store[fu.lead_id] = {
        pipelineStatus: 'contato_enviado',
        notes: [],
        history: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
    }

    store[fu.lead_id].followUpDate = fu.followup_date || '';
    store[fu.lead_id].followUpStatus = fu.status || 'future';
  });

  saveLeadCrmStore(store);
  console.log(`[supabase] CRM carregado: ${(notesRes.data || []).length} notas, ${(historyRes.data || []).length} eventos, ${(followupsRes.data || []).length} follow-ups`);
}

async function loadSupabaseLeadsToLocalState() {
  if (!sbClient || !currentUser) return;

  const { data, error } = await sbClient
    .from('leads')
    .select('*')
    .eq('user_id', currentUser.id);

  if (error) {
    console.error('[supabase] load leads:', error);
    notify('Erro ao carregar leads do Supabase', 'err');
    return;
  }

  const today = todayStr();

  const leads = (data || []).map(item => ({
    id: item.id,
    nome: item.company_name || 'Lead sem nome',
    whatsapp: item.phone || '',
    instagram: item.instagram || '',
    site: item.website || '',
    googleUrl: item.maps_url || '',
    status: item.status || 'Não enviada',
    criadoEm: item.created_at
      ? new Date(item.created_at).toLocaleDateString('pt-BR')
      : today
  }));

  const weekData = {
    weekStart: currentWeekStartStr(),
    days: {
      [today]: leads
    }
  };

  saveWeekData(weekData);
  renderInicio();
  updateBadges();
  renderCrmHomeDashboard();
  renderExecutiveDashboard();

  await loadSupabaseLeadCrmToLocalState();

  console.log(`[supabase] Leads carregados: ${leads.length}`);
}

function getTodayFollowUps() {
  return getAllFollowUps().filter(item => item.bucket === 'today');
}

function getLateFollowUps() {
  return getAllFollowUps().filter(item => item.bucket === 'late');
}

function getUpcomingFollowUps() {
  return getAllFollowUps().filter(item => item.bucket === 'upcoming');
}

function renderFollowUpsHome() {
  const box = document.getElementById('followUpsHomeCard');
  if (!box) return;

  const today = getTodayFollowUps();
  const late = getLateFollowUps();
  const upcoming = getUpcomingFollowUps();
  const priority = [...late, ...today, ...upcoming].slice(0, 8);

  const itemHtml = priority.length
    ? priority.map(item => `
      <button class="followup-mini-item ${item.bucket}" onclick="openLeadDrawer('${item.id}')">
        <span>
          <strong>${escHtml(item.lead.nome || 'Lead')}</strong>
          <small>${escHtml(item.lead.whatsapp || item.lead.instagram || item.lead.site || 'sem canal')}</small>
        </span>
        <em>${escHtml(formatIsoDateBR(item.date))}</em>
      </button>
    `).join('')
    : `<div class="followup-empty">// nenhum follow-up agendado</div>`;

  box.innerHTML = `
    <div class="followup-card-head">
      <div>
        <div class="card-title" style="margin-bottom:4px">Follow-ups</div>
        <div class="followup-sub">// próximos contatos agendados</div>
      </div>
      <div class="followup-summary">
        <span class="late">${late.length} atrasado${late.length!==1?'s':''}</span>
        <span class="today">${today.length} hoje</span>
      </div>
    </div>
    <div class="followup-stats-row">
      <div><strong>${today.length}</strong><small>Hoje</small></div>
      <div><strong>${late.length}</strong><small>Atrasados</small></div>
      <div><strong>${upcoming.length}</strong><small>Próximos</small></div>
    </div>
    <div class="followup-mini-list">${itemHtml}</div>
  `;
}



function ensureLeadCrm(id, baseLead = {}) {
  const store = getLeadCrmStore();
  if (!store[id]) {
    store[id] = {
      pipelineStatus: baseLead.pipelineStatus || 'contato_enviado',
      notes: [],
      history: [{ at: crmNowLabel(), text: 'Ficha do lead criada' }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    saveLeadCrmStore(store);
  } else {
    store[id].notes = Array.isArray(store[id].notes) ? store[id].notes : [];
    store[id].history = Array.isArray(store[id].history) ? store[id].history : [];
    store[id].pipelineStatus = store[id].pipelineStatus || 'contato_enviado';
    store[id].followUpDate = store[id].followUpDate || '';
  }
  return store[id];
}

function saveLeadCrm(id, crm) {
  const store = getLeadCrmStore();
  store[id] = { ...crm, updatedAt: new Date().toISOString() };
  saveLeadCrmStore(store);
}

function getLeadForCloud(id, baseLead = {}) {
  const raw = findLeadEverywhere(id) || baseLead || {};
  const lead = normalizeLeadForDrawer({ ...raw, ...baseLead, id });
  const crm = ensureLeadCrm(id, lead);
  return {
    ...lead,
    id,
    pipelineStatus: crm.pipelineStatus || 'contato_enviado'
  };
}

async function syncLeadToCloud(id, baseLead = {}) {
  if (!supabaseDataAdapter || !currentUser || !id) return;
  try {
    await supabaseDataAdapter.saveLead(getLeadForCloud(id, baseLead));
  } catch (error) {
    console.warn('[cloud] saveLead:', error);
  }
}

async function syncLeadNoteToCloud(id, noteText, baseLead = {}) {
  if (!supabaseDataAdapter || !currentUser || !id) return;
  try {
    await supabaseDataAdapter.saveNote(getLeadForCloud(id, baseLead), noteText);
  } catch (error) {
    console.warn('[cloud] saveNote:', error);
  }
}

async function syncLeadHistoryToCloud(id, eventText, baseLead = {}) {
  if (!supabaseDataAdapter || !currentUser || !id) return;
  try {
    await supabaseDataAdapter.saveHistory(getLeadForCloud(id, baseLead), eventText);
  } catch (error) {
    console.warn('[cloud] saveHistory:', error);
  }
}

async function syncLeadFollowUpToCloud(id, dateIso, baseLead = {}) {
  if (!supabaseDataAdapter || !currentUser || !id) return;
  try {
    await supabaseDataAdapter.saveFollowUp(getLeadForCloud(id, baseLead), dateIso);
  } catch (error) {
    console.warn('[cloud] saveFollowUp:', error);
  }
}

async function clearLeadFollowUpFromCloud(id, baseLead = {}) {
  if (!supabaseDataAdapter || !currentUser || !id) return;
  try {
    await supabaseDataAdapter.clearFollowUp(getLeadForCloud(id, baseLead));
  } catch (error) {
    console.warn('[cloud] clearFollowUp:', error);
  }
}

function addLeadHistory(id, text, baseLead = {}) {
  const crm = ensureLeadCrm(id, baseLead);
  crm.history.push({
    at: crmNowLabel(),
    text
  });
  saveLeadCrm(id, crm);
  syncLeadHistoryToCloud(id, text, baseLead);
}


function findLeadEverywhere(id) {
  const data = ensureWeekData();
  const weekLead = Object.values(data.days || {}).flat().find(e => e.id === id);
  if (weekLead) return weekLead;

  const atrib = getAtribuicaoData().find(e => e.id === id);
  if (atrib) return atrib;

  const val = getValData().find(e => e.id === id);
  if (val) return val;

  const insta = getInstaFila().find(e => e.id === id);
  if (insta) return insta;

  const mk = currentMonthKey();
  const acomp = getAcompData();
  const acompLead = (acomp[mk] || []).find(e => e.id === id);
  if (acompLead) return acompLead;

  for (const fila of Object.values(filaDisparo || {})) {
    const f = (fila || []).find(e => e.id === id);
    if (f) return f;
  }
  return null;
}

function normalizeLeadForDrawer(lead = {}) {
  return {
    id: lead.id,
    nome: lead.nome || lead.companyName || lead.title || 'Lead sem nome',
    categoria: lead.categoria || lead.categoryName || lead.ramo || lead.segmento || '',
    cidade: lead.cidade || lead.city || lead.address?.city || '',
    estado: lead.estado || lead.state || lead.address?.state || '',
    whatsapp: lead.whatsapp || lead.phone || lead.telefone || '',
    instagram: lead.instagram || lead.instagramUrl || '',
    site: lead.site || lead.website || '',
    googleUrl: lead.googleUrl || lead.mapsUrl || lead.url || '',
    status: lead.status || 'Não enviada',
    criadoEm: lead.criadoEm || lead.importadoEm || '',
  };
}

function leadDrawerLink(label, value, href, missingText = 'não informado') {
  if (!value) return `<div class="lead-channel missing"><strong>${label}</strong><span>${missingText}</span></div>`;
  return `<a class="lead-channel" href="${escHtml(href || value)}" target="_blank" rel="noopener"><strong>${label}</strong><span>${escHtml(value)}</span></a>`;
}

function renderLeadDrawer() {
  if (!activeLeadDrawerData) return;
  const lead = activeLeadDrawerData;
  const crm = ensureLeadCrm(lead.id, lead);

  const nameEl = document.getElementById('leadDrawerName');
  const metaEl = document.getElementById('leadDrawerMeta');
  const channelsEl = document.getElementById('leadDrawerChannels');
  const pipelineEl = document.getElementById('leadDrawerPipeline');
  const notesEl = document.getElementById('leadNotesList');
  const historyEl = document.getElementById('leadHistoryList');
  const followUpInput = document.getElementById('leadFollowUpDate');
  const followUpStatus = document.getElementById('leadFollowUpStatus');
  if (!nameEl || !metaEl || !channelsEl || !pipelineEl || !notesEl || !historyEl) return;

  const local = [lead.cidade, lead.estado].filter(Boolean).join(' - ');
  nameEl.textContent = lead.nome;
  metaEl.textContent = [lead.categoria, local, `Status: ${lead.status}`].filter(Boolean).join(' · ') || 'sem detalhes adicionais';

  const wa = String(lead.whatsapp || '').replace(/\D/g, '');
  channelsEl.innerHTML = [
    leadDrawerLink('WhatsApp', wa ? `+${wa}` : '', wa ? `https://wa.me/${wa}` : ''),
    leadDrawerLink('Instagram', lead.instagram, lead.instagram),
    leadDrawerLink('Site', lead.site, lead.site),
    leadDrawerLink('Maps', lead.googleUrl, lead.googleUrl),
  ].join('');

  pipelineEl.innerHTML = PIPELINE_STEPS.map(step => `
    <button class="lead-pipeline-step ${crm.pipelineStatus === step.id ? 'active' : ''}" onclick="updateLeadPipeline('${step.id}')">
      ${escHtml(step.label)}
    </button>
  `).join('');

  if (followUpInput) followUpInput.value = crm.followUpDate || '';
  if (followUpStatus) {
    const info = getFollowUpInfo(crm.followUpDate || '');
    followUpStatus.className = `lead-followup-status ${info.className}`;
    followUpStatus.textContent = info.label;
  }

  notesEl.innerHTML = crm.notes.length
    ? crm.notes.slice().reverse().map(note => `
      <div class="lead-note">
        <div class="lead-note-date">${escHtml(note.at)}</div>
        <div class="lead-note-text">${escHtml(note.text)}</div>
      </div>
    `).join('')
    : '<div class="lead-note"><div class="lead-note-text" style="color:var(--muted)">// nenhuma nota ainda</div></div>';

  renderLeadTimeline(activeLeadDrawerId);

  renderLeadPresentations();

  historyEl.innerHTML = crm.history.length
    ? crm.history.slice().reverse().map(item => `
      <div class="lead-history-item">
        <div class="lead-history-date">${escHtml(item.at)}</div>
        <div class="lead-history-text">${escHtml(item.text)}</div>
      </div>
    `).join('')
    : '<div class="lead-history-item"><div class="lead-history-text" style="color:var(--muted)">// sem histórico</div></div>';
}

function openLeadDrawer(id) {
  const raw = findLeadEverywhere(id);
  if (!raw) {
    notify('Lead não encontrado para abrir a ficha.', 'warn');
    return;
  }
  activeLeadDrawerId = id;
  activeLeadDrawerData = normalizeLeadForDrawer(raw);
  ensureLeadCrm(id, activeLeadDrawerData);
  renderLeadDrawer();
  renderLeadWhatsappValidation();
  renderLeadMessageBox();
  const overlay = document.getElementById('leadDrawerOverlay');
  const drawer = document.getElementById('leadDrawer');
  if (overlay) overlay.classList.add('open');
  if (drawer) drawer.setAttribute('aria-hidden', 'false');
  renderLeadPresentations();
}

function closeLeadDrawer() {
  const overlay = document.getElementById('leadDrawerOverlay');
  const drawer = document.getElementById('leadDrawer');
  if (overlay) overlay.classList.remove('open');
  if (drawer) drawer.setAttribute('aria-hidden', 'true');
}

function addLeadNote() {
  if (!activeLeadDrawerId) return;
  const input = document.getElementById('leadNoteInput');
  const text = (input?.value || '').trim();
  if (!text) { notify('Escreva uma nota antes de adicionar.', 'warn'); return; }
  const crm = ensureLeadCrm(activeLeadDrawerId, activeLeadDrawerData || {});
  crm.notes.push({ at: crmNowLabel(), text });
  saveLeadCrm(activeLeadDrawerId, crm);

  syncLeadNoteToCloud(activeLeadDrawerId, text, activeLeadDrawerData || {});
  addLeadHistory(activeLeadDrawerId, 'Nota adicionada', activeLeadDrawerData || {});
  if (input) input.value = '';
  renderLeadDrawer();
  notify('Nota adicionada ao lead.');
}

function updateLeadPipeline(status) {
  if (!activeLeadDrawerId) return;
  const step = PIPELINE_STEPS.find(s => s.id === status);
  if (!step) return;
  const crm = ensureLeadCrm(activeLeadDrawerId, activeLeadDrawerData || {});
  const old = PIPELINE_STEPS.find(s => s.id === crm.pipelineStatus)?.label || 'Sem status';
  crm.pipelineStatus = status;
  saveLeadCrm(activeLeadDrawerId, crm);

  syncLeadToCloud(activeLeadDrawerId, activeLeadDrawerData || {});
  addLeadHistory(activeLeadDrawerId, `Pipeline alterado: ${old} → ${step.label}`, activeLeadDrawerData || {});
  renderLeadDrawer();
  notify(`Pipeline: ${step.label}`);
}

function saveLeadFollowUp() {
  if (!activeLeadDrawerId) return;
  const input = document.getElementById('leadFollowUpDate');
  const dateIso = (input?.value || '').trim();
  if (!dateIso) {
    notify('Selecione uma data para o follow-up.', 'warn');
    return;
  }

  const crm = ensureLeadCrm(activeLeadDrawerId, activeLeadDrawerData || {});
  const oldDate = crm.followUpDate || '';
  crm.followUpDate = dateIso;
  saveLeadCrm(activeLeadDrawerId, crm);

  const message = oldDate
    ? `Follow-up reagendado: ${formatIsoDateBR(oldDate)} → ${formatIsoDateBR(dateIso)}`
    : `Follow-up agendado para ${formatIsoDateBR(dateIso)}`;

  syncLeadFollowUpToCloud(activeLeadDrawerId, dateIso, activeLeadDrawerData || {});
  addLeadHistory(activeLeadDrawerId, message, activeLeadDrawerData || {});
  renderLeadDrawer();
  renderFollowUpsHome();
  if (acompTab === 'lista') renderAcompLista();
  notify('Follow-up salvo.');
}

function clearLeadFollowUp() {
  if (!activeLeadDrawerId) return;
  const crm = ensureLeadCrm(activeLeadDrawerId, activeLeadDrawerData || {});
  if (!crm.followUpDate) {
    notify('Este lead não possui follow-up agendado.', 'warn');
    return;
  }

  const oldDate = crm.followUpDate;
  crm.followUpDate = '';
  saveLeadCrm(activeLeadDrawerId, crm);
  clearLeadFollowUpFromCloud(activeLeadDrawerId, activeLeadDrawerData || {});
  addLeadHistory(activeLeadDrawerId, `Follow-up removido: ${formatIsoDateBR(oldDate)}`, activeLeadDrawerData || {});
  renderLeadDrawer();
  renderFollowUpsHome();
  if (acompTab === 'lista') renderAcompLista();
  notify('Follow-up removido.');
}


function createDevTestLead() {
  const data = ensureWeekData();
  const day = selectedDay || todayStr();
  if (!data.days[day]) data.days[day] = [];

  const id = 'dev_test_' + Date.now();
  const lead = {
    id,
    nome: 'Lead Teste DEV',
    site: 'https://exemplo.com.br',
    whatsapp: '5511999999999',
    instagram: 'https://instagram.com/leadteste',
    googleUrl: 'https://maps.google.com',
    categoria: 'Teste / Validação',
    status: 'Não enviada',
    criadoEm: todayStr(),
    ramoId: null
  };

  data.days[day].push(lead);
  saveWeekData(data);
  ensureLeadCrm(id, lead);
  addLeadHistory(id, 'Lead teste criado no ambiente DEV', lead);
  syncLeadToCloud(id, lead);

  selectedDay = day;
  selectedStatus = 'Não enviada';
  renderInicio();
  renderFollowUpsHome();
  updateBadges();
  notify('Lead teste criado. Abra a ficha na lista.');

  syncAllLocalLeadsToSupabase();}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeLeadDrawer();
});


/* ════════════════════════════
   GLOBAL SEARCH
════════════════════════════ */
function getAllSearchableLeads() {
  const byId = new Map();

  const add = (lead, source) => {
    if (!lead || !lead.id || byId.has(lead.id)) return;
    byId.set(lead.id, { ...normalizeLeadForDrawer(lead), source });
  };

  try {
    const data = ensureWeekData();
    Object.values(data.days || {}).flat().forEach(lead => add(lead, 'Semana'));
  } catch {}

  try { getAtribuicaoData().forEach(lead => add(lead, 'Atribuição')); } catch {}
  try { getValData().forEach(lead => add(lead, 'Validação')); } catch {}
  try { getInstaFila().forEach(lead => add(lead, 'Instagram')); } catch {}
  try { getZapBacklog().forEach(lead => add(lead, 'Fila WhatsApp')); } catch {}

  try {
    const acomp = getAcompData();
    Object.values(acomp || {}).flat().forEach(lead => add(lead, 'Acompanhamento'));
  } catch {}

  try {
    Object.values(filaDisparo || {}).flat().forEach(lead => add(lead, 'Fila WhatsApp'));
  } catch {}

  return [...byId.values()];
}

function openGlobalSearch() {
  const overlay = document.getElementById('globalSearchOverlay');
  const input = document.getElementById('globalSearchInput');
  if (!overlay || !input) return;
  overlay.classList.add('open');
  input.value = '';
  renderGlobalSearchResults();
  setTimeout(() => input.focus(), 50);
}

function closeGlobalSearch(event) {
  if (event && event.target && event.target.id !== 'globalSearchOverlay') return;
  const overlay = document.getElementById('globalSearchOverlay');
  if (overlay) overlay.classList.remove('open');
}

function renderGlobalSearchResults() {
  const input = document.getElementById('globalSearchInput');
  const box = document.getElementById('globalSearchResults');
  if (!input || !box) return;

  const q = normalizeStr(input.value || '');
  if (!q) {
    box.innerHTML = '<div class="global-search-empty">// comece a digitar para pesquisar</div>';
    return;
  }

  const leads = getAllSearchableLeads();
  const results = leads.filter(lead => {
    const haystack = normalizeStr([
      lead.nome,
      lead.categoria,
      lead.cidade,
      lead.estado,
      lead.whatsapp,
      lead.instagram,
      lead.site,
      lead.googleUrl,
      lead.status,
      lead.source
    ].filter(Boolean).join(' '));
    return haystack.includes(q);
  }).slice(0, 30);

  if (!results.length) {
    box.innerHTML = `<div class="global-search-empty">// nenhum resultado para "${escHtml(input.value)}"</div>`;
    return;
  }

  box.innerHTML = results.map(lead => `
    <button class="global-search-result" onclick="openLeadFromGlobalSearch('${escHtml(lead.id)}')">
      <div class="global-search-result-main">
        <div class="global-search-result-name">${escHtml(lead.nome)}</div>
        <div class="global-search-result-meta">
          ${lead.whatsapp ? `<span>📱 ${escHtml(lead.whatsapp)}</span>` : ''}
          ${lead.instagram ? `<span>📸 ${escHtml(lead.instagram)}</span>` : ''}
          ${lead.site ? `<span>🌐 ${escHtml(lead.site)}</span>` : ''}
          ${lead.source ? `<span>${escHtml(lead.source)}</span>` : ''}
        </div>
      </div>
      <span class="global-search-result-status">${escHtml(lead.status || 'sem status')}</span>
    </button>
  `).join('');
}

function openLeadFromGlobalSearch(id) {
  closeGlobalSearch();
  openLeadDrawer(id);
}

document.addEventListener('keydown', (event) => {
  const isMac = navigator.platform.toUpperCase().includes('MAC');
  const cmdK = (isMac ? event.metaKey : event.ctrlKey) && event.key.toLowerCase() === 'k';

  if (cmdK) {
    event.preventDefault();
    openGlobalSearch();
    return;
  }

  if (event.key === 'Escape') {
    const searchOverlay = document.getElementById('globalSearchOverlay');
    if (searchOverlay?.classList.contains('open')) {
      closeGlobalSearch();
    }
  }
});


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


/* ════════════════════════════
   SUPABASE PRIMARY V15
════════════════════════════ */
const SYNC_STATE_KEY = 'vs_supabase_sync_state_v1';

function getSyncState() {
  try {
    return JSON.parse(localStorage.getItem(SYNC_STATE_KEY) || '{}');
  } catch {
    return {};
  }
}

function setSyncState(data = {}) {
  const prev = getSyncState();
  localStorage.setItem(SYNC_STATE_KEY, JSON.stringify({
    ...prev,
    ...data,
    updatedAt: new Date().toISOString()
  }));
  renderSyncStatus();
}

function isSupabaseReady() {
  return !!(sbClient && currentUser);
}

function renderSyncStatus() {
  const box = document.getElementById('authSyncStatus');
  if (!box) return;

  if (!currentUser) {
    box.className = 'sync-status warn';
    box.textContent = 'offline';
    return;
  }

  const state = getSyncState();
  const label = state.lastLoadedAt
    ? 'sincronizado'
    : 'conectado';

  box.className = 'sync-status ok';
  box.textContent = label;
}

async function upsertLeadToSupabase(lead = {}) {
  if (!isSupabaseReady() || !lead.id) return { skipped: true };

  const payload = {
    id: lead.id,
    user_id: currentUser.id,
    company_name: lead.nome || lead.companyName || lead.title || 'Lead sem nome',
    phone: lead.whatsapp || lead.phone || lead.telefone || '',
    instagram: lead.instagram || lead.instagramUrl || '',
    website: lead.site || lead.website || '',
    maps_url: lead.googleUrl || lead.mapsUrl || lead.url || '',
    status: lead.status || 'Não enviada',
    pipeline_status: lead.pipelineStatus || 'contato_enviado',
    updated_at: new Date().toISOString()
  };

  const { error } = await sbClient.from('leads').upsert(payload);
  if (error) {
    console.warn('[supabase] upsert lead:', error.message);
    setSyncState({ lastError: error.message });
    return { error };
  }

  return { ok: true };
}

async function syncAllLocalLeadsToSupabase() {
  if (!isSupabaseReady()) return;

  const data = ensureWeekData();
  const weekLeads = Object.values(data.days || {}).flat();

  const extras = [];
  try { extras.push(...getAtribuicaoData()); } catch {}
  try { extras.push(...getValData()); } catch {}
  try { extras.push(...getInstaFila()); } catch {}
  try { extras.push(...getZapBacklog()); } catch {}

  const all = [...weekLeads, ...extras];
  const unique = new Map();
  all.forEach(lead => {
    if (lead?.id) unique.set(lead.id, lead);
  });

  let ok = 0;
  for (const lead of unique.values()) {
    const result = await upsertLeadToSupabase(lead);
    if (result?.ok) ok++;
  }

  setSyncState({
    lastPushedAt: new Date().toISOString(),
    lastPushedCount: ok
  });

  console.log(`[supabase] Leads locais enviados: ${ok}`);
}

async function loadSupabaseAsPrimarySource() {
  if (!isSupabaseReady()) return;

  await loadSupabaseLeadsToLocalState();

  if (typeof loadSupabaseLeadCrmToLocalState === 'function') {
    await loadSupabaseLeadCrmToLocalState();
  }

  setSyncState({
    lastLoadedAt: new Date().toISOString()
  });

  renderSyncStatus();
}



/* ════════════════════════════
   LEAD PRESENTATIONS V16.1 VISIBILITY FIX
════════════════════════════ */
function ensureLeadPresentationsContainer() {
  if (document.getElementById('leadPresentationsList')) return true;

  const drawer = document.getElementById('leadDrawer');
  if (!drawer) return false;

  const target =
    document.getElementById('leadTimelineList') ||
    document.getElementById('leadNotesList') ||
    document.getElementById('leadHistoryList');

  const block = document.createElement('div');
  block.className = 'lead-presentations-block';
  block.innerHTML = `
    <div class="lead-presentation-title-label">Apresentações</div>
    <div class="lead-presentation-form">
      <input id="leadPresentationTitle" type="text" placeholder="Nome da apresentação. Ex: Site Institucional V1">
      <div class="lead-presentation-row">
        <input id="leadPresentationDeskUrl" type="url" placeholder="URL desktop">
        <input id="leadPresentationMobUrl" type="url" placeholder="URL mobile">
      </div>
      <button class="btn btn-primary" onclick="addLeadPresentation()">+ Vincular apresentação</button>
    </div>
    <div id="leadPresentationsList" class="lead-presentations-list"></div>
  `;

  if (target && target.parentElement) {
    target.parentElement.insertAdjacentElement('beforebegin', block);
  } else {
    drawer.appendChild(block);
  }

  return true;
}

/* ════════════════════════════
   LEAD PRESENTATIONS V16
════════════════════════════ */
function ensureLeadPresentations(id) {
  const crm = ensureLeadCrm(id, activeLeadDrawerData || {});
  crm.presentations = Array.isArray(crm.presentations) ? crm.presentations : [];
  saveLeadCrm(id, crm);
  return crm.presentations;
}

function presentationPublicUrl(presentation) {
  if (presentation.shortUrl) return presentation.shortUrl;
  if (presentation.alias) return `${window.location.origin}/r.html?a=${encodeURIComponent(presentation.alias)}`;
  return presentation.deskUrl || presentation.mobUrl || '';
}

function renderLeadPresentations() {
  ensureLeadPresentationsContainer();
  const list = document.getElementById('leadPresentationsList');
  if (!list || !activeLeadDrawerId) return;

  const presentations = ensureLeadPresentations(activeLeadDrawerId);

  if (!presentations.length) {
    list.innerHTML = renderPresentationMetricsHeader() + '<div class="lead-presentation-empty">// nenhuma apresentação vinculada a este lead</div>';
    return;
  }

  list.innerHTML = renderPresentationMetricsHeader() + presentations.slice().reverse().map(p => {
    const url = presentationPublicUrl(p);
    return `
      <div class="lead-presentation-item">
        <div class="lead-presentation-title">${escHtml(p.title || 'Apresentação')}</div>
        <div class="lead-presentation-meta">
          <span>${escHtml(p.createdAtLabel || p.createdAt || '')}</span>
          ${p.alias ? `<span>alias: ${escHtml(p.alias)}</span>` : ''}
          ${p.views ? `<span>${p.views} visualizações</span>` : '<span>0 visualizações</span>'}${p.lastViewedAtLabel ? `<span>último acesso: ${escHtml(p.lastViewedAtLabel)}</span>` : ''}
        </div>
        ${url ? `<div class="lead-presentation-link">${escHtml(url)}</div>` : ''}
        <div class="lead-presentation-actions">
          ${url ? `<a class="btn btn-ghost" style="font-size:10px;padding:7px 12px;text-decoration:none" href="${escHtml(url)}" target="_blank" rel="noopener">Abrir</a>` : ''}
          ${url ? `<button class="btn btn-ghost" style="font-size:10px;padding:7px 12px" onclick="copyLeadPresentationUrl('${escHtml(url)}')">Copiar link</button>` : ''}
          <button class="btn btn-ghost" style="font-size:10px;padding:7px 12px" onclick="markLeadPresentationViewed(\'${escHtml(p.id)}\')">Registrar visualização</button>\n          <button class="btn btn-danger" style="font-size:10px;padding:7px 12px" onclick="removeLeadPresentation('${escHtml(p.id)}')">Remover</button>
        </div>
      </div>
    `;
  }).join('');
}

async function addLeadPresentation() {
  if (!activeLeadDrawerId) return;

  const titleEl = document.getElementById('leadPresentationTitle');
  const deskEl = document.getElementById('leadPresentationDeskUrl');
  const mobEl = document.getElementById('leadPresentationMobUrl');

  const title = (titleEl?.value || '').trim();
  const deskUrl = (deskEl?.value || '').trim();
  const mobUrl = (mobEl?.value || '').trim();

  if (!title) {
    notify('Informe um nome para a apresentação.', 'warn');
    return;
  }

  if (!deskUrl && !mobUrl) {
    notify('Informe pelo menos uma URL da apresentação.', 'warn');
    return;
  }

  const crm = ensureLeadCrm(activeLeadDrawerId, activeLeadDrawerData || {});
  crm.presentations = Array.isArray(crm.presentations) ? crm.presentations : [];

  const leadName = activeLeadDrawerData?.nome || title;
  const safeName = normalizeStr(`${leadName} ${title}`).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
  const alias = `${safeName || 'apresentacao'}-${Date.now().toString(36)}`;

  const presentation = {
    id: genId(),
    title,
    deskUrl,
    mobUrl,
    alias,
    views: 0,
    createdAt: new Date().toISOString(),
    createdAtLabel: crmNowLabel()
  };

  crm.presentations.push(presentation);
  saveLeadCrm(activeLeadDrawerId, crm);

  addLeadHistory(activeLeadDrawerId, `Apresentação vinculada: ${title}`, activeLeadDrawerData || {});

  // Tenta aproveitar API existente de encurtamento/redirect sem quebrar se não existir.
  try {
    const res = await fetch('/api/shorten', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companyName: alias,
        deskUrl: deskUrl || mobUrl,
        mobUrl: mobUrl || deskUrl
      })
    });

    if (res.ok) {
      const data = await res.json();
      const store = getLeadCrmStore();
      const current = store[activeLeadDrawerId];
      const found = current?.presentations?.find(p => p.id === presentation.id);
      if (found) {
        found.shortUrl = data.shortUrl || data.url || data.tinyUrl || found.shortUrl;
        found.redirectUrl = data.redirectUrl || found.redirectUrl;
      }
      saveLeadCrmStore(store);
    }
  } catch (err) {
    console.warn('[presentations] api shorten indisponível:', err?.message || err);
  }

  if (titleEl) titleEl.value = '';
  if (deskEl) deskEl.value = '';
  if (mobEl) mobEl.value = '';

  renderLeadPresentations();
  if (typeof renderLeadTimeline === 'function') renderLeadTimeline(activeLeadDrawerId);
  notify('Apresentação vinculada ao lead.');
}

function removeLeadPresentation(id) {
  if (!activeLeadDrawerId) return;
  const crm = ensureLeadCrm(activeLeadDrawerId, activeLeadDrawerData || {});
  const item = (crm.presentations || []).find(p => p.id === id);
  crm.presentations = (crm.presentations || []).filter(p => p.id !== id);
  saveLeadCrm(activeLeadDrawerId, crm);
  addLeadHistory(activeLeadDrawerId, `Apresentação removida${item?.title ? ': ' + item.title : ''}`, activeLeadDrawerData || {});
  renderLeadPresentations();
  if (typeof renderLeadTimeline === 'function') renderLeadTimeline(activeLeadDrawerId);
  notify('Apresentação removida.');
}

function copyLeadPresentationUrl(url) {
  navigator.clipboard?.writeText(url);
  notify('Link copiado.');
}


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


/* ════════════════════════════
   EVOLUTION API V24
════════════════════════════ */
const EVOLUTION_SETTINGS_KEY = 'vs_evolution_settings_v1';

function getEvolutionSettings() {
  try {
    return JSON.parse(localStorage.getItem(EVOLUTION_SETTINGS_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveEvolutionSettings() {
  const settings = {
    url: (document.getElementById('evoUrl')?.value || '').trim().replace(/\/$/, ''),
    instance: (document.getElementById('evoInstance')?.value || '').trim(),
    apiKey: (document.getElementById('evoApiKey')?.value || '').trim()
  };

  localStorage.setItem(EVOLUTION_SETTINGS_KEY, JSON.stringify(settings));
  renderEvolutionSettings();
  notify('Configuração da Evolution salva.');
}

function renderEvolutionSettings() {
  const settings = getEvolutionSettings();

  const url = document.getElementById('evoUrl');
  const instance = document.getElementById('evoInstance');
  const key = document.getElementById('evoApiKey');

  if (url) url.value = settings.url || '';
  if (instance) instance.value = settings.instance || '';
  if (key) key.value = settings.apiKey || '';

  updateEvolutionStatusCard('warn', 'Não testado', settings.url ? '// configuração carregada' : '// salve os dados da Evolution');
}

function updateEvolutionStatusCard(type, title, text) {
  const card = document.getElementById('evoStatusCard');
  if (!card) return;

  card.classList.remove('ok','err','warn');
  if (type) card.classList.add(type);

  card.innerHTML = `
    <div class="evo-status-icon">${type === 'ok' ? '✅' : type === 'err' ? '⚠️' : '⚡'}</div>
    <div>
      <div class="evo-status-title">${escHtml(title || 'Status')}</div>
      <div class="evo-status-text">${escHtml(text || '')}</div>
    </div>
  `;
}

function getEvolutionHeaders(settings) {
  const headers = { 'Content-Type': 'application/json' };
  if (settings.apiKey) headers.apikey = settings.apiKey;
  return headers;
}

async function testEvolutionConnection() {
  const settings = getEvolutionConfigForChipV405 ? getEvolutionConfigForChipV405() : getEvolutionSettings();

  if (!settings.url || !settings.instance || !settings.apiKey) {
    updateEvolutionStatusCard('err', 'Configuração incompleta', 'Preencha URL, instância e API Key.');
    notify('Preencha URL, instância e API Key.', 'warn');
    return;
  }

  updateEvolutionStatusCard('warn', 'Testando...', 'Consultando status da instância.');

  try {
    const endpoint = `${settings.url}/instance/connectionState/${encodeURIComponent(settings.instance)}`;
    const res = await fetch(endpoint, {
      method: 'GET',
      headers: (typeof getEvolutionHeadersV405 === 'function' ? getEvolutionHeadersV405(settings) : getEvolutionHeaders(settings))
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      updateEvolutionStatusCard('err', 'Falha na conexão', data?.message || `HTTP ${res.status}`);
      return;
    }

    const state = data?.instance?.state || data?.state || data?.status || 'conectado';
    updateEvolutionStatusCard('ok', 'Evolution respondendo', `Status: ${state}`);
    notify('Evolution conectada.');
  } catch (err) {
    updateEvolutionStatusCard('err', 'Erro ao conectar', err?.message || 'Falha desconhecida.');
  }
}

async function validateEvolutionNumber() {
  const settings = getEvolutionConfigForChipV405 ? getEvolutionConfigForChipV405() : getEvolutionSettings();
  const result = document.getElementById('evoTestResult');
  const number = (document.getElementById('evoNumberTest')?.value || '').replace(/\D/g,'');

  if (!settings.url || !settings.instance || !settings.apiKey) {
    if (result) result.textContent = 'Configure a Evolution primeiro.';
    return;
  }

  if (!number || number.length < 10) {
    if (result) result.textContent = 'Informe um número com DDI + DDD.';
    return;
  }

  if (result) result.textContent = 'Validando número...';

  try {
    const endpoint = `${settings.url}/chat/whatsappNumbers/${encodeURIComponent(settings.instance)}`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: (typeof getEvolutionHeadersV405 === 'function' ? getEvolutionHeadersV405(settings) : getEvolutionHeaders(settings)),
      body: JSON.stringify({ numbers: [number] })
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      if (result) result.textContent = `Erro: ${data?.message || 'falha na validação'}`;
      return;
    }

    const item = Array.isArray(data) ? data[0] : (data?.data?.[0] || data?.result?.[0] || data);
    const exists = item?.exists ?? item?.isWhatsapp ?? item?.jid ?? item?.numberExists;

    if (result) {
      result.textContent = exists
        ? `✅ Número válido no WhatsApp: ${number}`
        : `⚠️ Número não confirmado: ${number}`;
    }
  } catch (err) {
    if (result) result.textContent = `Erro: ${err?.message || 'falha desconhecida'}`;
  }
}

function renderEvolutionPanel() {
  renderEvolutionSettings();
}


/* ════════════════════════════
   EVOLUTION LEAD V25
════════════════════════════ */
function normalizePhoneForEvolution(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function getLeadWhatsappStatus(leadId) {
  const crm = ensureLeadCrm(leadId, {});
  return crm.whatsappValidation || {
    status: 'pending',
    label: 'Não validado',
    checkedAt: '',
    checkedAtLabel: '',
    number: ''
  };
}

function setLeadWhatsappStatus(leadId, data = {}) {
  const crm = ensureLeadCrm(leadId, activeLeadDrawerData || {});
  crm.whatsappValidation = {
    ...(crm.whatsappValidation || {}),
    ...data,
    checkedAt: new Date().toISOString(),
    checkedAtLabel: crmNowLabel()
  };
  saveLeadCrm(leadId, crm);
}


function ensureLeadWhatsappValidationContainer() {
  if (document.getElementById('leadWhatsappValidationBox')) return true;

  const drawer = document.getElementById('leadDrawer');
  if (!drawer) return false;

  const target =
    document.getElementById('leadPresentationsList') ||
    document.getElementById('leadTimelineList') ||
    document.getElementById('leadNotesList') ||
    document.getElementById('leadHistoryList');

  const block = document.createElement('div');
  block.id = 'leadWhatsappValidationBox';

  if (target && target.parentElement) {
    target.parentElement.insertAdjacentElement('beforebegin', block);
  } else {
    drawer.appendChild(block);
  }

  return true;
}

function renderLeadWhatsappValidation() {
  ensureLeadWhatsappValidationContainer();
  const box = document.getElementById('leadWhatsappValidationBox');
  if (!box || !activeLeadDrawerId) return;

  const lead = activeLeadDrawerData || {};
  const phone = normalizePhoneForEvolution(lead.whatsapp || lead.phone || lead.telefone || '');
  const status = getLeadWhatsappStatus(activeLeadDrawerId);

  const statusClass = status.status === 'valid' ? 'valid' : status.status === 'invalid' ? 'invalid' : 'pending';
  const label = status.label || (status.status === 'valid' ? 'WhatsApp válido' : status.status === 'invalid' ? 'Número inválido' : 'Não validado');

  box.innerHTML = `
    <div class="lead-wa-block">
      <div class="lead-wa-top">
        <div class="lead-wa-title">WhatsApp</div>
        <span class="lead-wa-status ${statusClass}">${escHtml(label)}</span>
      </div>
      <div class="lead-wa-meta">
        Número: ${escHtml(phone || 'sem telefone')}<br>
        Última validação: ${escHtml(status.checkedAtLabel || 'nunca')}
      </div>
      <div class="lead-wa-actions">
        <button class="btn btn-primary" style="font-size:10px;padding:7px 12px" onclick="validateActiveLeadWhatsapp()">Validar WhatsApp</button>
        ${phone ? `<a class="btn btn-ghost" style="font-size:10px;padding:7px 12px;text-decoration:none" target="_blank" rel="noopener" href="https://wa.me/${escHtml(phone)}">Abrir conversa</a>` : ''}
      </div>
    </div>
  `;
}

async function validateActiveLeadWhatsapp() {
  if (!activeLeadDrawerId || !activeLeadDrawerData) return;

  const settings = getEvolutionConfigForChipV405 ? getEvolutionConfigForChipV405() : (getEvolutionSettings ? getEvolutionSettings() : {});
  const phone = normalizePhoneForEvolution(activeLeadDrawerData.whatsapp || activeLeadDrawerData.phone || activeLeadDrawerData.telefone || '');

  if (!phone || phone.length < 10) {
    setLeadWhatsappStatus(activeLeadDrawerId, {
      status: 'invalid',
      label: 'Telefone ausente/inválido',
      number: phone
    });
    addLeadHistory(activeLeadDrawerId, 'WhatsApp: telefone ausente ou inválido', activeLeadDrawerData);
    renderLeadWhatsappValidation();
    if (typeof renderLeadTimeline === 'function') renderLeadTimeline(activeLeadDrawerId);
    notify('Telefone inválido.', 'warn');
    return;
  }

  if (!settings.url || !settings.instance || !settings.apiKey) {
    notify('Configure a Evolution API antes de validar.', 'warn');
    return;
  }

  setLeadWhatsappStatus(activeLeadDrawerId, {
    status: 'pending',
    label: 'Validando...',
    number: phone
  });
  renderLeadWhatsappValidation();

  try {
    const endpoint = `${settings.url}/chat/whatsappNumbers/${encodeURIComponent(settings.instance)}`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: (typeof getEvolutionHeadersV405 === 'function' ? getEvolutionHeadersV405(settings) : getEvolutionHeaders(settings)),
      body: JSON.stringify({ numbers: [phone] })
    });

    const data = await res.json().catch(() => ({}));
    const item = Array.isArray(data) ? data[0] : (data?.data?.[0] || data?.result?.[0] || data);
    const exists = !!(item?.exists ?? item?.isWhatsapp ?? item?.jid ?? item?.numberExists);

    if (!res.ok) {
      setLeadWhatsappStatus(activeLeadDrawerId, {
        status: 'invalid',
        label: 'Erro na validação',
        number: phone,
        raw: data
      });
      addLeadHistory(activeLeadDrawerId, `WhatsApp: erro na validação (${res.status})`, activeLeadDrawerData);
      notify('Erro ao validar WhatsApp.', 'err');
    } else if (exists) {
      setLeadWhatsappStatus(activeLeadDrawerId, {
        status: 'valid',
        label: 'WhatsApp válido',
        number: phone,
        raw: item
      });
      addLeadHistory(activeLeadDrawerId, `WhatsApp validado: ${phone}`, activeLeadDrawerData);
      notify('WhatsApp válido.');
    } else {
      setLeadWhatsappStatus(activeLeadDrawerId, {
        status: 'invalid',
        label: 'WhatsApp não confirmado',
        number: phone,
        raw: item
      });
      addLeadHistory(activeLeadDrawerId, `WhatsApp não confirmado: ${phone}`, activeLeadDrawerData);
      notify('WhatsApp não confirmado.', 'warn');
    }
  } catch (err) {
    setLeadWhatsappStatus(activeLeadDrawerId, {
      status: 'invalid',
      label: 'Falha na conexão',
      number: phone,
      error: err?.message || 'erro desconhecido'
    });
    addLeadHistory(activeLeadDrawerId, `WhatsApp: falha na conexão (${err?.message || 'erro'})`, activeLeadDrawerData);
    notify('Falha ao conectar na Evolution.', 'err');
  }

  renderLeadWhatsappValidation();
  if (typeof renderLeadTimeline === 'function') renderLeadTimeline(activeLeadDrawerId);
  if (typeof renderKanban === 'function') renderKanban();
}

function getWhatsappMiniBadge(leadId) {
  const status = getLeadWhatsappStatus(leadId);
  const cls = status.status === 'valid' ? 'valid' : status.status === 'invalid' ? 'invalid' : 'pending';
  const label = status.status === 'valid' ? 'WA válido' : status.status === 'invalid' ? 'WA inválido' : 'WA pendente';
  return `<span class="wa-mini-badge ${cls}">${label}</span>`;
}


/* ════════════════════════════
   EVOLUTION SEND V26
════════════════════════════ */
function buildLeadMessageTemplate(type = 'primeiro_contato') {
  const lead = activeLeadDrawerData || {};
  const nome = lead.nome || lead.companyName || 'tudo bem';

  const templates = {
    primeiro_contato:
`Olá, tudo bem?

Vi a empresa ${nome} e acredito que posso te ajudar com uma presença digital mais profissional.

Posso te enviar uma apresentação rápida?`,

    followup:
`Olá, tudo bem?

Passando para retomar nosso contato sobre a apresentação que te enviei.

Conseguiu dar uma olhada?`,

    apresentacao:
`Olá, tudo bem?

Preparei uma apresentação rápida para mostrar uma possibilidade para a ${nome}.

Segue o link:
[COLE_O_LINK_AQUI]`
  };

  return templates[type] || templates.primeiro_contato;
}

function ensureLeadMessageContainer() {
  if (document.getElementById('leadMessageBox')) return true;

  const drawer = document.getElementById('leadDrawer');
  if (!drawer) return false;

  const target =
    document.getElementById('leadWhatsappValidationBox') ||
    document.getElementById('leadPresentationsList') ||
    document.getElementById('leadTimelineList') ||
    document.getElementById('leadNotesList');

  const block = document.createElement('div');
  block.id = 'leadMessageBox';

  if (target && target.parentElement) {
    target.parentElement.insertAdjacentElement('afterend', block);
  } else {
    drawer.appendChild(block);
  }

  return true;
}

function renderLeadMessageBox() {
  ensureLeadMessageContainer();

  const box = document.getElementById('leadMessageBox');
  if (!box || !activeLeadDrawerId) return;

  const lead = activeLeadDrawerData || {};
  const phone = normalizePhoneForEvolution(lead.whatsapp || lead.phone || lead.telefone || '');
  const waStatus = getLeadWhatsappStatus(activeLeadDrawerId);

  box.innerHTML = `
    <div class="lead-message-block">
      <div class="lead-message-title">Enviar mensagem</div>

      <div class="lead-message-template">
        <select id="leadMessageTemplate" onchange="applyLeadMessageTemplate()">
          <option value="primeiro_contato">Primeiro contato</option>
          <option value="followup">Follow-up</option>
          <option value="apresentacao">Apresentação</option>
        </select>
        <button class="btn btn-ghost" style="font-size:10px;padding:7px 12px" onclick="applyLeadMessageTemplate()">Usar modelo</button>
      </div>

      <textarea id="leadMessageText" placeholder="Digite a mensagem para enviar no WhatsApp...">${escHtml(buildLeadMessageTemplate('primeiro_contato'))}</textarea>

      <div class="lead-message-actions">
        <button class="btn btn-primary" style="font-size:10px;padding:7px 12px" onclick="sendActiveLeadWhatsappMessage()">Enviar pela Evolution</button>
        ${phone ? `<a class="btn btn-ghost" style="font-size:10px;padding:7px 12px;text-decoration:none" target="_blank" rel="noopener" href="https://wa.me/${escHtml(phone)}?text=${encodeURIComponent(buildLeadMessageTemplate('primeiro_contato'))}">Abrir no WhatsApp</a>` : ''}
      </div>

      <div class="lead-message-result" id="leadMessageResult">
        ${phone ? `Número: ${escHtml(phone)} · Status: ${escHtml(waStatus.label || 'Não validado')}` : 'Lead sem telefone.'}
      </div>
    </div>
  `;
}

function applyLeadMessageTemplate() {
  const select = document.getElementById('leadMessageTemplate');
  const text = document.getElementById('leadMessageText');
  if (!text) return;

  text.value = buildLeadMessageTemplate(select?.value || 'primeiro_contato');
}

async function sendActiveLeadWhatsappMessage() {
  if (!activeLeadDrawerId || !activeLeadDrawerData) return;

  const settings = getEvolutionSettings ? getEvolutionSettings() : {};
  const result = document.getElementById('leadMessageResult');
  const text = (document.getElementById('leadMessageText')?.value || '').trim();
  const phone = normalizePhoneForEvolution(activeLeadDrawerData.whatsapp || activeLeadDrawerData.phone || activeLeadDrawerData.telefone || '');

  if (!settings.url || !settings.instance || !settings.apiKey) {
    notify('Configure a Evolution API antes de enviar.', 'warn');
    if (result) result.textContent = 'Configuração da Evolution incompleta.';
    return;
  }

  if (!phone || phone.length < 10) {
    notify('Telefone inválido para envio.', 'warn');
    if (result) result.textContent = 'Telefone inválido.';
    return;
  }

  if (!text) {
    notify('Digite uma mensagem antes de enviar.', 'warn');
    if (result) result.textContent = 'Mensagem vazia.';
    return;
  }

  if (result) result.textContent = 'Enviando mensagem...';

  try {
    const endpoint = `${settings.url}/message/sendText/${encodeURIComponent(settings.instance)}`;

    const payload = {
      number: phone,
      text
    };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: (typeof getEvolutionHeadersV405 === 'function' ? getEvolutionHeadersV405(settings) : getEvolutionHeaders(settings)),
      body: JSON.stringify(payload)
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const msg = data?.message || data?.error || `HTTP ${res.status}`;
      addLeadHistory(activeLeadDrawerId, `WhatsApp: erro ao enviar mensagem (${msg})`, activeLeadDrawerData);
      if (result) result.textContent = `Erro ao enviar: ${msg}`;
      if (typeof renderLeadTimeline === 'function') renderLeadTimeline(activeLeadDrawerId);
      notify('Erro ao enviar mensagem.', 'err');
      return;
    }

    const crm = ensureLeadCrm(activeLeadDrawerId, activeLeadDrawerData || {});
    crm.lastWhatsappMessage = {
      text,
      phone,
      sentAt: new Date().toISOString(),
      sentAtLabel: crmNowLabel(),
      response: data
    };
    saveLeadCrm(activeLeadDrawerId, crm);

    addLeadHistory(activeLeadDrawerId, `Mensagem enviada via WhatsApp para ${phone}`, activeLeadDrawerData);

    if (result) result.textContent = `Mensagem enviada em ${crmNowLabel()}.`;
    if (typeof renderLeadTimeline === 'function') renderLeadTimeline(activeLeadDrawerId);

    notify('Mensagem enviada via Evolution.');
  } catch (err) {
    addLeadHistory(activeLeadDrawerId, `WhatsApp: falha ao enviar mensagem (${err?.message || 'erro'})`, activeLeadDrawerData);
    if (result) result.textContent = `Falha ao enviar: ${err?.message || 'erro desconhecido'}`;
    if (typeof renderLeadTimeline === 'function') renderLeadTimeline(activeLeadDrawerId);
    notify('Falha ao conectar na Evolution.', 'err');
  }
}


/* ════════════════════════════
   FILA WHATSAPP V27 REAL
════════════════════════════ */
const WHATSAPP_QUEUE_V27_KEY = 'vs_whatsapp_queue_v27';
const QUEUE_CAMPAIGNS_V27_KEY = 'vs_queue_campaigns_v27';
const QUEUE_TEMPLATES_V27_KEY = 'vs_queue_templates_v27';

function getQueueCampaigns() {
  try {
    const data = JSON.parse(localStorage.getItem(QUEUE_CAMPAIGNS_V27_KEY) || 'null');
    return Array.isArray(data) && data.length ? data : ['Campanha Principal'];
  } catch {
    return ['Campanha Principal'];
  }
}

function saveQueueCampaigns(list) {
  setTimeout(() => { try { scheduleOperationalSyncV36(); } catch(e){} }, 0);
  localStorage.setItem(QUEUE_CAMPAIGNS_V27_KEY, JSON.stringify(list || []));
}

function getQueueTemplates() {
  try {
    const data = JSON.parse(localStorage.getItem(QUEUE_TEMPLATES_V27_KEY) || 'null');
    return Array.isArray(data) && data.length ? data : [
      { id:'tpl_default_1', name:'Template A', text:'Olá, tudo bem? Posso te enviar uma apresentação rápida?' },
      { id:'tpl_default_2', name:'Template B', text:'Oi! Vi sua empresa e acredito que posso ajudar com presença digital.' }
    ];
  } catch {
    return [];
  }
}

function saveQueueTemplates(list) {
  setTimeout(() => { try { scheduleOperationalSyncV36(); } catch(e){} }, 0);
  localStorage.setItem(QUEUE_TEMPLATES_V27_KEY, JSON.stringify(list || []));
}

function getWhatsappQueueV27() {
  try {
    const data = JSON.parse(localStorage.getItem(WHATSAPP_QUEUE_V27_KEY) || '[]');
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function saveWhatsappQueueV27(list) {
  setTimeout(() => { try { scheduleOperationalSyncV36(); } catch(e){} }, 0);
  localStorage.setItem(WHATSAPP_QUEUE_V27_KEY, JSON.stringify(list || []));
  updateWhatsappQueueBadge();
  if (typeof updateAuditBadgeV35 === 'function') updateAuditBadgeV35();
}

function addQueueCampaign() {
  const input = document.getElementById('queueCampaignName');
  const name = (input?.value || '').trim();
  if (!name) return;

  const campaigns = getQueueCampaigns();
  if (!campaigns.includes(name)) campaigns.push(name);
  saveQueueCampaigns(campaigns);

  if (input) input.value = '';
  renderWhatsappQueuePanel();
  notify('Campanha adicionada.');
}

function removeQueueCampaign(name) {
  const campaigns = getQueueCampaigns().filter(item => item !== name);
  saveQueueCampaigns(campaigns.length ? campaigns : ['Campanha Principal']);
  renderWhatsappQueuePanel();
}

function addQueueTemplate() {
  const nameEl = document.getElementById('queueTemplateName');
  const textEl = document.getElementById('queueTemplateText');

  const name = (nameEl?.value || '').trim();
  const text = (textEl?.value || '').trim();

  if (!name || !text) {
    notify('Informe nome e texto do template.', 'warn');
    return;
  }

  const templates = getQueueTemplates();
  templates.push({
    id: 'tpl_' + Date.now(),
    name,
    text
  });

  saveQueueTemplates(templates);

  if (nameEl) nameEl.value = '';
  if (textEl) textEl.value = '';

  renderWhatsappQueuePanel();
  notify('Template adicionado.');
}

function removeQueueTemplate(id) {
  saveQueueTemplates(getQueueTemplates().filter(tpl => tpl.id !== id));
  renderWhatsappQueuePanel();
}

function renderQueueCampaigns() {
  const box = document.getElementById('queueCampaignList');
  if (!box) return;

  const campaigns = getQueueCampaigns();

  box.innerHTML = campaigns.map(name => `
    <div class="queue-v27-item">
      <div>
        <div class="queue-v27-item-title">${escHtml(name)}</div>
        <div class="queue-v27-item-text">// campanha disponível</div>
      </div>
      <button class="btn btn-danger" style="font-size:10px;padding:7px 12px" onclick="removeQueueCampaign('${escHtml(name)}')">Remover</button>
    </div>
  `).join('');
}

function renderQueueTemplates() {
  const box = document.getElementById('queueTemplateList');
  if (!box) return;

  const templates = getQueueTemplates();

  box.innerHTML = templates.map(tpl => `
    <div class="queue-v27-item">
      <div>
        <div class="queue-v27-item-title">${escHtml(tpl.name)}</div>
        <div class="queue-v27-item-text">${escHtml((tpl.text || '').slice(0, 120))}</div>
      </div>
      <button class="btn btn-danger" style="font-size:10px;padding:7px 12px" onclick="removeQueueTemplate('${escHtml(tpl.id)}')">Remover</button>
    </div>
  `).join('');
}

function addActiveLeadToWhatsappQueue() {
  if (!activeLeadDrawerId || !activeLeadDrawerData) return;

  const campaign = document.getElementById('leadQueueCampaign')?.value || 'Campanha Principal';
  const queue = getWhatsappQueueV27();

  const exists = queue.some(item => item.leadId === activeLeadDrawerId && !['Enviado','Erro'].includes(item.status));
  if (exists) {
    notify('Este lead já está na fila.', 'warn');
    return;
  }

  const phone = normalizePhoneForEvolution(activeLeadDrawerData.whatsapp || activeLeadDrawerData.phone || activeLeadDrawerData.telefone || '');

  const item = {
    id: 'queue_' + Date.now(),
    leadId: activeLeadDrawerId,
    nome: activeLeadDrawerData.nome || activeLeadDrawerData.companyName || 'Lead',
    telefone: phone,
    campaign,
    status: 'Pendente',
    templateId: '',
    templateName: '',
    createdAt: new Date().toISOString(),
    createdAtLabel: crmNowLabel()
  };

  queue.unshift(item);
  saveWhatsappQueueV27(queue);

  addLeadHistory(activeLeadDrawerId, `Adicionado à fila WhatsApp (${campaign})`, activeLeadDrawerData);
  renderLeadQueueBox();
  if (typeof renderLeadTimeline === 'function') renderLeadTimeline(activeLeadDrawerId);
  notify('Lead adicionado à fila.');
}

function removeLeadFromWhatsappQueue(leadId) {
  const queue = getWhatsappQueueV27().filter(item => item.leadId !== leadId || item.status === 'Enviado');
  saveWhatsappQueueV27(queue);

  if (activeLeadDrawerId === leadId) {
    addLeadHistory(leadId, 'Removido da fila WhatsApp', activeLeadDrawerData || {});
    renderLeadQueueBox();
    if (typeof renderLeadTimeline === 'function') renderLeadTimeline(leadId);
  }

  renderWhatsappQueuePanel();
}

function setQueueItemStatus(id, status) {
  const queue = getWhatsappQueueV27();
  const item = queue.find(q => q.id === id);
  if (!item) return;

  item.status = status;
  item.updatedAt = new Date().toISOString();
  saveWhatsappQueueV27(queue);

  if (item.leadId) {
    addLeadHistory(item.leadId, `Fila WhatsApp: status alterado para ${status}`, findLeadEverywhere(item.leadId) || {});
  }

  renderWhatsappQueuePanel();
}

function renderWhatsappQueueList() {
  const box = document.getElementById('whatsappQueueList');
  if (!box) return;

  const queue = getWhatsappQueueV27();

  if (!queue.length) {
    box.innerHTML = '<div class="queue-v27-empty">// nenhum lead na fila WhatsApp</div>';
    return;
  }

  box.innerHTML = queue.map(item => {
    const cls = normalizeStr(item.status || 'pendente').replace(/[^a-z0-9]+/g,'');
    return `
      <div class="queue-v27-row">
        <div>
          <div class="queue-v27-name">${escHtml(item.nome || 'Lead')}</div>
          <div class="queue-v27-meta">${escHtml(item.telefone || 'sem telefone')}</div>
        </div>
        <div class="queue-v27-meta">${escHtml(item.campaign || 'Campanha Principal')}</div>
        <div class="queue-v27-meta">${item.templateName ? `<span class="queue-v28-template">${escHtml(item.templateName)}</span>` : 'template ainda não sorteado'}</div>
        <span class="queue-v27-status ${cls}">${escHtml(item.status || 'Pendente')}</span>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn btn-ghost" style="font-size:10px;padding:7px 12px" onclick="openLeadDrawer('${escHtml(item.leadId)}')">Ficha</button>
          <button class="btn btn-ghost" style="font-size:10px;padding:7px 12px" onclick="setQueueItemStatus('${escHtml(item.id)}','Pronto')">Pronto</button>
          <button class="btn btn-danger" style="font-size:10px;padding:7px 12px" onclick="removeLeadFromWhatsappQueue('${escHtml(item.leadId)}')">Remover</button>
        </div>
      </div>
    `;
  }).join('');
}

function renderWhatsappQueuePanel() {
  renderQueueControlBar();
  renderQueueCampaigns();
  renderQueueTemplates();
  renderWhatsappQueueList();
  updateWhatsappQueueBadge();
}

function updateWhatsappQueueBadge() {
  const badge = document.getElementById('badge-whatsapp-queue');
  if (!badge) return;
  const pending = getWhatsappQueueV27().filter(item => ['Pendente','Pronto'].includes(item.status)).length;
  badge.textContent = pending;
}

function ensureLeadQueueContainer() {
  if (document.getElementById('leadQueueBox')) return true;

  const drawer = document.getElementById('leadDrawer');
  if (!drawer) return false;

  const target =
    document.getElementById('leadMessageBox') ||
    document.getElementById('leadWhatsappValidationBox') ||
    document.getElementById('leadPresentationsList') ||
    document.getElementById('leadTimelineList');

  const block = document.createElement('div');
  block.id = 'leadQueueBox';

  if (target && target.parentElement) {
    target.parentElement.insertAdjacentElement('afterend', block);
  } else {
    drawer.appendChild(block);
  }

  return true;
}

function renderLeadQueueBox() {
  ensureLeadQueueContainer();
  const box = document.getElementById('leadQueueBox');
  if (!box || !activeLeadDrawerId) return;

  const campaigns = getQueueCampaigns();
  const active = getWhatsappQueueV27().find(item => item.leadId === activeLeadDrawerId && !['Enviado','Erro'].includes(item.status));

  box.innerHTML = `
    <div class="lead-queue-block">
      <div class="lead-queue-title">Fila WhatsApp</div>
      <div class="lead-queue-form">
        <select id="leadQueueCampaign" ${active ? 'disabled' : ''}>
          ${campaigns.map(c => `<option value="${escHtml(c)}" ${active?.campaign === c ? 'selected' : ''}>${escHtml(c)}</option>`).join('')}
        </select>
        ${active
          ? `<button class="btn btn-danger" style="font-size:10px;padding:7px 12px" onclick="removeLeadFromWhatsappQueue('${escHtml(activeLeadDrawerId)}')">Remover da fila</button>`
          : `<button class="btn btn-primary" style="font-size:10px;padding:7px 12px" onclick="addActiveLeadToWhatsappQueue()">Adicionar à fila</button>`
        }
      </div>
      <div class="lead-queue-status">
        ${active ? `Status: ${escHtml(active.status)} · Campanha: ${escHtml(active.campaign)}` : '// lead ainda não está na fila'}
      </div>
    </div>
  `;
}


/* ════════════════════════════
   CONTROLE DE FILA V28
════════════════════════════ */
const WHATSAPP_QUEUE_CONTROL_KEY = 'vs_whatsapp_queue_control_v28';

function getWhatsappQueueControl() {
  try {
    return JSON.parse(localStorage.getItem(WHATSAPP_QUEUE_CONTROL_KEY) || '{"paused":false}');
  } catch {
    return { paused:false };
  }
}

function saveWhatsappQueueControl(control) {
  localStorage.setItem(WHATSAPP_QUEUE_CONTROL_KEY, JSON.stringify({
    paused: !!control.paused,
    updatedAt: new Date().toISOString()
  }));
}

function pauseWhatsappQueue() {
  saveWhatsappQueueControl({ paused:true });
  renderWhatsappQueuePanel();
  notify('Fila pausada.');
}

function resumeWhatsappQueue() {
  saveWhatsappQueueControl({ paused:false });
  renderWhatsappQueuePanel();
  notify('Fila retomada.');
}

function toggleWhatsappQueuePause() {
  const control = getWhatsappQueueControl();
  if (control.paused) resumeWhatsappQueue();
  else pauseWhatsappQueue();
}

function pickRandomQueueTemplate() {
  const templates = getQueueTemplates ? getQueueTemplates() : [];
  if (!templates.length) return null;
  return templates[Math.floor(Math.random() * templates.length)];
}

function prepareQueueTemplates() {
  const control = getWhatsappQueueControl();
  if (control.paused) {
    notify('Retome a fila antes de preparar templates.', 'warn');
    return;
  }

  const queue = getWhatsappQueueV27();
  let count = 0;

  queue.forEach(item => {
    if (item.status !== 'Pendente') return;
    const template = pickRandomQueueTemplate();
    if (!template) return;

    item.templateId = template.id;
    item.templateName = template.name;
    item.templateText = template.text;
    item.status = 'Pronto';
    item.updatedAt = new Date().toISOString();
    count++;

    if (item.leadId && typeof addLeadHistory === 'function') {
      addLeadHistory(item.leadId, `Template sorteado para fila: ${template.name}`, findLeadEverywhere(item.leadId) || {});
    }
  });

  saveWhatsappQueueV27(queue);
  renderWhatsappQueuePanel();
  notify(`${count} lead(s) preparado(s) com template sorteado.`);
}

function renderQueueControlBar() {
  const host = document.getElementById('queueControlBar');
  if (!host) return;

  const control = getWhatsappQueueControl();
  const queue = getWhatsappQueueV27 ? getWhatsappQueueV27() : [];
  const pending = queue.filter(i => i.status === 'Pendente').length;
  const ready = queue.filter(i => i.status === 'Pronto').length;
  const sent = queue.filter(i => i.status === 'Enviado').length;
  const errors = queue.filter(i => i.status === 'Erro').length;

  host.innerHTML = `
    <div class="queue-control-bar">
      <div class="queue-control-left">
        <div class="queue-control-icon">${control.paused ? '⏸️' : '▶️'}</div>
        <div>
          <div class="queue-control-title">
            Fila ${control.paused ? 'pausada' : 'ativa'}
            <span class="queue-state-pill ${control.paused ? 'paused' : 'running'}">${control.paused ? 'PAUSADA' : 'ATIVA'}</span>
          </div>
          <div class="queue-control-text">
            ${pending} pendente(s) · ${ready} pronto(s) · ${sent} enviado(s) · ${errors} erro(s)
          </div>
        </div>
      </div>
      <div class="queue-control-actions">
        <button class="btn btn-ghost" onclick="toggleWhatsappQueuePause()">${control.paused ? 'Retomar fila' : 'Pausar fila'}</button>
        <button class="btn btn-primary" onclick="prepareQueueTemplates()">Sortear templates</button>
      </div>
    </div>
  `;
}


/* ════════════════════════════
   CHIPS V29 — DISTRIBUIÇÃO
════════════════════════════ */
const WHATSAPP_CHIPS_V29_KEY = 'vs_whatsapp_chips_v29';
const CHIP_USAGE_DAY_KEY = 'vs_chip_usage_day_v29';

function todayUsageKeyV29(){ return new Date().toISOString().slice(0,10); }

function getWhatsappChipsV29(){
  try {
    const data = JSON.parse(localStorage.getItem(WHATSAPP_CHIPS_V29_KEY) || '[]');
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}

function saveWhatsappChipsV29(list){
  setTimeout(() => { try { scheduleOperationalSyncV36(); } catch(e){} }, 0);
  localStorage.setItem(WHATSAPP_CHIPS_V29_KEY, JSON.stringify(list || []));
  updateChipsBadge();
}

function getChipUsageV29(){
  try {
    const usage = JSON.parse(localStorage.getItem(CHIP_USAGE_DAY_KEY) || '{}');
    if (usage.day !== todayUsageKeyV29()) return { day: todayUsageKeyV29(), chips:{} };
    return usage;
  } catch { return { day: todayUsageKeyV29(), chips:{} }; }
}

function saveChipUsageV29(usage){
  localStorage.setItem(CHIP_USAGE_DAY_KEY, JSON.stringify(usage));
}

function getChipUsedToday(chipId){
  const usage = getChipUsageV29();
  return Number(usage.chips?.[chipId] || 0);
}

function setChipUsedToday(chipId, count){
  const usage = getChipUsageV29();
  usage.chips = usage.chips || {};
  usage.chips[chipId] = Number(count || 0);
  saveChipUsageV29(usage);
}

function addWhatsappChip(){
  const name = (document.getElementById('chipName')?.value || '').trim();
  const url = normalizeEvolutionBaseUrlV405(
    document.getElementById('chipUrl')?.value ||
    document.getElementById('evoUrl')?.value ||
    document.querySelector('[placeholder*="URL"]')?.value ||
    ''
  );
  const instance = (
    document.getElementById('chipInstance')?.value ||
    document.getElementById('evoInstance')?.value ||
    document.querySelector('[placeholder*="Instância"]')?.value ||
    document.querySelector('[placeholder*="Instance"]')?.value ||
    ''
  ).trim();
  const key = (
    document.getElementById('chipApiKey')?.value ||
    document.getElementById('evoApiKey')?.value ||
    document.getElementById('evoKey')?.value ||
    document.querySelector('[placeholder*="API Key"]')?.value ||
    document.querySelector('[placeholder*="api key"]')?.value ||
    ''
  ).trim();

  const dailyLimit = Number(document.getElementById('chipDailyLimit')?.value || 120);
  const blockSize = Number(document.getElementById('chipBlockSize')?.value || 30);
  const intervalSeconds = Number(document.getElementById('chipInterval')?.value || 120);
  const blocks = (document.getElementById('chipBlocks')?.value || '08:00,10:00,12:00,14:00')
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);

  if (!name || !url || !instance || !key) {
    notify('Preencha nome, URL, instância e API Key do chip.', 'warn');
    return;
  }

  const chips = getWhatsappChipsV29();
  const existing = chips.find(chip => chip.id === name || chip.name === name || chip.instance === instance);

  const payload = {
    id: existing?.id || 'chip_' + Date.now(),
    name,
    url,
    instance,
    key,
    apiKey: key,
    dailyLimit,
    blockSize,
    intervalSeconds,
    blocks,
    status: existing?.status || 'active',
    paused: existing?.paused || false,
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  if (existing) Object.assign(existing, payload);
  else chips.push(payload);

  saveWhatsappChipsV29(chips);
  renderChipsPanel();
  notify(existing ? 'Chip atualizado.' : 'Chip cadastrado.');
}

function removeWhatsappChip(id){
  saveWhatsappChipsV29(getWhatsappChipsV29().filter(chip => chip.id !== id));
  renderChipsPanel();
}

function toggleChipPause(id){
  const chips = getWhatsappChipsV29();
  const chip = chips.find(c => c.id === id);
  if (!chip) return;
  chip.paused = !chip.paused;
  saveWhatsappChipsV29(chips);
  renderChipsPanel();
}

function toggleChipEnabled(id){
  const chips = getWhatsappChipsV29();
  const chip = chips.find(c => c.id === id);
  if (!chip) return;
  chip.status = chip.status === 'disabled' ? 'active' : 'disabled';
  saveWhatsappChipsV29(chips);
  renderChipsPanel();
}

function resetDailyChipUsage(){
  saveChipUsageV29({ day: todayUsageKeyV29(), chips:{} });
  renderChipsPanel();
  notify('Contadores do dia zerados.');
}

function getAvailableChipsV29(){
  return getWhatsappChipsV29().filter(chip => {
    if (chip.status === 'disabled' || chip.paused) return false;
    return getChipUsedToday(chip.id) < Number(chip.dailyLimit || 120);
  });
}

function assignChipsToReadyQueue(){
  const chips = getAvailableChipsV29();
  if (!chips.length) {
    notify('Nenhum chip disponível.', 'warn');
    return;
  }

  const queue = getWhatsappQueueV27 ? getWhatsappQueueV27() : [];
  const ready = queue.filter(item => item.status === 'Pronto' && !item.chipId);

  if (!ready.length) {
    notify('Nenhum lead pronto sem chip.', 'warn');
    return;
  }

  let assigned = 0;
  let chipIndex = 0;

  ready.forEach(item => {
    let tries = 0;
    let selected = null;

    while (tries < chips.length) {
      const chip = chips[chipIndex % chips.length];
      chipIndex++;
      tries++;

      const used = getChipUsedToday(chip.id);
      if (used < Number(chip.dailyLimit || 120)) {
        selected = chip;
        break;
      }
    }

    if (!selected) return;

    item.chipId = selected.id;
    item.chipName = selected.name;
    item.chipInstance = selected.instance;
    item.intervalSeconds = Number(selected.intervalSeconds || 120);
    item.blockSize = Number(selected.blockSize || 30);
    item.blocks = selected.blocks || ['08:00','10:00','12:00','14:00'];
    item.updatedAt = new Date().toISOString();

    setChipUsedToday(selected.id, getChipUsedToday(selected.id) + 1);
    assigned++;

    if (item.leadId && typeof addLeadHistory === 'function') {
      addLeadHistory(item.leadId, `Chip atribuído para disparo: ${selected.name}`, findLeadEverywhere(item.leadId) || {});
    }
  });

  saveWhatsappQueueV27(queue);
  renderChipsPanel();
  if (typeof renderWhatsappQueuePanel === 'function') renderWhatsappQueuePanel();
  notify(`${assigned} lead(s) receberam chip.`);
}

function renderChipsOperationSummary(){
  const box = document.getElementById('chipsOperationSummary');
  if (!box) return;

  const chips = getWhatsappChipsV29();
  const active = chips.filter(c => c.status !== 'disabled' && !c.paused);
  const totalCapacity = active.reduce((sum, chip) => sum + Math.max(0, Number(chip.dailyLimit || 120) - getChipUsedToday(chip.id)), 0);
  const totalDaily = chips.reduce((sum, chip) => sum + Number(chip.dailyLimit || 120), 0);

  box.innerHTML = `
    Chips cadastrados: ${chips.length}<br>
    Chips ativos: ${active.length}<br>
    Capacidade diária total: ${totalDaily}<br>
    Capacidade restante hoje: ${totalCapacity}<br>
    Padrão recomendado: 120 por chip · 4 blocos de 30 · 120s · espera 1h entre blocos
  `;
}

function renderChipsList(){
  const box = document.getElementById('chipsList');
  if (!box) return;

  const chips = getWhatsappChipsV29();

  if (!chips.length) {
    box.innerHTML = '<div class="queue-v27-empty">// nenhum chip cadastrado ainda</div>';
    return;
  }

  box.innerHTML = chips.map(chip => {
    const used = getChipUsedToday(chip.id);
    const limit = Number(chip.dailyLimit || 120);
    const pct = Math.min(100, Math.round((used / Math.max(limit,1)) * 100));
    const disabled = chip.status === 'disabled';
    const paused = !!chip.paused;
    const stateClass = disabled ? 'disabled' : paused ? 'paused' : '';
    const pill = disabled
      ? '<span class="chip-pill err">desativado</span>'
      : paused
        ? '<span class="chip-pill warn">pausado</span>'
        : '<span class="chip-pill ok">ativo</span>';

    return `
      <div class="chip-card ${stateClass}">
        <div class="chip-card-top">
          <div>
            <div class="chip-card-name">${escHtml(chip.name)}</div>
            <div class="chip-card-meta">
              URL: ${escHtml(chip.url || chip.baseUrl || chip.evolutionUrl || 'sem URL')}<br>Instância: ${escHtml(chip.instance)}<br>
              Blocos: ${escHtml((chip.blocks || []).join(', '))}<br>
              Intervalo: ${escHtml(String(chip.intervalSeconds || 120))}s
            </div>
          </div>
          ${pill}
        </div>
        <div class="chip-card-meta">${used} / ${limit} envios hoje</div>
        <div class="chip-progress"><div class="chip-progress-fill" style="width:${pct}%"></div></div>
        <div class="chip-card-actions">
          <button class="btn btn-ghost" style="font-size:10px;padding:7px 12px" onclick="toggleChipPause('${escHtml(chip.id)}')">${paused ? 'Retomar' : 'Pausar'}</button>
          <button class="btn btn-ghost" style="font-size:10px;padding:7px 12px" onclick="toggleChipEnabled('${escHtml(chip.id)}')">${disabled ? 'Ativar' : 'Desativar'}</button>
          <button class="btn btn-danger" style="font-size:10px;padding:7px 12px" onclick="removeWhatsappChip('${escHtml(chip.id)}')">Remover</button>
        </div>
      </div>
    `;
  }).join('');
}

function renderChipsPanel(){
  renderChipsOperationSummary();
  renderChipsList();
  updateChipsBadge();
}

function updateChipsBadge(){
  const badge = document.getElementById('badge-chips');
  if (badge) badge.textContent = getWhatsappChipsV29().length;
}


/* ════════════════════════════
   DISPARO INICIAL V30
════════════════════════════ */
const DISPATCH_V30_LOG_KEY = 'vs_dispatch_v30_log';

function getDispatchLogsV30() {
  try {
    const data = JSON.parse(localStorage.getItem(DISPATCH_V30_LOG_KEY) || '[]');
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function saveDispatchLogsV30(list) {
  localStorage.setItem(DISPATCH_V30_LOG_KEY, JSON.stringify((list || []).slice(0, 200)));
}

function addDispatchLogV30(text) {
  const logs = getDispatchLogsV30();
  logs.unshift({
    at: crmNowLabel(),
    text
  });
  saveDispatchLogsV30(logs);
}

function getReadyDispatchItemsV30() {
  const queue = getWhatsappQueueV27 ? getWhatsappQueueV27() : [];
  const chips = getWhatsappChipsV29 ? getWhatsappChipsV29() : [];
  const chipMap = new Map(chips.map(chip => [chip.id, chip]));

  return queue.filter(item => {
    if (item.status !== 'Pronto') return false;
    if (!item.chipId || !item.templateText) return false;

    const chip = chipMap.get(item.chipId);
    if (!chip) return false;
    if (chip.paused || chip.status === 'disabled') return false;

    return true;
  });
}

function renderDispatchV30Panel() {
  const host = document.getElementById('dispatchV30Panel');
  if (!host) return;

  const control = getWhatsappQueueControl ? getWhatsappQueueControl() : { paused:false };
  const ready = getReadyDispatchItemsV30();
  const logs = getDispatchLogsV30().slice(0, 8);

  host.innerHTML = `
    <div class="dispatch-v30-panel">
      <div class="dispatch-v30-head">
        <div>
          <div class="dispatch-v30-title">
            Disparo em massa
            <span class="dispatch-v30-pill">${ready.length} pronto(s)</span>
          </div>
          <div class="dispatch-v30-sub">
            120 mensagens por chip · 4 lotes de 30 · 120s entre envios · espera 1h
          </div>
        </div>
        <div class="dispatch-v30-actions">
          <button class="btn btn-ghost" onclick="previewDispatchV30()">Pré-visualizar</button>
          <button class="btn btn-primary" onclick="startDispatchV32()">Iniciar disparo</button><button class="btn btn-danger" onclick="stopDispatchV32()">Parar</button>
        </div>
      </div>
      <div class="dispatch-v30-log">
        ${logs.length ? logs.map(log => `${escHtml(log.at)} · ${escHtml(log.text)}`).join('<br>') : '// nenhum disparo iniciado ainda'}
      </div>
    </div>
  `;
}

function previewDispatchV30() {
  const control = getWhatsappQueueControl ? getWhatsappQueueControl() : { paused:false };

  if (control.paused) {
    notify('A fila está pausada.', 'warn');
    addDispatchLogV30('Prévia bloqueada: fila pausada');
    renderDispatchV30Panel();
    return;
  }

  const ready = getReadyDispatchItemsV30();
  const byChip = {};

  ready.forEach(item => {
    byChip[item.chipName || 'Sem chip'] = (byChip[item.chipName || 'Sem chip'] || 0) + 1;
  });

  const summary = Object.entries(byChip)
    .map(([chip, count]) => `${chip}: ${count}`)
    .join(' · ');

  addDispatchLogV30(`Prévia: ${ready.length} lead(s) pronto(s). ${summary || 'Nenhum chip disponível.'}`);
  renderDispatchV30Panel();
  notify(`${ready.length} lead(s) pronto(s) para disparo.`);
}

async function startDispatchV30() {
  const control = getWhatsappQueueControl ? getWhatsappQueueControl() : { paused:false };

  if (control.paused) {
    notify('Retome a fila antes de disparar.', 'warn');
    addDispatchLogV30('Disparo bloqueado: fila pausada');
    renderDispatchV30Panel();
    return;
  }

  const settings = getEvolutionSettings ? getEvolutionSettings() : {};
  if (!settings.url || !settings.apiKey) {
    notify('Configure a Evolution API antes do disparo.', 'warn');
    addDispatchLogV30('Disparo bloqueado: Evolution incompleta');
    renderDispatchV30Panel();
    return;
  }

  const queue = getWhatsappQueueV27 ? getWhatsappQueueV27() : [];
  const ready = getReadyDispatchItemsV30();

  if (!ready.length) {
    notify('Nenhum lead pronto para envio.', 'warn');
    addDispatchLogV30('Nenhum lead pronto para envio');
    renderDispatchV30Panel();
    return;
  }

  addDispatchLogV30(`Disparo iniciado: ${ready.length} lead(s).`);
  addDispatchLogV30('Ritmo V31 ativo: valida limite diário e bloco por chip.');

  let sent = 0;
  let failed = 0;

  for (const item of ready) {
    const currentControl = getWhatsappQueueControl ? getWhatsappQueueControl() : { paused:false };
    if (currentControl.paused) {
      addDispatchLogV30('Disparo interrompido: fila pausada');
      break;
    }

    const chip = (getWhatsappChipsV29 ? getWhatsappChipsV29() : []).find(c => c.id === item.chipId);
    if (!chip || chip.paused || chip.status === 'disabled') {
      item.status = 'Erro';
      item.error = 'Chip indisponível';
      failed++;
      continue;
    }

    const phone = normalizePhoneForEvolution(item.telefone || '');
    const text = item.templateText || '';

    if (!phone || !text) {
      item.status = 'Erro';
      item.error = 'Telefone ou template ausente';
      failed++;
      continue;
    }

    try {
      const endpoint = `${chipConfigV405.url}/message/sendText/${encodeURIComponent(chipConfigV405.instance)}`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: (typeof getEvolutionHeadersV405 === 'function' ? getEvolutionHeadersV405(settings) : getEvolutionHeaders(settings)),
        body: JSON.stringify({ number: phone, text })
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        item.status = 'Erro';
        item.error = data?.message || data?.error || `HTTP ${res.status}`;
        failed++;
        addDispatchLogV30(`Erro: ${item.nome} · ${item.error}`);
        if (item.leadId) addLeadHistory(item.leadId, `Disparo WhatsApp com erro: ${item.error}`, findLeadEverywhere(item.leadId) || {});
      } else {
        item.status = 'Enviado';
        item.sentAt = new Date().toISOString();
        item.sentAtLabel = crmNowLabel();
        item.response = data;
        sent++;
        addDispatchLogV30(`Enviado: ${item.nome} · ${chip.name} · bloco ${item.sentBlock || '--'}`);
        if (item.leadId) addLeadHistory(item.leadId, `Mensagem enviada em massa via ${chip.name} · Template: ${item.templateName}`, findLeadEverywhere(item.leadId) || {});
      }
    } catch (err) {
      item.status = 'Erro';
      item.error = err?.message || 'falha desconhecida';
      failed++;
      addDispatchLogV30(`Falha: ${item.nome} · ${item.error}`);
      if (item.leadId) addLeadHistory(item.leadId, `Disparo WhatsApp falhou: ${item.error}`, findLeadEverywhere(item.leadId) || {});
    }
  }

  saveWhatsappQueueV27(queue);
  addDispatchLogV30(`Disparo finalizado: ${sent} enviado(s), ${failed} erro(s).`);

  if (typeof renderWhatsappQueuePanel === 'function') renderWhatsappQueuePanel();
  if (typeof renderChipsPanel === 'function') renderChipsPanel();
  renderDispatchV30Panel();

  notify(`Disparo finalizado: ${sent} enviado(s), ${failed} erro(s).`);
}


/* ════════════════════════════
   RITMO E BLOCOS V31
════════════════════════════ */
function getChipBlockUsageV31(chipId) {
  const usage = getChipUsageV29 ? getChipUsageV29() : { day: todayUsageKeyV29(), chips:{} };
  usage.blocks = usage.blocks || {};
  usage.blocks[chipId] = usage.blocks[chipId] || {};
  return usage.blocks[chipId];
}

function setChipBlockUsageV31(chipId, block, count) {
  const usage = getChipUsageV29 ? getChipUsageV29() : { day: todayUsageKeyV29(), chips:{} };
  usage.blocks = usage.blocks || {};
  usage.blocks[chipId] = usage.blocks[chipId] || {};
  usage.blocks[chipId][block] = Number(count || 0);
  saveChipUsageV29(usage);
}

function getCurrentDispatchBlockV31(chip) {
  const blocks = chip?.blocks?.length ? chip.blocks : ['08:00','10:00','12:00','14:00'];
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  let selected = blocks[0];

  blocks.forEach(block => {
    const [h, m] = String(block).split(':').map(Number);
    const blockMinutes = (h || 0) * 60 + (m || 0);
    if (currentMinutes >= blockMinutes) selected = block;
  });

  return selected;
}

function canSendByChipRulesV31(chip) {
  if (!chip) return { ok:false, reason:'chip ausente' };
  if (chip.paused || chip.status === 'disabled') return { ok:false, reason:'chip pausado/desativado' };

  const dailyLimit = Number(chip.dailyLimit || 120);
  const blockSize = Number(chip.blockSize || 30);
  const usedToday = getChipUsedToday(chip.id);

  if (usedToday >= dailyLimit) {
    return { ok:false, reason:'limite diário atingido' };
  }

  const block = getCurrentDispatchBlockV31(chip);
  const blockUsage = getChipBlockUsageV31(chip.id);
  const usedInBlock = Number(blockUsage[block] || 0);

  if (usedInBlock >= blockSize) {
    return { ok:false, reason:`bloco ${block} cheio` };
  }

  return { ok:true, block, usedToday, usedInBlock };
}

function registerChipSendV31(chip) {
  const block = getCurrentDispatchBlockV31(chip);
  setChipUsedToday(chip.id, getChipUsedToday(chip.id) + 1);

  const blockUsage = getChipBlockUsageV31(chip.id);
  setChipBlockUsageV31(chip.id, block, Number(blockUsage[block] || 0) + 1);

  return block;
}

function getDispatchScheduleSummaryV31() {
  const chips = getWhatsappChipsV29 ? getWhatsappChipsV29() : [];
  const active = chips.filter(c => c.status !== 'disabled' && !c.paused);
  const totalDaily = active.reduce((sum, chip) => sum + Number(chip.dailyLimit || 120), 0);
  const remaining = active.reduce((sum, chip) => sum + Math.max(0, Number(chip.dailyLimit || 120) - getChipUsedToday(chip.id)), 0);
  const currentBlock = active[0] ? getCurrentDispatchBlockV31(active[0]) : '--:--';

  return {
    chips: active.length,
    totalDaily,
    remaining,
    currentBlock
  };
}

function renderDispatchScheduleV31() {
  const summary = getDispatchScheduleSummaryV31();

  return `
    <div class="dispatch-v31-schedule">
      <div class="dispatch-v31-slot">
        <div class="dispatch-v31-slot-title">Chips ativos</div>
        <div class="dispatch-v31-slot-value">${summary.chips}</div>
      </div>
      <div class="dispatch-v31-slot">
        <div class="dispatch-v31-slot-title">Capacidade/dia</div>
        <div class="dispatch-v31-slot-value">${summary.totalDaily}</div>
      </div>
      <div class="dispatch-v31-slot">
        <div class="dispatch-v31-slot-title">Restante hoje</div>
        <div class="dispatch-v31-slot-value">${summary.remaining}</div>
      </div>
      <div class="dispatch-v31-slot">
        <div class="dispatch-v31-slot-title">Bloco atual</div>
        <div class="dispatch-v31-slot-value">${summary.currentBlock}</div>
      </div>
    </div>
    <div class="dispatch-v31-warning">
      Regra ativa: 120 mensagens por chip · 4 blocos de 30 · 120 segundos entre envios · espera 1h entre blocos.
    </div>
  `;
}


/* ════════════════════════════
   DISPARO TEMPORIZADO V32
════════════════════════════ */
let dispatchTimerV32 = null;
let dispatchRunningV32 = false;

function getDispatchRuntimeV32() {
  try {
    return JSON.parse(localStorage.getItem('vs_dispatch_runtime_v32') || '{}');
  } catch {
    return {};
  }
}

function saveDispatchRuntimeV32(data = {}) {
  const prev = getDispatchRuntimeV32();
  localStorage.setItem('vs_dispatch_runtime_v32', JSON.stringify({
    ...prev,
    ...data,
    updatedAt: new Date().toISOString()
  }));
}

function getNextReadyDispatchItemV32() {
  const ready = getReadyDispatchItemsV30 ? getReadyDispatchItemsV30() : [];

  for (const item of ready) {
    const chip = (getWhatsappChipsV29 ? getWhatsappChipsV29() : []).find(c => c.id === item.chipId);
    if (!chip) continue;

    const rule = canSendByChipRulesV31 ? canSendByChipRulesV31(chip) : { ok:true };
    if (rule.ok) return { item, chip };
  }

  return null;
}

function getDispatchIntervalMsV32(chip) {
  const seconds = Number(chip?.intervalSeconds || 120);
  return Math.max(10, seconds) * 1000;
}

function stopDispatchV32(reason = 'Disparo parado') {
  dispatchRunningV32 = false;
  clearTimeout(dispatchTimerV32);
  dispatchTimerV32 = null;
  saveDispatchRuntimeV32({ running:false, reason });
  addDispatchLogV30(reason);
  if (typeof renderDispatchV30Panel === 'function') renderDispatchV30Panel();
  notify(reason);
}

async function dispatchOneItemV32(item, chip) {
  const settings = getEvolutionSettings ? getEvolutionSettings() : {};
  const chipConfigV405 = getEvolutionConfigForChipV405 ? getEvolutionConfigForChipV405(chip) : settings;
  const queue = getWhatsappQueueV27 ? getWhatsappQueueV27() : [];
  const queueItem = queue.find(q => q.id === item.id);

  if (!queueItem) return { ok:false, reason:'item não encontrado' };

  const phone = normalizePhoneForEvolution(queueItem.telefone || '');
  const text = queueItem.templateText || '';

  if (!chipConfigV405.url || !chipConfigV405.apiKey || !chipConfigV405.instance) {
    queueItem.status = 'Erro';
    queueItem.error = 'Evolution incompleta no chip';
    saveWhatsappQueueV27(queue);
    return { ok:false, reason:'Evolution incompleta' };
  }

  if (!phone || !text) {
    queueItem.status = 'Erro';
    queueItem.error = 'Telefone ou template ausente';
    saveWhatsappQueueV27(queue);
    return { ok:false, reason:'Telefone/template ausente' };
  }

  try {
    queueItem.status = 'Enviando';
    saveWhatsappQueueV27(queue);
    if (typeof renderWhatsappQueuePanel === 'function') renderWhatsappQueuePanel();

    const chipConfigV405 = getEvolutionConfigForChipV405 ? getEvolutionConfigForChipV405(chip) : settings;
      const endpoint = `${chipConfigV405.url}/message/sendText/${encodeURIComponent(chipConfigV405.instance)}`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: (typeof getEvolutionHeadersV405 === 'function' ? getEvolutionHeadersV405(settings) : getEvolutionHeaders(settings)),
      body: JSON.stringify({ number: phone, text })
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      queueItem.status = 'Erro';
      queueItem.error = data?.message || data?.error || `HTTP ${res.status}`;
      queueItem.updatedAt = new Date().toISOString();
      saveWhatsappQueueV27(queue);

      if (queueItem.leadId) {
        addLeadHistory(queueItem.leadId, `Disparo WhatsApp com erro: ${queueItem.error}`, findLeadEverywhere(queueItem.leadId) || {});
      }

      return { ok:false, reason:queueItem.error };
    }

    queueItem.status = 'Enviado';
    queueItem.sentAt = new Date().toISOString();
    queueItem.sentAtLabel = crmNowLabel();
    queueItem.sentBlock = registerChipSendV31 ? registerChipSendV31(chip) : '';
    queueItem.response = data;
    saveWhatsappQueueV27(queue);

    if (queueItem.leadId) {
      addLeadHistory(queueItem.leadId, `Mensagem enviada em massa via ${chip.name} · Template: ${queueItem.templateName}`, findLeadEverywhere(queueItem.leadId) || {});
    }

    return { ok:true, reason:'enviado' };
  } catch (err) {
    queueItem.status = 'Erro';
    queueItem.error = err?.message || 'falha desconhecida';
    queueItem.updatedAt = new Date().toISOString();
    saveWhatsappQueueV27(queue);

    if (queueItem.leadId) {
      addLeadHistory(queueItem.leadId, `Disparo WhatsApp falhou: ${queueItem.error}`, findLeadEverywhere(queueItem.leadId) || {});
    }

    return { ok:false, reason:queueItem.error };
  }
}

async function dispatchLoopV32() {
  if (!dispatchRunningV32) return;

  const control = getWhatsappQueueControl ? getWhatsappQueueControl() : { paused:false };
  if (control.paused) {
    stopDispatchV32('Disparo pausado: fila pausada');
    return;
  }

  const next = getNextReadyDispatchItemV32();

  if (!next) {
    stopDispatchV32('Disparo finalizado: nenhum item disponível');
    return;
  }

  const { item, chip } = next;
  addDispatchLogV30(`Enviando: ${item.nome} · ${chip.name}`);

  const result = await dispatchOneItemV32(item, chip);

  if (result.ok) {
    addDispatchLogV30(`Enviado: ${item.nome} · próximo em ${chip.intervalSeconds || 120}s`);
  } else {
    addDispatchLogV30(`Erro: ${item.nome} · ${result.reason}`);
  }

  if (typeof renderWhatsappQueuePanel === 'function') renderWhatsappQueuePanel();
  if (typeof renderChipsPanel === 'function') renderChipsPanel();
  if (typeof renderDispatchV30Panel === 'function') renderDispatchV30Panel();

  if (!dispatchRunningV32) return;

  const interval = getDispatchIntervalMsV32(chip);
  saveDispatchRuntimeV32({
    running:true,
    lastSentAt:new Date().toISOString(),
    nextRunAt:new Date(Date.now() + interval).toISOString()
  });

  dispatchTimerV32 = setTimeout(dispatchLoopV32, interval);
}

function startDispatchV32() {
  if (dispatchRunningV32) {
    notify('Disparo já está em execução.', 'warn');
    return;
  }

  const control = getWhatsappQueueControl ? getWhatsappQueueControl() : { paused:false };
  if (control.paused) {
    notify('Retome a fila antes de iniciar.', 'warn');
    return;
  }

  const ready = getReadyDispatchItemsV30 ? getReadyDispatchItemsV30() : [];
  if (!ready.length) {
    notify('Nenhum lead pronto para disparo.', 'warn');
    return;
  }

  dispatchRunningV32 = true;
  saveDispatchRuntimeV32({ running:true, startedAt:new Date().toISOString(), reason:'' });
  addDispatchLogV30(`Disparo temporizado iniciado: ${ready.length} item(s).`);
  renderDispatchV30Panel();
  dispatchLoopV32();
}

function renderDispatchRuntimeV32() {
  const runtime = getDispatchRuntimeV32();
  const cls = dispatchRunningV32 || runtime.running ? 'running' : '';
  const next = runtime.nextRunAt ? new Date(runtime.nextRunAt).toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit', second:'2-digit' }) : '--';

  return `
    <div class="dispatch-v32-runtime ${cls}">
      Estado: ${dispatchRunningV32 || runtime.running ? 'em execução' : 'parado'}<br>
      Próximo envio: ${next}<br>
      Regra: 120s entre envios · 30 por bloco · 4 blocos · 120 por chip/dia
    </div>
  `;
}


/* ════════════════════════════
   WEBHOOK RESPOSTAS V34
════════════════════════════ */
const EVOLUTION_RESPONSES_V34_KEY = 'vs_evolution_responses_v34';

function getLocalResponsesV34() {
  try {
    const data = JSON.parse(localStorage.getItem(EVOLUTION_RESPONSES_V34_KEY) || '[]');
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function saveLocalResponsesV34(list) {
  setTimeout(() => { try { scheduleOperationalSyncV36(); } catch(e){} }, 0);
  localStorage.setItem(EVOLUTION_RESPONSES_V34_KEY, JSON.stringify((list || []).slice(0, 500)));
  updateResponsesBadgeV34();
}

function getWebhookUrlV34() {
  return `${window.location.origin}/api/webhook/evolution`;
}

function renderWebhookUrlV34() {
  const box = document.getElementById('webhookUrlV34');
  if (box) box.textContent = getWebhookUrlV34();
}

function copyWebhookUrlV34() {
  navigator.clipboard?.writeText(getWebhookUrlV34());
  notify('URL do webhook copiada.');
}

function normalizePhoneV34(value = '') {
  return String(value || '').replace(/\D/g,'');
}

function findLeadByPhoneV34(phone) {
  const target = normalizePhoneV34(phone);
  if (!target) return null;

  const data = ensureWeekData ? ensureWeekData() : { days:{} };
  const leads = flattenWeekData ? flattenWeekData(data) : [];

  for (const lead of leads) {
    const current = normalizePhoneV34(lead.whatsapp || lead.phone || lead.telefone || '');
    if (!current) continue;
    if (current.endsWith(target.slice(-8)) || target.endsWith(current.slice(-8))) return lead;
  }

  return null;
}

async function fetchEvolutionResponsesV34() {
  try {
    const res = await fetch('/api/webhook/evolution?limit=100');
    const data = await res.json();

    if (!res.ok || !data.success) {
      notify('Não foi possível buscar respostas.', 'err');
      return;
    }

    const local = getLocalResponsesV34();
    const map = new Map(local.map(item => [item.id, item]));

    (data.events || []).forEach(item => {
      map.set(item.id, item);
    });

    saveLocalResponsesV34(Array.from(map.values()).sort((a,b) => String(b.receivedAt).localeCompare(String(a.receivedAt))));
    renderResponsesV34();
    notify('Respostas atualizadas.');
  } catch (err) {
    notify('Erro ao buscar respostas do webhook.', 'err');
  }
}

function applyResponseToLeadV34(responseId) {
  const responses = getLocalResponsesV34();
  const response = responses.find(item => item.id === responseId);
  if (!response) return;

  const lead = findLeadByPhoneV34(response.phone);
  if (!lead) {
    notify('Lead não encontrado pelo telefone.', 'warn');
    return;
  }

  const leadId = lead.id;
  const crm = ensureLeadCrm(leadId, lead);

  crm.messages = Array.isArray(crm.messages) ? crm.messages : [];
  crm.messages.push({
    id: response.id,
    direction: 'in',
    text: response.text || '',
    phone: response.phone || '',
    at: response.receivedAt || new Date().toISOString(),
    atLabel: response.receivedAt ? new Date(response.receivedAt).toLocaleString('pt-BR') : crmNowLabel()
  });

  crm.pipelineStatus = crm.pipelineStatus === 'contato_enviado' ? 'respondeu' : crm.pipelineStatus;
  crm.lastResponseAt = response.receivedAt || new Date().toISOString();

  saveLeadCrm(leadId, crm);
  addLeadHistory(leadId, `Lead respondeu no WhatsApp: ${(response.text || '').slice(0, 120)}`, lead);

  response.applied = true;
  response.leadId = leadId;
  saveLocalResponsesV34(responses);

  renderResponsesV34();
  if (typeof renderKanban === 'function') renderKanban();
  notify('Resposta vinculada ao lead.');
}

function renderResponsesV34() {
  renderWebhookUrlV34();

  const list = document.getElementById('responsesListV34');
  if (!list) return;

  const responses = getLocalResponsesV34();

  if (!responses.length) {
    list.innerHTML = '<div class="response-v34-empty">// nenhuma resposta recebida ainda</div>';
    updateResponsesBadgeV34();
    return;
  }

  list.innerHTML = responses.map(item => {
    const date = item.receivedAt ? new Date(item.receivedAt).toLocaleString('pt-BR') : '';
    const lead = findLeadByPhoneV34(item.phone);
    return `
      <div class="response-v34-item">
        <div class="response-v34-top">
          <div>
            <div class="response-v34-phone">${escHtml(item.phone || 'sem telefone')}</div>
            <div class="response-v34-date">${escHtml(date)}</div>
          </div>
          <span class="queue-v27-status ${item.applied ? 'enviado' : 'pendente'}">${item.applied ? 'vinculada' : 'nova'}</span>
        </div>
        <div class="response-v34-text">${escHtml(item.text || '[mensagem sem texto]')}</div>
        <div class="response-v34-actions">
          ${lead ? `<button class="btn btn-primary" style="font-size:10px;padding:7px 12px" onclick="applyResponseToLeadV34('${escHtml(item.id)}')">${item.applied ? 'Atualizar lead' : 'Vincular ao lead'}</button>` : '<span class="queue-v27-status erro">lead não encontrado</span>'}
          ${lead ? `<button class="btn btn-ghost" style="font-size:10px;padding:7px 12px" onclick="openLeadDrawer('${escHtml(lead.id)}')">Abrir ficha</button>` : ''}
        </div>
      </div>
    `;
  }).join('');

  updateResponsesBadgeV34();
}

function updateResponsesBadgeV34() {
  const badge = document.getElementById('badge-responses');
  if (!badge) return;
  const count = getLocalResponsesV34().filter(item => !item.applied).length;
  badge.textContent = count;
}

function renderResponsesPanelV34() {
  renderResponsesV34();
}


/* ════════════════════════════
   AUDITORIA V35
════════════════════════════ */
function getAuditQueueItemsV35() {
  const queue = getWhatsappQueueV27 ? getWhatsappQueueV27() : [];
  return queue.map(item => ({
    id: item.id,
    leadId: item.leadId,
    nome: item.nome || 'Lead',
    telefone: item.telefone || '',
    campaign: item.campaign || '',
    templateName: item.templateName || '',
    chipName: item.chipName || '',
    status: item.status || 'Pendente',
    error: item.error || '',
    createdAt: item.createdAtLabel || item.createdAt || '',
    sentAt: item.sentAtLabel || item.sentAt || '',
    block: item.sentBlock || ''
  }));
}

function getAuditStatsV35() {
  const items = getAuditQueueItemsV35();
  return {
    total: items.length,
    enviados: items.filter(i => i.status === 'Enviado').length,
    erros: items.filter(i => i.status === 'Erro').length,
    prontos: items.filter(i => i.status === 'Pronto').length
  };
}

function renderAuditCardsV35() {
  const box = document.getElementById('auditCardsV35');
  if (!box) return;

  const s = getAuditStatsV35();

  box.innerHTML = `
    <div class="audit-v35-card"><div class="audit-v35-label">Total na fila</div><div class="audit-v35-value">${s.total}</div></div>
    <div class="audit-v35-card"><div class="audit-v35-label">Enviados</div><div class="audit-v35-value">${s.enviados}</div></div>
    <div class="audit-v35-card"><div class="audit-v35-label">Erros</div><div class="audit-v35-value">${s.erros}</div></div>
    <div class="audit-v35-card"><div class="audit-v35-label">Prontos</div><div class="audit-v35-value">${s.prontos}</div></div>
  `;
}

function renderAuditListV35() {
  const box = document.getElementById('auditListV35');
  if (!box) return;

  const filter = document.getElementById('auditFilterV35')?.value || 'todos';
  let items = getAuditQueueItemsV35();

  if (filter !== 'todos') {
    items = items.filter(item => item.status === filter);
  }

  if (!items.length) {
    box.innerHTML = '<div class="audit-v35-empty">// nenhum registro encontrado</div>';
    return;
  }

  box.innerHTML = items.map(item => {
    const cls = normalizeStr(item.status || '').replace(/[^a-z0-9]+/g,'');
    return `
      <div class="audit-v35-row">
        <div>
          <div class="audit-v35-title">${escHtml(item.nome)}</div>
          <div class="audit-v35-meta">${escHtml(item.telefone)} · ${escHtml(item.createdAt || '')}</div>
        </div>
        <div class="audit-v35-meta">Campanha<br>${escHtml(item.campaign || '-')}</div>
        <div class="audit-v35-meta">Template<br>${escHtml(item.templateName || '-')}</div>
        <div class="audit-v35-meta">Chip<br>${escHtml(item.chipName || '-')}</div>
        <div>
          <span class="audit-v35-status ${cls}">${escHtml(item.status)}</span>
          ${item.error ? `<div class="audit-v35-meta">${escHtml(item.error)}</div>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function renderAuditV35() {
  renderAuditCardsV35();
  renderAuditListV35();
}

function exportAuditCsvV35() {
  const items = getAuditQueueItemsV35();
  const header = ['Nome','Telefone','Campanha','Template','Chip','Status','Erro','Criado','Enviado','Bloco'];
  const rows = items.map(i => [
    i.nome, i.telefone, i.campaign, i.templateName, i.chipName, i.status, i.error, i.createdAt, i.sentAt, i.block
  ]);

  const csv = [header, ...rows]
    .map(row => row.map(cell => `"${String(cell || '').replace(/"/g,'""')}"`).join(','))
    .join('\n');

  const blob = new Blob([csv], { type:'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `auditoria-disparos-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function updateAuditBadgeV35() {
  const badge = document.getElementById('badge-audit');
  if (!badge) return;
  const s = getAuditStatsV35();
  badge.textContent = s.erros ? `${s.erros}!` : 'LOG';
}


/* ════════════════════════════
   PERSISTÊNCIA SUPABASE V36
════════════════════════════ */
const OPERATIONAL_SUPABASE_TABLE_V36 = 'operational_data';

const OPERATIONAL_DATA_KEYS_V36 = {
  leadCrm: 'vs_lead_crm_v1',
  whatsappQueue: 'vs_whatsapp_queue_v27',
  queueCampaigns: 'vs_queue_campaigns_v27',
  queueTemplates: 'vs_queue_templates_v27',
  whatsappChips: 'vs_whatsapp_chips_v29',
  chipUsage: 'vs_chip_usage_day_v29',
  queueControl: 'vs_whatsapp_queue_control_v28',
  dispatchLogs: 'vs_dispatch_v30_log',
  dispatchRuntime: 'vs_dispatch_runtime_v32',
  evolutionResponses: 'vs_evolution_responses_v34',
  evolutionSettings: 'vs_evolution_settings_v1'
};

function setPersistenceStatusV36(text, type = '') {
  const box = document.getElementById('persistenceV36Status');
  if (!box) return;
  box.classList.remove('ok','warn');
  if (type) box.classList.add(type);
  box.textContent = text;
}

function getOperationalSnapshotV36() {
  const data = {};
  Object.entries(OPERATIONAL_DATA_KEYS_V36).forEach(([name, key]) => {
    try {
      data[name] = JSON.parse(localStorage.getItem(key) || 'null');
    } catch {
      data[name] = localStorage.getItem(key);
    }
  });

  return {
    version: 'v36',
    exportedAt: new Date().toISOString(),
    data
  };
}

function restoreOperationalSnapshotV36(snapshot = {}) {
  const data = snapshot.data || {};
  Object.entries(OPERATIONAL_DATA_KEYS_V36).forEach(([name, key]) => {
    if (data[name] === undefined) return;
    localStorage.setItem(key, JSON.stringify(data[name]));
  });

  if (typeof updateBadges === 'function') updateBadges();
  if (typeof updateWhatsappQueueBadge === 'function') updateWhatsappQueueBadge();
  if (typeof updateChipsBadge === 'function') updateChipsBadge();
  if (typeof updateResponsesBadgeV34 === 'function') updateResponsesBadgeV34();
  if (typeof updateAuditBadgeV35 === 'function') updateAuditBadgeV35();
}

function isSupabaseOperationalReadyV36() {
  return !!(typeof sbClient !== 'undefined' && sbClient && currentUser?.id);
}

async function syncOperationalDataToSupabaseV36() {
  if (!isSupabaseOperationalReadyV36()) {
    setPersistenceStatusV36('Supabase indisponível ou usuário não conectado.', 'warn');
    notify('Entre na conta antes de sincronizar.', 'warn');
    return;
  }

  const snapshot = getOperationalSnapshotV36();

  setPersistenceStatusV36('Enviando dados operacionais para o Supabase...');

  try {
    const payload = {
      user_id: currentUser.id,
      scope: 'crm_operational_v36',
      payload: snapshot,
      updated_at: new Date().toISOString()
    };

    const { error } = await sbClient
      .from(OPERATIONAL_SUPABASE_TABLE_V36)
      .upsert(payload, { onConflict: 'user_id,scope' });

    if (error) throw error;

    setPersistenceStatusV36('Dados operacionais sincronizados com sucesso.', 'ok');
    notify('Dados operacionais enviados ao Supabase.');
  } catch (err) {
    setPersistenceStatusV36(
      'Falha ao sincronizar. Verifique se a tabela operational_data existe.\n\n' +
      'Erro: ' + (err?.message || 'erro desconhecido'),
      'warn'
    );
  }
}

async function loadOperationalDataFromSupabaseV36() {
  if (!isSupabaseOperationalReadyV36()) {
    setPersistenceStatusV36('Supabase indisponível ou usuário não conectado.', 'warn');
    notify('Entre na conta antes de carregar.', 'warn');
    return;
  }

  setPersistenceStatusV36('Carregando dados operacionais do Supabase...');

  try {
    const { data, error } = await sbClient
      .from(OPERATIONAL_SUPABASE_TABLE_V36)
      .select('payload,updated_at')
      .eq('user_id', currentUser.id)
      .eq('scope', 'crm_operational_v36')
      .maybeSingle();

    if (error) throw error;

    if (!data?.payload) {
      setPersistenceStatusV36('Nenhum dado operacional encontrado no Supabase.', 'warn');
      return;
    }

    restoreOperationalSnapshotV36(data.payload);
    setPersistenceStatusV36('Dados carregados do Supabase e aplicados no CRM.', 'ok');
    notify('Dados operacionais carregados.');
  } catch (err) {
    setPersistenceStatusV36(
      'Falha ao carregar. Verifique se a tabela operational_data existe.\n\n' +
      'Erro: ' + (err?.message || 'erro desconhecido'),
      'warn'
    );
  }
}

function showPersistenceSchemaV36() {
  const sql = `
create table if not exists public.operational_data (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  scope text not null,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(user_id, scope)
);

alter table public.operational_data enable row level security;

create policy "operational_data_select_own"
on public.operational_data for select
using (auth.uid() = user_id);

create policy "operational_data_insert_own"
on public.operational_data for insert
with check (auth.uid() = user_id);

create policy "operational_data_update_own"
on public.operational_data for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
`;

  setPersistenceStatusV36(sql, 'warn');
  navigator.clipboard?.writeText(sql);
  notify('SQL das tabelas copiado.');
}

function scheduleOperationalSyncV36() {
  if (!isSupabaseOperationalReadyV36()) return;
  clearTimeout(window.__operationalSyncV36Timer);
  window.__operationalSyncV36Timer = setTimeout(() => {
    syncOperationalDataToSupabaseV36();
  }, 1500);
}


/* ════════════════════════════
   CONVERSAS V38
════════════════════════════ */
let activeConversationLeadV38 = null;

function getAllConversationLeadsV38() {
  const crm = getLeadCrmStore ? getLeadCrmStore() : {};
  const queue = getWhatsappQueueV27 ? getWhatsappQueueV27() : [];
  const responses = getLocalResponsesV34 ? getLocalResponsesV34() : [];
  const map = new Map();

  Object.entries(crm || {}).forEach(([leadId, data]) => {
    const hasMessages = Array.isArray(data.messages) && data.messages.length;
    const hasResponse = !!data.lastResponseAt || data.pipelineStatus === 'respondeu';
    if (hasMessages || hasResponse) {
      const lead = findLeadEverywhere(leadId) || { id: leadId, nome: data.nome || 'Lead' };
      map.set(leadId, { leadId, lead, crm: data });
    }
  });

  responses.forEach(resp => {
    if (!resp.leadId) return;
    const lead = findLeadEverywhere(resp.leadId) || { id: resp.leadId, nome: 'Lead' };
    const crmData = crm[resp.leadId] || {};
    map.set(resp.leadId, { leadId: resp.leadId, lead, crm: crmData });
  });

  queue.forEach(item => {
    if (!item.leadId || item.status !== 'Enviado') return;
    const lead = findLeadEverywhere(item.leadId) || { id: item.leadId, nome: item.nome || 'Lead' };
    const crmData = crm[item.leadId] || {};
    if (crmData.messages?.length || crmData.lastWhatsappMessage || item.sentAt) {
      map.set(item.leadId, { leadId: item.leadId, lead, crm: crmData });
    }
  });

  return Array.from(map.values()).sort((a,b) => {
    const ad = a.crm.lastResponseAt || a.crm.lastWhatsappMessage?.sentAt || '';
    const bd = b.crm.lastResponseAt || b.crm.lastWhatsappMessage?.sentAt || '';
    return String(bd).localeCompare(String(ad));
  });
}

function getConversationMessagesV38(leadId) {
  const crm = ensureLeadCrm(leadId, findLeadEverywhere(leadId) || {});
  const queue = getWhatsappQueueV27 ? getWhatsappQueueV27() : [];
  const messages = [];

  queue.filter(item => item.leadId === leadId && item.status === 'Enviado').forEach(item => {
    messages.push({
      id: item.id,
      direction: 'out',
      text: item.templateText || item.templateName || 'Mensagem enviada',
      at: item.sentAt || item.updatedAt || item.createdAt || '',
      atLabel: item.sentAtLabel || item.createdAtLabel || '',
      chipName: item.chipName || ''
    });
  });

  if (crm.lastWhatsappMessage) {
    messages.push({
      id: 'last_' + leadId,
      direction: 'out',
      text: crm.lastWhatsappMessage.text || '',
      at: crm.lastWhatsappMessage.sentAt || '',
      atLabel: crm.lastWhatsappMessage.sentAtLabel || '',
      chipName: crm.lastWhatsappMessage.chipName || ''
    });
  }

  (crm.messages || []).forEach(msg => messages.push(msg));

  const unique = new Map();
  messages.forEach(m => {
    const key = m.id || `${m.direction}_${m.at}_${m.text}`;
    unique.set(key, m);
  });

  return Array.from(unique.values()).sort((a,b) => String(a.at || '').localeCompare(String(b.at || '')));
}

function renderConversationListV38() {
  const box = document.getElementById('conversationListV38');
  if (!box) return;

  const items = getAllConversationLeadsV38();

  if (!items.length) {
    box.innerHTML = '<div class="conversation-empty-v38">// nenhuma conversa ainda</div>';
    updateConversationsBadgeV38();
    return;
  }

  if (!activeConversationLeadV38) activeConversationLeadV38 = items[0].leadId;

  box.innerHTML = items.map(item => {
    const messages = getConversationMessagesV38(item.leadId);
    const last = messages[messages.length - 1];
    const active = item.leadId === activeConversationLeadV38 ? 'active' : '';
    return `
      <div class="conversation-item-v38 ${active}" onclick="openConversationV38('${escHtml(item.leadId)}')">
        <div class="conversation-item-v38-title">${escHtml(item.lead.nome || item.lead.name || 'Lead')}</div>
        <div class="conversation-item-v38-meta">
          ${escHtml(item.lead.whatsapp || item.lead.phone || item.lead.telefone || '')}<br>
          ${escHtml((last?.text || 'Sem mensagens').slice(0,80))}
        </div>
      </div>
    `;
  }).join('');

  updateConversationsBadgeV38();
}

function openConversationV38(leadId) {
  activeConversationLeadV38 = leadId;
  renderConversationsV38();
}

function renderConversationChatV38() {
  const box = document.getElementById('conversationChatV38');
  if (!box) return;

  if (!activeConversationLeadV38) {
    box.innerHTML = '<div class="conversation-empty-v38">// selecione uma conversa</div>';
    return;
  }

  const lead = findLeadEverywhere(activeConversationLeadV38) || { nome:'Lead' };
  const messages = getConversationMessagesV38(activeConversationLeadV38);
  const phone = normalizePhoneForEvolution(lead.whatsapp || lead.phone || lead.telefone || '');

  box.innerHTML = `
    <div class="conversation-chat-header-v38">
      <div class="conversation-chat-title-v38">${escHtml(lead.nome || lead.name || 'Lead')}</div>
      <div class="conversation-chat-meta-v38">${escHtml(phone || 'sem telefone')}</div>
    </div>

    <div class="conversation-messages-v38">
      ${messages.length ? messages.map(msg => `
        <div class="message-bubble-v38 ${msg.direction === 'out' ? 'out' : 'in'}">
          ${escHtml(msg.text || '[mensagem sem texto]')}
          <div class="message-time-v38">${escHtml(msg.atLabel || (msg.at ? new Date(msg.at).toLocaleString('pt-BR') : ''))}${msg.chipName ? ' · ' + escHtml(msg.chipName) : ''}</div>
        </div>
      `).join('') : '<div class="conversation-empty-v38">// sem mensagens registradas</div>'}
    </div>

    <div class="conversation-reply-v38">
      <textarea id="conversationReplyTextV38" placeholder="Responder este lead..."></textarea>
      <button class="btn btn-primary" onclick="sendConversationReplyV38()">Responder</button>
    </div>
  `;
}

async function sendConversationReplyV38() {
  if (!activeConversationLeadV38) return;

  const lead = findLeadEverywhere(activeConversationLeadV38) || {};
  const text = (document.getElementById('conversationReplyTextV38')?.value || '').trim();
  const phone = normalizePhoneForEvolution(lead.whatsapp || lead.phone || lead.telefone || '');
  const settings = getEvolutionSettings ? getEvolutionSettings() : {};

  if (!text) {
    notify('Digite uma resposta.', 'warn');
    return;
  }

  if (!phone) {
    notify('Lead sem telefone.', 'warn');
    return;
  }

  if (!settings.url || !settings.apiKey) {
    notify('Configure a Evolution antes de responder.', 'warn');
    return;
  }

  const queue = getWhatsappQueueV27 ? getWhatsappQueueV27() : [];
  const lastSent = queue.filter(item => item.leadId === activeConversationLeadV38 && item.chipInstance).slice(-1)[0];
  const instance = lastSent?.chipInstance || settings.instance;

  if (!instance) {
    notify('Instância não encontrada para resposta.', 'warn');
    return;
  }

  try {
    const endpoint = `${settings.url}/message/sendText/${encodeURIComponent(instance)}`;
    const res = await fetch(endpoint, {
      method:'POST',
      headers:(typeof getEvolutionHeadersV405 === 'function' ? getEvolutionHeadersV405(settings) : getEvolutionHeaders(settings)),
      body:JSON.stringify({ number: phone, text })
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) throw new Error(data?.message || data?.error || `HTTP ${res.status}`);

    const crm = ensureLeadCrm(activeConversationLeadV38, lead);
    crm.messages = Array.isArray(crm.messages) ? crm.messages : [];
    crm.messages.push({
      id:'reply_' + Date.now(),
      direction:'out',
      text,
      phone,
      at:new Date().toISOString(),
      atLabel:crmNowLabel(),
      chipName:lastSent?.chipName || instance,
      response:data
    });
    saveLeadCrm(activeConversationLeadV38, crm);
    addLeadHistory(activeConversationLeadV38, `Resposta enviada pela Central de Conversas`, lead);

    renderConversationsV38();
    notify('Resposta enviada.');
  } catch (err) {
    notify('Erro ao responder: ' + (err?.message || 'falha'), 'err');
  }
}

function renderConversationsV38() {
  renderConversationListV38();
  renderConversationChatV38();
}

function updateConversationsBadgeV38() {
  const badge = document.getElementById('badge-conversations');
  if (!badge) return;
  badge.textContent = getAllConversationLeadsV38().length;
}


/* ════════════════════════════
   EVOLUTION CHIP MODEL V40.5
   Compatível com sistema antigo: chip.url + chip.instance + chip.key
════════════════════════════ */
function normalizeEvolutionBaseUrlV405(url = '') {
  return String(url || '').trim().replace(/\/$/, '');
}

function getPrimaryEvolutionChipV405() {
  const chips = typeof getWhatsappChipsV29 === 'function' ? getWhatsappChipsV29() : [];
  return chips.find(chip => chip.status !== 'disabled' && !chip.paused) || chips[0] || null;
}

function getEvolutionConfigForChipV405(chip = null) {
  const global = typeof getEvolutionSettings === 'function' ? getEvolutionSettings() : {};
  const selected = chip || getPrimaryEvolutionChipV405() || {};

  return {
    url: normalizeEvolutionBaseUrlV405(selected.url || selected.baseUrl || selected.evolutionUrl || global.url || ''),
    instance: selected.instance || selected.instanceName || selected.chipInstance || global.instance || '',
    apiKey: selected.key || selected.apiKey || selected.apikey || global.apiKey || '',
    chip: selected
  };
}

function getEvolutionHeadersV405(config = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const key = config.apiKey || config.key || config.apikey || '';
  if (key) headers.apikey = key;
  return headers;
}

function isValidEvolutionConfigV405(config = {}) {
  return !!(config.url && config.instance && config.apiKey);
}

/* ════════════════════════════
   DEFAULT RAMOS
════════════════════════════ */
const RAMOS_DEFAULT = [
  {
    id: 'marcenaria',
    nome: 'Marcenaria / Móveis',
    keywords: ['marcenaria','marceneiro','moveis planejados','móveis planejados',
      'movelaria','móveis sob medida','moveis sob medida','carpintaria',
      'armarios planejados','armários planejados','cozinhas planejadas',
      'dormitórios planejados','dormitorios planejados','móveis','moveis']
  }
];

/* ════════════════════════════
   DEFAULT MSG TEMPLATES
════════════════════════════ */
const TEMPLATES_DEFAULT = [
  `Olá, me chamo Samuel. Tudo bem?\n\nVi o site da {EMPRESA} e acredito que ele pode estar afastando clientes sem vocês perceberem. Muitos sites não foram pensados pra converter e acabam não transmitindo a credibilidade que a empresa realmente tem.\n\nTrabalho desenvolvendo sites personalizados para empresas que querem ser vistas de forma profissional e atrair mais clientes no digital.\n\nFaz sentido conversarmos?`,
  `Olá, me chamo Samuel. Tudo bem?\n\nPassei pelo site da {EMPRESA} e sinto que ele não está representando bem o que vocês entregam. O cliente decide pela confiança, e essa confiança começa pelo digital.\n\nTrabalho criando sites personalizados para empresas que querem se destacar e converter mais visitantes em clientes.\n\nFaz sentido pra vocês?`,
  `Olá, me chamo Samuel. Tudo bem?\n\nVi o site da {EMPRESA} e acredito que ele pode estar passando uma imagem mais genérica do que a empresa merece. Muitos clientes em potencial descartam pelo que veem online antes mesmo de entrar em contato.\n\nDesenvolvo sites personalizados para empresas que querem ser levadas a sério no digital.\n\nFaz sentido conversarmos?`,
];

/* ════════════════════════════
   TEMPLATES POR RAMO E TIPO
════════════════════════════ */
const RAMO_TEMPLATES_DEFAULT = {
  marcenaria: {
    'com-site': [
      `Olá, me chamo Samuel. Tudo bem?\n\nVi o site da {EMPRESA} e acredito que ele pode estar deixando clientes na dúvida em vez de convencê-los a entrar em contato. Para móveis planejados, o site precisa vender visualmente antes de qualquer conversa.\n\nTrabalho desenvolvendo sites para marcenarias e móveis planejados que querem mostrar seu trabalho com mais impacto.\n\nFaz sentido conversarmos?`,
      `Olá, me chamo Samuel. Tudo bem?\n\nPassei pelo site da {EMPRESA} e percebi que o site pode não estar fazendo jus à qualidade do trabalho de vocês. No ramo de móveis planejados, a apresentação visual é tudo.\n\nCrio sites que mostram projetos de forma impressionante e convertem visitantes em orçamentos.\n\nFaz sentido pra vocês?`,
      `Olá! Sou o Samuel.\n\nVi o site da {EMPRESA} e acho que ele pode estar perdendo clientes por não mostrar seu portfólio da melhor forma possível. Clientes de móveis planejados decidem pela beleza e confiança que veem online.\n\nDesenvolvo sites que destacam projetos e geram mais orçamentos para marcenarias.\n\nFaz sentido conversarmos?`,
      `Oi! Me chamo Samuel.\n\nDei uma olhada no site da {EMPRESA} e acredito que ele pode ser muito mais poderoso para atrair clientes. Sites de marcenaria precisam fazer o cliente visualizar o sonho antes mesmo de pedir um orçamento.\n\nEspecializo-me em sites para móveis planejados e marcenarias que querem crescer.\n\nPodemos conversar?`,
      `Olá, sou o Samuel!\n\nAnalisei o site da {EMPRESA} e vejo oportunidade de destacar melhor os projetos e a qualidade do trabalho de vocês. No mercado de móveis planejados, o site é a vitrine mais importante.\n\nTrabalho com sites que mostram portfólios de forma que geram desejo e mais pedidos de orçamento.\n\nFaz sentido uma conversa rápida?`,
      `Olá! Me chamo Samuel.\n\nVi o site da {EMPRESA} e acredito que ele pode estar passando uma impressão mais simples do que o trabalho de vocês merece. Cada projeto entregue por vocês merece ser mostrado de forma impactante.\n\nDesenvolvo sites para marcenarias que transformam portfólio em clientes.\n\nFaz sentido conversarmos?`,
      `Oi, sou o Samuel!\n\nPassei pelo site da {EMPRESA} e acredito que existe muito espaço para melhorar como vocês se apresentam online. O cliente de móveis planejados pesquisa muito antes de decidir — o site precisa ser perfeito.\n\nCrio sites para marcenarias e móveis planejados que geram mais orçamentos e fechamentos.\n\nFaz sentido?`,
      `Olá! Sou o Samuel.\n\nAnalisei o site da {EMPRESA} e percebi que ele pode estar deixando clientes irem para a concorrência por não transmitir confiança suficiente. Sites de marcenaria precisam mostrar qualidade antes de qualquer conversa.\n\nTrabalho com sites que posicionam marcenarias como referência em suas regiões.\n\nFaz sentido conversarmos?`,
      `Olá, me chamo Samuel. Tudo bem?\n\nVi o site da {EMPRESA} e acredito que vocês merecem uma vitrine digital muito melhor. No ramo de móveis planejados, o site é muitas vezes o primeiro contato que o cliente tem com o trabalho de vocês.\n\nDesenvolvo sites que mostram projetos com a qualidade que eles merecem.\n\nFaz sentido conversar?`,
      `Olá! Me chamo Samuel.\n\nPassei pelo site da {EMPRESA} e sinto que o potencial de vocês não está sendo totalmente comunicado online. Clientes de móveis planejados decidem com os olhos — o site precisa impressionar.\n\nCrio sites personalizados para marcenarias que querem crescer e se destacar.\n\nFaz sentido conversarmos?`,
    ],
    'sem-site': [
      `Olá, me chamo Samuel. Tudo bem?\n\nEncontrei a {EMPRESA} mas percebi que vocês ainda não têm um site. No ramo de móveis planejados, clientes pesquisam muito antes de decidir — sem um site com portfólio, vocês ficam de fora dessa pesquisa.\n\nTrabalho criando sites para marcenarias que querem mostrar seus projetos e atrair mais clientes.\n\nFaz sentido conversarmos?`,
      `Olá! Sou o Samuel.\n\nVi a {EMPRESA} e não encontrei um site de vocês. Para quem trabalha com móveis planejados, um site com portfólio é a diferença entre ser escolhido ou ser ignorado pelo cliente que pesquisa online.\n\nDesenvolvo sites para marcenarias. O site vira um vendedor 24h por dia.\n\nFaz sentido uma conversa?`,
      `Oi, me chamo Samuel!\n\nEncontrei a {EMPRESA} e percebi que vocês ainda não têm uma presença digital própria. No mercado de móveis planejados, quem não aparece online perde para quem aparece.\n\nCrio sites para marcenarias que querem crescer digitalmente. Posso te mostrar exemplos?\n\nFaz sentido?`,
    ],
  },
};

function getRamoTemplatesDefault(ramoId, tipo) {
  if (RAMO_TEMPLATES_DEFAULT[ramoId] && RAMO_TEMPLATES_DEFAULT[ramoId][tipo]) {
    return RAMO_TEMPLATES_DEFAULT[ramoId][tipo];
  }
  return tipo === 'com-site' ? TEMPLATES_DEFAULT : TEMPLATES_DEFAULT.slice(0, 3);
}

function getRamoTemplates() {
  try { return JSON.parse(localStorage.getItem(TEMPLATES_RAMO_KEY)||'null') || {}; } catch { return {}; }
}
function saveRamoTemplates(obj) { localStorage.setItem(TEMPLATES_RAMO_KEY, JSON.stringify(obj)); }

function getTemplatesForRamoTipo(ramoId, tipo) {
  const all = getRamoTemplates();
  const key = `${ramoId}__${tipo}`;
  if (all[key] && all[key].length > 0) return all[key];
  return getRamoTemplatesDefault(ramoId, tipo);
}

function saveRamoTemplate(ramoId, tipo, idx, val) {
  const all = getRamoTemplates();
  const key = `${ramoId}__${tipo}`;
  if (!all[key]) all[key] = [...getRamoTemplatesDefault(ramoId, tipo)];
  all[key][idx] = val;
  saveRamoTemplates(all);
}

function adicionarRamoTemplate(ramoId, tipo) {
  const all = getRamoTemplates();
  const key = `${ramoId}__${tipo}`;
  if (!all[key]) all[key] = [...getRamoTemplatesDefault(ramoId, tipo)];
  const maxTpl = tipo === 'sem-site' ? 3 : 10;
  if (all[key].length >= maxTpl) { notify(`// máximo de ${maxTpl} templates para ${tipo}`,'warn'); return; }
  all[key].push(`Olá, me chamo Samuel. Tudo bem?\n\nVi ${tipo==='com-site'?'o site d':''}a {EMPRESA}...\n\nFaz sentido conversarmos?`);
  saveRamoTemplates(all);
  renderTemplatesConfig();
}

function removerRamoTemplate(ramoId, tipo, idx) {
  const all = getRamoTemplates();
  const key = `${ramoId}__${tipo}`;
  if (!all[key]) all[key] = [...getRamoTemplatesDefault(ramoId, tipo)];
  if (all[key].length <= 1) { notify('// precisa ter ao menos 1 template','warn'); return; }
  all[key].splice(idx, 1);
  saveRamoTemplates(all);
  renderTemplatesConfig();
}

const LINK_BICHOP = 'https://samuelvinsansi.com.br';

/* ════════════════════════════
   STATE
════════════════════════════ */
let selectedDay      = todayStr();
let selectedStatus   = 'Não enviada';
let importTargetDay  = todayStr();

/* ── paginação ── */
let inicioPage     = 1; let INICIO_PG    = 20;
let importPage     = 1; let IMPORT_PG    = 20;
let valPage        = 1; let VAL_PG       = 20;
let atribPage      = 1; let ATRIB_PG     = 20;
let disparoPage    = 1; let DISPARO_PG   = 20;
let disparoDay       = todayStr();
let disparoStatus    = 'Não enviada';
let msgEmpresaId     = null;
let msgTemplateIdx   = -1;
let historyOpen      = false;
let filaDisparo      = (() => { try { return JSON.parse(localStorage.getItem('vs_fila_disparo_v1')||'null') || {}; } catch { return {}; } })(); // { chipId: [...items] }
let disparoEmAndamento = false;
let aguardandoLote   = false;
let filaLotes = [], loteAtual = 0, lotesTotal = 0;
let loteEsperaTimer = null, loteEsperaFim = null, loteCountdownInt = null;
let activeChipId     = null;
let valTab           = 'com-site';
let instaStatus      = 'pendente';
let horarioCheckInt  = null;
let qrChipIdAtivo    = null;
let qrPollInt        = null;
let disparoChipId    = null;
let tplRamoId        = null;
let tplTipo          = 'com-site';

/* ════════════════════════════
   DATE HELPERS
════════════════════════════ */
function todayStr() { return new Date().toLocaleDateString('pt-BR'); }
function timeStr()  { return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); }
function getWeekStart(d) { const dt = d ? new Date(d) : new Date(); dt.setHours(0,0,0,0); dt.setDate(dt.getDate() - dt.getDay()); return dt; }
function currentWeekStartStr() { return getWeekStart().toLocaleDateString('pt-BR'); }
function currentWeekDays() {
  const days = [], start = getWeekStart();
  for (let i = 0; i <= 6; i++) { const d = new Date(start); d.setDate(start.getDate() + i); days.push(d.toLocaleDateString('pt-BR')); }
  return days; // dom a sáb
}
function dayLabel(dateStr) {
  const [d, m, y] = dateStr.split('/').map(Number);
  const dt = new Date(y, m - 1, d);
  const mm = m < 10 ? '0' + m : String(m);
  return WEEKDAY_NAMES[dt.getDay()] + ' ' + d + '/' + mm;
}
function dayLabelShort(dateStr) {
  const [d, m, y] = dateStr.split('/').map(Number);
  const dt = new Date(y, m - 1, d);
  return WEEKDAY_NAMES[dt.getDay()] + ' ' + d + '/' + (m < 10 ? '0'+m : m);
}
function nextWeekday(dateStr) {
  const [d, m, y] = dateStr.split('/').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + 1);
  if (dt.getDay() === 0) dt.setDate(dt.getDate() + 1); // pula domingo
  return dt.toLocaleDateString('pt-BR');
}

function updateClock(){
  const clockEl =
    document.getElementById('clock') ||
    document.getElementById('sidebarClock') ||
    document.querySelector('[data-time]');

  const dateEl =
    document.getElementById('date') ||
    document.getElementById('sidebarDate') ||
    document.querySelector('[data-date]');

  const now = new Date();

  if (clockEl) {
    if (clockEl) clockEl.textContent = now.toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  if (dateEl) {
    if (dateEl) dateEl.textContent = now.toLocaleDateString('pt-BR', {
      weekday: 'long',
      day: '2-digit',
      month: 'short'
    });
  }
}
setInterval(updateClock, 1000); updateClock();

/* ════════════════════════════
   UTILS
════════════════════════════ */
function genId()    { return Date.now().toString(36) + Math.random().toString(36).slice(2,8); }
function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function normalizePhone(raw) { if (!raw) return ''; return raw.replace(/\D/g,''); }
function buildWaLink(raw) { if (!raw) return ''; const n = normalizePhone(raw); if (!n) return ''; return 'https://wa.me/' + (n.startsWith('55') ? n : '55' + n); }
function normalizeStr(s) { return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim(); }

function capitalizeName(raw) {
  if (!raw) return '';
  const lower = ['de','da','do','das','dos','e','em','na','no','nas','nos','a','o','as','os'];
  return raw.toLowerCase().replace(/\b\w+/g, (word, offset) => {
    if (offset > 0 && lower.includes(word)) return word;
    return word.charAt(0).toUpperCase() + word.slice(1);
  });
}

function getTemplates() {
  try { return JSON.parse(localStorage.getItem(TEMPLATES_KEY) || 'null') || TEMPLATES_DEFAULT; } catch { return TEMPLATES_DEFAULT; }
}
function saveTemplates(t) { localStorage.setItem(TEMPLATES_KEY, JSON.stringify(t)); }

function pickTemplate(nome, ramoId) {
  const tpl = ramoId ? getTemplatesForRamoTipo(ramoId, 'com-site') : getTemplates();
  if (!tpl || !tpl.length) return { text: '', idx: 0 };
  const idx = Math.floor(Math.random() * tpl.length);
  return { text: tpl[idx].replace(/\{EMPRESA\}/g, nome).replace(/\[EMPRESA\]/g, nome), idx };
}
function pickOtherTemplate(nome, cur, ramoId) {
  const tpl = ramoId ? getTemplatesForRamoTipo(ramoId, 'com-site') : getTemplates();
  if (!tpl || !tpl.length) return { text: '', idx: 0 };
  let idx; do { idx = Math.floor(Math.random() * tpl.length); } while (idx === cur && tpl.length > 1);
  return { text: tpl[idx].replace(/\{EMPRESA\}/g, nome).replace(/\[EMPRESA\]/g, nome), idx };
}

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
  const leads = getAtribuicaoData();
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

  ids.forEach(id => {
    const lead = atrib.find(a => a.id === id);
    if (!lead) return;

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
      status: 'Não enviada', criadoEm: lead.criadoEm || todayStr(),
    });
    addLeadHistory(lead.id, `Atribuído para ${dayLabel(diaFinal)}`, lead);
    atribuidos++;
  });

  saveWeekData(data);
  const novaAtrib = atrib.filter(a => !ids.includes(a.id));
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
function getZapBacklog()   { try { return JSON.parse(localStorage.getItem(ZAP_BACKLOG_KEY)||'[]'); } catch { return []; } }
function saveZapBacklog(d) { localStorage.setItem(ZAP_BACKLOG_KEY, JSON.stringify(d)); }

function mandarParaBacklogZap(id) {
  const atrib = getAtribuicaoData();
  const lead  = atrib.find(a => a.id === id);
  if (!lead) return;

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
  const phone = (document.getElementById('manualLeadPhone')?.value || '').trim();
  const googleUrl = (document.getElementById('manualLeadGoogleUrl')?.value || '').trim();
  const instagram = (document.getElementById('manualLeadInsta')?.value || '').trim();
  const lead = {
    id: 'manual_' + Date.now(),
    nome, whatsapp: phone ? normalizePhone(phone) : '',
    googleUrl, instagram,
    site: '', ramoId: null,
    canal: phone ? 'zap' : 'insta',
    criadoEm: todayStr(),
  };
  const atrib = getAtribuicaoData();
  atrib.push(lead);
  saveAtribuicaoData(atrib);
  // Limpa os campos
  ['manualLeadNome','manualLeadPhone','manualLeadGoogleUrl','manualLeadInsta'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const resultEl = document.getElementById('manualValResult');
  if (resultEl) resultEl.style.display = 'none';
  renderAtribuicao(); updateBadges();
  notify(`✓ ${nome} → Atribuição`);
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
const PANELS = ['audit','conversations','responses','chips','inicio','importar','validacao','atribuicao','instagram','fila-zap','kanban','followups','acompanhamento','redirecionamentos','configuracoes'];
function switchPanel(name) {
  PANELS.forEach(p => {
    const el = document.getElementById('panel-'+p);
    if (el) el.classList.toggle('active', p===name);
  });
  document.querySelectorAll('.nav-item').forEach(el => {
    const label = el.getAttribute('data-label') || '';
    const panelMap = {'Início':'inicio','Importar':'importar','Validação':'validacao','Atribuição':'atribuicao','Instagram':'instagram','Fila WhatsApp':'fila-zap','Follow-ups':'followups','Acompanhamento':'acompanhamento','Redirecionamentos':'redirecionamentos','Configurações':'configuracoes'};
    el.classList.toggle('active', panelMap[label] === name);
  });
  if (name==='inicio')         renderInicio();
  if (name==='importar')       renderImportarPanel();
  if (name==='validacao')      renderValidacao();
  if (name==='atribuicao')     { renderAtribuicao(); updateAtribTabCounts(); if (atribActiveTab==='insta') { renderAtribInstaFila(); updateAtribInstaCorteInfo(); } }
  if (name==='instagram')      renderInstagram();
  if (name==='fila-zap')       renderFilaZap();
  if (name==='kanban')         renderKanban();
  if (name==='followups')      renderFollowups();
  if (name==='acompanhamento') renderAcompanhamento();
  if (name==='configuracoes')  renderConfiguracoes();
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
function scheduleSupabaseLeadSync() {
  if (!isSupabaseReady()) return;
  clearTimeout(_supabaseLeadSyncTimer);
  _supabaseLeadSyncTimer = setTimeout(() => {
    syncAllLocalLeadsToSupabase();
  }, 800);
}

/* ════════════════════════════
   STORAGE — EMPRESAS
════════════════════════════ */
function getWeekData()  { try { return JSON.parse(localStorage.getItem(EMPRESAS_KEY)||'null'); } catch { return null; } }
function saveWeekData(d){ localStorage.setItem(EMPRESAS_KEY, JSON.stringify(d)); scheduleSupabaseLeadSync(); }
function ensureWeekData() {
  let d = getWeekData(); const ws = currentWeekStartStr();
  if (!d || d.weekStart !== ws) {
    // Virada de semana detectada
    if (d && Object.values(d.days||{}).flat().length > 0) {
      const flat = Object.values(d.days).flat();

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
  return d;
}
function getHistoryData() { try { return JSON.parse(localStorage.getItem(HISTORY_KEY)||'null'); } catch { return null; } }

/* ════════════════════════════
   STORAGE — ACOMPANHAMENTO MENSAL
════════════════════════════ */
function getAcompData()  { try { return JSON.parse(localStorage.getItem(ACOMP_KEY)||'{}'); } catch { return {}; } }
function saveAcompData(d){ localStorage.setItem(ACOMP_KEY, JSON.stringify(d)); }
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
function getValData()  { try { return JSON.parse(localStorage.getItem(VAL_KEY)||'[]'); } catch { return []; } }
function saveValData(d){ localStorage.setItem(VAL_KEY, JSON.stringify(d)); }

/* ════════════════════════════
   STORAGE — BASE DE ATRIBUIÇÃO
════════════════════════════ */
function getAtribuicaoData()  { try { return JSON.parse(localStorage.getItem(ATRIBUICAO_KEY)||'[]'); } catch { return []; } }
function saveAtribuicaoData(d){ localStorage.setItem(ATRIBUICAO_KEY, JSON.stringify(d)); }


function getInstaFila()  { try { return JSON.parse(localStorage.getItem(INSTA_KEY)||'[]'); } catch { return []; } }
function saveInstaFila(d){ localStorage.setItem(INSTA_KEY, JSON.stringify(d)); }

/* ════════════════════════════
   STORAGE — INSTA CRONOGRAMA
════════════════════════════ */
function getInstaSched()  { try { return JSON.parse(localStorage.getItem(INSTA_SCHED_KEY)||'{}'); } catch { return {}; } }
function saveInstaSched(d){ localStorage.setItem(INSTA_SCHED_KEY, JSON.stringify(d)); }

/* ════════════════════════════
   STORAGE — CHIPS
════════════════════════════ */
function getChips()  { try { return JSON.parse(localStorage.getItem(CHIPS_KEY)||'[]'); } catch { return []; } }
function saveChips(c){ localStorage.setItem(CHIPS_KEY, JSON.stringify(c)); }
function getChipById(id) { return getChips().find(c => c.id === id); }

/* ════════════════════════════
   STORAGE — RAMOS
════════════════════════════ */
function getRamos()  { try { return JSON.parse(localStorage.getItem(RAMOS_KEY)||'null') || RAMOS_DEFAULT; } catch { return RAMOS_DEFAULT; } }
function saveRamos(r){ localStorage.setItem(RAMOS_KEY, JSON.stringify(r)); }

/* ════════════════════════════
   EXCLUDED DOMAINS
════════════════════════════ */
function getExcludedDomains() { try { return JSON.parse(localStorage.getItem(EXCLUDED_KEY)||'[]'); } catch { return []; } }
function saveExcludedDomains(arr) { localStorage.setItem(EXCLUDED_KEY, JSON.stringify(arr)); }
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

/* ════════════════════════════
   EXTRACT HELPERS
════════════════════════════ */
function extractSite(item) { return String(item.website || item.url || item.site || '').trim(); }
function extractPhone(item) { return String(item.phone || item.whatsapp || item.phoneNumber || item.telefone || '').trim(); }
function extractName(item)  { return capitalizeName(String(item.title || item.name || item.nome || '').trim()); }
function extractInstagram(item) {
  const ig = String(item.instagram || item.instagramUrl || item.instagram_url || '').trim();
  if (ig) return ig;
  const socials = item.socialMedia || item.profiles || item.social || [];
  if (Array.isArray(socials)) {
    const found = socials.find(s => {
      const url = String(s.url || s.link || s.href || '').toLowerCase();
      return url.includes('instagram.com');
    });
    if (found) return String(found.url || found.link || found.href || '').trim();
  }
  return '';
}
function extractCategory(item) {
  return String(item.categoryName || item.category || item.categoria || item.type || '').trim();
}
function extractGoogleUrl(item) {
  return String(item.url || item.googleUrl || item.google_url || item.maps_url || item.link || '').trim();
}
function hasValidSiteRaw(item) {
  const site = String(item.website || item.url || item.site || '').trim();
  return site.startsWith('http') && site.length > 8;
}
function hasValidPhone(item) {
  return normalizePhone(extractPhone(item)).length >= 10;
}

/* ════════════════════════════
   RAMO FILTER
════════════════════════════ */
let activeRamoId = null;

function getRamoKeywords() {
  if (!activeRamoId) return null;
  const ramo = getRamos().find(r => r.id === activeRamoId);
  return ramo ? ramo.keywords : null;
}

function isRamoMatch(item) {
  const kws = getRamoKeywords();
  if (!kws) return true; // sem ramo selecionado: passa tudo
  const cat = normalizeStr(extractCategory(item));
  return kws.some(kw => cat.includes(normalizeStr(kw)));
}

function onRamoChange() {
  activeRamoId = document.getElementById('ramoSelect').value || null;
  const ramo = activeRamoId ? getRamos().find(r => r.id === activeRamoId) : null;
  const wrap = document.getElementById('subRamosWrap');
  const list = document.getElementById('subRamosList');
  if (ramo) {
    wrap.style.display = 'block';
    list.innerHTML = ramo.keywords.map(k =>
      `<span style="background:var(--accent-dim);border:1px solid var(--accent-border);color:var(--accent);font-family:'DM Mono',monospace;font-size:8px;padding:2px 8px;border-radius:100px">${escHtml(k)}</span>`
    ).join('');
  } else {
    wrap.style.display = 'none';
    list.innerHTML = '';
  }
  importPreview();
}

function renderRamoSelect() {
  const sel = document.getElementById('ramoSelect');
  const ramos = getRamos();
  sel.innerHTML = '<option value="">Selecionar ramo...</option>' +
    ramos.map(r => `<option value="${r.id}"${activeRamoId===r.id?' selected':''}>${escHtml(r.nome)}</option>`).join('');
}

/* ════════════════════════════
   INÍCIO — RENDER
════════════════════════════ */
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
    tbody.innerHTML = `${renderCommercialDashboard()}<tr><td colspan="7" class="table-empty">${inicioBuscaQ ? `Nenhum resultado para "${inicioBuscaEl.value}"` : `Nenhuma empresa com status "${selectedStatus}" neste dia`}</td></tr>`;
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
  renderExcluidos();
  renderFollowUpsHome();
}

function setDay(day)    { selectedDay = day; selectedStatus = 'Não enviada'; inicioPage = 1; const b=document.getElementById('inicioBusca'); if(b) b.value=''; renderInicio(); }
function setStatus(st)  { selectedStatus = st; inicioPage = 1; const b=document.getElementById('inicioBusca'); if(b) b.value=''; renderInicio(); }

/* ════════════════════════════
   PAGINAÇÃO — HELPERS
════════════════════════════ */
function buildPageNumbers(cur, total) {
  if (total <= 7) return Array.from({length:total},(_,i)=>i+1);
  const pages=[], delta=2;
  const left=Math.max(2,cur-delta), right=Math.min(total-1,cur+delta);
  pages.push(1);
  if (left>2) pages.push('…');
  for(let i=left;i<=right;i++) pages.push(i);
  if(right<total-1) pages.push('…');
  pages.push(total);
  return pages;
}
function renderPagination(containerId, cur, total, totalItems, pgSize, onPage, onSize, anchor) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (totalItems === 0) { el.innerHTML=''; return; }
  const start = (cur-1)*pgSize+1;
  const end   = Math.min(cur*pgSize, totalItems);
  const pgNums = buildPageNumbers(cur, total);
  el.innerHTML = `<div class="pagination-bar">
    <div class="pagination-info">Exibindo <strong>${start}–${end}</strong> de <strong>${totalItems}</strong></div>
    <div class="pagination-controls">
      <button class="pg-btn" onclick="${onPage}(${cur-1})" ${cur===1?'disabled':''}>‹</button>
      ${pgNums.map(p=>p==='…'?`<span class="pg-ellipsis">…</span>`:`<button class="pg-btn${p===cur?' active':''}" onclick="${onPage}(${p})">${p}</button>`).join('')}
      <button class="pg-btn" onclick="${onPage}(${cur+1})" ${cur===total?'disabled':''}>›</button>
    </div>
    <select class="pg-size-select" onchange="${onSize}(+this.value)" title="Itens por página">
      ${[10,20,50,100].map(n=>`<option value="${n}"${pgSize===n?' selected':''}>${n}/pág</option>`).join('')}
    </select>
  </div>`;
}

/* goPage functions per panel */
function goInicioPage(p)   { inicioPage=p;  renderInicio(); }
function changeInicioPgSize(n){ INICIO_PG=n; inicioPage=1; renderInicio(); }
function goImportPage(p)   { importPage=p;  importPreview(); }
function changeImportPgSize(n){ IMPORT_PG=n; importPage=1; importPreview(); }
function goValPage(p)      { valPage=p;     renderValidacao(); }
function changeValPgSize(n){ VAL_PG=n; valPage=1; renderValidacao(); }
function goAtribPage(p)    { atribPage=p;   renderAtribuicao(); }
function changeAtribPgSize(n){ ATRIB_PG=n; atribPage=1; renderAtribuicao(); }
function goDisparoPage(p)  { disparoPage=p; renderDisparoEmpresas(); }
function changeDisparoPgSize(n){ DISPARO_PG=n; disparoPage=1; renderDisparoEmpresas(); }

function showMsg(id, day) {
  const data = ensureWeekData();
  const emp  = (data.days[day]||[]).find(e => e.id === id);
  if (!emp) return;
  msgEmpresaId = id;
  const { text, idx } = pickTemplate(emp.nome, emp.ramoId || null);
  document.getElementById('msgPanelEmpresa').innerHTML = `empresa: <span>${escHtml(emp.nome)}</span>`;
  document.getElementById('msgBody').textContent = text;
  document.getElementById('msgCopyBtn').disabled = false;
  document.getElementById('msgModal').classList.add('open');
}
function fecharMsgModal() {
  document.getElementById('msgModal').classList.remove('open');
}
function copyMsg() {
  const text = document.getElementById('msgBody').textContent;
  navigator.clipboard.writeText(text).then(() => notify('✓ Mensagem copiada'));
}
function shuffleMsg() {
  if (!msgEmpresaId) return;
  const data = ensureWeekData();
  const emp  = Object.values(data.days).flat().find(e => e.id === msgEmpresaId);
  if (!emp) return;
  const { text, idx } = pickOtherTemplate(emp.nome, msgTemplateIdx, emp.ramoId || null);
  msgTemplateIdx = idx;
  document.getElementById('msgBody').textContent = text;
}
// Opções de status disponíveis dependendo do status atual
const STATUS_FORWARD_ONLY = ['Respondida','Não respondida','Recusada','Fechada'];
function getStatusOptions(currentStatus) {
  if (currentStatus === 'Enviada' || STATUS_FORWARD_ONLY.includes(currentStatus)) {
    // Não pode voltar — só status à frente + o atual
    return ['Enviada', ...STATUS_FORWARD_ONLY];
  }
  return STATUS_OPTIONS;
}

function updateStatus(id, day, status) {
  const data = ensureWeekData();
  const emp  = (data.days[day]||[]).find(e => e.id === id);
  if (!emp) return;
  // Bloquear retroação a partir de Enviada
  const curr = emp.status || 'Não enviada';
  const lockedForward = curr === 'Enviada' || STATUS_FORWARD_ONLY.includes(curr);
  if (lockedForward && !STATUS_FORWARD_ONLY.includes(status) && status !== 'Enviada') {
    notify('// não é possível retroceder após Enviada','warn');
    return;
  }
  emp.status = status;
  if (status === 'Enviada') emp.enviadoEm = todayStr();
  saveWeekData(data);
  updateBadges();
  renderInicio(); // re-render para atualizar o select corretamente
}
function editWhatsapp(id, day) {
  const data = ensureWeekData();
  const emp  = (data.days[day]||[]).find(e => e.id === id);
  if (!emp) return;
  const currentNum = emp.whatsapp || '';
  const allRows = document.querySelectorAll('#inicioTbody tr');
  let targetCell = null;
  allRows.forEach(row => {
    const delBtn = row.querySelector('.del-btn');
    if (delBtn && delBtn.getAttribute('onclick') && delBtn.getAttribute('onclick').includes(`'${id}'`)) targetCell = row.cells[3];
  });
  if (!targetCell) return;
  targetCell.innerHTML = `<div style="display:flex;align-items:center;gap:5px">
    <input id="waInput_${id}" type="text" value="${escHtml(currentNum)}" placeholder="ex: 11999999999"
      style="background:var(--bg);border:1px solid var(--accent);border-radius:6px;color:var(--text);font-family:'DM Mono',monospace;font-size:10px;padding:4px 8px;width:130px;outline:none"
      onkeydown="if(event.key==='Enter')saveWhatsapp('${id}','${day}');if(event.key==='Escape')renderInicio();"/>
    <button onclick="saveWhatsapp('${id}','${day}')" style="background:var(--accent);border:none;color:#0a0a0d;border-radius:5px;font-size:10px;padding:4px 8px;cursor:pointer;font-weight:700">✓</button>
    <button onclick="renderInicio()" style="background:none;border:1px solid var(--border2);color:var(--muted);border-radius:5px;font-size:10px;padding:4px 8px;cursor:pointer">✕</button>
  </div>`;
  document.getElementById(`waInput_${id}`).focus();
}
function saveWhatsapp(id, day) {
  const input = document.getElementById(`waInput_${id}`);
  if (!input) return;
  const raw = input.value.trim();
  const data = ensureWeekData();
  const emp  = (data.days[day]||[]).find(e => e.id === id);
  if (!emp) return;
  emp.whatsapp = raw;
  saveWeekData(data); updateBadges(); renderInicio();
  notify(raw ? '✓ Número atualizado' : '✓ Número removido');
}
function deleteEmpresa(id, day) {
  const data = ensureWeekData();
  const emp = (data.days[day]||[]).find(e => e.id === id);
  abrirModalConfirm(
    `Remover <strong>${emp ? escHtml(emp.nome) : 'esta empresa'}</strong> da semana?`,
    () => {
      const d = ensureWeekData();
      if (!d.days[day]) return;
      d.days[day] = d.days[day].filter(e => e.id !== id);
      saveWeekData(d); renderInicio(); updateBadges();
      notify('Empresa removida');
    }
  );
}
function clearAll() { document.getElementById('clearModal').classList.add('open'); }
function confirmClear() {
  const data = ensureWeekData();
  const flat = flattenWeekData(data);

  // Leads pós-envio → migrar para base mensal
  const STATUS_MENSAIS = ['Enviada','Respondida','Não respondida','Recusada','Fechada'];
  const paraMes = flat.filter(e => STATUS_MENSAIS.includes(e.status||''));
  if (paraMes.length) migrarParaMes(paraMes);

  // Leads sem status (Não enviada) voltam para a Base de Atribuição
  const semStatus = flat.filter(e => !e.status || e.status === 'Não enviada' || e.status === 'Em fila');
  if (semStatus.length) {
    const atrib = getAtribuicaoData();
    const atribIds = new Set(atrib.map(a => a.id));
    const novosNaAtrib = semStatus
      .filter(e => !atribIds.has(e.id))
      .map(e => ({ ...e, voltouDaSemana: todayStr(), diaDestino: null }));
    saveAtribuicaoData([...atrib, ...novosNaAtrib]);
  }

  // Zera os dias da semana
  data.days = {};
  saveWeekData(data);
  document.getElementById('clearModal').classList.remove('open');
  renderInicio(); updateBadges();
  const msgs = [];
  if (paraMes.length) msgs.push(`${paraMes.length} lead${paraMes.length!==1?'s':''} → Acompanhamento`);
  if (semStatus.length) msgs.push(`${semStatus.length} → Atribuição`);
  notify('Semana limpa' + (msgs.length ? ' · ' + msgs.join(' · ') : ''));
}

function clearDayModal() {
  const weekDays = currentWeekDays();
  const data = ensureWeekData();
  const sel = document.getElementById('clearDaySelect');
  sel.innerHTML = weekDays.map(day => {
    const count = (data.days[day]||[]).length;
    return `<option value="${day}"${day===selectedDay?' selected':''}>${dayLabel(day)} — ${count} empresa${count!==1?'s':''}</option>`;
  }).join('');
  document.getElementById('clearDayModalOverlay').classList.add('open');
}

function confirmClearDay() {
  const day = document.getElementById('clearDaySelect').value;
  if (!day) return;
  const data = ensureWeekData();
  const emps = data.days[day] || [];

  // Leads pós-envio → migrar para base mensal
  const STATUS_MENSAIS = ['Enviada','Respondida','Não respondida','Recusada','Fechada'];
  const paraMes = emps.filter(e => STATUS_MENSAIS.includes(e.status||''));
  if (paraMes.length) migrarParaMes(paraMes);

  // Leads sem status voltam para Atribuição
  const semStatus = emps.filter(e => !e.status || e.status === 'Não enviada' || e.status === 'Em fila');
  if (semStatus.length) {
    const atrib = getAtribuicaoData();
    const atribIds = new Set(atrib.map(a => a.id));
    const novos = semStatus.filter(e => !atribIds.has(e.id)).map(e => ({ ...e, voltouDaSemana: todayStr(), diaDestino: null }));
    saveAtribuicaoData([...atrib, ...novos]);
  }

  // Remove todos do dia
  data.days[day] = [];
  saveWeekData(data);
  document.getElementById('clearDayModalOverlay').classList.remove('open');
  renderInicio(); updateBadges();
  const msgs = [];
  if (paraMes.length) msgs.push(`${paraMes.length} → Acompanhamento`);
  if (semStatus.length) msgs.push(`${semStatus.length} → Atribuição`);
  notify(`${dayLabel(day)} limpo` + (msgs.length ? ' · ' + msgs.join(' · ') : ''));
}

/* ════════════════════════════
   HISTÓRICO
════════════════════════════ */
function renderHistory() {
  const hist = getHistoryData();
  const section = document.getElementById('historySection');
  if (!hist) { section.style.display = 'none'; return; }
  const flat = Object.keys(hist.days).sort().flatMap(d => (hist.days[d]||[]).map(e => ({ date: d, ...e })));
  if (!flat.length) { section.style.display = 'none'; return; }
  section.style.display = 'block';
  document.getElementById('historyBadge').textContent = `${flat.length} empresa${flat.length!==1?'s':''}`;
  document.getElementById('historyToggleBtn').textContent = historyOpen ? 'Ocultar' : 'Mostrar';
  document.getElementById('historyContent').classList.toggle('open', historyOpen);
  if (!historyOpen) return;
  document.getElementById('historyTbody').innerHTML = flat.map(e => `<tr>
    <td style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted)">${escHtml(e.date)}</td>
    <td class="td-name">${escHtml(e.nome)}</td>
    <td class="td-link">${e.site?`<a href="${escHtml(e.site)}" target="_blank">${escHtml(e.site.replace(/^https?:\/\/(www\.)?/,'').split('/')[0])}</a>`:'<span class="td-missing">—</span>'}</td>
    <td style="font-family:'DM Mono',monospace;font-size:9px">${e.whatsapp||'—'}</td>
    <td style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted)">${escHtml(e.status||'Não enviada')}</td>
  </tr>`).join('');
}
function toggleHistory() { historyOpen = !historyOpen; renderHistory(); }
function archiveHistory() {
  if (!confirm('Arquivar semana anterior?')) return;
  localStorage.removeItem(HISTORY_KEY); renderHistory(); notify('Semana arquivada');
}

/* ════════════════════════════
   EXCLUDED DOMAINS
════════════════════════════ */
function renderExcluidos() {
  const domains = getExcludedDomains();
  const countEl = document.getElementById('excludedCount');
  const listEl  = document.getElementById('excludedList');
  if (!countEl || !listEl) return;
  countEl.textContent = `(${domains.length} domínio${domains.length!==1?'s':''})`;
  if (!domains.length) { listEl.innerHTML = '<span style="color:var(--muted)">// nenhum domínio excluído ainda</span>'; return; }
  listEl.innerHTML = domains.map(d =>
    `<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border)">
      <span>${escHtml(d)}</span>
      <button onclick="removerExcluido('${escHtml(d)}')" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:11px;padding:2px 5px;border-radius:4px" onmouseover="this.style.color='var(--error)'" onmouseout="this.style.color='var(--muted)'">✕</button>
    </div>`
  ).join('');
}
function removerExcluido(domain) {
  saveExcludedDomains(getExcludedDomains().filter(d => d !== domain));
  renderExcluidos(); notify(`✓ ${domain} removido`);
}
/* limparExcluidos: delegated to abrirModalLimparExcluidos() */

/* ════════════════════════════
   IMPORTAR
════════════════════════════ */
function renderImportarPanel() {
  renderRamoSelect();
  importPreview();
  renderManualValChips();
}

function parseApifyJson(raw) {
  let arr;
  try { arr = JSON.parse(raw); } catch { return null; }
  if (!Array.isArray(arr)) arr = arr.results || arr.items || arr.data || [];
  return Array.isArray(arr) ? arr : null;
}

function importPreview() {
  const raw     = document.getElementById('importJsonInput').value.trim();
  const listEl  = document.getElementById('importPreviewList');
  const sumEl   = document.getElementById('importSummary');
  const countEl = document.getElementById('previewCount');
  if (!raw) { listEl.innerHTML='<span style="color:var(--muted)">// aguardando JSON...</span>'; sumEl.innerHTML='// cole o JSON acima para ver a prévia do filtro'; countEl.textContent=''; return; }
  const arr = parseApifyJson(raw);
  if (!arr) { sumEl.innerHTML='<span class="err">// JSON inválido</span>'; listEl.innerHTML=''; countEl.textContent=''; return; }

  const total     = arr.length;
  const fora      = arr.filter(i => !isRamoMatch(i));
  const doRamo    = arr.filter(isRamoMatch);
  // Novo critério: SEM site = válido → Validação; COM site = já-vistos
  const comSiteRamo   = doRamo.filter(i => hasValidSiteRaw(i) && !isSiteBlocklisted(extractSite(i)) && !isExcludedDomain(extractSite(i)));
  const comSiteJaVisto= doRamo.filter(i => hasValidSiteRaw(i) && (isSiteBlocklisted(extractSite(i)) || isExcludedDomain(extractSite(i))));
  const semSiteRamo   = doRamo.filter(i => !hasValidSiteRaw(i));
  const semTel        = semSiteRamo.filter(i => !hasValidPhone(i));
  const validos       = semSiteRamo.filter(hasValidPhone);

  // deduplication check
  const data = ensureWeekData();
  const valFila = getValData();
  const existPhones = new Set([...getAllPhones(data), ...valFila.map(v => normalizePhone(v.whatsapp||'')).filter(Boolean)]);
  const novos = validos.filter(i => {
    const ph = normalizePhone(extractPhone(i));
    return !existPhones.has(ph);
  });

  sumEl.innerHTML = `
    <span class="acc">${total}</span> total ·
    <span class="err">${fora.length}</span> fora do ramo ·
    <span class="err">${comSiteRamo.length + comSiteJaVisto.length}</span> com site → já vistos ·
    <span class="warn">${semTel.length}</span> sem telefone ·
    <span class="acc">${validos.length}</span> sem site ·
    <span class="acc">${novos.length}</span> novos → Validação
  `;
  countEl.textContent = `· ${validos.length} sem site`;

  if (!validos.length) { listEl.innerHTML='<span style="color:var(--muted)">// nenhuma empresa sem site encontrada</span>'; document.getElementById('importPreviewPagination').innerHTML=''; return; }

  const totalPrev = validos.length;
  const totalPrevPages = Math.max(1, Math.ceil(totalPrev / IMPORT_PG));
  if (importPage > totalPrevPages) importPage = totalPrevPages;
  const previewItems = validos.slice((importPage-1)*IMPORT_PG, importPage*IMPORT_PG);

  listEl.innerHTML = '<div class="ext-list">' + previewItems.map(item => {
    const nome     = extractName(item);
    const phone    = extractPhone(item);
    const cat      = extractCategory(item);
    const googleUrl= extractGoogleUrl(item);
    const ph = normalizePhone(phone);
    const isDup = existPhones.has(ph);
    const score   = item.totalScore;
    const reviews = item.reviewsCount;
    const scoreStr = score ? `⭐ ${Number(score).toFixed(1)}` : '';
    const revStr   = reviews ? `(${reviews})` : '';
    return `<div class="empresa-card" style="${isDup?'opacity:0.45':''}">
      <div class="empresa-info">
        <div class="empresa-nome">${googleUrl?`<a href="${escHtml(googleUrl)}" target="_blank" style="color:var(--text);text-decoration:none">${escHtml(nome)}</a>`:escHtml(nome)}</div>
        <div class="empresa-meta">
          <div class="empresa-phone">📱 ${escHtml(phone)}</div>
          ${cat?`<span class="q-badge ok" style="font-size:7px">${escHtml(cat)}</span>`:''}
          ${scoreStr?`<span class="q-badge info" style="font-size:7px">${scoreStr} ${revStr}</span>`:''}
        </div>
      </div>
      ${isDup?'<span class="q-badge warn">duplicada</span>':'<span class="q-badge ok">✓ sem site</span>'}
    </div>`;
  }).join('') + '</div>';
  renderPagination('importPreviewPagination', importPage, totalPrevPages, totalPrev, IMPORT_PG, 'goImportPage', 'changeImportPgSize');
}

function importarLeads() {
  const raw = document.getElementById('importJsonInput').value.trim();
  if (!raw) { notify('// cole o JSON primeiro','err'); return; }
  const arr = parseApifyJson(raw);
  if (!arr || !arr.length) { notify('// JSON inválido ou vazio','err'); return; }

  const data = ensureWeekData();
  const valFila = getValData();
  const existPhones = new Set([...getAllPhones(data), ...valFila.map(v => normalizePhone(v.whatsapp||'')).filter(Boolean)]);
  const existSites  = new Set([...getAllSites(data),  ...valFila.map(v => extractDomain(v.site||'')).filter(Boolean)]);

  // dedup instagram também
  const instaFila = getInstaFila();
  const existInstaPhones = new Set(instaFila.map(v => normalizePhone(v.whatsapp||'')).filter(Boolean));

  let addedSemSite = 0, addedJaVistos = 0, skipped = 0;
  const novaValFila = [...valFila];

  arr.filter(isRamoMatch).forEach(item => {
    const nome  = extractName(item);
    const site  = extractSite(item);
    const phone = extractPhone(item);
    if (!nome) { skipped++; return; }

    const ph = normalizePhone(phone);
    const temSite = hasValidSiteRaw(item) && !isSiteBlocklisted(site);
    const temTel  = hasValidPhone(item);

    // ── COM site → já-vistos (bloqueado permanentemente) ──
    if (temSite) {
      const si = extractDomain(site);
      if (si && !isExcludedDomain(site)) addExcludedDomains([site]);
      addedJaVistos++;
      return;
    }

    // ── SEM site + com telefone → Validação ──
    if (!temSite && temTel) {
      if (ph && existPhones.has(ph)) { skipped++; return; }
      const entry = {
        id: genId(), nome,
        whatsapp: phone,
        instagram: extractInstagram(item),
        googleUrl: extractGoogleUrl(item),
        categoria: extractCategory(item),
        ramoId: activeRamoId || null,
        reviewsCount: item.reviewsCount != null ? Number(item.reviewsCount) : null,
        totalScore:   item.totalScore   != null ? Number(item.totalScore)   : null,
        numStatus: 'pendente',
        tipo: 'sem-site',
        canal: 'pendente', // será definido após validação do número
        importadoEm: todayStr(),
      };
      if (ph) existPhones.add(ph);
      novaValFila.push(entry);
      addedSemSite++;
      return;
    }

    skipped++;
  });

  saveValData(novaValFila);
  updateBadges();
  importPreview();

  let msg = `✓ ${addedSemSite} sem site → Validação`;
  if (addedJaVistos) msg += ` · ${addedJaVistos} com site → já vistos`;
  if (skipped)    msg += ` · ${skipped} ignoradas`;
  notify(msg, addedSemSite > 0 ? '' : 'warn');
  document.getElementById('importJsonInput').value = '';
}

/* ════════════════════════════
   VALIDAÇÃO
════════════════════════════ */
function setValTab(tab) {
  valTab = tab;
  const el = document.getElementById('valTabComSite');
  if (el) el.classList.toggle('active', tab==='com-site');
}

/* ── aba de resultado de validação (pendentes / validados) ── */
let valResultTab = 'pendentes'; // 'pendentes' | 'validados'
let validadorAba = 'pendentes'; // qual aba o validador de links vai operar

function setValResultTab(tab) {
  valResultTab = tab;
  valPage = 1;
  // estilo dos botões
  const btnP = document.getElementById('valResultTabPendentes');
  const btnV = document.getElementById('valResultTabValidados');
  if (btnP && btnV) {
    if (tab === 'pendentes') {
      btnP.style.cssText = 'padding:6px 14px;border:1px solid var(--accent-border);border-radius:8px;background:var(--accent-dim);color:var(--accent);font-family:\'DM Mono\',monospace;font-size:9px;cursor:pointer;transition:all 0.18s;display:flex;align-items:center;gap:6px';
      btnV.style.cssText = 'padding:6px 14px;border:1px solid var(--border2);border-radius:8px;background:var(--bg);color:var(--muted);font-family:\'DM Mono\',monospace;font-size:9px;cursor:pointer;transition:all 0.18s;display:flex;align-items:center;gap:6px';
    } else {
      btnV.style.cssText = 'padding:6px 14px;border:1px solid var(--accent-border);border-radius:8px;background:var(--accent-dim);color:var(--accent);font-family:\'DM Mono\',monospace;font-size:9px;cursor:pointer;transition:all 0.18s;display:flex;align-items:center;gap:6px';
      btnP.style.cssText = 'padding:6px 14px;border:1px solid var(--border2);border-radius:8px;background:var(--bg);color:var(--muted);font-family:\'DM Mono\',monospace;font-size:9px;cursor:pointer;transition:all 0.18s;display:flex;align-items:center;gap:6px';
    }
  }
  renderValidacao();
}

function setValidadorAba(aba) {
  validadorAba = aba;
  const btn0 = document.getElementById('validadorAbaBtn0');
  const btn1 = document.getElementById('validadorAbaBtn1');
  const info = document.getElementById('validadorAbaInfo');
  if (btn0 && btn1) {
    if (aba === 'pendentes') {
      btn0.style.cssText = 'flex:1;padding:5px 8px;border:1px solid var(--accent-border);border-radius:6px;background:var(--accent-dim);color:var(--accent);font-family:\'DM Mono\',monospace;font-size:8px;cursor:pointer;transition:all 0.18s;white-space:nowrap';
      btn1.style.cssText = 'flex:1;padding:5px 8px;border:1px solid var(--border2);border-radius:6px;background:var(--bg);color:var(--muted);font-family:\'DM Mono\',monospace;font-size:8px;cursor:pointer;transition:all 0.18s;white-space:nowrap';
    } else {
      btn1.style.cssText = 'flex:1;padding:5px 8px;border:1px solid var(--accent-border);border-radius:6px;background:var(--accent-dim);color:var(--accent);font-family:\'DM Mono\',monospace;font-size:8px;cursor:pointer;transition:all 0.18s;white-space:nowrap';
      btn0.style.cssText = 'flex:1;padding:5px 8px;border:1px solid var(--border2);border-radius:6px;background:var(--bg);color:var(--muted);font-family:\'DM Mono\',monospace;font-size:8px;cursor:pointer;transition:all 0.18s;white-space:nowrap';
    }
  }
  if (info) {
    const abaLabel = aba === 'pendentes' ? '<strong style="color:var(--accent)">Aguardando / Inválidos</strong>' : '<strong style="color:var(--ok)">Número Validado</strong>';
    info.innerHTML = `Cole os links que achar bons. Os sites <strong style="color:var(--text2)">não colados</strong> serão removidos apenas da aba ${abaLabel}.`;
  }
  // Recalcula badge ao trocar aba
  previewValidadorLinks();
}

function renderValidacao() {
  const val = getValData();
  // Suporta tanto 'sem-site' (novo fluxo) quanto 'com-site' (legado) — todos entram na validação
  const comSite = val.filter(v => v.tipo === 'sem-site' || v.tipo === 'com-site' || !v.tipo);

  const semZap = comSite.filter(v => v.numStatus !== 'valido');
  const comZap = comSite.filter(v => v.numStatus === 'valido');

  // atualiza contadores nas abas
  const countSem = document.getElementById('valCountSemZap');
  const countCom = document.getElementById('valCountComZap');
  if (countSem) countSem.textContent = semZap.length;
  if (countCom) countCom.textContent = comZap.length;

  const countEl = document.getElementById('valCountComSite');
  if (countEl) countEl.textContent = `(${comSite.length})`;

  // chip tabs para validação — prioridade chip 2 (final 8457)
  const chips = getChips();
  const chipPriority = chips.find(c => c.nome && c.nome.includes('8457')) || chips.find(c => c.nome && c.nome.toLowerCase().includes('ativação')) || chips[1] || chips[0];
  if (!activeChipId && chips.length) activeChipId = chipPriority ? chipPriority.id : chips[0].id;

  document.getElementById('valChipTabs').innerHTML = chips.length
    ? chips.map(c => `<div class="chip-tab${activeChipId===c.id?' active':''}" onclick="setValChip('${c.id}')">${escHtml(c.nome)}</div>`).join('')
    : '<span style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--muted)">Nenhum chip configurado</span>';

  const comSiteEl = document.getElementById('valComSiteList');

  // seleciona qual grupo mostrar baseado na aba ativa
  const activeGroup = valResultTab === 'validados' ? comZap : semZap;
  const groupLabel = valResultTab === 'validados'
    ? `<div style="font-family:'DM Mono',monospace;font-size:8px;color:var(--ok);letter-spacing:0.1em;text-transform:uppercase;padding:8px 4px 6px;border-bottom:1px solid var(--border);margin-bottom:6px">
        ✅ Número Validado <span style="background:rgba(78,203,113,0.1);border:1px solid rgba(78,203,113,0.3);color:var(--ok);padding:1px 6px;border-radius:100px;margin-left:4px">${comZap.length}</span>
       </div>`
    : `<div style="font-family:'DM Mono',monospace;font-size:8px;color:var(--muted);letter-spacing:0.1em;text-transform:uppercase;padding:8px 4px 6px;border-bottom:1px solid var(--border);margin-bottom:6px">
        📋 Aguardando / Sem WhatsApp <span style="background:rgba(255,92,92,0.1);border:1px solid rgba(255,92,92,0.3);color:var(--error);padding:1px 6px;border-radius:100px;margin-left:4px">${semZap.length}</span>
       </div>`;

  if (!comSite.length) {
    comSiteEl.innerHTML = '<div style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--muted);padding:20px;text-align:center">// nenhuma empresa aguardando validação</div>';
  } else if (!activeGroup.length) {
    const emptyMsg = valResultTab === 'validados'
      ? '// nenhum número validado ainda'
      : '// nenhuma empresa pendente ou inválida';
    comSiteEl.innerHTML = `${groupLabel}<div style="font-family:'DM Mono',monospace;font-size:10px;color:var(--muted);padding:20px;text-align:center">${emptyMsg}</div>`;
  } else {
    // Pré-calcula os domínios dos links colados para mostrar indicador por card
    const _rawLinks = document.getElementById('validadorLinksInput')?.value || '';
    const _normLink = (url) => { try { return new URL(url).hostname.replace(/^www\./,'').toLowerCase(); } catch { return url.toLowerCase().trim(); } };
    const _linkDomains = new Set(_rawLinks.split('\n').map(l=>l.trim()).filter(l=>l.startsWith('http')).map(_normLink));

    const renderCard = (v) => {
      const statusColor = v.numStatus==='valido'?'var(--ok)':v.numStatus==='invalido'?'var(--error)':'var(--muted)';
      const statusLabel = v.numStatus==='valido'?'✓ número válido':v.numStatus==='invalido'?'✗ sem WhatsApp':'pendente';
      const chipId = v.chipValidacaoId || activeChipId;
      const chipNome = getChipById(chipId) ? getChipById(chipId).nome : '';
      const isMantido = v.site && _linkDomains.size > 0 && _linkDomains.has(_normLink(v.site));
      const mantidoBadge = isMantido
        ? `<span style="display:inline-flex;align-items:center;gap:4px;font-family:'DM Mono',monospace;font-size:7px;padding:2px 7px;border-radius:100px;border:1px solid rgba(91,184,245,0.35);background:rgba(91,184,245,0.07);color:#5bb8f5;white-space:nowrap"><span style="width:4px;height:4px;border-radius:50%;background:#5bb8f5;display:inline-block;flex-shrink:0"></span>mantido</span>`
        : '';
      return `<div class="empresa-card" id="val-card-${v.id}">
        <div class="empresa-info">
          <div class="empresa-nome">
            ${v.googleUrl?`<a href="${escHtml(v.googleUrl)}" target="_blank" style="color:var(--text);text-decoration:none" onmouseover="this.style.color='var(--accent)'" onmouseout="this.style.color='var(--text)'">${escHtml(v.nome)}</a>`:escHtml(v.nome)}
          </div>
          <div class="empresa-meta">
            ${v.site?`<div class="empresa-site"><a href="${escHtml(v.site)}" target="_blank">${escHtml(v.site.replace(/^https?:\/\/(www\.)?/,'').split('/')[0])}</a></div>`:''}
            <div class="empresa-phone">📱
              <span id="val-phone-${v.id}" style="cursor:pointer" onclick="editValPhone('${v.id}')">${escHtml(v.whatsapp||'—')}</span>
            </div>
            <span style="font-family:'DM Mono',monospace;font-size:8px;color:${statusColor}">${statusLabel}</span>
            ${chipNome?`<span class="q-badge ok" style="font-size:7px">📱 ${escHtml(chipNome)}</span>`:''}
            ${mantidoBadge}
          </div>
          <div class="empresa-meta" style="margin-top:4px">
            <span style="font-family:'DM Mono',monospace;font-size:8px;color:var(--muted)">importado em:</span>
            <span style="font-family:'DM Mono',monospace;font-size:8px;color:var(--text2)">${v.importadoEm || '—'}</span>
          </div>
        </div>
        <div class="empresa-actions">
          ${v.numStatus==='valido'
            ?`<button class="add-btn added" onclick="aprovarParaFila('${v.id}')">→ Atribuir</button>`
            :`<button class="add-btn" onclick="validarNumeroUnico('${v.id}')">Validar</button>`
          }
          <button class="del-btn" onclick="removerDaValidacao('${v.id}')">✕</button>
        </div>
      </div>`;
    };

    const totalVal = activeGroup.length;
    const totalValPages = Math.max(1, Math.ceil(totalVal / VAL_PG));
    if (valPage > totalValPages) valPage = totalValPages;
    const pageCards = activeGroup.slice((valPage-1)*VAL_PG, valPage*VAL_PG);

    comSiteEl.innerHTML = groupLabel + '<div class="ext-list">' + pageCards.map(renderCard).join('') + '</div>';
    renderPagination('valPagination', valPage, totalValPages, totalVal, VAL_PG, 'goValPage', 'changeValPgSize');
  }
  renderValidadorLinks();
}

function setValChip(id) { activeChipId = id; valPage = 1; renderValidacao(); }

function editValPhone(id) {
  const val = getValData();
  const v = val.find(x => x.id === id);
  if (!v) return;
  const el = document.getElementById(`val-phone-${id}`);
  if (!el) return;
  el.outerHTML = `<input id="val-phone-edit-${id}" type="text" value="${escHtml(v.whatsapp||'')}"
    style="background:var(--bg);border:1px solid var(--accent);border-radius:5px;color:var(--text);font-family:'DM Mono',monospace;font-size:9px;padding:3px 7px;width:120px;outline:none"
    onkeydown="if(event.key==='Enter')saveValPhone('${id}');if(event.key==='Escape')renderValidacao();" onblur="saveValPhone('${id}')"/>`;
  document.getElementById(`val-phone-edit-${id}`)?.focus();
}

function saveValPhone(id) {
  const input = document.getElementById(`val-phone-edit-${id}`);
  if (!input) return;
  const val = getValData();
  const v = val.find(x => x.id === id);
  if (!v) return;
  v.whatsapp = input.value.trim();
  v.numStatus = 'pendente';
  saveValData(val); renderValidacao(); notify('✓ Número atualizado');
}

async function validarNumeroUnico(id) {
  const chip = getChipById(activeChipId);
  if (!chip) { notify('// selecione um chip primeiro','warn'); return; }
  const val = getValData();
  const v = val.find(x => x.id === id);
  if (!v) return;
  const phone = normalizePhone(v.whatsapp || '');
  if (!phone || phone.length < 10) { notify('// número inválido','err'); return; }
  const numero = phone.startsWith('55') ? phone : '55' + phone;

  const card = document.getElementById(`val-card-${id}`);
  if (card) card.style.opacity = '0.6';
  try {
    const res = await fetch(`${chip.url}/chat/whatsappNumbers/${chip.instance}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': chip.key },
      body: JSON.stringify({ numbers: [numero] })
    });
    const data = await res.json();
    const result = Array.isArray(data) ? data[0] : data;
    v.numStatus = result?.exists ? 'valido' : 'invalido';
    saveValData(val); renderValidacao();
    notify(result?.exists ? `✓ ${v.nome} — número válido` : `✗ ${v.nome} — sem WhatsApp`);
  } catch(e) {
    notify('// erro ao validar número','err');
    if (card) card.style.opacity = '1';
  }
}

async function validarTodosNumeros() {
  const chip = getChipById(activeChipId);
  if (!chip) { notify('// selecione um chip primeiro','warn'); return; }
  const val = getValData();
  const pendentes = val.filter(v => (v.tipo==='sem-site' || v.tipo==='com-site' || !v.tipo) && v.numStatus==='pendente');
  if (!pendentes.length) { notify('// nenhum número pendente','warn'); return; }

  document.getElementById('valSpinner').style.display = 'block';
  let validados = 0, invalidos = 0;

  for (let i = 0; i < pendentes.length; i += 10) {
    const lote = pendentes.slice(i, i + 10);
    const numbers = lote.map(v => {
      const ph = normalizePhone(v.whatsapp || '');
      return ph.startsWith('55') ? ph : '55' + ph;
    }).filter(n => n.length >= 12);
    if (!numbers.length) continue;
    try {
      const res = await fetch(`${chip.url}/chat/whatsappNumbers/${chip.instance}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': chip.key },
        body: JSON.stringify({ numbers })
      });
      const data = await res.json();
      const results = Array.isArray(data) ? data : [];
      lote.forEach(v => {
        const ph = normalizePhone(v.whatsapp || '');
        const numero = ph.startsWith('55') ? ph : '55' + ph;
        const found = results.find(r => r.jid && r.jid.includes(numero));
        v.numStatus = found?.exists ? 'valido' : 'invalido';
        if (v.numStatus === 'valido') validados++; else invalidos++;
      });
    } catch(e) { console.error(e); }
    await new Promise(r => setTimeout(r, 800));
  }

  const updated = getValData().map(v => {
    const p = pendentes.find(p => p.id === v.id);
    return p || v;
  });
  saveValData(updated);
  document.getElementById('valSpinner').style.display = 'none';
  renderValidacao(); updateBadges();
  notify(`✓ ${validados} válidos · ${invalidos} sem WhatsApp`);
}

function aprovarSemSiteParaZap(id) {
  const val = getValData();
  const v = val.find(x => x.id === id);
  if (!v) return;
  const phone = normalizePhone(v.whatsapp || '');
  if (!phone || phone.length < 10) { notify('// número inválido para WhatsApp','err'); return; }

  const data = ensureWeekData();
  const day = v.diaDestino || todayStr();
  if (!data.days[day]) data.days[day] = [];

  const diasSemana = currentWeekDays();
  let diaDestino = day;
  let idx = diasSemana.indexOf(day);
  while ((data.days[diaDestino]||[]).length >= getDailyLimit()) {
    idx++;
    if (idx >= diasSemana.length) { notify('// semana cheia','warn'); return; }
    diaDestino = diasSemana[idx];
    if (!data.days[diaDestino]) data.days[diaDestino] = [];
  }

  data.days[diaDestino].push({
    id: v.id, nome: v.nome, site: '', whatsapp: v.whatsapp,
    instagram: v.instagram, googleUrl: v.googleUrl,
    status: 'Não enviada', criadoEm: todayStr(), semSite: true,
  });
  saveWeekData(data);
  saveValData(getValData().filter(x => x.id !== id));
  renderValidacao(); updateBadges();
  notify(`✓ ${v.nome} → Fila WhatsApp (${dayLabel(diaDestino)})`);
}

function removerDaValidacao(id) {
  const val = getValData();
  const v = val.find(x => x.id === id);
  if (v && v.site) addExcludedDomains([v.site]);
  saveValData(val.filter(x => x.id !== id));
  renderValidacao(); updateBadges();
  if (v && v.site) notify('\u2715 removido · ' + (extractDomain(v.site)||v.site) + ' → sites já vistos');
}

/* Passa lead para o dia seguinte (antes de entrar na fila) */
function passarProximoDia(id) {
  const val = getValData();
  const v = val.find(x => x.id === id);
  if (!v) return;
  const proxDia = nextWeekday(v.diaDestino || todayStr());
  v.diaDestino = proxDia;
  saveValData(val);
  renderValidacao();
  notify(`→ ${v.nome} movido para ${dayLabel(proxDia)}`);
}

/* ════════════════════════════
   VALIDADOR DE LINKS
════════════════════════════ */
// Domínios atualmente colados no validador — lidos pelos cards sem causar loop
let _validadorLinkDomains = new Set();
const _normValidadorLink = (url) => {
  try { return new URL(url).hostname.replace(/^www\./,'').toLowerCase(); } catch { return url.toLowerCase().trim(); }
};

function previewValidadorLinks() {
  const raw = document.getElementById('validadorLinksInput')?.value || '';
  const links = raw.split('\n').map(l => l.trim()).filter(l => l.startsWith('http'));
  const el = document.getElementById('validadorLinksPreview');
  if (!el) return;

  // Atualiza a variável global de domínios (usada pelos cards no próximo render)
  _validadorLinkDomains = new Set(links.map(_normValidadorLink));

  if (!links.length) {
    el.innerHTML = '';
    updateMantidosBadge(0, false);
    _updateCardMantidoBadges(); // atualiza badges dos cards sem re-renderizar tudo
    return;
  }

  el.innerHTML = `<div style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted);margin-bottom:8px">${links.length} link${links.length!==1?'s':''} colado${links.length!==1?'s':''}:</div>` +
    links.map(l => `<div style="background:var(--bg);border:1px solid var(--border2);border-radius:6px;padding:5px 10px;margin-bottom:4px;font-family:'DM Mono',monospace;font-size:9px;color:var(--accent);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(l)}</div>`).join('');

  // Atualiza badges dos cards visíveis sem re-renderizar a lista inteira
  _updateCardMantidoBadges();

  // Calcula total mantidos para o badge global
  const val = getValData();
  const isAbaValidados = validadorAba === 'validados';
  const mantidos = val.filter(v => {
    if (v.tipo !== 'com-site') return false;
    const isValidado = v.numStatus === 'valido';
    if (isAbaValidados && !isValidado) return false;
    if (!isAbaValidados && isValidado) return false;
    return _validadorLinkDomains.has(_normValidadorLink(v.site || ''));
  }).length;
  updateMantidosBadge(mantidos, true);
}

// Atualiza apenas os badges de "mantido" nos cards já renderizados no DOM
function _updateCardMantidoBadges() {
  const cards = document.querySelectorAll('#valComSiteList .empresa-card[id^="val-card-"]');
  const val = getValData();
  cards.forEach(card => {
    const id = card.id.replace('val-card-', '');
    const v = val.find(x => x.id === id);
    if (!v) return;
    let badge = card.querySelector('.mantido-inline-badge');
    const isMantido = v.site && _validadorLinkDomains.size > 0 && _validadorLinkDomains.has(_normValidadorLink(v.site));
    if (isMantido) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'mantido-inline-badge';
        badge.style.cssText = 'display:inline-flex;align-items:center;gap:4px;font-family:\'DM Mono\',monospace;font-size:7px;padding:2px 7px;border-radius:100px;border:1px solid rgba(91,184,245,0.35);background:rgba(91,184,245,0.07);color:#5bb8f5;white-space:nowrap';
        badge.innerHTML = '<span style="width:4px;height:4px;border-radius:50%;background:#5bb8f5;display:inline-block;flex-shrink:0"></span>mantido';
        // Insere após o badge do chip (último span da .empresa-meta)
        const meta = card.querySelector('.empresa-meta');
        if (meta) meta.appendChild(badge);
      }
    } else {
      if (badge) badge.remove();
    }
  });
}

function updateMantidosBadge(count, visible) {
  const badge = document.getElementById('valMantidosBadge');
  const countEl = document.getElementById('valMantidosCount');
  if (!badge || !countEl) return;
  countEl.textContent = count;
  if (visible && count > 0) {
    badge.classList.add('visible');
  } else {
    badge.classList.remove('visible');
  }
}

function renderValidadorLinks() {
  previewValidadorLinks();
}

function confirmarValidadorLinks() {
  const raw = document.getElementById('validadorLinksInput')?.value || '';
  const links = raw.split('\n').map(l => l.trim()).filter(l => l.startsWith('http'));
  if (!links.length) { notify('// nenhum link colado','warn'); return; }

  // Normaliza para comparar domínios
  const normLink = (url) => {
    try { return new URL(url).hostname.replace(/^www\./,'').toLowerCase(); } catch { return url.toLowerCase().trim(); }
  };
  const linkDomains = new Set(links.map(normLink));

  const val = getValData();
  // filtra apenas as empresas da aba selecionada (validadorAba)
  const isAbaValidados = validadorAba === 'validados';
  const antes = val.filter(v => v.tipo === 'com-site' && (isAbaValidados ? v.numStatus === 'valido' : v.numStatus !== 'valido')).length;

  const novaVal = val.filter(v => {
    if (v.tipo !== 'com-site') return true; // preserva outros tipos
    const isValidado = v.numStatus === 'valido';
    // se não pertence à aba selecionada, preserva sem tocar
    if (isAbaValidados && !isValidado) return true;
    if (!isAbaValidados && isValidado) return true;
    // pertence à aba: só mantém se o site está na lista
    const empDomain = normLink(v.site || '');
    return linkDomains.has(empDomain);
  });

  const removidos = antes - novaVal.filter(v => v.tipo === 'com-site' && (isAbaValidados ? v.numStatus === 'valido' : v.numStatus !== 'valido')).length;

  // Registra os sites removidos como "já vistos"
  const removedSites = val
    .filter(v => {
      if (v.tipo !== 'com-site') return false;
      const isValidado = v.numStatus === 'valido';
      if (isAbaValidados && !isValidado) return false;
      if (!isAbaValidados && isValidado) return false;
      return !linkDomains.has(normLink(v.site || ''));
    })
    .map(v => v.site)
    .filter(Boolean);
  if (removedSites.length) addExcludedDomains(removedSites);

  saveValData(novaVal);
  document.getElementById('validadorLinksInput').value = '';
  updateMantidosBadge(0, false);
  renderValidacao(); updateBadges();
  const abaLabel = isAbaValidados ? 'Validados' : 'Pendentes/Inválidos';
  notify(`✓ ${links.length} mantidos · ${removidos} removidos → sites já vistos (${abaLabel})`);
}

/* Remove da página atual apenas os itens que NÃO estão nos links colados,
   preservando todas as outras páginas intocadas. */
function limparPaginaValidador() {
  const raw = document.getElementById('validadorLinksInput')?.value || '';
  const links = raw.split('\n').map(l => l.trim()).filter(l => l.startsWith('http'));

  const normLink = (url) => {
    try { return new URL(url).hostname.replace(/^www\./,'').toLowerCase(); } catch { return url.toLowerCase().trim(); }
  };
  const linkDomains = new Set(links.map(normLink));

  const val = getValData();
  const isAbaValidados = validadorAba === 'validados';

  // Identifica quais empresas estão na página atual (mesma lógica do renderValidacao)
  const comSite = val.filter(v => v.tipo === 'com-site');
  const activeGroup = isAbaValidados
    ? comSite.filter(v => v.numStatus === 'valido')
    : comSite.filter(v => v.numStatus !== 'valido');

  const totalValPages = Math.max(1, Math.ceil(activeGroup.length / VAL_PG));
  const currentPageIdx = Math.min(valPage, totalValPages);
  const pageItems = activeGroup.slice((currentPageIdx - 1) * VAL_PG, currentPageIdx * VAL_PG);
  const pageIds = new Set(pageItems.map(v => v.id));

  // Remove apenas os itens da página atual que não estão nos links
  let removidos = 0;
  const novaVal = val.filter(v => {
    if (!pageIds.has(v.id)) return true; // fora da página: preserva
    const empDomain = normLink(v.site || '');
    if (linkDomains.has(empDomain)) return true; // está nos links: preserva
    removidos++;
    return false;
  });

  if (!removidos) { notify('// nenhum item removido nesta página', 'warn'); return; }

  // Registra os sites removidos como "já vistos"
  const removedSites = pageItems
    .filter(v => !linkDomains.has(normLink(v.site || '')))
    .map(v => v.site)
    .filter(Boolean);
  addExcludedDomains(removedSites);

  saveValData(novaVal);
  // Ajusta a página se necessário (se a página ficou vazia e havia mais)
  const novaGroup = novaVal.filter(v => {
    if (v.tipo !== 'com-site') return false;
    return isAbaValidados ? v.numStatus === 'valido' : v.numStatus !== 'valido';
  });
  const novasPages = Math.max(1, Math.ceil(novaGroup.length / VAL_PG));
  if (valPage > novasPages) valPage = novasPages;

  renderValidacao(); updateBadges();
  updateMantidosBadge(0, false);
  document.getElementById('validadorLinksInput').value = '';
  const abaLabel = isAbaValidados ? 'Validados' : 'Pendentes/Inválidos';
  notify(`✓ ${removidos} removidos da página ${currentPageIdx} → sites já vistos (${abaLabel})`);
}

function aprovarParaFila(id) {
  const val = getValData();
  const v = val.find(x => x.id === id);
  if (!v || v.numStatus !== 'valido') { notify('// valide o número primeiro','warn'); return; }

  // Manda para a Base de Atribuição (sem dia ainda)
  const atrib = getAtribuicaoData();
  if (atrib.find(a => a.id === v.id)) { notify('// já está na Base de Atribuição','warn'); return; }
  atrib.push({
    id: v.id, nome: v.nome, site: v.site || '', whatsapp: v.whatsapp,
    instagram: v.instagram, googleUrl: v.googleUrl,
    canal: 'zap', // número validado via WhatsApp
    status: 'Não enviada', criadoEm: v.importadoEm || todayStr(),
    validadoEm: todayStr(), diaDestino: null,
  });
  saveAtribuicaoData(atrib);

  // Remove da fila de validação
  saveValData(getValData().filter(x => x.id !== id));
  renderValidacao(); updateBadges();
  notify(`✓ ${v.nome} → Base de Atribuição`);
}

function aprovarParaInsta(id) {
  const val = getValData();
  const v = val.find(x => x.id === id);
  if (!v) return;

  // Salva link do insta editado
  const linkInput = document.getElementById(`insta-link-${id}`);
  if (linkInput) v.instagram = linkInput.value.trim();

  // Manda para a Base de Atribuição com tag INSTA
  const atrib = getAtribuicaoData();
  if (!atrib.find(a => a.id === v.id)) {
    atrib.push({
      id: v.id, nome: v.nome, site: '', whatsapp: v.whatsapp || '',
      instagram: v.instagram || '', googleUrl: v.googleUrl || '',
      canal: 'insta', // sem WhatsApp validado
      status: 'Não enviada', criadoEm: v.importadoEm || todayStr(),
      validadoEm: todayStr(), diaDestino: null,
    });
    saveAtribuicaoData(atrib);
  }

  saveValData(getValData().filter(x => x.id !== id));
  renderValidacao(); updateBadges();
  notify(`✓ ${v.nome} → Atribuição (tag INSTA)`);
}

/* Aprova TODOS os leads validados para Atribuição (ZAP ou INSTA conforme numStatus) */
function aprovarTodosParaAtribuicao() {
  const val = getValData();
  const atrib = getAtribuicaoData();
  const existIds = new Set(atrib.map(a => a.id));
  let addedZap = 0, addedInsta = 0;

  // Processa leads com número válido → tag ZAP
  val.filter(v => v.numStatus === 'valido' && !existIds.has(v.id)).forEach(v => {
    atrib.push({
      id: v.id, nome: v.nome, site: '', whatsapp: v.whatsapp,
      instagram: v.instagram || '', googleUrl: v.googleUrl || '',
      canal: 'zap',
      status: 'Não enviada', criadoEm: v.importadoEm || todayStr(),
      validadoEm: todayStr(), diaDestino: null,
    });
    existIds.add(v.id);
    addedZap++;
  });

  // Processa leads sem número válido (invalido) → tag INSTA
  val.filter(v => v.numStatus === 'invalido' && !existIds.has(v.id)).forEach(v => {
    atrib.push({
      id: v.id, nome: v.nome, site: '', whatsapp: '',
      instagram: v.instagram || '', googleUrl: v.googleUrl || '',
      canal: 'insta',
      status: 'Não enviada', criadoEm: v.importadoEm || todayStr(),
      validadoEm: todayStr(), diaDestino: null,
    });
    existIds.add(v.id);
    addedInsta++;
  });

  if (!addedZap && !addedInsta) { notify('// nenhum lead pronto para atribuição','warn'); return; }

  saveAtribuicaoData(atrib);
  // Remove os aprovados da validação
  const removedIds = new Set([...val.filter(v => v.numStatus === 'valido' || v.numStatus === 'invalido').map(v => v.id)]);
  saveValData(val.filter(v => !removedIds.has(v.id)));
  renderValidacao(); updateBadges();
  let msg = `✓ `;
  if (addedZap)   msg += `${addedZap} ZAP`;
  if (addedInsta) msg += `${addedZap?', ':''}${addedInsta} INSTA`;
  msg += ' → Atribuição';
  notify(msg);
}





/* ─── Per-chip state (indexed 0 = Chip1, 1 = Chip2) ─── */
const chipSlotState = [
  { filaLotes:[], loteAtual:0, lotesTotal:0, aguardandoLote:false, disparoEmAndamento:false, loteEsperaFim:null, loteEsperaTimer:null, loteCountdownInt:null, loteHistorico:[], retryItems:[], retryDisparado:false, ultimoLoteFimTs:null, pausado:false },
  { filaLotes:[], loteAtual:0, lotesTotal:0, aguardandoLote:false, disparoEmAndamento:false, loteEsperaFim:null, loteEsperaTimer:null, loteCountdownInt:null, loteHistorico:[], retryItems:[], retryDisparado:false, ultimoLoteFimTs:null, pausado:false }
];

/* ─── Limit por dia = 60 × nº de chips ─── */
function getDailyLimit() { return Math.max(1, getChips().length) * 60; }

/* ─── Helpers por slot ─── */
function getChipBySlot(slot) { return getChips()[slot] || null; }

function toggleFilaItemSlot(slot, id) {
  const chip = getChipBySlot(slot); if (!chip) return;
  const fila = getFilaChip(chip.id);
  const item = fila.find(f => f.id === id);
  if (!item) return;
  item.aberto = !item.aberto;
  renderFilaSlot(slot, disparoDay);
}

function atualizarMsgFilaSlot(slot, id, val) {
  const chip = getChipBySlot(slot); if (!chip) return;
  const fila = getFilaChip(chip.id);
  const item = fila.find(f => f.id === id);
  if (item) { item.mensagem = val; saveFilaDisparo(); }
}

function removerFilaSlot(slot, id) {
  const chip = getChipBySlot(slot); if (!chip) return;
  const fila = getFilaChip(chip.id);
  const item = fila.find(f => f.id === id);
  abrirModalConfirm(
    `Remover <strong>${item ? escHtml(item.nome) : 'esta empresa'}</strong> da fila?`,
    () => {
      const f2 = getFilaChip(chip.id).filter(f => f.id !== id);
      filaDisparo[chip.id] = f2;
      const data = ensureWeekData();
      Object.keys(data.days).forEach(day => {
        const emp = (data.days[day]||[]).find(e => e.id === id);
        if (emp && emp.status === 'Em fila') emp.status = 'Não enviada';
      });
      saveWeekData(data); saveFilaDisparo(); updateBadges();
      renderDisparoEmpresas(); renderFilaSlot(slot, disparoDay);
    }
  );
}

function limparFilaChip(slot) {
  const st = chipSlotState[slot];
  if (st.disparoEmAndamento || st.aguardandoLote) { notify('// disparo em andamento','warn'); return; }
  const chip = getChipBySlot(slot); if (!chip) return;
  const fila = getFilaChip(chip.id);
  const data = ensureWeekData();
  fila.forEach(f => {
    Object.keys(data.days).forEach(day => {
      const emp = (data.days[day]||[]).find(e => e.id === f.id);
      if (emp && emp.status === 'Em fila') emp.status = 'Não enviada';
    });
  });
  saveWeekData(data);
  filaDisparo[chip.id] = [];
  st.loteHistorico = [];
  st.retryItems = [];
  st.retryDisparado = false;
  st.ultimoLoteFimTs = null;
  saveFilaDisparo();
  updateBadges(); renderDisparoEmpresas(); renderFilaSlot(slot, disparoDay);
}

/* ─── Iniciar disparo por slot ─── */
async function iniciarDisparoChip(slot) {
  const st = chipSlotState[slot];
  if (st.disparoEmAndamento || st.aguardandoLote) return;
  const chip = getChipBySlot(slot);
  if (!chip) { notify('// chip ' + (slot+1) + ' não configurado','err'); return; }
  const fila = getFilaChip(chip.id).filter(f => f.status !== 'enviado');
  if (!fila.length) { notify('// fila vazia','warn'); return; }

  // Congela o lote — snapshot dos itens aguardando
  const LOTE_SIZE = getLoteSize();
  const filaCompleta = getFilaChip(chip.id);
  const pendentes = filaCompleta.filter(f => f.status === 'aguardando');
  if (!pendentes.length) { notify('// nenhum item aguardando — todos já enviados','warn'); return; }

  // ── Validação: todos os lotes com pendentes devem ter imagem ──
  // Itera apenas sobre itens aguardando, que é como os lotes são
  // numerados visualmente e como as imagens são salvas pelo usuário
  const lotesComPendentes = [];
  for (let i = 0; i < pendentes.length; i += LOTE_SIZE) {
    const loteNum = Math.floor(i / LOTE_SIZE) + 1;
    lotesComPendentes.push(loteNum);
  }

  // Garante que o cache está populado para cada lote antes de validar
  await Promise.all(lotesComPendentes.map(async loteNum => {
    const k = getLoteImgKey(chip.id, loteNum);
    if (_imgCache[k] === undefined) {
      try { _imgCache[k] = (await idbGet(k)) || null; } catch { _imgCache[k] = null; }
    }
  }));

  const lotesSemImagem = lotesComPendentes.filter(n => !getLoteImagem(chip.id, n));
  if (lotesSemImagem.length) {
    notify(`// Lote${lotesSemImagem.length>1?'s':''} ${lotesSemImagem.join(', ')} sem imagem — insira a imagem antes de disparar`, 'err');
    return;
  }

  st.filaLotes = [];
  st.loteAtual = 0;
  st.loteHistorico = st.loteHistorico || [];
  for (let i = 0; i < pendentes.length; i += LOTE_SIZE) {
    st.filaLotes.push(pendentes.slice(i, i + LOTE_SIZE));
  }
  st.lotesTotal = st.filaLotes.length;
  const logEl = document.getElementById(`disparoLog${slot}`);
  if (logEl) { logEl.innerHTML = ''; logEl.style.display = 'block'; }
  await dispararLoteChip(slot);
}

/* ─── Disparo de um lote por slot ─── */
async function dispararLoteChip(slot) {
  const st = chipSlotState[slot];
  const chip = getChipBySlot(slot);
  if (!chip) return;
  st.loteAtual++;
  const lote = st.filaLotes.shift();
  const esperaMin = Math.max(90, parseInt(document.getElementById('loteEsperaMin')?.value)||90);
  const delayMin  = parseInt(document.getElementById('delayMin')?.value)||120;
  const delayMax  = parseInt(document.getElementById('delayMax')?.value)||180;
  const MSG_DELAY = 15000;
  const chipCor   = slot === 0 ? 'var(--accent)' : '#5bb8f5';

  st.disparoEmAndamento = true;
  const btnEl  = document.getElementById(`btnDisparar${slot}`);
  const spinEl = document.getElementById(`spinner${slot}`);
  const btnTxt = document.getElementById(`disparoBtn${slot}`);
  if (btnEl)  btnEl.disabled = true;
  if (spinEl) spinEl.style.display = 'block';
  if (btnTxt) btnTxt.textContent = `Lote ${st.loteAtual}/${st.lotesTotal}...`;
  _atualizarBotaoPausa(slot);

  const logEl = document.getElementById(`disparoLog${slot}`);
  if (logEl) logEl.style.display = 'block';
  function log(msg) {
    if (!logEl) return;
    const l = document.createElement('div');
    l.style.marginBottom = '3px';
    l.innerHTML = `<span style="color:var(--muted)">[${timeStr()}]</span> ${msg}`;
    logEl.appendChild(l); logEl.scrollTop = logEl.scrollHeight;
  }
  log(`<span style="color:${chipCor}">━━ LOTE ${st.loteAtual}/${st.lotesTotal} · ${lote.length} empresa${lote.length>1?'s':''} ━━</span>`);

  // Atualiza status visual de cada item do lote
  const loteSnapshot = lote.map(i => ({ ...i }));

  for (let i = 0; i < lote.length; i++) {
    const item = lote[i];
    if (item.status === 'enviado') continue;

    // ── Verificar pausa ──
    if (st.pausado) {
      log(`<span style="color:var(--warning)">⏸ Pausado após ${i} envio${i!==1?'s':''} — aguardando retomada...</span>`);
      const btnTxtP = document.getElementById(`disparoBtn${slot}`);
      if (btnTxtP) btnTxtP.textContent = `⏸ Pausado (${i}/${lote.length})`;
      while (st.pausado) {
        await new Promise(r => setTimeout(r, 500));
      }
      log(`<span style="color:var(--ok)">▶ Retomado</span>`);
      if (btnTxtP) btnTxtP.textContent = `Lote ${st.loteAtual}/${st.lotesTotal}...`;
    }

    item.status = 'enviando';
    atualizarStatusFilaSlot(slot, item.id, 'enviando');
    log(`Enviando para <span style="color:var(--text)">${escHtml(item.nome)}</span>...`);
    try {
      const waNum  = item.whatsapp.replace(/\D/g,'');
      const numero = waNum.startsWith('55') ? waNum : '55' + waNum;

      // MSG 1 — Apresentação
      const payload1 = { number: numero, options: { delay: 1000 }, textMessage: { text: item.mensagem } };
      const res1 = await fetch(`${chip.url}/message/sendText/${chip.instance}`, { method:'POST', headers:{'Content-Type':'application/json','apikey':chip.key}, body: JSON.stringify(payload1) });
      if (!res1.ok) throw new Error(`HTTP ${res1.status}`);
      log(`  ① apresentação enviada`);
      await new Promise(r => setTimeout(r, MSG_DELAY));

      // MSG 2 — Imagem do lote
      const loteNum = st.loteAtual;
      const imgRedesign = getLoteImagem(chip.id, loteNum);
      if (imgRedesign) {
        await new Promise(r => setTimeout(r, MSG_DELAY));
        const b2 = imgRedesign.split(',')[1], m2 = imgRedesign.split(';')[0].split(':')[1] || 'image/jpeg';
        const payload3 = { number: numero, options: { delay: 1000 }, mediaMessage: { mediatype: 'image', media: b2, mimetype: m2, caption: '' } };
        await fetch(`${chip.url}/message/sendMedia/${chip.instance}`, { method:'POST', headers:{'Content-Type':'application/json','apikey':chip.key}, body: JSON.stringify(payload3) });
        log(`  ② imagem enviada`);
      }

      item.status = 'enviado';
      atualizarStatusFilaSlot(slot, item.id, 'enviado');
      atualizarStatusEmpresa(item.id, 'Enviada');
      log(`<span style="color:${chipCor}">✓ ${escHtml(item.nome)}</span>`);
    } catch(e) {
      item.status = 'erro';
      atualizarStatusFilaSlot(slot, item.id, 'erro');
      log(`<span style="color:var(--error)">✗ Erro — ${e.message}</span>`);
    }
    if (i < lote.length - 1) {
      const delay = (delayMin + Math.random()*(delayMax-delayMin))*1000;
      log(`Aguardando ${Math.round(delay/1000)}s...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  // Finalizar lote: mover enviados para histórico compacto, manter erros na fila
  const env   = lote.filter(f => f.status === 'enviado').length;
  const erros = lote.filter(f => f.status === 'erro').length;
  log(`<span style="color:${chipCor}">✓ Lote ${st.loteAtual} concluído! ${env} enviado${env>1?'s':''} · ${erros} erro${erros>1?'s':''}</span>`);

  // Adiciona lote ao histórico
  st.loteHistorico.push({
    num: st.loteAtual,
    total: st.lotesTotal,
    items: lote.map(f => ({ id: f.id, nome: f.nome, whatsapp: f.whatsapp, status: f.status })),
    env, erros,
    fimTs: Date.now()
  });

  // Remove enviados da fila ativa (mantém erros para retry)
  const enviados = lote.filter(f => f.status === 'enviado').map(f => f.id);
  if (enviados.length) {
    filaDisparo[chip.id] = filaDisparo[chip.id].filter(f => !enviados.includes(f.id));
    saveFilaDisparo();
  }

  st.ultimoLoteFimTs = Date.now();
  st.disparoEmAndamento = false;
  if (spinEl) spinEl.style.display = 'none';
  renderFilaSlot(slot, disparoDay);
  renderInicio();

  if (st.filaLotes.length > 0) {
    // Ainda tem lotes — aguardar delay
    const esperaMs = esperaMin * 60 * 1000;
    st.loteEsperaFim = Date.now() + esperaMs;
    st.aguardandoLote = true;
    if (btnEl)  btnEl.disabled = true;
    if (btnTxt) btnTxt.textContent = `🟡 Aguardando lote ${st.loteAtual+1}/${st.lotesTotal}`;
    const panel = document.getElementById(`loteEsperaPanel${slot}`);
    if (panel) panel.style.display = 'block';
    const titleEl = document.getElementById(`loteEsperaTitle${slot}`);
    if (titleEl) titleEl.textContent = `⏱ Aguardando lote ${st.loteAtual+1}/${st.lotesTotal}...`;
    const proxBtn = document.getElementById(`btnProximoLote${slot}`);
    if (proxBtn) { proxBtn.disabled = true; proxBtn.style.background = 'var(--surface3)'; }
    const barEl = document.getElementById(`loteProgressBar${slot}`);
    if (barEl) barEl.style.width = '0%';
    notify(`✓ Lote ${st.loteAtual} concluído · próximo em ${esperaMin}min`);
    iniciarCountdownLoteChip(slot, esperaMs);
    _atualizarBotaoPausa(slot);
  } else {
    // Todos os lotes concluídos
    st.aguardandoLote = false;
    st.pausado = false;
    if (btnEl)  btnEl.disabled = false;
    if (btnTxt) btnTxt.textContent = slot === 0 ? '🟢 Disparar' : '🔵 Disparar';
    _atualizarBotaoPausa(slot);

    // Coletar erros para retry
    const erroItems = getFilaChip(chip.id).filter(f => f.status === 'erro');
    if (erroItems.length && !st.retryDisparado) {
      st.retryItems = erroItems;
      // Calcular horário sugerido: ultimoLoteFimTs + esperaMin + 30min de margem
      const retryTs = st.ultimoLoteFimTs + (esperaMin + 30) * 60 * 1000;
      const retryDate = new Date(retryTs);
      const hh = String(retryDate.getHours()).padStart(2,'0');
      const mm = String(retryDate.getMinutes()).padStart(2,'0');
      const horarioSugerido = `${hh}:${mm}`;
      // Exibir painel de retry
      exibirRetryPanel(slot, erroItems.length, horarioSugerido);
      notify(`⚠ ${erroItems.length} erro${erroItems.length>1?'s':''} — Lote Retry disponível`, 'warn');
    } else {
      const totalEnv = st.loteHistorico.reduce((s,l)=>s+l.env,0);
      const totalErr = st.loteHistorico.reduce((s,l)=>s+l.erros,0);
      notify(`✓ ${st.lotesTotal} lote${st.lotesTotal>1?'s':''} concluído${st.lotesTotal>1?'s':''} · ${totalEnv} enviados · ${totalErr} erros`);
    }
  }
}

function exibirRetryPanel(slot, count, horario) {
  const itensEl = document.getElementById(`filaItens${slot}`);
  if (!itensEl) return;
  const cor = 'var(--warning)';
  const retryHtml = `<div id="retryPanel${slot}" style="margin:8px 0;padding:12px 14px;border-radius:10px;background:rgba(240,164,41,0.06);border:1px solid rgba(240,164,41,0.3)">
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <div style="flex:1">
        <div style="font-family:'DM Mono',monospace;font-size:9px;font-weight:700;letter-spacing:0.1em;color:var(--warning);margin-bottom:3px">⚠ LOTE RETRY — ${count} empresa${count>1?'s':''} com erro</div>
        <div style="font-family:'DM Mono',monospace;font-size:8px;color:var(--muted)">Horário sugerido: <span style="color:var(--text2)">${horario}</span> · disparo manual</div>
      </div>
      <button onclick="iniciarRetryChip(${slot})" style="background:var(--warning);color:#0a0a0d;border:none;border-radius:7px;font-family:'Syne',sans-serif;font-weight:700;font-size:10px;padding:7px 14px;cursor:pointer;white-space:nowrap">↻ Disparar Retry</button>
    </div>
  </div>`;
  // Inserir antes dos itens da fila
  const existing = document.getElementById(`retryPanel${slot}`);
  if (existing) existing.outerHTML = retryHtml;
  else itensEl.insertAdjacentHTML('beforebegin', retryHtml);
}

async function iniciarRetryChip(slot) {
  const st = chipSlotState[slot];
  if (st.disparoEmAndamento || st.aguardandoLote) return;
  if (!st.retryItems || !st.retryItems.length) { notify('// nenhum item para retry','warn'); return; }
  const chip = getChipBySlot(slot); if (!chip) return;

  st.retryDisparado = true;
  // Remove painel de retry
  const rp = document.getElementById(`retryPanel${slot}`);
  if (rp) rp.remove();

  // Marcar retry items como aguardando novamente
  st.retryItems.forEach(item => { item.status = 'aguardando'; item._isRetry = true; });

  // Dispara como lote único
  st.filaLotes = [[...st.retryItems]];
  st.loteAtual = st.lotesTotal; // continua numeração
  st.lotesTotal = st.lotesTotal + 1;
  const logEl = document.getElementById(`disparoLog${slot}`);
  if (logEl) { logEl.style.display = 'block'; }
  await dispararLoteChip(slot);
}

function iniciarCountdownLoteChip(slot, duracaoMs) {
  const st = chipSlotState[slot];
  const proxBtn = document.getElementById(`btnProximoLote${slot}`);
  const countEl = document.getElementById(`loteCountdown${slot}`);
  const barEl   = document.getElementById(`loteProgressBar${slot}`);
  if (st.loteCountdownInt) clearInterval(st.loteCountdownInt);
  function tick() {
    const restante = st.loteEsperaFim - Date.now();
    if (restante <= 0) {
      clearInterval(st.loteCountdownInt); st.loteCountdownInt = null;
      if (countEl) countEl.textContent = '00:00';
      if (barEl)   barEl.style.width = '100%';
      if (proxBtn) { proxBtn.disabled = false; proxBtn.style.background = slot===0?'var(--accent)':'#5bb8f5'; }
      notify('✓ Lote liberado!');
      return;
    }
    const min = Math.floor(restante/60000), seg = Math.floor((restante%60000)/1000);
    if (countEl) countEl.textContent = `${String(min).padStart(2,'0')}:${String(seg).padStart(2,'0')}`;
    if (barEl)   barEl.style.width = Math.min(100, ((duracaoMs-restante)/duracaoMs)*100) + '%';
  }
  tick(); st.loteCountdownInt = setInterval(tick, 500);
}

function cancelarLotesChip(slot) {
  const st = chipSlotState[slot];
  if (st.loteEsperaTimer)  { clearTimeout(st.loteEsperaTimer);  st.loteEsperaTimer = null; }
  if (st.loteCountdownInt) { clearInterval(st.loteCountdownInt); st.loteCountdownInt = null; }
  st.filaLotes = []; st.loteAtual = 0; st.lotesTotal = 0;
  st.aguardandoLote = false; st.loteEsperaFim = null;
  st.pausado = false;
  const panel = document.getElementById(`loteEsperaPanel${slot}`);
  if (panel) panel.style.display = 'none';
  const btnEl  = document.getElementById(`btnDisparar${slot}`);
  const btnTxt = document.getElementById(`disparoBtn${slot}`);
  if (btnEl)  btnEl.disabled = false;
  if (btnTxt) btnTxt.textContent = slot===0 ? '🟢 Disparar' : '🔵 Disparar';
  notify('// fila cancelada','warn');
  _atualizarBotaoPausa(slot);
}

function togglePausaChip(slot) {
  const st = chipSlotState[slot];
  if (!st.disparoEmAndamento && !st.aguardandoLote) return; // só age se estiver rodando
  st.pausado = !st.pausado;
  _atualizarBotaoPausa(slot);
  if (st.pausado) {
    notify(`⏸ Chip ${slot+1} pausado — aguardando término do envio atual`, 'warn');
  } else {
    notify(`▶ Chip ${slot+1} retomado`);
  }
}

function _atualizarBotaoPausa(slot) {
  const st = chipSlotState[slot];
  const btn = document.getElementById(`btnPausa${slot}`);
  if (!btn) return;
  const ativo = st.disparoEmAndamento || st.aguardandoLote;
  btn.style.display = ativo ? 'inline-flex' : 'none';
  if (st.pausado) {
    btn.textContent = '▶ Retomar';
    btn.style.borderColor = 'var(--ok)';
    btn.style.color = 'var(--ok)';
  } else {
    btn.textContent = '⏸ Pausar';
    btn.style.borderColor = 'var(--warning)';
    btn.style.color = 'var(--warning)';
  }
}

async function confirmarProximoLoteChip(slot) {
  const st = chipSlotState[slot];
  if (!st.filaLotes.length) return;
  const proxBtn = document.getElementById(`btnProximoLote${slot}`);
  if (proxBtn) proxBtn.disabled = true;
  const panel = document.getElementById(`loteEsperaPanel${slot}`);
  if (panel) panel.style.display = 'none';
  if (st.loteCountdownInt) { clearInterval(st.loteCountdownInt); st.loteCountdownInt = null; }
  if (st.loteEsperaTimer)  { clearTimeout(st.loteEsperaTimer);   st.loteEsperaTimer = null; }
  st.aguardandoLote = false;
  await dispararLoteChip(slot);
}

function atualizarStatusFilaSlot(slot, id, status) {
  const el = document.getElementById(`fila-item-${slot}-${id}`); if (!el) return;
  el.className = `fila-item ${status}`;
  const st = el.querySelector('.fila-item-status'); if (!st) return;
  const labels = { aguardando:'aguardando', enviando:'enviando...', enviado:'✓ enviado', erro:'✗ erro' };
  st.className = `fila-item-status ${status}`; st.textContent = labels[status]||status;
}



/* ════════════════════════════
   RENDER CHIP ACCORDIONS — dinâmico, baseado nos chips cadastrados
════════════════════════════ */
const CHIP_COLORS = [
  { cor: 'var(--accent)',  corHex: '#b8f059', borderAlpha: 'rgba(184,240,89,0.25)',  bgBtn: '',                   txtBtn: '#0a0a0d', spinColor: '#0a0a0d' },
  { cor: '#5bb8f5',        corHex: '#5bb8f5', borderAlpha: 'rgba(91,184,245,0.25)',  bgBtn: '#5bb8f5',            txtBtn: '#0a0a0d', spinColor: '#0a0a0d' },
  { cor: '#c084fc',        corHex: '#c084fc', borderAlpha: 'rgba(192,132,252,0.25)', bgBtn: '#c084fc',            txtBtn: '#0a0a0d', spinColor: '#0a0a0d' },
  { cor: '#fb923c',        corHex: '#fb923c', borderAlpha: 'rgba(251,146,60,0.25)',  bgBtn: '#fb923c',            txtBtn: '#0a0a0d', spinColor: '#0a0a0d' },
];

function renderChipAccordions() {
  const chips = getChips();
  const zapRight = document.getElementById('zapRight');
  if (!zapRight) return;

  // Garante que chipSlotState tem entradas suficientes
  while (chipSlotState.length < chips.length) {
    chipSlotState.push({ filaLotes:[], loteAtual:0, lotesTotal:0, aguardandoLote:false, disparoEmAndamento:false, loteEsperaFim:null, loteEsperaTimer:null, loteCountdownInt:null, loteHistorico:[], retryItems:[], retryDisparado:false, ultimoLoteFimTs:null, pausado:false });
  }

  if (!chips.length) {
    zapRight.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;flex:1;font-family:'DM Mono',monospace;font-size:10px;color:var(--muted);padding:40px">// nenhum chip configurado</div>`;
    return;
  }

  // Salvar estado visual antes de reconstruir
  const _estadoAntes = chips.map((_, slot) => {
    const st = chipSlotState[slot];
    return {
      disparoEmAndamento: st ? st.disparoEmAndamento : false,
      aguardandoLote: st ? st.aguardandoLote : false,
      loteAtual: st ? st.loteAtual : 0,
      lotesTotal: st ? st.lotesTotal : 0,
      pausado: st ? st.pausado : false,
      accordionAberto: document.getElementById(`chipAccordion${slot}`)?.classList.contains('open') || false,
    };
  });

  zapRight.innerHTML = chips.map((chip, slot) => {
    const c = CHIP_COLORS[slot % CHIP_COLORS.length];
    const disparoIcon = slot === 0 ? '🟢' : slot === 1 ? '🔵' : '🟣';
    const bgBtnStyle  = c.bgBtn ? `background:${c.bgBtn};color:${c.txtBtn}` : '';
    const spinStyle   = `border-top-color:${c.spinColor}`;
    return `
    ${slot > 0 ? '<div style="height:1px;background:var(--border);flex-shrink:0;"></div>' : ''}
    <div class="chip-accordion" id="chipAccordion${slot}" data-slot="${slot}">
      <div class="chip-accordion-header" onclick="toggleChipAccordion(${slot})" style="border-color:${c.borderAlpha}">
        <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0">
          <span style="font-size:11px;font-weight:700;letter-spacing:0.08em;color:${c.cor}">CHIP ${slot+1}</span>
          <span id="chip${slot+1}Label" style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted);text-transform:none;letter-spacing:0;font-weight:400;">· ${escHtml(chip.nome)}</span>
          <span id="filaCount${slot}" style="font-family:'DM Mono',monospace;font-size:8px;color:var(--muted);margin-left:auto;white-space:nowrap">(0 empresas)</span>
        </div>
        <div class="chip-accordion-chevron" id="chevron${slot}">▶</div>
      </div>
      <div class="chip-accordion-body" id="chipBody${slot}">
        <div style="padding:16px;border-bottom:1px solid var(--border);flex-shrink:0">
          <div style="margin-bottom:12px">
            <label>Chip</label>
            <div id="chip${slot+1}Info" style="font-family:'DM Mono',monospace;font-size:10px;color:var(--text2);padding:8px 12px;background:var(--surface2);border-radius:8px;border:1px solid var(--border2)">${escHtml(chip.nome)} · ${escHtml(chip.instance)}</div>
          </div>
          <div style="display:flex;gap:8px;margin-bottom:0">
            <button class="btn btn-danger" style="font-size:11px" onclick="limparFilaChip(${slot})">Limpar fila</button>
            <button class="btn btn-ghost" id="btnPausa${slot}" onclick="togglePausaChip(${slot})" style="display:none;font-size:11px;border-color:var(--warning);color:var(--warning)">⏸ Pausar</button>
            <button class="btn btn-primary" style="flex:1;${bgBtnStyle}" id="btnDisparar${slot}" onclick="iniciarDisparoChip(${slot})">
              <div class="spinner" id="spinner${slot}" style="${spinStyle}"></div>
              <span id="disparoBtn${slot}">${disparoIcon} Disparar</span>
            </button>
          </div>
          <div class="lote-espera-panel" id="loteEsperaPanel${slot}" style="display:none;margin-top:10px">
            <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
              <div style="flex:1">
                <div style="font-family:'DM Mono',monospace;font-size:10px;color:${c.cor};margin-bottom:4px" id="loteEsperaTitle${slot}">⏱ Aguardando lote...</div>
                <div style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted)">Próximo lote em <span id="loteCountdown${slot}" style="color:var(--text2)">--:--</span></div>
              </div>
              <button class="btn btn-ghost" style="font-size:10px;border-color:var(--warning);color:var(--warning)" onclick="cancelarLotesChip(${slot})">✕</button>
              <button class="btn btn-primary" style="width:auto;font-size:11px;${bgBtnStyle}" id="btnProximoLote${slot}" onclick="confirmarProximoLoteChip(${slot})" disabled>Próximo →</button>
            </div>
            <div style="margin-top:8px;background:var(--surface2);border-radius:6px;height:3px;overflow:hidden">
              <div id="loteProgressBar${slot}" style="height:100%;background:${c.cor};width:0%;transition:width 0.5s linear"></div>
            </div>
          </div>
        </div>
        <div style="padding:12px 16px 6px;flex-shrink:0">
          <div style="font-family:'DM Mono',monospace;font-size:8px;letter-spacing:0.12em;color:${c.cor};text-transform:uppercase;margin-bottom:8px">Fila Chip ${slot+1}</div>
          <div id="chip${slot+1}FilaButtons" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px"></div>
        </div>
        <div class="chip-fila-scroll" id="chip${slot}FilaScroll">
          <div class="fila-empty" id="filaVazia${slot}">Nenhuma empresa na fila.</div>
          <div class="fila-items" id="filaItens${slot}" style="display:none;padding:0 16px 16px"></div>
        </div>
        <div class="disparo-log" id="disparoLog${slot}"></div>
      </div>
    </div>`;
  }).join('');

  // Restaurar estado visual dos chips que estavam em andamento
  chips.forEach((chip, slot) => {
    const est = _estadoAntes[slot];
    if (!est) return;
    if (est.accordionAberto) {
      const acc = document.getElementById(`chipAccordion${slot}`);
      if (acc) acc.classList.add('open');
    }
    const btnEl  = document.getElementById(`btnDisparar${slot}`);
    const spinEl = document.getElementById(`spinner${slot}`);
    const btnTxt = document.getElementById(`disparoBtn${slot}`);
    const pausaEl = document.getElementById(`btnPausa${slot}`);
    if (est.disparoEmAndamento) {
      if (btnEl)  btnEl.disabled = true;
      if (spinEl) spinEl.style.display = 'block';
      if (btnTxt) btnTxt.textContent = est.pausado
        ? `⏸ Pausado (${est.loteAtual}/${est.lotesTotal})`
        : `⏳ Enviando lote ${est.loteAtual}/${est.lotesTotal}...`;
      if (pausaEl) pausaEl.style.display = 'inline-flex';
    } else if (est.aguardandoLote) {
      if (btnEl)  btnEl.disabled = true;
      if (btnTxt) btnTxt.textContent = `⏱ Aguardando próximo lote...`;
      const panel = document.getElementById(`loteEsperaPanel${slot}`);
      if (panel) panel.style.display = 'block';
    }
  });
}

function renderFilaZap() {
  sincronizarFilaComEnviados();
  const chips = getChips();
  const weekDays = currentWeekDays();
  const today = todayStr();

  // Só reconstrói os accordions se nenhum disparo estiver em andamento
  // (evita resetar botão/spinner ao trocar de aba durante o envio)
  const disparoAtivo = chipSlotState.some(st => st.disparoEmAndamento || st.aguardandoLote);
  if (!disparoAtivo) {
    renderChipAccordions();
  }

  // Populate chip panels (labels/info já inseridos pelo renderChipAccordions)
  chips.forEach((chip, slot) => {
    const infoEl  = document.getElementById(`chip${slot+1}Info`);
    const labelEl = document.getElementById(`chip${slot+1}Label`);
    if (infoEl)  infoEl.textContent  = `${chip.nome} · ${chip.instance}`;
    if (labelEl) labelEl.textContent = `· ${chip.nome}`;
  });

  // Set disparoChipId for empresa listing (use chip[0] by default)
  if (!disparoChipId && chips.length) disparoChipId = chips[0].id;

  if (!weekDays.includes(disparoDay) && disparoDay !== 'backlog') disparoDay = today;

  const backlogCount = getZapBacklog().length;
  const backlogTab = `<div class="day-tab${disparoDay==='backlog'?' active':''}" onclick="setDisparoDay('backlog')"
    style="${disparoDay==='backlog'?'':''}">
    📦 Backlog
    ${backlogCount>0?`<span class="day-count">${backlogCount}</span>`:''}
  </div>`;

  document.getElementById('disparoDayTabs').innerHTML = backlogTab + weekDays.map(day => {
    const data  = ensureWeekData();
    const count = (data.days[day]||[]).filter(e => e.whatsapp && (e.status||'Não enviada')==='Não enviada').length;
    const active= day === disparoDay;
    return `<div class="day-tab${active?' active':''}" onclick="setDisparoDay('${day}')">
      ${dayLabel(day)}${day===today?' <span style="color:var(--accent);font-size:8px">●</span>':''}
      ${count>0?`<span class="day-count">${count}</span>`:''}
    </div>`;
  }).join('');

  if (disparoDay === 'backlog') {
    renderZapBacklogPanel();
  } else {
    renderDisparoEmpresas();
    chips.forEach((_, s) => renderFilaSlot(s, disparoDay));
    if (!chips.length) { /* nada a renderizar */ }
  }
}

/* ════════════════════════════
   RENDER DISPARO EMPRESAS
   Popula disparoStatusTabs + disparoEmpresasList
════════════════════════════ */
function renderDisparoEmpresas() {
  const data     = ensureWeekData();
  const chips    = getChips();
  const weekDays = currentWeekDays();
  if (!weekDays.includes(disparoDay)) disparoDay = todayStr();

  const emps = data.days[disparoDay] || [];

  // ── Status tabs ──
  const statusTabsEl = document.getElementById('disparoStatusTabs');
  if (statusTabsEl) {
    const counts = {};
    STATUS_OPTIONS.forEach(s => { counts[s] = emps.filter(e => (e.status||'Não enviada')===s).length; });
    statusTabsEl.innerHTML = STATUS_OPTIONS.map(s =>
      `<div class="status-tab${disparoStatus===s?' active':''}" onclick="setDisparoStatus('${s}')">
        ${s} <span class="st-count">${counts[s]}</span>
      </div>`
    ).join('');
  }

  // ── Stats row ──
  const statsEl = document.getElementById('disparoStats');
  if (statsEl) {
    const total   = emps.length;
    const comWa   = emps.filter(e => e.whatsapp).length;
    const emFila  = emps.filter(e => (e.status||'Não enviada')==='Em fila').length;
    const enviado = emps.filter(e => (e.status||'Não enviada')==='Enviada').length;
    statsEl.innerHTML = total
      ? `<span style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted)">${total} leads · <span style="color:var(--ok)">${comWa} com WhatsApp</span> · <span style="color:var(--accent)">${emFila} na fila</span> · <span style="color:var(--text2)">${enviado} enviados</span></span>`
      : '';
  }

  // ── Lista de empresas ──
  const listEl = document.getElementById('disparoEmpresasList');
  if (!listEl) return;

  const filtered = emps.filter(e => (e.status||'Não enviada') === disparoStatus);
  const totalItems = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / DISPARO_PG));
  if (disparoPage > totalPages) disparoPage = totalPages;
  const pageItems = filtered.slice((disparoPage-1)*DISPARO_PG, disparoPage*DISPARO_PG);

  if (!totalItems) {
    listEl.innerHTML = `<div style="font-family:'DM Mono',monospace;font-size:10px;color:var(--muted);text-align:center;padding:32px">// nenhuma empresa com status "${disparoStatus}" neste dia</div>`;
    renderPagination('disparoPagination', 1, 1, 0, DISPARO_PG, 'goDisparoPage', 'changeDisparoPgSize');
    return;
  }

  listEl.innerHTML = pageItems.map(e => {
    const googleUrl = e.googleUrl || '';
    const nomeDisplay = googleUrl
      ? `<a href="${escHtml(googleUrl)}" target="_blank" style="color:var(--text);text-decoration:none">${escHtml(e.nome)}</a>`
      : escHtml(e.nome);

    // Verificar em qual chip está na fila — cruza fila do chip com status real do lead
    const empStatus = e.status || 'Não enviada';
    const emFilaReal = empStatus === 'Em fila';
    const naFila = chips.map((c, slot) => {
      const fila = getFilaChip(c.id);
      const idx  = fila.findIndex(f => f.id === e.id);
      // Se está na fila do chip mas o status do lead não é "Em fila", remove a entrada fantasma
      if (idx >= 0 && !emFilaReal) {
        fila.splice(idx, 1);
        saveFilaDisparo();
        return { slot, nome: c.nome, naFila: false };
      }
      return { slot, nome: c.nome, naFila: idx >= 0 };
    });

    const botoes = chips.map((c, slot) => {
      const { naFila: emFila } = naFila[slot];
      const cor    = slot === 0 ? 'var(--accent)' : '#5bb8f5';
      const corBg  = slot === 0 ? 'rgba(184,240,89,0.08)' : 'rgba(91,184,245,0.08)';
      const qtdNoDia = getFilaChipNoDia(c.id, disparoDay).length;
      const cheio  = !emFila && qtdNoDia >= CHIP_LIMIT;
      const label  = emFila ? `✓ C${slot+1}` : cheio ? `✕ C${slot+1}` : `+ C${slot+1}`;
      const title  = emFila
        ? `Remover do Chip ${slot+1} — ${escHtml(c.nome)}`
        : cheio
          ? `Chip ${slot+1} cheio (${CHIP_LIMIT}/${CHIP_LIMIT}) · clique para redirecionar ao próximo disponível`
          : `Adicionar ao Chip ${slot+1} — ${escHtml(c.nome)} (${qtdNoDia}/${CHIP_LIMIT})`;
      return `<button onclick="toggleFilaSlotEmpresa(${slot},'${e.id}')"
        style="font-family:'DM Mono',monospace;font-size:8px;padding:4px 10px;border-radius:6px;cursor:pointer;border:1px solid ${emFila?cor:cheio?'rgba(255,92,92,0.4)':'var(--border2)'};background:${emFila?corBg:cheio?'rgba(255,92,92,0.06)':'transparent'};color:${emFila?cor:cheio?'var(--error)':'var(--muted)'};transition:all 0.15s;white-space:nowrap"
        title="${title}">
        ${label}
      </button>`;
    }).join('');

    const semChip = chips.length === 0;
    const isEnviada = STATUS_FORWARD_ONLY.includes(e.status||'') || (e.status||'') === 'Enviada';

    return `<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid var(--border);font-size:11px">
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${nomeDisplay}</div>
        <div style="font-family:'DM Mono',monospace;font-size:9px;color:var(--text2);display:flex;gap:8px;flex-wrap:wrap;margin-top:2px">
          ${e.whatsapp?`<span style="color:var(--ok)">📱 ${escHtml(e.whatsapp)}</span>`:'<span style="color:var(--error)">sem WhatsApp</span>'}
          ${e.site?`<a href="${escHtml(e.site)}" target="_blank" style="color:var(--muted);text-decoration:none">${escHtml(e.site.replace(/^https?:\/\/(www\.)?/,'').split('/')[0])}</a>`:''}
        </div>
      </div>
      <div style="display:flex;gap:4px;flex-shrink:0;align-items:center">
        <button class="lead-drawer-open-btn" onclick="openLeadDrawer('${e.id}')">Ficha</button>
        ${isEnviada
          ? `<span style="font-family:'DM Mono',monospace;font-size:8px;color:var(--ok)">✓ enviado</span>`
          : semChip
            ? `<span style="font-family:'DM Mono',monospace;font-size:8px;color:var(--muted)">configure chips primeiro</span>`
            : (e.whatsapp ? botoes : `<span style="font-family:'DM Mono',monospace;font-size:8px;color:var(--error)">sem WhatsApp</span>`)
        }
        <button onclick="moverParaBacklogZapDoDia('${e.id}','${disparoDay}')" title="Mover para Backlog Zap"
          style="background:none;border:1px solid var(--border2);color:var(--muted);border-radius:6px;font-family:'DM Mono',monospace;font-size:8px;padding:3px 8px;cursor:pointer;transition:all 0.15s;margin-left:2px"
          onmouseover="this.style.borderColor='var(--accent)';this.style.color='var(--accent)'"
          onmouseout="this.style.borderColor='var(--border2)';this.style.color='var(--muted)'">↩</button>
        <button onclick="abrirModalExcluirLead('${e.id}','${disparoDay}')"
          title="Excluir lead da plataforma"
          style="background:none;border:1px solid transparent;color:var(--muted);border-radius:6px;font-family:'DM Mono',monospace;font-size:10px;padding:3px 7px;cursor:pointer;transition:all 0.18s;margin-left:2px"
          onmouseover="this.style.borderColor='var(--error)';this.style.color='var(--error)';this.style.background='rgba(255,92,92,0.06)'"
          onmouseout="this.style.borderColor='transparent';this.style.color='var(--muted)';this.style.background='none'">✕</button>
      </div>
    </div>`;
  }).join('');

  renderPagination('disparoPagination', disparoPage, totalPages, totalItems, DISPARO_PG, 'goDisparoPage', 'changeDisparoPgSize');
}

function setDisparoChip(id) {
  disparoChipId = id;
  renderFilaZap();
}

/* ─── Accordion dos Chips (layout 50/50) ─── */
function toggleChipAccordion(slot) {
  const chips = getChips();
  // Fecha todos os outros accordions
  chips.forEach((_, s) => {
    if (s !== slot) {
      const acc = document.getElementById('chipAccordion' + s);
      if (acc) acc.classList.remove('open');
    }
  });
  // Toggle o clicado
  const accSel = document.getElementById('chipAccordion' + slot);
  if (accSel) accSel.classList.toggle('open');
}

function setDisparoDay(day) { disparoDay = day; disparoStatus = 'Não enviada'; disparoPage = 1; renderFilaZap(); }
function setDisparoStatus(st) { disparoStatus = st; disparoPage = 1; renderDisparoEmpresas(); }

function renderFila0() { renderFilaSlot(0, disparoDay); }
function renderFila1() { renderFilaSlot(1, disparoDay); }

function renderFilaSlot(slot, filterDay) {
  const today = todayStr();
  const dayFiltro = filterDay || disparoDay || today;
  const isToday = dayFiltro === today;
  const chips = getChips();
  const chip = chips[slot] || null;
  const chipId = chip ? chip.id : null;
  const st = chipSlotState[slot];

  // Filtrar fila pelo dia selecionado: cruzar IDs da fila com empresas do dia
  const filaGlobal = chipId ? getFilaChip(chipId) : [];
  const data = ensureWeekData();
  const idsNoDia = new Set((data.days[dayFiltro]||[]).map(e => e.id));
  const filaCompleta = filaGlobal.filter(f => idsNoDia.has(f.id));

  const countEl = document.getElementById(`filaCount${slot}`);
  const vaziEl  = document.getElementById(`filaVazia${slot}`);
  const itensEl = document.getElementById(`filaItens${slot}`);
  if (!countEl) return;

  // Botao Disparar: desativado se o dia selecionado nao for hoje
  const btnDisparar = document.getElementById(`btnDisparar${slot}`);
  const btnTxt = document.getElementById(`disparoBtn${slot}`);
  if (btnDisparar && !st.disparoEmAndamento && !st.aguardandoLote) {
    if (!isToday) {
      btnDisparar.disabled = true;
      btnDisparar.title = 'Disparo disponivel apenas no dia de hoje';
      if (btnTxt) btnTxt.textContent = slot === 0 ? '🟢 Disponivel em ' + dayLabelShort(dayFiltro) : '🔵 Disponivel em ' + dayLabelShort(dayFiltro);
    } else {
      btnDisparar.disabled = false;
      btnDisparar.title = '';
      if (btnTxt) btnTxt.textContent = slot === 0 ? '🟢 Disparar' : '🔵 Disparar';
    }
  }

  // Contagem: aguardando/erro ativos (do dia filtrado)
  const aguardando = filaCompleta.filter(f => f.status === 'aguardando').length;
  const erros = filaCompleta.filter(f => f.status === 'erro').length;
  const enviados = filaCompleta.filter(f => f.status === 'enviado').length;
  const totalNoDia = filaCompleta.length;
  const cheio = totalNoDia >= CHIP_LIMIT;
  countEl.textContent = `(${totalNoDia}/${CHIP_LIMIT} · ${aguardando} aguardando · ${erros} erro · ${enviados} enviado${enviados!==1?'s':''})`;
  countEl.style.color = cheio ? 'var(--error)' : totalNoDia >= CHIP_LIMIT * 0.8 ? 'var(--warning)' : '';
  const vazia = filaCompleta.length === 0 && (!st.loteHistorico || !st.loteHistorico.length);
  vaziEl.style.display  = vazia ? 'block' : 'none';
  itensEl.style.display = vazia ? 'none'  : 'flex';
  if (vazia) { itensEl.innerHTML = ''; return; }

  const LOTE_SIZE = getLoteSize();
  let html = '';

  // ── Histórico de lotes já disparados ──
  (st.loteHistorico || []).forEach(lhist => {
    const todosEnviados = lhist.items.every(i => i.status === 'enviado');
    const cor    = todosEnviados ? 'var(--ok)' : 'var(--warning)';
    const border = todosEnviados ? 'rgba(78,203,113,0.25)' : 'rgba(240,164,41,0.25)';
    const bg     = todosEnviados ? 'rgba(78,203,113,0.04)' : 'rgba(240,164,41,0.04)';
    const label  = `LOTE ${lhist.num} — ${lhist.env}/${lhist.items.length} enviados`;
    const histId = `lote-hist-${slot}-${lhist.num}`;
    html += `<div style="margin-bottom:6px;border-radius:8px;background:${bg};border:1px solid ${border};overflow:hidden">
      <div style="display:flex;align-items:center;gap:10px;padding:7px 12px;cursor:pointer" onclick="toggleLoteHist('${histId}')">
        <span style="font-family:'DM Mono',monospace;font-size:9px;font-weight:700;letter-spacing:0.1em;color:${cor}">${label}</span>
        <span style="flex:1;height:1px;background:${border}"></span>
        <span style="font-family:'DM Mono',monospace;font-size:8px;color:var(--muted)">${todosEnviados?'✓ concluído':'parcial'}</span>
        <span id="${histId}-chev" style="font-size:9px;color:var(--muted);transition:transform 0.2s">▶</span>
      </div>
      <div id="${histId}" style="display:none;border-top:1px solid ${border}">
        ${lhist.items.map(item => {
          const ok = item.status === 'enviado';
          return `<div style="display:flex;align-items:center;gap:10px;padding:5px 12px;border-bottom:1px solid ${border};font-size:10px">
            <span style="font-family:'DM Mono',monospace;font-size:9px;color:${ok?'var(--ok)':'var(--error)'};flex-shrink:0">${ok?'✓':'✗'}</span>
            <span style="flex:1;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(item.nome)}</span>
            <span style="font-family:'DM Mono',monospace;font-size:8px;color:var(--muted)">${item.whatsapp||''}</span>
          </div>`;
        }).join('')}
      </div>
    </div>`;
  });

  // ── Itens ativos ──
  // Usamos filaCompleta para agrupar lotes corretamente (enviados ocupam posição no lote)
  // e renderizamos todos — enviados aparecem com badge verde e sem interação de edição
  const loteHistLen = (st.loteHistorico||[]).length;
  const imgSrcsToSet = []; // { id, src } para setar após innerHTML

  // Agrupar filaCompleta em lotes de LOTE_SIZE
  const lotes = [];
  for (let i = 0; i < filaCompleta.length; i += LOTE_SIZE) {
    lotes.push(filaCompleta.slice(i, i + LOTE_SIZE));
  }

  lotes.forEach((loteItems, loteIdx) => {
    const loteNum = loteHistLen + loteIdx + 1;
    const pendentesNoLote = loteItems.filter(f => f.status !== 'enviado').length;
    const totalNoLote = loteItems.length;
    const todosEnviados = loteItems.every(f => f.status === 'enviado');
    // Lote é "completo" se tem LOTE_SIZE itens OU se não é o último (lotes intermediários sempre são completos)
    const isUltimoLote = loteIdx === lotes.length - 1;
    const completo = totalNoLote >= LOTE_SIZE || !isUltimoLote;
    const cor = todosEnviados ? 'var(--ok)' : completo ? 'var(--accent)' : 'var(--warning)';
    const borderCor = todosEnviados ? 'rgba(78,203,113,0.25)' : completo ? 'rgba(184,240,89,0.25)' : 'rgba(240,164,41,0.25)';
    const bgCor = todosEnviados ? 'rgba(78,203,113,0.04)' : completo ? 'rgba(184,240,89,0.05)' : 'rgba(240,164,41,0.05)';

    let label;
    if (todosEnviados) {
      label = `LOTE ${loteNum} — todos enviados`;
    } else if (completo) {
      label = `LOTE ${loteNum} — #${loteIdx*LOTE_SIZE+1}–${loteIdx*LOTE_SIZE+totalNoLote}`;
    } else {
      label = `LOTE ${loteNum} — #${loteIdx*LOTE_SIZE+1}–${loteIdx*LOTE_SIZE+totalNoLote} (${pendentesNoLote} aguardando)`;
    }

    const loteRamoId = getLoteRamo(chipId, loteNum);
    const loteImg    = getLoteImagem(chipId, loteNum); // do cache em memória
    const imgIdbKey  = getLoteImgKey(chipId, loteNum);
    const ramosOpts  = getRamos().map(r=>`<option value="${r.id}"${loteRamoId===r.id?' selected':''} style="background:var(--surface3)">${escHtml(r.nome)}</option>`).join('');
    const imgPreviewId = `lote-img-preview-${slot}-${loteNum}`;
    if (loteImg) imgSrcsToSet.push({ id: imgPreviewId, src: loteImg });

    html += `<div style="margin:${loteIdx===0&&!loteHistLen?'0':'10px'} 0 6px;border-radius:8px;background:${bgCor};border:1px solid ${borderCor};overflow:hidden">
      <div style="display:flex;align-items:center;gap:10px;padding:7px 12px">
        <span style="font-family:'DM Mono',monospace;font-size:9px;font-weight:700;letter-spacing:0.12em;color:${cor}">${label}</span>
        <span style="flex:1;height:1px;background:${borderCor}"></span>
        ${todosEnviados?'<span style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--ok)">✓ concluído</span>':!completo?`<span style="font-family:'DM Mono',monospace;font-size:8px;color:var(--warning)">${LOTE_SIZE-totalNoLote} restantes</span>`:'<span style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--accent)">✓ completo</span>'}
      </div>
      <div style="display:flex;align-items:flex-start;gap:10px;padding:0 12px 10px;border-top:1px solid ${borderCor}">
        <div style="flex:1">
          <div style="font-family:'DM Mono',monospace;font-size:7px;letter-spacing:0.1em;color:var(--muted);margin-bottom:4px;padding-top:8px">RAMO DO TEMPLATE</div>
          <select style="background:var(--surface3);border:1px solid var(--border2);border-radius:6px;color:var(--text2);font-family:'DM Mono',monospace;font-size:9px;padding:5px 8px;width:100%;outline:none" onchange="onLoteRamoChange('${chipId}',${loteNum},this.value,true,${slot})">
            <option value="" style="background:var(--surface3)">— sem ramo (geral) —</option>
            ${ramosOpts}
          </select>
        </div>
        <div style="flex-shrink:0;min-width:130px">
          <div style="font-family:'DM Mono',monospace;font-size:7px;letter-spacing:0.1em;color:var(--accent);margin-bottom:4px;padding-top:8px">IMAGEM DO LOTE</div>
          <div class="fila-img-area${loteImg?' has-img':''}" onclick="document.getElementById('lote-img-s${slot}-${loteNum}').click()">
            ${loteImg
              ? `<img id="${imgPreviewId}" data-lote-img-key="${imgIdbKey}" alt="preview" style="max-width:100%;max-height:100px;object-fit:contain;border-radius:5px;display:block"/>
                 <div class="fila-img-ok" style="font-family:'DM Mono',monospace;font-size:9px;color:var(--ok);font-weight:700;margin-top:4px">✓ imagem inserida</div>
                 <button class="fila-remove-btn" onclick="event.stopPropagation();onLoteImgRemove('${chipId}',${loteNum},true,${slot})">×</button>`
              : `<img id="${imgPreviewId}" data-lote-img-key="${imgIdbKey}" alt="" style="display:none;max-width:100%;max-height:100px;object-fit:contain;border-radius:5px"/>
                 <div class="fila-img-ok" style="display:none;font-family:'DM Mono',monospace;font-size:9px;color:var(--ok);font-weight:700;margin-top:4px">✓ imagem inserida</div>
                 <button class="fila-remove-btn" style="display:none" onclick="event.stopPropagation();onLoteImgRemove('${chipId}',${loteNum},true,${slot})">×</button>
                 <span class="fila-img-label">📎 clique para inserir</span>`
            }
          </div>
          <input type="file" accept="image/*" class="fila-img-input" id="lote-img-s${slot}-${loteNum}" onchange="onLoteImgChange('${chipId}',${loteNum},this,true,${slot})"/>
        </div>
      </div>
    </div>`;

    // Renderizar itens do lote
    loteItems.forEach((item, itemIdx) => {
      const waNum = item.whatsapp.replace(/\D/g,'');
      const labels = { aguardando:'aguardando', enviando:'enviando...', enviado:'✓ enviado', erro:'✗ erro' };
      const aberto = item.aberto || false;
      const isEnviado = item.status === 'enviado';
      const isErro = item.status === 'erro';
      const posGlobal = loteIdx * LOTE_SIZE + itemIdx + 1;

      if (isEnviado) {
        // Enviados: linha compacta, sem edição, sem botão remover
        html += `<div class="fila-item enviado" id="fila-item-${slot}-${item.id}" style="opacity:0.55">
          <div class="fila-item-header" style="cursor:default">
            <div class="fila-item-num" style="color:var(--muted)">${posGlobal}</div>
            <div class="fila-item-nome" style="color:var(--muted)">${escHtml(item.nome)}</div>
            <div class="fila-item-wa" style="color:var(--muted)">+${waNum}</div>
            <div class="fila-item-status enviado">✓ enviado</div>
            <button class="lead-drawer-open-btn" onclick="event.stopPropagation();openLeadDrawer('${item.id}')">Ficha</button>
          </div>
        </div>`;
      } else {
        html += `<div class="fila-item ${item.status}" id="fila-item-${slot}-${item.id}">
          <div class="fila-item-header" onclick="toggleFilaItemSlot(${slot},'${item.id}')" style="cursor:pointer;user-select:none">
            <div class="fila-item-num">${posGlobal}</div>
            <div class="fila-item-nome">${item.site ? `<a href="${escHtml(item.site)}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none" title="${escHtml(item.site)}" onclick="event.stopPropagation()">${escHtml(item.nome)}</a>` : escHtml(item.nome)}</div>
            <div class="fila-item-wa">+${waNum}</div>
            <div class="fila-item-status ${item.status}">${labels[item.status]||item.status}</div>
            <button class="lead-drawer-open-btn" onclick="event.stopPropagation();openLeadDrawer('${item.id}')">Ficha</button>
            <div style="color:var(--muted);font-size:12px;margin-left:4px;transition:transform 0.2s;transform:rotate(${aberto?'90':'0'}deg)">▶</div>
            ${!isErro?`<button class="fila-remove-btn" style="position:static;top:auto;right:auto;width:22px;height:22px" onclick="event.stopPropagation();removerFilaSlot(${slot},'${item.id}')">×</button>`:''}
          </div>
          <div class="fila-item-body" style="display:${aberto?'flex':'none'}">
            <div style="width:100%">
              <div style="font-family:'DM Mono',monospace;font-size:8px;color:var(--muted);margin-bottom:4px">① APRESENTAÇÃO</div>
              <textarea class="fila-msg-area" id="fila-msg-${slot}-${item.id}" style="background:var(--surface2);border-radius:8px;padding:10px 12px;font-family:'DM Mono',monospace;font-size:9px;color:var(--text2);line-height:1.7;min-height:80px;border:1px solid var(--border2);resize:vertical;width:100%;outline:none" oninput="atualizarMsgFilaSlot(${slot},'${item.id}',this.value)">${escHtml(item.mensagem||'')}</textarea>
              <button class="fila-msg-shuffle" onclick="shuffleFilaMsgSlot(${slot},'${item.id}')">↻ sortear</button>
            </div>
          </div>
        </div>`;
      }
    });
  });

  itensEl.innerHTML = html;

  // Setar src das imagens que ja estao no cache em memoria
  imgSrcsToSet.forEach(({ id, src }) => {
    const el = document.getElementById(id);
    if (el) el.src = src;
  });

  // Para lotes cujo cache ainda nao tem nada, busca do IDB de forma assincrona
  lotes.forEach((loteItems, loteIdx) => {
    const loteNum2 = loteHistLen + loteIdx + 1;
    const k = getLoteImgKey(chipId, loteNum2);
    if (_imgCache[k] !== undefined) return; // ja carregado (null ou base64)
    _imgCache[k] = null; // marca como "carregando" para nao buscar de novo
    idbGet(k).then(val => {
      if (!val) return;
      _imgCache[k] = val;
      const imgEl = document.getElementById(`lote-img-preview-${slot}-${loteNum2}`);
      if (!imgEl) return;
      imgEl.src = val;
      imgEl.style.display = 'block';
      const wrapper = imgEl.closest('.fila-img-area');
      if (wrapper) {
        wrapper.classList.add('has-img');
        const label = wrapper.querySelector('.fila-img-label');
        if (label) label.style.display = 'none';
        const ok = wrapper.querySelector('.fila-img-ok');
        if (ok) ok.style.display = 'flex';
        const rmBtn = wrapper.querySelector('.fila-remove-btn');
        if (rmBtn) rmBtn.style.display = 'flex';
      }
    }).catch(() => {});
  });
}

function toggleLoteHist(id) {
  const el = document.getElementById(id);
  const chev = document.getElementById(id + '-chev');
  if (!el) return;
  const open = el.style.display !== 'none';
  el.style.display = open ? 'none' : 'block';
  if (chev) chev.style.transform = open ? 'rotate(0deg)' : 'rotate(90deg)';
}



// ── Configuração por lote (ramo — sem imagem aqui) ────────────────
const LOTE_CFG_KEY = 'vs_lote_cfg_v1';
function getLoteCfg() {
  try { return JSON.parse(localStorage.getItem(LOTE_CFG_KEY)||'{}'); } catch(e) { return {}; }
}
function saveLoteCfg(cfg) {
  try { localStorage.setItem(LOTE_CFG_KEY, JSON.stringify(cfg)); } catch(e) {}
}
function getLoteCfgKey(chipId, loteNum) { return `chip-${chipId}-lote-${loteNum}`; }
function getLoteRamo(chipId, loteNum) {
  const cfg = getLoteCfg();
  return (cfg[getLoteCfgKey(chipId, loteNum)] || {}).ramoId || null;
}
function setLoteRamo(chipId, loteNum, ramoId) {
  const cfg = getLoteCfg();
  const k = getLoteCfgKey(chipId, loteNum);
  if (!cfg[k]) cfg[k] = {};
  cfg[k].ramoId = ramoId || null;
  saveLoteCfg(cfg);
}

// ── IndexedDB para imagens de lote (suporta arquivos grandes >5MB) ──
const IDB_NAME = 'vs_lote_imgs';
const IDB_STORE = 'imgs';
let _idb = null;
function abrirIDB() {
  if (_idb) return Promise.resolve(_idb);
  return new Promise((res, rej) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore(IDB_STORE);
    req.onsuccess = e => { _idb = e.target.result; res(_idb); };
    req.onerror   = e => rej(e.target.error);
  });
}
function idbSet(key, value) {
  return abrirIDB().then(db => new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    const req = tx.objectStore(IDB_STORE).put(value, key);
    req.onsuccess = () => res();
    req.onerror   = e => rej(e.target.error);
  }));
}
function idbGet(key) {
  return abrirIDB().then(db => new Promise((res, rej) => {
    const req = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(key);
    req.onsuccess = e => res(e.target.result || null);
    req.onerror   = e => rej(e.target.error);
  }));
}
function idbDel(key) {
  return abrirIDB().then(db => new Promise((res, rej) => {
    const req = db.transaction(IDB_STORE, 'readwrite').objectStore(IDB_STORE).delete(key);
    req.onsuccess = () => res();
    req.onerror   = e => rej(e.target.error);
  }));
}
function idbGetAllKeys() {
  return abrirIDB().then(db => new Promise((res, rej) => {
    const req = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).getAllKeys();
    req.onsuccess = e => res(e.target.result || []);
    req.onerror   = e => rej(e.target.error);
  }));
}

// Cache em memória para imagens já carregadas nesta sessão
const _imgCache = {};

function getLoteImgKey(chipId, loteNum) { return `chip-${chipId}-lote-${loteNum}`; }

// Retorna a imagem do cache síncrono (pode ser null enquanto ainda não carregou)
function getLoteImagem(chipId, loteNum) {
  return _imgCache[getLoteImgKey(chipId, loteNum)] || null;
}

// Carrega a imagem do IDB para o cache e re-renderiza o slot
function carregarImagensLote(chipId, loteNum, slot, isSlot) {
  const k = getLoteImgKey(chipId, loteNum);
  if (_imgCache[k] !== undefined) return; // já carregado
  idbGet(k).then(val => {
    _imgCache[k] = val || null;
    if (val) {
      // Atualiza apenas o elemento de preview sem re-renderizar tudo
      const previewEls = document.querySelectorAll(`[data-lote-img-key="${k}"]`);
      previewEls.forEach(el => {
        el.src = val;
        const wrapper = el.closest('.fila-img-area');
        if (wrapper) {
          wrapper.classList.add('has-img');
          // Garante que o label de placeholder não apareça
          const label = wrapper.querySelector('.fila-img-label');
          if (label) label.style.display = 'none';
          const ok = wrapper.querySelector('.fila-img-ok');
          if (ok) ok.style.display = '';
          const rmBtn = wrapper.querySelector('.fila-remove-btn');
          if (rmBtn) rmBtn.style.display = '';
        }
      });
    }
  }).catch(() => {});
}

function setLoteImagem(chipId, loteNum, base64, nome) {
  const k = getLoteImgKey(chipId, loteNum);
  _imgCache[k] = base64 || null;
  return idbSet(k, base64 || null);
}

function removerLoteImagem(chipId, loteNum) {
  const k = getLoteImgKey(chipId, loteNum);
  _imgCache[k] = null;
  return idbDel(k);
}

// Limpa imagens de lotes que já não existem em nenhum chip (limpeza automática)
function limparImagensOlfas() {
  const chips = getChips();
  idbGetAllKeys().then(keys => {
    keys.forEach(k => {
      const m = k.match(/^chip-(.+)-lote-(\d+)$/);
      if (!m) return;
      const chipId = m[1], loteNum = parseInt(m[2]);
      const chip = chips.find(c => c.id === chipId);
      if (!chip) { idbDel(k); delete _imgCache[k]; return; }
      const fila = getFilaChip(chipId);
      const LOTE_SIZE = getLoteSize();
      const maxLote = Math.ceil(fila.length / LOTE_SIZE);
      if (loteNum > maxLote) { idbDel(k); delete _imgCache[k]; }
    });
  }).catch(() => {});
}

function onLoteRamoChange(chipId, loteNum, ramoId, isSlot, slot) {
  setLoteRamo(chipId, loteNum, ramoId);
  const LOTE_SIZE = getLoteSize();
  // Usa fila filtrada pelo dia — mesmos itens e mesma ordem que o render
  const filaDia = getFilaChipNoDia(chipId, disparoDay);
  const loteIdx = loteNum - 1;
  const inicio = loteIdx * LOTE_SIZE;
  const fim = Math.min(inicio + LOTE_SIZE, filaDia.length);
  // Atualiza os itens por referência (eles existem também em filaDisparo[chipId])
  for (let i = inicio; i < fim; i++) {
    const item = filaDia[i];
    if (!item || item.status === 'enviado') continue;
    item.ramoId = ramoId || null;
    if (ramoId) {
      const { text, idx } = pickTemplate(item.nome, ramoId);
      item.mensagem = text; item.templateIdx = idx;
    } else {
      item.mensagem = ''; item.templateIdx = -1;
    }
  }
  saveFilaDisparo();
  if (isSlot) renderFilaSlot(slot, disparoDay); else renderFila();
}

function onLoteImgChange(chipId, loteNum, input, isSlot, slot) {
  const file = input.files[0]; if (!file) return;
  // Feedback imediato: mostra "carregando..."
  const areaEl = input.previousElementSibling;
  if (areaEl && areaEl.classList.contains('fila-img-area')) {
    areaEl.innerHTML = `<span class="fila-img-label" style="color:var(--warning)">⏳ carregando imagem...</span>`;
  }
  const reader = new FileReader();
  reader.onload = e => {
    setLoteImagem(chipId, loteNum, e.target.result, file.name)
      .then(() => {
        notify('✓ Imagem do lote salva');
        if (isSlot) renderFilaSlot(slot, disparoDay); else renderFila();
      })
      .catch(err => {
        notify('// erro ao salvar imagem: ' + (err && err.message ? err.message : err), 'err');
        // mesmo com erro tenta mostrar preview em memória
        if (isSlot) renderFilaSlot(slot, disparoDay); else renderFila();
      });
  };
  reader.onerror = () => notify('// erro ao ler arquivo', 'err');
  reader.readAsDataURL(file);
}

function onLoteImgRemove(chipId, loteNum, isSlot, slot) {
  removerLoteImagem(chipId, loteNum).then(() => {
    if (isSlot) renderFilaSlot(slot, disparoDay); else renderFila();
  }).catch(() => {
    if (isSlot) renderFilaSlot(slot, disparoDay); else renderFila();
  });
}

/* ════════════════════════════
   SINCRONIZAR FILA — corrige status de itens já enviados
════════════════════════════ */
function sincronizarFilaComEnviados() {
  const data = ensureWeekData();
  const chips = getChips();
  let corrigidos = 0;

  // Constrói um Set de IDs já enviados — semana atual
  const statusEnviados = new Set(['Enviada','Respondida','Não respondida','Recusada','Fechada']);
  const idsEnviados = new Set();
  Object.values(data.days).forEach(emps => {
    (emps||[]).forEach(e => { if (statusEnviados.has(e.status)) idsEnviados.add(e.id); });
  });

  // Também verifica no acompanhamento mensal (semanas anteriores)
  const acomp = getAcompData();
  Object.values(acomp).forEach(mes => {
    (mes||[]).forEach(e => { if (e.id) idsEnviados.add(e.id); });
  });

  chips.forEach(chip => {
    const fila = getFilaChip(chip.id);
    fila.forEach(item => {
      if (item.status === 'aguardando' && idsEnviados.has(item.id)) {
        item.status = 'enviado';
        corrigidos++;
      }
    });
  });

  if (corrigidos > 0) {
    saveFilaDisparo();
    console.log(`[sincronizar] ${corrigidos} item(ns) corrigido(s) para status enviado`);
  }
  return corrigidos;
}

function getFilaChip(chipId) {
  if (!filaDisparo[chipId]) filaDisparo[chipId] = [];
  return filaDisparo[chipId];
}

function saveFilaDisparo() {
  try { localStorage.setItem('vs_fila_disparo_v1', JSON.stringify(filaDisparo)); } catch(e) { console.warn('saveFilaDisparo error', e); }
}

const CHIP_LIMIT = 60; // máximo de leads por chip por dia

function getFilaChipNoDia(chipId, day) {
  // Retorna apenas os itens da fila do chip que pertencem ao dia informado
  const data = ensureWeekData();
  const idsNoDia = new Set((data.days[day]||[]).map(e => e.id));
  return getFilaChip(chipId).filter(f => idsNoDia.has(f.id));
}

function toggleFilaSlotEmpresa(slot, empId) {
  const chips = getChips();
  const chip = chips[slot] || null;
  if (!chip) { notify('// chip ' + (slot+1) + ' não configurado','warn'); return; }
  const fila = getFilaChip(chip.id);
  const idx = fila.findIndex(f => f.id === empId);
  const data = ensureWeekData();

  if (idx >= 0) {
    // ── REMOVER da fila ──
    fila.splice(idx, 1);
    const emOutraFila = chips.some((c, s) => s !== slot && getFilaChip(c.id).some(f => f.id === empId));
    if (!emOutraFila) {
      Object.keys(data.days).forEach(day => {
        const emp = (data.days[day]||[]).find(e => e.id === empId);
        if (emp && emp.status === 'Em fila') emp.status = 'Não enviada';
      });
      saveWeekData(data);
    }
    saveFilaDisparo();
    renderDisparoEmpresas();
    chips.forEach((_, s) => renderFilaSlot(s, disparoDay));
    updateBadges();
    return;
  }

  // ── ADICIONAR à fila ──
  const all = Object.values(data.days).flat();
  const emp = all.find(e => e.id === empId);
  if (!emp || !emp.whatsapp) { notify('// empresa sem WhatsApp','warn'); return; }

  // Verificar se o chip alvo tem vaga no dia atual
  const filaChipNoDia = getFilaChipNoDia(chip.id, disparoDay);
  if (filaChipNoDia.length >= CHIP_LIMIT) {
    // Chip alvo cheio — procurar próximo chip com vaga (ordem circular a partir do slot+1)
    let slotDestino = -1;
    for (let i = 1; i <= chips.length; i++) {
      const s = (slot + i) % chips.length;
      const c = chips[s];
      if (c && getFilaChipNoDia(c.id, disparoDay).length < CHIP_LIMIT) {
        slotDestino = s;
        break;
      }
    }

    if (slotDestino === -1) {
      notify(`// todos os chips estão cheios (${CHIP_LIMIT} leads/chip) neste dia`, 'warn');
      return;
    }

    const chipDestino = chips[slotDestino];
    notify(`// Chip ${slot+1} cheio → adicionando ao Chip ${slotDestino+1} (${chipDestino.nome})`, 'warn');
    // Redireciona para o chip com vaga
    toggleFilaSlotEmpresa(slotDestino, empId);
    return;
  }

  // Chip tem vaga — adicionar normalmente
  const jaEnviado = ['Enviada','Respondida','Não respondida','Recusada','Fechada'].includes(emp.status||'');
  const filaStatus = jaEnviado ? 'enviado' : 'aguardando';
  fila.push({ id: emp.id, nome: emp.nome, site: emp.site || '', whatsapp: emp.whatsapp, mensagem: '', templateIdx: -1, ramoId: null, status: filaStatus, aberto: false });
  if (!jaEnviado) {
    Object.keys(data.days).forEach(day => {
      const e = (data.days[day]||[]).find(e => e.id === empId);
      if (e) e.status = 'Em fila';
    });
    saveWeekData(data);
  }
  saveFilaDisparo();
  renderDisparoEmpresas();
  chips.forEach((_, s) => renderFilaSlot(s, disparoDay));
  updateBadges();
}

function toggleFila(empId) {
  const chipId = disparoChipId;
  if (!chipId) { notify('// selecione um chip primeiro','warn'); return; }
  const fila = getFilaChip(chipId);
  const idx = fila.findIndex(f => f.id === empId);
  const data = ensureWeekData();
  if (idx >= 0) {
    fila.splice(idx, 1);
    Object.keys(data.days).forEach(day => {
      const emp = (data.days[day]||[]).find(e => e.id === empId);
      if (emp && emp.status === 'Em fila') emp.status = 'Não enviada';
    });
    saveWeekData(data);
  } else {
    const all  = Object.values(data.days).flat();
    const emp  = all.find(e => e.id === empId);
    if (!emp || !emp.whatsapp) return;
    const jaEnviado = emp.status === 'Enviada' || emp.status === 'Respondida' || emp.status === 'Não respondida' || emp.status === 'Recusada' || emp.status === 'Fechada';
    const filaStatus = jaEnviado ? 'enviado' : 'aguardando';
    fila.push({ id: emp.id, nome: emp.nome, site: emp.site || '', whatsapp: emp.whatsapp, mensagem: '', templateIdx: -1, ramoId: null, status: filaStatus, aberto: false });
    if (!jaEnviado) {
      Object.keys(data.days).forEach(day => {
        const e = (data.days[day]||[]).find(e => e.id === empId);
        if (e) e.status = 'Em fila';
      });
      saveWeekData(data);
    }
  }
  renderDisparoEmpresas(); renderFila(); updateBadges();
}

function renderFila() {
  const countEl = document.getElementById('filaCount');
  const vaziEl  = document.getElementById('filaVazia');
  const itensEl = document.getElementById('filaItens');
  const filaAtual = getFilaChip(disparoChipId);
  countEl.textContent = `(${filaAtual.length} empresa${filaAtual.length!==1?'s':''})`;
  const vazia = filaAtual.length === 0;
  vaziEl.style.display  = vazia ? 'block' : 'none';
  itensEl.style.display = vazia ? 'none'  : 'flex';
  if (vazia) { itensEl.innerHTML = ''; return; }

  itensEl.innerHTML = filaAtual.map((item, i) => {
    const waNum = item.whatsapp.replace(/\D/g,'');
    const chip = getChipById(disparoChipId);
    const chipBadge = chip ? `<span class="q-badge ok" style="font-size:7px;margin-left:4px">📱 ${escHtml(chip.nome)}</span>` : '';
    const labels = { aguardando:'aguardando', enviando:'enviando...', enviado:'✓ enviado', erro:'✗ erro' };
    const aberto = item.aberto || false;
    return `<div class="fila-item ${item.status}" id="fila-item-${item.id}">
      <div class="fila-item-header" onclick="toggleFilaItem('${item.id}')" style="cursor:pointer;user-select:none">
        <div class="fila-item-num">${i+1}</div>
        <div class="fila-item-nome">${item.site ? `<a href="${escHtml(item.site)}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none" title="${escHtml(item.site)}" onclick="event.stopPropagation()">${escHtml(item.nome)}</a>` : escHtml(item.nome)}</div>
        <div class="fila-item-wa">+${waNum}${chipBadge}</div>
        <button class="lead-drawer-open-btn" onclick="event.stopPropagation();openLeadDrawer('${item.id}')">Ficha</button>
        <div style="color:var(--muted);font-size:12px;margin-left:4px;transition:transform 0.2s;transform:rotate(${aberto?'90':'0'}deg)">▶</div>
        <button class="fila-remove-btn" style="position:static;top:auto;right:auto;width:22px;height:22px" onclick="event.stopPropagation();removerFila('${item.id}')">×</button>
      </div>
      <div class="fila-item-body" style="display:${aberto?'flex':'none'}">
        <div style="width:100%">
          <div style="font-family:'DM Mono',monospace;font-size:8px;color:var(--muted);margin-bottom:4px">① APRESENTAÇÃO</div>
          <textarea class="fila-msg-area" id="fila-msg-${item.id}" style="background:var(--surface2);border-radius:8px;padding:10px 12px;font-family:'DM Mono',monospace;font-size:9px;color:var(--text2);line-height:1.7;min-height:80px;border:1px solid var(--border2);resize:vertical;width:100%;outline:none" oninput="atualizarMsgFila('${item.id}',this.value)">${escHtml(item.mensagem)}</textarea>
          <button class="fila-msg-shuffle" onclick="shuffleFilaMsg('${item.id}')">↻ sortear</button>
        </div>
      </div>
    </div>`
  }).join('');
}

function toggleFilaItem(id) {
  const fila = getFilaChip(disparoChipId);
  const item = fila.find(f => f.id === id);
  if (!item) return;
  item.aberto = !item.aberto;
  renderFila();
}

function atualizarMsgFila(id, val) {
  const fila = getFilaChip(disparoChipId);
  const item = fila.find(f => f.id === id);
  if (item) item.mensagem = val;
}

function shuffleFilaMsgSlot(slot, id) {
  const chip = getChipBySlot(slot); if (!chip) return;
  const fila = getFilaChip(chip.id);
  const item = fila.find(f => f.id === id);
  if (!item) return;
  const itemIdx = fila.findIndex(f => f.id === id);
  const loteNum = Math.floor(itemIdx / getLoteSize()) + 1;
  const { text, idx } = pickOtherTemplate(item.nome, item.templateIdx, item.ramoId || null);
  item.mensagem = text; item.templateIdx = idx;
  const el = document.getElementById(`fila-msg-${slot}-${id}`);
  if (el) el.value = item.mensagem;
  saveFilaDisparo();
}
function shuffleFilaMsg(id) {
  const fila = getFilaChip(disparoChipId);
  const item = fila.find(f => f.id === id);
  if (!item) return;
  const itemIdx = fila.findIndex(f => f.id === id);
  const loteNum = Math.floor(itemIdx / getLoteSize()) + 1;
  const { text, idx } = pickOtherTemplate(item.nome, item.templateIdx, item.ramoId || null);
  item.mensagem = text; item.templateIdx = idx;
  const el = document.getElementById(`fila-msg-${id}`);
  if (el) el.value = item.mensagem;
}
function onRamoFilaChange(id, ramoId) {
  const fila = getFilaChip(disparoChipId);
  const item = fila.find(f => f.id === id);
  if (!item) return;
  item.ramoId = ramoId || null;
  saveFilaDisparo();
  // Sortear automaticamente com o novo ramo
  const { text, idx } = pickTemplate(item.nome, item.ramoId);
  item.mensagem = text; item.templateIdx = idx;
  saveFilaDisparo();
  const el = document.getElementById(`fila-msg-${id}`);
  if (el) el.value = item.mensagem;
}
function onImgChange(id, input, slot) {
  const file = input.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const fila = getFilaChip(disparoChipId);
    const item = fila.find(f => f.id === id);
    if (!item) return;
    if (slot === '2') {
      item.imagem2Base64 = e.target.result; item.imagem2Nome = file.name;
    } else {
      item.imagemBase64 = e.target.result; item.imagemNome = file.name;
    }
    renderFila();
  };
  reader.readAsDataURL(file);
}
function removerImagem(id, slot) {
  const fila = getFilaChip(disparoChipId);
  const item = fila.find(f => f.id === id);
  if (!item) return;
  if (slot === '2') {
    delete item.imagem2Base64; delete item.imagem2Nome;
  } else {
    delete item.imagemBase64; delete item.imagemNome;
  }
  renderFila();
}
function removerFila(id) {
  if (!filaDisparo[disparoChipId]) return;
  const item = filaDisparo[disparoChipId].find(f => f.id === id);
  abrirModalConfirm(
    `Remover <strong>${item ? escHtml(item.nome) : 'esta empresa'}</strong> da fila?`,
    () => {
      if (!filaDisparo[disparoChipId]) return;
      filaDisparo[disparoChipId] = filaDisparo[disparoChipId].filter(f => f.id !== id);
      const data = ensureWeekData();
      Object.keys(data.days).forEach(day => {
        const emp = (data.days[day]||[]).find(e => e.id === id);
        if (emp && emp.status === 'Em fila') emp.status = 'Não enviada';
      });
      saveWeekData(data); saveFilaDisparo(); updateBadges(); renderDisparoEmpresas(); renderFila();
    }
  );
}
function limparFila() {
  if (disparoEmAndamento) { notify('// disparo em andamento','warn'); return; }
  if (aguardandoLote) cancelarLotes();
  const chipId = disparoChipId;
  if (chipId && filaDisparo[chipId]) {
    const data = ensureWeekData();
    Object.keys(data.days).forEach(day => {
      (data.days[day]||[]).forEach(emp => { if (emp.status === 'Em fila') emp.status = 'Não enviada'; });
    });
    saveWeekData(data);
    filaDisparo[chipId] = [];
  }
  updateBadges(); renderDisparoEmpresas(); renderFila();
}

/* ════════════════════════════
   HORÁRIO AUTOMÁTICO
════════════════════════════ */
let horarioJaDisparado = false;
let horarioUltimoDisparo = '';

function checkHorarioDisparo(now) {
  const filaAtual = disparoChipId ? getFilaChip(disparoChipId) : [];
  if (disparoEmAndamento || aguardandoLote || !filaAtual.length) return;
  const cfg = loadEvoConfig();
  if (!cfg.horarioInicio) return;
  const [hh, mm] = cfg.horarioInicio.split(':').map(Number);
  const nowH = now.getHours(), nowM = now.getMinutes();
  const key = `${todayStr()}_${cfg.horarioInicio}`;
  if (nowH === hh && nowM === mm && horarioUltimoDisparo !== key) {
    horarioUltimoDisparo = key;
    notify(`⏰ Disparo automático iniciado — ${cfg.horarioInicio}`);
    iniciarDisparo();
  }
  const el = document.getElementById('horarioStatus');
  if (el) {
    el.textContent = `próximo: ${cfg.horarioInicio}`;
    el.className = 'horario-status' + (disparoEmAndamento?' ativo':'');
  }
  const el2 = document.getElementById('horarioStatusInline');
  if (el2) el2.textContent = cfg.horarioInicio || '--:--';
}

/* ════════════════════════════
   EVO CONFIG
════════════════════════════ */
function loadEvoConfig() { try { return JSON.parse(localStorage.getItem(EVO_KEY)||'{}'); } catch { return {}; } }
function atualizarStatsDisparo() {
  const tamanho  = parseInt(document.getElementById('loteTamanho')?.value)   || 30;
  const esperaMin= parseInt(document.getElementById('loteEsperaMin')?.value) || 90;
  const chips    = getChips();
  const nChips   = chips.length || 1;
  const lotesDay = Math.floor(CHIP_LIMIT / tamanho);
  const esperaH  = esperaMin >= 60
    ? (esperaMin % 60 === 0 ? `${esperaMin/60}h` : `${Math.floor(esperaMin/60)}h${esperaMin%60}`)
    : `${esperaMin}min`;

  const subEl    = document.getElementById('filaZapSub');
  const loteVal  = document.getElementById('statLoteVal');
  const loteSub  = document.getElementById('statLoteSub');
  const diaSub   = document.getElementById('statDiaSub');

  if (subEl)   subEl.textContent   = `// ${nChips} chip${nChips!==1?'s':''} · disparo paralelo · ${tamanho} por lote · ${esperaH} de delay`;
  if (loteVal) loteVal.textContent = `${tamanho} msg`;
  if (loteSub) loteSub.textContent = `por chip · ${lotesDay} lote${lotesDay!==1?'s':''} por dia`;
  if (diaSub)  diaSub.textContent  = `${lotesDay} lote${lotesDay!==1?'s':''} × ${tamanho} · espera ${esperaH}`;
}

function saveEvoConfig() {
  const cfg = {
    delayMin: document.getElementById('delayMin')?.value,
    delayMax: document.getElementById('delayMax')?.value,
    loteTamanho: document.getElementById('loteTamanho')?.value,
    loteEsperaMin: document.getElementById('loteEsperaMin')?.value,
    horarioInicio: document.getElementById('horarioInicio')?.value,
  };
  localStorage.setItem(EVO_KEY, JSON.stringify(cfg));
  atualizarStatsDisparo();
}
function toggleLoteConfig() {
  const fields = document.getElementById('loteConfigFields');
  if (fields) fields.style.display = document.getElementById('loteAtivo').checked ? 'flex' : 'none';
}

/* ════════════════════════════
   DISPARO — LOTES
════════════════════════════ */
function getLoteSize() {
  return Math.max(30, parseInt(document.getElementById('loteTamanho')?.value) || 30);
}
function getLoteConfig() {
  const tam = Math.max(30, parseInt(document.getElementById('loteTamanho')?.value)||30);
  const esp = Math.max(90, parseInt(document.getElementById('loteEsperaMin')?.value)||90);
  return { ativo: document.getElementById('loteAtivo')?.checked||false, tamanho: tam, esperaMin: esp };
}

function cancelarLotes() {
  if (loteEsperaTimer)  { clearTimeout(loteEsperaTimer);  loteEsperaTimer = null; }
  if (loteCountdownInt) { clearInterval(loteCountdownInt); loteCountdownInt = null; }
  filaLotes = []; loteAtual = 0; lotesTotal = 0; aguardandoLote = false; loteEsperaFim = null;
  document.getElementById('loteEsperaPanel').style.display = 'none';
  notify('// fila cancelada','warn');
}

function iniciarCountdownLote(msRestante) {
  const btnProx = document.getElementById('btnProximoLote');
  const countEl = document.getElementById('loteCountdown');
  const barEl   = document.getElementById('loteProgressBar');
  const duracaoMs = msRestante;
  if (loteCountdownInt) clearInterval(loteCountdownInt);
  function tick() {
    const restante = loteEsperaFim - Date.now();
    if (restante <= 0) { clearInterval(loteCountdownInt); loteCountdownInt=null; countEl.textContent='00:00'; barEl.style.width='100%'; btnProx.disabled=false; btnProx.style.background='var(--accent)'; notify('✓ Lote liberado!'); return; }
    const min = Math.floor(restante/60000), seg = Math.floor((restante%60000)/1000);
    countEl.textContent = `${String(min).padStart(2,'0')}:${String(seg).padStart(2,'0')}`;
    barEl.style.width = Math.min(100, ((duracaoMs-restante)/duracaoMs)*100) + '%';
  }
  tick(); loteCountdownInt = setInterval(tick, 500);
  loteEsperaTimer = setTimeout(() => { loteEsperaTimer = null; }, msRestante);
}

async function confirmarProximoLote() {
  if (!filaLotes.length) return;
  document.getElementById('btnProximoLote').disabled = true;
  document.getElementById('loteEsperaPanel').style.display = 'none';
  if (loteCountdownInt) { clearInterval(loteCountdownInt); loteCountdownInt = null; }
  if (loteEsperaTimer)  { clearTimeout(loteEsperaTimer);  loteEsperaTimer = null; }
  await dispararLote();
}

async function dispararLote() {
  loteAtual++;
  const lote     = filaLotes.shift();
  const loteConf = getLoteConfig();
  const chip     = getChipById(disparoChipId);
  if (!chip) { notify('// configure um chip primeiro','err'); return; }
  const delayMin = parseInt(document.getElementById('delayMin').value)||120;
  const delayMax = parseInt(document.getElementById('delayMax').value)||180;
  const MSG_DELAY = 15000; // 15s entre mensagens da mesma empresa
  const logEl    = document.getElementById('disparoLog');
  logEl.style.display = 'block';
  disparoEmAndamento = true;
  document.getElementById('btnDisparar').disabled = true;
  document.getElementById('disparoSpinner').style.display = 'block';
  document.getElementById('disparoBtn').textContent = `Lote ${loteAtual}/${lotesTotal}...`;

  function log(msg) { const l = document.createElement('div'); l.style.marginBottom='3px'; l.innerHTML=`<span style="color:var(--muted)">[${timeStr()}]</span> ${msg}`; logEl.appendChild(l); logEl.scrollTop=logEl.scrollHeight; }
  log(`<span style="color:var(--accent)">━━ LOTE ${loteAtual}/${lotesTotal} · ${lote.length} empresa${lote.length>1?'s':''} ━━</span>`);

  for (let i = 0; i < lote.length; i++) {
    const item = lote[i];
    if (item.status === 'enviado') continue;
    item.status = 'enviando'; atualizarStatusFila(item.id,'enviando');
    log(`Enviando para <span style="color:var(--text)">${escHtml(item.nome)}</span>...`);
    try {
      const waNum  = item.whatsapp.replace(/\D/g,'');
      const numero = waNum.startsWith('55') ? waNum : '55' + waNum;

      // MSG 1 — Apresentação
      const payload1 = { number: numero, options: { delay: 1000 }, textMessage: { text: item.mensagem } };
      const res1 = await fetch(`${chip.url}/message/sendText/${chip.instance}`, { method:'POST', headers:{'Content-Type':'application/json','apikey':chip.key}, body: JSON.stringify(payload1) });
      if (!res1.ok) throw new Error(`HTTP ${res1.status}`);
      log(`  ① apresentação enviada`);
      await new Promise(r => setTimeout(r, MSG_DELAY));

      // MSG 2 — Imagem redesign (item ou padrão do lote)
      const loteNumSend = loteAtual;
      const imgRedesign = item.imagem2Base64 || getLoteImagem(disparoChipId, loteNumSend);
      if (imgRedesign) {
        await new Promise(r => setTimeout(r, MSG_DELAY));
        const b2 = imgRedesign.split(',')[1], m2 = imgRedesign.split(';')[0].split(':')[1] || 'image/jpeg';
        const payload3 = { number: numero, options: { delay: 1000 }, mediaMessage: { mediatype: 'image', media: b2, mimetype: m2, caption: '' } };
        await fetch(`${chip.url}/message/sendMedia/${chip.instance}`, { method:'POST', headers:{'Content-Type':'application/json','apikey':chip.key}, body: JSON.stringify(payload3) });
        log(`  ② imagem (redesign) enviada`);
      } else {
        log(`  ② <span style="color:var(--warning)">sem imagem (configure no cabeçalho do lote)</span>`);
      }

      item.status='enviado'; atualizarStatusFila(item.id,'enviado');
      log(`<span style="color:var(--accent)">✓ ${escHtml(item.nome)}</span>`);
      atualizarStatusEmpresa(item.id,'Enviada');
    } catch(e) {
      item.status='erro'; atualizarStatusFila(item.id,'erro');
      log(`<span style="color:var(--error)">✗ Erro — ${e.message}</span>`);
    }
    if (i < lote.length-1) {
      const delay = (delayMin + Math.random()*(delayMax-delayMin))*1000;
      log(`Aguardando ${Math.round(delay/1000)}s...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  const env = lote.filter(f=>f.status==='enviado').length, erros = lote.filter(f=>f.status==='erro').length;
  log(`<span style="color:var(--accent)">✓ Lote ${loteAtual} concluído! ${env} enviado${env>1?'s':''} · ${erros} erro${erros>1?'s':''}</span>`);
  disparoEmAndamento = false;
  document.getElementById('disparoSpinner').style.display = 'none';
  renderFilaZap(); renderInicio();

  if (filaLotes.length > 0) {
    const esperaMs = loteConf.esperaMin*60*1000; loteEsperaFim = Date.now()+esperaMs; aguardandoLote = true;
    document.getElementById('btnDisparar').disabled = true;
    document.getElementById('disparoBtn').textContent = `🟡 Aguardando lote ${loteAtual+1}/${lotesTotal}`;
    const panel = document.getElementById('loteEsperaPanel'); panel.style.display='block';
    document.getElementById('loteEsperaTitle').textContent = `⏱ Aguardando lote ${loteAtual+1}/${lotesTotal}...`;
    document.getElementById('btnProximoLote').disabled=true; document.getElementById('btnProximoLote').style.background='var(--surface3)';
    document.getElementById('loteProgressBar').style.width='0%';
    notify(`✓ Lote ${loteAtual} concluído · próximo em ${loteConf.esperaMin}min`);
    iniciarCountdownLote(esperaMs);
  } else {
    aguardandoLote=false; document.getElementById('btnDisparar').disabled=false; document.getElementById('disparoBtn').textContent='🟢 Disparar fila';
    const filaAtual = getFilaChip(disparoChipId);
    const totalEnv = filaAtual.filter(f=>f.status==='enviado').length;
    const totalErr = filaAtual.filter(f=>f.status==='erro').length;
    log(`<span style="color:var(--accent)">━━ CONCLUÍDO · ${totalEnv} enviados · ${totalErr} erros ━━</span>`);
    notify(`✓ ${lotesTotal} lote${lotesTotal>1?'s':''} concluído${lotesTotal>1?'s':''} · ${totalEnv} enviados`);
  }
}

async function iniciarDisparo() {
  if (disparoEmAndamento || aguardandoLote) return;
  const chip = getChipById(disparoChipId);
  if (!chip) { notify('// configure um chip primeiro','err'); return; }
  const filaAtual = getFilaChip(disparoChipId);
  if (!filaAtual.length) { notify('// fila vazia','warn'); return; }
  document.getElementById('disparoLog').innerHTML = '';
  const loteConf = getLoteConfig();
  if (loteConf.ativo && filaAtual.length > loteConf.tamanho) {
    filaLotes=[]; loteAtual=0;
    for (let i=0; i<filaAtual.length; i+=loteConf.tamanho) filaLotes.push(filaAtual.slice(i,i+loteConf.tamanho));
    lotesTotal=filaLotes.length;
    await dispararLote();
  } else {
    filaLotes=[]; loteAtual=1; lotesTotal=1; filaLotes.push([...filaAtual]);
    await dispararLote();
  }
}

function atualizarStatusFila(id, status) {
  const el = document.getElementById(`fila-item-${id}`); if (!el) return;
  el.className = `fila-item ${status}`;
  const st = el.querySelector('.fila-item-status'); if (!st) return;
  const labels = { aguardando:'aguardando', enviando:'enviando...', enviado:'✓ enviado', erro:'✗ erro' };
  st.className=`fila-item-status ${status}`; st.textContent=labels[status]||status;
}
function atualizarStatusEmpresa(id, novoStatus) {
  const data = ensureWeekData();
  Object.keys(data.days).forEach(day => {
    const idx = data.days[day].findIndex(e => e.id===id);
    if (idx>=0) { data.days[day][idx].status=novoStatus; data.days[day][idx].enviadoEm=todayStr(); }
  });
  saveWeekData(data); updateBadges();
}

/* ════════════════════════════
   FILA INSTAGRAM — RENDER
════════════════════════════ */
function renderFilaInsta() {
  const fila = getInstaFila();
  const tabs = ['pendente','enviado'];
  const counts = { pendente: fila.filter(f=>f.status==='pendente').length, enviado: fila.filter(f=>f.status==='enviado').length };

  document.getElementById('instaStatusTabs').innerHTML = tabs.map(t =>
    `<div class="status-tab${instaStatus===t?' active':''}" onclick="setInstaStatus('${t}')">
      ${t==='pendente'?'Pendentes':'Enviados'} <span class="st-count">${counts[t]}</span>
    </div>`
  ).join('');

  const filtered = fila.filter(f => f.status === instaStatus);
  const listEl = document.getElementById('instaFilaList');

  if (!filtered.length) {
    listEl.innerHTML = `<div class="fila-empty">Nenhuma empresa ${instaStatus==='pendente'?'pendente':'enviada'}.</div>`;
    return;
  }

  listEl.innerHTML = filtered.map(item => {
    const apresentacao = getTemplates()[0].replace(/\{EMPRESA\}/g, item.nome);
    return `<div class="insta-card" id="insta-card-${item.id}">
      <div class="insta-card-header">
        <div class="insta-nome">
          ${item.googleUrl?`<a href="${escHtml(item.googleUrl)}" target="_blank" style="color:var(--text);text-decoration:none">${escHtml(item.nome)}</a>`:escHtml(item.nome)}
        </div>
        ${item.instagram?`<a href="${escHtml(item.instagram)}" target="_blank" class="q-badge insta" style="text-decoration:none">📸 ver perfil</a>`:''}
      </div>
      <div style="margin-bottom:10px">
        <div style="font-family:'DM Mono',monospace;font-size:8px;color:var(--muted);margin-bottom:4px">LINK INSTAGRAM</div>
        <div style="display:flex;gap:6px">
          <input class="insta-link-input" id="insta-ig-${item.id}" type="url" placeholder="https://instagram.com/empresa" value="${escHtml(item.instagram||'')}"/>
          <button class="copy-small" onclick="salvarInstaLink('${item.id}')">salvar</button>
        </div>
      </div>
      <div class="insta-msg-blocks">
        <div class="insta-msg-block">
          <div class="insta-msg-block-label">① APRESENTAÇÃO</div>
          <div class="insta-msg-text">${escHtml(apresentacao)}</div>
          <div style="margin-top:6px;display:flex;gap:5px">
            <button class="copy-small" onclick="copiarTexto(${JSON.stringify(apresentacao)})">copiar</button>
          </div>
        </div>
        <div class="insta-msg-block">
          <div class="insta-msg-block-label">② LINK DO SITE</div>
          <div class="insta-msg-text">${escHtml(LINK_BICHOP)}</div>
          <div style="margin-top:6px"><button class="copy-small" onclick="copiarTexto('${LINK_BICHOP}')">copiar</button></div>
        </div>
        <div class="insta-msg-block">
          <div class="insta-msg-block-label">③ IMAGEM PERSONALIZADA</div>
          <div class="fila-img-area${item.imagemBase64?' has-img':''}" onclick="document.getElementById('insta-img-${item.id}').click()" style="min-height:50px">
            ${item.imagemBase64?`<img src="${item.imagemBase64}" alt="preview"/>`:''}
            <span class="fila-img-label">${item.imagemBase64?'':'📎 anexar imagem'}</span>
          </div>
          <input type="file" accept="image/*" class="fila-img-input" id="insta-img-${item.id}" onchange="onInstaImgChange('${item.id}',this)"/>
        </div>
      </div>
      <div style="display:flex;gap:6px;margin-top:12px;flex-wrap:wrap">
        ${item.status==='pendente'
          ?`<button class="btn btn-insta" style="font-size:10px;padding:7px 14px" onclick="marcarInstaEnviado('${item.id}')">✓ Marcar enviado</button>`
          :`<span class="q-badge ok">✓ enviado</span>`
        }
        <button class="btn btn-ghost" style="font-size:10px;padding:7px 12px;margin-right:4px" onclick="instaFilaVoltarAtribuicao('${item.id}')" title="Devolver para Atribuição">↩ Atribuição</button>
        <button class="btn btn-danger" style="font-size:10px;padding:7px 12px" onclick="removerDaFilaInsta('${item.id}')">Remover</button>
      </div>
    </div>`;
  }).join('');
}


function instaFilaVoltarAtribuicao(id) {
  const fila = getInstaFila();
  const item = fila.find(f => f.id === id);
  if (!item) return;
  const atrib = getAtribuicaoData();
  if (!atrib.find(a => a.id === id)) {
    atrib.push({
      id: item.id, nome: item.nome, whatsapp: item.whatsapp || '',
      instagram: item.instagram || '', googleUrl: item.googleUrl || '',
      canal: 'insta', site: '',
      status: 'Não enviada', criadoEm: item.criadoEm || todayStr(),
      validadoEm: todayStr(), diaDestino: null,
    });
    saveAtribuicaoData(atrib);
  }
  saveInstaFila(fila.filter(f => f.id !== id));
  renderFilaInsta(); updateBadges();
  notify(`↩ ${item.nome} → Atribuição`);
}
function setInstaStatus(s) { instaStatus = s; renderFilaInsta(); }

function salvarInstaLink(id) {
  const input = document.getElementById(`insta-ig-${id}`);
  if (!input) return;
  const fila = getInstaFila();
  const item = fila.find(f => f.id === id);
  if (!item) return;
  item.instagram = input.value.trim();
  saveInstaFila(fila); notify('✓ Link salvo');
}

function onInstaImgChange(id, input) {
  const file = input.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const fila = getInstaFila();
    const item = fila.find(f => f.id === id);
    if (!item) return;
    item.imagemBase64 = e.target.result;
    saveInstaFila(fila); renderFilaInsta();
  };
  reader.readAsDataURL(file);
}

function marcarInstaEnviado(id) {
  const fila = getInstaFila();
  const item = fila.find(f => f.id === id);
  if (!item) return;
  item.status = 'enviado'; item.enviadoEm = todayStr();
  saveInstaFila(fila); renderFilaInsta(); updateBadges();
  notify('✓ Marcado como enviado');
}

function removerDaFilaInsta(id) {
  saveInstaFila(getInstaFila().filter(f => f.id !== id));
  renderFilaInsta(); updateBadges();
}

function limparFilaInsta() {
  if (!confirm('Remover todos os enviados?')) return;
  saveInstaFila(getInstaFila().filter(f => f.status !== 'enviado'));
  renderFilaInsta(); updateBadges(); notify('✓ Enviados removidos');
}

function copiarTexto(text) {
  navigator.clipboard.writeText(text).then(() => notify('✓ Copiado'));
}

/* ════════════════════════════
   REDIRECIONAMENTOS
════════════════════════════ */
const API_BASE = '';

async function criarRedirecionamento() {
  const nome   = document.getElementById('rdNomeEmpresa').value.trim();
  const desk   = document.getElementById('rdDeskUrl').value.trim();
  const mob    = document.getElementById('rdMobUrl').value.trim();
  if (!nome || !desk || !mob) { notify('// preencha todos os campos','err'); return; }

  const spinner = document.getElementById('rdSpinner');
  spinner.style.display = 'block';
  try {
    const res = await fetch(`${API_BASE}/api/shorten`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyName: nome, deskUrl: desk, mobUrl: mob })
    });
    const data = await res.json();
    if (!res.ok) { notify(data.error || '// erro ao criar link','err'); return; }
    const result = document.getElementById('rdResultado');
    const link   = document.getElementById('rdLinkGerado');
    result.style.display = 'block';
    link.href = data.shortUrl; link.textContent = data.shortUrl;
    notify('✓ Link criado!');
  } catch(e) {
    notify('// erro de conexão','err');
  } finally {
    spinner.style.display = 'none';
  }
}

function copiarLinkRd() {
  const link = document.getElementById('rdLinkGerado').textContent;
  navigator.clipboard.writeText(link).then(() => notify('✓ Link copiado'));
}

async function atualizarRedirecionamento() {
  const alias = document.getElementById('rdAliasUpdate').value.trim();
  const desk  = document.getElementById('rdDeskUrlUpdate').value.trim();
  const mob   = document.getElementById('rdMobUrlUpdate').value.trim();
  if (!alias) { notify('// informe o alias','err'); return; }
  if (!desk && !mob) { notify('// informe ao menos um link','err'); return; }
  try {
    const res = await fetch(`${API_BASE}/api/update`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alias, deskUrl: desk||undefined, mobUrl: mob||undefined })
    });
    const data = await res.json();
    if (!res.ok) { notify(data.error || '// erro','err'); return; }
    notify('✓ Link atualizado!');
  } catch(e) { notify('// erro de conexão','err'); }
}

/* ════════════════════════════
   CONFIGURAÇÕES
════════════════════════════ */
function renderConfiguracoes() {
  renderChipsConfig();
  renderRamosConfig();
  renderTemplatesConfig();
  renderInstaTemplatesConfig();
}

/* CHIPS */
function abrirModalNovoChip() {
  document.getElementById('chipNome').value = '';
  document.getElementById('chipUrl').value = '';
  document.getElementById('chipInstance').value = '';
  document.getElementById('chipKey').value = '';
  document.getElementById('chipModal').classList.add('open');
}
function fecharChipModal() { document.getElementById('chipModal').classList.remove('open'); }

function salvarChip() {
  const nome     = document.getElementById('chipNome').value.trim();
  const url      = document.getElementById('chipUrl').value.trim();
  const instance = document.getElementById('chipInstance').value.trim();
  const key      = document.getElementById('chipKey').value.trim();
  if (!nome || !url || !instance || !key) { notify('// preencha todos os campos','err'); return; }
  const chips = getChips();
  if (chips.length >= 2) { notify('// máximo de 2 chips','warn'); return; }
  chips.push({ id: genId(), nome, url, instance, key, status: 'desconectado' });
  saveChips(chips);
  fecharChipModal(); renderConfiguracoes(); updateBadges();
  notify('✓ Chip salvo');
}

function renderChipsConfig() {
  const chips = getChips();
  const grid  = document.getElementById('chipGrid');
  if (!chips.length) {
    grid.innerHTML = '<div style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--muted)">Nenhum chip configurado. Adicione até 2 chips.</div>';
    return;
  }
  grid.innerHTML = chips.map(c => `<div class="chip-card">
    <div class="chip-card-header">
      <div class="chip-dot ${c.status==='conectado'?'on':'off'}"></div>
      <div style="flex:1;min-width:0">
        <div class="chip-name" id="chipNameDisplay_${c.id}">${escHtml(c.nome)}</div>
        <div class="chip-instance">${escHtml(c.instance)}</div>
      </div>
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap">
      <button class="btn btn-ghost" style="font-size:10px;padding:6px 12px" onclick="verQRChip('${c.id}')">📱 QR Code</button>
      <button class="btn btn-ghost" style="font-size:10px;padding:6px 12px" onclick="iniciarRenomeioChip('${c.id}')">✏ Renomear</button>
      <button class="btn btn-danger chip-del" style="font-size:10px;padding:6px 12px" onclick="deletarChip('${c.id}')">✕ Remover</button>
    </div>
    <div id="renamePanel_${c.id}" style="display:none;margin-top:10px;display:none">
      <div style="display:flex;gap:6px;align-items:center">
        <input type="text" id="renameInput_${c.id}" value="${escHtml(c.nome)}" placeholder="Novo nome..." style="flex:1;font-size:11px;padding:7px 10px"/>
        <button class="btn btn-primary" style="font-size:10px;padding:6px 12px;white-space:nowrap" onclick="confirmarRenomeioCip('${c.id}')">✓ Salvar</button>
        <button class="btn btn-ghost" style="font-size:10px;padding:6px 10px" onclick="cancelarRenomeioChip('${c.id}')">✕</button>
      </div>
    </div>
  </div>`).join('');
}

async function verQRChip(id) {
  qrChipIdAtivo = id;
  const chip = getChipById(id);
  if (!chip) return;
  document.getElementById('qrChipNome').textContent = chip.nome;
  document.getElementById('qrModal').classList.add('open');
  await carregarQR(chip);
}

async function carregarQR(chip) {
  document.getElementById('qrWrap').innerHTML = '<div style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--muted)">Gerando QR Code...</div>';
  try {
    const res = await fetch(`${chip.url}/instance/connect/${chip.instance}`, { headers: { 'apikey': chip.key } });
    const data = await res.json();
    const qr = data.qrcode?.base64 || data.base64 || data.qr || '';
    if (qr) {
      document.getElementById('qrWrap').innerHTML = `<img src="${qr.startsWith('data:')?qr:'data:image/png;base64,'+qr}" alt="QR Code"/>`;
    } else {
      document.getElementById('qrWrap').innerHTML = '<div style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--ok)">✓ Instância já conectada</div>';
    }
  } catch(e) {
    document.getElementById('qrWrap').innerHTML = '<div style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--error)">✗ Erro ao gerar QR Code</div>';
  }
}

async function atualizarQR() {
  if (!qrChipIdAtivo) return;
  const chip = getChipById(qrChipIdAtivo);
  if (chip) await carregarQR(chip);
}

function deletarChip(id) {
  if (!confirm('Remover este chip?')) return;
  saveChips(getChips().filter(c => c.id !== id));
  if (disparoChipId === id) disparoChipId = null;
  if (activeChipId === id) activeChipId = null;
  renderConfiguracoes(); updateBadges(); notify('✓ Chip removido');
}

function iniciarRenomeioChip(id) {
  const panel = document.getElementById('renamePanel_' + id);
  if (!panel) return;
  panel.style.display = 'block';
  const inp = document.getElementById('renameInput_' + id);
  if (inp) { inp.focus(); inp.select(); }
}
function cancelarRenomeioChip(id) {
  const panel = document.getElementById('renamePanel_' + id);
  if (panel) panel.style.display = 'none';
}
function confirmarRenomeioCip(id) {
  const inp = document.getElementById('renameInput_' + id);
  if (!inp) return;
  const novoNome = inp.value.trim();
  if (!novoNome) { notify('// informe um nome','err'); return; }
  const chips = getChips();
  const chip = chips.find(c => c.id === id);
  if (!chip) return;
  chip.nome = novoNome;
  saveChips(chips);
  renderConfiguracoes(); updateBadges();
  notify('✓ Chip renomeado');
}

/* RAMOS */
function renderRamosConfig() {
  const ramos = getRamos();
  document.getElementById('ramosConfigList').innerHTML = ramos.map(r => `<div style="background:var(--bg);border:1px solid var(--border2);border-radius:10px;padding:12px;margin-bottom:8px">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
      <span style="font-weight:700;font-size:13px;flex:1">${escHtml(r.nome)}</span>
      <button class="del-btn" onclick="deletarRamo('${r.id}')">✕</button>
    </div>
    <div style="display:flex;gap:4px;flex-wrap:wrap">
      ${r.keywords.map(k=>`<span style="background:var(--surface2);border:1px solid var(--border2);color:var(--text2);font-family:'DM Mono',monospace;font-size:8px;padding:2px 7px;border-radius:100px">${escHtml(k)}</span>`).join('')}
    </div>
  </div>`).join('');
}

function adicionarRamo() {
  const input = document.getElementById('novoRamoInput');
  const nome = input.value.trim();
  if (!nome) return;
  const ramos = getRamos();
  ramos.push({ id: genId(), nome, keywords: [normalizeStr(nome)] });
  saveRamos(ramos); renderRamosConfig(); renderRamoSelect();
  input.value = ''; notify('✓ Ramo adicionado');
}

function deletarRamo(id) {
  if (!confirm('Remover ramo?')) return;
  saveRamos(getRamos().filter(r => r.id !== id));
  renderRamosConfig(); renderRamoSelect();
  if (activeRamoId === id) { activeRamoId = null; onRamoChange(); }
  notify('✓ Ramo removido');
}

/* TEMPLATES */
function renderTemplatesConfig() {
  const ramos = getRamos();
  const el = document.getElementById('templatesList');

  // Seletor de ramo apenas (sem abas de tipo)
  const ramoSel = `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;align-items:center">
    <select id="tplRamoSel" onchange="onTplRamoChange()" style="flex:1;min-width:140px;font-size:11px;padding:8px 12px">
      <option value="">— Selecione um ramo —</option>
      ${ramos.map(r => `<option value="${r.id}"${tplRamoId===r.id?' selected':''}>${escHtml(r.nome)}</option>`).join('')}
    </select>
  </div>`;

  let tpls, isRamo;
  if (tplRamoId) {
    tpls = getTemplatesForRamoTipo(tplRamoId, 'com-site');
    isRamo = true;
  } else {
    // Sem ramo selecionado — não exibe nada
    el.innerHTML = ramoSel + `<div style="font-family:'DM Mono',monospace;font-size:10px;color:var(--muted);padding:16px 0">// Selecione um ramo para ver e editar os templates.</div>`;
    return;
  }

  const maxTpl = 10;
  const limitLabel = tplRamoId
    ? `<span style="font-family:'DM Mono',monospace;font-size:8px;color:var(--muted)">${tpls.length}/${maxTpl} templates</span>`
    : '';

  const tplsHtml = tpls.map((t, i) => `<div style="background:var(--bg);border:1px solid var(--border2);border-radius:10px;padding:12px;margin-bottom:8px;position:relative">
    <div style="font-family:'DM Mono',monospace;font-size:8px;color:var(--muted);margin-bottom:8px">TEMPLATE ${i+1}</div>
    <textarea style="min-height:80px;font-size:10px;line-height:1.6" oninput="${isRamo?`saveRamoTemplate('${tplRamoId}','com-site',${i},this.value)`:`saveTemplate(${i},this.value)`}">${escHtml(t)}</textarea>
    ${tpls.length>1?`<button class="del-btn" style="position:absolute;top:8px;right:8px" onclick="${isRamo?`removerRamoTemplate('${tplRamoId}','com-site',${i})`:`removerTemplate(${i})`}">✕</button>`:''}
  </div>`).join('');

  const addBtn = `<div style="display:flex;align-items:center;justify-content:space-between;margin-top:12px">
    ${limitLabel}
    <button class="btn btn-ghost" onclick="${isRamo?`adicionarRamoTemplate('${tplRamoId}','com-site')`:`adicionarTemplate()`}" ${tpls.length>=maxTpl?'disabled':''}>+ Novo template</button>
  </div>`;

  el.innerHTML = ramoSel + tplsHtml + addBtn;
}

function onTplRamoChange() {
  tplRamoId = document.getElementById('tplRamoSel').value || null;
  renderTemplatesConfig();
}
function setTplTipo(tipo) {
  tplTipo = tipo;
  renderTemplatesConfig();
}

function saveTemplate(idx, val) {
  const tpls = getTemplates(); tpls[idx] = val; saveTemplates(tpls);
}
function adicionarTemplate() {
  const tpls = getTemplates();
  tpls.push('Olá, me chamo Samuel. Tudo bem?\n\nVi o site da {EMPRESA}...\n\nFaz sentido conversarmos?');
  saveTemplates(tpls); renderTemplatesConfig(); notify('✓ Template adicionado');
}
function removerTemplate(idx) {
  const tpls = getTemplates(); tpls.splice(idx, 1); saveTemplates(tpls); renderTemplatesConfig();
}

/* ════════════════════════════
   INSTAGRAM — PAINEL PRINCIPAL
════════════════════════════ */

/* ── MODAL LEAD MANUAL INSTAGRAM ── */
function abrirModalInstaLead() {
  ['ilNome','ilWhatsapp','ilGoogleUrl','ilInstagram','ilCategoria'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  document.getElementById('instaLeadModal').classList.add('open');
}
function salvarInstaLead() {
  const nome = (document.getElementById('ilNome').value||'').trim();
  if (!nome) { notify('// informe o nome da empresa','err'); return; }
  const whatsapp   = (document.getElementById('ilWhatsapp').value||'').trim();
  const googleUrl  = (document.getElementById('ilGoogleUrl').value||'').trim();
  const instagram  = (document.getElementById('ilInstagram').value||'').trim();
  const categoria  = (document.getElementById('ilCategoria').value||'').trim();
  const fila = getInstaFila();
  fila.push({ id: genId(), nome, whatsapp, googleUrl, instagram, categoria, criadoEm: todayStr() });
  saveInstaFila(fila);
  document.getElementById('instaLeadModal').classList.remove('open');
  renderInstagram(); renderAtribInstaFila(); updateBadges();
  notify('✓ Lead adicionado à fila Instagram');
}

function salvarInstaLeadInline() {
  const nome      = (document.getElementById('instaLeadNome')?.value||'').trim();
  const instagram = (document.getElementById('instaLeadLink')?.value||'').trim();
  if (!nome) { notify('// informe o nome da empresa','err'); return; }
  const fila = getInstaFila();
  fila.push({ id: genId(), nome: capitalizeName(nome), whatsapp: '', googleUrl: '', instagram, categoria: '', criadoEm: todayStr() });
  saveInstaFila(fila);
  // Limpar campos
  const nEl = document.getElementById('instaLeadNome'); if (nEl) nEl.value = '';
  const lEl = document.getElementById('instaLeadLink'); if (lEl) lEl.value = '';
  document.getElementById('instaLeadNome')?.focus();
  toggleAtribForm('insta'); // fecha o form
  renderInstagram(); renderAtribInstaFila(); updateBadges();
  notify(`✓ ${capitalizeName(nome)} → Fila Instagram`);
}

/* ════════════════════════════
   BASE DE ATRIBUIÇÃO — ABAS
════════════════════════════ */
let atribActiveTab = 'zap'; // 'zap' | 'insta'

function salvarZapLeadManual() {
  const nome     = (document.getElementById('zapLeadNome')?.value||'').trim();
  const whatsapp = (document.getElementById('zapLeadWpp')?.value||'').trim();
  if (!nome) { notify('// nome da empresa é obrigatório','err'); return; }

  const atrib = getAtribuicaoData();
  atrib.push({
    id: genId(),
    nome: capitalizeName(nome),
    site: '',
    whatsapp: whatsapp || '',
    instagram: '',
    googleUrl: '',
    canal: 'zap',
    status: 'Não enviada',
    criadoEm: todayStr(),
    diaDestino: null,
  });
  saveAtribuicaoData(atrib);
  // Limpar campos
  ['zapLeadNome','zapLeadWpp'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  document.getElementById('zapLeadNome')?.focus();
  toggleAtribForm('zap'); // fecha o form
  renderAtribuicao(); updateBadges(); updateAtribTabCounts();
  notify(`✓ ${capitalizeName(nome)} → Base de Atribuição (ZAP)`);
}

function setAtribTab(tab) {
  atribActiveTab = tab;
  const tabZap   = document.getElementById('atribTabZap');
  const tabInsta = document.getElementById('atribTabInsta');
  const panelZap   = document.getElementById('atribPanelZap');
  const panelInsta = document.getElementById('atribPanelInsta');

  if (tab === 'zap') {
    tabZap.style.borderBottomColor   = 'var(--accent)';
    tabZap.style.color               = 'var(--accent)';
    tabInsta.style.borderBottomColor = 'transparent';
    tabInsta.style.color             = 'var(--muted)';
    panelZap.style.display   = 'flex';
    panelInsta.style.display = 'none';
    renderAtribuicao();
  } else {
    tabInsta.style.borderBottomColor = 'var(--insta)';
    tabInsta.style.color             = 'var(--insta)';
    tabZap.style.borderBottomColor   = 'transparent';
    tabZap.style.color               = 'var(--muted)';
    panelInsta.style.display = 'flex';
    panelZap.style.display   = 'none';
    renderAtribInstaFila();
    updateAtribInstaCorteInfo();
    setTimeout(() => document.getElementById('instaLeadNome')?.focus(), 60);
  }
  updateAtribTabCounts();
}

function updateAtribTabCounts() {
  const zapCount   = getAtribuicaoData().length;
  const instaCount = getInstaFila().length;
  const elZ = document.getElementById('atribTabZapCount');
  const elI = document.getElementById('atribTabInstaCount');
  if (elZ) elZ.textContent = zapCount ? `(${zapCount})` : '';
  if (elI) elI.textContent = instaCount ? `(${instaCount})` : '';
}

/* ── Info de corte horário ── */
function updateAtribInstaCorteInfo() {
  // aviso removido — sem exibição de info de horário
}

function toggleAtribForm(aba) {
  const formId = aba === 'zap' ? 'zapLeadForm' : 'instaLeadForm';
  const btnId  = aba === 'zap' ? 'btnToggleZapForm' : 'btnToggleInstaForm';
  const form   = document.getElementById(formId);
  const btn    = document.getElementById(btnId);
  if (!form) return;
  const open = form.style.display !== 'none';
  form.style.display = open ? 'none' : 'block';
  if (btn) btn.textContent = open ? '+ Novo lead' : '✕ Fechar';
  if (!open) {
    // foca no primeiro input ao abrir
    const first = form.querySelector('input');
    if (first) setTimeout(() => first.focus(), 50);
  }
}

/* ── Qual dia o lead deve entrar (regra de corte 19h + limite 60/dia) ── */
function instaDeterminarDiaDestino() {
  const now   = new Date();
  const hora  = now.getHours();
  const week  = getInstaWeek();
  const days  = instaWeekDays();

  const todayKey = todayStr();
  const todayIdx = days.indexOf(todayKey);
  // Nunca começa antes de hoje — ignora dias passados da semana
  let startIdx = todayIdx >= 0 ? todayIdx : 0;
  if (hora >= INSTA_CUTOFF_HOUR) startIdx = Math.min(startIdx + 1, days.length - 1);

  for (let i = startIdx; i < days.length; i++) {
    const d = days[i];
    if ((week[d]||[]).length < INSTA_DIA_LIMIT) return d;
  }
  return days[days.length - 1]; // fallback: último dia da semana
}

/* ── RENDER DA FILA INSTAGRAM NA BASE DE ATRIBUIÇÃO ── */
let atribInstaPage = 0;
const ATRIB_INSTA_PG = 30;

function renderAtribInstaFila() {
  const listEl = document.getElementById('atribInstaList');
  if (!listEl) return;

  // Atribuição exibe apenas leads que ainda NÃO têm link do Instagram
  const filaAll = getInstaFila().filter(e => !e.instagram);
  const buscaEl = document.getElementById('atribInstaBusca');
  const buscaQ  = buscaEl ? normalizeStr(buscaEl.value) : '';
  const fila = buscaQ
    ? filaAll.filter(e => normalizeStr(e.nome||'').includes(buscaQ) || (e.whatsapp||'').includes(buscaQ))
    : filaAll;

  const totalEl = document.getElementById('atribInstaFilaTotalBadge');
  if (totalEl) totalEl.textContent = fila.length ? `· ${fila.length} empresa${fila.length>1?'s':''}` : '';

  // Tab counts
  updateAtribTabCounts();

  if (!fila.length) {
    listEl.innerHTML = '<div style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--muted);text-align:center;padding:32px">// nenhum lead aguardando atribuição</div>';
    document.getElementById('atribInstaPagination').innerHTML = '';
    return;
  }

  const totalPags = Math.max(1, Math.ceil(fila.length / ATRIB_INSTA_PG));
  if (atribInstaPage >= totalPags) atribInstaPage = totalPags - 1;
  const page = fila.slice(atribInstaPage * ATRIB_INSTA_PG, (atribInstaPage + 1) * ATRIB_INSTA_PG);

  listEl.innerHTML = page.map(e => {
    const stars   = e.totalScore   ? `⭐ ${Number(e.totalScore).toFixed(1)}` : '';
    const reviews = e.reviewsCount ? `(${e.reviewsCount} av.)` : '';
    const temInstaPreview = !!(e.instagram);
    return `<div style="display:flex;align-items:flex-start;gap:8px;padding:10px 12px;border-bottom:1px solid var(--border)" id="atrib-insta-row-${e.id}">
      <!-- info empresa -->
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
          ${e.googleUrl
            ? `<a href="${escHtml(e.googleUrl)}" target="_blank" style="color:var(--text);text-decoration:none" onmouseover="this.style.color='var(--insta)'" onmouseout="this.style.color='var(--text)'">${escHtml(e.nome||'—')}</a>`
            : escHtml(e.nome||'—')}
        </div>
        <div style="font-family:'DM Mono',monospace;font-size:9px;color:var(--text2);display:flex;gap:8px;flex-wrap:wrap;margin-top:2px">
          ${stars?`<span style="color:var(--ok)">${stars} ${reviews}</span>`:''}
          ${e.categoria?`<span style="color:var(--muted)">${escHtml(e.categoria)}</span>`:''}
        </div>
        <!-- Campo de link Instagram inline -->
        <div style="display:flex;gap:6px;margin-top:7px;align-items:center">
          <a href="https://www.google.com/search?q=site:instagram.com+${encodeURIComponent('"'+e.nome+'"')}" target="_blank"
            title="Buscar Instagram no Google"
            style="background:none;border:1px solid rgba(225,48,108,0.25);color:var(--insta);border-radius:6px;font-size:11px;padding:4px 8px;cursor:pointer;flex-shrink:0;text-decoration:none;line-height:1;display:flex;align-items:center;transition:all 0.18s"
            onmouseover="this.style.background='rgba(225,48,108,0.1)'" onmouseout="this.style.background='none'">🔍</a>
          <input id="atrib-insta-link-${e.id}" type="text"
            value="${escHtml(e.instagram||'')}"
            placeholder="Cole o link do Instagram..."
            style="flex:1;background:rgba(225,48,108,0.06);border:1px solid rgba(225,48,108,0.25);border-radius:6px;color:var(--text);font-family:'DM Mono',monospace;font-size:9px;padding:5px 9px;outline:none;transition:border-color 0.18s"
            onfocus="this.style.borderColor='var(--insta)'" onblur="this.style.borderColor='rgba(225,48,108,0.25)'"
            onpaste="setTimeout(()=>atribInstaConfirmarLink('${e.id}'),0)"
            onkeydown="if(event.key==='Enter') atribInstaConfirmarLink('${e.id}')"/>
          <button onclick="atribInstaExcluir('${e.id}')"
            style="background:none;border:1px solid transparent;color:var(--muted);border-radius:6px;font-size:10px;padding:4px 7px;cursor:pointer;transition:all 0.18s;flex-shrink:0"
            onmouseover="this.style.borderColor='var(--error)';this.style.color='var(--error)';this.style.background='rgba(255,92,92,0.06)'"
            onmouseout="this.style.borderColor='transparent';this.style.color='var(--muted)';this.style.background='none'">✕</button>
        </div>
      </div>
    </div>`; }).join('');

  // Paginação
  const pEl = document.getElementById('atribInstaPagination');
  if (pEl) {
    if (totalPags <= 1) { pEl.innerHTML = ''; }
    else {
      pEl.innerHTML = `<div style="display:flex;gap:8px;justify-content:center;padding:10px 0;flex-wrap:wrap">
        ${atribInstaPage>0?`<button class="btn btn-ghost" style="font-size:9px;padding:5px 12px" onclick="atribInstaChangePage(${atribInstaPage-1})">← Anterior</button>`:''}
        <span style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted);align-self:center">${atribInstaPage+1} / ${totalPags}</span>
        ${atribInstaPage<totalPags-1?`<button class="btn btn-ghost" style="font-size:9px;padding:5px 12px" onclick="atribInstaChangePage(${atribInstaPage+1})">Próxima →</button>`:''}
      </div>`;
    }
  }
}

function atribInstaChangePage(p) { atribInstaPage = p; renderAtribInstaFila(); }

/* ── CONFIRMAR LINK → VAI PARA O BACKLOG ── */
function atribInstaConfirmarLink(id) {
  const input = document.getElementById(`atrib-insta-link-${id}`);
  if (!input) return;
  let url = input.value.trim();
  if (!url) { notify('// cole o link do Instagram antes de confirmar','warn'); return; }
  if (!url.startsWith('http')) url = 'https://instagram.com/' + url.replace('@','');

  const fila = getInstaFila();
  const emp  = fila.find(e => e.id === id);
  if (!emp) return;

  // Salva o link no item — ele permanece na INSTA_KEY, agora com instagram preenchido.
  // O backlog do painel Instagram exibe apenas os que têm e.instagram preenchido.
  emp.instagram = url;
  saveInstaFila(fila);

  updateAtribInstaCorteInfo();
  renderAtribInstaFila();
  if (document.getElementById('panel-instagram')?.classList.contains('active')) renderInstagram();
  updateBadges();
  notify(`✓ ${emp.nome} → Backlog Instagram`);
}

/* ── EXCLUIR DA FILA INSTAGRAM (BASE DE ATRIBUIÇÃO) ── */
function atribInstaExcluir(id) {
  const fila = getInstaFila();
  const emp  = fila.find(e => e.id === id);
  abrirModalConfirm(
    `Excluir <strong>${emp ? escHtml(emp.nome) : 'este lead'}</strong> da fila Instagram?`,
    () => {
      saveInstaFila(getInstaFila().filter(e => e.id !== id));
      renderAtribInstaFila(); updateBadges();
      notify(`✕ Lead removido`);
    }
  );
}



/* ════════════════════════════
   INSTAGRAM — STORAGE
════════════════════════════ */
// getInstaFila / saveInstaFila definidas acima — sem duplicata
function getInstaWeek()    { try { return JSON.parse(localStorage.getItem(INSTA_WEEK_KEY)||'{}'); } catch { return {}; } }
function saveInstaWeek(d)  { localStorage.setItem(INSTA_WEEK_KEY, JSON.stringify(d)); }

/* ── MIGRAÇÃO: normaliza chaves antigas para dd/mm/aaaa ── */
function migrarChavesInstaWeek() {
  const raw = localStorage.getItem(INSTA_WEEK_KEY);
  if (!raw) return;
  let data; try { data = JSON.parse(raw); } catch { return; }

  let alterou = false;
  const novo = {};

  for (const key of Object.keys(data)) {
    // Formato antigo: aaaa/mm/dd  ou aaaa-mm-dd
    const matchISO = key.match(/^(\d{4})[\/\-](\d{2})[\/\-](\d{2})$/);
    if (matchISO) {
      const novaChave = `${matchISO[3]}/${matchISO[2]}/${matchISO[1]}`; // → dd/mm/aaaa
      novo[novaChave] = [...(novo[novaChave]||[]), ...(data[key]||[])];
      alterou = true;
    } else {
      // Já está no formato certo ou desconhecido — mantém
      novo[key] = [...(novo[key]||[]), ...(data[key]||[])];
    }
  }

  if (alterou) {
    saveInstaWeek(novo);
    console.log('[insta] chaves migradas:', Object.keys(data), '→', Object.keys(novo));
    notify('✓ Leads do Instagram recuperados');
  }
}

/* ── Constantes e estado do painel Instagram (declaração única) ── */
const INSTA_DIA_LIMIT   = 60;
const INSTA_PAGE_SIZE   = 50;
const INSTA_CUTOFF_HOUR = 19;
const INSTA_STATUS      = ['Não contatado','DM Enviada','Respondeu','Não respondeu','Fechou','Recusou'];

let instaPage      = 0;
let instaBacklogPg = 0;
let instaActiveTab = 'backlog'; // 'backlog' | dd/mm/aaaa

function instaWeekDays()              { return currentWeekDays(); }
function instaCountForDay(week, day)  { return (week[day]||[]).length; }
function instaParseDay(day) {
  const [d, m, y] = day.split('/').map(Number);
  return new Date(y, m - 1, d);
}

/* ════════════════════════════
   INSTAGRAM TEMPLATES
════════════════════════════ */
const INSTA_TEMPLATES_KEY = 'vs_insta_templates_v1';
const INSTA_TEMPLATES_DEFAULT = [
`Olá, tudo bem?
Me chamo Samuel. Encontrei a {EMPRESA} e estive vendo o trabalho de vocês aqui no Instagram. Cada projeto postado aqui reforça o nível do que entregam, dá para ver o cuidado em cada detalhe.
Percebi que vocês ainda não têm um site. Para marcenarias com esse padrão de projeto, isso é uma oportunidade clara. O cliente que pesquisa no Google simplesmente não encontra vocês, e a decisão de orçar muitas vezes começa antes do primeiro contato.
Recentemente desenvolvi um projeto para uma marcenaria chamada Bicho Preguiça: bichopreguicaplanejados.com.br
A ideia é que qualquer pessoa que chegue pelo Google ou pelas redes sociais consiga visualizar de modo sofisticado e completo tudo que vocês já entregaram, criando uma jornada que reforce o valor do trabalho antes do orçamento.
Montei uma amostra do que poderia ser feito para vocês. Dá uma olhada e me fala se faz sentido, beleza?`,
`Olá, tudo bem?
Me chamo Samuel. Achei a {EMPRESA} e estive vendo o trabalho de vocês aqui no Instagram. Cada projeto apresentado e postado aqui reforça a qualidade do que entregam. Nota-se o cuidado e a qualidade em cada entrega.
O que percebi é que vocês ainda não têm um site. No nicho de marcenarias e planejados, o cliente forma a percepção de valor antes mesmo de entrar em contato. Quem não aparece no Google fica fora dessa decisão.
Deixo aqui um projeto que desenvolvi para uma marcenaria chamada Bicho Preguiça: bichopreguicaplanejados.com.br
Sem um espaço próprio no Google, cada cliente que pesquisa ativamente por móveis planejados na região passa direto para quem tem. Esse é o tipo de decisão que acontece antes de qualquer contato, e vocês ficam fora dela.
Montei uma amostra do que poderia ser feito para vocês. Dá uma olhada e me fala se faz sentido, beleza?`,
`Olá, tudo bem?
Me chamo Samuel. Encontrei a {EMPRESA} e estive vendo o trabalho de vocês aqui no Instagram. Os projetos que postam têm um padrão muito bom, cada detalhe bem pensado e bem apresentado.
Só que percebi que vocês ainda não têm presença no Google. Isso significa que o cliente que está pesquisando ativamente por móveis planejados na região não encontra vocês. Essa busca acontece exatamente no momento em que ele está pronto para orçar.
Aqui um projeto que desenvolvi recentemente para uma marcenaria chamada Bicho Preguiça: bichopreguicaplanejados.com.br
O objetivo é que qualquer pessoa que chegue até vocês consiga visualizar com clareza e sofisticação tudo que já entregaram, criando uma jornada que reforce o valor do projeto antes do primeiro contato.
Montei uma amostra do que poderia ser feito para vocês. Dá uma olhada e me fala se faz sentido, beleza?`
];

function getInstaTemplates() {
  try { return JSON.parse(localStorage.getItem(INSTA_TEMPLATES_KEY)||'null') || INSTA_TEMPLATES_DEFAULT; } catch { return INSTA_TEMPLATES_DEFAULT; }
}
function saveInstaTemplates(t) { localStorage.setItem(INSTA_TEMPLATES_KEY, JSON.stringify(t)); }

function sortearInstaTemplate(nome) {
  const tpls = getInstaTemplates();
  if (!tpls.length) return '';
  const t = tpls[Math.floor(Math.random() * tpls.length)];
  return t.replace(/\{EMPRESA\}/g, nome || '');
}

function copiarInstaMsg(nome) {
  const msg = sortearInstaTemplate(nome);
  if (!msg) { notify('// nenhum template Instagram cadastrado','warn'); return; }
  navigator.clipboard.writeText(msg).then(() => {
    notify('📋 Mensagem copiada');
  }).catch(() => {
    // fallback
    const ta = document.createElement('textarea');
    ta.value = msg; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy');
    document.body.removeChild(ta);
    notify('📋 Mensagem copiada');
  });
}

function renderInstaTemplatesConfig() {
  const el = document.getElementById('instaTemplatesList');
  if (!el) return;
  const tpls = getInstaTemplates();
  el.innerHTML = tpls.map((t, i) => `
    <div style="background:var(--bg);border:1px solid rgba(225,48,108,0.2);border-radius:10px;padding:12px;margin-bottom:8px;position:relative">
      <div style="font-family:'DM Mono',monospace;font-size:8px;color:var(--insta);margin-bottom:8px;opacity:0.7">TEMPLATE ${i+1}</div>
      <textarea style="min-height:100px;font-size:10px;line-height:1.6;border-color:rgba(225,48,108,0.2)"
        oninput="saveInstaTemplateItem(${i},this.value)"
        onfocus="this.style.borderColor='var(--insta)'" onblur="this.style.borderColor='rgba(225,48,108,0.2)'">${escHtml(t)}</textarea>
      ${tpls.length>1?`<button class="del-btn" style="position:absolute;top:8px;right:8px" onclick="removerInstaTemplate(${i})">✕</button>`:''}
    </div>`).join('');
}
function saveInstaTemplateItem(idx, val) {
  const tpls = getInstaTemplates(); tpls[idx] = val; saveInstaTemplates(tpls);
}
function adicionarInstaTemplate() {
  const tpls = getInstaTemplates();
  if (tpls.length >= 10) { notify('// limite de 10 templates','warn'); return; }
  tpls.push('Olá, tudo bem?\nMe chamo Samuel. Encontrei a {EMPRESA}...\n\nDá uma olhada e me fala se faz sentido, beleza?');
  saveInstaTemplates(tpls); renderInstaTemplatesConfig(); notify('✓ Template Instagram adicionado');
}
function removerInstaTemplate(idx) {
  const tpls = getInstaTemplates();
  if (tpls.length <= 1) { notify('// mantenha ao menos 1 template','warn'); return; }
  tpls.splice(idx, 1); saveInstaTemplates(tpls); renderInstaTemplatesConfig();
}

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
    const cand    = leads.find(e => (e.status||'Não enviada') === 'Não enviada');
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

/* ════════════════════════════
   INIT
════════════════════════════ */
(function() {
  const s = document.getElementById('sidebar');
  if (localStorage.getItem(SIDEBAR_KEY)==='1') s.classList.remove('collapsed');

  // Inicializa login Google sem interferir nos dados atuais.
  initAuth();

  const cfg = loadEvoConfig();
  if (cfg.delayMin)      document.getElementById('delayMin').value      = cfg.delayMin; else document.getElementById('delayMin').value = 120;
  if (cfg.delayMax)      document.getElementById('delayMax').value      = cfg.delayMax; else document.getElementById('delayMax').value = 120;
  // Garante mínimo de 30 para lote e 90 para espera — corrige valores legados no localStorage
  const loteTamanhoSalvo  = parseInt(cfg.loteTamanho)   || 0;
  const loteEsperaSalvo   = parseInt(cfg.loteEsperaMin) || 0;
  document.getElementById('loteTamanho').value   = loteTamanhoSalvo  >= 30 ? loteTamanhoSalvo  : 30;
  document.getElementById('loteEsperaMin').value = loteEsperaSalvo   >= 90 ? loteEsperaSalvo   : 90;
  if (cfg.horarioInicio) document.getElementById('horarioInicio').value = cfg.horarioInicio;

  atualizarStatsDisparo();

  // init chips — prioridade chip 2 com final 8457
  const chips = getChips();
  if (chips.length) {
    const chipPriority = chips.find(c => c.nome && c.nome.includes('8457')) || chips.find(c => c.nome && c.nome.toLowerCase().includes('ativação')) || chips[1] || chips[0];
    disparoChipId = chipPriority.id;
    activeChipId = chipPriority.id;
  }

  renderRamoSelect();
  ensureWeekData();
  migrarChavesInstaWeek();
  sincronizarFilaComEnviados();
  renderInicio();
  renderExcluidos();
  updateBadges();
  // Migrar imagens antigas do localStorage para o IDB (executa uma vez)
  try {
    const oldCfg = JSON.parse(localStorage.getItem(LOTE_CFG_KEY)||'{}')||{};
    const migrKeys = Object.keys(oldCfg).filter(k => oldCfg[k] && oldCfg[k].imagem2Base64);
    if (migrKeys.length) {
      migrKeys.forEach(k => {
        const b64 = oldCfg[k].imagem2Base64;
        idbSet(k, b64).catch(()=>{});
        delete oldCfg[k].imagem2Base64;
        delete oldCfg[k].imagem2Nome;
      });
      localStorage.setItem(LOTE_CFG_KEY, JSON.stringify(oldCfg));
      console.log('[migrar] ' + migrKeys.length + ' imagem(ns) movida(s) do localStorage para o IDB');
    }
  } catch(e) {}
  // ── Migração v2: move leads INSTA de ATRIBUICAO_KEY para INSTA_KEY ──
  // O campo canal foi corrigido na v1, mas os leads ficaram na lista errada.
  // Leads com canal 'insta' (ou sem canal e sem whatsapp) devem estar em INSTA_KEY.
  try {
    const atribRaw = JSON.parse(localStorage.getItem(ATRIBUICAO_KEY) || '[]');
    const instaRaw = JSON.parse(localStorage.getItem(INSTA_KEY) || '[]');
    const instaIds = new Set(instaRaw.map(i => i.id));

    // Determina canal correto para cada lead (incluindo legados sem canal)
    const atribComCanal = atribRaw.map(a => ({
      ...a,
      canal: (a.canal && a.canal !== 'pendente') ? a.canal : (a.whatsapp ? 'zap' : 'insta')
    }));

    const ficamNoZap  = atribComCanal.filter(a => a.canal === 'zap');
    const vaoParaInsta = atribComCanal.filter(a => a.canal === 'insta');

    if (vaoParaInsta.length > 0) {
      // Adiciona na INSTA_KEY (sem duplicar)
      const novosInsta = vaoParaInsta
        .filter(a => !instaIds.has(a.id))
        .map(a => ({
          id: a.id,
          nome: a.nome || '',
          whatsapp: a.whatsapp || '',
          instagram: a.instagram || '',
          googleUrl: a.googleUrl || '',
          categoria: a.categoria || '',
          totalScore: a.totalScore || null,
          reviewsCount: a.reviewsCount || null,
          criadoEm: a.criadoEm || a.validadoEm || '',
          canal: 'insta',
        }));

      localStorage.setItem(INSTA_KEY, JSON.stringify([...instaRaw, ...novosInsta]));
      localStorage.setItem(ATRIBUICAO_KEY, JSON.stringify(ficamNoZap));
      console.log(`[migração v2] ${novosInsta.length} leads → INSTA_KEY · ${ficamNoZap.length} ficam em ATRIBUICAO_KEY (ZAP)`);
    }
  } catch(e) { console.warn('[migração v2] erro:', e); }

  // Limpeza de imagens de lotes obsoletos no IDB
  setTimeout(limparImagensOlfas, 2000);
  // Abrir o primeiro chip por padrão
  setTimeout(() => {
    const chips = getChips();
    if (chips.length) {
      const acc = document.getElementById('chipAccordion0');
      if (acc) acc.classList.add('open');
    }
  }, 50);
})();


function getPipelineStats() {
  const store = getLeadCrmStore();
  const stats = {};
  LEAD_PIPELINE_STEPS.forEach(s => stats[s.key]=0);
  Object.values(store).forEach(crm => {
    const k = crm.pipelineStatus || LEAD_PIPELINE_STEPS[0].key;
    if (stats[k] !== undefined) stats[k]++;
  });
  return stats;
}


function getPipelineConversionMetrics() {
  const stats = getPipelineStats();
  const total = Object.values(stats).reduce((a,b)=>a+b,0);
  return {
    total,
    responded: stats.responded || 0,
    meetings: stats.meeting || 0,
    proposals: stats.proposal || 0,
    closed: stats.closed || 0
  };
}


async function loadLeadsFromSupabase() {
  try {
    if (!window.supabaseAdapter || !window.sbClient) return;
    const userRes = await sbClient.auth.getUser();
    const user = userRes?.data?.user;
    if (!user) return;

    const { data, error } = await sbClient
      .from('leads')
      .select('*')
      .eq('user_id', user.id);

    if (error) {
      console.error('Erro carregando leads', error);
      return;
    }

    window.__supabaseLeads = data || [];
    console.log('Leads carregados do Supabase:', window.__supabaseLeads.length);
  } catch (e) {
    console.error(e);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    loadLeadsFromSupabase();
  }, 1500);
});


/* ===== V13 TIMELINE ===== */

function getLeadTimelineEvents(leadId){
  const store = (typeof getLeadCrmStore === 'function') ? getLeadCrmStore() : {};
  const crm = store[leadId] || {};
  const events = [];

  (crm.history || []).forEach(h => events.push({
    type:'history',
    icon:'🧭',
    at:h.at || '',
    text:h.text || ''
  }));

  (crm.notes || []).forEach(n => events.push({
    type:'note',
    icon:'📝',
    at:n.at || '',
    text:n.text || ''
  }));

  (crm.presentations || []).forEach(p => events.push({
    type:'presentation',
    icon:'🔗',
    at:p.createdAtLabel || p.createdAt || '',
    text:`Apresentação vinculada: ${p.title || 'Apresentação'}`
  }));

  if (crm.followUpDate) {
    events.push({
      type:'followup',
      icon:'⏰',
      at:crm.followUpDate,
      text:'Follow-up agendado'
    });
  }

  return events.reverse();
}

function renderLeadTimeline(leadId){
  const box = document.getElementById('leadTimelineList');
  if (!box || !leadId) return;

  const events = getLeadTimelineEvents(leadId);

  if (!events.length) {
    box.innerHTML = '<div class="lead-timeline-empty">// nenhuma atividade registrada ainda</div>';
    return;
  }

  box.innerHTML = events.map(ev => `
    <div class="lead-timeline-item">
      <div class="lead-timeline-icon">${ev.icon || '•'}</div>
      <div>
        <div class="lead-timeline-date">${escHtml(ev.at || '')}</div>
        <div class="lead-timeline-text">${escHtml(ev.text || '')}</div>
      </div>
    </div>
  `).join('');
}



function authGateSelfTest() {
  const gate = document.getElementById('authGate');
  return {
    hasGate: !!gate,
    gateOpen: !!gate?.classList.contains('open'),
    bodyLocked: document.body.classList.contains('auth-locked'),
    currentUser: currentUser ? { id: currentUser.id, email: currentUser.email } : null
  };
}

// V27 panel hook fallback

// chips panel fallback


/* CONFIG DISPARO V33 */
function getDispatchConfigTextV33() {
  return {
    dailyLimitTitle: 'LIMITE DIÁRIO POR CHIP',
    dailyLimitValue: '120 msg',
    dailyLimitHint: '4 lotes × 30 · espera 1h',
    batchValue: '30 msg',
    batchHint: 'por chip · 4 lotes por dia',
    intervalValue: '2 min',
    intervalHint: '120 seg fixo entre cada envio',
    blocks: ['08:00', '10:00', '12:00', '14:00']
  };
}

// audit panel fallback

document.addEventListener('DOMContentLoaded', () => { try { updateAuditBadgeV35(); } catch(e){} });


/* V37 MOBILE MENU */
function setupMobileMenuV37(){
 const sidebar=document.querySelector('.sidebar');
 const overlay=document.getElementById('mobileMenuOverlayV37');
 if(!sidebar||!overlay) return;

 let btn=document.getElementById('mobileMenuBtnV37');
 if(!btn){
   btn=document.createElement('button');
   btn.id='mobileMenuBtnV37';
   btn.innerHTML='☰';
   btn.setAttribute('aria-label','Abrir menu');
   btn.className='mobile-menu-trigger-v37';
   document.body.appendChild(btn);
 }

 function closeMenu(){
   sidebar.classList.remove('mobile-open');
   overlay.classList.remove('active');
   document.body.style.overflow='';
   document.body.classList.remove('mobile-menu-open');
 }
 function openMenu(){
   try { cleanupSidebarMenuV39(); } catch(e){}
   sidebar.classList.add('mobile-open');
   overlay.classList.add('active');
   document.body.style.overflow='hidden';
   document.body.classList.add('mobile-menu-open');
 }

 btn.onclick=()=> sidebar.classList.contains('mobile-open')?closeMenu():openMenu();
 overlay.onclick=closeMenu;

 document.querySelectorAll('.sidebar .nav-item').forEach(el=>{
   el.addEventListener('click',()=>{ if(window.innerWidth<=980) closeMenu();});
 });
}
document.addEventListener('DOMContentLoaded',setupMobileMenuV37);

// conversations fallback


/* ════════════════════════════
   MENU CLEANUP V39
════════════════════════════ */
function cleanupSidebarMenuV39(){
  try {
    if (typeof rebuildSidebarV40 === 'function') rebuildSidebarV40();
  } catch(e) {
    console.warn('cleanupSidebarMenuV39 protegido:', e?.message || e);
  }
}

document.addEventListener('DOMContentLoaded', cleanupSidebarMenuV39);
setTimeout(() => { try { cleanupSidebarMenuV39(); } catch(e){} }, 600);
setTimeout(() => { try { cleanupSidebarMenuV39(); } catch(e){} }, 1500);


/* ════════════════════════════
   SIDEBAR FINAL V40
════════════════════════════ */
function createNavItemV40(panel, icon, label, badge = '') {
  const item = document.createElement('div');
  item.className = 'nav-item';
  item.setAttribute('onclick', `switchPanel('${panel}')`);
  item.setAttribute('data-label', label);
  item.innerHTML = `
    <div class="nav-icon">${icon}</div>
    <span class="nav-label">${label}</span>
    ${badge ? `<span class="nav-badge" id="${badge.id}">${badge.text}</span>` : ''}
  `;
  return item;
}

function findSidebarSectionTitleV40(sidebar, text) {
  return Array.from(sidebar.querySelectorAll('*')).find(el => {
    const t = (el.textContent || '').trim().toLowerCase();
    return t === text.toLowerCase();
  });
}

function ensureSidebarItemV40(sidebar, panel, icon, label, badge) {
  let item = sidebar.querySelector(`[data-label="${label}"]`);
  if (!item) item = createNavItemV40(panel, icon, label, badge);
  return item;
}

function rebuildSidebarV40() {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) return;

  const authBox =
    sidebar.querySelector('#authUserBox') ||
    Array.from(sidebar.children).find(el => {
      const t = (el.textContent || '').toLowerCase();
      return t.includes('conectado') && t.includes('sair');
    });

  // Remove relógio/data soltos
  Array.from(sidebar.querySelectorAll('*')).forEach(el => {
    const txt = (el.textContent || '').trim().toLowerCase();
    if (/^\d{1,2}:\d{2}$/.test(txt) || /sexta|segunda|terça|terca|quarta|quinta|sábado|sabado|domingo/.test(txt)) {
      el.remove();
    }
  });

  // Garante seção Ferramentas
  let toolsTitle = findSidebarSectionTitleV40(sidebar, 'Ferramentas');
  if (!toolsTitle) {
    toolsTitle = document.createElement('div');
    toolsTitle.className = 'nav-section-title';
    toolsTitle.textContent = 'Ferramentas';
    const config = sidebar.querySelector('[data-label="Configurações"]');
    if (config) sidebar.insertBefore(toolsTitle, config);
    else sidebar.appendChild(toolsTitle);
  }

  let toolsGroup = document.getElementById('sidebarToolsV40');
  if (!toolsGroup) {
    toolsGroup = document.createElement('div');
    toolsGroup.id = 'sidebarToolsV40';
    toolsTitle.insertAdjacentElement('afterend', toolsGroup);
  }

  const redirects = sidebar.querySelector('[data-label="Redirecionamentos"]');
  const audit = ensureSidebarItemV40(sidebar, 'audit', '📊', 'Auditoria', { id:'badge-audit', text:'LOG' });
  const responses = ensureSidebarItemV40(sidebar, 'responses', '💬', 'Respostas', { id:'badge-responses', text:'0' });
  const conversations = ensureSidebarItemV40(sidebar, 'conversations', '🗨️', 'Conversas', { id:'badge-conversations', text:'0' });
  const config = sidebar.querySelector('[data-label="Configurações"]');

  [redirects, audit, responses, conversations, config].forEach(el => {
    if (el) toolsGroup.appendChild(el);
  });

  // Move conectado para rodapé
  let footer = document.getElementById('sidebarAuthFooterV40');
  if (!footer) {
    footer = document.createElement('div');
    footer.id = 'sidebarAuthFooterV40';
    sidebar.appendChild(footer);
  }

  if (authBox && !footer.contains(authBox)) {
    footer.appendChild(authBox);
  }

  // Fecha menu mobile ao clicar item
  sidebar.querySelectorAll('.nav-item').forEach(item => {
    if (item.__v40Bound) return;
    item.__v40Bound = true;
    item.addEventListener('click', () => {
      if (window.innerWidth <= 980) {
        const overlay = document.getElementById('mobileMenuOverlayV37');
        sidebar.classList.remove('mobile-open');
        overlay?.classList.remove('active');
        document.body.classList.remove('mobile-menu-open');
        document.body.style.overflow = '';
      }
    });
  });

  if (typeof updateAuditBadgeV35 === 'function') updateAuditBadgeV35();
  if (typeof updateResponsesBadgeV34 === 'function') updateResponsesBadgeV34();
  if (typeof updateConversationsBadgeV38 === 'function') updateConversationsBadgeV38();
}

document.addEventListener('DOMContentLoaded', rebuildSidebarV40);
setTimeout(rebuildSidebarV40, 300);
setTimeout(rebuildSidebarV40, 1000);
setTimeout(rebuildSidebarV40, 2000);


/* SIDEBAR FINAL V40.4 SAFE */
(function(){
  const originalRebuildSidebarV40 = typeof rebuildSidebarV40 === 'function' ? rebuildSidebarV40 : null;

  window.rebuildSidebarV40 = function(){
    try {
      if (originalRebuildSidebarV40) originalRebuildSidebarV40();
    } catch(e) {
      console.warn('rebuildSidebarV40 protegido:', e?.message || e);
    }

    const sidebar = document.querySelector('.sidebar');
    if (!sidebar) return;

    const authBox = sidebar.querySelector('#authUserBox');
    let footer = document.getElementById('sidebarAuthFooterV40');

    if (!footer) {
      footer = document.createElement('div');
      footer.id = 'sidebarAuthFooterV40';
      sidebar.appendChild(footer);
    }

    if (authBox && authBox.parentElement !== footer) {
      footer.appendChild(authBox);
    }

    let toolsGroup = document.getElementById('sidebarToolsV40');
    if (!toolsGroup) {
      toolsGroup = document.createElement('div');
      toolsGroup.id = 'sidebarToolsV40';

      const toolsTitle = Array.from(sidebar.querySelectorAll('*'))
        .find(el => (el.textContent || '').trim().toLowerCase() === 'ferramentas');

      if (toolsTitle && toolsTitle.parentElement) {
        toolsTitle.insertAdjacentElement('afterend', toolsGroup);
      } else if (footer.parentElement === sidebar) {
        sidebar.insertBefore(toolsGroup, footer);
      } else {
        sidebar.appendChild(toolsGroup);
      }
    }

    ['Redirecionamentos','Auditoria','Respostas','Conversas','Configurações'].forEach(label => {
      const item = sidebar.querySelector(`[data-label="${label}"]`);
      if (item && item.parentElement !== toolsGroup) {
        toolsGroup.appendChild(item);
      }
    });

    if (typeof updateResponsesBadgeV34 === 'function') updateResponsesBadgeV34();
    if (typeof updateConversationsBadgeV38 === 'function') updateConversationsBadgeV38();
    if (typeof updateAuditBadgeV35 === 'function') updateAuditBadgeV35();
  };

  document.addEventListener('DOMContentLoaded', () => { try { window.rebuildSidebarV40(); } catch(e){} });
  setTimeout(() => { try { window.rebuildSidebarV40(); } catch(e){} }, 1200);
})();


/* V40.4 NotFoundError guard */
window.addEventListener('error', function(e){
  if (String(e.message || '').includes("insertBefore") || String(e.message || '').includes("NotFoundError")) {
    console.warn('Erro de menu protegido:', e.message);
    e.preventDefault?.();
    try { rebuildSidebarV40(); } catch(err){}
  }
});
