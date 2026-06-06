(function () {
  'use strict';

  const LOG = '[CRM 6.7 Import Persistence]';

  function notifySafe(message, type) {
    try {
      if (typeof window.notify === 'function') return window.notify(message, type);
      const box = document.getElementById('notify');
      if (box) {
        box.textContent = message;
        box.className = `notify show ${type === 'err' ? 'err' : type === 'warn' ? 'warn' : ''}`;
        setTimeout(() => box.classList.remove('show'), 4500);
      } else {
        console.log(LOG, message);
      }
    } catch (_) {}
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
  }

  function getConfigValue(...keys) {
    for (const key of keys) {
      if (!key) continue;
      if (window[key]) return window[key];
      if (window.CRM_CONFIG && window.CRM_CONFIG[key]) return window.CRM_CONFIG[key];
      if (window.CRMConfig && window.CRMConfig[key]) return window.CRMConfig[key];
    }
    return null;
  }

  function getSupabaseClient() {
    const names = ['supabaseClient', 'crmSupabase', 'db', 'supabaseDb', 'SB', '_supabaseClient'];
    for (const name of names) {
      const candidate = window[name];
      if (candidate && typeof candidate.from === 'function' && typeof candidate.rpc === 'function') return candidate;
    }

    for (const value of Object.values(window)) {
      if (value && typeof value === 'object' && typeof value.from === 'function' && typeof value.rpc === 'function' && value.auth) {
        return value;
      }
    }

    const url = getConfigValue('SUPABASE_URL', 'supabaseUrl', 'url');
    const key = getConfigValue('SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'supabaseAnonKey', 'publishableKey', 'anonKey');

    if (url && key && window.supabase && typeof window.supabase.createClient === 'function') {
      window.supabaseClient = window.supabase.createClient(url, key);
      return window.supabaseClient;
    }

    return null;
  }

  function parseImportPayload() {
    const input = document.getElementById('importJsonInput');
    const raw = input ? input.value.trim() : '';
    if (!raw) throw new Error('Cole o JSON da Apify antes de importar.');

    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed.results)
        ? parsed.results
        : Array.isArray(parsed.items)
          ? parsed.items
          : [];

    if (!list.length) throw new Error('JSON válido, mas nenhum lead foi encontrado. Use um array ou results[].');
    return list;
  }

  function isMapsUrl(url) {
    return /google\.com\/maps|maps\.app\.goo\.gl|query_place_id=/i.test(String(url || ''));
  }

  function pick(obj, keys) {
    for (const key of keys) {
      const val = key.split('.').reduce((acc, part) => acc && acc[part], obj);
      if (val !== undefined && val !== null && String(val).trim() !== '') return val;
    }
    return null;
  }

  function normalizeLead(raw) {
    const url = pick(raw, ['url', 'link']);
    let website = pick(raw, ['website', 'site', 'url_site']);
    let googleMapsUrl = pick(raw, ['google_maps_url', 'googleMapsUrl', 'googleMapsURL', 'placeUrl', 'mapsUrl']);

    if (!googleMapsUrl && isMapsUrl(url)) googleMapsUrl = url;
    if (!website && url && !isMapsUrl(url)) website = url;
    if (isMapsUrl(website)) {
      googleMapsUrl = googleMapsUrl || website;
      website = null;
    }

    const instagramUrl = pick(raw, ['instagram_url', 'instagramUrl', 'instagram', 'insta']);
    let instagramUsername = pick(raw, ['instagram_username', 'instagramUsername']);
    if (!instagramUsername && instagramUrl) {
      instagramUsername = String(instagramUrl).replace(/^.*instagram\.com\//i, '').replace(/^@/, '').split(/[/?#]/)[0] || null;
    }

    return {
      company_name: pick(raw, ['company_name', 'title', 'name', 'empresa']) || 'Empresa sem nome',
      category: pick(raw, ['category', 'categoryName', 'categoria']),
      description: pick(raw, ['description', 'about', 'descricao']),
      rating: pick(raw, ['rating', 'totalScore']),
      reviews_count: pick(raw, ['reviews_count', 'reviewsCount', 'reviews']),
      phone: pick(raw, ['phone', 'phoneNumber', 'telefone', 'whatsapp']),
      website,
      website_type: website ? 'own_site' : null,
      has_own_site: !!website,
      instagram_url: instagramUrl,
      instagram_username: instagramUsername,
      country: pick(raw, ['country', 'pais']),
      country_code: pick(raw, ['country_code', 'countryCode']),
      state: pick(raw, ['state', 'estado']),
      state_code: pick(raw, ['state_code', 'stateCode']),
      city: pick(raw, ['city', 'cidade']),
      neighborhood: pick(raw, ['neighborhood', 'bairro']),
      address: pick(raw, ['address', 'street', 'endereco']),
      zip_code: pick(raw, ['zip_code', 'postalCode', 'cep']),
      latitude: pick(raw, ['latitude', 'location.lat']),
      longitude: pick(raw, ['longitude', 'location.lng']),
      google_maps_url: googleMapsUrl,
      place_id: pick(raw, ['place_id', 'placeId']),
      raw_payload: raw
    };
  }

  function renderRows(tbody, leads, emptyText) {
    if (!tbody) return;
    if (!leads.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="table-empty">${esc(emptyText)}</td></tr>`;
      return;
    }

    tbody.innerHTML = leads.map(lead => {
      const location = [lead.city, lead.state].filter(Boolean).join(', ') || '-';
      const site = lead.website
        ? `<a href="${esc(lead.website)}" target="_blank" rel="noopener">Site</a>`
        : '<span class="td-missing">Sem site</span>';
      const maps = lead.google_maps_url
        ? `<a href="${esc(lead.google_maps_url)}" target="_blank" rel="noopener">Maps</a>`
        : '';
      return `
        <tr data-lead-id="${esc(lead.id)}">
          <td class="td-name">${esc(lead.company_name)}</td>
          <td class="td-link">${site}</td>
          <td class="td-link">${maps}</td>
          <td class="empresa-phone">${esc(lead.phone || '-')}</td>
          <td><span class="q-badge info">${esc(lead.current_stage || 'validation')}</span></td>
          <td><span class="q-badge ${lead.has_own_site ? 'warn' : 'ok'}">${lead.has_own_site ? 'Com site' : 'Sem site'}</span></td>
          <td></td>
        </tr>`;
    }).join('');
  }

  async function loadPersistentLeads() {
    const client = getSupabaseClient();
    if (!client) return [];

    const { data, error } = await client
      .from('v_lead_cards_persistent')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500);

    if (error) {
      console.warn(LOG, 'falha ao carregar v_lead_cards_persistent', error);
      return [];
    }

    return Array.isArray(data) ? data : [];
  }

  async function renderPersistentImportedLeads() {
    const leads = await loadPersistentLeads();

    renderRows(document.getElementById('leadBaseTbody'), leads, 'Nenhum lead salvo no banco ainda.');

    const validationLeads = leads.filter(l => ['imported', 'validation'].includes(l.current_stage));
    const valBox = document.getElementById('valComSiteList');
    if (valBox) {
      if (!validationLeads.length) {
        valBox.innerHTML = '<div class="table-empty">// nenhum lead aguardando validação</div>';
      } else {
        valBox.innerHTML = validationLeads.map(lead => `
          <div class="empresa-card" data-lead-id="${esc(lead.id)}">
            <div class="empresa-info">
              <div class="empresa-nome">${esc(lead.company_name)}</div>
              <div class="empresa-meta">
                <span class="empresa-phone">${esc(lead.phone || 'sem telefone')}</span>
                <span class="q-badge ${lead.website ? 'warn' : 'ok'}">${lead.website ? 'Com site' : 'Sem site'}</span>
                ${lead.google_maps_url ? `<a class="td-link" href="${esc(lead.google_maps_url)}" target="_blank" rel="noopener">Maps</a>` : ''}
              </div>
            </div>
          </div>
        `).join('');
      }
    }

    const badge = document.getElementById('leadBaseTotalBadge');
    if (badge) badge.textContent = `${leads.length} lead(s)`;

    return leads;
  }

  async function importarLeadsPersistente() {
    const btn = document.getElementById('importLeadsBtn');
    const originalText = btn ? btn.innerHTML : '';

    try {
      const client = getSupabaseClient();
      if (!client) throw new Error('Cliente Supabase não encontrado. Verifique crm-config/prelude.');

      const rawList = parseImportPayload();
      const normalized = rawList.map(normalizeLead);

      if (btn) {
        btn.disabled = true;
        btn.innerHTML = 'Salvando no banco...';
      }

      const { data, error } = await client.rpc('rpc_import_leads_persistent', {
        p_source: 'apify',
        p_file_name: 'json-colado',
        p_leads: normalized
      });

      if (error) throw error;

      await renderPersistentImportedLeads();

      if (typeof window.updateBadges === 'function') {
        try { window.updateBadges(); } catch (_) {}
      }

      notifySafe(`Importação salva no banco: ${data?.created || 0} criado(s), ${data?.merged || 0} duplicado(s).`, data?.errors ? 'warn' : 'ok');
      return data;
    } catch (error) {
      console.error(LOG, error);
      notifySafe(`Erro ao importar: ${error.message || error}`, 'err');
      throw error;
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = originalText || '↓ Importar para Validação';
      }
    }
  }

  function install() {
    window.importarLeads = importarLeadsPersistente;
    window.renderPersistentImportedLeads = renderPersistentImportedLeads;

    const btn = document.getElementById('importLeadsBtn');
    if (btn) btn.setAttribute('onclick', 'importarLeads()');

    renderPersistentImportedLeads().catch(err => console.warn(LOG, err));
    console.log(LOG, 'ativo');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install);
  } else {
    install();
  }
})();
