/* ════════════════════════════
   EXTRACT HELPERS
════════════════════════════ */
const APIFY_QUALIFICATION_RULES = Object.freeze({ minRating: 4.0, minReviews: 15 });

function qualificationLogV430(tag, payload = {}) {
  try { console.log(`[${tag}]`, payload); } catch (_) {}
}

function isGoogleMapsLikeUrlV66(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return false;
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    const path = (u.pathname || '').toLowerCase();
    return host === 'google.com' || host === 'google.com.br' || host === 'maps.google.com' || host.endsWith('.google.com') || host.endsWith('.google.com.br') || path.includes('/maps') || raw.toLowerCase().includes('google.com/maps');
  } catch {
    return /google\.[a-z.]+\/maps|maps\.google\./i.test(raw);
  }
}

function extractSite(item) {
  const candidates = [
    item.website,
    item.site,
    item.webSite,
    item.websiteUrl,
    item.website_url,
    item.website_host,
    item.companyWebsite,
    item.urlWebsite
  ];

  for (const value of candidates) {
    const site = String(value || '').trim();
    if (!site) continue;
    if (isGoogleMapsLikeUrlV66(site)) continue;
    return site;
  }

  return '';
}
function extractPhone(item) { return String(item.phone_normalized || item.normalized_phone || item.phone || item.whatsapp || item.phoneNumber || item.telefone || '').trim(); }
function extractName(item)  { return capitalizeName(String(item.title || item.name || item.nome || item.company_name || item.companyName || item.empresa || '').trim()); }
function extractInstagram(item) {
  const ig = String(item.instagram_username || item.instagram || item.instagramUrl || item.instagram_url || '').trim();
  if (ig) return ig;
  const site = extractSite(item);
  if (isInstagramWebsiteV430(site)) return site;
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
  return String(item.place_id || item.placeId || item.googlePlaceId || item.url || item.googleUrl || item.google_url || item.google_maps_url || item.maps_url || item.link || '').trim();
}
function hasValidSiteRaw(item) {
  const site = extractSite(item);
  return /^https?:\/\//i.test(site) && site.length > 8;
}
function hasValidPhone(item) {
  return normalizePhone(extractPhone(item)).length >= 10;
}

function extractRatingV430(item = {}) {
  const value = item.totalScore ?? item.rating ?? item.stars ?? item.reviewScore ?? item.nota ?? item.avaliacao;
  const number = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(number) ? number : 0;
}

function extractReviewsCountV430(item = {}) {
  const value = item.reviewsCount ?? item.reviews ?? item.reviewCount ?? item.totalReviews ?? item.quantidadeAvaliacoes ?? item.avaliacoes;
  const number = Number(String(value ?? '').replace(/\D/g, ''));
  return Number.isFinite(number) ? number : 0;
}

function normalizeWebsiteHostnameV430(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function isInstagramWebsiteV430(value = '') {
  const hostname = normalizeWebsiteHostnameV430(value);
  return hostname === 'instagram.com' || hostname.endsWith('.instagram.com');
}

function isWixsiteWebsiteV430(value = '') {
  const hostname = normalizeWebsiteHostnameV430(value);
  return hostname === 'wixsite.com' || hostname.endsWith('.wixsite.com');
}

const NON_OPPORTUNITY_WEBSITE_HOSTS_V435 = [
  'bit.ly', 'bitly.com', 'linktr.ee', 'linktree.com',
  'facebook.com', 'fb.com', 'm.facebook.com', 'web.facebook.com',
  'wa.me', 'whatsapp.com', 'api.whatsapp.com',
  'google.com', 'google.com.br', 'maps.google.com', 'goo.gl',
  'twitter.com', 'x.com', 'linkedin.com', 'youtube.com', 'youtu.be',
  'tiktok.com', 'pinterest.com', 'hotmart.com', 'kiwify.com.br',
  'mercadolivre.com.br', 'olx.com.br', 'ifood.com.br', 'booking.com',
  'tripadvisor.com', 'yelp.com', 'guiamais.com.br', 'telelistas.net'
];

function isNonOpportunityWebsiteV435(value = '') {
  const hostname = normalizeWebsiteHostnameV430(value);
  if (!hostname) return false;
  return NON_OPPORTUNITY_WEBSITE_HOSTS_V435.some(domain => hostname === domain || hostname.endsWith('.' + domain));
}

function classifyWebsiteOpportunityV430(item = {}) {
  const site = extractSite(item);
  if (!site) {
    return { type:'none', websiteType:'none', websiteQuality:'missing', route:'whatsapp-validation', site:'', reason:'sem site proprio' };
  }
  if (isInstagramWebsiteV430(site)) {
    return { type:'instagram', websiteType:'instagram', websiteQuality:'social', route:'instagram-backlog', site, reason:'instagram sem site proprio' };
  }
  if (isWixsiteWebsiteV430(site)) {
    return { type:'wixsite', websiteType:'wixsite', websiteQuality:'weak', route:'whatsapp-validation', site, reason:'wixsite sem dominio proprio' };
  }
  if (isNonOpportunityWebsiteV435(site)) {
    return { type:'blocked-link', websiteType:'blocked-link', websiteQuality:'blocked', route:'skip', site, reason:'link nao elegivel (somente Instagram e Wix passam)' };
  }
  if (typeof isExcludedDomain === 'function' && isExcludedDomain(site)) {
    return { type:'excluded', websiteType:'excluded', websiteQuality:'blocked', route:'skip', site, reason:'dominio excluido manualmente' };
  }
  if (typeof isSiteBlocklisted === 'function' && isSiteBlocklisted(site)) {
    return { type:'blocked-link', websiteType:'blocked-link', websiteQuality:'blocked', route:'skip', site, reason:'link nao elegivel (somente Instagram e Wix passam)' };
  }
  return { type:'commercial', websiteType:'commercial', websiteQuality:'commercial', route:'whatsapp-validation', site, reason:'site proprio/comercial elegivel para abordagem com site' };
}

function getApifyQualificationV430(item = {}) {
  const rating = extractRatingV430(item);
  const reviews = extractReviewsCountV430(item);
  return {
    rating,
    reviews,
    approved: rating >= APIFY_QUALIFICATION_RULES.minRating && reviews >= APIFY_QUALIFICATION_RULES.minReviews,
    minRating: APIFY_QUALIFICATION_RULES.minRating,
    minReviews: APIFY_QUALIFICATION_RULES.minReviews
  };
}

function createLeadIdentityIndexV430(leads = []) {
  const index = { phones:new Set(), sites:new Set(), maps:new Set(), instagrams:new Set() };
  (Array.isArray(leads) ? leads : []).forEach(lead => addLeadIdentityToIndexV430(index, lead));
  return index;
}

function normalizeIdentityUrlV430(value = '') {
  return String(value || '').trim().replace(/\/+$/, '').toLowerCase();
}

function addLeadIdentityToIndexV430(index, lead = {}) {
  if (!index) return index;
  const phone = normalizePhone(extractPhone(lead));
  const site = normalizeWebsiteHostnameV430(extractSite(lead));
  const maps = normalizeIdentityUrlV430(extractGoogleUrl(lead));
  const instagram = normalizeIdentityUrlV430(extractInstagram(lead));
  if (phone) index.phones.add(phone);
  if (site) index.sites.add(site);
  if (maps) index.maps.add(maps);
  if (instagram) index.instagrams.add(instagram);
  return index;
}

function findLeadIdentityDuplicateV430(index, item = {}) {
  if (!index) return null;
  const phone = normalizePhone(extractPhone(item));
  const site = normalizeWebsiteHostnameV430(extractSite(item));
  const maps = normalizeIdentityUrlV430(extractGoogleUrl(item));
  const instagram = normalizeIdentityUrlV430(extractInstagram(item));
  if (phone && index.phones.has(phone)) return { field:'phone', value:phone };
  if (site && index.sites.has(site)) return { field:'website', value:site };
  if (maps && index.maps.has(maps)) return { field:'maps', value:maps };
  if (instagram && index.instagrams.has(instagram)) return { field:'instagram', value:instagram };
  return null;
}

function normalizeCompanyIdentityV629(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getContactSuppressionEntriesForImportV629() {
  const fromGetter = typeof window.getContactSuppressionEntriesV629 === 'function'
    ? window.getContactSuppressionEntriesV629()
    : null;
  const fromWindow = Array.isArray(window.contactSuppressionEntriesV629)
    ? window.contactSuppressionEntriesV629
    : [];
  return (Array.isArray(fromGetter) ? fromGetter : fromWindow)
    .filter((entry) => entry && !entry.archived_at);
}

function normalizeSuppressionEntryForImportV629(entry = {}) {
  return {
    ...entry,
    phone_normalized: normalizePhone(entry.phone_normalized || entry.normalized_phone || entry.phone || entry.whatsapp),
    instagram_username: normalizeIdentityUrlV430(extractInstagram(entry)).replace('@', ''),
    website_host: normalizeWebsiteHostnameV430(extractSite(entry)),
    place_id: normalizeIdentityUrlV430(extractGoogleUrl(entry)),
    company_name_normalized: normalizeCompanyIdentityV629(entry.company_name_normalized || entry.company_name || entry.companyName || entry.nome || entry.name || entry.title)
  };
}

function findContactSuppressionMatchV629(item = {}) {
  const phone = normalizePhone(extractPhone(item));
  const site = normalizeWebsiteHostnameV430(extractSite(item));
  const maps = normalizeIdentityUrlV430(extractGoogleUrl(item));
  const instagram = normalizeIdentityUrlV430(extractInstagram(item)).replace('@', '');
  const company = normalizeCompanyIdentityV629(extractName(item));

  const entries = getContactSuppressionEntriesForImportV629()
    .map(normalizeSuppressionEntryForImportV629);

  const matches = entries.map((entry) => {
    if (phone && entry.phone_normalized === phone) return { entry, field:'phone', strength:10 };
    if (maps && entry.place_id === maps) return { entry, field:'place_id', strength:9 };
    if (instagram && entry.instagram_username === instagram) return { entry, field:'instagram', strength:8 };
    if (site && entry.website_host === site) return { entry, field:'website', strength:7 };
    if (company && entry.company_name_normalized === company) return { entry, field:'company_name', strength:1 };
    return null;
  }).filter(Boolean);

  if (!matches.length) return null;

  matches.sort((a, b) => {
    if ((a.entry.list_type === 'blocked') !== (b.entry.list_type === 'blocked')) {
      return a.entry.list_type === 'blocked' ? -1 : 1;
    }
    return b.strength - a.strength;
  });

  const match = matches[0];
  return {
    id: match.entry.id,
    listType: match.entry.list_type || 'already_sent',
    field: match.field,
    value: match.entry[match.field] || '',
    companyName: match.entry.company_name || '',
    reason: match.entry.reason || ''
  };
}

function getDatabaseLeadCacheV430() {
  const map = new Map();
  const add = (lead) => {
    if (!lead || typeof lead !== 'object') return;
    const key = String(lead.id || lead.lead_id || lead.place_id || lead.google_maps_url || lead.googleUrl || lead.phone || lead.whatsapp || Math.random()).trim();
    if (!key || map.has(key)) return;
    map.set(key, lead);
  };

  try { (typeof getLeadBaseData === 'function' ? getLeadBaseData() : []).forEach(add); } catch (_) {}
  try { (Array.isArray(window.rebuildNewSchemaLeads) ? window.rebuildNewSchemaLeads : []).forEach(add); } catch (_) {}
  try { (Array.isArray(window.leadsRebuild) ? window.leadsRebuild : []).forEach(add); } catch (_) {}
  try { (Array.isArray(window.leadsBaseRebuild) ? window.leadsBaseRebuild : []).forEach(add); } catch (_) {}
  try { (typeof getValData === 'function' ? getValData() : []).forEach(add); } catch (_) {}
  try { (typeof getAtribuicaoData === 'function' ? getAtribuicaoData() : []).forEach(add); } catch (_) {}
  try { (typeof getInstaFila === 'function' ? getInstaFila() : []).forEach(add); } catch (_) {}
  try { Object.values(typeof filaDisparo !== 'undefined' ? (filaDisparo || {}) : {}).flat().forEach(add); } catch (_) {}
  try { getContactSuppressionEntriesForImportV629().forEach(add); } catch (_) {}

  return Array.from(map.values());
}

function logApifyAnalysisV430(analysis, phase = 'preview') {
  const payload = {
    phase,
    name: analysis.name,
    route: analysis.route,
    reason: analysis.reason,
    rating: analysis.qualification.rating,
    reviews: analysis.qualification.reviews,
    websiteType: analysis.website.type,
    alreadyImported: analysis.alreadyImported,
    payloadDuplicate: analysis.payloadDuplicate,
    protectedContact: analysis.protectedContact
  };
  qualificationLogV430('qualification', payload);
  if (phase === 'preview') qualificationLogV430('qualification-preview', payload);
  qualificationLogV430('qualification-website', { phase, name:analysis.name, ...analysis.website });
  if (analysis.website.type === 'instagram') qualificationLogV430('qualification-instagram', payload);
  if (analysis.website.type === 'wixsite') qualificationLogV430('qualification-wixsite', payload);
  if (analysis.alreadyImported || analysis.payloadDuplicate) qualificationLogV430('qualification-duplicate', { ...payload, duplicate:analysis.duplicate });
}

function analyzeApifyLeadV430(item = {}, databaseIndex = null, payloadIndex = null, phase = 'preview') {
  const name = extractName(item);
  const qualification = getApifyQualificationV430(item);
  const website = classifyWebsiteOpportunityV430(item);
  const protectedContact = findContactSuppressionMatchV629(item);
  const databaseDuplicate = findLeadIdentityDuplicateV430(databaseIndex, item);
  const payloadDuplicateMatch = findLeadIdentityDuplicateV430(payloadIndex, item);
  const analysis = {
    item,
    name,
    phone: extractPhone(item),
    instagram: extractInstagram(item),
    googleUrl: extractGoogleUrl(item),
    category: extractCategory(item),
    qualification,
    website,
    hasPhone: hasValidPhone(item),
    ramoMatch: isRamoMatch(item),
    protectedContact,
    alreadyImported: !!databaseDuplicate,
    payloadDuplicate: !databaseDuplicate && !!payloadDuplicateMatch,
    duplicate: databaseDuplicate || payloadDuplicateMatch || null,
    route: '',
    reason: ''
  };

  if (!analysis.name) {
    analysis.route = 'skip';
    analysis.reason = 'sem nome';
  } else if (analysis.protectedContact) {
    analysis.route = 'skip';
    analysis.reason = analysis.protectedContact.listType === 'blocked'
      ? 'contato bloqueado operacional'
      : 'contato ja enviado anteriormente';
  } else if (analysis.alreadyImported) {
    analysis.route = 'skip';
    analysis.reason = 'lead ja existente no banco do usuario';
  } else if (analysis.payloadDuplicate) {
    analysis.route = 'skip';
    analysis.reason = 'duplicado no JSON atual';
  } else if (!analysis.ramoMatch) {
    analysis.route = 'skip';
    analysis.reason = 'fora do ramo';
  } else if (!analysis.qualification.approved) {
    analysis.route = 'skip';
    analysis.reason = 'abaixo da qualificacao';
  } else if (analysis.website.route === 'instagram-backlog') {
    analysis.route = 'instagram-backlog';
    analysis.reason = analysis.website.reason;
  } else if (analysis.website.route === 'skip') {
    analysis.route = 'skip';
    analysis.reason = analysis.website.reason;
  } else if (!analysis.hasPhone) {
    analysis.route = 'instagram-backlog';
    analysis.reason = 'sem WhatsApp validavel; enviar para backlog Instagram';
  } else {
    analysis.route = 'whatsapp-validation';
    analysis.reason = analysis.website.reason;
  }

  logApifyAnalysisV430(analysis, phase);
  return analysis;
}

function analyzeApifyRowsV430(rows = [], phase = 'preview') {
  const databaseIndex = createLeadIdentityIndexV430(getDatabaseLeadCacheV430());
  const payloadIndex = createLeadIdentityIndexV430();
  return (Array.isArray(rows) ? rows : []).map(item => {
    const analysis = analyzeApifyLeadV430(item, databaseIndex, payloadIndex, phase);
    addLeadIdentityToIndexV430(payloadIndex, item);
    return analysis;
  });
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
