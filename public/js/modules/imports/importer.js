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
    noSite: analyses.filter(item => item.website.type === 'none').length
  };
}

function buildImportedLeadV430(analysis, route) {
  const isInstagram = route === 'instagram-backlog';
  return {
    id: genId(),
    nome: analysis.name,
    whatsapp: analysis.phone,
    instagram: analysis.instagram,
    site: isInstagram || analysis.website.type === 'none' ? '' : analysis.website.site,
    googleUrl: analysis.googleUrl,
    categoria: analysis.category,
    ramoId: activeRamoId || null,
    reviewsCount: analysis.qualification.reviews,
    totalScore: analysis.qualification.rating,
    numStatus: isInstagram ? 'nao-aplicavel' : 'pendente',
    tipo: isInstagram ? 'instagram' : 'sem-site',
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
    <span class="acc">${stats.noSite}</span> sem site
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
        : '<span class="q-badge ok">✓ validar WhatsApp</span>';
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

function importarLeads() {
  const raw = document.getElementById('importJsonInput').value.trim();
  if (!raw) { notify('// cole o JSON primeiro', 'err'); return; }
  const arr = parseApifyJson(raw);
  if (!arr || !arr.length) { notify('// JSON inválido ou vazio', 'err'); return; }

  const novaValFila = [...getValData()];
  const novaInstaFila = [...getInstaFila()];
  const analyses = analyzeApifyRowsV430(arr, 'import');
  const stats = getImportStatsV430(analyses);
  let addedWhatsapp = 0;
  let addedInstagram = 0;
  let skipped = 0;

  const importSeenKeys = new Set();
  const existingValidationKeys = new Set((typeof dedupeLeadArrayV434 === 'function' ? novaValFila : novaValFila).map(lead => typeof getLeadIdentityKeyV434 === 'function' ? getLeadIdentityKeyV434(lead) : lead.id).filter(Boolean));
  const existingInstagramKeys = new Set((typeof dedupeLeadArrayV434 === 'function' ? novaInstaFila : novaInstaFila).map(lead => typeof getLeadIdentityKeyV434 === 'function' ? getLeadIdentityKeyV434(lead) : lead.id).filter(Boolean));

  analyses.forEach(analysis => {
    if (analysis.route === 'whatsapp-validation') {
      const lead = buildImportedLeadV430(analysis, analysis.route);
      const key = typeof getLeadIdentityKeyV434 === 'function' ? getLeadIdentityKeyV434(lead) : lead.id;
      if ((key && importSeenKeys.has(key)) || (key && existingValidationKeys.has(key))) {
        skipped++;
        qualificationLogV430('qualification-duplicate', { phase:'import', name:lead.nome, key, reason:'duplicado na importação atual ou validação' });
        return;
      }
      if (key) { importSeenKeys.add(key); existingValidationKeys.add(key); }
      novaValFila.push(lead);
      addedWhatsapp++;
      return;
    }
    if (analysis.route === 'instagram-backlog') {
      const lead = buildImportedLeadV430(analysis, analysis.route);
      const key = typeof getLeadIdentityKeyV434 === 'function' ? getLeadIdentityKeyV434(lead) : lead.id;
      if ((key && importSeenKeys.has(key)) || (key && existingInstagramKeys.has(key))) {
        skipped++;
        qualificationLogV430('qualification-duplicate', { phase:'import', name:lead.nome, key, reason:'duplicado na importação atual ou backlog instagram' });
        return;
      }
      if (key) { importSeenKeys.add(key); existingInstagramKeys.add(key); }
      novaInstaFila.push(lead);
      addedInstagram++;
      return;
    }
    skipped++;
  });

  const cleanValFila = typeof dedupeLeadArrayV434 === 'function' ? dedupeLeadArrayV434(novaValFila, { label:'import-validation-final' }) : novaValFila;
  const cleanInstaFila = typeof dedupeLeadArrayV434 === 'function' ? dedupeLeadArrayV434(novaInstaFila, { label:'import-instagram-final' }) : novaInstaFila;

  if (addedWhatsapp) saveValData(cleanValFila);
  if (addedInstagram) saveInstaFila(cleanInstaFila);
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
  notify(msg, addedWhatsapp || addedInstagram ? '' : 'warn');

  document.getElementById('importJsonInput').value = '';
  importPreview();
}
