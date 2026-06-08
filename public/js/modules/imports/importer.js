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
    importadoEm: todayStr(),
    sourceRaw: analysis.item || {},
    rawPayload: analysis.item || {}
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
  [...novaValFila, ...novaInstaFila, ...(typeof getLeadBaseData === 'function' ? getLeadBaseData() : [])].forEach(lead => {
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
    if (typeof syncOperationalDataToSupabase === 'function') {
      syncOperationalDataToSupabase({ silent:true }).catch(error => {
        uiSyncLog('supabase-save-error', { entity:'apify-import-operational-data', error:error?.message || error });
      });
    } else if (typeof scheduleOperationalSync === 'function') {
      scheduleOperationalSync({ delay:0, reason:'apify-import' });
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

/* ═══════════════════════════
   HOTFIX 6.36 — Validação manual na Importação
   Corrige funções globais ausentes: renderManualValChips e validarNumeroManual.
═══════════════════════════ */
(function installManualValidationImportHotfix(){
  if (window.__manualValidationImportHotfix636) return;
  window.__manualValidationImportHotfix636 = true;

  function escManual(value = '') {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function digitsManual(value = '') {
    return String(value || '').replace(/\D/g, '');
  }

  function normalizeManualPhone(value = '') {
    const raw = digitsManual(value);
    if (!raw) return '';
    if (raw.startsWith('55')) return raw;
    if (raw.length === 10 || raw.length === 11) return `55${raw}`;
    return raw;
  }

  function notifyManual(message, type = '') {
    if (typeof notify === 'function') return notify(message, type);
    if (typeof notifyUser === 'function') return notifyUser(message, type);
    console[type === 'err' ? 'error' : 'log'](message);
  }

  function normalizeManualChip(chip = {}) {
    return {
      ...chip,
      id: chip.id || chip.chip_id || chip.instance || chip.name || chip.label || '',
      name: chip.name || chip.nome || chip.label || chip.instance || 'Chip',
      url: String(chip.url || chip.base_url || chip.baseUrl || chip.api_url || chip.apiUrl || '').replace(/\/+$/, ''),
      instance: chip.instance || chip.instance_name || chip.instanceName || chip.nome || chip.name || '',
      key: chip.key || chip.apikey || chip.apiKey || chip.api_key || chip.token || ''
    };
  }

  async function getManualChips() {
    try {
      if (typeof window.CRMHydrateChipsCache === 'function') {
        const hydrated = await window.CRMHydrateChipsCache();
        if (Array.isArray(hydrated) && hydrated.length) return hydrated.map(normalizeManualChip);
      }
    } catch (error) {
      console.warn('[hotfix636] hydrate chips falhou:', error);
    }

    const local = [];
    try { if (typeof window.getChips === 'function') local.push(...(window.getChips() || [])); } catch (_) {}
    try { if (Array.isArray(window.__crmChipsCache)) local.push(...window.__crmChipsCache); } catch (_) {}

    const seen = new Set();
    return local.map(normalizeManualChip).filter((chip) => {
      const key = String(chip.id || chip.instance || chip.name || '').trim();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  window.renderManualValChips = function renderManualValChips() {
    const target = document.getElementById('manualValChipTabs');
    if (!target) return;

    target.innerHTML = '<span style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--muted)">Carregando chips...</span>';

    getManualChips().then((chips) => {
      window.__manualValChips = chips;

      if (!chips.length) {
        target.innerHTML = '<span style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--muted)">Nenhum chip configurado em Configurações > Chips</span>';
        return;
      }

      if (!window.__manualValChipId || !chips.some((chip) => String(chip.id) === String(window.__manualValChipId))) {
        window.__manualValChipId = chips[0].id;
      }

      target.innerHTML = chips.map((chip, index) => {
        const active = String(chip.id) === String(window.__manualValChipId);
        const status = chip.connectionState || chip.status || 'salvo';
        return `
          <div class="chip-tab${active ? ' active' : ''}"
               title="${escManual(chip.instance)} · ${escManual(status)}"
               onclick="window.__manualValChipId='${escManual(chip.id)}'; if (typeof window.setValChip === 'function') window.setValChip('${escManual(chip.id)}'); window.renderManualValChips();">
            ${escManual(chip.name || `Chip ${index + 1}`)}
          </div>
        `;
      }).join('');
    }).catch((error) => {
      console.warn('[hotfix636] render manual chips falhou:', error);
      target.innerHTML = '<span style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--danger,#ef4444)">Falha ao carregar chips</span>';
    });
  };

  function parseManualValidationResult(data = {}) {
    const item = Array.isArray(data)
      ? data[0]
      : (data?.data?.[0] || data?.result?.[0] || data?.numbers?.[0] || data);

    const explicitFalse = item && (
      item.exists === false ||
      item.isWhatsapp === false ||
      item.numberExists === false ||
      item.exists === 'false' ||
      item.isWhatsapp === 'false' ||
      item.numberExists === 'false'
    );

    const exists = !!(
      item?.exists === true ||
      item?.isWhatsapp === true ||
      item?.numberExists === true ||
      item?.exists === 'true' ||
      item?.isWhatsapp === 'true' ||
      item?.numberExists === 'true' ||
      item?.jid ||
      item?.waId ||
      item?.wa_id
    );

    return { item: item || {}, exists, definitive: exists || explicitFalse };
  }

  function setManualResult(message, type = '') {
    const box = document.getElementById('manualValResult');
    if (!box) return;
    box.style.display = 'block';
    box.style.border = `1px solid ${type === 'err' ? 'var(--danger,#ef4444)' : type === 'warn' ? 'var(--warning,#f59e0b)' : 'var(--success,#22c55e)'}`;
    box.style.background = 'var(--surface2)';
    box.style.color = type === 'err' ? 'var(--danger,#ef4444)' : type === 'warn' ? 'var(--warning,#f59e0b)' : 'var(--success,#22c55e)';
    box.textContent = message;
  }

  window.validarNumeroManual = async function validarNumeroManual() {
    const phoneInput = document.getElementById('manualLeadPhone');
    const spinner = document.getElementById('manualValSpinner');
    const phone = normalizeManualPhone(phoneInput?.value || '');

    if (!phone || phone.length < 12) {
      setManualResult('Número ausente ou inválido.', 'warn');
      notifyManual('// número manual inválido', 'warn');
      return { ok: false, invalidPhone: true };
    }

    const chips = await getManualChips();
    window.__manualValChips = chips;
    const chip = chips.find((item) => String(item.id) === String(window.__manualValChipId)) || chips[0];

    if (!chip) {
      setManualResult('Cadastre ou selecione um chip antes de validar.', 'warn');
      notifyManual('// cadastre ou selecione um chip antes de validar', 'warn');
      return { ok: false, noChip: true };
    }

    if (!chip.url || !chip.instance || !chip.key) {
      setManualResult('Chip incompleto: URL, instância ou API key ausente.', 'err');
      notifyManual('// chip incompleto para validação', 'err');
      return { ok: false, chipIncomplete: true };
    }

    if (spinner) spinner.style.display = 'inline-block';
    try {
      const response = await fetch('/api/prospeccao/validar-numero', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ numbers: [phone], chipUrl: chip.url, instance: chip.instance, apikey: chip.key })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.error) throw new Error(data?.error || data?.message || `Falha ${response.status}`);

      const parsed = parseManualValidationResult(data);
      if (!parsed.definitive) {
        setManualResult('A Evolution respondeu sem resultado definitivo. Não aprove ainda.', 'warn');
        return { ok: false, raw: data };
      }

      if (parsed.exists) {
        setManualResult(`WhatsApp validado: ${phone}`, '');
        if (phoneInput) phoneInput.value = phone;
        return { ok: true, exists: true, phone, raw: data };
      }

      setManualResult(`Número sem WhatsApp: ${phone}`, 'warn');
      return { ok: true, exists: false, phone, raw: data };
    } catch (error) {
      console.warn('[hotfix636] validação manual falhou:', error);
      setManualResult(error?.message || 'Falha ao validar número.', 'err');
      notifyManual(error?.message || 'Falha ao validar número.', 'err');
      return { ok: false, error: true };
    } finally {
      if (spinner) spinner.style.display = 'none';
    }
  };

  if (typeof window.adicionarLeadManual !== 'function') {
    window.adicionarLeadManual = async function adicionarLeadManual() {
      const nome = (document.getElementById('manualLeadNome')?.value || '').trim();
      const phone = normalizeManualPhone(document.getElementById('manualLeadPhone')?.value || '');
      const googleUrl = (document.getElementById('manualLeadGoogleUrl')?.value || '').trim();
      const instagram = (document.getElementById('manualLeadInsta')?.value || '').trim();

      if (!nome) {
        notifyManual('// informe o nome da empresa', 'warn');
        return;
      }

      const lead = {
        id: typeof genId === 'function' ? genId() : `manual-${Date.now()}`,
        nome,
        company_name: nome,
        whatsapp: phone,
        phone,
        instagram,
        googleUrl,
        google_maps_url: googleUrl,
        ramoId: window.activeRamoId || null,
        numStatus: phone ? 'pendente' : 'nao-aplicavel',
        tipo: phone ? 'sem-site' : 'instagram',
        templateType: phone ? 'sem-site' : '',
        canal: phone ? 'pendente' : 'insta',
        stage: phone ? 'validation' : 'instagram_backlog',
        importadoEm: typeof todayStr === 'function' ? todayStr() : new Date().toISOString().slice(0, 10),
        sourceRaw: { source: 'manual-import-hotfix-6.36' },
        rawPayload: { source: 'manual-import-hotfix-6.36' }
      };

      try {
        if (phone) {
          const list = typeof getValData === 'function' ? [...getValData(), lead] : [lead];
          if (typeof saveValData === 'function') saveValData(list);
        } else {
          const list = typeof getInstaFila === 'function' ? [...getInstaFila(), lead] : [lead];
          if (typeof saveInstaFila === 'function') saveInstaFila(list);
        }
        if (typeof markOperationalDataDirtyV430 === 'function') markOperationalDataDirtyV430('manual-lead');
        if (typeof scheduleOperationalSync === 'function') scheduleOperationalSync({ delay: 0, reason: 'manual-lead' });
        if (typeof updateBadges === 'function') updateBadges();
        if (typeof importPreview === 'function') importPreview();
        notifyManual(phone ? '✓ Lead manual adicionado à Validação' : '✓ Lead manual adicionado ao Instagram', '');
      } catch (error) {
        console.warn('[hotfix636] adicionar lead manual falhou:', error);
        notifyManual(error?.message || 'Falha ao adicionar lead manual.', 'err');
      }
    };
  }

  setTimeout(() => {
    if (document.getElementById('manualValChipTabs')) window.renderManualValChips();
  }, 300);
})();
