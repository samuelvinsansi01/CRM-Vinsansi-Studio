/* CRM Rebuild Fase 6.11 — Corrige fluxo Importação → Validação → Início */
(function(){
  const SUPABASE_URL = 'https://txyknazfufashgzlxkqh.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_ClGVAmaiS4tNWe8W_4EPew_aPvAzK0E';

  function esc(v){
    return (v == null ? '' : String(v)).replace(/[&<>"]/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[s]));
  }

  function getUserId(){
    try {
      if (typeof getCurrentSupabaseUserIdV412 === 'function') {
        const id = getCurrentSupabaseUserIdV412();
        if (id && typeof id === 'string') return id;
      }
    } catch(e){}
    return window.currentUser?.id || (typeof currentUser !== 'undefined' ? currentUser?.id : null);
  }

  async function getHeaders(){
    if (typeof getSupabaseAuthHeadersV423 === 'function') {
      try {
        const h = await getSupabaseAuthHeadersV423();
        if (h?.apikey && h?.Authorization) return h;
      } catch(e){}
    }
    return {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`
    };
  }

  async function api(path, options = {}){
    const headers = await getHeaders();
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      ...options,
      headers: {
        ...headers,
        'Content-Type': 'application/json',
        'Prefer': options.prefer || 'return=representation',
        ...(options.headers || {})
      }
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (!res.ok) throw json || new Error(`Erro Supabase ${res.status}`);
    return json;
  }

  async function normalizeImportedLeads(){
    try {
      await api('rpc/rpc_rebuild_normalize_imported_leads', { method:'POST', body: '{}' });
    } catch(e) {
      console.warn('[CRM 6.11] Não normalizei imported → validation:', e);
    }
  }

  async function fetchView(viewName){
    const userId = getUserId();
    if (!userId) return [];
    const query = `select=*&user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=500`;
    return await api(`${viewName}?${query}`, { method:'GET' });
  }

  function renderInicioFromNewDb(rows){
    const tbody = document.getElementById('inicioTbody');
    if (!tbody) return;

    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="table-empty">Nenhum lead ativo. Leads importados aparecem primeiro em Validação.</td></tr>';
      return;
    }

    tbody.innerHTML = rows.map(l => `
      <tr>
        <td><div class="td-name">${esc(l.company_name)}</div><small>${esc([l.city,l.state].filter(Boolean).join(', '))}</small></td>
        <td class="td-link">${l.instagram_url ? `<a href="${esc(l.instagram_url)}" target="_blank">Instagram</a>` : '<span class="td-missing">—</span>'}</td>
        <td class="td-link">${l.website ? `<a href="${esc(l.website)}" target="_blank">Site</a>` : '<span class="td-missing">Sem site</span>'}</td>
        <td>${esc(l.phone || l.normalized_phone || '—')}</td>
        <td><span class="q-badge info">${esc(l.current_stage || '')}</span></td>
        <td>${esc(l.whatsapp_status || 'unknown')}</td>
        <td></td>
      </tr>
    `).join('');
  }

  function renderValidationFromNewDb(rows){
    const box = document.getElementById('valComSiteList');
    if (!box) return;

    const countPend = document.getElementById('valCountSemZap');
    if (countPend) countPend.textContent = String(rows.length);

    if (!rows.length) {
      box.innerHTML = '<div class="table-empty">// nenhuma empresa aguardando validação</div>';
      return;
    }

    box.innerHTML = rows.map(l => `
      <div class="empresa-card" data-lead-id="${esc(l.id)}">
        <div class="empresa-info">
          <div class="empresa-nome">${esc(l.company_name)}</div>
          <div class="empresa-meta">
            <span class="q-badge warn">Aguardando validação</span>
            <span class="empresa-phone">${esc(l.phone || l.normalized_phone || 'sem telefone')}</span>
            <span class="empresa-site">${l.website ? `<a href="${esc(l.website)}" target="_blank">Site</a>` : 'Sem site próprio'}</span>
            ${l.google_maps_url ? `<span class="empresa-site"><a href="${esc(l.google_maps_url)}" target="_blank">Maps</a></span>` : ''}
          </div>
        </div>
      </div>
    `).join('');
  }

  async function refreshRebuildImportFlow(){
    await normalizeImportedLeads();
    const [inicio, validation] = await Promise.all([
      fetchView('v_rebuild_inicio_active_leads').catch(() => []),
      fetchView('v_rebuild_validation_leads').catch(() => [])
    ]);
    renderInicioFromNewDb(inicio || []);
    renderValidationFromNewDb(validation || []);
    if (typeof updateBadges === 'function') {
      try { updateBadges(); } catch(e){}
    }
  }

  const oldImportar = window.importarLeads;
  window.refreshRebuildImportFlow = refreshRebuildImportFlow;

  window.importarLeads = async function(){
    const result = typeof oldImportar === 'function' ? await oldImportar.apply(this, arguments) : null;
    await refreshRebuildImportFlow();
    return result;
  };

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(refreshRebuildImportFlow, 900);
    setTimeout(refreshRebuildImportFlow, 2500);
  });
})();
