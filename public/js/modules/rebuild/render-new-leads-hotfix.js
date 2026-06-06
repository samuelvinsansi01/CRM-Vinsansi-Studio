/* CRM Rebuild Fase 6.10 — Renderização dos leads salvos no banco novo */
(function () {
  const SUPABASE_URL = 'https://txyknazfufashgzlxkqh.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_ClGVAmaiS4tNWe8W_4EPew_aPvAzK0E';

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function getUserId() {
    try {
      if (typeof getCurrentSupabaseUserIdV412 === 'function') {
        const maybe = getCurrentSupabaseUserIdV412();
        if (maybe && typeof maybe.then !== 'function') return maybe;
      }
    } catch (_) {}

    if (window.currentUser?.id) return window.currentUser.id;
    try {
      if (typeof currentUser !== 'undefined' && currentUser?.id) return currentUser.id;
    } catch (_) {}

    try {
      const raw = localStorage.getItem('vs_auth_local_user_v423');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.id) return parsed.id;
      }
    } catch (_) {}

    return null;
  }

  async function getAuthHeaders() {
    if (typeof getSupabaseAuthHeadersV423 === 'function') {
      try {
        const h = await getSupabaseAuthHeadersV423();
        if (h?.apikey) return h;
      } catch (_) {}
    }

    return {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`
    };
  }

  function normalizeLead(row) {
    const created = row.created_at ? new Date(row.created_at) : new Date();
    const dateKey = created.toISOString().slice(0, 10);
    const maps = row.google_maps_url || '';
    const cityState = [row.city, row.state_code || row.state].filter(Boolean).join(', ');

    return {
      id: row.id,
      lead_id: row.id,
      source: 'supabase_new_schema',
      status: row.current_status || row.current_stage || 'imported',
      nome: row.company_name || 'Empresa sem nome',
      empresa: row.company_name || 'Empresa sem nome',
      name: row.company_name || 'Empresa sem nome',
      company_name: row.company_name || 'Empresa sem nome',
      categoria: row.category || '',
      category: row.category || '',
      descricao: row.description || '',
      description: row.description || '',
      nota: row.rating,
      rating: row.rating,
      avaliacoes: row.reviews_count,
      reviews: row.reviews_count,
      reviews_count: row.reviews_count,
      whatsapp: row.phone || '',
      phone: row.phone || '',
      phone_normalized: row.normalized_phone || '',
      normalized_phone: row.normalized_phone || '',
      whatsapp_status: row.whatsapp_status || 'unknown',
      site: row.website || '',
      website: row.website || '',
      has_own_site: !!row.has_own_site,
      instagram: row.instagram_url || '',
      instagram_url: row.instagram_url || '',
      instagram_username: row.instagram_username || '',
      maps,
      google_maps_url: maps,
      googleMapsUrl: maps,
      place_id: row.place_id || '',
      pais: row.country || '',
      country: row.country || '',
      estado: row.state || '',
      state: row.state || '',
      uf: row.state_code || '',
      cidade: row.city || '',
      city: row.city || '',
      bairro: row.neighborhood || '',
      neighborhood: row.neighborhood || '',
      endereco: row.address || '',
      address: row.address || '',
      cep: row.zip_code || '',
      zip_code: row.zip_code || '',
      latitude: row.latitude,
      longitude: row.longitude,
      local: cityState,
      current_stage: row.current_stage || 'imported',
      lead_channel: row.lead_channel || 'unknown',
      opportunity: row.opportunity || '',
      lead_score: row.lead_score,
      created_at: row.created_at,
      updated_at: row.updated_at,
      data: dateKey,
      dayKey: dateKey
    };
  }

  async function fetchNewSchemaLeads() {
    const userId = getUserId();
    if (!userId) {
      console.warn('[CRM 6.10] usuário ainda não identificado para carregar leads.');
      return [];
    }

    const headers = await getAuthHeaders();
    const query = new URLSearchParams({
      select: '*',
      user_id: `eq.${userId}`,
      order: 'created_at.desc',
      limit: '1000'
    });

    const res = await fetch(`${SUPABASE_URL}/rest/v1/v_rebuild_leads_with_location?${query.toString()}`, {
      headers
    });

    const text = await res.text();
    const json = text ? JSON.parse(text) : [];

    if (!res.ok) {
      console.warn('[CRM 6.10] falha ao carregar leads do schema novo', json);
      return [];
    }

    return Array.isArray(json) ? json.map(normalizeLead) : [];
  }

  function publishToKnownStores(leads) {
    window.rebuildNewSchemaLeads = leads;
    window.leadsRebuild = leads;
    window.leadsBaseRebuild = leads;

    // Compatibilidade com nomes comuns do CRM antigo, sem apagar objetos se não forem arrays.
    ['leads', 'allLeads', 'empresas', 'weekLeads', 'leadBase'].forEach((key) => {
      try {
        if (Array.isArray(window[key])) window[key] = leads.slice();
      } catch (_) {}
    });
  }

  function renderSimpleInicio(leads) {
    const tbody = document.getElementById('inicioTbody');
    if (!tbody) return;

    if (!leads.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="table-empty">Nenhuma empresa importada no banco novo</td></tr>';
      return;
    }

    tbody.innerHTML = leads.map((l) => {
      const siteHtml = l.website
        ? `<a href="${esc(l.website)}" target="_blank" rel="noopener">Site</a>`
        : '<span class="td-missing">Sem site</span>';

      const instaHtml = l.instagram_url
        ? `<a href="${esc(l.instagram_url)}" target="_blank" rel="noopener">Instagram</a>`
        : '<span class="td-missing">-</span>';

      return `
        <tr data-lead-id="${esc(l.id)}">
          <td>
            <div class="td-name">${esc(l.company_name)}</div>
            <div class="td-missing">${esc(l.local || l.category || '')}</div>
          </td>
          <td class="td-link">${instaHtml}</td>
          <td class="td-link">${siteHtml}</td>
          <td>${esc(l.phone || '-')}</td>
          <td><span class="q-badge info">${esc(l.current_stage || 'imported')}</span></td>
          <td><span class="td-missing">${esc(l.lead_channel || 'unknown')}</span></td>
          <td>${l.google_maps_url ? `<a class="add-btn" href="${esc(l.google_maps_url)}" target="_blank" rel="noopener">Maps</a>` : ''}</td>
        </tr>`;
    }).join('');
  }

  function renderSimpleLeadBase(leads) {
    const tbody = document.getElementById('leadBaseTbody');
    if (!tbody) return;

    if (!leads.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="table-empty">Nenhum lead salvo no banco novo</td></tr>';
      return;
    }

    tbody.innerHTML = leads.map((l) => `
      <tr data-lead-id="${esc(l.id)}">
        <td><input type="checkbox" data-lead-id="${esc(l.id)}"></td>
        <td>
          <div class="td-name">${esc(l.company_name)}</div>
          <div class="td-missing">${esc(l.category || '')}</div>
        </td>
        <td>${esc(l.phone || '-')}</td>
        <td>${esc(l.local || '-')}</td>
        <td><span class="q-badge info">${esc(l.current_stage || 'imported')}</span></td>
        <td>${esc(l.source || 'supabase')}</td>
        <td>${l.google_maps_url ? `<a class="add-btn" href="${esc(l.google_maps_url)}" target="_blank" rel="noopener">Maps</a>` : ''}</td>
      </tr>
    `).join('');

    const badge = document.getElementById('leadBaseTotalBadge');
    if (badge) badge.textContent = `${leads.length} lead(s)`;
  }

  function updateSimpleBadges(leads) {
    const set = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = String(value);
    };

    set('badge-inicio', leads.length);
    set('badge-importar', leads.length);
    set('badge-validacao', leads.filter(l => ['imported','validation'].includes(l.current_stage)).length);
    set('badge-atribuicao', leads.filter(l => l.current_stage === 'assigned').length);
    set('badge-fila-zap', leads.filter(l => l.current_stage === 'queued').length);
    set('badge-instagram', leads.filter(l => l.lead_channel === 'instagram').length);
  }

  async function loadNewSchemaLeadsToScreen() {
    const leads = await fetchNewSchemaLeads();
    publishToKnownStores(leads);
    renderSimpleInicio(leads);
    renderSimpleLeadBase(leads);
    updateSimpleBadges(leads);
    return leads;
  }

  const previousLoad = window.loadSupabaseLeadsToLocalState;
  window.loadSupabaseLeadsToLocalState = async function () {
    let leads = [];
    try {
      leads = await loadNewSchemaLeadsToScreen();
    } catch (err) {
      console.warn('[CRM 6.10] erro no loader novo', err);
    }

    if (!leads.length && typeof previousLoad === 'function') {
      try { return await previousLoad.apply(this, arguments); } catch (_) {}
    }

    return leads;
  };

  window.loadNewSchemaLeadsToScreen = loadNewSchemaLeadsToScreen;

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => loadNewSchemaLeadsToScreen(), 800);
    setTimeout(() => loadNewSchemaLeadsToScreen(), 2500);
  });
})();
