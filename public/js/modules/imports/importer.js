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


function isWhatsappImportRouteV31(route = '') {
  return route === 'attribution_whatsapp' || route === 'attribution_site' || route === 'whatsapp-validation';
}
function isInstagramImportRouteV31(route = '') {
  return route === 'attribution_instagram' || route === 'instagram-backlog';
}
function isApprovedImportRouteV31(route = '') {
  return isWhatsappImportRouteV31(route) || isInstagramImportRouteV31(route);
}

function getImportStatsV430(analyses = []) {
  const list = Array.isArray(analyses) ? analyses : [];
  const approvedWhatsapp = list.filter(item => isWhatsappImportRouteV31(item.route));
  const approvedInstagram = list.filter(item => isInstagramImportRouteV31(item.route));
  const approved = [...approvedWhatsapp, ...approvedInstagram];
  const refused = list.filter(item => !isApprovedImportRouteV31(item.route));
  const approvedComSite = approvedWhatsapp.filter(item => item.website?.type === 'commercial');
  const approvedSemSite = approvedWhatsapp.filter(item => item.website?.type !== 'commercial');

  // Contagem exclusiva: cada recusado entra em apenas um motivo para não inflar o total.
  const refusedBuckets = {
    outsideBranch: 0,
    belowQualification: 0,
    noPhone: 0,
    alreadySent: 0,
    alreadyInDb: 0,
    payloadDuplicate: 0,
    wixSites: 0,
    outros: 0
  };

  refused.forEach(item => {
    const reason = String(item.reason || '').toLowerCase();
    if (item.alreadyImported && item.alreadySeenSource === 'sent_contacts') {
      refusedBuckets.alreadySent++;
    } else if (item.alreadyImported) {
      refusedBuckets.alreadyInDb++;
    } else if (item.payloadDuplicate || reason.includes('duplicado no json')) {
      refusedBuckets.payloadDuplicate++;
    } else if (!item.hasPhone || reason.includes('sem telefone')) {
      refusedBuckets.noPhone++;
    } else if (!item.ramoMatch || reason.includes('fora do ramo')) {
      refusedBuckets.outsideBranch++;
    } else if ((item.qualification && !item.qualification.approved) || reason.includes('abaixo da qualificacao') || reason.includes('abaixo da qualificação')) {
      refusedBuckets.belowQualification++;
    } else if (item.website?.type === 'wixsite') {
      refusedBuckets.wixSites++;
    } else {
      refusedBuckets.outros++;
    }
  });

  return {
    total: list.length,
    approved: approved.length,
    refused: refused.length,
    validWhatsapp: approvedWhatsapp.length,
    whatsappSemSite: approvedSemSite.length,
    comSite: approvedComSite.length,
    semSite: approvedSemSite.length,
    instagramBacklog: approvedInstagram.length,
    wixSites: refusedBuckets.wixSites,
    alreadySeen: refusedBuckets.alreadySent + refusedBuckets.alreadyInDb,
    alreadySent: refusedBuckets.alreadySent,
    alreadyInDb: refusedBuckets.alreadyInDb,
    payloadDuplicate: refusedBuckets.payloadDuplicate,
    outsideBranch: refusedBuckets.outsideBranch,
    belowQualification: refusedBuckets.belowQualification,
    noPhone: refusedBuckets.noPhone,
    outros: refusedBuckets.outros
  };
}


function calculateLeadPriorityScoreV31(analysisOrLead = {}) {
  const q = analysisOrLead.qualification || {};
  const rating = Number(q.rating ?? analysisOrLead.rating ?? analysisOrLead.totalScore ?? 0) || 0;
  const reviews = Number(q.reviews ?? analysisOrLead.reviewsCount ?? analysisOrLead.reviews_count ?? 0) || 0;
  const website = analysisOrLead.website || {};
  const hasOwnSite = !!(analysisOrLead.has_own_site || website.type === 'commercial' || analysisOrLead.site || analysisOrLead.website_url);
  const websiteType = String(website.websiteType || analysisOrLead.website_type || '').toLowerCase();
  const websiteQuality = String(website.websiteQuality || analysisOrLead.website_quality || '').toLowerCase();
  let score = 0;
  score += Math.min(50, Math.max(0, rating) * 10);
  score += Math.min(30, Math.log10(Math.max(1, reviews)) * 15);
  if (!hasOwnSite || websiteType === 'none' || websiteQuality === 'missing') score += 18;
  else if (websiteQuality === 'weak' || websiteType === 'wixsite' || websiteType === 'instagram' || websiteType === 'external') score += 10;
  else score += 4;
  if (rating >= 4.7) score += 8;
  if (reviews >= 50) score += 6;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function buildImportedLeadV430(analysis, route) {
  const isInstagram = isInstagramImportRouteV31(route);
  const isCommercialSite = analysis.website.type === 'commercial';
  return {
    id: (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : genId()),
    nome: analysis.name,
    whatsapp: analysis.phone,
    phone: analysis.phone,
    normalized_phone: typeof normalizeSentContactPhoneV30 === 'function' ? normalizeSentContactPhoneV30(analysis.phone) : normalizePhone(analysis.phone),
    instagram: analysis.instagram,
    site: isInstagram ? '' : (isCommercialSite ? (analysis.website.site || '') : ''),
    has_own_site: !!isCommercialSite,
    googleUrl: analysis.googleUrl,
    city: analysis.item?.city || analysis.item?.cidade || '',
    state: analysis.item?.state || analysis.item?.estado || analysis.item?.region || '',
    raw_payload: analysis.item || {},
    categoria: analysis.category,
    ramoId: activeRamoId || null,
    reviewsCount: analysis.qualification.reviews,
    totalScore: analysis.qualification.rating,
    numStatus: isInstagram ? 'nao-aplicavel' : 'pendente',
    tipo: isInstagram ? 'instagram' : (isCommercialSite ? 'com-site' : 'sem-site'),
    canal: isInstagram ? 'insta' : 'pendente',
    // Fluxo V31: importação já separa direto para Atribuição.
    // WhatsApp sem site => assignment_whatsapp; WhatsApp com site => assignment_website; sem telefone => assignment_instagram.
    stage: isInstagram ? 'assignment_instagram' : (isCommercialSite ? 'assignment_website' : 'assignment_whatsapp'),
    website_type: analysis.website.websiteType,
    website_quality: analysis.website.websiteQuality,
    qualification_reason: analysis.reason,
    lead_score: calculateLeadPriorityScoreV31(analysis),
    importadoEm: todayStr()
  };
}

let importPreviewSeqV430 = 0;

async function importPreview() {
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

  const seq = ++importPreviewSeqV430;
  sumEl.innerHTML = '<span style="color:var(--muted)">// consultando já enviados no Supabase...</span>';

  const analyses = typeof analyzeApifyRowsWithCloudV430 === 'function'
    ? await analyzeApifyRowsWithCloudV430(arr, 'preview')
    : analyzeApifyRowsV430(arr, 'preview');
  if (seq !== importPreviewSeqV430) return;
  const stats = getImportStatsV430(analyses);
  const opportunities = analyses.filter(item => isApprovedImportRouteV31(item.route));

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
        <div class="summary-card-line-v30"><span>Já enviados</span><strong>${stats.alreadySent}</strong></div>
        <div class="summary-card-line-v30"><span>Já no banco</span><strong>${stats.alreadyInDb}</strong></div>
        <div class="summary-card-line-v30"><span>Duplicados no JSON</span><strong>${stats.payloadDuplicate}</strong></div>
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
    const routeBadge = isInstagramImportRouteV31(analysis.route)
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



async function registerLeadIdentityAfterImportV31(lead = {}, savedId = '') {
  try {
    if (!(typeof sbClient !== 'undefined' && sbClient && typeof currentUser !== 'undefined' && currentUser?.id)) return;
    const rows = [];
    const company = lead.nome || lead.company_name || lead.companyName || 'Lead sem nome';
    const phone = typeof normalizeImportPhoneV430 === 'function' ? normalizeImportPhoneV430(lead.whatsapp || lead.phone || '') : (lead.whatsapp || lead.phone || '');
    const site = typeof normalizeIdentitySiteV430 === 'function' ? normalizeIdentitySiteV430(lead.site || lead.website || '') : (lead.site || lead.website || '');
    const maps = typeof normalizeIdentityUrlV430 === 'function' ? normalizeIdentityUrlV430(lead.googleUrl || lead.maps_url || '') : (lead.googleUrl || lead.maps_url || '');
    const ig = typeof normalizeIdentityInstagramV430 === 'function' ? normalizeIdentityInstagramV430(lead.instagram || lead.instagram_url || '') : (lead.instagram || lead.instagram_url || '');
    function push(type, value){
      if (!value) return;
      rows.push({
        user_id: currentUser.id,
        lead_id: savedId || lead.id || null,
        identity_type: type,
        identity_value: value,
        company_name: company,
        source_table: 'leads',
        status: lead.current_status || lead.status || 'active',
        raw_payload: { imported_at: new Date().toISOString() }
      });
    }
    push('phone', phone);
    push('site', site);
    push('maps', maps);
    push('instagram', ig);
    if (!rows.length) return;
    const { error } = await sbClient.from('lead_registry').upsert(rows, { onConflict:'user_id,identity_type,identity_value' });
    if (error && !String(error.message||'').includes('lead_registry')) console.warn('[lead-registry][upsert-warning]', error.message || error);
  } catch (err) {
    console.warn('[lead-registry][upsert-error]', err?.message || err);
  }
}

async function persistImportedLeadDirectV430(lead = {}) {
  if (!lead || !lead.id) return { skipped:true, reason:'lead-missing' };
  if (!(typeof sbClient !== 'undefined' && sbClient && typeof currentUser !== 'undefined' && currentUser?.id)) {
    return { skipped:true, reason:'supabase-not-ready' };
  }

  const payload = {
    id: (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(lead.id || '')) ? String(lead.id) : (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(lead.id || genId()))),
    user_id: currentUser.id,
    user_email: String(currentUser.email || '').trim().toLowerCase(),
    company_name: lead.nome || lead.company_name || lead.companyName || 'Lead sem nome',
    phone: lead.whatsapp || lead.phone || '',
    // IMPORTANTE: public.leads.normalized_phone é GENERATED ALWAYS no Supabase
    // (normalize_br_phone(phone)). Não enviar essa coluna no insert/upsert.
    city: lead.city || lead.cidade || '',
    state: lead.state || lead.estado || '',
    instagram: lead.instagram || '',
    instagram_url: lead.instagram || '',
    website: lead.site || lead.website || '',
    maps_url: lead.googleUrl || lead.maps_url || '',
    category: lead.categoria || lead.category || '',
    rating: Number(lead.totalScore || lead.rating || 0) || null,
    reviews_count: Number(lead.reviewsCount || lead.reviews_count || 0) || 0,
    lead_score: Number(lead.lead_score || lead.leadScore || calculateLeadPriorityScoreV31(lead)) || 0,
    status: lead.status || 'Não enviada',
    current_status: lead.current_status || 'new',
    current_stage: lead.stage || lead.current_stage || (lead.tipo === 'instagram' ? 'assignment_instagram' : (lead.tipo === 'com-site' || lead.has_own_site ? 'assignment_website' : 'assignment_whatsapp')),
    lead_channel: lead.tipo === 'instagram' ? 'instagram' : 'whatsapp',
    lead_type: lead.tipo || (lead.has_own_site ? 'com-site' : 'sem-site'),
    has_own_site: !!lead.has_own_site,
    pipeline_status: lead.pipeline_status || lead.pipelineStatus || 'imported',
    raw_payload: lead.raw_payload || lead.rawPayload || {},
    updated_at: new Date().toISOString()
  };

  // Compatibilidade: se o schema em produção ainda não tiver alguma coluna,
  // remove a coluna indicada pelo erro e tenta novamente. Isso evita importação zerada.
  let currentPayload = { ...payload };
  // Defesa dupla: essa coluna é GENERATED ALWAYS no banco e nunca pode ir no upsert,
  // mesmo que algum cache/lead legado ainda traga normalized_phone dentro do objeto.
  delete currentPayload.normalized_phone;
  for (let attempt = 0; attempt < 8; attempt++) {
    delete currentPayload.normalized_phone;
    const { error } = await sbClient.from('leads').upsert(currentPayload, { onConflict:'id' });
    if (!error) {
      await registerLeadIdentityAfterImportV31(lead, currentPayload.id);
      return { ok:true };
    }
    const errorCode = String(error.code || '');
    const errorMsg = String(error.message || '');
    if (errorCode === '23505' || errorCode === 'P0001' || errorMsg.includes('duplicate key') || errorMsg.includes('duplicate_identity')) {
      return { ok:false, duplicate:true, error };
    }

    const msg = String(error.message || '');
    const missing = msg.match(/Could not find the '([^']+)' column/)?.[1];
    if (missing && Object.prototype.hasOwnProperty.call(currentPayload, missing)) {
      delete currentPayload[missing];
      continue;
    }

    const generatedColumn = msg.match(/cannot insert a non-DEFAULT value into column \"([^\"]+)\"/)?.[1]
      || msg.match(/cannot insert a non-DEFAULT value into column \"([^\"]+)\"/)?.[1]
      || msg.match(/cannot insert a non-DEFAULT value into column ([a-zA-Z0-9_]+)/)?.[1];
    if (generatedColumn && Object.prototype.hasOwnProperty.call(currentPayload, generatedColumn)) {
      delete currentPayload[generatedColumn];
      continue;
    }

    console.warn('[import][direct-upsert-error]', msg, currentPayload);
    return { error };
  }
  return { error:new Error('Falha ao compatibilizar payload de lead') };
}

async function importarLeads() {
  const raw = document.getElementById('importJsonInput').value.trim();
  if (!raw) { notify('// cole o JSON primeiro', 'err'); return; }
  const arr = parseApifyJson(raw);
  if (!arr || !arr.length) { notify('// JSON inválido ou vazio', 'err'); return; }

  // A importação não usa mais filas antigas do localStorage como base de decisão.
  // Supabase + sent_contacts são a fonte de verdade; localStorage é apenas cache de tela após persistir.
  const novaValFila = [];
  const novaInstaFila = [];
  const analyses = typeof analyzeApifyRowsWithCloudV430 === 'function'
    ? await analyzeApifyRowsWithCloudV430(arr, 'import')
    : analyzeApifyRowsV430(arr, 'import');
  const stats = getImportStatsV430(analyses);
  let addedWhatsapp = 0;
  let addedComSite = 0;
  let addedSemSite = 0;
  let addedInstagram = 0;
  let skipped = 0;
  let blockedAlreadySent = 0;
  const persistErrors = [];
  const importedLeadsForSupabase = [];

  const importSeenKeys = new Set();
  const existingValidationKeys = new Set();
  const existingInstagramKeys = new Set();

  for (const analysis of analyses) {
    if (isWhatsappImportRouteV31(analysis.route)) {
      const lead = buildImportedLeadV430(analysis, analysis.route);
      const key = lead.normalized_phone || (lead.googleUrl ? `maps:${lead.googleUrl}` : lead.id);

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
      importedLeadsForSupabase.push(lead);
      addedWhatsapp++;
      if (lead.tipo === 'com-site') addedComSite++;
      else addedSemSite++;
      continue;
    }
    if (isInstagramImportRouteV31(analysis.route)) {
      const lead = buildImportedLeadV430(analysis, analysis.route);
      const key = lead.normalized_phone || (lead.googleUrl ? `maps:${lead.googleUrl}` : lead.id);
      if ((key && importSeenKeys.has(key)) || (key && existingInstagramKeys.has(key))) {
        skipped++;
        qualificationLogV430('qualification-duplicate', { phase:'import', name:lead.nome, key, reason:'duplicado na importação atual ou backlog instagram' });
        continue;
      }
      if (key) { importSeenKeys.add(key); existingInstagramKeys.add(key); }
      novaInstaFila.push(lead);
      importedLeadsForSupabase.push(lead);
      addedInstagram++;
      continue;
    }
    skipped++;
  }

  let persistedSupabase = 0;
  const persistedValFila = [];
  const persistedInstaFila = [];
  if (importedLeadsForSupabase.length) {
    for (const lead of importedLeadsForSupabase) {
      try {
        const result = await persistImportedLeadDirectV430(lead);
        if (result?.ok) {
          persistedSupabase++;
          if (lead.tipo === 'instagram') persistedInstaFila.push(lead);
          else persistedValFila.push(lead);
        } else {
          skipped++;
          qualificationLogV430('qualification-persist-failed', { phase:'import', name:lead.nome, error:result?.error?.message || result?.error || 'falha ao salvar' });
        }
      } catch (error) {
        skipped++;
        persistErrors.push({ name: lead.nome, error: String(error?.message || error) });
        console.warn('[import][direct-persist-exception]', error?.message || error);
      }
    }
  }

  // Recarrega do Supabase e deixa o loader reconstruir as filas das telas.
  // Fallback: se por algum motivo o reload falhar, usa exatamente os leads persistidos.
  let reloadedFromSupabase = false;
  if (typeof loadSupabaseLeadsToLocalState === 'function') {
    try {
      await loadSupabaseLeadsToLocalState({ preserveWorkflow:false });
      reloadedFromSupabase = true;
    } catch (error) {
      console.warn('[import][reload-supabase-after-import-error]', error?.message || error);
    }
  }

  if (!reloadedFromSupabase) {
    try {
      if (typeof saveValData === 'function') saveValData(persistedValFila);
      else if (typeof VAL_KEY !== 'undefined') localStorage.setItem(VAL_KEY, JSON.stringify(persistedValFila));
      if (typeof saveInstaFila === 'function') saveInstaFila(persistedInstaFila);
      else if (typeof INSTA_KEY !== 'undefined') localStorage.setItem(INSTA_KEY, JSON.stringify(persistedInstaFila));
    } catch (error) {
      console.warn('[import][screen-cache-error]', error?.message || error);
    }
  }

  console.log('[import][final-counts]', {
    total: stats.total,
    approvedPreview: stats.approved,
    persistedSupabase,
    validationPersisted: persistedValFila.length,
    instagramPersisted: persistedInstaFila.length,
    validationScreen: typeof getValData === 'function' ? getValData().length : null,
    instagramScreen: typeof getInstaFila === 'function' ? getInstaFila().length : null,
    skipped,
    blockedAlreadySent,
    persistErrors
  });

  if (typeof renderValidacao === 'function') renderValidacao();
  updateBadges();

  const alertTotal = stats.total;
  const alertAprovados = persistedSupabase;
  const alertRecusados = Math.max(0, alertTotal - alertAprovados);
  let msg = `Total: ${alertTotal} · Aprovados: ${alertAprovados} · Recusados: ${alertRecusados}`;
  if (!alertAprovados && persistErrors.length) {
    msg += ` · Erro: ${persistErrors[0].error}`;
    console.error('[import][first-persist-error]', persistErrors[0]);
  }
  notify(msg, alertAprovados ? '' : 'warn');

  document.getElementById('importJsonInput').value = '';
  importPreview();
}
