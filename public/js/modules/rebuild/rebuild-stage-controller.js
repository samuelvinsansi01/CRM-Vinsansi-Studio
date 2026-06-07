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

    box.innerHTML = '<div class="table-empty">Carregando leads em validação...</div>';

    try {
      const leads = await fetchValidationLeads();

      const countA = document.getElementById('valCountSemZap');
      const countB = document.getElementById('valCountComZap');

      if (countA) countA.textContent = String(leads.length);
      if (countB) countB.textContent = String(leads.filter(l => l.phone).length);

      if (!leads.length) {
        box.innerHTML = '<div class="table-empty">// nenhum lead aguardando validação</div>';
        return;
      }

      box.innerHTML = leads.map(renderValidationLeadCard).join('');
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

    if (panel === 'validacao') {
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
