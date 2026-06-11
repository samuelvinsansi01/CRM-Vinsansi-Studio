/* ════════════════════════════
   V41 — IMPORTAÇÃO + MENU + INBOX + CONVERSAS
════════════════════════════ */
const IMPORT_RULES_V41 = typeof APIFY_QUALIFICATION_RULES !== 'undefined'
  ? APIFY_QUALIFICATION_RULES
  : Object.freeze({ minRating: 4.0, minReviews: 15 });

function normalizeWhatsappV41(value = '') {
  let digits = String(value || '').replace(/\D/g, '').replace(/^0+/, '');
  if (!digits) return '';
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) return digits;
  if (digits.length === 10 || digits.length === 11) return '55' + digits;
  if (!digits.startsWith('55') && digits.length > 11) {
    const last11 = digits.slice(-11);
    if (last11.length === 11) return '55' + last11;
  }
  return digits;
}
if (typeof normalizePhoneForEvolution === 'function') {
  const oldNormalizePhoneForEvolutionV41 = normalizePhoneForEvolution;
  normalizePhoneForEvolution = function(value){ return normalizeWhatsappV41(value) || oldNormalizePhoneForEvolutionV41(value); };
}

function isInstagramUrlV41(value = '') {
  if (typeof isInstagramWebsiteV430 === 'function') return isInstagramWebsiteV430(value);
  return /(^|\/\/|\.)(?:www\.|m\.)?instagram\.com(?:\/|$)/i.test(String(value || ''));
}
function extractInstagramV41(lead = {}) {
  const fields = [lead.instagram, lead.instagramUrl, lead.instagram_url, lead.insta, lead.website, lead.site, lead.url, lead.link, lead.webSite];
  const found = fields.find(v => isInstagramUrlV41(v));
  if (found) return String(found).trim();
  const handle = fields.find(v => String(v || '').trim().startsWith('@'));
  return handle ? `https://instagram.com/${String(handle).replace('@','').trim()}` : '';
}
function getRatingV41(lead = {}) {
  const value = lead.rating ?? lead.stars ?? lead.reviewScore ?? lead.totalScore ?? lead.nota ?? lead.avaliacao;
  const n = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}
function getReviewsV41(lead = {}) {
  const value = lead.reviewsCount ?? lead.reviews ?? lead.reviewCount ?? lead.totalReviews ?? lead.quantidadeAvaliacoes ?? lead.avaliacoes;
  const n = Number(String(value ?? '').replace(/\D/g, ''));
  return Number.isFinite(n) ? n : 0;
}
function getLeadNameV41(lead = {}) { return String(lead.title || lead.name || lead.nome || lead.companyName || lead.company || lead.nomeEmpresa || '').trim(); }
function getWebsiteV41(lead = {}) {
  const raw = String(lead.website || lead.site || lead.webSite || lead.websiteUrl || lead.website_url || '').trim();
  return isInstagramUrlV41(raw) ? '' : raw;
}
function getWhatsappRawV41(lead = {}) { return lead.phone || lead.phoneNumber || lead.whatsapp || lead.telefone || lead.telefone1 || lead.phone_number || ''; }

function classifyImportedLeadV41(raw = {}) {
  if (typeof analyzeApifyLeadV430 === 'function') {
    const databaseIndex = typeof createLeadIdentityIndexV430 === 'function'
      ? createLeadIdentityIndexV430(typeof getDatabaseLeadCacheV430 === 'function' ? getDatabaseLeadCacheV430() : [])
      : null;
    const analysis = analyzeApifyLeadV430(raw, databaseIndex, null, 'legacy-v41');
    if (analysis.route !== 'whatsapp-validation' && analysis.route !== 'instagram-backlog') {
      return { status:'ignored', reasons:[analysis.reason], lead:null };
    }
    const channel = analysis.route === 'instagram-backlog' ? 'instagram' : 'whatsapp';
    const stage = analysis.route === 'instagram-backlog' ? 'instagram_backlog' : 'whatsapp_backlog';
    return {
      status:'approved',
      channel,
      stage,
      lead:{
        ...raw,
        id: raw.id || 'lead_' + Date.now() + '_' + Math.random().toString(36).slice(2),
        nome:analysis.name,
        name:analysis.name,
        whatsapp:normalizeWhatsappV41(analysis.phone),
        phone:normalizeWhatsappV41(analysis.phone),
        instagram:analysis.instagram,
        website:analysis.website.type === 'commercial' ? analysis.website.site : '',
        website_type:analysis.website.websiteType,
        website_quality:analysis.website.websiteQuality,
        rating:analysis.qualification.rating,
        reviews:analysis.qualification.reviews,
        sourceChannel:channel,
        backlogType:channel,
        stage,
        importedAt:new Date().toISOString()
      }
    };
  }

  const name = getLeadNameV41(raw);
  const rating = getRatingV41(raw);
  const reviews = getReviewsV41(raw);
  const instagram = extractInstagramV41(raw);
  const whatsapp = normalizeWhatsappV41(getWhatsappRawV41(raw));
  const website = getWebsiteV41(raw);
  const reasons = [];
  if (!name) reasons.push('sem nome');
  if (rating < IMPORT_RULES_V41.minRating) reasons.push(`nota abaixo de ${IMPORT_RULES_V41.minRating}`);
  if (reviews < IMPORT_RULES_V41.minReviews) reasons.push(`menos de ${IMPORT_RULES_V41.minReviews} avaliações`);
  if (!whatsapp && !instagram) reasons.push('sem WhatsApp e sem Instagram');
  if (reasons.length) return { status:'ignored', reasons, lead:null };
  const channel = instagram ? 'instagram' : 'whatsapp';
  const stage = instagram ? 'instagram_backlog' : 'whatsapp_backlog';
  return { status:'approved', channel, stage, lead:{...raw, id: raw.id || 'lead_'+Date.now()+'_'+Math.random().toString(36).slice(2), nome:name, name, whatsapp, phone:whatsapp, instagram, website, rating, reviews, sourceChannel:channel, backlogType:channel, stage, importedAt:new Date().toISOString()} };
}
function canLeadGoToChipQueueV41(lead = {}) {
  const stage = lead.stage || lead.day || lead.assignedDay || lead.weekDay || '';
  const isBacklog = /backlog/i.test(String(stage || '')) || lead.backlogType;
  if (isBacklog && !/(segunda|terça|terca|quarta|quinta|sexta|sábado|sabado|domingo|mon|tue|wed|thu|fri|sat|sun)/i.test(String(stage))) return false;
  return true;
}
function buildImportSummaryV41(results = []) {
  const total = results.length, approved = results.filter(r=>r.status==='approved').length, instagram = results.filter(r=>r.status==='approved' && r.channel==='instagram').length, whatsapp = results.filter(r=>r.status==='approved' && r.channel==='whatsapp').length, ignored = results.filter(r=>r.status==='ignored').length;
  const reasons = {};
  results.filter(r=>r.status==='ignored').forEach(r => (r.reasons||[]).forEach(reason => reasons[reason]=(reasons[reason]||0)+1));
  const reasonText = Object.entries(reasons).map(([k,v])=>`- ${k}: ${v}`).join('\n') || '- nenhum';
  return `IMPORTAÇÃO V41\nTotal lido: ${total}\nAprovados: ${approved}\nInstagram backlog: ${instagram}\nWhatsApp backlog: ${whatsapp}\nIgnorados: ${ignored}\n\nMotivos de ignorados:\n${reasonText}`;
}
function showImportSummaryV41(text) {
  let box = document.getElementById('importSummaryV41');
  const panel = document.getElementById('panel-import') || document.querySelector('.panel.active') || document.body;
  if (!box) { box = document.createElement('div'); box.id='importSummaryV41'; box.className='import-summary-v41'; panel.appendChild(box); }
  box.textContent = text;
}
function processImportedRowsV41(rows = []) {
  const arr = Array.isArray(rows) ? rows : [];
  const results = arr.map(classifyImportedLeadV41);
  showImportSummaryV41(buildImportSummaryV41(results));
  return { approved: results.filter(r=>r.status==='approved').map(r=>r.lead), ignored: results.filter(r=>r.status==='ignored') };
}

/* Bloqueio: backlog não entra em fila/chip */
if (typeof addActiveLeadToWhatsappQueue === 'function') {
  const oldAddActiveLeadToWhatsappQueueV41 = addActiveLeadToWhatsappQueue;
  addActiveLeadToWhatsappQueue = function(){
    if (activeLeadDrawerData && !canLeadGoToChipQueueV41(activeLeadDrawerData)) {
      notify('Lead em backlog. Atribua a um dia da semana antes de enviar para fila.', 'warn');
      return;
    }
    return oldAddActiveLeadToWhatsappQueueV41();
  };
}

/* Caixa de Entrada */
function getInboxItemsV41() {
  const crm = getLeadCrmStoreSafeV4015 ? getLeadCrmStoreSafeV4015() : {};
  const responses = typeof getLocalResponsesV34 === 'function' ? getLocalResponsesV34() : [];
  const items = [];
  Object.entries(crm || {}).forEach(([leadId, data]) => {
    const incoming = (Array.isArray(data.messages) ? data.messages : []).filter(m => m.direction === 'in');
    if (!incoming.length) return;
    const last = incoming[incoming.length - 1];
    const lead = findLeadEverywhere(leadId) || { id:leadId, nome:data.nome || 'Lead' };
    items.push({ id:last.id || `in_${leadId}`, leadId, lead, text:last.text || '', channel:last.channel || 'whatsapp', at:last.at || last.receivedAt || data.lastResponseAt || '', unread: !last.read });
  });
  responses.forEach(resp => {
    if (!resp.leadId) return;
    const lead = findLeadEverywhere(resp.leadId) || { id:resp.leadId, nome:'Lead' };
    if (!items.some(i => i.id === resp.id)) items.push({ id:resp.id, leadId:resp.leadId, lead, text:resp.text || '', channel:'whatsapp', at:resp.receivedAt || '', unread: !resp.read });
  });
  return items.sort((a,b)=>String(b.at||'').localeCompare(String(a.at||'')));
}
function renderInboxV41() {
  const list = document.getElementById('inboxListV41'); if (!list) return;
  const items = getInboxItemsV41();
  const set = (id,v)=>{ const el=document.getElementById(id); if(el) el.textContent=v; };
  set('inboxUnreadCountV41', items.filter(i=>i.unread).length);
  set('inboxWhatsappCountV41', items.filter(i=>i.channel!=='instagram').length);
  set('inboxInstagramCountV41', items.filter(i=>i.channel==='instagram').length);
  if (!items.length) { list.innerHTML = '<div class="audit-v35-empty">// nenhuma resposta recebida ainda</div>'; updateInboxBadgeV41(); return; }
  list.innerHTML = items.map(item => `<div class="inbox-v41-item"><div><div class="inbox-v41-title">${escHtml(item.lead?.nome || item.lead?.name || 'Lead')}</div><div class="inbox-v41-message">${escHtml(item.text || '[mensagem sem texto]')}</div><div class="inbox-v41-meta">${escHtml(item.channel || 'whatsapp')} · ${item.at ? escHtml(new Date(item.at).toLocaleString('pt-BR')) : ''}</div></div><div class="inbox-v41-actions"><button class="btn btn-primary" onclick="openConversationFromInboxV41('${escHtml(item.leadId)}')">Responder</button><button class="btn btn-ghost" onclick="openLeadDrawer('${escHtml(item.leadId)}')">Ficha</button></div></div>`).join('');
  updateInboxBadgeV41();
}
function openConversationFromInboxV41(leadId) { activeConversationLeadV38 = leadId; if (typeof switchPanel === 'function') switchPanel('conversations'); else { try{renderConversationsV38();}catch(e){} } }
function updateInboxBadgeV41() { const badge=document.getElementById('badge-inbox'); if(badge) badge.textContent = getInboxItemsV41().filter(i=>i.unread).length; }

function formatEvolutionErrorV41(err) {
  const msg = String(err?.message || err || '');
  if (/400|bad request/i.test(msg)) return 'Não foi possível enviar. Verifique se o número tem DDI 55 e existe no WhatsApp.';
  if (/network|fetch|failed/i.test(msg)) return 'Não foi possível conectar na Evolution. Verifique se a API está aberta.';
  return msg || 'Não foi possível concluir a ação.';
}

/* Menu agrupado */
function createMenuItemV41(panel, icon, label, badgeId = '') {
  const item = document.createElement('div');
  item.className = 'nav-item';
  item.dataset.label = label;
  item.onclick = () => {
    if (panel === 'logout') { if (typeof logout === 'function') logout(); else if (typeof signOut === 'function') signOut(); return; }
    if (typeof switchPanel === 'function') switchPanel(panel);
  };
  item.innerHTML = `<div class="nav-icon">${icon}</div><span class="nav-label">${label}</span>${badgeId ? `<span class="nav-badge" id="${badgeId}">0</span>` : ''}`;
  return item;
}
function createMenuGroupV41(title, items = []) {
  const frag = document.createDocumentFragment();
  const group = document.createElement('div'); group.className='sidebar-v41-group'; group.textContent=title; frag.appendChild(group);
  items.forEach(item => { const el=createMenuItemV41(item.panel,item.icon,item.label,item.badgeId||''); if(item.sub) el.classList.add('sidebar-v41-subitem'); frag.appendChild(el); });
  return frag;
}
function rebuildSidebarGroupedV41() {
  const sidebar = document.querySelector('.sidebar'); if (!sidebar || hasStaticFinalSidebarV414(sidebar) || sidebar.dataset.v41Grouped === 'true') return;
  sidebar.innerHTML = '';
  const header=document.createElement('div'); header.className='sidebar-v41-header'; header.innerHTML='<div class="sidebar-v41-hello">Olá, Samuel 👋</div><div class="sidebar-v41-sub">CRM de Prospecção</div>'; sidebar.appendChild(header);
  sidebar.appendChild(createMenuItemV41('busca','🔎','Busca'));
  sidebar.appendChild(createMenuItemV41('inicio','📊','Início'));
  sidebar.appendChild(createMenuItemV41('inbox','📥','Caixa de Entrada','badge-inbox'));
  sidebar.appendChild(createMenuGroupV41('Leads',[{panel:'import',icon:'📥',label:'Importar',sub:true},{panel:'validacao',icon:'✅',label:'Validação',sub:true},{panel:'atribuicao',icon:'🗂️',label:'Atribuição',sub:true}]));
  sidebar.appendChild(createMenuGroupV41('Envios',[{panel:'fila-zap',icon:'💬',label:'WhatsApp',badgeId:'badge-fila-zap',sub:true},{panel:'instagram',icon:'📸',label:'Instagram',sub:true}]));
  sidebar.appendChild(createMenuItemV41('conversations','💬','Conversas'));
  sidebar.appendChild(createMenuGroupV41('Gerenciamento',[{panel:'followups',icon:'⏰',label:'Follow-ups',sub:true},{panel:'kanban',icon:'📋',label:'Kanban',sub:true},{panel:'acompanhamento',icon:'📈',label:'Acompanhamentos',sub:true}]));
  sidebar.appendChild(createMenuGroupV41('Ferramentas',[{panel:'redirects',icon:'🔗',label:'Redirecionamentos',sub:true},{panel:'audit',icon:'📊',label:'Auditoria',badgeId:'badge-audit',sub:true}]));
  sidebar.appendChild(createMenuItemV41('conta','👤','Minha conta'));
  sidebar.appendChild(createMenuItemV41('configuracoes','⚙️','Configurações'));
  const footer=document.createElement('div'); footer.id='sidebarAuthFooterV40'; footer.appendChild(createMenuItemV41('logout','🚪','Sair')); sidebar.appendChild(footer);
  sidebar.dataset.v41Grouped = 'true';
  try{updateInboxBadgeV41();}catch(e){} try{updateWhatsappQueueBadge();}catch(e){} try{updateAuditBadgeV35();}catch(e){}
}
document.addEventListener('DOMContentLoaded', () => setTimeout(rebuildSidebarGroupedV41, 500));
setTimeout(rebuildSidebarGroupedV41, 1200);


/* V41.1 — MENU EXPANSÍVEL + BADGES SAFE */
function safeSetTextV411(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function updateBadges() {
  try {
    const data = typeof ensureWeekData === 'function' ? ensureWeekData() : { days:{} };
    const leads = typeof flattenWeekData === 'function' ? flattenWeekData(data) : [];

    safeSetTextV411('badge-inicio', leads.filter(l => (l.status || 'Não enviada') === 'Não enviada').length);
    safeSetTextV411('badge-import', leads.filter(l => (l.status || 'Não enviada') === 'Não enviada').length);
    safeSetTextV411('badge-validacao', typeof getValData === 'function' ? getValData().length : 0);
    const instaSemLink = typeof getInstaFila === 'function' ? getInstaFila().filter(l => !l.instagram).length : 0;
    safeSetTextV411('badge-atribuicao', (typeof getAtribuicaoData === 'function' ? getAtribuicaoData().length : 0) + instaSemLink);
    safeSetTextV411('badge-fila-zap', leads.filter(l => (l.status || 'Não enviada') === 'Não enviada' && l.whatsapp).length);
    const instaWeek = typeof getInstaWeek === 'function' ? getInstaWeek() : {};
    const instaBacklog = typeof getInstaFila === 'function' ? getInstaFila().filter(l => !!l.instagram).length : 0;
    safeSetTextV411('badge-instagram', Object.values(instaWeek).flat().length + instaBacklog);
    const todayIso = new Date().toISOString().slice(0, 10);
    const crm = typeof getLeadCrmStore === 'function' ? getLeadCrmStore() : {};
    safeSetTextV411('badge-followups', Object.values(crm || {}).filter(item => item?.followUpDate && item.followUpDate <= todayIso).length);
    const acomp = typeof getAcompData === 'function' ? getAcompData() : {};
    const month = typeof currentMonthKey === 'function' ? currentMonthKey() : '';
    safeSetTextV411('badge-acompanhamento', (acomp[month] || []).length);

    if (typeof updateInboxBadgeV41 === 'function') updateInboxBadgeV41();
    if (typeof updateAuditBadgeV35 === 'function') updateAuditBadgeV35();
  } catch(e) {
    console.warn('updateBadges protegido:', e?.message || e);
  }
}

function createMenuItemV411(panel, icon, label, badgeId = '') {
  const item = document.createElement('div');
  item.className = 'nav-item';
  item.dataset.label = label;
  item.onclick = () => {
    if (panel === 'busca') {
      if (typeof openGlobalSearch === 'function') openGlobalSearch();
      return;
    }
    if (panel === 'logout') {
      if (typeof logoutSupabase === 'function') logoutSupabase();
      else if (typeof logout === 'function') logout();
      else if (typeof signOut === 'function') signOut();
      return;
    }
    if (typeof switchPanel === 'function') switchPanel(panel);
  };
  item.innerHTML = `<div class="nav-icon">${icon}</div><span class="nav-label">${label}</span>${badgeId ? `<span class="nav-badge" id="${badgeId}">0</span>` : ''}`;
  return item;
}

function createExpandableMenuGroupV411(title, icon, items = [], open = false) {
  const wrap = document.createElement('div');
  wrap.className = 'sidebar-v411-group' + (open ? ' open' : '');

  const head = document.createElement('div');
  head.className = 'nav-item sidebar-v411-group-head';
  head.innerHTML = `<div class="nav-icon">${icon}</div><span class="nav-label">${title}</span><span class="sidebar-v411-chevron">›</span>`;

  const body = document.createElement('div');
  body.className = 'sidebar-v411-group-body';

  items.forEach(item => {
    const el = createMenuItemV411(item.panel, item.icon, item.label, item.badgeId || '');
    el.classList.add('sidebar-v41-subitem');
    body.appendChild(el);
  });

  head.onclick = () => wrap.classList.toggle('open');
  wrap.appendChild(head);
  wrap.appendChild(body);
  return wrap;
}

function rebuildSidebarGroupedV41() {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar || hasStaticFinalSidebarV414(sidebar) || sidebar.dataset.v411Grouped === 'true') return;

  sidebar.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'sidebar-v41-header';
  header.innerHTML = `<div class="sidebar-v41-hello">Olá, Samuel 👋</div><div class="sidebar-v41-sub">CRM de Prospecção</div>`;
  sidebar.appendChild(header);

  sidebar.appendChild(createMenuItemV411('busca', '🔎', 'Busca'));
  sidebar.appendChild(createMenuItemV411('inicio', '📊', 'Início', 'badge-inicio'));
  sidebar.appendChild(createMenuItemV411('inbox', '📥', 'Caixa de Entrada', 'badge-inbox'));

  sidebar.appendChild(createExpandableMenuGroupV411('Leads', '&#128193;', [
    { panel:'importar', icon:'📥', label:'Importar', badgeId:'badge-import' },
    { panel:'validacao', icon:'✅', label:'Validação', badgeId:'badge-validacao' },
    { panel:'atribuicao', icon:'🗂️', label:'Atribuição', badgeId:'badge-atribuicao' }
  ]));

  sidebar.appendChild(createExpandableMenuGroupV411('Envios', '&#128228;', [
    { panel:'fila-zap', icon:'💬', label:'WhatsApp', badgeId:'badge-fila-zap' },
    { panel:'instagram', icon:'📸', label:'Instagram', badgeId:'badge-instagram' }
  ]));

  sidebar.appendChild(createMenuItemV411('conversations', '💬', 'Conversas'));

  sidebar.appendChild(createExpandableMenuGroupV411('Gerenciamento', '&#128203;', [
    { panel:'followups', icon:'⏰', label:'Follow-ups', badgeId:'badge-followups' },
    { panel:'kanban', icon:'📋', label:'Kanban' },
    { panel:'acompanhamento', icon:'📈', label:'Acompanhamentos', badgeId:'badge-acompanhamento' }
  ]));

  sidebar.appendChild(createExpandableMenuGroupV411('Ferramentas', '&#128295;', [
    { panel:'redirecionamentos', icon:'🔗', label:'Redirecionamentos' },
    { panel:'audit', icon:'📊', label:'Auditoria', badgeId:'badge-audit' }
  ]));

  sidebar.appendChild(createMenuItemV411('conta', '👤', 'Minha conta'));
  sidebar.appendChild(createMenuItemV411('configuracoes', '⚙️', 'Configurações'));

  const footer = document.createElement('div');
  footer.id = 'sidebarAuthFooterV40';
  footer.appendChild(createMenuItemV411('logout', '🚪', 'Sair'));
  sidebar.appendChild(footer);

  sidebar.dataset.v411Grouped = 'true';
  sidebar.dataset.v41Grouped = 'true';

  try { updateBadges(); } catch(e) {}
}

document.addEventListener('DOMContentLoaded', () => setTimeout(rebuildSidebarGroupedV41, 250));
setTimeout(rebuildSidebarGroupedV41, 700);
setTimeout(rebuildSidebarGroupedV41, 1500);
