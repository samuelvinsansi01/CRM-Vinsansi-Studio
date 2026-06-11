const CRM_DEBUG_LOGS_V434 = (() => {
  try { return new URLSearchParams(window.location.search).get('debug') === '1'; }
  catch { return false; }
})();
(function setupQuietConsoleV434(){
  if (window.__crmQuietConsoleV434) return;
  window.__crmQuietConsoleV434 = true;
  const original = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    debug: console.debug.bind(console),
    warn: console.warn.bind(console),
    groupCollapsed: console.groupCollapsed?.bind(console),
    groupEnd: console.groupEnd?.bind(console)
  };
  window.__crmConsoleOriginalV434 = original;
  const noisy = [
    '[ui-sync]', '[qualification', '[lead-drawer]', '[lead-presentations]',
    '[whatsapp-send]', '[message-send]', '[operational-data', '[lead-import',
    '[agenda-', '[whatsapp-queue]', '[dispatch][persist]', '[user-isolation]',
    '[chips]', '[contact-map]', '[whatsapp_messages][persist]', '[supabase]',
    '[lead-sync', '[lead-dedupe]', '[insta]', '[migra'
  ];
  const isNoisy = args => noisy.some(prefix => String(args?.[0] || '').startsWith(prefix) || String(args?.[0] || '').includes(prefix));
  console.log = (...args) => { if (CRM_DEBUG_LOGS_V434) original.log(...args); };
  console.info = (...args) => { if (CRM_DEBUG_LOGS_V434) original.info(...args); };
  console.debug = (...args) => { if (CRM_DEBUG_LOGS_V434) original.debug(...args); };
  console.groupCollapsed = (...args) => { if (CRM_DEBUG_LOGS_V434 && original.groupCollapsed) original.groupCollapsed(...args); };
  console.groupEnd = (...args) => { if (CRM_DEBUG_LOGS_V434 && original.groupEnd) original.groupEnd(...args); };
  console.warn = (...args) => {
    if (!CRM_DEBUG_LOGS_V434 && isNoisy(args)) return;
    original.warn(...args);
  };
})();

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
    const parsed = (typeof v48StateGetObject === 'function') ? v48StateGetObject('vs_evo_config_v2') : {};
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
    const parsed = (typeof v48StateGetObject === 'function') ? v48StateGetObject('vs_evo_config_v2') : {};
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
const PUBLIC_EVOLUTION_URL_V437 = 'https://evolution.samuelvinsansi.com.br';
const WHATSAPP_CHIP_DAILY_LIMIT_V426 = 120;
const WHATSAPP_CHIP_BLOCK_SIZE_V426 = 30;
const WHATSAPP_CHIP_INTERVAL_SECONDS_V426 = 120;
const WHATSAPP_CHIP_BLOCKS_V426 = Object.freeze(['08:00','10:00','12:00','14:00']);
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

// Supabase — fonte oficial de autenticação e dados operacionais.
const SUPABASE_URL = 'https://txyknazfufashgzlxkqh.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_ClGVAmaiS4tNWe8W_4EPew_aPvAzK0E';
const sbClient = window.supabase
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
  : null;
let currentUser = null;
function getLoteSize() {
  const inputValue = Number(document.getElementById('loteTamanho')?.value || 0);
  let configValue = 0;
  try {
    if (typeof loadEvoConfig === 'function') {
      configValue = Number(loadEvoConfig()?.loteTamanho || 0);
    }
  } catch {}
  const value = inputValue || configValue || WHATSAPP_CHIP_BLOCK_SIZE_V426 || 30;
  const normalized = Math.max(1, Number.isFinite(value) ? Math.floor(value) : 30);
  return Math.min(WHATSAPP_CHIP_BLOCK_SIZE_V426 || 30, normalized);
}

function getDefaultEvolutionUrlV436() {
  try {
    const host = window.location.hostname;
    return (host === 'localhost' || host === '127.0.0.1' || host === '::1') ? 'http://localhost:8080' : PUBLIC_EVOLUTION_URL_V437;
  } catch {
    return PUBLIC_EVOLUTION_URL_V437;
  }
}

function getEvolutionBaseUrl(chip = {}) {
  const url =
    chip?.url ||
    chip?.baseUrl ||
    chip?.base_url ||
    chip?.evolutionUrl ||
    chip?.evolution_url ||
    chip?.baseEvolutionUrl ||
    window.currentEvolutionUrl ||
    getDefaultEvolutionUrlV436();

  return normalizeEvolutionUrlForStorageV437(url);
}

function isLocalPanelHostV436() {
  try {
    const host = window.location.hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}

function isLoopbackEvolutionBaseUrlV436(baseUrl = '') {
  const raw = String(baseUrl || '').trim();
  if (!raw) return false;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.startsWith('127.');
  } catch {
    return /(?:localhost|127\.0\.0\.1|^127\.)/i.test(raw);
  }
}

function assertEvolutionBaseUrlV436(baseUrl = '') {
  if (!baseUrl) {
    throw new Error('Evolution URL ausente. Configure a URL publica HTTPS no chip.');
  }
  if (!isLocalPanelHostV436() && isLoopbackEvolutionBaseUrlV436(baseUrl)) {
    throw new Error('Evolution URL invalida em producao. Use uma URL publica HTTPS.');
  }
  return baseUrl;
}

function normalizeEvolutionUrlForStorageV437(url = '') {
  const cleaned = String(url || '').trim().replace(/\/+$/, '');
  if (!cleaned) return getDefaultEvolutionUrlV436();
  if (!isLocalPanelHostV436() && isLoopbackEvolutionBaseUrlV436(cleaned)) {
    return PUBLIC_EVOLUTION_URL_V437;
  }
  return cleaned;
}

function normalizeChipEvolutionUrlForStorageV437(chip = {}, fallback = '') {
  const raw =
    chip?.url ||
    chip?.baseUrl ||
    chip?.base_url ||
    chip?.evolutionUrl ||
    chip?.evolution_url ||
    chip?.baseEvolutionUrl ||
    fallback ||
    '';
  return normalizeEvolutionUrlForStorageV437(raw);
}

function normalizeChipForStorageV437(chip = {}, fallback = '') {
  if (!chip || typeof chip !== 'object') return chip;
  const url = normalizeChipEvolutionUrlForStorageV437(chip, fallback);
  const baseUrl = normalizeEvolutionUrlForStorageV437(chip.baseUrl || chip.base_url || url);
  const evolutionUrl = normalizeEvolutionUrlForStorageV437(chip.evolutionUrl || chip.evolution_url || url);
  return {
    ...chip,
    url,
    baseUrl,
    base_url: baseUrl,
    evolutionUrl,
    evolution_url: evolutionUrl
  };
}

function normalizeChipListForStorageV437(list = []) {
  return (Array.isArray(list) ? list : []).map(chip => normalizeChipForStorageV437(chip));
}

function disableBrowserEvolutionCache() { return; }

disableBrowserEvolutionCache();

function whatsappContentHashV436(value = '') {
  const str = String(value || '');
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function whatsappSendLogV436(event, payload = {}) {
  const logger = window.__crmConsoleOriginalV434?.log || console.log;
  try { logger(`[whatsapp-send][${event}]`, payload); } catch(e) {}
}
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

function uiSyncLog(step, data = {}) {
  try { console.log(`[ui-sync][${step}]`, data); } catch(e) {}
}


/* V31 — utilitários globais de dedupe e trava de envio.
   Mantém a UI e o snapshot operacional seguros mesmo quando caches antigos estão sujos. */
function normalizePhoneStrictV31(value = '') {
  let digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  // Para números brasileiros sem DDI, adiciona 55 quando tiver DDD + número.
  if (!digits.startsWith('55') && (digits.length === 10 || digits.length === 11)) digits = '55' + digits;
  return digits;
}

function normalizeTextKeyV31(value = '') {
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function getLeadPhoneKeyV31(item = {}) {
  return normalizePhoneStrictV31(
    item.phone || item.telefone || item.whatsapp || item.number || item.numero || item.mobile || ''
  );
}

function getLeadDedupeKeyV31(item = {}) {
  const phone = getLeadPhoneKeyV31(item);
  if (phone) return `phone:${phone}`;
  const name = normalizeTextKeyV31(item.company_name || item.nome || item.title || item.name || '');
  const url = normalizeTextKeyV31(item.googleUrl || item.google_url || item.url || item.placeId || item.place_id || '');
  if (name && url) return `name-url:${name}:${url}`;
  if (name) return `name:${name}`;
  return '';
}

function mergeLeadDedupeV31(base = {}, extra = {}) {
  const out = { ...(base || {}) };
  Object.entries(extra || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    if (out[key] === undefined || out[key] === null || out[key] === '') out[key] = value;
  });
  const basePhone = getLeadPhoneKeyV31(out) || getLeadPhoneKeyV31(extra);
  if (basePhone) {
    if (!out.phone) out.phone = basePhone;
    if (!out.telefone) out.telefone = basePhone;
    if (!out.whatsapp) out.whatsapp = basePhone;
  }
  return out;
}

function dedupeLeadArrayV31(list = [], source = 'unknown') {
  const arr = Array.isArray(list) ? list : [];
  const seen = new Map();
  const output = [];
  const removed = [];
  arr.forEach((item, index) => {
    if (!item || typeof item !== 'object') {
      output.push(item);
      return;
    }
    const key = getLeadDedupeKeyV31(item);
    if (!key) {
      output.push(item);
      return;
    }
    if (!seen.has(key)) {
      seen.set(key, output.length);
      output.push(item);
      return;
    }
    const targetIndex = seen.get(key);
    output[targetIndex] = mergeLeadDedupeV31(output[targetIndex], item);
    removed.push({ index, key, id:item.id || '', name:item.nome || item.company_name || item.title || '', phone:getLeadPhoneKeyV31(item) });
  });
  if (removed.length) {
    try { console.warn('[lead-dedupe][array]', { source, before:arr.length, after:output.length, removed:removed.length, removedItems:removed.slice(0, 25) }); } catch(e) {}
  }
  return output;
}

function dedupeWeeklyLeadsV31(weekly = {}, source = 'weeklyLeads') {
  if (!weekly || typeof weekly !== 'object') return weekly;
  const copy = { ...weekly, days:{ ...(weekly.days || {}) } };
  const totalBefore = Object.values(copy.days || {}).flat().length;
  const seen = new Map();
  const removed = [];
  try { console.log('[agenda-before-render]', { source, total:totalBefore }); } catch(e) {}
  Object.keys(copy.days || {}).forEach(day => {
    const cleanDay = dedupeLeadArrayV31(copy.days[day] || [], `${source}.${day}`);
    const nextDay = [];
    cleanDay.forEach(item => {
      const key = getLeadDedupeKeyV31(item);
      if (!key) {
        nextDay.push(item);
        return;
      }
      if (!seen.has(key)) {
        seen.set(key, { day, index:nextDay.length });
        nextDay.push(item);
        return;
      }
      const previous = seen.get(key);
      copy.days[previous.day][previous.index] = mergeLeadDedupeV31(copy.days[previous.day][previous.index], item);
      removed.push({ day, key, id:item.id || '', phone:getLeadPhoneKeyV31(item) });
    });
    copy.days[day] = nextDay;
  });
  const totalAfter = Object.values(copy.days || {}).flat().length;
  try { console.log('[agenda-after-dedupe]', { source, totalBefore, totalAfter, removed:removed.length }); } catch(e) {}
  return copy;
}

function dedupeFilaDisparoV31(fila = {}, source = 'filaDisparo') {
  if (!fila || typeof fila !== 'object' || Array.isArray(fila)) return fila;
  const copy = { ...fila };
  const seen = new Set();
  let removed = 0;
  Object.keys(copy).forEach(chipId => {
    copy[chipId] = dedupeLeadArrayV31(copy[chipId] || [], `${source}.${chipId}`).filter(item => {
      const key = getLeadDedupeKeyV31(item);
      if (!key) return true;
      if (seen.has(key)) {
        removed++;
        return false;
      }
      seen.add(key);
      return true;
    });
  });
  try { console.log('[whatsapp-queue]', { action:'dedupe', source, removed, total:Object.values(copy).flat().length }); } catch(e) {}
  return copy;
}

function dedupeOperationalSnapshotV31(snapshot = {}, source = 'operational-snapshot') {
  if (!snapshot || typeof snapshot !== 'object') return snapshot;
  const next = { ...snapshot, data:{ ...(snapshot.data || {}) } };
  const data = next.data;
  if (data.weeklyLeads) data.weeklyLeads = dedupeWeeklyLeadsV31(data.weeklyLeads, `${source}.weeklyLeads`);
  if (data.whatsappDispatchQueues) data.whatsappDispatchQueues = dedupeFilaDisparoV31(data.whatsappDispatchQueues, `${source}.whatsappDispatchQueues`);
  // Mensagens e outbox podem conter varios eventos legitimos para o mesmo telefone.
  ['permanentLeads','validationQueue','assignmentQueue','instagramQueue','whatsappBacklog','whatsappQueue'].forEach(key => {
    if (Array.isArray(data[key])) data[key] = dedupeLeadArrayV31(data[key], `${source}.${key}`);
  });
  try { console.log('[operational-data-dedupe]', { source }); } catch(e) {}
  return next;
}

function getWhatsappSendGuardKeyV31({ leadId = '', phone = '', text = '', content = '', instance = '', part = 'text' } = {}) {
  const phoneKey = normalizePhoneStrictV31(phone);
  const partKey = normalizeTextKeyV31(part || 'text') || 'text';
  const contentKey = whatsappContentHashV436(content || text || '');
  return `${leadId || 'no-lead'}|${phoneKey}|${instance || ''}|${partKey}|${contentKey}`;
}

function acquireWhatsappSendLockV31(payload = {}, ttlMs = 10000) {
  const key = getWhatsappSendGuardKeyV31(payload);
  if (!key || key.includes('||')) return { ok:true, key };
  window.__whatsappSendLocksV31 = window.__whatsappSendLocksV31 || new Map();
  const now = Date.now();
  const prev = window.__whatsappSendLocksV31.get(key);
  window.__VS_SEND_LOCKS_V49 = window.__VS_SEND_LOCKS_V49 || {};
  const storedAt = Number(window.__VS_SEND_LOCKS_V49[key] || 0);
  const activeAt = Math.max(Number(prev || 0), storedAt);
  if (activeAt && now - activeAt < ttlMs) {
    try { console.warn('[message-send-blocked]', { reason:'duplicate-lock', key, ageMs:now - activeAt, phone:payload.phone, leadId:payload.leadId }); } catch(e) {}
    try { console.warn('[whatsapp-send-blocked]', { reason:'duplicate-lock', key, ageMs:now - activeAt, phone:payload.phone, leadId:payload.leadId }); } catch(e) {}
    whatsappSendLogV436('duplicate-blocked', { reason:'duplicate-lock', key, ageMs:now - activeAt, phone:payload.phone, leadId:payload.leadId, part:payload.part || '' });
    return { ok:false, key, ageMs:now - activeAt };
  }
  window.__whatsappSendLocksV31.set(key, now);
  window.__VS_SEND_LOCKS_V49[key] = now;
  try { console.log('[message-send][lock-start]', { key, phone:payload.phone, leadId:payload.leadId }); } catch(e) {}
  try { console.log('[whatsapp-send]', { action:'lock-start', key, phone:payload.phone, leadId:payload.leadId }); } catch(e) {}
  return { ok:true, key };
}

function releaseWhatsappSendLockV31(key = '') {
  if (!key || !window.__whatsappSendLocksV31) return;
  setTimeout(() => {
    try { window.__whatsappSendLocksV31.delete(key); } catch(e) {}
    try { delete window.__VS_SEND_LOCKS_V49[key]; } catch(e) {}
  }, 10000);
}

const LEAD_SENT_OR_CLOSED_STATUSES_V433 = ['enviada','enviado','respondida','nao respondida','recusada','fechada'];

function isTemporaryDispatchLeadV433(lead = {}) {
  const id = String(lead?.id || lead?.leadId || lead?.lead_id || '').trim().toLowerCase();
  return !!(
    lead?.isTemporaryDispatchLead ||
    lead?.isTestLead ||
    lead?.temporaryLead ||
    lead?.testDispatchLead ||
    lead?.stage === 'dispatch_test' ||
    lead?.source === 'Teste temporario' ||
    id.startsWith('teste-') ||
    id.startsWith('test-') ||
    id.includes('teste-chip')
  );
}

function isLeadSentOrClosedV433(lead = {}) {
  const status = typeof normalizeStr === 'function'
    ? normalizeStr(lead.status || lead.whatsappStatus || '')
    : String(lead.status || lead.whatsappStatus || '').toLowerCase();
  return LEAD_SENT_OR_CLOSED_STATUSES_V433.includes(status)
    || lead.status === 'enviado'
    || lead.status === 'Enviado'
    || lead.whatsappStatus === 'sent'
    || !!lead.enviadoEm
    || !!lead.sentAt;
}

function isLeadWhatsappApprovedForPersistenceV433(lead = {}) {
  return lead.numStatus === 'valido'
    || lead.whatsappValidationStatus === 'valid'
    || lead.crmData?.whatsappValidation?.status === 'valid'
    || lead.crm_data?.whatsappValidation?.status === 'valid'
    || lead.leadCrm?.whatsappValidation?.status === 'valid';
}

function isLeadPersistentReadyV433(lead = {}, source = '') {
  if (!lead?.id || isTemporaryDispatchLeadV433(lead)) return false;
  const sourceKey = String(source || lead.baseSource || lead.origem || '').toLowerCase();
  if (sourceKey.includes('valid')) {
    return isLeadWhatsappApprovedForPersistenceV433(lead) || isLeadSentOrClosedV433(lead);
  }
  if (lead.stage === 'validation' && !isLeadWhatsappApprovedForPersistenceV433(lead) && !isLeadSentOrClosedV433(lead)) {
    return false;
  }
  return true;
}

function filterPersistentLeadsV433(leads = [], source = '') {
  return (Array.isArray(leads) ? leads : []).filter(lead => isLeadPersistentReadyV433(lead, source));
}

function shouldSkipLeadCloudPersistenceV433(lead = {}, source = '') {
  return !isLeadPersistentReadyV433(lead, source);
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

function getLoginUrlV662() {
  try {
    const next = `${window.location.pathname || '/'}${window.location.search || ''}${window.location.hash || ''}`;
    const safeNext = next && !next.startsWith('/login') ? next : '/';
    return `/login?next=${encodeURIComponent(safeNext)}`;
  } catch {
    return '/login';
  }
}

function showAuthGate() {
  // V6.62: login saiu do modal e virou página própria.
  // Se o usuário não estiver autenticado dentro do app principal, manda para /login.
  if (window.location.pathname !== '/login' && !window.location.pathname.startsWith('/login/')) {
    window.location.replace(getLoginUrlV662());
  }
}

function hideAuthGate() {
  document.documentElement.classList.remove('auth-locked');
  document.body.classList.remove('auth-locked');
}

function updateAuthGate() {
  if (isAuthenticated()) hideAuthGate();
  else showAuthGate();
}

document.addEventListener('DOMContentLoaded', () => {
  updateAuthGate();
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

  return `${window.location.origin}/`;
}

function getUserDisplayName(user) {
  if (!user) return '';
  return user.user_metadata?.full_name || user.user_metadata?.name || user.email || 'Usuário';
}

function setMinhaContaTextV426(id, value = '') {
  const el = document.getElementById(id);
  if (el) el.textContent = String(value || '');
}

function renderMinhaConta(user = currentUser) {
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

  setMinhaContaTextV426('minhaContaAvatar', initials);
  setMinhaContaTextV426('minhaContaNome', name);
  setMinhaContaTextV426('minhaContaEmail', email);
  setMinhaContaTextV426('minhaContaId', connected ? user.id : '--');
  setMinhaContaTextV426('minhaContaProvider', provider);
  setMinhaContaTextV426('minhaContaCriadaEm', createdAt);
  setMinhaContaTextV426('minhaContaSessao', connected ? 'Conectada' : 'Desconectada');
  setMinhaContaTextV426('minhaContaIsolamento', connected ? 'Ativo por user_id e user_email' : 'Aguardando login');

  const status = document.getElementById('minhaContaSessao');
  if (status) status.className = `account-card-status ${connected ? 'ok' : 'warn'}`;
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
  renderMinhaConta(user);
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
  // V49 CLEAN: limpa somente memória operacional da sessão atual.
  window.__VS_OPERATIONAL_STATE = {};
  window.__VS_OPERATIONAL_STATE_LOADED = false;
  window.__VS_OPERATIONAL_DIRTY_AT = '';
  try { filaDisparo = {}; } catch(e){}
  try { supabaseWhatsappMessagesCacheV412 = []; } catch(e){}
  try { whatsappContactMapCacheV418 = []; } catch(e){}
  try { sessionStorage.removeItem(AUTH_LOCAL_USER_KEY_V423); } catch(e){}
  try { sessionStorage.removeItem(AUTH_LOCAL_EMAIL_KEY_V425); } catch(e){}
  updateAuthGate();
  try { updateChipsBadge(); } catch(e){}
  try { renderChipsPanel(); } catch(e){}
}

function hasUnscopedLocalSessionDataV432() { return false; }

let authHydrationPromiseV436 = null;
let authHydrationKeyV436 = '';
let authHydrationAtV436 = 0;

async function hydrateAuthenticatedUserDataV436() {
  if (!currentUser?.id) return;
  const key = `${currentUser.id}:${String(currentUser.email || '').trim().toLowerCase()}`;
  const recentlyHydrated = authHydrationKeyV436 === key && (Date.now() - authHydrationAtV436) < 5000;
  if (recentlyHydrated) return;
  if (authHydrationPromiseV436) return authHydrationPromiseV436;

  authHydrationPromiseV436 = (async () => {
    let operationalLoaded = false;
    try { operationalLoaded = await loadOperationalDataFromSupabase(); } catch(e){}
    try {
      if (typeof loadSupabaseAsPrimarySource === 'function') {
        await loadSupabaseAsPrimarySource({ preserveWorkflow: operationalLoaded });
      } else if (typeof loadSupabaseLeadsToLocalState === 'function') {
        await loadSupabaseLeadsToLocalState({ preserveWorkflow: operationalLoaded });
      }
    } catch(e) {
      console.warn('[auth] hydrate leads:', e?.message || e);
    }
    try {
      if (typeof loadWhatsappChipsFromSupabaseV22 === 'function') {
        await loadWhatsappChipsFromSupabaseV22();
        if (typeof renderChipsPanel === 'function') renderChipsPanel();
      }
    } catch(e) {
      console.warn('[auth] hydrate chips:', e?.message || e);
    }
    authHydrationKeyV436 = key;
    authHydrationAtV436 = Date.now();
  })().finally(() => {
    authHydrationPromiseV436 = null;
  });

  return authHydrationPromiseV436;
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
  const lastLocalUserId = sessionStorage.getItem(AUTH_LOCAL_USER_KEY_V423) || '';
  const lastLocalUserEmail = sessionStorage.getItem(AUTH_LOCAL_EMAIL_KEY_V425) || '';
  if (currentUser?.id) {
    const currentEmail = String(currentUser.email || '').trim().toLowerCase();
    const accountChanged = (lastLocalUserId && lastLocalUserId !== currentUser.id)
      || (lastLocalUserEmail && lastLocalUserEmail !== currentEmail);
    const unownedBrowserCache = (!lastLocalUserId || !lastLocalUserEmail) && hasUnscopedLocalSessionDataV432();
    if (accountChanged || unownedBrowserCache) {
      try { console.warn('[user-isolation][cache-clear]', { accountChanged:!!accountChanged, unownedBrowserCache }); } catch(e) {}
      clearLocalSessionData();
    }
    sessionStorage.setItem(AUTH_LOCAL_USER_KEY_V423, currentUser.id);
    sessionStorage.setItem(AUTH_LOCAL_EMAIL_KEY_V425, currentEmail);
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
      sessionStorage.setItem(AUTH_LOCAL_USER_KEY_V423, currentUser.id);
      sessionStorage.setItem(AUTH_LOCAL_EMAIL_KEY_V425, String(currentUser.email || '').trim().toLowerCase());
    }
    renderAuthUser(currentUser);
    updateAuthGate();

    if (currentUser) {
      await hydrateAuthenticatedUserDataV436();
    } else {
      if (typeof clearLocalSessionData === 'function') clearLocalSessionData();
      
      
      if (typeof renderInicio === 'function') renderInicio();
      if (typeof updateBadges === 'function') updateBadges();
    }
  });

  if (currentUser) {
    await hydrateAuthenticatedUserDataV436();
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

async function logoutSupabase(confirmed = false) {
  if (!confirmed) {
    const message = 'Sair da conta?';
    if (typeof abrirModalConfirm === 'function') {
      abrirModalConfirm(message, () => { logoutSupabase(true); });
      return;
    }
    if (typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.confirm(message)) return;
  }

  currentUser = null;
  if (typeof clearLocalSessionData === 'function') clearLocalSessionData();

  renderAuthUser(null);

  if (typeof renderInicio === 'function') renderInicio();
  if (typeof updateBadges === 'function') updateBadges();

  window.location.replace('/login');

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


/* V47 — regras de negócio: site/sem site, bloqueio anti-reenvio e helpers de backlog */
const WHATSAPP_SITE_SEGMENT_WITH_SITE_V47 = 'com-site';
const WHATSAPP_SITE_SEGMENT_NO_SITE_V47 = 'sem-site';

function normalizeUrlHostV47(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try { return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.replace(/^www\./,'').toLowerCase(); }
  catch { return ''; }
}

function getLeadSiteUrlV47(lead = {}) {
  return String(lead.site || lead.website || lead.websiteUrl || lead.website_url || '').trim();
}

function leadHasOwnSiteV47(lead = {}) {
  // V48.2 — detecção robusta para preservar a diferença operacional
  // entre WhatsApp sem site e Com Sites. Alguns fluxos salvam apenas
  // o segmento/tipo, outros salvam a URL. A aba Com Sites precisa
  // respeitar ambos.
  const explicitSegment = String(
    lead.siteSegment || lead.templateType || lead.tipo || lead.website_type || lead.websiteType || ''
  ).toLowerCase();
  if (explicitSegment === WHATSAPP_SITE_SEGMENT_WITH_SITE_V47 || explicitSegment === 'commercial' || explicitSegment === 'wixsite') return true;
  if (explicitSegment === WHATSAPP_SITE_SEGMENT_NO_SITE_V47 || explicitSegment === 'none') return false;
  if (lead.hasOwnSite === true) return true;

  const site = getLeadSiteUrlV47(lead);
  if (!site) return false;
  const host = normalizeUrlHostV47(site);
  if (!host) return false;
  const blocked = ['instagram.com','facebook.com','fb.com','wa.me','whatsapp.com','api.whatsapp.com','google.com','google.com.br','maps.google.com','goo.gl','linktr.ee','linktree.com'];
  return !blocked.some(domain => host === domain || host.endsWith('.' + domain));
}

function getLeadTemplateTypeV47(lead = {}) {
  return leadHasOwnSiteV47(lead) ? WHATSAPP_SITE_SEGMENT_WITH_SITE_V47 : WHATSAPP_SITE_SEGMENT_NO_SITE_V47;
}

function markLeadSegmentV47(lead = {}) {
  const tipo = getLeadTemplateTypeV47(lead);
  lead.tipo = tipo;
  lead.templateType = tipo;
  lead.siteSegment = tipo;
  lead.hasOwnSite = tipo === WHATSAPP_SITE_SEGMENT_WITH_SITE_V47;
  return lead;
}

function getLeadSentLedgerV47() {
  try {
    if (typeof v48StateGetObject === 'function') return v48StateGetObject('vs_whatsapp_sent_ledger_v47');
    return (typeof v48StateGetObject === 'function') ? v48StateGetObject('vs_whatsapp_sent_ledger_v47') : {};
  }
  catch { return {}; }
}
function saveLeadSentLedgerV47(ledger = {}) {
  try {
    if (typeof v48StateSet === 'function') v48StateSet('vs_whatsapp_sent_ledger_v47', ledger || {}, 'whatsapp-sent-ledger-save');
    else if (typeof v48StateSet === 'function') v48StateSet('vs_whatsapp_sent_ledger_v47', ledger || {}, 'sent-ledger-save');
  } catch(e) {}
}
function markLeadAsDispatchedEverV47(lead = {}, meta = {}) {
  const ledger = getLeadSentLedgerV47();
  const phone = typeof getLeadPhoneKeyV31 === 'function' ? getLeadPhoneKeyV31(lead) : String(lead.whatsapp || lead.phone || '').replace(/\D/g,'');
  const keys = [lead.id ? `id:${lead.id}` : '', phone ? `phone:${phone}` : ''].filter(Boolean);
  keys.forEach(key => { ledger[key] = { at:new Date().toISOString(), leadId:lead.id || '', phone, ...meta }; });
  saveLeadSentLedgerV47(ledger);
}
function wasLeadDispatchedEverV47(lead = {}) {
  if (!lead || typeof lead !== 'object') return false;
  if (typeof isLeadSentOrClosedV433 === 'function' && isLeadSentOrClosedV433(lead)) return true;
  const ledger = getLeadSentLedgerV47();
  const phone = typeof getLeadPhoneKeyV31 === 'function' ? getLeadPhoneKeyV31(lead) : String(lead.whatsapp || lead.phone || '').replace(/\D/g,'');
  if (lead.id && ledger[`id:${lead.id}`]) return true;
  if (phone && ledger[`phone:${phone}`]) return true;
  if (lead.status === 'Enviada' || lead.status === 'enviado' || lead.whatsappStatus === 'sent') return true;
  return false;
}

function upsertUniqueLeadByDedupeV47(list = [], lead = {}) {
  const arr = Array.isArray(list) ? [...list] : [];
  const key = typeof getLeadDedupeKeyV31 === 'function' ? getLeadDedupeKeyV31(lead) : (lead.id || '');
  const idx = arr.findIndex(item => item?.id === lead.id || (key && typeof getLeadDedupeKeyV31 === 'function' && getLeadDedupeKeyV31(item) === key));
  if (idx >= 0) arr[idx] = { ...arr[idx], ...lead };
  else arr.push(lead);
  return arr;
}


/* 6.83 fallback seguro para botão mobile/sidebar */
if (typeof window.toggleSidebar !== 'function') {
  window.toggleSidebar = function toggleSidebarFallbackV683() {
    try {
      const body = document.body;
      const sidebar =
        document.querySelector('.sidebar') ||
        document.querySelector('#sidebar') ||
        document.querySelector('.app-sidebar') ||
        document.querySelector('aside');
      body?.classList.toggle('sidebar-open');
      sidebar?.classList.toggle('open');
      sidebar?.classList.toggle('is-open');
    } catch (error) {
      console.warn('[sidebar-v683]', error);
    }
  };
}


/* 7.00 fallback seguro para sidebar */
if (typeof window.toggleSidebar !== 'function') {
  window.toggleSidebar = function toggleSidebarFallbackV700() {
    try {
      const body = document.body;
      const sidebar =
        document.querySelector('.sidebar') ||
        document.querySelector('#sidebar') ||
        document.querySelector('.app-sidebar') ||
        document.querySelector('aside');
      body?.classList.toggle('sidebar-open');
      sidebar?.classList.toggle('open');
      sidebar?.classList.toggle('is-open');
    } catch (error) {
      console.warn('[sidebar-v700]', error);
    }
  };
}
