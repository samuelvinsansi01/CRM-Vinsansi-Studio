/* ═══════════════════════════
   IMPORTAR
═══════════════════════════ */
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

function getImportStatsV430(analyses = []) {
  return {
    total: analyses.length,
    validWhatsapp: analyses.filter(item => item.route === 'whatsapp-validation').length,
    instagramBacklog: analyses.filter(item => item.route === 'instagram-backlog').length,
    wixSites: analyses.filter(item => item.website.type === 'wixsite').length,
    alreadySeen: analyses.filter(item => item.alreadyImported).length,
    outsideBranch: analyses.filter(item => !item.ramoMatch).length,
    belowQualification: analyses.filter(item => item.ramoMatch && !item.qualification.approved).length,
    noPhone: analyses.filter(item => !item.hasPhone).length,
    noSite: analyses.filter(item => item.website.type === 'none').length,
    withSite: analyses.filter(item => item.route === 'whatsapp-validation' && item.website.type !== 'none').length
  };
}

function buildImportedLeadV430(analysis, route) {
  const isInstagram = route === 'instagram-backlog';
  return {
    id: genId(),
    nome: analysis.name,
    whatsapp: analysis.phone,
    instagram: analysis.instagram,
    site: analysis.website.site || '',
    website: analysis.website.site || '',
    googleUrl: analysis.googleUrl,
    categoria: analysis.category,
    ramoId: activeRamoId || null,
    reviewsCount: analysis.qualification.reviews,
    totalScore: analysis.qualification.rating,
    numStatus: isInstagram ? 'nao-aplicavel' : 'pendente',
    tipo: isInstagram ? 'instagram' : (analysis.website.type === 'none' ? 'sem-site' : 'com-site'),
    templateType: isInstagram ? '' : (analysis.website.type === 'none' ? 'sem-site' : 'com-site'),
    siteSegment: isInstagram ? '' : (analysis.website.type === 'none' ? 'sem-site' : 'com-site'),
    hasOwnSite: !isInstagram && analysis.website.type !== 'none',
    canal: isInstagram ? 'insta' : 'pendente',
    stage: isInstagram ? 'instagram_backlog' : 'validation',
    website_type: analysis.website.websiteType,
    website_quality: analysis.website.websiteQuality,
    qualification_reason: analysis.reason,
    importadoEm: todayStr()
  };
}

function importPreview() {
  const raw = document.getElementById('importJsonInput').value.trim();
  const listEl = document.getElementById('importPreviewList');
  const sumEl = document.getElementById('importSummary');
  const countEl = document.getElementById('previewCount');
  if (!raw) {
    listEl.innerHTML = '<span style="color:var(--muted)">// aguardando JSON...</span>';
    sumEl.innerHTML = '// cole o JSON acima para ver a prévia do filtro';
    countEl.textContent = '';
    const paginationEl = document.getElementById('importPreviewPagination');
    if (paginationEl) paginationEl.innerHTML = '';
    return;
  }
  const arr = parseApifyJson(raw);
  if (!arr) {
    sumEl.innerHTML = '<span class="err">// JSON inválido</span>';
    listEl.innerHTML = '';
    countEl.textContent = '';
    return;
  }

  const analyses = analyzeApifyRowsV430(arr, 'preview');
  const stats = getImportStatsV430(analyses);
  const opportunities = analyses.filter(item => item.route === 'whatsapp-validation' || item.route === 'instagram-backlog');

  sumEl.innerHTML = `
    <span class="acc">${stats.total}</span> total ·
    <span class="acc">${stats.validWhatsapp}</span> válidos WhatsApp ·
    <span class="acc">${stats.instagramBacklog}</span> backlog Instagram ·
    <span class="warn">${stats.wixSites}</span> sites Wix ·
    <span class="warn">${stats.alreadySeen}</span> já vistos ·
    <span class="err">${stats.outsideBranch}</span> fora do ramo ·
    <span class="err">${stats.belowQualification}</span> abaixo da qualificação ·
    <span class="warn">${stats.noPhone}</span> sem telefone ·
    <span class="acc">${stats.noSite}</span> sem site ·
    <span class="acc">${stats.withSite}</span> com site
  `;
  countEl.textContent = `· ${opportunities.length} oportunidades`;

  if (!opportunities.length) {
    listEl.innerHTML = '<span style="color:var(--muted)">// nenhuma oportunidade qualificada encontrada</span>';
    document.getElementById('importPreviewPagination').innerHTML = '';
    return;
  }

  const totalPrev = opportunities.length;
  const totalPrevPages = Math.max(1, Math.ceil(totalPrev / IMPORT_PG));
  if (importPage > totalPrevPages) importPage = totalPrevPages;
  const previewItems = opportunities.slice((importPage - 1) * IMPORT_PG, importPage * IMPORT_PG);

  listEl.innerHTML = '<div class="ext-list">' + previewItems.map(analysis => {
    const score = analysis.qualification.rating;
    const reviews = analysis.qualification.reviews;
    const scoreStr = score ? `⭐ ${Number(score).toFixed(1)}` : '';
    const revStr = reviews ? `(${reviews})` : '';
    const routeBadge = analysis.route === 'instagram-backlog'
      ? '<span class="q-badge insta">Instagram backlog</span>'
      : analysis.website.type === 'wixsite'
        ? '<span class="q-badge warn">Wix · site fraco</span>'
        : analysis.website.type !== 'none'
          ? '<span class="q-badge info">Com site · validar WhatsApp</span>'
          : '<span class="q-badge ok">Sem site · validar WhatsApp</span>';
    return `<div class="empresa-card">
      <div class="empresa-info">
        <div class="empresa-nome">${analysis.googleUrl ? `<a href="${escHtml(analysis.googleUrl)}" target="_blank" style="color:var(--text);text-decoration:none">${escHtml(analysis.name)}</a>` : escHtml(analysis.name)}</div>
        <div class="empresa-meta">
          <div class="empresa-phone">📱 ${escHtml(analysis.phone || 'sem telefone')}</div>
          ${analysis.category ? `<span class="q-badge ok" style="font-size:7px">${escHtml(analysis.category)}</span>` : ''}
          ${scoreStr ? `<span class="q-badge info" style="font-size:7px">${scoreStr} ${revStr}</span>` : ''}
        </div>
      </div>
      ${routeBadge}
    </div>`;
  }).join('') + '</div>';
  renderPagination('importPreviewPagination', importPage, totalPrevPages, totalPrev, IMPORT_PG, 'goImportPage', 'changeImportPgSize');
}

function logLeadImportV432(tag, payload = {}) {}

function normalizeImportedLeadPhoneV432(value = '') {
  return typeof normalizePhoneStrictV31 === 'function'
    ? normalizePhoneStrictV31(value)
    : String(value || '').replace(/\D/g, '');
}

async function getRemoteImportedLeadPhonesV432() {
  if (!sbClient || !currentUser?.id) throw new Error('Sessao autenticada indisponivel para verificar duplicados.');
  const { data, error } = await sbClient
    .from('leads')
    .select('id,phone')
    .eq('user_id', currentUser.id);
  if (error) throw error;
  const phones = new Map();
  (data || []).forEach(row => {
    const phone = normalizeImportedLeadPhoneV432(row.phone);
    if (phone && !phones.has(phone)) phones.set(phone, row.id);
  });
  return phones;
}

let importInProgressV434 = false;

async function importarLeads() {
  if (importInProgressV434) {
    notify('// importação já em andamento', 'warn');
    return;
  }
  importInProgressV434 = true;
  const btn = document.getElementById('importLeadsBtn');
  const originalLabel = btn ? btn.textContent : '';
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Importando...';
  }
  try {
  const raw = document.getElementById('importJsonInput').value.trim();
  if (!raw) { notify('// cole o JSON primeiro', 'err'); return; }
  const arr = parseApifyJson(raw);
  if (!arr || !arr.length) { notify('// JSON inválido ou vazio', 'err'); return; }

  logLeadImportV432('lead-import', { action:'start', total:arr.length, userId:currentUser?.id || '' });
  let existingPhones;
  try {
    existingPhones = await getRemoteImportedLeadPhonesV432();
  } catch (error) {
    logLeadImportV432('lead-import', { action:'blocked', reason:'remote-dedupe-check-failed', error:error?.message || error });
    notify('// Nao foi possivel verificar duplicados no banco. Importacao cancelada.', 'err');
    return;
  }

  const novaValFila = [...getValData()];
  const novaInstaFila = [...getInstaFila()];
  const novaAtribuicao = [...getAtribuicaoData()];
  [...novaValFila, ...novaInstaFila, ...novaAtribuicao, ...(typeof getLeadBaseData === 'function' ? getLeadBaseData() : [])].forEach(lead => {
    const phone = normalizeImportedLeadPhoneV432(lead.whatsapp || lead.phone || lead.telefone || '');
    if (phone && !existingPhones.has(phone)) existingPhones.set(phone, lead.id || 'local-cache');
  });
  const analyses = analyzeApifyRowsV430(arr, 'import');
  const stats = getImportStatsV430(analyses);
  let addedWhatsapp = 0;
  let addedInstagram = 0;
  let remoteDuplicates = 0;
  let skipped = 0;

  analyses.forEach(analysis => {
    const phone = normalizeImportedLeadPhoneV432(analysis.phone);
    if ((analysis.route === 'whatsapp-validation' || analysis.route === 'instagram-backlog') && phone && existingPhones.has(phone)) {
      remoteDuplicates++;
      skipped++;
      logLeadImportV432('lead-import-duplicate', { phone, existingId:existingPhones.get(phone), name:analysis.name, route:analysis.route });
      return;
    }
    if (analysis.route === 'whatsapp-validation') {
      const lead = buildImportedLeadV430(analysis, analysis.route);
      novaValFila.push(lead);
      if (phone) existingPhones.set(phone, lead.id);
      addedWhatsapp++;
      logLeadImportV432('lead-import-created', { id:lead.id, phone, name:lead.nome, route:analysis.route });
      return;
    }
    if (analysis.route === 'instagram-backlog') {
      const lead = buildImportedLeadV430(analysis, analysis.route);
      novaInstaFila.push(lead);
      if (phone) existingPhones.set(phone, lead.id);
      addedInstagram++;
      logLeadImportV432('lead-import-created', { id:lead.id, phone, name:lead.nome, route:analysis.route });
      return;
    }
    skipped++;
  });

  if (addedWhatsapp) saveValData(novaValFila);
  if (addedInstagram) saveInstaFila(novaInstaFila);
  if (addedWhatsapp || addedInstagram) {
    if (typeof markOperationalDataDirtyV430 === 'function') markOperationalDataDirtyV430('apify-import');
    if (typeof syncOperationalDataToSupabaseV36 === 'function') {
      syncOperationalDataToSupabaseV36({ silent:true }).catch(error => {
        uiSyncLogV426('supabase-save-error', { entity:'apify-import-operational-data', error:error?.message || error });
      });
    } else if (typeof scheduleLegacyOperationalSyncV36 === 'function') {
      scheduleLegacyOperationalSyncV36({ delay:0, reason:'apify-import' });
    }
  }
  updateBadges();

  let msg = `✓ ${addedWhatsapp} → Validação WhatsApp`;
  if (addedInstagram) msg += ` · ${addedInstagram} → backlog Instagram`;
  if (stats.alreadySeen) msg += ` · ${stats.alreadySeen} já vistos`;
  if (skipped) msg += ` · ${skipped} ignoradas`;
  if (remoteDuplicates) msg += ` | ${remoteDuplicates} duplicados bloqueados`;
  logLeadImportV432('lead-import', { action:'complete', addedWhatsapp, addedInstagram, remoteDuplicates, skipped });
  notify(msg, addedWhatsapp || addedInstagram ? '' : 'warn');

  importPage = 1;
  if (addedWhatsapp || addedInstagram) {
    const input = document.getElementById('importJsonInput');
    if (input) input.value = '';
  }
  importPreview();
  } finally {
    importInProgressV434 = false;
    if (btn) {
      btn.disabled = false;
      btn.textContent = originalLabel || '↓ Importar para Validação';
    }
  }
}
