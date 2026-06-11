/* ═══════════════════════════
   IMPORTAR
═══════════════════════════ */
function renderImportarPanel() {
  renderRamoSelect();
  importPreview();
  renderManualValChips();
}

function parseApifyJson(raw) {
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return null; }

  const unwrap = (value) => {
    if (Array.isArray(value)) return value;
    if (!value || typeof value !== 'object') return null;
    const directKeys = [
      'results','items','data','places','records','rows','businesses','companies',
      'searchResults','organicResults','output','datasetItems'
    ];
    for (const key of directKeys) {
      const candidate = value[key];
      if (Array.isArray(candidate)) return candidate;
      if (candidate && typeof candidate === 'object') {
        const nested = unwrap(candidate);
        if (Array.isArray(nested)) return nested;
      }
    }
    let best = null;
    Object.values(value).forEach(candidate => {
      if (best) return;
      if (Array.isArray(candidate) && candidate.some(row => row && typeof row === 'object')) best = candidate;
    });
    return best;
  };

  const arr = unwrap(parsed);
  if (!Array.isArray(arr)) return null;

  // Alguns exports vêm como páginas/lotes com items internos.
  return arr.flatMap(row => {
    if (Array.isArray(row)) return row;
    if (row && typeof row === 'object') {
      for (const key of ['items','results','places','records','data']) {
        if (Array.isArray(row[key])) return row[key];
      }
    }
    return [row];
  }).filter(row => row && typeof row === 'object');
}

function getImportStatsV430(analyses = []) {
  const list = Array.isArray(analyses) ? analyses : [];
  const approvedWhatsapp = list.filter(item => item.route === 'whatsapp-validation');
  const approvedInstagram = list.filter(item => item.route === 'instagram-backlog');
  const approved = [...approvedWhatsapp, ...approvedInstagram];
  const refused = list.filter(item => item.route !== 'whatsapp-validation' && item.route !== 'instagram-backlog');
  const approvedComSite = approvedWhatsapp.filter(item => item.website?.type === 'commercial');
  const approvedSemSite = approvedWhatsapp.filter(item => item.website?.type !== 'commercial');

  const refusedReasonCount = (predicate) => refused.filter(predicate).length;
  const foraDoRamo = refusedReasonCount(item => !item.ramoMatch || item.reason === 'fora do ramo');
  const abaixoQualificacao = refusedReasonCount(item => item.ramoMatch && item.qualification && !item.qualification.approved || item.reason === 'abaixo da qualificacao');
  const semTelefone = refusedReasonCount(item => !item.hasPhone || item.reason === 'sem telefone e sem instagram');
  const jaVistos = refusedReasonCount(item => item.alreadyImported || item.payloadDuplicate || String(item.reason || '').includes('duplicado') || String(item.reason || '').includes('existente'));
  const wixSites = list.filter(item => item.website?.type === 'wixsite').length;
  const outros = Math.max(0, refused.length - foraDoRamo - abaixoQualificacao - semTelefone - jaVistos);

  return {
    total: list.length,
    approved: approved.length,
    refused: refused.length,
    validWhatsapp: approvedWhatsapp.length,
    whatsappSemSite: approvedSemSite.length,
    comSite: approvedComSite.length,
    semSite: approvedSemSite.length,
    instagramBacklog: approvedInstagram.length,
    wixSites,
    alreadySeen: jaVistos,
    outsideBranch: foraDoRamo,
    belowQualification: abaixoQualificacao,
    noPhone: semTelefone,
    outros
  };
}

function buildImportedLeadV430(analysis, route) {
  const isInstagram = route === 'instagram-backlog';
  const isCommercialSite = analysis.website.type === 'commercial';
  return {
    id: genId(),
    nome: analysis.name,
    whatsapp: analysis.phone,
    phone: analysis.phone,
    normalized_phone: typeof normalizeSentContactPhoneV30 === 'function' ? normalizeSentContactPhoneV30(analysis.phone) : normalizePhone(analysis.phone),
    instagram: analysis.instagram,
    site: isInstagram ? '' : (isCommercialSite ? (analysis.website.site || '') : ''),
    has_own_site: !!isCommercialSite,
    googleUrl: analysis.googleUrl,
    categoria: analysis.category,
    ramoId: activeRamoId || null,
    reviewsCount: analysis.qualification.reviews,
    totalScore: analysis.qualification.rating,
    numStatus: isInstagram ? 'nao-aplicavel' : 'pendente',
    tipo: isInstagram ? 'instagram' : (isCommercialSite ? 'com-site' : 'sem-site'),
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

  const aprovados = stats.approved;
  const recusados = stats.refused;
  sumEl.innerHTML = `
    <div class="import-summary-cards-v30">
      <div class="import-summary-card-v30 general">
        <div class="summary-card-title-v30">Geral</div>
        <div class="summary-card-line-v30"><span>Total</span><strong>${stats.total}</strong></div>
        <div class="summary-card-line-v30 ok"><span>Aprovados</span><strong>${aprovados}</strong></div>
        <div class="summary-card-line-v30 danger"><span>Recusados</span><strong>${recusados}</strong></div>
      </div>
      <div class="import-summary-card-v30 approved">
        <div class="summary-card-title-v30">Aprovados</div>
        <div class="summary-card-line-v30"><span>WhatsApp sem site</span><strong>${stats.whatsappSemSite}</strong></div>
        <div class="summary-card-line-v30"><span>Com site</span><strong>${stats.comSite}</strong></div>
        <div class="summary-card-line-v30"><span>Instagram</span><strong>${stats.instagramBacklog}</strong></div>
        <div class="summary-card-line-v30 ok"><span>Total aprovados</span><strong>${stats.approved}</strong></div>
      </div>
      <div class="import-summary-card-v30 refused">
        <div class="summary-card-title-v30">Recusados</div>
        <div class="summary-card-line-v30"><span>Fora do ramo</span><strong>${stats.outsideBranch}</strong></div>
        <div class="summary-card-line-v30"><span>Abaixo da qualificação</span><strong>${stats.belowQualification}</strong></div>
        <div class="summary-card-line-v30"><span>Sem telefone</span><strong>${stats.noPhone}</strong></div>
        <div class="summary-card-line-v30"><span>Já vistos</span><strong>${stats.alreadySeen}</strong></div>
        <div class="summary-card-line-v30"><span>Sites Wix</span><strong>${stats.wixSites}</strong></div>
        <div class="summary-card-line-v30"><span>Outros</span><strong>${stats.outros}</strong></div>
      </div>
    </div>
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
      : analysis.website.type === 'commercial'
        ? '<span class="q-badge info">🌐 com site · validar WhatsApp</span>'
        : analysis.website.type === 'wixsite'
          ? '<span class="q-badge warn">Wix/sem site próprio · validar WhatsApp</span>'
          : '<span class="q-badge ok">🚫 sem site · validar WhatsApp</span>';
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

async function importarLeads() {
  const raw = document.getElementById('importJsonInput').value.trim();
  if (!raw) { notify('// cole o JSON primeiro', 'err'); return; }
  const arr = parseApifyJson(raw);
  if (!arr || !arr.length) { notify('// JSON inválido ou vazio', 'err'); return; }

  const novaValFila = [...getValData()];
  const novaInstaFila = [...getInstaFila()];
  const analyses = analyzeApifyRowsV430(arr, 'import');
  const stats = getImportStatsV430(analyses);
  let addedWhatsapp = 0;
  let addedComSite = 0;
  let addedSemSite = 0;
  let addedInstagram = 0;
  let skipped = 0;
  let blockedAlreadySent = 0;

  const importSeenKeys = new Set();
  const existingValidationKeys = new Set((typeof dedupeLeadArrayV434 === 'function' ? novaValFila : novaValFila).map(lead => typeof getLeadIdentityKeyV434 === 'function' ? getLeadIdentityKeyV434(lead) : lead.id).filter(Boolean));
  const existingInstagramKeys = new Set((typeof dedupeLeadArrayV434 === 'function' ? novaInstaFila : novaInstaFila).map(lead => typeof getLeadIdentityKeyV434 === 'function' ? getLeadIdentityKeyV434(lead) : lead.id).filter(Boolean));

  for (const analysis of analyses) {
    if (analysis.route === 'whatsapp-validation') {
      const lead = buildImportedLeadV430(analysis, analysis.route);
      const key = typeof getLeadIdentityKeyV434 === 'function' ? getLeadIdentityKeyV434(lead) : lead.id;

      // Trava de importação: se o telefone já foi enviado, não entra novamente no sistema.
      if (typeof isPhoneAlreadySentV30 === 'function') {
        try {
          const check = await isPhoneAlreadySentV30(lead.whatsapp || analysis.phone || '');
          if (check.ok && check.blocked) {
            skipped++;
            blockedAlreadySent++;
            qualificationLogV430('qualification-already-sent', { phase:'import', name:lead.nome, phone:lead.whatsapp, normalizedPhone:check.normalizedPhone, reason:'telefone já está em sent_contacts' });
            continue;
          }
          if (!check.ok) {
            qualificationLogV430('qualification-sent-contacts-check-warning', { phase:'import', name:lead.nome, phone:lead.whatsapp, error:check.error });
          }
        } catch (err) {
          qualificationLogV430('qualification-sent-contacts-check-error', { phase:'import', name:lead.nome, phone:lead.whatsapp, error:err?.message || String(err) });
        }
      }

      if ((key && importSeenKeys.has(key)) || (key && existingValidationKeys.has(key))) {
        skipped++;
        qualificationLogV430('qualification-duplicate', { phase:'import', name:lead.nome, key, reason:'duplicado na importação atual ou validação' });
        continue;
      }
      if (key) { importSeenKeys.add(key); existingValidationKeys.add(key); }
      novaValFila.push(lead);
      addedWhatsapp++;
      if (lead.tipo === 'com-site') addedComSite++;
      else addedSemSite++;
      continue;
    }
    if (analysis.route === 'instagram-backlog') {
      const lead = buildImportedLeadV430(analysis, analysis.route);
      const key = typeof getLeadIdentityKeyV434 === 'function' ? getLeadIdentityKeyV434(lead) : lead.id;
      if ((key && importSeenKeys.has(key)) || (key && existingInstagramKeys.has(key))) {
        skipped++;
        qualificationLogV430('qualification-duplicate', { phase:'import', name:lead.nome, key, reason:'duplicado na importação atual ou backlog instagram' });
        continue;
      }
      if (key) { importSeenKeys.add(key); existingInstagramKeys.add(key); }
      novaInstaFila.push(lead);
      addedInstagram++;
      continue;
    }
    skipped++;
  }

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

  let msg = `✓ ${addedWhatsapp} → Validação WhatsApp (${addedComSite} com site · ${addedSemSite} sem site)`;
  if (addedInstagram) msg += ` · ${addedInstagram} → backlog Instagram`;
  if (stats.alreadySeen) msg += ` · ${stats.alreadySeen} já vistos`;
  if (blockedAlreadySent) msg += ` · ${blockedAlreadySent} bloqueados por Já enviados`;
  if (skipped) msg += ` · ${skipped} ignoradas`;
  notify(msg, addedWhatsapp || addedInstagram ? '' : 'warn');

  document.getElementById('importJsonInput').value = '';
  importPreview();
}
