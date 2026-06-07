/* CRM Rebuild Fase 6.15 — Render da tela Validação usando o schema novo */
(function () {
  const SUPABASE_URL = 'https://txyknazfufashgzlxkqh.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_ClGVAmaiS4tNWe8W_4EPew_aPvAzK0E';
  const PAGE_SIZE = 40;

  let validationRowsCache = [];
  let validationPage = 1;
  let installed = false;

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function fmt(value, fallback = '—') {
    const text = String(value == null ? '' : value).trim();
    return text || fallback;
  }

  function normalizePhoneLabel(phone) {
    const value = fmt(phone, '—');
    return value === '—' ? value : value.replace(/^55(\d{2})(\d+)/, '+55 $1 $2');
  }

  function getUserId() {
    if (typeof getCurrentSupabaseUserIdV412 === 'function') {
      try {
        const id = getCurrentSupabaseUserIdV412();
        if (id && typeof id === 'string') return Promise.resolve(id);
        if (id && typeof id.then === 'function') return id;
      } catch (_) {}
    }

    if (window.currentUser?.id) return Promise.resolve(window.currentUser.id);

    try {
      if (typeof currentUser !== 'undefined' && currentUser?.id) {
        return Promise.resolve(currentUser.id);
      }
    } catch (_) {}

    return Promise.resolve(null);
  }

  async function getHeaders() {
    if (typeof getSupabaseAuthHeadersV423 === 'function') {
      try {
        const headers = await getSupabaseAuthHeadersV423();
        if (headers?.apikey) return headers;
      } catch (_) {}
    }

    return {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`
    };
  }

  async function fetchValidationLeads() {
    const userId = await getUserId();
    if (!userId) throw new Error('Usuário não encontrado para carregar Validação.');

    const headers = await getHeaders();
    const query = new URLSearchParams({
      select: '*',
      user_id: `eq.${userId}`,
      order: 'created_at.desc'
    });

    const response = await fetch(`${SUPABASE_URL}/rest/v1/v_validation_leads_rebuild?${query.toString()}`, {
      method: 'GET',
      headers
    });

    const text = await response.text();
    const data = text ? JSON.parse(text) : [];

    if (!response.ok) {
      throw data || new Error(`Falha ao carregar Validação (${response.status}).`);
    }

    return Array.isArray(data) ? data : [];
  }

  function renderCounters(rows) {
    const pending = rows.filter(row => row.current_status === 'pending_validation').length;
    const valid = rows.filter(row => row.whatsapp_status === 'valid').length;

    const semZap = document.getElementById('valCountSemZap');
    if (semZap) semZap.textContent = String(pending || rows.length || 0);

    const comZap = document.getElementById('valCountComZap');
    if (comZap) comZap.textContent = String(valid || 0);

    const badgeValidacao = document.getElementById('badge-validacao');
    if (badgeValidacao) badgeValidacao.textContent = String(rows.length || 0);
  }

  function renderPagination(total) {
    const box = document.getElementById('valPagination');
    if (!box) return;

    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (pages <= 1) {
      box.innerHTML = '';
      return;
    }

    box.innerHTML = `
      <div class="btn-row" style="margin-top:12px;justify-content:flex-end">
        <button class="btn btn-ghost" style="font-size:10px;padding:6px 10px" ${validationPage <= 1 ? 'disabled' : ''} onclick="CRMValidationStageRenderer.goPage(${validationPage - 1})">Anterior</button>
        <span style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted);padding:7px 4px">Página ${validationPage} de ${pages}</span>
        <button class="btn btn-ghost" style="font-size:10px;padding:6px 10px" ${validationPage >= pages ? 'disabled' : ''} onclick="CRMValidationStageRenderer.goPage(${validationPage + 1})">Próxima</button>
      </div>
    `;
  }

  function renderRows(rows) {
    const list = document.getElementById('valComSiteList');
    if (!list) return;

    const total = rows.length;
    const start = (validationPage - 1) * PAGE_SIZE;
    const pageRows = rows.slice(start, start + PAGE_SIZE);

    if (!total) {
      list.innerHTML = '<div class="table-empty">Nenhum lead aguardando validação.</div>';
      renderPagination(0);
      renderCounters([]);
      return;
    }

    list.innerHTML = pageRows.map(row => {
      const siteLabel = row.website ? 'Com site' : 'Sem site';
      const siteClass = row.website ? 'warn' : 'ok';
      const location = [row.city, row.state_code || row.state].filter(Boolean).join(' / ') || 'Local não informado';
      const mapsLink = row.google_maps_url ? `<a href="${esc(row.google_maps_url)}" target="_blank" rel="noopener" style="color:var(--accent);text-decoration:none">Maps</a>` : 'Maps —';
      const websiteLink = row.website ? `<a href="${esc(row.website)}" target="_blank" rel="noopener" style="color:var(--accent);text-decoration:none">Site</a>` : 'Site —';

      return `
        <div class="empresa-card" data-lead-id="${esc(row.id)}" style="align-items:flex-start">
          <div class="empresa-info">
            <div class="empresa-nome">${esc(row.company_name)}</div>
            <div class="empresa-meta">
              <span class="q-badge info">⭐ ${esc(fmt(row.rating))}</span>
              <span class="q-badge info">${esc(fmt(row.reviews_count, '0'))} avaliações</span>
              <span class="q-badge ${siteClass}">${siteLabel}</span>
              <span class="empresa-phone">${esc(normalizePhoneLabel(row.phone || row.normalized_phone))}</span>
              <span class="empresa-site">${esc(location)}</span>
            </div>
            <div class="empresa-meta" style="margin-top:7px">
              <span class="empresa-site">${websiteLink}</span>
              <span class="empresa-site">${mapsLink}</span>
              ${row.instagram_url ? `<span class="empresa-site"><a href="${esc(row.instagram_url)}" target="_blank" rel="noopener" style="color:var(--accent);text-decoration:none">Instagram</a></span>` : ''}
            </div>
          </div>
          <div class="empresa-actions">
            <span class="q-badge warn">Aguardando validação</span>
          </div>
        </div>
      `;
    }).join('');

    renderPagination(total);
    renderCounters(rows);
  }

  async function renderValidationStageLeads() {
    const list = document.getElementById('valComSiteList');
    if (list) list.innerHTML = '<div class="table-empty">Carregando leads da Validação...</div>';

    try {
      validationRowsCache = await fetchValidationLeads();
      validationPage = Math.min(validationPage, Math.max(1, Math.ceil(validationRowsCache.length / PAGE_SIZE)));
      renderRows(validationRowsCache);
      return validationRowsCache;
    } catch (error) {
      console.error('[CRM 6.15] Falha ao renderizar Validação:', error);
      if (list) list.innerHTML = '<div class="table-empty">Erro ao carregar Validação. Veja o console.</div>';
      return [];
    }
  }

  function goPage(page) {
    const pages = Math.max(1, Math.ceil(validationRowsCache.length / PAGE_SIZE));
    validationPage = Math.max(1, Math.min(page, pages));
    renderRows(validationRowsCache);
  }

  function installSwitchPanelHook() {
    if (installed) return;
    installed = true;

    const originalSwitchPanel = window.switchPanel;
    if (typeof originalSwitchPanel === 'function') {
      window.switchPanel = function patchedSwitchPanel(panel) {
        const result = originalSwitchPanel.apply(this, arguments);
        if (panel === 'validacao') {
          setTimeout(renderValidationStageLeads, 80);
          setTimeout(renderValidationStageLeads, 450);
        }
        return result;
      };
    }

    const originalImportarLeads = window.importarLeads;
    if (typeof originalImportarLeads === 'function') {
      window.importarLeads = async function patchedImportarLeads() {
        const result = await originalImportarLeads.apply(this, arguments);
        setTimeout(renderValidationStageLeads, 300);
        return result;
      };
    }
  }

  function boot() {
    installSwitchPanelHook();

    if (document.getElementById('panel-validacao')?.classList.contains('active')) {
      renderValidationStageLeads();
    }

    setTimeout(() => {
      if (document.getElementById('panel-validacao')?.classList.contains('active')) {
        renderValidationStageLeads();
      }
    }, 900);
  }

  window.CRMValidationStageRenderer = {
    render: renderValidationStageLeads,
    refresh: renderValidationStageLeads,
    goPage
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
