/* CRM Rebuild Fase 6.18 - Validacao consolidada sobre Supabase */
(function () {
  const SUPABASE_URL = 'https://txyknazfufashgzlxkqh.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_ClGVAmaiS4tNWe8W_4EPew_aPvAzK0E';
  const PAGE_SIZE = 40;

  const state = {
    activeTab: 'pendentes',
    page: 1,
    rows: [],
    loading: false
  };

  const runtimeLeadCache = new Map();

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[char]));
  }

  function text(value, fallback = '-') {
    const clean = String(value ?? '').trim();
    return clean || fallback;
  }

  function numberText(value, fallback = '-') {
    if (value === null || value === undefined || value === '') return fallback;
    return String(value);
  }

  function normalizePhoneLabel(phone) {
    const raw = text(phone, '');
    if (!raw) return 'Sem telefone';
    const digits = raw.replace(/\D+/g, '');
    if (digits.length >= 12 && digits.startsWith('55')) {
      return `+55 ${digits.slice(2, 4)} ${digits.slice(4)}`;
    }
    return raw;
  }

  function getStageLocation(row) {
    return [row.city, row.state_code || row.state].filter(Boolean).join(' - ');
  }

  async function getCurrentUserIdRebuild() {
    try {
      if (typeof getCurrentSupabaseUserIdV412 === 'function') {
        const maybe = await getCurrentSupabaseUserIdV412();
        if (maybe) return maybe;
      }
    } catch (_) {}

    if (window.currentUser?.id) return window.currentUser.id;

    try {
      if (typeof currentUser !== 'undefined' && currentUser?.id) {
        return currentUser.id;
      }
    } catch (_) {}

    return null;
  }

  async function getHeaders(content = false) {
    let headers = null;

    try {
      if (typeof getSupabaseAuthHeadersV423 === 'function') {
        headers = await getSupabaseAuthHeadersV423();
      }
    } catch (_) {}

    if (!headers?.apikey) {
      headers = {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`
      };
    }

    return content
      ? { ...headers, 'Content-Type': 'application/json' }
      : headers;
  }

  async function readJson(response) {
    const textBody = await response.text();
    return textBody ? JSON.parse(textBody) : null;
  }

  async function fetchValidationLeads() {
    const userId = await getCurrentUserIdRebuild();
    const params = new URLSearchParams({
      select: '*',
      current_stage: 'eq.validation',
      order: 'created_at.desc'
    });

    if (userId) params.set('user_id', `eq.${userId}`);

    const response = await fetch(`${SUPABASE_URL}/rest/v1/v_lead_cards_persistent?${params.toString()}`, {
      headers: await getHeaders()
    });
    const data = await readJson(response);

    if (!response.ok) throw data || new Error(`Falha ao carregar Validacao (${response.status}).`);
    return Array.isArray(data) ? data : [];
  }

  async function rpcValidationAction(leadId, action, reason = null) {
    const userId = await getCurrentUserIdRebuild();
    if (!userId) throw new Error('Usuario autenticado nao encontrado.');

    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rpc_validation_lead_action`, {
      method: 'POST',
      headers: await getHeaders(true),
      body: JSON.stringify({
        p_user_id: userId,
        p_lead_id: leadId,
        p_action: action,
        p_reason: reason
      })
    });
    const data = await readJson(response);

    if (!response.ok) throw data || new Error(`Falha na acao de validacao (${response.status}).`);
    return data;
  }

  function normalizeLeadForRuntime(row = {}) {
    const companyName = row.company_name || row.nome || 'Empresa sem nome';
    const website = row.website || row.site || '';
    const phone = row.phone || row.whatsapp || '';
    const maps = row.google_maps_url || row.googleUrl || row.maps || '';
    const instagram = row.instagram_url || row.instagram || '';
    const location = getStageLocation(row);
    const status = row.current_status || '';

    return {
      ...row,
      id: row.id,
      lead_id: row.id,
      nome: companyName,
      empresa: companyName,
      name: companyName,
      company_name: companyName,
      categoria: row.category || row.categoria || '',
      category: row.category || row.categoria || '',
      descricao: row.description || row.descricao || '',
      description: row.description || row.descricao || '',
      nota: row.rating,
      rating: row.rating,
      avaliacoes: row.reviews_count,
      reviews: row.reviews_count,
      reviews_count: row.reviews_count,
      whatsapp: phone,
      telefone: phone,
      phone,
      normalized_phone: row.normalized_phone || row.phone_normalized || '',
      whatsapp_status: row.whatsapp_status || (status === 'whatsapp_validated' ? 'valid' : 'pending'),
      whatsappValidationStatus: status === 'whatsapp_validated' ? 'valid' : 'pending',
      numStatus: status === 'whatsapp_validated' ? 'valido' : (status === 'rejected_validation' ? 'invalido' : 'pendente'),
      site: website,
      website,
      hasOwnSite: !!row.has_own_site,
      has_own_site: !!row.has_own_site,
      instagram,
      instagram_url: instagram,
      instagram_username: row.instagram_username || '',
      googleUrl: maps,
      google_maps_url: maps,
      maps,
      place_id: row.place_id || '',
      pais: row.country || '',
      country: row.country || '',
      estado: row.state || '',
      state: row.state || '',
      uf: row.state_code || '',
      state_code: row.state_code || '',
      cidade: row.city || '',
      city: row.city || '',
      bairro: row.neighborhood || '',
      neighborhood: row.neighborhood || '',
      endereco: row.address || '',
      address: row.address || '',
      cep: row.zip_code || '',
      zip_code: row.zip_code || '',
      local: location,
      current_stage: row.current_stage || 'validation',
      current_status: status || 'pending_validation',
      stage: row.current_stage || 'validation',
      status: status || 'pending_validation',
      lead_channel: row.lead_channel || '',
      opportunity: row.opportunity || '',
      lead_score: row.lead_score,
      baseSource: 'Supabase validation'
    };
  }

  function patchFindLeadEverywhere() {
    if (window.findLeadEverywhere?.__rebuild618) return;

    const previous = window.findLeadEverywhere;
    const patched = function findLeadEverywhereRebuild618(id) {
      const key = String(id || '');
      if (runtimeLeadCache.has(key)) return runtimeLeadCache.get(key);
      return typeof previous === 'function' ? previous.apply(this, arguments) : null;
    };

    patched.__rebuild618 = true;
    patched.__previous = previous;
    window.findLeadEverywhere = patched;
  }

  function publishRuntimeLeads(rows) {
    runtimeLeadCache.clear();
    const normalized = rows.map(normalizeLeadForRuntime);
    normalized.forEach((lead) => runtimeLeadCache.set(String(lead.id), lead));
    window.rebuildValidationLeads = normalized;

    patchFindLeadEverywhere();

    try {
      if (typeof mergeLeadsIntoPermanentBase === 'function' && normalized.length) {
        mergeLeadsIntoPermanentBase(normalized, { source: 'Supabase validation' }, { schedule: false });
      }
    } catch (error) {
      console.warn('[rebuild618] falha ao publicar leads para ficha:', error);
    }
  }

  function getPendingRows() {
    return state.rows.filter((row) => row.current_status === 'pending_validation');
  }

  function getValidatedRows() {
    return state.rows.filter((row) => row.current_status === 'whatsapp_validated');
  }

  function getActiveRows() {
    return state.activeTab === 'validados' ? getValidatedRows() : getPendingRows();
  }

  function setBadgeText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = String(value);
  }

  function paintTab(tab, active) {
    const element = document.getElementById(tab === 'validados' ? 'valResultTabValidados' : 'valResultTabPendentes');
    if (!element) return;

    element.classList.toggle('active', active);
    element.style.borderColor = active ? 'var(--accent-border)' : 'var(--border2)';
    element.style.background = active ? 'var(--accent-dim)' : 'var(--bg)';
    element.style.color = active ? 'var(--accent)' : 'var(--muted)';
  }

  function renderCounters() {
    const pending = getPendingRows().length;
    const validated = getValidatedRows().length;

    setBadgeText('valCountSemZap', pending);
    setBadgeText('valCountComZap', validated);
    setBadgeText('badge-validacao', pending);

    paintTab('pendentes', state.activeTab === 'pendentes');
    paintTab('validados', state.activeTab === 'validados');
  }

  function renderPagination(total) {
    const target = document.getElementById('valPagination');
    if (!target) return;

    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    state.page = Math.max(1, Math.min(state.page, pages));

    if (pages <= 1) {
      target.innerHTML = '';
      return;
    }

    target.innerHTML = `
      <div class="btn-row" style="margin-top:12px;justify-content:flex-end">
        <button class="btn btn-ghost" type="button" style="font-size:10px;padding:6px 10px" ${state.page <= 1 ? 'disabled' : ''} onclick="goValidationPageRebuild618(${state.page - 1})">Anterior</button>
        <span style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted);padding:7px 4px">Pagina ${state.page} de ${pages}</span>
        <button class="btn btn-ghost" type="button" style="font-size:10px;padding:6px 10px" ${state.page >= pages ? 'disabled' : ''} onclick="goValidationPageRebuild618(${state.page + 1})">Proxima</button>
      </div>
    `;
  }

  function linkHtml(url, label) {
    if (!url) return `<span class="empresa-site">${esc(label)} -</span>`;
    return `<span class="empresa-site"><a href="${esc(url)}" target="_blank" rel="noopener">${esc(label)}</a></span>`;
  }

  function renderValidationLeadCard(row) {
    const lead = normalizeLeadForRuntime(row);
    const validated = row.current_status === 'whatsapp_validated';
    const siteLabel = row.website ? (row.has_own_site ? 'Site proprio' : text(row.website_type, 'Com site')) : 'Sem site';
    const siteClass = row.website ? (row.has_own_site ? 'info' : 'warn') : 'ok';
    const location = getStageLocation(row) || 'Local nao informado';
    const statusBadge = validated
      ? '<span class="q-badge ok">Numero validado</span>'
      : '<span class="q-badge warn">Aguardando validacao</span>';
    const approveButton = !validated
      ? `<button class="add-btn" type="button" data-validation-action-id="${esc(row.id)}" onclick="approveLeadWhatsappRebuild('${esc(row.id)}')">Aprovar</button>`
      : '';

    return `
      <div class="empresa-card" data-lead-id="${esc(row.id)}" style="align-items:flex-start">
        <div class="empresa-info">
          <div class="empresa-nome">${esc(lead.company_name)}</div>
          <div class="empresa-meta">
            <span class="q-badge info">Nota ${esc(numberText(row.rating))}</span>
            <span class="q-badge info">${esc(numberText(row.reviews_count, '0'))} avaliacoes</span>
            <span class="q-badge ${siteClass}">${esc(siteLabel)}</span>
            <span class="empresa-phone">${esc(normalizePhoneLabel(row.phone || row.normalized_phone))}</span>
            <span class="empresa-site">${esc(location)}</span>
          </div>
          <div class="empresa-meta" style="margin-top:7px">
            ${linkHtml(row.website, 'Site')}
            ${linkHtml(row.google_maps_url, 'Maps')}
            ${row.instagram_url ? linkHtml(row.instagram_url, 'Instagram') : ''}
          </div>
        </div>
        <div class="empresa-actions">
          ${statusBadge}
          <button class="add-btn" type="button" onclick="openValidationLeadDrawerRebuild('${esc(row.id)}')">Ficha</button>
          ${approveButton}
          <button class="add-btn" type="button" style="border-color:rgba(255,92,92,0.32);color:var(--error)" data-validation-action-id="${esc(row.id)}" onclick="rejectLeadValidationRebuild('${esc(row.id)}')">Reprovar</button>
        </div>
      </div>
    `;
  }

  function renderActiveValidationTab() {
    const list = document.getElementById('valComSiteList');
    if (!list) return;

    renderCounters();

    const rows = getActiveRows();
    const emptyText = state.activeTab === 'validados'
      ? '// nenhum numero validado ainda'
      : '// nenhum lead aguardando validacao';

    if (!rows.length) {
      list.innerHTML = `<div class="table-empty">${emptyText}</div>`;
      renderPagination(0);
      return;
    }

    const total = rows.length;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    state.page = Math.max(1, Math.min(state.page, pages));
    const start = (state.page - 1) * PAGE_SIZE;
    const pageRows = rows.slice(start, start + PAGE_SIZE);

    list.innerHTML = '<div class="ext-list">' + pageRows.map(renderValidationLeadCard).join('') + '</div>';
    renderPagination(total);
  }

  async function renderValidationStageFromSupabase() {
    const list = document.getElementById('valComSiteList');
    if (!list) return [];

    if (!state.rows.length) {
      list.innerHTML = '<div class="table-empty">Carregando leads da Validacao...</div>';
    }

    state.loading = true;

    try {
      const rows = await fetchValidationLeads();
      state.rows = rows.filter((row) => row.current_stage === 'validation');
      publishRuntimeLeads(state.rows);
      renderActiveValidationTab();
      return state.rows;
    } catch (error) {
      console.error('[rebuild618] erro ao carregar Validacao:', error);
      list.innerHTML = '<div class="table-empty">Erro ao carregar leads da Validacao.</div>';
      return [];
    } finally {
      state.loading = false;
    }
  }

  function setValidationResultTab(tab) {
    state.activeTab = tab === 'validados' ? 'validados' : 'pendentes';
    state.page = 1;
    renderActiveValidationTab();
  }

  function setActionButtonsDisabled(leadId, disabled) {
    document.querySelectorAll('[data-validation-action-id]').forEach((button) => {
      if (button.getAttribute('data-validation-action-id') === String(leadId)) {
        button.disabled = disabled;
      }
    });
  }

  async function approveLeadWhatsappRebuild(leadId) {
    setActionButtonsDisabled(leadId, true);

    try {
      await rpcValidationAction(leadId, 'approve_whatsapp', null);

      const row = state.rows.find((item) => String(item.id) === String(leadId));
      if (row) {
        row.current_status = 'whatsapp_validated';
        row.whatsapp_status = 'valid';
      }

      if (typeof notify === 'function') notify('WhatsApp aprovado.');
      state.activeTab = 'validados';
      state.page = 1;
      renderActiveValidationTab();
      await renderValidationStageFromSupabase();
    } catch (error) {
      console.error('[rebuild618] erro ao aprovar lead:', error);
      if (typeof notify === 'function') notify(error?.message || 'Falha ao aprovar WhatsApp.', 'err');
    } finally {
      setActionButtonsDisabled(leadId, false);
    }
  }

  async function rejectLeadValidationRebuild(leadId) {
    const reason = prompt('Motivo da reprovacao:', 'Numero invalido');
    if (reason === null) return;

    setActionButtonsDisabled(leadId, true);

    try {
      await rpcValidationAction(leadId, 'reject_validation', reason || 'Reprovado manualmente');
      state.rows = state.rows.filter((item) => String(item.id) !== String(leadId));

      if (typeof notify === 'function') notify('Lead reprovado na validacao.');
      renderActiveValidationTab();
      await renderValidationStageFromSupabase();
    } catch (error) {
      console.error('[rebuild618] erro ao reprovar lead:', error);
      if (typeof notify === 'function') notify(error?.message || 'Falha ao reprovar lead.', 'err');
    } finally {
      setActionButtonsDisabled(leadId, false);
    }
  }

  function openValidationLeadDrawerRebuild(leadId) {
    patchFindLeadEverywhere();

    if (typeof window.openLeadDrawer === 'function') {
      window.openLeadDrawer(leadId);
      return;
    }

    if (typeof notify === 'function') notify('Ficha do lead indisponivel.', 'warn');
  }

  function installHooks() {
    const oldRenderValidacao = window.renderValidacao;
    window.renderValidacao = function renderValidacaoRebuild618() {
      return renderValidationStageFromSupabase();
    };
    window.renderValidacao.__previous = oldRenderValidacao;

    const oldSetValResultTab = window.setValResultTab;
    window.setValResultTab = function setValResultTabRebuild618(tab) {
      if (tab === 'validados' || tab === 'pendentes') {
        setValidationResultTab(tab);
        return;
      }
      if (typeof oldSetValResultTab === 'function') return oldSetValResultTab.apply(this, arguments);
    };

    const oldSwitchPanel = window.switchPanel;
    if (typeof oldSwitchPanel === 'function' && !oldSwitchPanel.__rebuild618) {
      const patchedSwitchPanel = function switchPanelRebuild618(panel) {
        const result = oldSwitchPanel.apply(this, arguments);
        const normalized = panel === 'validation' || panel === 'panel-validacao' ? 'validacao' : panel;
        if (normalized === 'validacao') setTimeout(renderValidationStageFromSupabase, 80);
        return result;
      };
      patchedSwitchPanel.__rebuild618 = true;
      patchedSwitchPanel.__previous = oldSwitchPanel;
      window.switchPanel = patchedSwitchPanel;
    }

    const oldUpdateBadges = window.updateBadges;
    if (typeof oldUpdateBadges === 'function' && !oldUpdateBadges.__rebuild618) {
      const patchedUpdateBadges = function updateBadgesRebuild618() {
        const result = oldUpdateBadges.apply(this, arguments);
        renderCounters();
        return result;
      };
      patchedUpdateBadges.__rebuild618 = true;
      patchedUpdateBadges.__previous = oldUpdateBadges;
      window.updateBadges = patchedUpdateBadges;
    }

    const oldImportarLeads = window.importarLeads;
    if (typeof oldImportarLeads === 'function' && !oldImportarLeads.__validationRefresh618) {
      const patchedImportarLeads = async function importarLeadsValidationRefresh618() {
        const result = await oldImportarLeads.apply(this, arguments);
        setTimeout(renderValidationStageFromSupabase, 200);
        return result;
      };
      patchedImportarLeads.__validationRefresh618 = true;
      patchedImportarLeads.__previous = oldImportarLeads;
      window.importarLeads = patchedImportarLeads;
    }
  }

  function boot() {
    installHooks();
    patchFindLeadEverywhere();

    const waitTab = document.getElementById('valResultTabPendentes');
    const validTab = document.getElementById('valResultTabValidados');
    if (waitTab) waitTab.onclick = () => setValidationResultTab('pendentes');
    if (validTab) validTab.onclick = () => setValidationResultTab('validados');

    renderCounters();

    if (document.getElementById('panel-validacao')?.classList.contains('active')) {
      renderValidationStageFromSupabase();
    }
  }

  window.renderValidationStageFromSupabase = renderValidationStageFromSupabase;
  window.openValidationLeadDrawerRebuild = openValidationLeadDrawerRebuild;
  window.approveLeadWhatsappRebuild = approveLeadWhatsappRebuild;
  window.rejectLeadValidationRebuild = rejectLeadValidationRebuild;
  window.showValidationWaiting = () => setValidationResultTab('pendentes');
  window.showValidationValidated = () => setValidationResultTab('validados');
  window.goValidationPageRebuild618 = (page) => {
    state.page = Number(page) || 1;
    renderActiveValidationTab();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

/* CRM Rebuild Fase 6.19 - Atribuicao lendo Supabase */
(function () {
  const SUPABASE_URL = 'https://txyknazfufashgzlxkqh.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_ClGVAmaiS4tNWe8W_4EPew_aPvAzK0E';
  const PAGE_SIZE = 30;

  const state = {
    rows: [],
    activeTab: 'zap',
    page: 1,
    loading: false
  };

  const assignmentLeadCache = new Map();

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[char]));
  }

  function clean(value, fallback = '') {
    const text = String(value ?? '').trim();
    return text || fallback;
  }

  function digits(value) {
    return clean(value).replace(/\D+/g, '');
  }

  function hasUsefulPhone(row) {
    return digits(row.phone || row.normalized_phone).length >= 10;
  }

  function hasOwnSite(row) {
    return !!row.has_own_site && !!clean(row.website);
  }

  function isReadyForAssignment(row) {
    return row.current_stage === 'validation' && row.current_status === 'whatsapp_validated';
  }

  function isInAssignment(row) {
    return row.current_stage === 'assignment';
  }

  function bucketFor(row) {
    if (!hasUsefulPhone(row) && clean(row.instagram_url)) return 'insta';
    if (hasUsefulPhone(row) && hasOwnSite(row)) return 'com-site';
    if (hasUsefulPhone(row)) return 'zap';
    return clean(row.instagram_url) ? 'insta' : 'zap';
  }

  async function getCurrentUserId() {
    try {
      if (typeof getCurrentSupabaseUserIdV412 === 'function') {
        const maybe = await getCurrentSupabaseUserIdV412();
        if (maybe) return maybe;
      }
    } catch (_) {}

    if (window.currentUser?.id) return window.currentUser.id;

    try {
      if (typeof currentUser !== 'undefined' && currentUser?.id) return currentUser.id;
    } catch (_) {}

    return null;
  }

  async function getHeaders(content = false) {
    let headers = null;

    try {
      if (typeof getSupabaseAuthHeadersV423 === 'function') {
        headers = await getSupabaseAuthHeadersV423();
      }
    } catch (_) {}

    if (!headers?.apikey) {
      headers = {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`
      };
    }

    return content ? { ...headers, 'Content-Type': 'application/json' } : headers;
  }

  async function readJson(response) {
    const textBody = await response.text();
    return textBody ? JSON.parse(textBody) : null;
  }

  async function fetchLeadCardsBy(paramsObject) {
    const userId = await getCurrentUserId();
    const params = new URLSearchParams({
      select: '*',
      order: 'created_at.desc',
      ...paramsObject
    });

    if (userId) params.set('user_id', `eq.${userId}`);

    const response = await fetch(`${SUPABASE_URL}/rest/v1/v_lead_cards_persistent?${params.toString()}`, {
      headers: await getHeaders()
    });
    const data = await readJson(response);

    if (!response.ok) throw data || new Error(`Falha ao carregar Atribuicao (${response.status}).`);
    return Array.isArray(data) ? data : [];
  }

  async function fetchAssignmentRows() {
    const [ready, assigned] = await Promise.all([
      fetchLeadCardsBy({
        current_stage: 'eq.validation',
        current_status: 'eq.whatsapp_validated'
      }),
      fetchLeadCardsBy({
        current_stage: 'eq.assignment'
      })
    ]);

    const byId = new Map();
    [...ready, ...assigned].forEach((row) => {
      if (row?.id && !byId.has(String(row.id))) byId.set(String(row.id), row);
    });

    return [...byId.values()];
  }

  async function rpcAssignmentAction(leadId, action = 'send_to_assignment', bucket = null) {
    const userId = await getCurrentUserId();
    if (!userId) throw new Error('Usuario autenticado nao encontrado.');

    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rpc_assignment_lead_action`, {
      method: 'POST',
      headers: await getHeaders(true),
      body: JSON.stringify({
        p_user_id: userId,
        p_lead_id: leadId,
        p_action: action,
        p_bucket: bucket
      })
    });
    const data = await readJson(response);

    if (!response.ok) throw data || new Error(`Falha na acao de atribuicao (${response.status}).`);
    return data;
  }

  function normalizeLeadForDrawer(row = {}) {
    const companyName = row.company_name || 'Empresa sem nome';
    const location = [row.city, row.state_code || row.state].filter(Boolean).join(' - ');

    return {
      ...row,
      id: row.id,
      lead_id: row.id,
      nome: companyName,
      empresa: companyName,
      name: companyName,
      company_name: companyName,
      categoria: row.category || '',
      category: row.category || '',
      descricao: row.description || '',
      description: row.description || '',
      rating: row.rating,
      reviews_count: row.reviews_count,
      whatsapp: row.phone || '',
      telefone: row.phone || '',
      phone: row.phone || '',
      normalized_phone: row.normalized_phone || '',
      whatsapp_status: row.whatsapp_status || '',
      whatsappValidationStatus: row.current_status === 'whatsapp_validated' || row.whatsapp_status === 'valid' ? 'valid' : '',
      numStatus: row.current_status === 'whatsapp_validated' || row.whatsapp_status === 'valid' ? 'valido' : '',
      site: row.website || '',
      website: row.website || '',
      hasOwnSite: !!row.has_own_site,
      has_own_site: !!row.has_own_site,
      instagram: row.instagram_url || '',
      instagram_url: row.instagram_url || '',
      googleUrl: row.google_maps_url || '',
      google_maps_url: row.google_maps_url || '',
      maps: row.google_maps_url || '',
      local: location,
      cidade: row.city || '',
      city: row.city || '',
      estado: row.state || '',
      state: row.state || '',
      uf: row.state_code || '',
      state_code: row.state_code || '',
      current_stage: row.current_stage || '',
      current_status: row.current_status || '',
      stage: row.current_stage || '',
      status: row.current_status || '',
      assignmentBucket: bucketFor(row),
      baseSource: 'Supabase assignment'
    };
  }

  function patchFindLeadEverywhere() {
    if (window.findLeadEverywhere?.__assignment619) return;

    const previous = window.findLeadEverywhere;
    const patched = function findLeadEverywhereAssignment619(id) {
      const key = String(id || '');
      if (assignmentLeadCache.has(key)) return assignmentLeadCache.get(key);
      return typeof previous === 'function' ? previous.apply(this, arguments) : null;
    };

    patched.__assignment619 = true;
    patched.__previous = previous;
    window.findLeadEverywhere = patched;
  }

  function publishRows(rows) {
    assignmentLeadCache.clear();
    rows.map(normalizeLeadForDrawer).forEach((lead) => assignmentLeadCache.set(String(lead.id), lead));
    window.rebuildAssignmentLeads = [...assignmentLeadCache.values()];
    patchFindLeadEverywhere();
  }

  function getActiveTab() {
    try {
      if (typeof atribActiveTab !== 'undefined') return atribActiveTab || state.activeTab;
    } catch (_) {}
    return state.activeTab;
  }

  function setActiveTab(tab) {
    state.activeTab = ['zap', 'insta', 'com-site'].includes(tab) ? tab : 'zap';
    try {
      if (typeof atribActiveTab !== 'undefined') atribActiveTab = state.activeTab;
    } catch (_) {}
  }

  function rowsForBucket(bucket) {
    return state.rows.filter((row) => bucketFor(row) === bucket);
  }

  function renderCounts() {
    const zap = rowsForBucket('zap').length;
    const site = rowsForBucket('com-site').length;
    const insta = rowsForBucket('insta').length;
    const total = state.rows.length;

    const set = (id, value) => {
      const element = document.getElementById(id);
      if (element) element.textContent = value ? `(${value})` : '';
    };

    set('atribTabZapCount', zap);
    set('atribTabComSiteCount', site);
    set('atribTabInstaCount', insta);

    const totalBadge = document.getElementById('atribTotalBadge');
    if (totalBadge) totalBadge.textContent = total ? `(${total} lead${total !== 1 ? 's' : ''})` : '';

    const sidebarBadge = document.getElementById('badge-atribuicao');
    if (sidebarBadge) sidebarBadge.textContent = String(total);
  }

  function paintAssignmentTabs() {
    const active = getActiveTab();
    const tabZap = document.getElementById('atribTabZap');
    const tabInsta = document.getElementById('atribTabInsta');
    const tabSite = document.getElementById('atribTabComSite');
    const panelZap = document.getElementById('atribPanelZap');
    const panelInsta = document.getElementById('atribPanelInsta');

    [tabZap, tabInsta, tabSite].forEach((button) => {
      if (!button) return;
      button.style.borderBottomColor = 'transparent';
      button.style.color = 'var(--muted)';
    });

    if (active === 'insta') {
      if (tabInsta) {
        tabInsta.style.borderBottomColor = 'var(--insta)';
        tabInsta.style.color = 'var(--insta)';
      }
      if (panelInsta) panelInsta.style.display = 'flex';
      if (panelZap) panelZap.style.display = 'none';
    } else {
      const button = active === 'com-site' ? tabSite : tabZap;
      if (button) {
        button.style.borderBottomColor = 'var(--accent)';
        button.style.color = 'var(--accent)';
      }
      if (panelZap) panelZap.style.display = 'flex';
      if (panelInsta) panelInsta.style.display = 'none';
    }
  }

  function link(url, label) {
    if (!url) return '';
    return `<a href="${esc(url)}" target="_blank" rel="noopener" class="add-btn">${esc(label)}</a>`;
  }

  function rowStatusBadge(row) {
    if (isInAssignment(row)) return '<span class="q-badge ok">Na atribuicao</span>';
    if (isReadyForAssignment(row)) return '<span class="q-badge info">Validado</span>';
    return `<span class="q-badge warn">${esc(row.current_status || 'pendente')}</span>`;
  }

  function renderAssignmentCard(row) {
    const bucket = bucketFor(row);
    const title = row.company_name || 'Empresa sem nome';
    const location = [row.city, row.state_code || row.state].filter(Boolean).join(' - ') || 'Local nao informado';
    const phone = row.phone || row.normalized_phone || '';
    const moveButton = isReadyForAssignment(row)
      ? `<button class="add-btn added" type="button" data-assignment-action-id="${esc(row.id)}" onclick="sendLeadToAssignmentRebuild619('${esc(row.id)}')">Mover para Atribuicao</button>`
      : '<span class="q-badge warn">Chip na 6.20</span>';
    const bucketLabel = bucket === 'com-site' ? 'Com site' : bucket === 'insta' ? 'Instagram' : 'WhatsApp sem site';

    return `
      <div class="empresa-card" data-lead-id="${esc(row.id)}" style="align-items:flex-start">
        <div class="empresa-info">
          <div class="empresa-nome">${esc(title)}</div>
          <div class="empresa-meta">
            ${rowStatusBadge(row)}
            <span class="q-badge ${bucket === 'insta' ? 'insta' : bucket === 'com-site' ? 'info' : 'ok'}">${esc(bucketLabel)}</span>
            <span class="q-badge info">Nota ${esc(row.rating ?? '-')}</span>
            <span class="q-badge info">${esc(row.reviews_count ?? 0)} avaliacoes</span>
            <span class="empresa-phone">${esc(phone || 'Sem telefone')}</span>
            <span class="empresa-site">${esc(location)}</span>
          </div>
          <div class="empresa-meta" style="margin-top:7px">
            ${link(row.website, 'Site')}
            ${link(row.instagram_url, 'Instagram')}
            ${link(row.google_maps_url, 'Maps')}
          </div>
        </div>
        <div class="empresa-actions">
          <button class="add-btn" type="button" onclick="openAssignmentLeadDrawerRebuild619('${esc(row.id)}')">Ficha</button>
          ${moveButton}
        </div>
      </div>
    `;
  }

  function renderPagination(total, targetId) {
    const target = document.getElementById(targetId);
    if (!target) return;

    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    state.page = Math.max(1, Math.min(state.page, pages));

    if (pages <= 1) {
      target.innerHTML = '';
      return;
    }

    target.innerHTML = `
      <div class="btn-row" style="margin-top:12px;justify-content:flex-end">
        <button class="btn btn-ghost" type="button" style="font-size:10px;padding:6px 10px" ${state.page <= 1 ? 'disabled' : ''} onclick="goAssignmentPageRebuild619(${state.page - 1})">Anterior</button>
        <span style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted);padding:7px 4px">Pagina ${state.page} de ${pages}</span>
        <button class="btn btn-ghost" type="button" style="font-size:10px;padding:6px 10px" ${state.page >= pages ? 'disabled' : ''} onclick="goAssignmentPageRebuild619(${state.page + 1})">Proxima</button>
      </div>
    `;
  }

  function renderAssignmentList() {
    paintAssignmentTabs();
    renderCounts();

    const active = getActiveTab();
    const targetId = active === 'insta' ? 'atribInstaList' : 'atribList';
    const paginationId = active === 'insta' ? 'atribInstaPagination' : 'atribPagination';
    const target = document.getElementById(targetId);
    if (!target) return;

    let rows = rowsForBucket(active);
    const searchId = active === 'insta' ? 'atribInstaBusca' : 'atribBusca';
    const query = clean(document.getElementById(searchId)?.value).toLowerCase();

    if (query) {
      rows = rows.filter((row) => [
        row.company_name,
        row.phone,
        row.website,
        row.instagram_url,
        row.city,
        row.category
      ].some((value) => clean(value).toLowerCase().includes(query)));
    }

    if (!rows.length) {
      target.innerHTML = '<div class="table-empty">// nenhum lead aguardando atribuicao nesta aba</div>';
      renderPagination(0, paginationId);
      return;
    }

    const total = rows.length;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    state.page = Math.max(1, Math.min(state.page, pages));
    const start = (state.page - 1) * PAGE_SIZE;
    const pageRows = rows.slice(start, start + PAGE_SIZE);

    target.innerHTML = '<div class="ext-list">' + pageRows.map(renderAssignmentCard).join('') + '</div>';
    renderPagination(total, paginationId);
  }

  async function renderAssignmentStageFromSupabase() {
    const active = getActiveTab();
    const target = document.getElementById(active === 'insta' ? 'atribInstaList' : 'atribList');
    if (target && !state.rows.length) {
      target.innerHTML = '<div class="table-empty">Carregando leads da Atribuicao...</div>';
    }

    state.loading = true;

    try {
      state.rows = await fetchAssignmentRows();
      publishRows(state.rows);
      renderAssignmentList();
      return state.rows;
    } catch (error) {
      console.error('[rebuild619] erro ao carregar Atribuicao:', error);
      if (target) target.innerHTML = '<div class="table-empty">Erro ao carregar Atribuicao. Verifique o SQL 6.19.</div>';
      return [];
    } finally {
      state.loading = false;
    }
  }

  function setAssignmentButtonsDisabled(leadId, disabled) {
    document.querySelectorAll('[data-assignment-action-id]').forEach((button) => {
      if (button.getAttribute('data-assignment-action-id') === String(leadId)) button.disabled = disabled;
    });
  }

  async function sendLeadToAssignment(leadId) {
    const row = state.rows.find((item) => String(item.id) === String(leadId));
    const bucket = row ? bucketFor(row) : null;
    setAssignmentButtonsDisabled(leadId, true);

    try {
      await rpcAssignmentAction(leadId, 'send_to_assignment', bucket);
      if (row) {
        row.current_stage = 'assignment';
        row.current_status = 'pending_assignment';
      }
      if (typeof notify === 'function') notify('Lead movido para Atribuicao.');
      renderAssignmentList();
      await renderAssignmentStageFromSupabase();
      if (typeof renderValidationStageFromSupabase === 'function') renderValidationStageFromSupabase();
    } catch (error) {
      console.error('[rebuild619] erro ao mover para atribuicao:', error);
      if (typeof notify === 'function') notify(error?.message || 'Falha ao mover lead para Atribuicao.', 'err');
    } finally {
      setAssignmentButtonsDisabled(leadId, false);
    }
  }

  async function sendAllValidatedToAssignment() {
    if (!state.rows.length) await renderAssignmentStageFromSupabase();
    const ready = state.rows.filter(isReadyForAssignment);

    if (!ready.length) {
      if (typeof notify === 'function') notify('// nenhum lead validado pronto para atribuicao', 'warn');
      return;
    }

    let moved = 0;
    for (const row of ready) {
      try {
        await rpcAssignmentAction(row.id, 'send_to_assignment', bucketFor(row));
        row.current_stage = 'assignment';
        row.current_status = 'pending_assignment';
        moved++;
      } catch (error) {
        console.warn('[rebuild619] falha ao mover lead em lote:', row.id, error);
      }
    }

    if (typeof notify === 'function') notify(`${moved} lead${moved !== 1 ? 's' : ''} movido${moved !== 1 ? 's' : ''} para Atribuicao.`);
    await renderAssignmentStageFromSupabase();
    if (typeof renderValidationStageFromSupabase === 'function') renderValidationStageFromSupabase();
  }

  function openAssignmentLeadDrawer(leadId) {
    patchFindLeadEverywhere();

    if (typeof window.openLeadDrawer === 'function') {
      window.openLeadDrawer(leadId);
      return;
    }

    if (typeof notify === 'function') notify('Ficha do lead indisponivel.', 'warn');
  }

  function installHooks() {
    window.renderAtribuicao = function renderAtribuicaoRebuild619() {
      return renderAssignmentStageFromSupabase();
    };

    window.renderAtribInstaFila = function renderAtribInstaFilaRebuild619() {
      setActiveTab('insta');
      return renderAssignmentStageFromSupabase();
    };

    window.updateAtribTabCounts = renderCounts;

    window.setAtribTab = function setAtribTabRebuild619(tab) {
      setActiveTab(tab);
      state.page = 1;
      renderAssignmentList();
      if (!state.rows.length) renderAssignmentStageFromSupabase();
    };

    window.aprovarTodosParaAtribuicao = sendAllValidatedToAssignment;

    const oldSwitchPanel = window.switchPanel;
    if (typeof oldSwitchPanel === 'function' && !oldSwitchPanel.__assignment619) {
      const patchedSwitchPanel = function switchPanelAssignment619(panel) {
        const result = oldSwitchPanel.apply(this, arguments);
        if (panel === 'atribuicao' || panel === 'assignment' || panel === 'panel-atribuicao') {
          setTimeout(renderAssignmentStageFromSupabase, 80);
        }
        return result;
      };
      patchedSwitchPanel.__assignment619 = true;
      patchedSwitchPanel.__previous = oldSwitchPanel;
      window.switchPanel = patchedSwitchPanel;
    }
  }

  window.renderAssignmentStageFromSupabase = renderAssignmentStageFromSupabase;
  window.sendLeadToAssignmentRebuild619 = sendLeadToAssignment;
  window.openAssignmentLeadDrawerRebuild619 = openAssignmentLeadDrawer;
  window.goAssignmentPageRebuild619 = (page) => {
    state.page = Number(page) || 1;
    renderAssignmentList();
  };

  function boot() {
    installHooks();
    patchFindLeadEverywhere();
    renderCounts();

    if (document.getElementById('panel-atribuicao')?.classList.contains('active')) {
      renderAssignmentStageFromSupabase();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
