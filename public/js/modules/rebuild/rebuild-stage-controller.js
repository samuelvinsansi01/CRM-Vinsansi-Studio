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
