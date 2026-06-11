/* ════════════════════════════
   SUPABASE WHATSAPP MESSAGES V41.2
════════════════════════════ */
const WHATSAPP_OUTBOX_V412_KEY = 'vs_whatsapp_outbox_v412';
const WHATSAPP_MESSAGES_CACHE_V412_KEY = 'vs_whatsapp_messages_cache_v412';
const WHATSAPP_MESSAGES_DEBUG_V413 = true;
function debugWhatsappPersistV413(step, data = {}) {
  if (!WHATSAPP_MESSAGES_DEBUG_V413) return;
  try {
    console.groupCollapsed(`[whatsapp_messages][persist] ${step}`);
    console.log(data);
    console.groupEnd();
  } catch (e) {
    console.log(`[whatsapp_messages][persist] ${step}`, data);
  }
}
let supabaseWhatsappMessagesCacheV412 = [];

function getCurrentUserIdForWhatsappStorageV423(){
  try { return currentUser?.id ? String(currentUser.id) : ''; } catch(e) { return ''; }
}

function getCurrentUserEmailForWhatsappStorageV425(){
  try { return currentUser?.email ? String(currentUser.email).trim().toLowerCase() : ''; } catch(e) { return ''; }
}

function isCurrentWhatsappUserReadyV425(){
  return !!(getCurrentUserIdForWhatsappStorageV423() && getCurrentUserEmailForWhatsappStorageV425());
}

function scopedWhatsappStorageKeyV423(baseKey){
  const userId = getCurrentUserIdForWhatsappStorageV423();
  const email = getCurrentUserEmailForWhatsappStorageV425();
  return (userId && email) ? `${baseKey}:${userId}:${email}` : `${baseKey}:anonymous`;
}

async function getSupabaseAuthHeadersV423(extra = {}){
  const headers = { ...(extra || {}) };
  try {
    const { data } = await sbClient.auth.getSession();
    const token = data?.session?.access_token || '';
    if (token) headers.Authorization = `Bearer ${token}`;
    if (currentUser?.id) headers['x-supabase-user-id'] = currentUser.id;
    if (currentUser?.email) headers['x-supabase-user-email'] = String(currentUser.email).trim().toLowerCase();
  } catch(e) {}
  return headers;
}

function clearGlobalWhatsappSensitiveCachesV423(){
  [WHATSAPP_MESSAGES_CACHE_V412_KEY, WHATSAPP_OUTBOX_V412_KEY, 'vs_evolution_responses_v34', WHATSAPP_CONVERSATION_META_V421_KEY].forEach(key => {
    try { localStorage.removeItem(key); } catch(e) {}
  });
}

function normalizeWhatsappDigitsV412(value = '') {
  let digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('55')) return digits;
  if (digits.length === 10 || digits.length === 11) return '55' + digits;
  return digits;
}

function getWhatsappConversationKeyV412(message = {}) {
  const leadId = String(message.leadId || message.lead_id || '').trim();
  if (leadId) return leadId;
  const phone = normalizeWhatsappDigitsV412(message.phone_normalized || message.phone || '');
  return phone ? `phone:${phone}` : '';
}

function isPhoneConversationKeyV412(key = '') {
  return String(key || '').startsWith('phone:');
}

function getPhoneFromConversationKeyV412(key = '') {
  return isPhoneConversationKeyV412(key) ? String(key).slice(6) : '';
}

function getFallbackContactIdentityByPhoneV416(phone = '') {
  const normalizedPhone = normalizeWhatsappDigitsV412(phone);
  if (!normalizedPhone) return { name:'', isLid:false, remoteJid:'', subtitle:'' };

  const messages = getSupabaseWhatsappMessagesV412()
    .filter(item => phonesMatchV412(item.phone, normalizedPhone))
    .sort((a,b) => String(b.receivedAt || '').localeCompare(String(a.receivedAt || '')));

  const withPushName = messages.find(item => String(item.pushName || '').trim());
  const anyLid = messages.find(item => item.isLid || /@lid$/i.test(String(item.remoteJid || '')));
  const name = String(withPushName?.pushName || '').trim();
  const isLid = !!anyLid || (!String(normalizedPhone).startsWith('55') && String(normalizedPhone).length > 12);
  return {
    name,
    isLid,
    remoteJid: String(anyLid?.remoteJid || withPushName?.remoteJid || '').trim(),
    subtitle: isLid ? `Identificador WhatsApp: ${normalizedPhone}` : normalizedPhone
  };
}

function loadSupabaseWhatsappMessagesCacheV412() {
  try {
    const data = JSON.parse(localStorage.getItem(scopedWhatsappStorageKeyV423(WHATSAPP_MESSAGES_CACHE_V412_KEY)) || '[]');
    supabaseWhatsappMessagesCacheV412 = Array.isArray(data) ? data : [];
  } catch {
    supabaseWhatsappMessagesCacheV412 = [];
  }
  return supabaseWhatsappMessagesCacheV412;
}

function saveSupabaseWhatsappMessagesCacheV412(messages = []) {
  supabaseWhatsappMessagesCacheV412 = Array.isArray(messages) ? messages.slice(0, 500) : [];
  try { localStorage.setItem(scopedWhatsappStorageKeyV423(WHATSAPP_MESSAGES_CACHE_V412_KEY), JSON.stringify(supabaseWhatsappMessagesCacheV412)); localStorage.removeItem(WHATSAPP_MESSAGES_CACHE_V412_KEY); } catch(e) {}
}

function getSupabaseWhatsappMessagesV412() {
  return supabaseWhatsappMessagesCacheV412.length ? supabaseWhatsappMessagesCacheV412 : loadSupabaseWhatsappMessagesCacheV412();
}

function isUnsavedOutgoingWhatsappMessageV426(message = {}) {
  return message.direction === 'out' && ['sending','saving','pending'].includes(message.status);
}

function upsertLocalOutgoingWhatsappMessageV426(message = {}, options = {}) {
  const id = String(message.id || '').trim();
  if (!id) return null;
  const localMessage = {
    id,
    leadId: String(message.leadId || '').trim(),
    instance: String(message.instance || '').trim(),
    phone: normalizeWhatsappDigitsV412(message.phone || ''),
    direction:'out',
    text:String(message.text || ''),
    status:message.status || 'saving',
    receivedAt:message.occurredAt || message.receivedAt || new Date().toISOString(),
    read:true,
    response:message.response || null
  };
  const cache = getSupabaseWhatsappMessagesV412().slice();
  const cacheIndex = cache.findIndex(item => item.id === id);
  if (cacheIndex >= 0) cache[cacheIndex] = { ...cache[cacheIndex], ...localMessage };
  else cache.push(localMessage);
  saveSupabaseWhatsappMessagesCacheV412(cache.sort((a,b) => String(b.receivedAt || '').localeCompare(String(a.receivedAt || ''))));

  if (localMessage.leadId && options.skipCrm !== true) {
    const lead = findLeadEverywhere(localMessage.leadId) || {};
    const crm = ensureLeadCrm(localMessage.leadId, lead);
    crm.messages = Array.isArray(crm.messages) ? crm.messages : [];
    const crmIndex = crm.messages.findIndex(item => item.id === id);
    const crmMessage = {
      id,
      direction:'out',
      text:localMessage.text,
      phone:localMessage.phone,
      instance:localMessage.instance,
      at:localMessage.receivedAt,
      atLabel:crmNowLabel(),
      status:localMessage.status,
      response:localMessage.response
    };
    if (crmIndex >= 0) Object.assign(crm.messages[crmIndex], crmMessage);
    else crm.messages.push(crmMessage);
    saveLeadCrm(localMessage.leadId, crm);
  }

  if (options.log !== false) {
    uiSyncLogV426('optimistic-update', { entity:'message', action:'upsert', id, leadId:localMessage.leadId, status:localMessage.status });
  }
  try { renderConversationsV38(); } catch(e) {}
  return localMessage;
}

function updateLocalOutgoingWhatsappMessageStatusV426(id = '', status = '', patch = {}) {
  const cache = getSupabaseWhatsappMessagesV412().slice();
  const cached = cache.find(item => item.id === id);
  if (cached) Object.assign(cached, patch, { status });
  saveSupabaseWhatsappMessagesCacheV412(cache);

  const leadId = String(patch.leadId || cached?.leadId || '').trim();
  if (leadId) {
    const crm = ensureLeadCrm(leadId, findLeadEverywhere(leadId) || {});
    const local = (crm.messages || []).find(item => item.id === id);
    if (local) Object.assign(local, patch, { status });
    saveLeadCrm(leadId, crm);
  }
  try { renderConversationsV38(); } catch(e) {}
}

function removeLocalOutgoingWhatsappMessageV426(id = '', leadId = '') {
  saveSupabaseWhatsappMessagesCacheV412(getSupabaseWhatsappMessagesV412().filter(item => item.id !== id));
  if (leadId) {
    const crm = ensureLeadCrm(leadId, findLeadEverywhere(leadId) || {});
    crm.messages = (crm.messages || []).filter(item => item.id !== id);
    saveLeadCrm(leadId, crm);
  }
  try { renderConversationsV38(); } catch(e) {}
}

function mergeUnsavedOutgoingWhatsappMessagesV426(serverMessages = []) {
  const serverIds = new Set(serverMessages.map(item => item.id));
  const pending = getSupabaseWhatsappMessagesV412()
    .filter(item => isUnsavedOutgoingWhatsappMessageV426(item) && !serverIds.has(item.id));
  return [...serverMessages, ...pending];
}


/* Mapeamento manual seguro LID -> Lead/telefone real */
let whatsappContactMapCacheV418 = [];
let contactMapDrawerStateV418 = {
  open:false,
  conversationKey:'',
  lid:'',
  instance:'',
  pushName:'',
  lastMessage:'',
  query:'',
  loading:false,
  results:[],
  debounce:null
};

function debugContactMapV418(step, data = {}) {
  try { console.log(`[contact-map]${step}`, data); } catch(e) {}
}

function normalizeLeadForContactMapV418(lead = {}) {
  const id = String(lead.id || lead.lead_id || lead.leadId || '').trim();
  if (!id) return null;
  return {
    ...lead,
    id,
    nome: String(lead.nome || lead.company_name || lead.companyName || lead.name || lead.title || 'Lead sem nome').trim(),
    whatsapp: normalizeWhatsappDigitsV412(lead.whatsapp || lead.phone || lead.telefone || ''),
    status: lead.status || lead.pipeline_status || lead.pipelineStatus || '',
    dia: lead.dia || lead.day || lead.assignedDay || lead.weekDay || lead.weekday || ''
  };
}

function getAllKnownLeadsForWhatsappMapV417() {
  const map = new Map();
  const add = (lead) => {
    const normalized = normalizeLeadForContactMapV418(lead);
    if (!normalized) return;
    if (!map.has(normalized.id)) map.set(normalized.id, normalized);
  };

  try { (typeof getLeadBaseData === 'function' ? getLeadBaseData() : []).forEach(add); } catch(e) {}
  try { (typeof getAtribuicaoData === 'function' ? getAtribuicaoData() : []).forEach(add); } catch(e) {}
  try { (typeof getValData === 'function' ? getValData() : []).forEach(add); } catch(e) {}
  try { (typeof getZapBacklog === 'function' ? getZapBacklog() : []).forEach(add); } catch(e) {}
  try { (typeof getInstaFila === 'function' ? getInstaFila() : []).forEach(add); } catch(e) {}
  try { Object.values(typeof getWeekData === 'function' ? (getWeekData()?.days || {}) : {}).flat().forEach(add); } catch(e) {}
  try { Object.values(typeof filaDisparo !== 'undefined' ? (filaDisparo || {}) : {}).flat().forEach(add); } catch(e) {}
  try { (typeof getWhatsappQueueV27 === 'function' ? getWhatsappQueueV27() : []).forEach(item => { add(item); if (item.leadId) add(findLeadEverywhere(item.leadId)); }); } catch(e) {}
  return Array.from(map.values());
}

function findWhatsappLeadCandidatesForMapV417(query = '') {
  const q = typeof normalizeStr === 'function' ? normalizeStr(query || '') : String(query || '').toLowerCase();
  const digits = String(query || '').replace(/\D/g, '');
  return getAllKnownLeadsForWhatsappMapV417()
    .filter(lead => {
      const haystack = [lead.nome, lead.whatsapp, lead.phone, lead.telefone, lead.site, lead.instagram].filter(Boolean).join(' ');
      const norm = typeof normalizeStr === 'function' ? normalizeStr(haystack) : haystack.toLowerCase();
      return !q || norm.includes(q) || (digits && String(lead.whatsapp || '').includes(digits));
    })
    .slice(0, 20);
}

async function fetchContactMapsV418() {
  if (!currentUser?.id || !currentUser?.email) return [];
  try {
    const res = await fetch(`/api/whatsapp/contact-map?user_id=${encodeURIComponent(currentUser.id)}`, {
      headers: await getSupabaseAuthHeadersV423()
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.success === false) throw new Error(data?.error || `HTTP ${res.status}`);
    whatsappContactMapCacheV418 = Array.isArray(data.maps) ? data.maps : [];
  } catch (error) {
    debugContactMapV418('[map-fetch-error]', { error:error?.message || error });
  }
  return whatsappContactMapCacheV418;
}

function getContactMapByLidV418(lid = '', instance = '') {
  const normalizedLid = normalizeWhatsappDigitsV412(lid);
  if (!normalizedLid) return null;
  return whatsappContactMapCacheV418.find(item => {
    const sameLid = normalizeWhatsappDigitsV412(item.lid || '') === normalizedLid;
    const sameInstance = !instance || !item.instance || String(item.instance) === String(instance);
    return sameLid && sameInstance;
  }) || null;
}


const WHATSAPP_CONVERSATION_META_V421_KEY = 'vs_whatsapp_conversation_meta_v421';

function getConversationMetaStoreV421() {
  try { return JSON.parse(localStorage.getItem(scopedWhatsappStorageKeyV423(WHATSAPP_CONVERSATION_META_V421_KEY)) || '{}') || {}; } catch(e) { return {}; }
}

function saveConversationMetaStoreV421(store = {}) {
  try { localStorage.setItem(scopedWhatsappStorageKeyV423(WHATSAPP_CONVERSATION_META_V421_KEY), JSON.stringify(store || {})); localStorage.removeItem(WHATSAPP_CONVERSATION_META_V421_KEY); } catch(e) {}
}

function getConversationMetaKeyV421(conversationKey = '') {
  const resolved = getConversationLeadFromKeyV412(conversationKey);
  const instance = String((getConversationMessagesV38(conversationKey)[0]?.instance) || resolved.instance || 'prospecto').trim();
  return `${currentUser?.id || 'local'}:${instance}:${conversationKey}`;
}

function getConversationMetaV421(conversationKey = '') {
  const store = getConversationMetaStoreV421();
  return store[getConversationMetaKeyV421(conversationKey)] || {};
}

function setConversationMetaV421(conversationKey = '', patch = {}) {
  const store = getConversationMetaStoreV421();
  const key = getConversationMetaKeyV421(conversationKey);
  store[key] = { ...(store[key] || {}), ...patch, updatedAt:new Date().toISOString() };
  saveConversationMetaStoreV421(store);
  try { renderInboxV41(); } catch(e) {}
  try { renderConversationListV38(); } catch(e) {}
}

function archiveConversationV421(conversationKey = '') {
  if (!conversationKey) conversationKey = activeConversationLeadV38;
  if (!conversationKey) return;
  setConversationMetaV421(conversationKey, { archived:true, archivedAt:new Date().toISOString() });
  notify('Conversa arquivada.');
}

async function markConversationUnreadV421(conversationKey = '') {
  if (!conversationKey) conversationKey = activeConversationLeadV38;
  if (!conversationKey) return;
  const resolved = getConversationLeadFromKeyV412(conversationKey);
  const leadId = resolved.leadId || (!isPhoneConversationKeyV412(conversationKey) ? conversationKey : '');
  const phone = resolved.phone;
  if (sbClient && currentUser?.id) {
    let query = sbClient.from('whatsapp_messages').update({ read_at:null, updated_at:new Date().toISOString() }).eq('user_id', currentUser.id).eq('direction','in');
    if (leadId) query = query.eq('lead_id', leadId);
    else if (phone) query = query.or(`phone.eq.${phone},phone_normalized.eq.${phone}`);
    const { error } = await query;
    if (error) console.warn('[whatsapp_messages] marcar não lida:', error.message);
  }
  await fetchEvolutionResponsesV34({ silent:true });
  notify('Conversa marcada como não lida.');
}

async function markConversationReadActionV421(conversationKey = '') {
  if (!conversationKey) conversationKey = activeConversationLeadV38;
  await markConversationReadV412(conversationKey);
  await fetchEvolutionResponsesV34({ silent:true });
  notify('Conversa marcada como lida.');
}

function toggleConversationActionsV421() {
  const menu = document.getElementById('conversationActionsMenuV421');
  if (menu) menu.classList.toggle('open');
}

function openConversationLeadDrawerV426(conversationKey = '') {
  if (!conversationKey) conversationKey = activeConversationLeadV38;
  const resolved = getConversationLeadFromKeyV412(conversationKey);
  const leadId = resolved.leadId || (!isPhoneConversationKeyV412(conversationKey) ? conversationKey : '');
  if (leadId && typeof openLeadDrawer === 'function') {
    openLeadDrawer(leadId);
    return;
  }
  notify('Associe esta conversa a um lead antes de abrir a ficha.', 'warn');
}

function addConversationNoteV421(conversationKey = '') {
  if (!conversationKey) conversationKey = activeConversationLeadV38;
  const resolved = getConversationLeadFromKeyV412(conversationKey);
  const leadId = resolved.leadId || (!isPhoneConversationKeyV412(conversationKey) ? conversationKey : '');
  if (leadId && typeof openLeadDrawer === 'function') openLeadDrawer(leadId);
  else notify('Associe esta conversa a um lead antes de adicionar nota.', 'warn');
}

function createConversationFollowupV421(conversationKey = '') {
  if (!conversationKey) conversationKey = activeConversationLeadV38;
  const resolved = getConversationLeadFromKeyV412(conversationKey);
  const leadId = resolved.leadId || (!isPhoneConversationKeyV412(conversationKey) ? conversationKey : '');
  if (leadId && typeof openLeadDrawer === 'function') openLeadDrawer(leadId);
  else notify('Associe esta conversa a um lead antes de criar follow-up.', 'warn');
}

function applyContactMapToMessageV418(message = {}) {
  if (!message || message.leadId) return message;
  const map = getContactMapByLidV418(message.phone, message.instance);
  if (!map?.lead_id) return message;
  return {
    ...message,
    leadId: map.lead_id,
    mappedPhoneReal: map.phone_real || '',
    contactMapId: map.id || '',
    pushName: message.pushName || map.push_name || ''
  };
}

function getRecentLeadSuggestionsForContactMapV418() {
  const byId = new Map();
  const addLead = (lead, reason = '') => {
    const normalized = normalizeLeadForContactMapV418(lead);
    if (!normalized) return;
    if (!byId.has(normalized.id)) byId.set(normalized.id, { ...normalized, reason });
  };

  try {
    getSupabaseWhatsappMessagesV412()
      .filter(msg => msg.direction === 'out' && msg.leadId)
      .sort((a,b) => String(b.receivedAt || '').localeCompare(String(a.receivedAt || '')))
      .forEach(msg => addLead(findLeadEverywhere(msg.leadId), 'Enviado recentemente'));
  } catch(e) {}

  try {
    (typeof getWhatsappQueueV27 === 'function' ? getWhatsappQueueV27() : [])
      .filter(item => item.status === 'Enviado' || item.status === 'Pendente' || item.status === 'Na fila')
      .slice(-60)
      .reverse()
      .forEach(item => addLead(item.leadId ? (findLeadEverywhere(item.leadId) || item) : item, 'Fila WhatsApp'));
  } catch(e) {}

  try {
    Object.values(typeof getWeekData === 'function' ? (getWeekData()?.days || {}) : {}).flat()
      .slice(-60)
      .reverse()
      .forEach(lead => addLead(lead, 'Semana'));
  } catch(e) {}

  return Array.from(byId.values()).slice(0, 20);
}

async function searchLeadsForContactMapV418(query = '') {
  const term = String(query || '').trim();
  if (term.length < 3) return getRecentLeadSuggestionsForContactMapV418();
  debugContactMapV418('[search]', { query:term });

  const fallback = findWhatsappLeadCandidatesForMapV417(term);
  if (!sbClient || !currentUser?.id) return fallback;

  const digits = term.replace(/\D/g, '');
  const safeTerm = term.replace(/[%,]/g, '');
  const orParts = [];
  if (safeTerm) orParts.push(`company_name.ilike.%${safeTerm}%`);
  if (digits) orParts.push(`phone.ilike.%${digits}%`);

  try {
    let queryBuilder = sbClient
      .from('leads')
      .select('id,company_name,phone,status,pipeline_status,updated_at,created_at')
      .eq('user_id', currentUser.id)
      .limit(20);
    if (orParts.length) queryBuilder = queryBuilder.or(orParts.join(','));
    const { data, error } = await queryBuilder;
    if (error) throw error;
    const remote = (data || []).map(normalizeLeadForContactMapV418).filter(Boolean);
    const merged = new Map();
    [...remote, ...fallback].forEach(lead => { if (lead?.id && !merged.has(lead.id)) merged.set(lead.id, lead); });
    return Array.from(merged.values()).slice(0, 20);
  } catch (error) {
    debugContactMapV418('[search-error]', { error:error?.message || error });
    return fallback;
  }
}

function getContactMapContextV418(conversationKey = '') {
  const key = conversationKey || activeConversationLeadV38 || '';
  const resolved = getConversationLeadFromKeyV412(key);
  const lid = normalizeWhatsappDigitsV412(resolved.phone || getPhoneFromConversationKeyV412(key));
  const latestMessage = getSupabaseWhatsappMessagesV412()
    .filter(msg => phonesMatchV412(msg.phone, lid))
    .sort((a,b) => String(b.receivedAt || '').localeCompare(String(a.receivedAt || '')))[0];
  return {
    conversationKey:key,
    resolved,
    lid,
    instance:String(latestMessage?.instance || resolved.instance || '').trim() || 'prospecto',
    pushName:String(resolved.lead?.nome || latestMessage?.pushName || '').trim(),
    lastMessage:String(latestMessage?.text || '').trim(),
    latestMessage
  };
}

function ensureContactMapDrawerV418() {
  let drawer = document.getElementById('contactMapDrawerV418');
  if (drawer) return drawer;
  drawer = document.createElement('div');
  drawer.id = 'contactMapDrawerV418';
  drawer.className = 'contact-map-drawer-v418';
  drawer.innerHTML = '<div class="contact-map-drawer-v418-panel" id="contactMapDrawerPanelV418"></div>';
  document.body.appendChild(drawer);
  drawer.addEventListener('click', event => {
    if (event.target === drawer) closeContactMapDrawerV418();
  });
  return drawer;
}

function renderContactMapDrawerV418() {
  const drawer = ensureContactMapDrawerV418();
  const panel = document.getElementById('contactMapDrawerPanelV418');
  if (!panel) return;
  const state = contactMapDrawerStateV418;
  drawer.classList.toggle('open', !!state.open);
  const results = Array.isArray(state.results) ? state.results : [];
  panel.innerHTML = `
    <div class="contact-map-drawer-head-v418">
      <div>
        <div class="contact-map-drawer-title-v418">Associar Conversa</div>
        <div class="contact-map-drawer-subtitle-v418">Vincule este identificador WhatsApp ao lead correto.</div>
      </div>
      <button class="contact-map-close-v418" onclick="closeContactMapDrawerV418()">×</button>
    </div>

    <div class="contact-map-context-v418">
      <div><span>PushName</span><strong>${escHtml(state.pushName || 'Não informado')}</strong></div>
      <div><span>LID</span><strong>${escHtml(state.lid || '-')}</strong></div>
      <div><span>Última mensagem</span><strong>${escHtml(state.lastMessage || '[mensagem sem texto]')}</strong></div>
    </div>

    <label class="contact-map-label-v418">Buscar lead por nome ou telefone</label>
    <input class="contact-map-search-v418" id="contactMapSearchInputV418" value="${escHtml(state.query || '')}" placeholder="Digite pelo menos 3 caracteres..." oninput="handleContactMapSearchInputV418(this.value)" />
    <div class="contact-map-help-v418">Ao abrir, mostramos apenas sugestões recentes. A busca no banco começa com 3 caracteres.</div>

    <div class="contact-map-results-v418">
      ${state.loading ? '<div class="contact-map-empty-v418">Buscando...</div>' : ''}
      ${!state.loading && !results.length ? '<div class="contact-map-empty-v418">Nenhum lead encontrado.</div>' : ''}
      ${!state.loading ? results.map(lead => `
        <div class="contact-map-card-v418">
          <div>
            <div class="contact-map-card-title-v418">${escHtml(lead.nome || 'Lead sem nome')}</div>
            <div class="contact-map-card-phone-v418">${escHtml(lead.whatsapp || lead.phone || lead.telefone || 'sem telefone')}</div>
            <div class="contact-map-card-meta-v418">${escHtml([lead.reason, lead.status, lead.dia ? 'Dia: ' + lead.dia : ''].filter(Boolean).join(' · ') || 'Lead disponível')}</div>
          </div>
          <button class="btn btn-primary" onclick="associateContactMapLeadV418('${escHtml(lead.id)}')">Associar</button>
        </div>
      `).join('') : ''}
    </div>
  `;
  setTimeout(() => {
    const input = document.getElementById('contactMapSearchInputV418');
    if (input && document.activeElement !== input) input.focus();
  }, 0);
}

async function openContactMapDrawerV418(conversationKey = '') {
  const context = getContactMapContextV418(conversationKey);
  if (!context.lid || !(context.resolved?.isLid || context.resolved?.lead?.isLid)) {
    notify('Esta conversa não parece ser um identificador LID.', 'warn');
    return;
  }
  debugContactMapV418('[drawer-open]', context);
  contactMapDrawerStateV418 = {
    ...contactMapDrawerStateV418,
    open:true,
    conversationKey:context.conversationKey,
    lid:context.lid,
    instance:context.instance,
    pushName:context.pushName,
    lastMessage:context.lastMessage,
    query:'',
    loading:false,
    results:getRecentLeadSuggestionsForContactMapV418()
  };
  renderContactMapDrawerV418();
}

function closeContactMapDrawerV418() {
  contactMapDrawerStateV418.open = false;
  renderContactMapDrawerV418();
}

function handleContactMapSearchInputV418(value = '') {
  contactMapDrawerStateV418.query = value;
  clearTimeout(contactMapDrawerStateV418.debounce);
  contactMapDrawerStateV418.debounce = setTimeout(async () => {
    contactMapDrawerStateV418.loading = true;
    renderContactMapDrawerV418();
    const results = await searchLeadsForContactMapV418(contactMapDrawerStateV418.query);
    contactMapDrawerStateV418.results = results;
    contactMapDrawerStateV418.loading = false;
    renderContactMapDrawerV418();
  }, 400);
}

async function associateContactMapLeadV418(leadId = '') {
  const state = contactMapDrawerStateV418;
  const lead = (state.results || []).find(item => String(item.id) === String(leadId)) || normalizeLeadForContactMapV418(findLeadEverywhere(leadId));
  if (!lead) { notify('Lead não encontrado.', 'warn'); return; }
  const phoneReal = normalizeWhatsappDigitsV412(lead.whatsapp || lead.phone || lead.telefone || '');
  if (!phoneReal) { notify('Lead selecionado está sem telefone.', 'warn'); return; }
  if (!currentUser?.id || !currentUser?.email) { notify('Usuário não autenticado.', 'warn'); return; }

  const previousMaps = whatsappContactMapCacheV418.slice();
  const previousConversationKey = activeConversationLeadV38;
  const optimisticMap = {
    id:'optimistic_map_' + Date.now(),
    user_id:currentUser.id,
    instance:state.instance || 'prospecto',
    lid:state.lid,
    lead_id:lead.id,
    phone_real:phoneReal,
    push_name:state.pushName || lead.nome || '',
    _syncStatus:'saving'
  };
  whatsappContactMapCacheV418 = previousMaps.filter(item => {
    return !(normalizeWhatsappDigitsV412(item.lid || '') === normalizeWhatsappDigitsV412(optimisticMap.lid) && String(item.instance || '') === String(optimisticMap.instance || ''));
  });
  whatsappContactMapCacheV418.unshift(optimisticMap);
  activeConversationLeadV38 = lead.id;
  uiSyncLogV426('optimistic-update', { entity:'association', action:'save', lid:state.lid, leadId:lead.id, instance:optimisticMap.instance });
  try { renderInboxV41(); } catch(e) {}
  try { renderConversationsV38(); } catch(e) {}
  closeContactMapDrawerV418();
  notify(`Conversa vinculada ao lead ${lead.nome || 'selecionado'}. Salvando...`);

  debugContactMapV418('[associate]', { lid:state.lid, leadId:lead.id, phoneReal, instance:state.instance });
  uiSyncLogV426('supabase-save-start', { entity:'association', lid:state.lid, leadId:lead.id, instance:optimisticMap.instance });
  try {
    const res = await fetch('/api/whatsapp/contact-map', {
      method:'POST',
      headers: await getSupabaseAuthHeadersV423({ 'Content-Type':'application/json' }),
      body: JSON.stringify({
        user_id: currentUser.id,
        user_email: String(currentUser.email || '').trim().toLowerCase(),
        instance: state.instance || 'prospecto',
        lid: state.lid,
        lead_id: lead.id,
        phone_real: phoneReal,
        push_name: state.pushName || lead.nome || ''
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) throw new Error(data.error || `HTTP ${res.status}`);

    debugContactMapV418('[associate-success]', data);
    whatsappContactMapCacheV418 = whatsappContactMapCacheV418.map(item => item.id === optimisticMap.id ? (data.map || { ...optimisticMap, _syncStatus:'' }) : item);
    activeConversationLeadV38 = lead.id;
    uiSyncLogV426('supabase-save-success', { entity:'association', lid:state.lid, leadId:lead.id, instance:optimisticMap.instance });
    fetchContactMapsV418().catch(() => {});
    fetchEvolutionResponsesV34({ silent:true }).catch(() => {});
    try { renderInboxV41(); } catch(e) {}
    try { renderConversationsV38(); } catch(e) {}
    notify(`Conversa vinculada ao lead ${lead.nome || 'selecionado'}.`);
  } catch (error) {
    whatsappContactMapCacheV418 = previousMaps;
    activeConversationLeadV38 = previousConversationKey;
    uiSyncLogV426('supabase-save-error', { entity:'association', lid:state.lid, leadId:lead.id, instance:optimisticMap.instance, error:error?.message || error });
    debugContactMapV418('[associate-error]', { error:error?.message || error });
    try { renderInboxV41(); } catch(e) {}
    try { renderConversationsV38(); } catch(e) {}
    notify('Erro ao vincular conversa: ' + (error?.message || error), 'err');
  }
}

async function associateLidConversationToLeadV417(conversationKey) {
  return openContactMapDrawerV418(conversationKey);
}

window.openContactMapDrawerV418 = openContactMapDrawerV418;
window.closeContactMapDrawerV418 = closeContactMapDrawerV418;
window.handleContactMapSearchInputV418 = handleContactMapSearchInputV418;
window.associateContactMapLeadV418 = associateContactMapLeadV418;
window.associateLidConversationToLeadV417 = associateLidConversationToLeadV417;


function getPendingOutgoingWhatsappMessagesV412() {
  try {
    const data = JSON.parse(localStorage.getItem(scopedWhatsappStorageKeyV423(WHATSAPP_OUTBOX_V412_KEY)) || '[]');
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function savePendingOutgoingWhatsappMessagesV412(list = []) {
  localStorage.setItem(scopedWhatsappStorageKeyV423(WHATSAPP_OUTBOX_V412_KEY), JSON.stringify(list.slice(-500)));
  try { localStorage.removeItem(WHATSAPP_OUTBOX_V412_KEY); } catch(e) {}
}

function queuePendingOutgoingWhatsappMessageV412(message = {}) {
  if (!message.id || !message.instance) return;
  const list = getPendingOutgoingWhatsappMessagesV412();
  const key = `${message.instance}:${message.id}`;
  const pending = {
    ...message,
    userId: message.userId || currentUser?.id || '',
    queuedAt: message.queuedAt || new Date().toISOString()
  };
  const index = list.findIndex(item => `${item.instance}:${item.id}` === key);
  if (index >= 0) list[index] = { ...list[index], ...pending };
  else list.push(pending);
  savePendingOutgoingWhatsappMessagesV412(list);
}

function getEvolutionWhatsappExternalIdV412(response = {}, fallback = '') {
  return String(
    response?.key?.id ||
    response?.id ||
    response?.messageId ||
    response?.message?.key?.id ||
    fallback
  );
}

function buildOutgoingWhatsappExternalIdV412(prefix = 'out', response = {}) {
  const evolutionId = getEvolutionWhatsappExternalIdV412(response, '');
  const safeEvolutionId = String(evolutionId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
  const suffix = Date.now() + '_' + Math.random().toString(36).slice(2, 10);
  return [prefix, safeEvolutionId, suffix].filter(Boolean).join('_');
}

function getWhatsappRawPayloadV416(rowOrMessage = {}) {
  const raw = rowOrMessage.raw_payload || rowOrMessage.rawPayload || null;
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch(e) { return null; }
}

function getWhatsappPushNameV416(rowOrMessage = {}) {
  const raw = getWhatsappRawPayloadV416(rowOrMessage);
  return String(
    rowOrMessage.pushName ||
    rowOrMessage.push_name ||
    rowOrMessage.pushname ||
    raw?.data?.pushName ||
    raw?.data?.pushname ||
    raw?.pushName ||
    raw?.pushname ||
    ''
  ).trim();
}

function getWhatsappRemoteJidV416(rowOrMessage = {}) {
  const raw = getWhatsappRawPayloadV416(rowOrMessage);
  return String(
    rowOrMessage.remoteJid ||
    rowOrMessage.remote_jid ||
    raw?.data?.key?.remoteJid ||
    raw?.data?.remoteJid ||
    raw?.remoteJid ||
    ''
  ).trim();
}

function isWhatsappLidMessageV416(rowOrMessage = {}) {
  const remoteJid = getWhatsappRemoteJidV416(rowOrMessage);
  return /@lid$/i.test(remoteJid);
}

function normalizeSupabaseWhatsappMessageV412(row = {}) {
  const rawPayload = getWhatsappRawPayloadV416(row);
  return {
    id: row.external_id || row.id,
    dbId: row.id || '',
    leadId: row.lead_id || '',
    instance: String(row.instance || '').trim(),
    phone: row.phone_normalized || row.phone || '',
    direction: row.direction === 'out' ? 'out' : 'in',
    text: row.body || '',
    messageType: row.message_type || 'text',
    status: row.status || '',
    receivedAt: row.occurred_at || row.created_at || '',
    readAt: row.read_at || '',
    read: !!row.read_at,
    rawPayload,
    pushName: getWhatsappPushNameV416(row),
    remoteJid: getWhatsappRemoteJidV416(row),
    isLid: isWhatsappLidMessageV416(row)
  };
}

function phonesMatchV412(a, b) {
  const left = String(a || '').replace(/\D/g, '');
  const right = String(b || '').replace(/\D/g, '');
  if (!left || !right) return false;
  return left.endsWith(right.slice(-8)) || right.endsWith(left.slice(-8));
}

function findLeadByPhoneV412(phone) {
  try {
    const legacy = typeof findLeadByPhoneV34 === 'function' ? findLeadByPhoneV34(phone) : null;
    if (legacy) return legacy;
  } catch(e) {}

  const candidates = [];
  try { candidates.push(...(typeof getAtribuicaoData === 'function' ? getAtribuicaoData() : [])); } catch(e) {}
  try { candidates.push(...(typeof getValData === 'function' ? getValData() : [])); } catch(e) {}
  try { candidates.push(...(typeof getInstaFila === 'function' ? getInstaFila() : [])); } catch(e) {}
  try { candidates.push(...Object.values(filaDisparo || {}).flat()); } catch(e) {}
  try {
    (typeof getWhatsappQueueV27 === 'function' ? getWhatsappQueueV27() : []).forEach(item => {
      candidates.push(item);
      if (item.leadId) {
        const lead = findLeadEverywhere(item.leadId);
        if (lead) candidates.push(lead);
      }
    });
  } catch(e) {}

  return candidates.find(lead => phonesMatchV412(phone, lead.whatsapp || lead.phone || lead.telefone || '')) || null;
}

async function linkSupabaseWhatsappMessageV412(dbId, leadId) {
  if (!dbId || !leadId || !sbClient || !currentUser?.id) return;
  const { error } = await sbClient
    .from('whatsapp_messages')
    .update({ lead_id: leadId, updated_at: new Date().toISOString() })
    .eq('id', dbId)
    .eq('user_id', currentUser.id);
  if (error) console.warn('[whatsapp_messages] vínculo:', error.message);
}

function mergeSupabaseWhatsappMessageV412(message) {
  const lead = message.leadId
    ? findLeadEverywhere(message.leadId)
    : findLeadByPhoneV412(message.phone);
  const leadId = message.leadId || lead?.id || '';

  if (!message.leadId && leadId) {
    message.leadId = leadId;
    linkSupabaseWhatsappMessageV412(message.dbId, leadId).catch(() => {});
  }

  if (!leadId) return message;

  const crm = ensureLeadCrm(leadId, lead || {});
  crm.messages = Array.isArray(crm.messages) ? crm.messages : [];

  const existing = crm.messages.find(item => item.id === message.id);
  const localMessage = {
    id: message.id,
    dbId: message.dbId,
    direction: message.direction,
    text: message.text,
    phone: message.phone,
    instance: message.instance,
    at: message.receivedAt,
    atLabel: message.receivedAt ? new Date(message.receivedAt).toLocaleString('pt-BR') : crmNowLabel(),
    read: message.read
  };

  if (existing) Object.assign(existing, localMessage);
  else crm.messages.push(localMessage);

  if (message.direction === 'in') {
    crm.pipelineStatus = crm.pipelineStatus === 'contato_enviado' ? 'respondeu' : crm.pipelineStatus;
    crm.lastResponseAt = message.receivedAt || new Date().toISOString();
  }

  saveLeadCrm(leadId, crm);
  return { ...message, leadId, applied: true };
}

async function fetchEvolutionResponsesV34(options = {}) {
  const silent = !!options.silent;
  if (!sbClient || !currentUser?.id) return [];

  try {
    await flushPendingOutgoingWhatsappMessagesV412();
    await fetchContactMapsV418();
    const { data, error } = await sbClient
      .from('whatsapp_messages')
      .select('id,external_id,lead_id,instance,phone,phone_normalized,direction,message_type,body,status,occurred_at,read_at,created_at,raw_payload')
      .eq('user_id', currentUser.id)
      .order('occurred_at', { ascending: false })
      .limit(500);

    if (error) throw error;

    const localMap = new Map(getLocalResponsesV34().map(item => [item.id, item]));
    const allMessages = [];
    (data || []).forEach(row => {
      const message = mergeSupabaseWhatsappMessageV412(applyContactMapToMessageV418(normalizeSupabaseWhatsappMessageV412(row)));
      allMessages.push(message);
      if (message.direction !== 'in') return;
      localMap.set(message.id, {
        ...(localMap.get(message.id) || {}),
        ...message,
        applied: !!message.leadId
      });
    });
    saveSupabaseWhatsappMessagesCacheV412(
      mergeUnsavedOutgoingWhatsappMessagesV426(allMessages)
        .sort((a,b) => String(b.receivedAt || '').localeCompare(String(a.receivedAt || '')))
    );

    saveLocalResponsesV34(
      Array.from(localMap.values())
        .sort((a,b) => String(b.receivedAt || '').localeCompare(String(a.receivedAt || '')))
        .slice(0, 500)
    );

    try { renderResponsesV34(); } catch(e) {}
    try { renderInboxV41(); } catch(e) {}
    try { renderConversationsV38(); } catch(e) {}
    try { updateBadges(); } catch(e) {}

    if (!silent) notify('Respostas atualizadas.');
    return data || [];
  } catch (err) {
    console.warn('[whatsapp_messages] sincronização:', err?.message || err);
    if (!silent) notify('Erro ao buscar respostas do Supabase.', 'err');
    return [];
  }
}

async function markConversationReadV412(conversationKey) {
  if (!conversationKey) return;
  const now = new Date().toISOString();
  const resolved = getConversationLeadFromKeyV412(conversationKey);
  const leadId = resolved.leadId || (!isPhoneConversationKeyV412(conversationKey) ? conversationKey : '');
  const phone = resolved.phone;

  if (leadId) {
    const crm = ensureLeadCrm(leadId, findLeadEverywhere(leadId) || {});
    (crm.messages || []).forEach(item => { if (item.direction === 'in') item.read = true; });
    saveLeadCrm(leadId, crm);
  }

  const responses = getLocalResponsesV34();
  responses.forEach(item => {
    const sameLead = leadId && item.leadId === leadId;
    const samePhone = phone && phonesMatchV412(item.phone, phone);
    if (sameLead || samePhone) {
      item.read = true;
      item.readAt = item.readAt || now;
    }
  });
  saveLocalResponsesV34(responses);

  if (sbClient && currentUser?.id) {
    let query = sbClient
      .from('whatsapp_messages')
      .update({ read_at: now, updated_at: now })
      .eq('user_id', currentUser.id)
      .eq('direction', 'in')
      .is('read_at', null);
    if (leadId) query = query.eq('lead_id', leadId);
    else if (phone) query = query.or(`phone.eq.${phone},phone_normalized.eq.${phone}`);
    else return;
    const { error } = await query;
    if (error) console.warn('[whatsapp_messages] leitura:', error.message);
  }
}

function formatConversationListDateV412(value = '') {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const start = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((start(now) - start(date)) / 86400000);
  if (diffDays === 0) return date.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' });
  if (diffDays === 1) return 'Ontem';
  if (diffDays > 1 && diffDays < 7) return date.toLocaleDateString('pt-BR', { weekday:'long' });
  return date.toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit' });
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
    const title = item.lead.nome || item.lead.name || 'Lead';
    const preview = (last?.text || 'Sem mensagens').replace(/\s+/g, ' ').trim();
    const dateLabel = formatConversationListDateV412(last?.at || item.lastAt || '');
    return `
      <div class="conversation-item-v38 ${active}" onclick="openConversationV38('${escHtml(item.leadId)}')">
        <div class="conversation-item-v38-main">
          <div class="conversation-item-v38-top">
            <div class="conversation-item-v38-title">${escHtml(title)}</div>
            <div class="conversation-item-v38-date">${escHtml(dateLabel)}</div>
          </div>
          <div class="conversation-item-v38-preview">${escHtml(preview)}</div>
        </div>
      </div>
    `;
  }).join('');

  updateConversationsBadgeV38();
}

function openConversationV38(leadId) {
  activeConversationLeadV38 = leadId;
  markConversationReadV412(leadId).catch(() => {});
  renderConversationsV38();
  try { renderInboxV41(); } catch(e) {}
}


/* Fonte principal: Supabase whatsapp_messages para Conversas/Caixa de Entrada */
function getConversationLeadFromKeyV412(key = '') {
  if (!key) return { leadId:'', lead:{ nome:'Lead' }, phone:'' };
  if (isPhoneConversationKeyV412(key)) {
    const phone = getPhoneFromConversationKeyV412(key);
    const fallbackIdentity = getFallbackContactIdentityByPhoneV416(phone);
    const contactMap = getContactMapByLidV418(phone, 'prospecto') || getContactMapByLidV418(phone, '');
    if (contactMap?.lead_id) {
      const mappedLead = findLeadEverywhere(contactMap.lead_id) || { id:contactMap.lead_id, nome:contactMap.push_name || fallbackIdentity.name || 'Lead associado' };
      const phoneReal = normalizeWhatsappDigitsV412(contactMap.phone_real || mappedLead.whatsapp || mappedLead.phone || mappedLead.telefone || '');
      return {
        leadId: contactMap.lead_id,
        lead: { ...mappedLead, whatsapp: phoneReal || mappedLead.whatsapp || mappedLead.phone || '', mappedFromLid: phone, subtitle: phoneReal ? `Telefone: ${phoneReal}` : `Identificador WhatsApp: ${phone}` },
        phone: phoneReal || phone,
        isLid:false,
        mappedFromLid: phone,
        subtitle: phoneReal ? `Telefone: ${phoneReal}` : `Identificador WhatsApp: ${phone}`
      };
    }
    const lead = findLeadByPhoneV412(phone);
    return {
      leadId: lead?.id || '',
      lead: lead || {
        id:key,
        nome:fallbackIdentity.name || `Número ${phone}`,
        phone,
        whatsapp:phone,
        isLid:fallbackIdentity.isLid,
        whatsappIdentifier: fallbackIdentity.isLid ? phone : '',
        subtitle: fallbackIdentity.subtitle || phone
      },
      phone,
      isLid: fallbackIdentity.isLid,
      subtitle: fallbackIdentity.subtitle || phone
    };
  }
  const lead = findLeadEverywhere(key) || { id:key, nome:'Lead' };
  const phone = normalizeWhatsappDigitsV412(lead.whatsapp || lead.phone || lead.telefone || '');
  return { leadId:key, lead, phone };
}

function getAllConversationLeadsV38() {
  const crm = typeof getLeadCrmStoreSafeV4015 === 'function'
    ? getLeadCrmStoreSafeV4015()
    : (typeof getLeadCrmStore === 'function' ? getLeadCrmStore() : {});
  const messages = getSupabaseWhatsappMessagesV412();
  const map = new Map();

  messages.forEach(message => {
    const key = getWhatsappConversationKeyV412(message);
    if (!key) return;
    const resolved = getConversationLeadFromKeyV412(key);
    const lastAt = message.receivedAt || message.at || '';
    const current = map.get(key) || { leadId:key, lead:resolved.lead, crm:crm[resolved.leadId] || {}, lastAt:'' };
    current.lead = resolved.lead;
    current.crm = crm[resolved.leadId] || current.crm || {};
    if (String(lastAt).localeCompare(String(current.lastAt || '')) > 0) current.lastAt = lastAt;
    map.set(key, current);
  });

  Object.entries(crm || {}).forEach(([leadId, data]) => {
    const hasMessages = Array.isArray(data.messages) && data.messages.length;
    const hasResponse = !!data.lastResponseAt || data.pipelineStatus === 'respondeu';
    if (!hasMessages && !hasResponse) return;
    const lead = findLeadEverywhere(leadId) || { id: leadId, nome: data.nome || 'Lead' };
    const lastAt = data.lastResponseAt || data.lastWhatsappMessage?.sentAt || '';
    const current = map.get(leadId) || { leadId, lead, crm:data, lastAt:'' };
    current.lead = lead;
    current.crm = data;
    if (String(lastAt).localeCompare(String(current.lastAt || '')) > 0) current.lastAt = lastAt;
    map.set(leadId, current);
  });

  try {
    (typeof getWhatsappQueueV27 === 'function' ? getWhatsappQueueV27() : []).forEach(item => {
      if (!item.leadId || item.status !== 'Enviado') return;
      const lead = findLeadEverywhere(item.leadId) || { id:item.leadId, nome:item.nome || 'Lead' };
      const crmData = crm[item.leadId] || {};
      const lastAt = item.sentAt || item.updatedAt || item.createdAt || '';
      const current = map.get(item.leadId) || { leadId:item.leadId, lead, crm:crmData, lastAt:'' };
      if (String(lastAt).localeCompare(String(current.lastAt || '')) > 0) current.lastAt = lastAt;
      map.set(item.leadId, current);
    });
  } catch(e) {}

  return Array.from(map.values()).sort((a,b) => String(b.lastAt || '').localeCompare(String(a.lastAt || '')));
}

function getConversationMessagesV38(conversationKey) {
  const resolved = getConversationLeadFromKeyV412(conversationKey);
  const realLeadId = resolved.leadId || (!isPhoneConversationKeyV412(conversationKey) ? conversationKey : '');
  const phone = resolved.phone;
  const messages = [];

  getSupabaseWhatsappMessagesV412().forEach(message => {
    const key = getWhatsappConversationKeyV412(message);
    const sameKey = key === conversationKey;
    const sameLead = realLeadId && message.leadId === realLeadId;
    const samePhone = phone && phonesMatchV412(message.phone, phone);
    if (!sameKey && !sameLead && !samePhone) return;
    messages.push({
      id: message.id,
      dbId: message.dbId,
      direction: message.direction,
      text: message.text,
      phone: message.phone,
      instance: message.instance,
      status: message.status,
      at: message.receivedAt,
      atLabel: message.receivedAt ? new Date(message.receivedAt).toLocaleString('pt-BR') : '',
      read: message.read,
      pushName: message.pushName || '',
      remoteJid: message.remoteJid || '',
      isLid: !!message.isLid
    });
  });

  if (realLeadId) {
    try {
      const crm = ensureLeadCrm(realLeadId, findLeadEverywhere(realLeadId) || {});
      (crm.messages || []).forEach(msg => messages.push(msg));
      if (crm.lastWhatsappMessage) {
        messages.push({
          id:'last_' + realLeadId,
          direction:'out',
          text:crm.lastWhatsappMessage.text || '',
          at:crm.lastWhatsappMessage.sentAt || '',
          atLabel:crm.lastWhatsappMessage.sentAtLabel || '',
          chipName:crm.lastWhatsappMessage.chipName || ''
        });
      }
    } catch(e) {}
    try {
      (typeof getWhatsappQueueV27 === 'function' ? getWhatsappQueueV27() : [])
        .filter(item => item.leadId === realLeadId && item.status === 'Enviado')
        .forEach(item => messages.push({
          id:item.id,
          direction:'out',
          text:item.templateText || item.templateName || 'Mensagem enviada',
          at:item.sentAt || item.updatedAt || item.createdAt || '',
          atLabel:item.sentAtLabel || item.createdAtLabel || '',
          chipName:item.chipName || ''
        }));
    } catch(e) {}
  }

  const unique = new Map();
  messages.forEach(message => {
    const key = message.dbId || message.id || `${message.direction}_${message.at}_${message.text}`;
    unique.set(key, message);
  });

  return Array.from(unique.values()).sort((a,b) => String(a.at || '').localeCompare(String(b.at || '')));
}

function getWhatsappMessageSyncLabelV426(status = '') {
  if (status === 'sending') return ' · enviando...';
  if (status === 'saving') return ' · salvando...';
  if (status === 'pending') return ' · sync pendente';
  return '';
}

function renderConversationChatV38() {
  const box = document.getElementById('conversationChatV38');
  if (!box) return;

  if (!activeConversationLeadV38) {
    box.innerHTML = '<div class="conversation-empty-v38">// selecione uma conversa</div>';
    return;
  }

  const resolved = getConversationLeadFromKeyV412(activeConversationLeadV38);
  const lead = resolved.lead || { nome:'Lead' };
  const messages = getConversationMessagesV38(activeConversationLeadV38);
  const phone = normalizeWhatsappDigitsV412(resolved.phone || lead.whatsapp || lead.phone || lead.telefone || '');
  const canReply = !!phone && !lead.isLid;
  const chatTitle = lead.nome || lead.name || 'Lead';
  const chatMeta = lead.isLid
    ? (lead.subtitle || `Identificador WhatsApp: ${phone}`)
    : (phone ? (resolved.leadId ? `Chip: ${messages.find(m => m.instance)?.instance || 'prospecto'}` : phone) : 'sem telefone');

  const associationButton = lead.isLid && !resolved.leadId
    ? `<button class="btn btn-ghost" onclick="associateLidConversationToLeadV417('${escHtml(activeConversationLeadV38)}')">Associar ao lead</button>`
    : '';
  const canReassociate = lead.isLid || resolved.mappedFromLid || isPhoneConversationKeyV412(activeConversationLeadV38);
  const drawerLeadId = resolved.leadId || (!isPhoneConversationKeyV412(activeConversationLeadV38) ? activeConversationLeadV38 : '');

  box.innerHTML = `
    <div class="conversation-chat-header-v38">
      <div>
        <div class="conversation-chat-title-v38">${escHtml(chatTitle)}</div>
        <div class="conversation-chat-meta-v38">${escHtml(chatMeta)}</div>
      </div>
      <div class="conversation-header-actions-v421">
        ${associationButton}
        <button class="conversation-actions-btn-v421" onclick="toggleConversationActionsV421()" title="Ações">⋮</button>
        <div id="conversationActionsMenuV421" class="conversation-actions-menu-v421">
          ${drawerLeadId ? `<button onclick="openConversationLeadDrawerV426('${escHtml(activeConversationLeadV38)}')">Abrir ficha do lead</button>` : ''}
          <button onclick="archiveConversationV421('${escHtml(activeConversationLeadV38)}')">Arquivar conversa</button>
          <button onclick="markConversationReadActionV421('${escHtml(activeConversationLeadV38)}')">Marcar como lida</button>
          <button onclick="markConversationUnreadV421('${escHtml(activeConversationLeadV38)}')">Marcar como não lida</button>
          ${canReassociate ? `<button onclick="associateLidConversationToLeadV417('${escHtml(activeConversationLeadV38)}')">Trocar associação de lead</button>` : ''}
          <button onclick="addConversationNoteV421('${escHtml(activeConversationLeadV38)}')">Adicionar nota</button>
          <button onclick="createConversationFollowupV421('${escHtml(activeConversationLeadV38)}')">Criar follow-up</button>
        </div>
      </div>
    </div>

    <div class="conversation-messages-v38">
      ${messages.length ? messages.map(msg => `
        <div class="message-bubble-v38 ${msg.direction === 'out' ? 'out' : 'in'}">
          ${escHtml(msg.text || '[mensagem sem texto]')}
          <div class="message-time-v38">${escHtml(msg.atLabel || (msg.at ? new Date(msg.at).toLocaleString('pt-BR') : ''))}${msg.instance ? ' · ' + escHtml(msg.instance) : (msg.chipName ? ' · ' + escHtml(msg.chipName) : '')}${escHtml(getWhatsappMessageSyncLabelV426(msg.status))}</div>
        </div>
      `).join('') : '<div class="conversation-empty-v38">// sem mensagens registradas</div>'}
    </div>

    <div class="conversation-reply-v38">
      <textarea id="conversationReplyTextV38" placeholder="Responder este lead..." ${canReply ? '' : 'disabled'}></textarea>
      <button class="btn btn-primary" onclick="sendConversationReplyV38()" ${canReply ? '' : 'disabled'}>Responder</button>
    </div>
  `;
}

function getConversationEvolutionConfigV412(leadId) {
  const resolved = getConversationLeadFromKeyV412(leadId);
  const realLeadId = resolved.leadId || (!isPhoneConversationKeyV412(leadId) ? leadId : '');
  const phone = resolved.phone;
  const responses = getLocalResponsesV34()
    .filter(item => ((realLeadId && item.leadId === realLeadId) || (phone && phonesMatchV412(item.phone, phone))) && item.instance)
    .sort((a,b) => String(b.receivedAt || '').localeCompare(String(a.receivedAt || '')));
  const crm = realLeadId ? (getLeadCrmStoreSafeV4015()[realLeadId] || {}) : {};
  const messages = Array.isArray(crm.messages) ? crm.messages.slice().reverse() : [];
  const supabaseMessages = getSupabaseWhatsappMessagesV412()
    .filter(item => ((realLeadId && item.leadId === realLeadId) || (phone && phonesMatchV412(item.phone, phone))) && item.instance)
    .sort((a,b) => String(b.receivedAt || '').localeCompare(String(a.receivedAt || '')));
  const queue = typeof getWhatsappQueueV27 === 'function' ? getWhatsappQueueV27() : [];
  const lastQueue = queue.filter(item => item.leadId === realLeadId && item.chipInstance).slice(-1)[0];
  const instance =
    responses[0]?.instance ||
    supabaseMessages[0]?.instance ||
    messages.find(item => item.instance)?.instance ||
    lastQueue?.chipInstance ||
    '';

  const chips = [
    ...(typeof getChips === 'function' ? getChips() : []),
    ...(typeof getWhatsappChipsV29 === 'function' ? getWhatsappChipsV29() : [])
  ];
  const exactChip = chips.find(chip => String(chip.instance || '').trim() === String(instance).trim());
  if (exactChip) {
    return {
      url: String(exactChip.url || exactChip.baseUrl || exactChip.evolutionUrl || '').replace(/\/$/, ''),
      instance: String(exactChip.instance || '').trim(),
      apiKey: exactChip.key || exactChip.apiKey || exactChip.apikey || '',
      chip: exactChip
    };
  }

  const fallback = typeof getManualSendEvolutionConfigV4012 === 'function'
    ? getManualSendEvolutionConfigV4012()
    : (typeof getEvolutionConfigForChipV405 === 'function' ? getEvolutionConfigForChipV405() : {});

  return instance ? { ...fallback, instance } : fallback;
}

async function getCurrentSupabaseUserIdV412() {
  if (currentUser?.id) return currentUser.id;
  try {
    if (!sbClient?.auth?.getUser) return '';
    const { data } = await sbClient.auth.getUser();
    if (data?.user?.id) {
      currentUser = data.user;
      return data.user.id;
    }
  } catch(e) {}
  return '';
}

async function persistOutgoingWhatsappMessageViaApiV412(payload = {}) {
  debugWhatsappPersistV413('api:start', payload);
  try {
    const res = await fetch('/api/whatsapp/outgoing', {
      method: 'POST',
      headers: await getSupabaseAuthHeadersV423({ 'Content-Type':'application/json' }),
      body: JSON.stringify({
        id: payload.id,
        external_id: payload.id,
        user_id: payload.userId,
        lead_id: payload.leadId || null,
        instance: payload.instance,
        phone: payload.phone,
        body: payload.text,
        text: payload.text,
        status: 'sent',
        occurred_at: payload.occurredAt,
        raw_payload: payload.response || null
      })
    });
    const data = await res.json().catch(() => ({}));
    debugWhatsappPersistV413('api:response', { status: res.status, ok: res.ok, data });
    if (!res.ok || data?.success === false) {
      throw new Error(data?.error || `HTTP ${res.status}`);
    }
    return { ok:true, pending:false, via:'api', data };
  } catch (error) {
    debugWhatsappPersistV413('api:error', { error: error?.message || error });
    return { ok:false, pending:true, error:error?.message || 'Falha no endpoint de persistência' };
  }
}

async function persistOutgoingWhatsappMessageV412(message = {}, options = {}) {
  debugWhatsappPersistV413('start', { message, options });
  const queueOnFailure = options.queueOnFailure !== false;
  const userId = message.userId || await getCurrentSupabaseUserIdV412();
  const payload = {
    id: String(message.id || '').trim() || buildOutgoingWhatsappExternalIdV412('out', message.response || {}),
    leadId: String(message.leadId || '').trim(),
    instance: String(message.instance || '').trim(),
    phone: String(message.phone || '').replace(/\D/g, ''),
    text: String(message.text || ''),
    occurredAt: message.occurredAt || new Date().toISOString(),
    userId,
    response: message.response || null
  };

  debugWhatsappPersistV413('payload', payload);
  uiSyncLogV426('supabase-save-start', { entity:'message', id:payload.id, leadId:payload.leadId, instance:payload.instance });

  if (!currentUser?.id || !currentUser?.email || payload.userId !== currentUser.id) {
    debugWhatsappPersistV413('blocked:auth-mismatch', { currentUserId:currentUser?.id || '', currentUserEmail:currentUser?.email || '', payloadUserId:payload.userId });
    if (queueOnFailure) queuePendingOutgoingWhatsappMessageV412(payload);
    uiSyncLogV426('supabase-save-error', { entity:'message', id:payload.id, error:'auth-mismatch' });
    return { ok:false, pending:queueOnFailure, error:'Usuário autenticado inválido para salvar mensagem' };
  }

  if (!payload.id || !payload.instance || !payload.phone || !payload.text || !payload.userId) {
    debugWhatsappPersistV413('blocked:missing-data', { payload, missing: { id:!payload.id, instance:!payload.instance, phone:!payload.phone, text:!payload.text, userId:!payload.userId } });
    if (queueOnFailure) queuePendingOutgoingWhatsappMessageV412(payload);
    uiSyncLogV426('supabase-save-error', { entity:'message', id:payload.id, error:'missing-data' });
    return { ok:false, pending:queueOnFailure, error:'Dados insuficientes para salvar mensagem enviada' };
  }

  if (sbClient && currentUser?.id === payload.userId) {
    debugWhatsappPersistV413('client:insert:start', { external_id: payload.id, user_id: payload.userId, lead_id: payload.leadId || null, instance: payload.instance, phone: payload.phone, body: payload.text, occurred_at: payload.occurredAt });
    const { error } = await sbClient
      .from('whatsapp_messages')
      .upsert({
        external_id: payload.id,
        user_id: payload.userId,
        lead_id: payload.leadId || null,
        instance: payload.instance,
        phone: payload.phone,
        direction: 'out',
        message_type: 'text',
        body: payload.text,
        status: 'sent',
        occurred_at: payload.occurredAt,
        updated_at: new Date().toISOString(),
        raw_payload: payload.response || null
      }, { onConflict:'instance,external_id' });

    if (!error) {
      debugWhatsappPersistV413('client:insert:success', { external_id: payload.id });
      uiSyncLogV426('supabase-save-success', { entity:'message', id:payload.id, via:'supabase' });
      return { ok:true, pending:false, via:'supabase' };
    }
    debugWhatsappPersistV413('client:insert:error', { error: error.message, details: error });
    console.warn('[whatsapp_messages] saída via client:', error.message);
  }

  const apiResult = await persistOutgoingWhatsappMessageViaApiV412(payload);
  if (apiResult.ok) {
    debugWhatsappPersistV413('success:api', apiResult);
    uiSyncLogV426('supabase-save-success', { entity:'message', id:payload.id, via:'api' });
    return apiResult;
  }

  console.warn('[whatsapp_messages] saída via api:', apiResult.error);
  if (queueOnFailure) queuePendingOutgoingWhatsappMessageV412(payload);
  debugWhatsappPersistV413('failed:queued', { queueOnFailure, apiResult });
  uiSyncLogV426('supabase-save-error', { entity:'message', id:payload.id, error:apiResult.error, queued:queueOnFailure });
  return { ok:false, pending:queueOnFailure, error:apiResult.error };
}

async function flushPendingOutgoingWhatsappMessagesV412() {
  if (!sbClient || !currentUser?.id) return { sent:0, pending:getPendingOutgoingWhatsappMessagesV412().length };
  const list = getPendingOutgoingWhatsappMessagesV412();
  const remaining = [];
  let sent = 0;

  for (const message of list) {
    if (message.userId && message.userId !== currentUser.id) {
      remaining.push(message);
      continue;
    }
    const result = await persistOutgoingWhatsappMessageV412(
      { ...message, userId:currentUser.id },
      { queueOnFailure:false }
    );
    if (result.ok) sent++;
    else remaining.push(message);
  }

  savePendingOutgoingWhatsappMessagesV412(remaining);
  return { sent, pending:remaining.length };
}

async function sendConversationReplyV38() {
  if (!activeConversationLeadV38) return;
  const resolved = getConversationLeadFromKeyV412(activeConversationLeadV38);
  const lead = resolved.lead || {};
  const realLeadId = resolved.leadId || (!isPhoneConversationKeyV412(activeConversationLeadV38) ? activeConversationLeadV38 : '');
  const text = (document.getElementById('conversationReplyTextV38')?.value || '').trim();
  const phone = normalizeWhatsappDigitsV412(resolved.phone || lead.whatsapp || lead.phone || lead.telefone || '');
  const cfg = getConversationEvolutionConfigV412(realLeadId || activeConversationLeadV38);

  if (!text) { notify('Digite uma resposta.', 'warn'); return; }
  if (!phone) { notify('Lead sem telefone.', 'warn'); return; }
  if (!cfg.url || !cfg.instance || !cfg.apiKey) {
    notify('Chip da conversa não configurado na plataforma.', 'warn');
    return;
  }

  const messageId = buildOutgoingWhatsappExternalIdV412('reply');
  const occurredAt = new Date().toISOString();
  upsertLocalOutgoingWhatsappMessageV426({
    id:messageId,
    leadId:realLeadId,
    instance:cfg.instance,
    phone,
    text,
    occurredAt,
    status:'sending'
  });

  try {
    const data = await sendEvolutionTextV4013({
      url: cfg.url,
      instance: cfg.instance,
      apiKey: cfg.apiKey,
      number: phone,
      text
    });
    updateLocalOutgoingWhatsappMessageStatusV426(messageId, 'saving', { leadId:realLeadId, response:data });
    if (realLeadId) addLeadHistory(realLeadId, 'Resposta enviada pela Central de Conversas', lead);
    persistOutgoingWhatsappMessageV412({
      id: messageId,
      leadId: realLeadId,
      instance: cfg.instance,
      phone,
      text,
      occurredAt,
      response:data
    }).then(persistence => {
      updateLocalOutgoingWhatsappMessageStatusV426(messageId, persistence.ok ? 'sent' : 'pending', { leadId:realLeadId, response:data });
      notify(persistence.ok ? 'Resposta enviada e salva.' : 'Resposta enviada. Sincronização com banco pendente.', persistence.ok ? undefined : 'warn');
    }).catch(error => {
      updateLocalOutgoingWhatsappMessageStatusV426(messageId, 'pending', { leadId:realLeadId, response:data });
      uiSyncLogV426('supabase-save-error', { entity:'message', id:messageId, error:error?.message || error });
      notify('Resposta enviada. Sincronização com banco pendente.', 'warn');
    });
  } catch (err) {
    removeLocalOutgoingWhatsappMessageV426(messageId, realLeadId);
    notify('Erro ao responder: ' + formatEvolutionErrorV41(err), 'err');
  }
}

function getInboxItemsV41() {
  const grouped = new Map();
  const upsertItem = (message = {}) => {
    if (!message || message.direction !== 'in') return;
    const conversationKey = getWhatsappConversationKeyV412(message);
    if (!conversationKey) return;
    const resolved = getConversationLeadFromKeyV412(conversationKey);
    const meta = getConversationMetaV421(conversationKey);
    if (meta.archived) return;
    const current = grouped.get(conversationKey) || {
      id: conversationKey,
      conversationKey,
      leadId: resolved.leadId || '',
      lead: resolved.lead,
      text: '',
      channel:'whatsapp',
      at:'',
      unreadCount:0,
      totalMessages:0,
      pending: !resolved.leadId
    };
    current.leadId = resolved.leadId || current.leadId || '';
    current.lead = resolved.lead || current.lead;
    current.pending = !current.leadId;
    current.totalMessages += 1;
    if (!message.read) current.unreadCount += 1;
    const at = message.receivedAt || message.at || '';
    if (!current.at || String(at).localeCompare(String(current.at || '')) > 0) {
      current.at = at;
      current.text = message.text || '';
    }
    grouped.set(conversationKey, current);
  };

  getSupabaseWhatsappMessagesV412()
    .filter(message => message.direction === 'in')
    .forEach(upsertItem);

  const responses = typeof getLocalResponsesV34 === 'function' ? getLocalResponsesV34() : [];
  responses.forEach(response => {
    const conversationKey = response.leadId || (response.phone ? `phone:${normalizeWhatsappDigitsV412(response.phone)}` : '');
    if (!conversationKey) return;
    upsertItem({
      ...response,
      direction:'in',
      receivedAt: response.receivedAt || response.at || '',
      text: response.text || '',
      leadId: response.leadId || '',
      phone: response.phone || ''
    });
  });

  return Array.from(grouped.values()).sort((a,b) => String(b.at || '').localeCompare(String(a.at || '')));
}

function renderInboxV41() {
  const list = document.getElementById('inboxListV41');
  if (!list) return;
  const items = getInboxItemsV41();
  const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
  set('inboxUnreadCountV41', items.reduce((total, item) => total + (item.unreadCount || 0), 0));
  set('inboxWhatsappCountV41', items.reduce((total, item) => total + (item.totalMessages || 0), 0));
  set('inboxInstagramCountV41', 0);

  if (!items.length) {
    list.innerHTML = '<div class="audit-v35-empty">// nenhuma resposta recebida ainda</div>';
    updateInboxBadgeV41();
    return;
  }

  list.innerHTML = items.map(item => `
    <div class="inbox-v41-item">
      <div>
        <div class="inbox-v41-title-row">
          <div class="inbox-v41-title">${escHtml(item.lead?.nome || 'Lead')}</div>
          <div class="inbox-v41-count">${item.unreadCount ? escHtml(item.unreadCount + ' novas') : escHtml((item.totalMessages || 0) + ' msgs')}</div>
        </div>
        <div class="inbox-v41-message">${escHtml(item.text || '[mensagem sem texto]')}</div>
        <div class="inbox-v41-meta">${item.pending ? (item.lead?.isLid ? 'contato via LID · ' : 'lead não identificado · ') : ''}${item.lead?.subtitle ? escHtml(item.lead.subtitle) + ' · ' : ''}whatsapp · ${item.at ? escHtml(new Date(item.at).toLocaleString('pt-BR')) : ''}</div>
      </div>
      <div class="inbox-v41-actions">
        <button class="btn btn-primary" onclick="openConversationFromInboxV41('${escHtml(item.conversationKey || item.leadId)}')">Abrir</button>${item.leadId ? `<button class="btn btn-ghost" onclick="openLeadDrawer('${escHtml(item.leadId)}')">Ficha</button>` : (item.lead?.isLid ? `<button class="btn btn-ghost" onclick="associateLidConversationToLeadV417('${escHtml(item.conversationKey || '')}')">Associar</button>` : '<span class="queue-v27-status erro">sem lead</span>')}
      </div>
    </div>
  `).join('');
  updateInboxBadgeV41();
}

function startWhatsappMessagesSyncV412() {
  setTimeout(() => fetchEvolutionResponsesV34({ silent:true }), 2500);
  setInterval(() => fetchEvolutionResponsesV34({ silent:true }), 30000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startWhatsappMessagesSyncV412);
} else {
  startWhatsappMessagesSyncV412();
}



function openConversationFromInboxV41(conversationKey) { activeConversationLeadV38 = conversationKey; if (typeof switchPanel === 'function') switchPanel('conversations'); else { try{renderConversationsV38();}catch(e){} } }
