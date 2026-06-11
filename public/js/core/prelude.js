
/* V41.9 DELAYMIN ERROR GUARD */
window.addEventListener('error', function(e){
  const msg = String(e.message || '');
  if (msg.includes("delayMin")) {
    console.warn('delayMin protegido V41.9:', msg);
    e.preventDefault?.();
  }
}, true);


/* V41.9 SAFE CONFIG PRELUDE */
function getDisparoConfigSafeV419(){
  const defaults = {
    horarioInicio: '08:00',
    delayMin: 120,
    delayMax: 120,
    loteTamanho: 30,
    loteEsperaMin: 60,
    loteAtivo: 1
  };
  try {
    if (typeof getDisparoConfigSafeV418 === 'function') {
      return { ...defaults, ...(getDisparoConfigSafeV418() || {}) };
    }
  } catch {}
  try {
    const raw = localStorage.getItem('vs_evo_config_v2') || localStorage.getItem('vs_disparo_config') || localStorage.getItem('disparoConfig') || '{}';
    const parsed = JSON.parse(raw);
    return { ...defaults, ...(parsed && typeof parsed === 'object' ? parsed : {}) };
  } catch {
    return defaults;
  }
}
function getDisparoConfigSafeV418(){
  return getDisparoConfigSafeV419();
}


/* V41.8 PRELUDE SAFE DEFAULTS */
function getDisparoConfigSafeV418(){
  const defaults = {
    horarioInicio: '08:00',
    delayMin: 120,
    delayMax: 120,
    loteTamanho: 30,
    loteEsperaMin: 60,
    loteAtivo: 1
  };
  try {
    const raw = localStorage.getItem('vs_evo_config_v2') || localStorage.getItem('vs_disparo_config') || localStorage.getItem('disparoConfig') || '{}';
    const parsed = JSON.parse(raw);
    return { ...defaults, ...(parsed && typeof parsed === 'object' ? parsed : {}) };
  } catch {
    return defaults;
  }
}

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
const LEGACY_CHIPS_UPDATED_AT_KEY_V426 = 'vs_chips_v2_updated_at_v426';
const WHATSAPP_CHIP_DAILY_LIMIT_V426 = 180;
const WHATSAPP_CHIP_BLOCK_SIZE_V426 = 30;
const WHATSAPP_CHIP_INTERVAL_SECONDS_V426 = 120;
const WHATSAPP_CHIP_BLOCKS_V426 = Object.freeze(['08:00','10:00','12:00','14:00','16:00','18:00']);
const RAMOS_KEY      = 'vs_ramos_v2';
const TEMPLATES_KEY  = 'vs_templates_v2';
const TEMPLATES_RAMO_KEY = 'vs_templates_ramo_v1'; // templates por ramo+tipo
const VAL_KEY        = 'vs_validacao_v2';   // fila de validação
const ATRIBUICAO_KEY = 'vs_atribuicao_v1';  // base de atribuição (leads validados sem dia)
const INSTA_KEY      = 'vs_insta_fila_v2';  // fila instagram aguardando atribuição
const INSTA_WEEK_KEY = 'vs_insta_week_v1';  // leads instagram atribuídos por dia
const INSTA_SCHED_KEY = 'vs_insta_sched_v1'; // cronograma instagram
const FILA_DISPARO_KEY = 'vs_fila_disparo_v1'; // fila de disparo WhatsApp
const FILA_DISPARO_UPDATED_AT_KEY_V431 = 'vs_fila_disparo_v1_updated_at_v431';
const CHIP_DISPATCH_RUNTIME_KEY_V432 = 'vs_chip_dispatch_runtime_v432';
const RECUPERAR_VALIDACAO_ZAP_KEY = 'vs_recover_validacao_zap_v1';
const LEAD_CRM_KEY   = 'vs_lead_crm_v1'; // notas, histórico e pipeline comercial
const LEADS_BASE_KEY = 'vs_leads_base_v1'; // inventário permanente, independente da agenda semanal

// Supabase — usado primeiro apenas para login Google.
// Ainda não mexe nos leads e ainda não substitui o localStorage.
const SUPABASE_URL = 'https://txyknazfufashgzlxkqh.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_ClGVAmaiS4tNWe8W_4EPew_aPvAzK0E';
const sbClient = window.supabase
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
  : null;
let currentUser = null;
const AUTH_LOCAL_USER_KEY_V423 = 'vs_auth_local_user_v423';
const AUTH_LOCAL_EMAIL_KEY_V425 = 'vs_auth_local_email_v425';
const supabaseDataAdapter = (sbClient && window.SupabaseAdapter)
  ? new window.SupabaseAdapter(sbClient)
  : null;


/* V25 — identidade autenticada obrigatória para evitar dados órfãos ou vazamento entre contas. */
function getCurrentAuthIdentityV25() {
  const id = currentUser?.id ? String(currentUser.id).trim() : '';
  const email = currentUser?.email ? String(currentUser.email).trim().toLowerCase() : '';
  return { id, email, ok: !!(id && email) };
}

function requireCurrentAuthIdentityV25(context = 'operação protegida') {
  const identity = getCurrentAuthIdentityV25();
  if (!identity.ok) {
    console.warn('[user-isolation][auth-required]', { context, currentUserId: identity.id, currentUserEmail: identity.email });
    throw new Error('Usuário autenticado com email é obrigatório para esta operação.');
  }
  return identity;
}

function getScopedUserCacheKeyV25(baseKey = '') {
  const identity = getCurrentAuthIdentityV25();
  return identity.ok ? `${baseKey}:${identity.id}:${identity.email}` : `${baseKey}:anonymous`;
}

function userIsolationLogV25(step, data = {}) {
  try { console.log(`[user-isolation]${step}`, data); } catch(e) {}
}

function uiSyncLogV426(step, data = {}) {
  try { console.log(`[ui-sync][${step}]`, data); } catch(e) {}
}

const STATUS_OPTIONS = ['Não enviada','Em fila','Enviada','Respondida','Não respondida','Recusada','Fechada'];
const WEEKDAY_NAMES  = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];



/* ════════════════════════════
   AUTH GATE V20.2 FIXED
════════════════════════════ */
function isAuthenticated() {
  const identity = getCurrentAuthIdentityV25();
  return identity.ok;
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

function setMinhaContaTextV426(id, value = '') {
  const el = document.getElementById(id);
  if (el) el.textContent = String(value || '');
}

function renderMinhaContaV426(user = currentUser) {
  const connected = !!user?.id;
  const name = connected ? getUserDisplayName(user) : 'Conta desconectada';
  const email = connected ? String(user.email || '') : 'Entre com Google para acessar seus dados.';
  const provider = connected
    ? String(user.app_metadata?.provider || user.identities?.[0]?.provider || 'google')
    : '--';
  const createdAt = user?.created_at
    ? new Date(user.created_at).toLocaleString('pt-BR')
    : '--';
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part.charAt(0).toUpperCase())
    .join('') || '?';

  setMinhaContaTextV426('minhaContaAvatarV426', initials);
  setMinhaContaTextV426('minhaContaNomeV426', name);
  setMinhaContaTextV426('minhaContaEmailV426', email);
  setMinhaContaTextV426('minhaContaIdV426', connected ? user.id : '--');
  setMinhaContaTextV426('minhaContaProviderV426', provider);
  setMinhaContaTextV426('minhaContaCriadaEmV426', createdAt);
  setMinhaContaTextV426('minhaContaSessaoV426', connected ? 'Conectada' : 'Desconectada');
  setMinhaContaTextV426('minhaContaIsolamentoV426', connected ? 'Ativo por user_id e user_email' : 'Aguardando login');

  const status = document.getElementById('minhaContaSessaoV426');
  if (status) status.className = `account-v426-status ${connected ? 'ok' : 'warn'}`;
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
  renderMinhaContaV426(user);
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
  // Segurança multiusuário: ao deslogar/trocar conta, remover caches locais sensíveis.
  // A fonte persistente deve ser o Supabase filtrado por user_id.
  const exactKeys = [
    // Leads, funis e filas operacionais
    'vs_empresas_v2',
    'vs_history_v2',
    'vs_acompanhamento_v1',
    'vs_validacao_v2',
    'vs_atribuicao_v1',
    'vs_insta_fila_v2',
    'vs_insta_week_v1',
    'vs_insta_sched_v1',
    'vs_fila_disparo_v1',
    'vs_fila_disparo_v1_updated_at_v431',
    'vs_chip_dispatch_runtime_v432',
    'vs_recover_validacao_zap_v1',
    'vin_zap_backlog',
    'vs_lead_crm_v1',
    'vs_leads_base_v1',

    // Configurações e caches WhatsApp/Evolution
    'vs_chips_v2',
    'vs_chips_v2_updated_at_v426',
    'vs_whatsapp_chips_v29',
    'vs_chip_usage_day_v29',
    'vs_evolution_settings_v1',
    'vs_evo_config_v2',
    'vs_whatsapp_messages_cache_v412',
    'vs_whatsapp_outbox_v412',
    'vs_evolution_responses_v34',
    'vs_whatsapp_conversation_meta_v421',
    'vs_whatsapp_queue_v27',
    'vs_queue_campaigns_v27',
    'vs_queue_templates_v27',
    'vs_whatsapp_queue_control_v28',
    'vs_dispatch_v30_log',
    'vs_dispatch_runtime_v32',

    // Preferências operacionais que também podem conter dados de negócio
    'vs_excluded_domains',
    'vs_ramos_v2',
    'vs_templates_v2',
    'vs_templates_ramo_v1',
    'vs_templates_insta_v1',
    'vs_insta_templates_v1',
    'vs_lote_cfg_v1',
    'vs_disparo_config',
    'disparoConfig',
    'vs_supabase_sync_state_v1'
  ];
  exactKeys.forEach(key => { try { localStorage.removeItem(key); } catch(e){} });
  try { localStorage.removeItem(SYNC_STATE_KEY); } catch(e){}

  // Remove chaves com sufixo de usuário antigo, para impedir que outra conta enxergue dados locais.
  try {
    Object.keys(localStorage).forEach(key => {
      if (
        key.startsWith('vs_whatsapp_chips_v29:') ||
        key.startsWith('vs_chip_usage_day_v29:') ||
        key.startsWith('vs_whatsapp_messages_cache_v412:') ||
        key.startsWith('vs_whatsapp_outbox_v412:') ||
        key.startsWith('vs_evolution_responses_v34:') ||
        key.startsWith('vs_whatsapp_conversation_meta_v421:') ||
        key.startsWith('vs_conversation_status_v412:') ||
        key.startsWith('vs_operational_dirty_at_v430:')
      ) localStorage.removeItem(key);
    });
  } catch(e){}

  try { filaDisparo = {}; } catch(e){}
  try { supabaseWhatsappMessagesCacheV412 = []; } catch(e){}
  try { whatsappContactMapCacheV418 = []; } catch(e){}
  try { localStorage.removeItem(AUTH_LOCAL_USER_KEY_V423); } catch(e){}
  try { localStorage.removeItem(AUTH_LOCAL_EMAIL_KEY_V425); } catch(e){}
  updateAuthGate();
  try { updateChipsBadge(); } catch(e){}
  try { renderChipsPanel(); } catch(e){}
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
  const lastLocalUserId = localStorage.getItem(AUTH_LOCAL_USER_KEY_V423) || '';
  const lastLocalUserEmail = localStorage.getItem(AUTH_LOCAL_EMAIL_KEY_V425) || '';
  if (currentUser?.id) {
    const currentEmail = String(currentUser.email || '').trim().toLowerCase();
    if ((lastLocalUserId && lastLocalUserId !== currentUser.id) || (lastLocalUserEmail && lastLocalUserEmail !== currentEmail)) {
      clearLocalSessionData();
    }
    localStorage.setItem(AUTH_LOCAL_USER_KEY_V423, currentUser.id);
    localStorage.setItem(AUTH_LOCAL_EMAIL_KEY_V425, currentEmail);
  }
  
  if (!currentUser) {
    clearLocalSessionData();
  }
renderAuthUser(currentUser);
  updateAuthGate();
  renderProductionReadyNote();

  sbClient.auth.onAuthStateChange(async (_event, session) => {
    const previousUserId = currentUser?.id || '';
    const previousUserEmail = String(currentUser?.email || '').trim().toLowerCase();
    const nextUserId = session?.user?.id || '';
    const nextUserEmail = String(session?.user?.email || '').trim().toLowerCase();
    if ((previousUserId && nextUserId && previousUserId !== nextUserId) || (previousUserEmail && nextUserEmail && previousUserEmail !== nextUserEmail)) {
      clearLocalSessionData();
    }
    currentUser = session?.user || null;
    if (currentUser?.id) {
      localStorage.setItem(AUTH_LOCAL_USER_KEY_V423, currentUser.id);
      localStorage.setItem(AUTH_LOCAL_EMAIL_KEY_V425, String(currentUser.email || '').trim().toLowerCase());
    }
    renderAuthUser(currentUser);
    updateAuthGate();

    if (currentUser) {
      let operationalLoaded = false;
      try { operationalLoaded = await loadOperationalDataFromSupabaseV36(); } catch(e){}
      if (typeof loadSupabaseAsPrimarySource === 'function') {
        await loadSupabaseAsPrimarySource({ preserveWorkflow: operationalLoaded });
      } else if (typeof loadSupabaseLeadsToLocalState === 'function') {
        await loadSupabaseLeadsToLocalState({ preserveWorkflow: operationalLoaded });
      }
      if (typeof loadWhatsappChipsFromSupabaseV22 === 'function') {
        await loadWhatsappChipsFromSupabaseV22();
        if (typeof renderChipsPanel === 'function') renderChipsPanel();
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
    let operationalLoaded = false;
    try { operationalLoaded = await loadOperationalDataFromSupabaseV36(); } catch(e){}
    await loadSupabaseAsPrimarySource({ preserveWorkflow: operationalLoaded });
    if (typeof loadWhatsappChipsFromSupabaseV22 === 'function') {
      await loadWhatsappChipsFromSupabaseV22();
      if (typeof renderChipsPanel === 'function') renderChipsPanel();
    }
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
  localStorage.removeItem('vs_empresas_v2');
  localStorage.removeItem('vs_lead_crm_v1');
  localStorage.removeItem('vs_leads_base_v1');

  currentUser = null;
  if (typeof clearLocalSessionData === 'function') clearLocalSessionData();

  renderAuthUser(null);

  if (typeof renderInicio === 'function') renderInicio();
  if (typeof updateBadges === 'function') updateBadges();

  showAuthGate();

  if (!sbClient) {
    notify('Conta desconectada');
    return;
  }

  try {
    const { error } = await sbClient.auth.signOut();
    if (error) {
      console.warn('[auth] logout remoto:', error.message);
      notify('Sessão local encerrada. Recarregue se necessário.', 'warn');
      return;
    }
    notify('Conta desconectada');
  } catch (error) {
    console.warn('[auth] logout remoto:', error?.message || error);
    notify('Sessão local encerrada. Recarregue se necessário.', 'warn');
  }
}
