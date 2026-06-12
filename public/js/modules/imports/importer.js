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

function buildImportedLeadV430(analysis, route) {
  const isInstagram = route === 'instagram-backlog';
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
    stage: isInstagram ? 'instagram_backlog' : 'validation',
    website_type: analysis.website.websiteType,
    website_quality: analysis.website.websiteQuality,
    qualification_reason: analysis.reason,
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
    status: lead.status || 'Não enviada',
    current_status: lead.current_status || 'new',
    current_stage: lead.stage || lead.current_stage || 'validation',
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
  for (let attempt = 0; attempt < 8; attempt++) {
    const { error } = await sbClient.from('leads').upsert(currentPayload, { onConflict:'id' });
    if (!error) return { ok:true };
    const errorCode = String(error.code || '');
    const errorMsg = String(error.message || '');
    if (errorCode === '23505' || errorMsg.includes('duplicate key')) {
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
  const importedLeadsForSupabase = [];

  const importSeenKeys = new Set();
  const existingValidationKeys = new Set();
  const existingInstagramKeys = new Set();

  for (const analysis of analyses) {
    if (analysis.route === 'whatsapp-validation') {
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
    if (analysis.route === 'instagram-backlog') {
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
        console.warn('[import][direct-persist-exception]', error?.message || error);
      }
    }
  }

  if (typeof loadSupabaseLeadsToLocalState === 'function') {
    try { await loadSupabaseLeadsToLocalState({ preserveWorkflow:false }); } catch (_) {}
  }

  // Espelha apenas o que foi salvo no Supabase para as telas legadas.
  // Não agenda sync local -> Supabase e não usa cache antigo como fonte da importação.
  // Importante: esse cache é gravado DEPOIS do reload do Supabase, porque o reload limpa caches antigos.
  try {
    if (persistedValFila.length && typeof VAL_KEY !== 'undefined') {
      const clean = typeof dedupeLeadArrayV434 === 'function' ? dedupeLeadArrayV434(persistedValFila, { label:'import-validation-persisted-cache' }) : persistedValFila;
      localStorage.setItem(VAL_KEY, JSON.stringify(clean));
    }
    if (persistedInstaFila.length && typeof INSTA_KEY !== 'undefined') {
      const clean = typeof dedupeLeadArrayV434 === 'function' ? dedupeLeadArrayV434(persistedInstaFila, { label:'import-instagram-persisted-cache' }) : persistedInstaFila;
      localStorage.setItem(INSTA_KEY, JSON.stringify(clean));
    }
  } catch (error) {
    console.warn('[import][screen-cache-error]', error?.message || error);
  }

  if (typeof renderValidacao === 'function') renderValidacao();
  if (typeof renderInstagram === 'function') renderInstagram();
  updateBadges();

  let msg = `✓ ${addedWhatsapp} → Validação WhatsApp (${addedComSite} com site · ${addedSemSite} sem site)`;
  if (addedInstagram) msg += ` · ${addedInstagram} → backlog Instagram`;
  if (stats.alreadySent) msg += ` · ${stats.alreadySent} já enviados`;
  if (stats.alreadyInDb) msg += ` · ${stats.alreadyInDb} já no banco`;
  if (stats.payloadDuplicate) msg += ` · ${stats.payloadDuplicate} duplicados no JSON`;
  if (blockedAlreadySent) msg += ` · ${blockedAlreadySent} bloqueados por Já enviados`;
  if (persistedSupabase) msg += ` · ${persistedSupabase} salvos no banco`;
  if (skipped) msg += ` · ${skipped} recusados`;
  if (persistedSupabase) msg += ` · espelhado nas telas`;
  if ((addedWhatsapp || addedInstagram) && !persistedSupabase) msg += ` · atenção: nenhum salvo no Supabase`;
  notify(msg, addedWhatsapp || addedInstagram ? '' : 'warn');

  document.getElementById('importJsonInput').value = '';
  importPreview();
}
