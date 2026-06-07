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

/* PATCH — abas da Validação usando a mesma lista */
(function () {
  let validationCache = {
    waiting: [],
    validated: []
  };

  function renderValidationListByTab(tab) {
    const box = document.getElementById('valComSiteList');
    if (!box) return;

    const list = tab === 'validated'
      ? validationCache.validated
      : validationCache.waiting;

    box.innerHTML = list.length
      ? list.map(renderValidationLeadCard).join('')
      : `<div class="table-empty">${
          tab === 'validated'
            ? '// nenhum número validado ainda'
            : '// nenhum lead aguardando validação'
        }</div>`;
  }

  function getActiveValidationTab() {
    const validatedBtn = document.getElementById('valResultTabValidados');
    return validatedBtn?.classList.contains('active') ? 'validated' : 'waiting';
  }

  const oldRender = window.renderValidationStageFromSupabase;

  window.renderValidationStageFromSupabase = async function patchedValidationRenderTabs() {
    try {
      const leads = await fetchValidationLeads();

      validationCache.waiting = leads.filter(l => l.current_status === 'pending_validation');
      validationCache.validated = leads.filter(l => l.current_status === 'whatsapp_validated');

      const countA = document.getElementById('valCountSemZap');
      const countB = document.getElementById('valCountComZap');

      if (countA) countA.textContent = String(validationCache.waiting.length);
      if (countB) countB.textContent = String(validationCache.validated.length);

      renderValidationListByTab(getActiveValidationTab());
    } catch (err) {
      console.error('[Validação] erro ao carregar leads:', err);
      const box = document.getElementById('valComSiteList');
      if (box) box.innerHTML = '<div class="table-empty">Erro ao carregar leads da validação.</div>';
    }
  };

  function bindValidationTabs() {
    const waitBtn = document.getElementById('valResultTabPendentes');
    const validBtn = document.getElementById('valResultTabValidados');

    if (waitBtn) {
      waitBtn.onclick = () => {
        waitBtn.classList.add('active');
        validBtn?.classList.remove('active');
        renderValidationListByTab('waiting');
      };
    }

    if (validBtn) {
      validBtn.onclick = () => {
        validBtn.classList.add('active');
        waitBtn?.classList.remove('active');
        renderValidationListByTab('validated');
      };
    }
  }

  document.addEventListener('DOMContentLoaded', bindValidationTabs);

  setTimeout(bindValidationTabs, 500);
})();
