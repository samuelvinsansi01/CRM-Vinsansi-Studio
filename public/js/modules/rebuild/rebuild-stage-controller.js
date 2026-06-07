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
    const validateButton = !validated
      ? `<button class="add-btn added" type="button" data-validation-chip-action-id="${esc(row.id)}" onclick="validarNumeroUnico('${esc(row.id)}')">Validar</button>`
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
          ${validateButton}
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

/* CRM Rebuild Fase 6.22 - Lotes de disparo persistentes */
(function () {
  const SUPABASE_URL = 'https://txyknazfufashgzlxkqh.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_ClGVAmaiS4tNWe8W_4EPew_aPvAzK0E';

  const state = {
    batches: [],
    loading: false
  };

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
      if (typeof getSupabaseAuthHeadersV423 === 'function') headers = await getSupabaseAuthHeadersV423();
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
    const body = await response.text();
    return body ? JSON.parse(body) : null;
  }

  async function fetchBatches() {
    const userId = await getCurrentUserId();
    if (!userId) return [];

    const params = new URLSearchParams({
      select: 'id,lead_id,position,data,updated_at',
      user_id: `eq.${userId}`,
      queue_type: 'eq.whatsapp_batch',
      order: 'position.asc'
    });

    const response = await fetch(`${SUPABASE_URL}/rest/v1/crm_queue_items?${params.toString()}`, {
      headers: await getHeaders()
    });
    const data = await readJson(response);
    if (!response.ok) throw data || new Error(`Falha ao carregar lotes (${response.status}).`);
    return Array.isArray(data) ? data : [];
  }

  async function rpcBatchAction(action, batchId = null) {
    const userId = await getCurrentUserId();
    if (!userId) throw new Error('Usuario autenticado nao encontrado.');

    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rpc_dispatch_batch_action`, {
      method: 'POST',
      headers: await getHeaders(true),
      body: JSON.stringify({
        p_user_id: userId,
        p_action: action,
        p_batch_id: batchId,
        p_payload: { source: 'fase-6.22' }
      })
    });
    const data = await readJson(response);
    if (!response.ok) throw data || new Error(`Falha na acao de lote (${response.status}).`);
    return data;
  }

  function normalizeBatch(row = {}) {
    const data = row.data || {};
    const items = Array.isArray(data.items) ? data.items : [];
    return {
      id: row.lead_id || data.batch_id || row.id,
      rowId: row.id,
      position: row.position || 0,
      status: data.status || 'ready',
      chipId: data.chip_id || '',
      chipName: data.chip_name || data.chip_id || 'Chip',
      batchIndex: data.batch_index || row.position || 1,
      itemCount: Number(data.item_count || items.length || 0),
      items,
      createdAt: data.created_at || row.updated_at || '',
      startedAt: data.started_at || '',
      completedAt: data.completed_at || ''
    };
  }

  function statusLabel(status) {
    if (status === 'sending') return 'Em disparo';
    if (status === 'completed') return 'Concluido';
    return 'Pronto';
  }

  function statusClass(status) {
    if (status === 'completed') return 'ok';
    if (status === 'sending') return 'info';
    return 'warn';
  }

  function batchCard(batch) {
    const actions = batch.status === 'completed'
      ? '<span class="q-badge ok">Lote concluido</span>'
      : batch.status === 'sending'
        ? `<button class="add-btn added" type="button" data-batch622-id="${esc(batch.id)}" onclick="completeDispatchBatchRebuild622('${esc(batch.id)}')">Concluir lote</button>`
        : `<button class="add-btn added" type="button" data-batch622-id="${esc(batch.id)}" onclick="startDispatchBatchRebuild622('${esc(batch.id)}')">Iniciar lote</button>`;

    return `
      <div style="border:1px solid var(--border);border-radius:8px;background:var(--surface2);padding:10px 12px;margin-bottom:8px">
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:7px">
          <div style="font-size:11px;font-weight:700;color:var(--text);flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
            Lote ${esc(batch.batchIndex)} - ${esc(batch.chipName)}
          </div>
          <span class="q-badge ${statusClass(batch.status)}">${esc(statusLabel(batch.status))}</span>
        </div>
        <div style="font-family:'DM Mono',monospace;font-size:8px;color:var(--muted);display:flex;gap:7px;flex-wrap:wrap;margin-bottom:8px">
          <span>${esc(batch.itemCount)} leads</span>
          <span>ID ${esc(batch.id)}</span>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
          ${actions}
        </div>
      </div>
    `;
  }

  function renderBatchPanel() {
    const right = document.getElementById('zapRight');
    if (!right) return;

    const oldPanel = document.getElementById('dispatchBatchesPanel622');
    if (oldPanel) oldPanel.remove();

    const batches = state.batches.map(normalizeBatch);
    const ready = batches.filter((batch) => batch.status === 'ready').length;
    const sending = batches.filter((batch) => batch.status === 'sending').length;
    const completed = batches.filter((batch) => batch.status === 'completed').length;

    const panel = document.createElement('div');
    panel.id = 'dispatchBatchesPanel622';
    panel.style.cssText = 'border-bottom:1px solid var(--border);padding:12px 14px;background:rgba(255,255,255,0.015);flex-shrink:0';
    panel.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
        <div style="font-family:'DM Mono',monospace;font-size:9px;letter-spacing:0.12em;color:var(--accent);text-transform:uppercase;font-weight:700">Lotes de disparo</div>
        <span style="font-family:'DM Mono',monospace;font-size:8px;color:var(--muted);margin-left:auto">${ready} pronto(s) / ${sending} em disparo / ${completed} concluido(s)</span>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">
        <button class="btn btn-primary" type="button" style="font-size:10px;padding:7px 12px" onclick="generateDispatchBatchesRebuild622()">Gerar lotes</button>
        <button class="btn btn-ghost" type="button" style="font-size:10px;padding:7px 12px" onclick="refreshDispatchBatchesRebuild622()">Atualizar lotes</button>
      </div>
      <div>
        ${batches.length ? batches.map(batchCard).join('') : '<div class="fila-empty">// nenhum lote gerado ainda.</div>'}
      </div>
    `;

    right.prepend(panel);
  }

  function enhanceQueueControls() {
    const statusTabs = document.getElementById('disparoStatusTabs');
    if (!statusTabs || document.getElementById('generateBatchesBtn622')) return;
    const button = document.createElement('button');
    button.id = 'generateBatchesBtn622';
    button.className = 'btn btn-ghost';
    button.type = 'button';
    button.style.cssText = 'font-size:10px;padding:7px 12px';
    button.textContent = 'Gerar lotes';
    button.onclick = () => generateBatches();
    statusTabs.appendChild(button);
  }

  async function refreshBatches() {
    state.loading = true;
    try {
      state.batches = await fetchBatches();
      enhanceQueueControls();
      renderBatchPanel();
      return state.batches;
    } catch (error) {
      console.error('[rebuild622] erro ao carregar lotes:', error);
      return [];
    } finally {
      state.loading = false;
    }
  }

  function setBatchButtonsDisabled(batchId, disabled) {
    document.querySelectorAll('[data-batch622-id]').forEach((button) => {
      if (button.getAttribute('data-batch622-id') === String(batchId)) button.disabled = disabled;
    });
  }

  async function generateBatches() {
    try {
      const result = await rpcBatchAction('generate_batches');
      if (typeof notify === 'function') notify(`${result?.batches_created || 0} lote(s) gerado(s).`);
      if (typeof window.renderQueueStageFromSupabase621 === 'function') await window.renderQueueStageFromSupabase621();
      await refreshBatches();
    } catch (error) {
      console.error('[rebuild622] erro ao gerar lotes:', error);
      if (typeof notify === 'function') notify(error?.message || 'Falha ao gerar lotes. Verifique o SQL 6.22.', 'err');
    }
  }

  async function startBatch(batchId) {
    setBatchButtonsDisabled(batchId, true);
    try {
      await rpcBatchAction('start_batch', batchId);
      if (typeof notify === 'function') notify('Lote iniciado.');
      await refreshBatches();
    } catch (error) {
      console.error('[rebuild622] erro ao iniciar lote:', error);
      if (typeof notify === 'function') notify(error?.message || 'Falha ao iniciar lote.', 'err');
    } finally {
      setBatchButtonsDisabled(batchId, false);
    }
  }

  async function completeBatch(batchId) {
    setBatchButtonsDisabled(batchId, true);
    try {
      await rpcBatchAction('complete_batch', batchId);
      if (typeof notify === 'function') notify('Lote concluido.');
      await refreshBatches();
    } catch (error) {
      console.error('[rebuild622] erro ao concluir lote:', error);
      if (typeof notify === 'function') notify(error?.message || 'Falha ao concluir lote.', 'err');
    } finally {
      setBatchButtonsDisabled(batchId, false);
    }
  }

  function installHooks() {
    window.generateDispatchBatchesRebuild622 = generateBatches;
    window.refreshDispatchBatchesRebuild622 = refreshBatches;
    window.startDispatchBatchRebuild622 = startBatch;
    window.completeDispatchBatchRebuild622 = completeBatch;

    const previousRenderQueue = window.renderQueueStageFromSupabase621;
    if (typeof previousRenderQueue === 'function' && !previousRenderQueue.__batches622) {
      const patched = async function renderQueueStageBatches622() {
        const result = await previousRenderQueue.apply(this, arguments);
        await refreshBatches();
        return result;
      };
      patched.__batches622 = true;
      patched.__previous = previousRenderQueue;
      window.renderQueueStageFromSupabase621 = patched;
      window.renderFilaZap = patched;
    }

    const previousSetQueueTab = window.setQueueTabRebuild621;
    if (typeof previousSetQueueTab === 'function' && !previousSetQueueTab.__batches622) {
      const patchedSetTab = function setQueueTabBatches622() {
        const result = previousSetQueueTab.apply(this, arguments);
        setTimeout(refreshBatches, 120);
        return result;
      };
      patchedSetTab.__batches622 = true;
      patchedSetTab.__previous = previousSetQueueTab;
      window.setQueueTabRebuild621 = patchedSetTab;
    }

    const previousSwitchPanel = window.switchPanel;
    if (typeof previousSwitchPanel === 'function' && !previousSwitchPanel.__batches622) {
      const patchedSwitchPanel = function switchPanelBatches622(panel) {
        const result = previousSwitchPanel.apply(this, arguments);
        if (panel === 'fila-zap' || panel === 'whatsapp' || panel === 'panel-fila-zap') {
          setTimeout(refreshBatches, 180);
        }
        return result;
      };
      patchedSwitchPanel.__batches622 = true;
      patchedSwitchPanel.__previous = previousSwitchPanel;
      window.switchPanel = patchedSwitchPanel;
    }
  }

  function boot() {
    installHooks();
    let attempts = 0;
    const retry = () => {
      attempts++;
      installHooks();
      if (!window.renderQueueStageFromSupabase621?.__batches622 && attempts < 12) setTimeout(retry, 120);
    };
    if (!window.renderQueueStageFromSupabase621?.__batches622) setTimeout(retry, 120);

    if (document.getElementById('panel-fila-zap')?.classList.contains('active')) {
      refreshBatches();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

/* CRM Rebuild Fase 6.25 - Chips na Validacao WhatsApp */
(function () {
  const SUPABASE_URL = 'https://txyknazfufashgzlxkqh.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_ClGVAmaiS4tNWe8W_4EPew_aPvAzK0E';

  const state = {
    chips: [],
    activeChipId: '',
    validating: false
  };

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

  function notifyUser(message, type = '') {
    if (typeof notify === 'function') notify(message, type);
  }

  function normalizeEvolutionUrl(value = '') {
    return clean(value).replace(/\/+$/, '');
  }

  function normalizeChip(row = {}) {
    const instance = clean(row.instance || row.instance_name || row.instanceName || row.name);
    const name = clean(row.name || row.nome || row.label || row.phone || instance, 'Chip');
    const id = clean(row.chip_id || row.chipId || row.id || instance, name);
    const url = normalizeEvolutionUrl(row.url || row.base_url || row.baseUrl || row.evolution_url || row.evolutionUrl);
    const key = clean(row.api_key || row.apiKey || row.key || row.apikey || row.token);

    return {
      ...row,
      id: String(id),
      chip_id: String(id),
      dbId: row.dbId || row.id || null,
      name,
      nome: name,
      label: name,
      instance,
      instance_name: instance,
      url,
      baseUrl: url,
      evolutionUrl: url,
      key,
      apiKey: key,
      api_key: key,
      status: row.active === false ? 'disabled' : clean(row.status || row.connection_state || row.connectionState, 'saved'),
      active: row.active !== false
    };
  }

  function dedupeChips(chips = []) {
    const map = new Map();
    chips.map(normalizeChip).forEach((chip) => {
      if (!chip.id && !chip.instance) return;
      const key = chip.id || chip.instance;
      const existing = map.get(key) || {};
      map.set(key, { ...existing, ...chip });
    });
    return [...map.values()].filter((chip) => chip.active !== false && chip.status !== 'disabled' && chip.url && chip.instance && chip.key);
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
    let headers = {};
    try {
      if (typeof getSupabaseAuthHeadersV423 === 'function') headers = await getSupabaseAuthHeadersV423();
    } catch (_) {}
    headers = { ...(headers || {}), apikey: headers?.apikey || SUPABASE_KEY };
    if (!headers.Authorization) headers.Authorization = `Bearer ${SUPABASE_KEY}`;
    return content ? { ...headers, 'Content-Type': 'application/json' } : headers;
  }

  async function readJson(response) {
    const body = await response.text();
    return body ? JSON.parse(body) : null;
  }

  async function fetchPersistedChips() {
    const cached = dedupeChips([
      ...(Array.isArray(window.__crmChipsCache) ? window.__crmChipsCache : []),
      ...(typeof window.getChips === 'function' ? window.getChips() || [] : [])
    ]);

    try {
      if (typeof window.CRMHydrateChipsCache === 'function') {
        const hydrated = await window.CRMHydrateChipsCache();
        if (Array.isArray(hydrated)) return dedupeChips(hydrated);
      }
    } catch (error) {
      console.warn('[rebuild625] hydrate chips falhou:', error);
    }

    const userId = await getCurrentUserId();
    if (!userId) return cached;

    try {
      const params = new URLSearchParams({
        select: '*',
        user_id: `eq.${userId}`,
        order: 'updated_at.desc'
      });
      const response = await fetch(`${SUPABASE_URL}/rest/v1/whatsapp_instances?${params.toString()}`, {
        headers: await getHeaders()
      });
      const data = await readJson(response);
      if (!response.ok) throw data || new Error(`Falha ao carregar chips (${response.status}).`);
      return dedupeChips(Array.isArray(data) ? data : []);
    } catch (error) {
      console.warn('[rebuild625] fetch chips falhou:', error);
      return cached;
    }
  }

  function getActiveChip() {
    return state.chips.find((chip) => String(chip.id) === String(state.activeChipId) || String(chip.instance) === String(state.activeChipId)) || state.chips[0] || null;
  }

  function renderChipTabs() {
    const targets = ['valChipTabs', 'manualValChipTabs']
      .map((id) => document.getElementById(id))
      .filter(Boolean);

    if (!targets.length) return;

    if (!state.chips.length) {
      targets.forEach((target) => {
        target.innerHTML = '<span style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--muted)">Nenhum chip configurado em Configuracoes > Chips</span>';
      });
      return;
    }

    if (!state.activeChipId || !state.chips.some((chip) => String(chip.id) === String(state.activeChipId))) {
      state.activeChipId = state.chips[0].id;
    }

    const html = state.chips.map((chip, index) => {
      const active = String(chip.id) === String(state.activeChipId);
      const status = chip.connectionState || chip.status || 'salvo';
      return `
        <div class="chip-tab${active ? ' active' : ''}" title="${esc(chip.instance)} · ${esc(status)}" onclick="setValChip('${esc(chip.id)}')">
          ${esc(chip.name || `Chip ${index + 1}`)}
        </div>
      `;
    }).join('');

    targets.forEach((target) => { target.innerHTML = html; });
  }

  async function refreshValidationChips() {
    state.chips = await fetchPersistedChips();
    renderChipTabs();
    return state.chips;
  }

  function normalizePhone(value = '') {
    const raw = digits(value);
    if (!raw) return '';
    if (raw.startsWith('55')) return raw;
    if (raw.length === 10 || raw.length === 11) return `55${raw}`;
    return raw;
  }

  function leadPhone(lead = {}) {
    const candidates = [lead.normalized_phone, lead.phone, lead.whatsapp, lead.telefone]
      .map(normalizePhone)
      .filter(Boolean);
    return candidates.find((phone) => phone.length >= 12) || candidates[0] || '';
  }

  function parseValidationResult(data = {}) {
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

  function findResultForPhone(results, phone) {
    const list = Array.isArray(results)
      ? results
      : (Array.isArray(results?.data) ? results.data : (Array.isArray(results?.result) ? results.result : []));
    if (!list.length) return null;
    return list.find((item) => {
      const raw = digits(item?.number || item?.phone || item?.jid || item?.waId || item?.wa_id || item?.id || '');
      return raw && (raw.includes(phone) || phone.includes(raw));
    }) || list[0] || null;
  }

  async function callEvolutionDirect(chip, numbers) {
    const response = await fetch(`${chip.url}/chat/whatsappNumbers/${encodeURIComponent(chip.instance)}`, {
      method: 'POST',
      headers: {
        apikey: chip.key,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ numbers })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.error || data?.message === 'Unauthorized' || data?.status === 401) {
      throw new Error(data?.error || data?.message || `Evolution ${response.status}`);
    }
    return data;
  }

  async function callEvolutionValidation(chip, numbers) {
    const payload = {
      numbers,
      chipUrl: chip.url,
      instance: chip.instance,
      apikey: chip.key
    };

    try {
      const response = await fetch('/api/prospeccao/validar-numero', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && !data?.error) return data;
      if (![404, 405].includes(response.status)) {
        throw new Error(data?.error || data?.message || `Proxy validacao ${response.status}`);
      }
    } catch (error) {
      if (!/Failed to fetch|404|405/i.test(error?.message || '')) throw error;
    }

    return callEvolutionDirect(chip, numbers);
  }

  async function rpcValidationChipAction(lead, action, payload = {}) {
    const userId = await getCurrentUserId();
    if (!userId) throw new Error('Usuario autenticado nao encontrado.');
    const chip = payload.chip || getActiveChip() || {};

    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rpc_validation_chip_action`, {
      method: 'POST',
      headers: await getHeaders(true),
      body: JSON.stringify({
        p_user_id: userId,
        p_lead_id: lead.id,
        p_action: action,
        p_reason: payload.reason || null,
        p_chip_id: chip.id || chip.chip_id || chip.instance || null,
        p_chip_name: chip.name || chip.nome || chip.label || chip.instance || null,
        p_phone: payload.phone || lead.phone || lead.whatsapp || lead.normalized_phone || null,
        p_exists_whatsapp: typeof payload.exists === 'boolean' ? payload.exists : null,
        p_raw_payload: payload.raw || {}
      })
    });
    const data = await readJson(response);
    if (!response.ok) throw data || new Error(`Falha ao salvar validacao (${response.status}). Rode o SQL 6.25.`);
    return data;
  }

  function setValidationChipButtonsDisabled(leadId, disabled) {
    document.querySelectorAll('[data-validation-chip-action-id]').forEach((button) => {
      if (button.getAttribute('data-validation-chip-action-id') === String(leadId)) {
        button.disabled = disabled;
      }
    });
  }

  async function validateLeadWithChip(leadId, options = {}) {
    if (!state.chips.length) await refreshValidationChips();
    const chip = getActiveChip();
    if (!chip) {
      notifyUser('// cadastre ou selecione um chip antes de validar', 'warn');
      return { ok: false, skipped: true };
    }

    const lead = (window.rebuildValidationLeads || []).find((item) => String(item.id) === String(leadId));
    if (!lead) {
      notifyUser('// lead nao encontrado na validacao atual', 'warn');
      return { ok: false, skipped: true };
    }

    const phone = leadPhone(lead);
    if (!phone || phone.length < 12) {
      await rpcValidationChipAction(lead, 'validation_error', {
        chip,
        phone: phone || '',
        reason: 'Numero ausente ou invalido para consulta Evolution',
        raw: { source: 'fase-6.25', reason: 'invalid_phone' }
      }).catch((error) => console.warn('[rebuild625] tentativa invalida nao registrada:', error));
      notifyUser(`// ${lead.nome || lead.company_name}: numero ausente ou invalido`, 'warn');
      return { ok: false, invalidPhone: true };
    }

    setValidationChipButtonsDisabled(leadId, true);

    try {
      const raw = await callEvolutionValidation(chip, [phone]);
      const parsed = parseValidationResult(findResultForPhone(raw, phone) || raw);

      if (!parsed.definitive) {
        await rpcValidationChipAction(lead, 'validation_error', {
          chip,
          phone,
          reason: 'Resposta da Evolution sem resultado definitivo',
          raw
        });
        if (!options.silent) notifyUser('// resposta sem resultado definitivo. Lead continua pendente.', 'warn');
        return { ok: false, error: true };
      }

      await rpcValidationChipAction(lead, parsed.exists ? 'approve_whatsapp' : 'reject_validation', {
        chip,
        phone,
        exists: parsed.exists,
        reason: parsed.exists ? null : 'Numero sem WhatsApp pela Evolution',
        raw
      });

      if (!options.silent) {
        notifyUser(parsed.exists ? `Numero validado: ${lead.nome || lead.company_name}` : `Sem WhatsApp: ${lead.nome || lead.company_name}`, parsed.exists ? '' : 'warn');
      }

      return { ok: true, exists: parsed.exists };
    } catch (error) {
      await rpcValidationChipAction(lead, 'validation_error', {
        chip,
        phone,
        reason: error?.message || 'Falha ao consultar Evolution',
        raw: { source: 'fase-6.25', error: error?.message || String(error) }
      }).catch((rpcError) => console.warn('[rebuild625] erro nao registrado:', rpcError));
      if (!options.silent) notifyUser(error?.message || 'Falha ao validar numero.', 'err');
      return { ok: false, error: true };
    } finally {
      setValidationChipButtonsDisabled(leadId, false);
    }
  }

  async function validarNumeroUnico(leadId) {
    const result = await validateLeadWithChip(leadId);
    if (result && !result.skipped && typeof window.renderValidationStageFromSupabase === 'function') {
      await window.renderValidationStageFromSupabase();
    }
    if (typeof window.refreshCRMRebuild624 === 'function') window.refreshCRMRebuild624();
  }

  function setSpinner(visible) {
    const spinner = document.getElementById('valSpinner');
    if (spinner) spinner.style.display = visible ? 'inline-block' : 'none';
  }

  async function validarTodosNumeros(options = {}) {
    if (state.validating) {
      notifyUser('// validacao ja em andamento', 'warn');
      return;
    }

    const retryAll = options === true || options?.retryAll === true;
    if (!state.chips.length) await refreshValidationChips();
    const chip = getActiveChip();
    if (!chip) {
      notifyUser('// cadastre ou selecione um chip antes de validar', 'warn');
      return;
    }

    if (typeof window.renderValidationStageFromSupabase === 'function') {
      await window.renderValidationStageFromSupabase();
    }

    const rows = (window.rebuildValidationLeads || [])
      .filter((lead) => lead.current_stage === 'validation')
      .filter((lead) => retryAll ? lead.current_status !== 'whatsapp_validated' : lead.current_status === 'pending_validation');

    if (!rows.length) {
      notifyUser(retryAll ? '// nenhum numero para revalidar' : '// nenhum numero pendente', 'warn');
      return;
    }

    state.validating = true;
    setSpinner(true);

    let valid = 0;
    let invalid = 0;
    let failed = 0;
    let skipped = 0;

    try {
      for (const lead of rows) {
        const result = await validateLeadWithChip(lead.id, { silent: true });
        if (result?.skipped || result?.invalidPhone) skipped++;
        else if (result?.ok && result.exists) valid++;
        else if (result?.ok && !result.exists) invalid++;
        else failed++;
        await new Promise((resolve) => setTimeout(resolve, 350));
      }

      notifyUser(`${valid} valido(s) · ${invalid} sem WhatsApp · ${failed} falha(s) · ${skipped} ignorado(s)`);
      if (typeof window.renderValidationStageFromSupabase === 'function') {
        await window.renderValidationStageFromSupabase();
      }
      if (typeof window.refreshCRMRebuild624 === 'function') window.refreshCRMRebuild624();
    } finally {
      state.validating = false;
      setSpinner(false);
    }
  }

  function setValChip(chipId) {
    state.activeChipId = chipId;
    renderChipTabs();
  }

  function patchRenderValidation() {
    const previous = window.renderValidationStageFromSupabase;
    if (typeof previous !== 'function' || previous.__chips625) return;

    const patched = async function renderValidationStageChips625() {
      const result = await previous.apply(this, arguments);
      await refreshValidationChips();
      return result;
    };

    patched.__chips625 = true;
    patched.__previous = previous;
    window.renderValidationStageFromSupabase = patched;
    window.renderValidacao = patched;
  }

  function patchSwitchPanel() {
    const previous = window.switchPanel;
    if (typeof previous !== 'function' || previous.__chips625) return;

    const patched = function switchPanelValidationChips625(panel) {
      const result = previous.apply(this, arguments);
      if (['validacao', 'validation', 'panel-validacao', 'importar', 'panel-importar'].includes(panel)) {
        setTimeout(refreshValidationChips, 180);
      }
      return result;
    };

    patched.__chips625 = true;
    patched.__previous = previous;
    window.switchPanel = patched;
  }

  function install() {
    patchRenderValidation();
    patchSwitchPanel();
    window.refreshValidationChipsRebuild625 = refreshValidationChips;
    window.setValChip = setValChip;
    window.validarNumeroUnico = validarNumeroUnico;
    window.validarTodosNumeros = validarTodosNumeros;
  }

  function boot() {
    install();
    refreshValidationChips();
    setTimeout(install, 300);
    setTimeout(() => {
      install();
      refreshValidationChips();
    }, 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

/* CRM Rebuild Fase 6.24 - Estabilizacao ponta a ponta */
(function () {
  const state = {
    refreshing: false,
    installedAt: ''
  };

  function isActivePanel(id) {
    return !!document.getElementById(id)?.classList.contains('active');
  }

  function safeCall(name, args = []) {
    try {
      const fn = window[name];
      if (typeof fn === 'function') return fn.apply(window, args);
    } catch (error) {
      console.warn(`[rebuild624] ${name} falhou:`, error);
    }
    return null;
  }

  async function refreshMaybe(result) {
    if (result && typeof result.then === 'function') return result.catch((error) => {
      console.warn('[rebuild624] refresh async falhou:', error);
      return null;
    });
    return result;
  }

  async function refreshFlowSurfaces() {
    if (state.refreshing) return;
    state.refreshing = true;

    try {
      const tasks = [];

      if (isActivePanel('panel-validacao')) {
        tasks.push(refreshMaybe(safeCall('renderValidationStageFromSupabase')));
      }

      if (isActivePanel('panel-atribuicao')) {
        tasks.push(refreshMaybe(safeCall('renderAssignmentStageFromSupabase')));
        tasks.push(refreshMaybe(safeCall('refreshChipsRebuild620')));
      }

      if (isActivePanel('panel-fila-zap')) {
        tasks.push(refreshMaybe(safeCall('renderQueueStageFromSupabase621')));
      } else if (typeof window.refreshDispatchBatchesRebuild622 === 'function') {
        tasks.push(refreshMaybe(safeCall('refreshDispatchBatchesRebuild622')));
      }

      if (typeof window.updateBadges === 'function') {
        tasks.push(refreshMaybe(safeCall('updateBadges')));
      }

      await Promise.all(tasks);
    } finally {
      state.refreshing = false;
    }
  }

  function scheduleFlowRefresh(delay = 120) {
    clearTimeout(window.__crm624RefreshTimer);
    window.__crm624RefreshTimer = setTimeout(() => {
      refreshFlowSurfaces().catch((error) => {
        console.warn('[rebuild624] refresh geral falhou:', error);
      });
    }, delay);
  }

  function patchAsyncAction(name, delay = 120) {
    const previous = window[name];
    if (typeof previous !== 'function' || previous.__flow624) return false;

    const patched = async function actionRebuild624() {
      try {
        return await previous.apply(this, arguments);
      } finally {
        scheduleFlowRefresh(delay);
      }
    };

    patched.__flow624 = true;
    patched.__previous = previous;
    window[name] = patched;
    return true;
  }

  function patchSwitchPanel() {
    const previous = window.switchPanel;
    if (typeof previous !== 'function' || previous.__flow624) return false;

    const patched = function switchPanelFlow624(panel) {
      const result = previous.apply(this, arguments);
      if (['validacao', 'validation', 'panel-validacao', 'atribuicao', 'assignment', 'panel-atribuicao', 'fila-zap', 'whatsapp', 'panel-fila-zap'].includes(panel)) {
        scheduleFlowRefresh(220);
      }
      return result;
    };

    patched.__flow624 = true;
    patched.__previous = previous;
    window.switchPanel = patched;
    return true;
  }

  function installActionPatches() {
    [
      'approveLeadWhatsappRebuild',
      'rejectLeadValidationRebuild',
      'sendLeadToAssignmentRebuild619',
      'assignLeadToChipRebuild620',
      'queueLeadTodayRebuild621',
      'backToBacklogRebuild621',
      'queueAllBacklogRebuild621',
      'generateDispatchBatchesRebuild622',
      'startDispatchBatchRebuild622',
      'completeDispatchBatchRebuild622',
      'salvarChip',
      'deletarChip'
    ].forEach((name) => patchAsyncAction(name, 180));

    patchSwitchPanel();
  }

  function smokeCheck() {
    const requiredFunctions = [
      'importarLeads',
      'renderValidationStageFromSupabase',
      'approveLeadWhatsappRebuild',
      'sendLeadToAssignmentRebuild619',
      'assignLeadToChipRebuild620',
      'renderQueueStageFromSupabase621',
      'queueLeadTodayRebuild621',
      'generateDispatchBatchesRebuild622',
      'completeDispatchBatchRebuild622',
      'hydrateWhatsappChipsRebuild623'
    ];

    const requiredElements = [
      'importJsonInput',
      'importSummary',
      'valComSiteList',
      'atribList',
      'disparoEmpresasList',
      'zapRight',
      'chipNome',
      'qrModal'
    ];

    const report = {
      phase: '6.24',
      checkedAt: new Date().toISOString(),
      functions: requiredFunctions.map((name) => ({ name, ok: typeof window[name] === 'function' })),
      elements: requiredElements.map((id) => ({ id, ok: !!document.getElementById(id) }))
    };

    try {
      console.table(report.functions);
      console.table(report.elements);
    } catch (_) {}

    const missingFunctions = report.functions.filter((item) => !item.ok).length;
    const missingElements = report.elements.filter((item) => !item.ok).length;
    if (typeof notify === 'function') {
      notify(
        missingFunctions || missingElements
          ? `Diagnostico 6.24: ${missingFunctions} funcao(oes) e ${missingElements} elemento(s) ausente(s).`
          : 'Diagnostico 6.24 OK: funcoes e elementos principais carregados.',
        missingFunctions || missingElements ? 'warn' : ''
      );
    }

    return report;
  }

  function boot() {
    installActionPatches();
    state.installedAt = new Date().toISOString();
    window.CRMRebuild624 = {
      refresh: refreshFlowSurfaces,
      install: installActionPatches,
      smokeCheck
    };
    window.refreshCRMRebuild624 = refreshFlowSurfaces;
    window.runCRMRebuild624SmokeCheck = smokeCheck;

    setTimeout(installActionPatches, 400);
    setTimeout(installActionPatches, 1200);
    setTimeout(() => {
      if (isActivePanel('panel-validacao') || isActivePanel('panel-atribuicao') || isActivePanel('panel-fila-zap')) {
        scheduleFlowRefresh(0);
      }
    }, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

/* CRM Rebuild Fase 6.21 - Backlog e Fila WhatsApp persistentes */
(function () {
  const SUPABASE_URL = 'https://txyknazfufashgzlxkqh.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_ClGVAmaiS4tNWe8W_4EPew_aPvAzK0E';
  const QUEUE_TYPES = {
    backlog: 'chip_assignment',
    today: 'whatsapp_today'
  };

  const state = {
    activeTab: 'backlog',
    chips: [],
    rows: [],
    loading: false
  };

  const queueLeadCache = new Map();

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
    const body = await response.text();
    return body ? JSON.parse(body) : null;
  }

  function normalizeChip(row = {}, index = 0) {
    const id = String(row.chip_id || row.id || row.instance || `chip_${index + 1}`);
    return {
      id,
      dbId: row.id || null,
      name: row.name || row.nome || row.label || row.instance || `Chip ${index + 1}`,
      instance: row.instance || row.name || '',
      status: row.status || row.connection_state || 'active'
    };
  }

  function localChipsFallback() {
    try {
      return (typeof getChips === 'function' ? getChips() : [])
        .filter((chip) => chip && chip.id && chip.instance && chip.status !== 'disabled' && chip.active !== false)
        .map(normalizeChip);
    } catch (_) {
      return [];
    }
  }

  async function fetchWhatsappChips() {
    const fallback = localChipsFallback();
    const userId = await getCurrentUserId();
    if (!userId) return fallback;

    const params = new URLSearchParams({
      select: '*',
      user_id: `eq.${userId}`,
      order: 'created_at.desc'
    });

    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/whatsapp_instances?${params.toString()}`, {
        headers: await getHeaders()
      });
      const data = await readJson(response);
      if (!response.ok) throw data || new Error(`Falha ao carregar chips (${response.status}).`);
      const chips = (Array.isArray(data) ? data : [])
        .filter((row) => row.active !== false)
        .map(normalizeChip)
        .filter((chip) => chip.id && chip.instance);
      return chips.length ? chips : fallback;
    } catch (error) {
      console.warn('[rebuild621] falha ao carregar chips:', error);
      return fallback;
    }
  }

  async function fetchQueueItems() {
    const userId = await getCurrentUserId();
    if (!userId) return [];

    const params = new URLSearchParams({
      select: 'id,queue_type,bucket,lead_id,position,data,updated_at',
      user_id: `eq.${userId}`,
      queue_type: 'in.(chip_assignment,whatsapp_today)',
      order: 'position.asc'
    });

    const response = await fetch(`${SUPABASE_URL}/rest/v1/crm_queue_items?${params.toString()}`, {
      headers: await getHeaders()
    });
    const data = await readJson(response);

    if (!response.ok) throw data || new Error(`Falha ao carregar backlog/fila (${response.status}).`);
    return Array.isArray(data) ? data : [];
  }

  function rowLead(row = {}) {
    const data = row.data || {};
    const lead = data.lead || data;
    const chip = data.chip || {};
    return {
      id: String(row.lead_id || lead.id || ''),
      nome: lead.nome || lead.name || lead.company_name || 'Empresa sem nome',
      empresa: lead.nome || lead.name || lead.company_name || 'Empresa sem nome',
      company_name: lead.nome || lead.name || lead.company_name || 'Empresa sem nome',
      whatsapp: lead.whatsapp || lead.phone || lead.telefone || '',
      phone: lead.whatsapp || lead.phone || lead.telefone || '',
      telefone: lead.whatsapp || lead.phone || lead.telefone || '',
      site: lead.site || lead.website || '',
      website: lead.site || lead.website || '',
      instagram: lead.instagram || lead.instagram_url || '',
      instagram_url: lead.instagram || lead.instagram_url || '',
      chipId: data.chip_id || data.chipId || chip.id || '',
      assignedChipId: data.chip_id || data.chipId || chip.id || '',
      chipName: data.chip_name || data.chipName || chip.name || '',
      chipInstance: data.chip_instance || chip.instance || '',
      current_stage: row.queue_type === QUEUE_TYPES.today ? 'dispatch' : 'assignment',
      current_status: row.queue_type === QUEUE_TYPES.today ? 'queued_dispatch' : 'chip_assigned',
      status: row.queue_type === QUEUE_TYPES.today ? 'queued_dispatch' : 'chip_assigned',
      bucket: row.bucket || data.bucket || '',
      queueType: row.queue_type,
      queueItemId: row.id,
      queuePosition: row.position || 0,
      updated_at: row.updated_at,
      baseSource: 'Supabase fila 6.21'
    };
  }

  function mergeQueueRows(items = []) {
    const byLead = new Map();

    items.forEach((row) => {
      const leadId = String(row.lead_id || row.data?.lead?.id || '');
      if (!leadId) return;
      const current = byLead.get(leadId) || {};
      if (row.queue_type === QUEUE_TYPES.backlog) current.backlog = row;
      if (row.queue_type === QUEUE_TYPES.today) current.today = row;
      byLead.set(leadId, current);
    });

    return [...byLead.entries()].map(([leadId, group]) => {
      const source = group.today || group.backlog;
      const lead = rowLead(source);
      lead.id = leadId;
      lead.inTodayQueue = !!group.today;
      lead.backlogRowId = group.backlog?.id || '';
      lead.todayRowId = group.today?.id || '';
      lead.backlogPosition = group.backlog?.position ?? 0;
      lead.todayPosition = group.today?.position ?? 0;
      return lead;
    }).sort((a, b) => {
      const pa = state.activeTab === 'today' ? a.todayPosition : a.backlogPosition;
      const pb = state.activeTab === 'today' ? b.todayPosition : b.backlogPosition;
      return pa - pb;
    });
  }

  function publishQueueLeads(rows) {
    queueLeadCache.clear();
    rows.forEach((lead) => queueLeadCache.set(String(lead.id), lead));
    window.rebuildQueueLeads621 = rows;

    if (window.findLeadEverywhere?.__queue621) return;
    const previous = window.findLeadEverywhere;
    const patched = function findLeadEverywhereQueue621(id) {
      const key = String(id || '');
      if (queueLeadCache.has(key)) return queueLeadCache.get(key);
      return typeof previous === 'function' ? previous.apply(this, arguments) : null;
    };
    patched.__queue621 = true;
    patched.__previous = previous;
    window.findLeadEverywhere = patched;
  }

  async function fetchQueueState() {
    state.loading = true;
    try {
      const [chips, items] = await Promise.all([
        fetchWhatsappChips(),
        fetchQueueItems()
      ]);
      state.chips = chips;
      state.rows = mergeQueueRows(items);
      publishQueueLeads(state.rows);
      return state.rows;
    } finally {
      state.loading = false;
    }
  }

  async function rpcQueueAction(leadId, action) {
    const userId = await getCurrentUserId();
    if (!userId) throw new Error('Usuario autenticado nao encontrado.');

    const lead = state.rows.find((item) => String(item.id) === String(leadId));
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rpc_backlog_queue_action`, {
      method: 'POST',
      headers: await getHeaders(true),
      body: JSON.stringify({
        p_user_id: userId,
        p_lead_id: leadId,
        p_action: action,
        p_payload: {
          source: 'fase-6.21',
          queued_from: 'crm_rebuild',
          lead: lead ? {
            id: lead.id,
            nome: lead.nome,
            whatsapp: lead.whatsapp,
            site: lead.site,
            chip_id: lead.chipId,
            chip_name: lead.chipName
          } : null
        }
      })
    });
    const data = await readJson(response);
    if (!response.ok) throw data || new Error(`Falha na acao de fila (${response.status}).`);
    return data;
  }

  function filteredRows() {
    return state.rows.filter((row) => state.activeTab === 'today' ? row.inTodayQueue : !row.inTodayQueue);
  }

  function setBadge(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = String(value);
  }

  function renderTabs() {
    const dayTabs = document.getElementById('disparoDayTabs');
    const statusTabs = document.getElementById('disparoStatusTabs');
    const stats = document.getElementById('disparoStats');
    const backlogCount = state.rows.filter((row) => !row.inTodayQueue).length;
    const todayCount = state.rows.filter((row) => row.inTodayQueue).length;

    setBadge('badge-fila-zap', todayCount || backlogCount);

    if (dayTabs) {
      dayTabs.innerHTML = `
        <div class="day-tab${state.activeTab === 'backlog' ? ' active' : ''}" onclick="setQueueTabRebuild621('backlog')">
          Backlog <span class="day-count">${backlogCount}</span>
        </div>
        <div class="day-tab${state.activeTab === 'today' ? ' active' : ''}" onclick="setQueueTabRebuild621('today')">
          Fila de hoje <span class="day-count">${todayCount}</span>
        </div>
      `;
    }

    if (statusTabs) {
      statusTabs.innerHTML = `
        <button class="btn btn-ghost" type="button" style="font-size:10px;padding:7px 12px" onclick="renderQueueStageFromSupabase621()">Atualizar</button>
        <button class="btn btn-primary" type="button" style="font-size:10px;padding:7px 12px" onclick="queueAllBacklogRebuild621()">Colocar backlog na fila</button>
      `;
    }

    if (stats) {
      stats.innerHTML = `<span style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted)">${backlogCount} no backlog · ${todayCount} na fila de hoje · ${state.chips.length} chip${state.chips.length !== 1 ? 's' : ''} ativo${state.chips.length !== 1 ? 's' : ''}</span>`;
    }
  }

  function linkButton(url, label) {
    if (!url) return '';
    return `<a href="${esc(url)}" target="_blank" rel="noopener" class="add-btn">${esc(label)}</a>`;
  }

  function actionButtons(row) {
    const whats = digits(row.whatsapp);
    const wa = whats ? linkButton(`https://wa.me/${whats}`, 'Abrir ZAP') : '';
    const queueButton = row.inTodayQueue
      ? `<button class="add-btn" type="button" data-queue621-lead="${esc(row.id)}" onclick="backToBacklogRebuild621('${esc(row.id)}')">Voltar backlog</button>`
      : `<button class="add-btn added" type="button" data-queue621-lead="${esc(row.id)}" onclick="queueLeadTodayRebuild621('${esc(row.id)}')">Entrar na fila</button>`;

    return `
      ${wa}
      <button class="add-btn" type="button" onclick="openQueueLeadDrawerRebuild621('${esc(row.id)}')">Ficha</button>
      ${queueButton}
    `;
  }

  function rowCard(row) {
    const phone = row.whatsapp || 'Sem WhatsApp';
    const chip = row.chipName || row.chipId || 'Chip nao definido';
    const status = row.inTodayQueue ? 'Fila de hoje' : 'Backlog';
    const statusClass = row.inTodayQueue ? 'ok' : 'warn';

    return `
      <div class="empresa-card" data-lead-id="${esc(row.id)}" style="align-items:flex-start">
        <div class="empresa-info">
          <div class="empresa-nome">${esc(row.nome)}</div>
          <div class="empresa-meta">
            <span class="q-badge ${statusClass}">${esc(status)}</span>
            <span class="q-badge info">${esc(chip)}</span>
            <span class="empresa-phone">${esc(phone)}</span>
            ${row.site ? `<span class="empresa-site">${esc(row.site)}</span>` : ''}
          </div>
        </div>
        <div class="empresa-actions">
          ${actionButtons(row)}
        </div>
      </div>
    `;
  }

  function renderLeftList() {
    const list = document.getElementById('disparoEmpresasList');
    const pagination = document.getElementById('disparoPagination');
    if (pagination) pagination.innerHTML = '';
    if (!list) return;

    const rows = filteredRows();
    if (!rows.length) {
      list.innerHTML = `<div class="fila-empty">// ${state.activeTab === 'today' ? 'fila de hoje vazia' : 'backlog vazio'}.</div>`;
      return;
    }

    list.innerHTML = rows.map(rowCard).join('');
  }

  function renderRightPanel() {
    const right = document.getElementById('zapRight');
    if (!right) return;

    if (!state.chips.length) {
      right.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;flex:1;font-family:'DM Mono',monospace;font-size:10px;color:var(--muted);padding:40px">// nenhum chip ativo encontrado</div>`;
      return;
    }

    right.innerHTML = state.chips.map((chip, index) => {
      const rows = state.rows.filter((row) => String(row.chipId) === String(chip.id) || String(row.chipId) === String(chip.dbId) || row.chipName === chip.name);
      const today = rows.filter((row) => row.inTodayQueue).length;
      const backlog = rows.length - today;

      return `
        <div class="chip-accordion open" data-slot="${index}">
          <div class="chip-accordion-header" style="border-color:rgba(184,240,89,0.25)">
            <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0">
              <span style="font-size:11px;font-weight:700;letter-spacing:0.08em;color:var(--accent)">CHIP ${index + 1}</span>
              <span style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted);text-transform:none;letter-spacing:0;font-weight:400;">· ${esc(chip.name)}</span>
              <span style="font-family:'DM Mono',monospace;font-size:8px;color:var(--muted);margin-left:auto;white-space:nowrap">${today} fila · ${backlog} backlog</span>
            </div>
          </div>
          <div class="chip-accordion-body" style="display:block">
            <div class="chip-fila-scroll">
              <div class="fila-items" style="display:flex;padding:10px 12px;gap:6px;flex-direction:column">
                ${rows.length ? rows.map((row) => `
                  <div style="border:1px solid var(--border);border-radius:8px;padding:8px 10px;background:var(--surface2)">
                    <div style="font-size:10px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(row.nome)}</div>
                    <div style="font-family:'DM Mono',monospace;font-size:8px;color:var(--muted);margin-top:3px">${esc(row.inTodayQueue ? 'Fila de hoje' : 'Backlog')}</div>
                  </div>
                `).join('') : '<div class="fila-empty">Sem leads neste chip.</div>'}
              </div>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  function renderQueueView() {
    renderTabs();
    renderLeftList();
    renderRightPanel();
  }

  async function renderQueueStageFromSupabase() {
    const list = document.getElementById('disparoEmpresasList');
    if (list && !state.rows.length) {
      list.innerHTML = '<div class="fila-empty">// carregando backlog e fila...</div>';
    }

    try {
      await fetchQueueState();
      renderQueueView();
      return state.rows;
    } catch (error) {
      console.error('[rebuild621] erro ao carregar backlog/fila:', error);
      if (list) list.innerHTML = '<div class="fila-empty">// erro ao carregar backlog/fila. Verifique o SQL 6.21.</div>';
      return [];
    }
  }

  function setButtonsDisabled(leadId, disabled) {
    document.querySelectorAll('[data-queue621-lead]').forEach((button) => {
      if (button.getAttribute('data-queue621-lead') === String(leadId)) button.disabled = disabled;
    });
  }

  async function queueLeadToday(leadId) {
    setButtonsDisabled(leadId, true);
    try {
      await rpcQueueAction(leadId, 'queue_today');
      if (typeof notify === 'function') notify('Lead entrou na fila de hoje.');
      await renderQueueStageFromSupabase();
    } catch (error) {
      console.error('[rebuild621] erro ao colocar lead na fila:', error);
      if (typeof notify === 'function') notify(error?.message || 'Falha ao colocar lead na fila.', 'err');
    } finally {
      setButtonsDisabled(leadId, false);
    }
  }

  async function backToBacklog(leadId) {
    setButtonsDisabled(leadId, true);
    try {
      await rpcQueueAction(leadId, 'back_to_backlog');
      if (typeof notify === 'function') notify('Lead voltou para o backlog.');
      await renderQueueStageFromSupabase();
    } catch (error) {
      console.error('[rebuild621] erro ao voltar lead ao backlog:', error);
      if (typeof notify === 'function') notify(error?.message || 'Falha ao voltar lead ao backlog.', 'err');
    } finally {
      setButtonsDisabled(leadId, false);
    }
  }

  async function queueAllBacklog() {
    if (!state.rows.length) await fetchQueueState();
    const backlog = state.rows.filter((row) => !row.inTodayQueue);
    if (!backlog.length) {
      if (typeof notify === 'function') notify('// nenhum lead no backlog para colocar na fila', 'warn');
      return;
    }

    let moved = 0;
    for (const row of backlog) {
      try {
        await rpcQueueAction(row.id, 'queue_today');
        moved++;
      } catch (error) {
        console.warn('[rebuild621] falha ao colocar lead em lote:', row.id, error);
      }
    }

    if (typeof notify === 'function') notify(`${moved} lead${moved !== 1 ? 's' : ''} entrou${moved !== 1 ? 'aram' : ''} na fila de hoje.`);
    state.activeTab = 'today';
    await renderQueueStageFromSupabase();
  }

  function openQueueLeadDrawer(leadId) {
    if (typeof window.openLeadDrawer === 'function') {
      window.openLeadDrawer(leadId);
      return;
    }
    if (typeof notify === 'function') notify('Ficha do lead indisponivel.', 'warn');
  }

  function setQueueTab(tab) {
    state.activeTab = tab === 'today' ? 'today' : 'backlog';
    renderQueueView();
  }

  function installHooks() {
    window.renderFilaZap = renderQueueStageFromSupabase;
    window.renderQueueStageFromSupabase621 = renderQueueStageFromSupabase;
    window.queueLeadTodayRebuild621 = queueLeadToday;
    window.backToBacklogRebuild621 = backToBacklog;
    window.queueAllBacklogRebuild621 = queueAllBacklog;
    window.openQueueLeadDrawerRebuild621 = openQueueLeadDrawer;
    window.setQueueTabRebuild621 = setQueueTab;
    window.setDisparoDay = function setDisparoDayRebuild621(day) {
      state.activeTab = day === 'today' || day !== 'backlog' ? 'today' : 'backlog';
      renderQueueView();
    };

    const oldSwitchPanel = window.switchPanel;
    if (typeof oldSwitchPanel === 'function' && !oldSwitchPanel.__queue621) {
      const patchedSwitchPanel = function switchPanelQueue621(panel) {
        const result = oldSwitchPanel.apply(this, arguments);
        if (panel === 'fila-zap' || panel === 'whatsapp' || panel === 'panel-fila-zap') {
          setTimeout(renderQueueStageFromSupabase, 100);
        }
        return result;
      };
      patchedSwitchPanel.__queue621 = true;
      patchedSwitchPanel.__previous = oldSwitchPanel;
      window.switchPanel = patchedSwitchPanel;
    }
  }

  function boot() {
    installHooks();
    if (document.getElementById('panel-fila-zap')?.classList.contains('active')) {
      renderQueueStageFromSupabase();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

/* CRM Rebuild Fase 6.20 - Chips e interface estavel */
(function () {
  const SUPABASE_URL = 'https://txyknazfufashgzlxkqh.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_ClGVAmaiS4tNWe8W_4EPew_aPvAzK0E';

  const state = {
    chips: [],
    assignments: new Map(),
    loading: false
  };

  const CP1252_REVERSE = {
    0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84,
    0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88,
    0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c,
    0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93,
    0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
    0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b,
    0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f
  };

  const MOJIBAKE_RE = /(\u00c3[\u00a0-\u00bf]|\u00c2[\u00a0-\u00bf]|\u00e2[\u0080-\u00bf]|\u00f0\u0178|\ufffd)/g;

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

  function badScore(value) {
    return (String(value ?? '').match(MOJIBAKE_RE) || []).length;
  }

  function encodeAsCp1252Bytes(text) {
    const bytes = [];
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code <= 0xff) {
        bytes.push(code);
      } else if (Object.prototype.hasOwnProperty.call(CP1252_REVERSE, code)) {
        bytes.push(CP1252_REVERSE[code]);
      } else {
        return null;
      }
    }
    return new Uint8Array(bytes);
  }

  function fixMojibakeText(value) {
    const text = String(value ?? '');
    if (!badScore(text) || typeof TextDecoder === 'undefined') return text;
    const bytes = encodeAsCp1252Bytes(text);
    if (!bytes) return text;
    try {
      const decoded = new TextDecoder('utf-8').decode(bytes);
      return badScore(decoded) < badScore(text) ? decoded : text;
    } catch (_) {
      return text;
    }
  }

  function repairDomText() {
    if (!document.body) return;

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!badScore(node.nodeValue)) return NodeFilter.FILTER_REJECT;
        const tag = node.parentElement?.tagName;
        if (tag && ['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE'].includes(tag)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((node) => {
      const fixed = fixMojibakeText(node.nodeValue);
      if (fixed !== node.nodeValue) node.nodeValue = fixed;
    });

    const attrs = ['title', 'aria-label', 'placeholder', 'data-label', 'alt'];
    document.querySelectorAll(attrs.map((attr) => `[${attr}]`).join(',')).forEach((element) => {
      attrs.forEach((attr) => {
        const current = element.getAttribute(attr);
        if (!current || !badScore(current)) return;
        const fixed = fixMojibakeText(current);
        if (fixed !== current) element.setAttribute(attr, fixed);
      });
    });
  }

  function iconSvg(name) {
    const paths = {
      search: '<circle cx="11" cy="11" r="7"></circle><path d="m20 20-4.2-4.2"></path>',
      chart: '<path d="M4 19V5"></path><path d="M4 19h16"></path><path d="M8 16V9"></path><path d="M12 16V7"></path><path d="M16 16v-4"></path>',
      inbox: '<path d="M4 4h16l-2 10H6L4 4Z"></path><path d="M6 14l2 4h8l2-4"></path>',
      users: '<path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2"></path><circle cx="9.5" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.8"></path><path d="M16 3.2a4 4 0 0 1 0 7.6"></path>',
      check: '<path d="M20 6 9 17l-5-5"></path>',
      folder: '<path d="M3 7h6l2 2h10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"></path>',
      send: '<path d="m22 2-7 20-4-9-9-4 20-7Z"></path><path d="M22 2 11 13"></path>',
      message: '<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v8Z"></path>',
      camera: '<path d="M5 7h3l2-2h4l2 2h3a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z"></path><circle cx="12" cy="13" r="4"></circle>',
      clipboard: '<path d="M9 4h6l1 2h3v15H5V6h3l1-2Z"></path><path d="M9 10h6"></path><path d="M9 14h6"></path>',
      clock: '<circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path>',
      columns: '<path d="M4 5h16v14H4z"></path><path d="M9 5v14"></path><path d="M15 5v14"></path>',
      trend: '<path d="M3 17 9 11l4 4 8-8"></path><path d="M14 7h7v7"></path>',
      wrench: '<path d="M14.7 6.3a4 4 0 0 0-5 5L4 17l3 3 5.7-5.7a4 4 0 0 0 5-5l-3 3-3-3 3-3Z"></path>',
      link: '<path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1.2 1.2"></path><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1.2-1.2"></path>',
      user: '<circle cx="12" cy="8" r="4"></circle><path d="M4 21a8 8 0 0 1 16 0"></path>',
      settings: '<circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a8 8 0 0 0 .1-6l2-1.5-2-3.4-2.4 1a8 8 0 0 0-5.2-3l-.4-2.6h-4l-.4 2.6a8 8 0 0 0-5.2 3l-2.4-1-2 3.4 2 1.5a8 8 0 0 0 .1 6l-2 1.5 2 3.4 2.4-1a8 8 0 0 0 5.2 3l.4 2.6h4l.4-2.6a8 8 0 0 0 5.2-3l2.4 1 2-3.4-2-1.5Z"></path>',
      logout: '<path d="M10 17 15 12l-5-5"></path><path d="M15 12H3"></path><path d="M21 3v18h-8"></path>',
      menu: '<path d="M4 7h16"></path><path d="M4 12h16"></path><path d="M4 17h16"></path>'
    };
    return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths[name] || paths.folder}</svg>`;
  }

  function iconKey(value) {
    return fixMojibakeText(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  function installIconStyles() {
    if (document.getElementById('crm620-icon-style')) return;
    const style = document.createElement('style');
    style.id = 'crm620-icon-style';
    style.textContent = [
      '.nav-icon svg,.sidebar-hamburger svg{width:16px;height:16px;display:block;stroke:currentColor}',
      '.nav-icon{display:inline-flex;align-items:center;justify-content:center;min-width:18px}',
      '.sidebar-hamburger{display:inline-flex;align-items:center;justify-content:center}',
      '.crm620-chip-actions{display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end}',
      '.crm620-chip-actions .add-btn{font-size:9px;padding:5px 9px;white-space:nowrap}'
    ].join('\n');
    document.head.appendChild(style);
  }

  function installSvgIcons() {
    installIconStyles();
    const map = {
      busca: 'search',
      inicio: 'chart',
      'caixa de entrada': 'inbox',
      leads: 'users',
      importar: 'inbox',
      validacao: 'check',
      atribuicao: 'folder',
      envios: 'send',
      whatsapp: 'message',
      instagram: 'camera',
      conversas: 'message',
      gerenciamento: 'clipboard',
      'follow-ups': 'clock',
      kanban: 'columns',
      acompanhamentos: 'trend',
      ferramentas: 'wrench',
      redirecionamentos: 'link',
      auditoria: 'chart',
      'minha conta': 'user',
      configuracoes: 'settings',
      sair: 'logout'
    };

    document.querySelectorAll('.nav-item').forEach((item) => {
      const label = item.getAttribute('data-label') || item.querySelector('.nav-label')?.textContent || item.textContent || '';
      const name = map[iconKey(label)];
      const icon = item.querySelector('.nav-icon');
      if (!name || !icon || icon.getAttribute('data-crm620-icon') === name) return;
      icon.innerHTML = iconSvg(name);
      icon.setAttribute('data-crm620-icon', name);
    });

    document.querySelectorAll('.menu-arrow-final').forEach((arrow) => {
      if (arrow.getAttribute('data-crm620-arrow')) return;
      arrow.innerHTML = '&rsaquo;';
      arrow.setAttribute('data-crm620-arrow', '1');
    });

    document.querySelectorAll('.sidebar-hamburger').forEach((button) => {
      if (button.getAttribute('data-crm620-icon') === 'menu') return;
      button.innerHTML = iconSvg('menu');
      button.setAttribute('data-crm620-icon', 'menu');
    });
  }

  function localChipsFallback() {
    try {
      return (typeof getChips === 'function' ? getChips() : [])
        .filter((chip) => chip && chip.id && chip.instance && chip.status !== 'disabled' && chip.active !== false)
        .map((chip, index) => ({
          id: String(chip.id || chip.instance || `chip_${index + 1}`),
          dbId: chip.dbId || null,
          name: chip.nome || chip.name || chip.label || chip.instance || `Chip ${index + 1}`,
          instance: chip.instance || '',
          status: chip.status || 'active',
          source: 'runtime'
        }));
    } catch (_) {
      return [];
    }
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
      if (typeof getSupabaseAuthHeadersV423 === 'function') headers = await getSupabaseAuthHeadersV423();
    } catch (_) {}
    if (!headers?.apikey) {
      headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };
    }
    return content ? { ...headers, 'Content-Type': 'application/json' } : headers;
  }

  async function readJson(response) {
    const body = await response.text();
    return body ? JSON.parse(body) : null;
  }

  function normalizeChip(row = {}, index = 0) {
    const id = String(row.chip_id || row.id || row.instance || `chip_${index + 1}`);
    return {
      id,
      dbId: row.id || null,
      name: row.name || row.nome || row.label || row.instance || `Chip ${index + 1}`,
      instance: row.instance || row.name || '',
      status: row.status || row.connection_state || 'active',
      phone: row.phone || row.number || '',
      source: 'supabase'
    };
  }

  async function fetchWhatsappChips() {
    const fallback = localChipsFallback();
    const userId = await getCurrentUserId();
    if (!userId) return fallback;

    const params = new URLSearchParams({
      select: '*',
      user_id: `eq.${userId}`,
      order: 'created_at.desc'
    });

    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/whatsapp_instances?${params.toString()}`, {
        headers: await getHeaders()
      });
      const data = await readJson(response);
      if (!response.ok) throw data || new Error(`Falha ao carregar chips (${response.status}).`);
      const rows = Array.isArray(data) ? data : [];
      const chips = rows
        .filter((row) => row.active !== false)
        .map(normalizeChip)
        .filter((chip) => chip.id && chip.instance);
      return chips.length ? chips : fallback;
    } catch (error) {
      console.warn('[rebuild620] falha ao carregar chips:', error);
      return fallback;
    }
  }

  async function fetchChipAssignments() {
    const userId = await getCurrentUserId();
    const map = new Map();
    if (!userId) return map;

    const params = new URLSearchParams({
      select: 'lead_id,data,updated_at',
      user_id: `eq.${userId}`,
      queue_type: 'eq.chip_assignment',
      order: 'updated_at.desc'
    });

    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/crm_queue_items?${params.toString()}`, {
        headers: await getHeaders()
      });
      const data = await readJson(response);
      if (!response.ok) throw data || new Error(`Falha ao carregar vinculos de chip (${response.status}).`);
      (Array.isArray(data) ? data : []).forEach((row) => {
        if (!row?.lead_id || map.has(String(row.lead_id))) return;
        map.set(String(row.lead_id), { ...(row.data || {}), updated_at: row.updated_at });
      });
    } catch (error) {
      console.warn('[rebuild620] falha ao carregar vinculos de chip:', error);
    }

    return map;
  }

  async function refreshChipState() {
    state.loading = true;
    try {
      const [chips, assignments] = await Promise.all([
        fetchWhatsappChips(),
        fetchChipAssignments()
      ]);
      state.chips = chips;
      state.assignments = assignments;
      return state;
    } finally {
      state.loading = false;
    }
  }

  function findAssignmentLead(leadId) {
    const id = String(leadId || '');
    return (window.rebuildAssignmentLeads || []).find((lead) => String(lead.id) === id) || null;
  }

  function bucketForLead(lead = {}) {
    const bucket = lead.assignmentBucket || lead.bucket || lead.siteSegment || lead.templateType || '';
    if (bucket) return bucket;
    if (!clean(lead.whatsapp || lead.phone || lead.telefone) && clean(lead.instagram || lead.instagram_url)) return 'insta';
    if (lead.hasOwnSite || lead.has_own_site) return 'com-site';
    return 'zap';
  }

  function assignmentPayload(lead, chip, bucket) {
    return {
      source: 'fase-6.20',
      bucket,
      channel: 'whatsapp',
      assigned_at: new Date().toISOString(),
      lead: {
        id: lead.id,
        nome: lead.nome || lead.empresa || lead.company_name || '',
        whatsapp: lead.whatsapp || lead.phone || lead.telefone || '',
        site: lead.site || lead.website || '',
        instagram: lead.instagram || lead.instagram_url || ''
      },
      chip: {
        id: chip.id,
        db_id: chip.dbId || null,
        name: chip.name,
        instance: chip.instance
      }
    };
  }

  async function rpcChipAction(leadId, chipId) {
    const userId = await getCurrentUserId();
    if (!userId) throw new Error('Usuario autenticado nao encontrado.');

    const lead = findAssignmentLead(leadId);
    if (!lead) throw new Error('Lead nao encontrado na Atribuicao.');
    const chip = state.chips.find((item) => String(item.id) === String(chipId) || String(item.dbId) === String(chipId));
    if (!chip) throw new Error('Chip nao encontrado.');

    const bucket = bucketForLead(lead);
    const payload = assignmentPayload(lead, chip, bucket);
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rpc_chip_lead_action`, {
      method: 'POST',
      headers: await getHeaders(true),
      body: JSON.stringify({
        p_user_id: userId,
        p_lead_id: lead.id,
        p_chip_id: chip.id,
        p_action: 'assign_chip',
        p_bucket: bucket,
        p_payload: payload
      })
    });
    const data = await readJson(response);
    if (!response.ok) throw data || new Error(`Falha ao vincular chip (${response.status}).`);
    return { data, payload, chip, lead };
  }

  function isWhatsappLead(lead = {}) {
    return clean(lead.whatsapp || lead.phone || lead.telefone).replace(/\D+/g, '').length >= 10;
  }

  function isLeadInAssignmentStage(lead = {}) {
    return lead.current_stage === 'assignment' || lead.stage === 'assignment';
  }

  function chipControlsHtml(lead) {
    if (!isLeadInAssignmentStage(lead)) return '';
    if (bucketForLead(lead) === 'insta') return '<span class="q-badge insta">Instagram na 6.21</span>';
    if (!isWhatsappLead(lead)) return '<span class="q-badge warn">Sem WhatsApp</span>';
    if (!state.chips.length) return '<span class="q-badge warn">Nenhum chip ativo</span>';

    const current = state.assignments.get(String(lead.id));
    const currentChipId = String(current?.chip?.id || current?.chip_id || current?.chipId || '');
    const currentName = current?.chip?.name || current?.chip_name || current?.chipName || '';
    const buttons = state.chips.map((chip, index) => {
      const active = currentChipId && (currentChipId === String(chip.id) || currentChipId === String(chip.dbId));
      const label = active ? `Chip ${index + 1} OK` : `Chip ${index + 1}`;
      const title = active ? `Vinculado a ${chip.name}` : `Vincular a ${chip.name}`;
      return `<button class="add-btn ${active ? 'added' : ''}" type="button" title="${esc(title)}" data-chip620-lead="${esc(lead.id)}" onclick="assignLeadToChipRebuild620('${esc(lead.id)}','${esc(chip.id)}')">${esc(label)}</button>`;
    }).join('');
    const badge = current ? `<span class="q-badge ok">Chip: ${esc(currentName || currentChipId || 'vinculado')}</span>` : '';
    return `<div class="crm620-chip-actions">${badge}${buttons}</div>`;
  }

  function enhanceAssignmentCards() {
    const cards = document.querySelectorAll('#atribList .empresa-card[data-lead-id],#atribInstaList .empresa-card[data-lead-id]');
    cards.forEach((card) => {
      const leadId = card.getAttribute('data-lead-id');
      const lead = findAssignmentLead(leadId);
      const actions = card.querySelector('.empresa-actions');
      if (!lead || !actions) return;

      actions.querySelectorAll('.q-badge.warn').forEach((badge) => {
        if (clean(badge.textContent).toLowerCase().includes('chip na 6.20')) badge.remove();
      });

      let host = actions.querySelector('[data-crm620-chip-host]');
      if (!host) {
        host = document.createElement('div');
        host.setAttribute('data-crm620-chip-host', '1');
        actions.appendChild(host);
      }
      host.innerHTML = chipControlsHtml(lead);
    });
  }

  function setChipButtonsDisabled(leadId, disabled) {
    document.querySelectorAll('[data-chip620-lead]').forEach((button) => {
      if (button.getAttribute('data-chip620-lead') === String(leadId)) button.disabled = disabled;
    });
  }

  async function assignLeadToChip(leadId, chipId) {
    setChipButtonsDisabled(leadId, true);
    try {
      if (!state.chips.length) await refreshChipState();
      const result = await rpcChipAction(leadId, chipId);
      const lead = result.lead;
      const payload = result.payload;
      state.assignments.set(String(leadId), payload);
      lead.current_status = 'chip_assigned';
      lead.status = 'chip_assigned';
      lead.assignedChipId = result.chip.id;
      lead.chipName = result.chip.name;
      enhanceAssignmentCards();
      if (typeof notify === 'function') notify(`Lead vinculado ao ${result.chip.name}.`);
    } catch (error) {
      console.error('[rebuild620] erro ao vincular chip:', error);
      const message = error?.message || error?.details || 'Falha ao vincular chip. Verifique o SQL 6.20.';
      if (typeof notify === 'function') notify(message, 'err');
    } finally {
      setChipButtonsDisabled(leadId, false);
    }
  }

  function scheduleVisualRepair() {
    clearTimeout(window.__crm620VisualTimer);
    window.__crm620VisualTimer = setTimeout(() => {
      repairDomText();
      installSvgIcons();
      enhanceAssignmentCards();
    }, 80);
  }

  function installHooks() {
    const previousRenderAssignment = window.renderAssignmentStageFromSupabase;
    if (typeof previousRenderAssignment === 'function' && !previousRenderAssignment.__chips620) {
      const patched = async function renderAssignmentStageChips620() {
        const result = await previousRenderAssignment.apply(this, arguments);
        await refreshChipState();
        enhanceAssignmentCards();
        return result;
      };
      patched.__chips620 = true;
      patched.__previous = previousRenderAssignment;
      window.renderAssignmentStageFromSupabase = patched;
      window.renderAtribuicao = patched;
    }

    const previousSetTab = window.setAtribTab;
    if (typeof previousSetTab === 'function' && !previousSetTab.__chips620) {
      const patchedSetTab = function setAtribTabChips620() {
        const result = previousSetTab.apply(this, arguments);
        setTimeout(enhanceAssignmentCards, 120);
        return result;
      };
      patchedSetTab.__chips620 = true;
      patchedSetTab.__previous = previousSetTab;
      window.setAtribTab = patchedSetTab;
    }

    const previousSwitchPanel = window.switchPanel;
    if (typeof previousSwitchPanel === 'function' && !previousSwitchPanel.__chips620) {
      const patchedSwitchPanel = function switchPanelChips620(panel) {
        const result = previousSwitchPanel.apply(this, arguments);
        if (['atribuicao', 'assignment', 'panel-atribuicao'].includes(panel)) {
          setTimeout(async () => {
            await refreshChipState();
            enhanceAssignmentCards();
          }, 160);
        }
        scheduleVisualRepair();
        return result;
      };
      patchedSwitchPanel.__chips620 = true;
      patchedSwitchPanel.__previous = previousSwitchPanel;
      window.switchPanel = patchedSwitchPanel;
    }
  }

  function boot() {
    repairDomText();
    installSvgIcons();
    installHooks();
    let hookAttempts = 0;
    const retryHooks = () => {
      hookAttempts++;
      installHooks();
      if (!window.renderAssignmentStageFromSupabase?.__chips620 && hookAttempts < 12) {
        setTimeout(retryHooks, 120);
      }
    };
    if (!window.renderAssignmentStageFromSupabase?.__chips620) setTimeout(retryHooks, 120);

    window.assignLeadToChipRebuild620 = assignLeadToChip;
    window.refreshChipsRebuild620 = refreshChipState;
    window.repairInterfaceEncodingRebuild620 = function repairInterfaceEncodingRebuild620() {
      repairDomText();
      installSvgIcons();
      enhanceAssignmentCards();
    };

    if (!window.__crm620Observer && document.body) {
      window.__crm620Observer = new MutationObserver(scheduleVisualRepair);
      window.__crm620Observer.observe(document.body, { childList: true, subtree: true });
    }

    if (document.getElementById('panel-atribuicao')?.classList.contains('active')) {
      refreshChipState().then(enhanceAssignmentCards);
    }
  }

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

/* CRM Rebuild Fase 6.23 - Persistencia e conexao dos chips */
(function () {
  const SUPABASE_URL = 'https://txyknazfufashgzlxkqh.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_ClGVAmaiS4tNWe8W_4EPew_aPvAzK0E';
  const MAX_HYDRATE_ATTEMPTS = 18;

  const state = {
    chips: [],
    hydrating: false
  };

  function clean(value, fallback = '') {
    const text = String(value ?? '').trim();
    return text || fallback;
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[char]));
  }

  function normalizeEvolutionUrl(value = '') {
    let url = clean(value).replace(/\/+$/, '');
    if (!url) return '';
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    return url.replace(/\/+$/, '');
  }

  function stableChipId(instance = '', name = '') {
    const base = clean(instance) || clean(name) || String(Date.now());
    return 'chip_' + base
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 64);
  }

  function getClient() {
    try {
      if (typeof sbClient !== 'undefined' && sbClient?.from) return sbClient;
    } catch (_) {}
    return window.supabaseClient || window.crmSupabase || window.sb || null;
  }

  async function getCurrentUser() {
    try {
      const client = getClient();
      if (client?.auth?.getUser) {
        const { data } = await client.auth.getUser();
        if (data?.user?.id) return data.user;
      }
    } catch (_) {}
    try {
      if (typeof currentUser !== 'undefined' && currentUser?.id) return currentUser;
    } catch (_) {}
    return window.currentUser || null;
  }

  async function getHeaders(content = false) {
    let headers = {};
    try {
      if (typeof getSupabaseAuthHeadersV423 === 'function') {
        headers = await getSupabaseAuthHeadersV423(content ? { 'Content-Type': 'application/json' } : {});
      }
    } catch (_) {}

    try {
      const client = getClient();
      if (!headers.Authorization && client?.auth?.getSession) {
        const { data } = await client.auth.getSession();
        const token = data?.session?.access_token || '';
        if (token) headers.Authorization = `Bearer ${token}`;
      }
    } catch (_) {}

    headers = {
      ...headers,
      apikey: headers.apikey || SUPABASE_KEY
    };
    if (!headers.Authorization) headers.Authorization = `Bearer ${SUPABASE_KEY}`;
    if (content && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    return headers;
  }

  async function readJson(response) {
    const body = await response.text();
    return body ? JSON.parse(body) : null;
  }

  function normalizeChip(row = {}) {
    const instance = clean(row.instance || row.instance_name || row.instanceName || row.name);
    const name = clean(row.name || row.nome || row.label || row.phone || instance, 'Chip');
    const id = clean(row.chip_id || row.chipId || row.id || instance, stableChipId(instance, name));
    const url = normalizeEvolutionUrl(row.url || row.base_url || row.baseUrl || row.evolution_url || row.evolutionUrl);
    const key = clean(row.api_key || row.apiKey || row.key || row.apikey || row.token);
    const status = row.active === false ? 'disabled' : clean(row.status || row.connection_state || row.connectionState, 'saved');

    return {
      ...row,
      id: String(id),
      chip_id: String(id),
      dbId: row.dbId || row.id || null,
      name,
      nome: name,
      label: name,
      instance,
      instance_name: instance,
      url,
      baseUrl: url,
      base_url: url,
      evolutionUrl: url,
      evolution_url: url,
      key,
      apiKey: key,
      api_key: key,
      status,
      connectionState: clean(row.connectionState || row.connection_state || status, status),
      active: row.active !== false,
      dailyLimit: Number(row.dailyLimit || row.daily_limit || 120),
      blockSize: Number(row.blockSize || row.block_size || 30),
      intervalSeconds: Number(row.intervalSeconds || row.interval_seconds || 120),
      blocks: Array.isArray(row.blocks) ? row.blocks : ['08:00', '10:00', '12:00', '14:00']
    };
  }

  function dedupeChips(chips = []) {
    const byKey = new Map();
    chips.map(normalizeChip).forEach((chip) => {
      const key = clean(chip.id || chip.instance || chip.name);
      if (!key || !chip.instance) return;
      const existing = byKey.get(key) || {};
      byKey.set(key, { ...existing, ...chip });
    });
    return [...byKey.values()];
  }

  function localChips() {
    try {
      if (window.getChips?.__chips623) return window.getChips.__previous();
      if (typeof window.getChips === 'function') return window.getChips() || [];
    } catch (_) {}
    return [];
  }

  function publishChips(chips = []) {
    const normalized = dedupeChips(chips);
    state.chips = normalized;
    window.__crmChipsCache = normalized.map(normalizeChip);

    try {
      if (typeof storeWhatsappChipsCacheV426 === 'function') {
        storeWhatsappChipsCacheV426(normalized);
      }
    } catch (_) {}

    try {
      if (typeof saveOperationalKey === 'function' && typeof CHIPS_KEY !== 'undefined') {
        saveOperationalKey(CHIPS_KEY, normalized.map(normalizeChip), 'chips-623-hydrate');
      }
    } catch (_) {}

    try {
      if (typeof updateChipsBadge === 'function') updateChipsBadge();
      if (typeof renderConfiguracoes === 'function') renderConfiguracoes();
      if (typeof renderChipsPanel === 'function') renderChipsPanel();
      if (document.getElementById('panel-fila-zap')?.classList.contains('active') && typeof renderFilaZap === 'function') renderFilaZap();
    } catch (_) {}

    return normalized;
  }

  async function fetchPersistedChips() {
    const user = await getCurrentUser();
    if (!user?.id) return [];

    const params = new URLSearchParams({
      select: '*',
      user_id: `eq.${user.id}`,
      order: 'updated_at.desc'
    });

    const response = await fetch(`${SUPABASE_URL}/rest/v1/whatsapp_instances?${params.toString()}`, {
      headers: await getHeaders()
    });
    const data = await readJson(response);
    if (!response.ok) throw data || new Error(`Falha ao carregar chips (${response.status}).`);

    const email = clean(user.email).toLowerCase();
    return (Array.isArray(data) ? data : [])
      .filter((row) => row.active !== false)
      .filter((row) => {
        const rowEmail = clean(row.user_email).toLowerCase();
        return !rowEmail || !email || rowEmail === email;
      })
      .map(normalizeChip);
  }

  async function hydrateChips() {
    if (state.hydrating) return state.chips;
    const user = await getCurrentUser();
    if (!user?.id) return state.chips;

    state.hydrating = true;
    try {
      const remote = await fetchPersistedChips();
      window.__crmChipsAuthoritativeV626 = true;
      const merged = publishChips(remote);
      return merged;
    } catch (error) {
      console.warn('[rebuild623] falha ao hidratar chips:', error);
      return publishChips(localChips());
    } finally {
      state.hydrating = false;
    }
  }

  async function rpcUpsertChip(chip) {
    const user = await getCurrentUser();
    if (!user?.id) throw new Error('Usuario autenticado nao encontrado.');

    const normalized = normalizeChip(chip);
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rpc_whatsapp_instance_upsert`, {
      method: 'POST',
      headers: await getHeaders(true),
      body: JSON.stringify({
        p_user_id: user.id,
        p_user_email: clean(user.email).toLowerCase(),
        p_chip_id: normalized.id,
        p_name: normalized.name,
        p_instance: normalized.instance,
        p_url: normalized.url,
        p_api_key: normalized.key,
        p_payload: {
          dailyLimit: normalized.dailyLimit,
          blockSize: normalized.blockSize,
          intervalSeconds: normalized.intervalSeconds,
          blocks: normalized.blocks,
          status: normalized.status,
          source: 'fase-6.23'
        }
      })
    });
    const data = await readJson(response);
    if (!response.ok) throw data || new Error(`Falha ao salvar chip (${response.status}).`);
    return normalizeChip(data?.chip || data || normalized);
  }

  async function rpcDeleteChip(chipId) {
    const user = await getCurrentUser();
    if (!user?.id) throw new Error('Usuario autenticado nao encontrado.');

    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rpc_whatsapp_instance_delete`, {
      method: 'POST',
      headers: await getHeaders(true),
      body: JSON.stringify({
        p_user_id: user.id,
        p_chip_id: chipId
      })
    });
    const data = await readJson(response);
    if (!response.ok) throw data || new Error(`Falha ao remover chip (${response.status}).`);
    return data;
  }

  function chipFromModal() {
    const name = clean(document.getElementById('chipNome')?.value);
    const url = normalizeEvolutionUrl(document.getElementById('chipUrl')?.value);
    const instance = clean(document.getElementById('chipInstance')?.value);
    const key = clean(document.getElementById('chipKey')?.value);
    const existing = [...localChips(), ...state.chips].find((chip) => chip.instance === instance || chip.name === name);

    return normalizeChip({
      ...(existing || {}),
      id: existing?.id || stableChipId(instance, name),
      chip_id: existing?.id || stableChipId(instance, name),
      name,
      nome: name,
      label: name,
      url,
      baseUrl: url,
      evolutionUrl: url,
      instance,
      instance_name: instance,
      key,
      apiKey: key,
      status: existing?.status || 'saved',
      connectionState: existing?.connectionState || 'saved',
      active: true,
      updatedAt: new Date().toISOString()
    });
  }

  async function testEvolutionConnection(chip) {
    const normalized = normalizeChip(chip);
    if (!normalized.url || !normalized.instance || !normalized.key) {
      return { ok: false, error: 'dados incompletos' };
    }

    try {
      const response = await fetch(`${normalized.url}/instance/connectionState/${encodeURIComponent(normalized.instance)}`, {
        method: 'GET',
        headers: { apikey: normalized.key }
      });
      const data = await response.json().catch(() => ({}));
      const connection = data?.instance?.state || data?.state || data?.connectionState || '';
      return { ok: response.ok, state: connection || (response.ok ? 'reachable' : ''), data, status: response.status };
    } catch (error) {
      return { ok: false, error: error?.message || 'falha ao testar conexao' };
    }
  }

  async function saveChipFromModal() {
    const chip = chipFromModal();
    if (!chip.name || !chip.url || !chip.instance || !chip.key) {
      if (typeof notify === 'function') notify('// preencha todos os campos do chip', 'err');
      return;
    }

    const optimistic = publishChips([...localChips().filter((item) => item.id !== chip.id && item.instance !== chip.instance), { ...chip, _syncStatus: 'saving' }]);
    try {
      if (typeof fecharChipModal === 'function') fecharChipModal();
      if (typeof notify === 'function') notify('Salvando chip no Supabase...');
      const saved = await rpcUpsertChip(chip);
      const test = await testEvolutionConnection(saved);
      const connectedStatus = test.ok ? (test.state || 'reachable') : 'saved';
      const finalChip = normalizeChip({ ...saved, status: connectedStatus, connectionState: connectedStatus });
      publishChips([...optimistic.filter((item) => item.id !== finalChip.id && item.instance !== finalChip.instance), finalChip]);
      await hydrateChips();
      if (typeof notify === 'function') {
        notify(test.ok ? `Chip salvo e acessivel: ${connectedStatus}` : 'Chip salvo. Abra o QR Code para conectar a instancia.', test.ok ? '' : 'warn');
      }
    } catch (error) {
      console.error('[rebuild623] erro ao salvar chip:', error);
      publishChips(optimistic.map((item) => item.id === chip.id ? { ...item, _syncStatus: 'pending', _syncError: error?.message || error } : item));
      if (typeof notify === 'function') notify(error?.message || 'Falha ao salvar chip. Rode o SQL 6.23.', 'err');
    }
  }

  async function loadWhatsappChipsCompat() {
    return hydrateChips();
  }

  async function persistWhatsappChipsCompat(list = []) {
    const chips = dedupeChips(list);
    const saved = [];
    for (const chip of chips) {
      saved.push(await rpcUpsertChip(chip));
    }
    publishChips(saved);
    return { ok: true, count: saved.length };
  }

  async function removeChip(chipId) {
    const current = dedupeChips([...localChips(), ...state.chips]);
    const chip = current.find((item) => item.id === chipId || item.instance === chipId);
    window.__crmChipsAuthoritativeV626 = true;
    publishChips(current.filter((item) => item.id !== chipId && item.instance !== chipId));

    try {
      await rpcDeleteChip(chip?.id || chipId);
      if (typeof notify === 'function') notify('Chip removido.');
    } catch (error) {
      console.error('[rebuild623] erro ao remover chip:', error);
      if (chip) publishChips([...state.chips, chip]);
      if (typeof notify === 'function') notify(error?.message || 'Falha ao remover chip.', 'err');
    }
  }

  async function renderQrForChip(chip) {
    const normalized = normalizeChip(chip);
    const qrWrap = document.getElementById('qrWrap');
    if (!qrWrap) return;
    qrWrap.innerHTML = '<div style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--muted)">Verificando instancia...</div>';

    const stateCheck = await testEvolutionConnection(normalized);
    if (stateCheck.ok && ['open', 'connected'].includes(String(stateCheck.state || '').toLowerCase())) {
      qrWrap.innerHTML = '<div style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--ok)">Instancia ja conectada.</div>';
      await rpcUpsertChip({ ...normalized, status: stateCheck.state, connectionState: stateCheck.state }).catch(() => {});
      return;
    }

    try {
      const response = await fetch(`${normalized.url}/instance/connect/${encodeURIComponent(normalized.instance)}`, {
        headers: { apikey: normalized.key }
      });
      const data = await response.json().catch(() => ({}));
      const qr = data.qrcode?.base64 || data.base64 || data.qr || data.code || '';
      if (qr) {
        qrWrap.innerHTML = `<img src="${qr.startsWith('data:') ? qr : 'data:image/png;base64,' + qr}" alt="QR Code"/>`;
      } else {
        qrWrap.innerHTML = '<div style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--warning)">QR nao retornado. Confira a instancia na Evolution API.</div>';
      }
    } catch (error) {
      qrWrap.innerHTML = `<div style="font-family:'DM Mono',monospace;font-size:10px;color:var(--error)">Erro ao gerar QR Code: ${esc(error?.message || error)}</div>`;
    }
  }

  async function verQrChipCompat(id) {
    const chip = dedupeChips([...localChips(), ...state.chips]).find((item) => item.id === id || item.instance === id);
    if (!chip) {
      if (typeof notify === 'function') notify('Chip nao encontrado. Atualize a lista.', 'warn');
      await hydrateChips();
      return;
    }
    window.qrChipIdAtivo = chip.id;
    const title = document.getElementById('qrChipNome');
    if (title) title.textContent = chip.name;
    const modal = document.getElementById('qrModal');
    if (modal) modal.classList.add('open');
    await renderQrForChip(chip);
  }

  function installGetChipsPatch() {
    if (window.getChips?.__chips623) return;
    const previous = window.getChips;
    const patched = function getChipsRebuild623() {
      let oldList = [];
      try {
        oldList = typeof previous === 'function' ? previous.apply(this, arguments) || [] : [];
      } catch (_) {}
      const authoritative = dedupeChips([...(window.__crmChipsCache || []), ...state.chips]);
      if (window.__crmChipsAuthoritativeV626) return authoritative;
      return dedupeChips([...oldList, ...(window.__crmChipsCache || []), ...state.chips]);
    };
    patched.__chips623 = true;
    patched.__previous = previous;
    window.getChips = patched;
  }

  function installSaveChipsPatch() {
    if (window.saveChips?.__chips623) return;
    const previous = window.saveChips;
    const patched = function saveChipsRebuild623(list) {
      const normalized = publishChips(list || []);
      try {
        if (typeof previous === 'function') previous.call(this, normalized);
      } catch (error) {
        console.warn('[rebuild623] saveChips legado falhou:', error);
      }
      persistWhatsappChipsCompat(normalized).catch((error) => {
        console.warn('[rebuild623] persistencia async falhou:', error);
      });
    };
    patched.__chips623 = true;
    patched.__previous = previous;
    window.saveChips = patched;
  }

  function installHooks() {
    installGetChipsPatch();
    installSaveChipsPatch();

    window.CRMListWhatsappInstances = fetchPersistedChips;
    window.CRMHydrateChipsCache = hydrateChips;
    window.loadWhatsappChipsFromSupabaseV22 = loadWhatsappChipsCompat;
    window.persistWhatsappChipsToSupabaseV22 = persistWhatsappChipsCompat;
    window.salvarChip = saveChipFromModal;
    window.verQRChip = verQrChipCompat;
    window.carregarQR = renderQrForChip;
    window.deletarChip = removeChip;
    window.persistWhatsappChipRebuild623 = rpcUpsertChip;
    window.hydrateWhatsappChipsRebuild623 = hydrateChips;

    const previousHydrate = window.hydrateAuthenticatedUserDataV436;
    if (typeof previousHydrate === 'function' && !previousHydrate.__chips623) {
      const patchedHydrate = async function hydrateAuthenticatedUserDataChips623() {
        const result = await previousHydrate.apply(this, arguments);
        await hydrateChips();
        return result;
      };
      patchedHydrate.__chips623 = true;
      patchedHydrate.__previous = previousHydrate;
      window.hydrateAuthenticatedUserDataV436 = patchedHydrate;
    }
  }

  function boot() {
    installHooks();
    let attempts = 0;
    const retry = async () => {
      attempts++;
      installHooks();
      const user = await getCurrentUser();
      if (user?.id) {
        await hydrateChips();
        return;
      }
      if (attempts < MAX_HYDRATE_ATTEMPTS) setTimeout(retry, 500);
    };
    retry();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

/* CRM Rebuild Fase 6.24 - Finalizador apos todos os blocos */
(function () {
  function reinstall624() {
    try {
      if (window.CRMRebuild624 && typeof window.CRMRebuild624.install === 'function') {
        window.CRMRebuild624.install();
      }
    } catch (error) {
      console.warn('[rebuild624] finalizador final falhou:', error);
    }
  }

  function boot() {
    reinstall624();
    setTimeout(reinstall624, 300);
    setTimeout(reinstall624, 900);
    setTimeout(reinstall624, 1800);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

/* CRM Rebuild Fase 6.25 - Finalizador apos chips persistidos */
(function () {
  function refresh625() {
    try {
      if (typeof window.refreshValidationChipsRebuild625 === 'function') {
        window.refreshValidationChipsRebuild625();
      }
    } catch (error) {
      console.warn('[rebuild625] finalizador final falhou:', error);
    }
  }

  function boot() {
    refresh625();
    setTimeout(refresh625, 500);
    setTimeout(refresh625, 1500);
    setTimeout(refresh625, 3000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
