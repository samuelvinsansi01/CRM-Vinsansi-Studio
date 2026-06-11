/* ════════════════════════════
   EXTRACT HELPERS
════════════════════════════ */
const APIFY_QUALIFICATION_RULES = Object.freeze({ minRating: 4.0, minReviews: 15 });

function qualificationLogV430(tag, payload = {}) {
  try { console.log(`[${tag}]`, payload); } catch (_) {}
}

function pickFirstTextV30(...values) {
  for (const value of values) {
    if (value == null) continue;
    if (typeof value === 'string' || typeof value === 'number') {
      const text = String(value).trim();
      if (text) return text;
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (entry == null) continue;
        if (typeof entry === 'string' || typeof entry === 'number') {
          const text = String(entry).trim();
          if (text) return text;
        }
        if (typeof entry === 'object') {
          const text = pickFirstTextV30(entry.url, entry.link, entry.href, entry.name, entry.title, entry.phone, entry.phoneNumber, entry.number);
          if (text) return text;
        }
      }
    }
  }
  return '';
}

function extractSite(item) {
  return pickFirstTextV30(
    item.website,
    item.site,
    item.webSite,
    item.websiteUrl,
    item.website_url,
    item.urlWebsite,
    item.companyWebsite,
    item.websites
  );
}
function extractPhone(item) {
  return pickFirstTextV30(
    item.phone,
    item.normalized_phone,
    item.phone_normalized,
    item.whatsapp,
    item.phoneNumber,
    item.phone_number,
    item.phoneUnformatted,
    item.phone_unformatted,
    item.telefone,
    item.telephone,
    item.contactPhone,
    item.mobile,
    item.phones,
    item.phoneNumbers
  );
}
function extractName(item)  {
  return capitalizeName(pickFirstTextV30(item.title, item.name, item.nome, item.companyName, item.company_name, item.businessName, item.placeName));
}
function extractInstagram(item) {
  const ig = pickFirstTextV30(item.instagram, item.instagramUrl, item.instagram_url, item.instagram_link, item.instagramLink);
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
  return pickFirstTextV30(
    item.categoryName,
    item.category,
    item.categories,
    item.categoria,
    item.type,
    item.subtype,
    item.mainCategory,
    item.businessCategory,
    item.searchString,
    item.query
  );
}
function extractGoogleUrl(item) {
  return pickFirstTextV30(item.googleUrl, item.google_url, item.maps_url, item.mapsUrl, item.placeUrl, item.url, item.link);
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
  const value = item.reviewsCount ?? item.reviews ?? item.reviewCount ?? item.totalReviews ?? item.reviewsTotal ?? item.numberOfReviews ?? item.quantidadeAvaliacoes ?? item.avaliacoes;
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
  if (typeof isExcludedDomain === 'function' && isExcludedDomain(site)) {
    return { type:'excluded', websiteType:'excluded', websiteQuality:'blocked', route:'skip', site, reason:'dominio excluido manualmente' };
  }
  if (typeof isSiteBlocklisted === 'function' && isSiteBlocklisted(site)) {
    return { type:'external', websiteType:'external', websiteQuality:'weak', route:'whatsapp-validation', site, reason:'link externo sem site proprio' };
  }
  return { type:'commercial', websiteType:'commercial', websiteQuality:'commercial', route:'whatsapp-validation', site, reason:'site comercial proprio' };
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

function getDatabaseLeadCacheV430() {
  // Não usar localStorage/operational_data como base de 'já visto'.
  // Preview/importação devem consultar Supabase em tempo real via getDatabaseLeadCacheAsyncV430().
  return [];
}

function normalizeImportPhoneV430(value = '') {
  if (typeof normalizeSentContactPhoneV30 === 'function') return normalizeSentContactPhoneV30(value);
  return normalizePhone(value);
}

function getImportUserIdV430() {
  try { return currentUser?.id ? String(currentUser.id) : ''; } catch (_) { return ''; }
}

async function getDatabaseLeadCacheAsyncV430(rows = []) {
  const userId = getImportUserIdV430();
  if (!userId || typeof sbClient === 'undefined' || !sbClient) return [];

  const phones = Array.from(new Set((Array.isArray(rows) ? rows : [])
    .map(row => normalizeImportPhoneV430(extractPhone(row)))
    .filter(Boolean)));

  if (!phones.length) return [];

  const cache = [];

  // 1) Proteção principal: telefones já enviados.
  try {
    const { data, error } = await sbClient
      .from('sent_contacts')
      .select('company_name,phone,normalized_phone')
      .eq('user_id', userId)
      .eq('active', true)
      .in('normalized_phone', phones);
    if (!error && Array.isArray(data)) {
      data.forEach(row => cache.push({
        nome: row.company_name || '',
        phone: row.normalized_phone || row.phone || '',
        normalized_phone: row.normalized_phone || row.phone || '',
        _already_seen_source: 'sent_contacts'
      }));
    } else if (error) {
      qualificationLogV430('qualification-sent-contacts-preview-warning', { error:error.message || String(error) });
    }
  } catch (error) {
    qualificationLogV430('qualification-sent-contacts-preview-error', { error:error?.message || String(error) });
  }

  // 2) Leads já existentes no banco, mas ainda não enviados.
  // Isso evita reimportar telefone que já está no sistema. Se a coluna ainda não existir, não quebra o preview.
  try {
    const { data, error } = await sbClient
      .from('leads')
      .select('company_name,phone,normalized_phone,website,maps_url,instagram,instagram_url')
      .eq('user_id', userId)
      .in('normalized_phone', phones);
    if (!error && Array.isArray(data)) {
      data.forEach(row => cache.push({
        nome: row.company_name || '',
        phone: row.normalized_phone || row.phone || '',
        normalized_phone: row.normalized_phone || row.phone || '',
        site: row.website || '',
        maps_url: row.maps_url || '',
        instagram: row.instagram || row.instagram_url || '',
        _already_seen_source: 'leads'
      }));
    } else if (error) {
      qualificationLogV430('qualification-leads-preview-warning', { error:error.message || String(error) });
    }
  } catch (error) {
    qualificationLogV430('qualification-leads-preview-error', { error:error?.message || String(error) });
  }

  return cache;
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
    payloadDuplicate: analysis.payloadDuplicate
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
    alreadyImported: !!databaseDuplicate,
    payloadDuplicate: !databaseDuplicate && !!payloadDuplicateMatch,
    duplicate: databaseDuplicate || payloadDuplicateMatch || null,
    route: '',
    reason: ''
  };

  if (!analysis.name) {
    analysis.route = 'skip';
    analysis.reason = 'sem nome';
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
  } else if (analysis.website.route === 'skip') {
    analysis.route = 'skip';
    analysis.reason = analysis.website.reason;
  } else if (analysis.hasPhone) {
    // Regra operacional: com telefone entra na validação WhatsApp, tendo site ou não.
    analysis.route = 'whatsapp-validation';
    analysis.reason = analysis.website.reason;
  } else if (analysis.instagram) {
    // Sem telefone validado, mas com Instagram: vai para Instagram.
    analysis.route = 'instagram-backlog';
    analysis.reason = 'sem telefone whatsapp validado';
  } else {
    analysis.route = 'skip';
    analysis.reason = 'sem telefone e sem instagram';
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

async function analyzeApifyRowsWithCloudV430(rows = [], phase = 'preview') {
  const databaseCache = await getDatabaseLeadCacheAsyncV430(rows);
  const databaseIndex = createLeadIdentityIndexV430(databaseCache);
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
  const haystack = normalizeStr([
    extractCategory(item),
    extractName(item),
    item.searchString,
    item.query,
    item.description,
    item.about,
    Array.isArray(item.categories) ? item.categories.map(c => typeof c === 'string' ? c : (c?.name || c?.title || '')).join(' ') : ''
  ].filter(Boolean).join(' '));

  // Se o Apify não trouxe categoria/texto útil, não derruba a importação.
  // O filtro principal continua sendo nota, avaliações e telefone/proteção.
  if (!haystack) return true;

  return kws.some(kw => haystack.includes(normalizeStr(kw)));
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

