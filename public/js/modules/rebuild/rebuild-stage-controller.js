/* PATCH — Validação lendo leads do banco novo */
(function () {
  const SUPABASE_URL = 'https://txyknazfufashgzlxkqh.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_ClGVAmaiS4tNWe8W_4EPew_aPvAzK0E';

  async function getHeaders() {
    return {
      apikey: 'sb_publishable_ClGVAmaiS4tNWe8W_4EPew_aPvAzK0E',
      Authorization: 'Bearer sb_publishable_ClGVAmaiS4tNWe8W_4EPew_aPvAzK0E'
    };
  }

  async function fetchValidationLeads() {
    const headers = {
      apikey: 'sb_publishable_ClGVAmaiS4tNWe8W_4EPew_aPvAzK0E',
      Authorization: 'Bearer sb_publishable_ClGVAmaiS4tNWe8W_4EPew_aPvAzK0E'
    };
  
    const url =
      `${SUPABASE_URL}/rest/v1/v_lead_cards_persistent` +
      `?select=*` +
      `&current_stage=eq.validation` +
      `&order=created_at.desc`;
  
    const res = await fetch(url, { headers });
    const data = await res.json();
  
    if (!res.ok) throw data;
  
    return Array.isArray(data) ? data : [];
  }

  function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, m => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[m]));
  }

  function renderValidationLeadCard(lead) {
    return `
      <div class="empresa-card" data-lead-id="${esc(lead.id)}">
        <div class="empresa-info">
          <div class="empresa-nome">${esc(lead.company_name || 'Empresa sem nome')}</div>
          <div class="empresa-meta">
            <span class="q-badge info">⭐ ${esc(lead.rating || '-')}</span>
            <span class="q-badge info">💬 ${esc(lead.reviews_count || 0)} avaliações</span>
            <span class="q-badge ${lead.phone ? 'ok' : 'warn'}">${lead.phone ? esc(lead.phone) : 'Sem telefone'}</span>
            <span class="q-badge">${esc([lead.city, lead.state].filter(Boolean).join(' - '))}</span>
            <span class="q-badge">${lead.website ? 'Com site' : 'Sem site'}</span>
          </div>
        </div>
        <div class="empresa-actions">
          <button class="add-btn" type="button">Ficha</button>
        </div>
      </div>
    `;
  }

  async function renderValidationStageFromSupabase() {
    const box = document.getElementById('valComSiteList');
    if (!box) return;
  
    try {
      const leads = await fetchValidationLeads();
  
      const waiting = leads.filter(l => l.current_status === 'pending_validation');
      const validated = leads.filter(l => l.current_status === 'whatsapp_validated');
  
      const countA = document.getElementById('valCountSemZap');
      const countB = document.getElementById('valCountComZap');
  
      const waitBox = document.getElementById('valComSiteList');
      const validBox = document.getElementById('valZapList') || document.getElementById('valComZapList');
  
      if (countA) countA.textContent = String(waiting.length);
      if (countB) countB.textContent = String(validated.length);
  
      if (waitBox) {
        waitBox.innerHTML = waiting.length
          ? waiting.map(renderValidationLeadCard).join('')
          : '<div class="table-empty">// nenhum lead aguardando validação</div>';
      }
  
      if (validBox) {
        validBox.innerHTML = validated.length
          ? validated.map(renderValidationLeadCard).join('')
          : '<div class="table-empty">// nenhum número validado ainda</div>';
      }
    } catch (err) {
      console.error('[Validação] erro ao carregar leads:', err);
      box.innerHTML = '<div class="table-empty">Erro ao carregar leads da validação.</div>';
    }
  }

  window.renderValidationStageFromSupabase = renderValidationStageFromSupabase;

  const oldSwitchPanel = window.switchPanel;
  window.switchPanel = function patchedSwitchPanel(panel) {
    const result = typeof oldSwitchPanel === 'function'
      ? oldSwitchPanel.apply(this, arguments)
      : undefined;

    if (panel === 'validacao' || panel === 'validation' || panel === 'panel-validacao') {
      setTimeout(renderValidationStageFromSupabase, 80);
    }

    return result;
  };

  const oldImportarLeads = window.importarLeads;
  window.importarLeads = async function patchedImportarLeads() {
    const result = typeof oldImportarLeads === 'function'
      ? await oldImportarLeads.apply(this, arguments)
      : null;

    setTimeout(renderValidationStageFromSupabase, 150);

    return result;
  };

  document.addEventListener('DOMContentLoaded', () => {
    const activeValidation = document.getElementById('panel-validacao')?.classList.contains('active');
    if (activeValidation) renderValidationStageFromSupabase();
  });
})();

/* PATCH — impedir render antigo de apagar Validação */
(function () {
  const oldRenderValidacao = window.renderValidacao;

  window.renderValidacao = async function patchedRenderValidacao() {
    if (typeof window.renderValidationStageFromSupabase === 'function') {
      return await window.renderValidationStageFromSupabase();
    }

    if (typeof oldRenderValidacao === 'function') {
      return oldRenderValidacao.apply(this, arguments);
    }
  };

  const oldUpdateBadges = window.updateBadges;

  window.updateBadges = function patchedUpdateBadges() {
    const result = typeof oldUpdateBadges === 'function'
      ? oldUpdateBadges.apply(this, arguments)
      : undefined;

    if (document.getElementById('panel-validacao')?.classList.contains('active')) {
      setTimeout(() => {
        if (typeof window.renderValidationStageFromSupabase === 'function') {
          window.renderValidationStageFromSupabase();
        }
      }, 100);
    }

    return result;
  };
})();

/* PATCH — abas Validação usando um único painel e trocando conteúdo */
(function () {
  let validationCache = {
    waitingHtml: '',
    validatedHtml: '',
    waitingCount: 0,
    validatedCount: 0
  };

  const oldRenderValidation = window.renderValidationStageFromSupabase;

  window.renderValidationStageFromSupabase = async function patchedValidationTabsSinglePanel() {
    await oldRenderValidation.apply(this, arguments);

    const list = document.getElementById('valComSiteList');
    if (!list) return;

    validationCache.waitingHtml = list.innerHTML;
    validationCache.waitingCount = Number(document.getElementById('valCountSemZap')?.textContent || 0);
    validationCache.validatedCount = Number(document.getElementById('valCountComZap')?.textContent || 0);

    if (validationCache.validatedCount === 0) {
      validationCache.validatedHtml = '<div class="table-empty">// nenhum número validado ainda</div>';
    }
  };

  function showWaiting() {
    const list = document.getElementById('valComSiteList');
    if (!list) return;

    document.getElementById('valResultTabPendentes')?.classList.add('active');
    document.getElementById('valResultTabValidados')?.classList.remove('active');

    list.innerHTML = validationCache.waitingHtml || '<div class="table-empty">// nenhum lead aguardando validação</div>';
  }

  function showValidated() {
    const list = document.getElementById('valComSiteList');
    if (!list) return;

    document.getElementById('valResultTabValidados')?.classList.add('active');
    document.getElementById('valResultTabPendentes')?.classList.remove('active');

    list.innerHTML = validationCache.validatedHtml || '<div class="table-empty">// nenhum número validado ainda</div>';
  }

  function setupTabs() {
    const waitTab = document.getElementById('valResultTabPendentes');
    const validTab = document.getElementById('valResultTabValidados');

    if (waitTab) waitTab.onclick = showWaiting;
    if (validTab) validTab.onclick = showValidated;
  }

  document.addEventListener('DOMContentLoaded', setupTabs);
  setTimeout(setupTabs, 500);

  window.showValidationWaiting = showWaiting;
  window.showValidationValidated = showValidated;
})();
