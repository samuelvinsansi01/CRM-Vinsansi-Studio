/* CRM Rebuild Fase 6.18 - Importacao persistente e preview separado */
(function () {
  const SUPABASE_URL = 'https://txyknazfufashgzlxkqh.supabase.co';
  let lastPreviewStats = null;

  function escText(value) {
    return (value == null ? '' : String(value)).trim();
  }

  function escHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[char]));
  }

  function onlyDigits(value) {
    return escText(value).replace(/\D+/g, '') || null;
  }

  function normalizeHostname(value = '') {
    const raw = escText(value);
    if (!raw) return '';

    try {
      return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname
        .replace(/^www\./i, '')
        .toLowerCase();
    } catch (_) {
      return raw.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0].toLowerCase();
    }
  }

  function isInstagramUrl(url) {
    const host = normalizeHostname(url);
    return host === 'instagram.com' || host.endsWith('.instagram.com');
  }

  function isMapsUrl(url) {
    return /google\.[^/]+\/maps|maps\.app\.goo\.gl|goo\.gl\/maps|query_place_id=/i.test(escText(url));
  }

  function isWixsiteUrl(url) {
    const host = normalizeHostname(url);
    return host === 'wixsite.com' || host.endsWith('.wixsite.com');
  }

  function isRealWebsite(url) {
    return !!escText(url) && !isInstagramUrl(url) && !isMapsUrl(url);
  }

  function getWebsiteType(url) {
    if (!url) return null;
    if (isWixsiteUrl(url)) return 'wixsite';
    return 'external';
  }

  function normalizeInstagram(url) {
    const value = escText(url);
    if (!value || !isInstagramUrl(value)) return { url: null, username: null };

    const match = value.match(/instagram\.com\/([^/?#]+)/i);
    const username = match && !['invites', 'p', 'reel', 'stories', 'explore'].includes(String(match[1]).toLowerCase())
      ? String(match[1]).replace('@', '').toLowerCase()
      : null;

    return { url: value, username };
  }

  function pick(object, keys) {
    for (const key of keys) {
      if (object && object[key] != null && String(object[key]).trim() !== '') return object[key];
    }
    return null;
  }

  function getImportJson() {
    const element = document.getElementById('importJsonInput');
    if (!element) throw new Error('Campo importJsonInput nao encontrado.');

    const text = element.value.trim();
    if (!text) throw new Error('Cole o JSON da Apify antes de importar.');

    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed.results)) return parsed.results;
    if (Array.isArray(parsed.data)) return parsed.data;
    if (Array.isArray(parsed.items)) return parsed.items;
    throw new Error('JSON invalido: esperado array ou objeto com results[].');
  }

  function normalizeLeadPayload(item) {
    const companyName = escText(pick(item, ['title', 'name', 'company_name', 'companyName', 'nome', 'empresa'])) || 'Empresa sem nome';

    const candidates = [
      escText(pick(item, ['website', 'site', 'domain', 'webSite', 'url_site'])),
      escText(pick(item, ['url'])),
      escText(pick(item, ['googleMapsUrl', 'google_maps_url', 'mapsUrl', 'placeUrl', 'searchPageUrl'])),
      escText(pick(item, ['instagram', 'instagramUrl', 'instagram_url', 'instagramLink']))
    ].filter(Boolean);

    let website = null;
    let googleMapsUrl = null;
    let instagramUrl = null;

    for (const candidate of candidates) {
      if (!instagramUrl && isInstagramUrl(candidate)) instagramUrl = candidate;
      else if (!googleMapsUrl && isMapsUrl(candidate)) googleMapsUrl = candidate;
      else if (!website && isRealWebsite(candidate)) website = candidate;
    }

    const directInstagram = normalizeInstagram(instagramUrl || pick(item, ['instagram', 'instagramUrl', 'instagram_url', 'instagramLink']));
    const phone = escText(pick(item, ['phone', 'phoneNumber', 'telefone', 'whatsapp', 'contactPhone']));
    const rating = pick(item, ['rating', 'totalScore', 'stars', 'nota']);
    const reviews = pick(item, ['reviewsCount', 'reviews', 'reviewCount', 'reviews_count', 'avaliacoes']);
    const websiteType = getWebsiteType(website);

    return {
      lead: {
        company_name: companyName,
        category: escText(pick(item, ['categoryName', 'category', 'categoria'])),
        description: escText(pick(item, ['description', 'descricao', 'about'])),
        rating: rating != null && String(rating).trim() !== '' ? Number(String(rating).replace(',', '.')) : null,
        reviews_count: reviews != null && String(reviews).trim() !== '' ? Number(String(reviews).replace(/\D+/g, '')) : null,
        phone: phone || null,
        normalized_phone: onlyDigits(phone),
        whatsapp_status: phone ? 'pending' : 'unknown',
        website,
        website_type: websiteType,
        has_own_site: websiteType === 'external',
        instagram_url: directInstagram.url,
        instagram_username: directInstagram.username,
        current_stage: 'validation',
        current_status: 'pending_validation'
      },
      location: {
        country: escText(pick(item, ['country', 'pais'])) || 'Brasil',
        country_code: escText(pick(item, ['countryCode', 'country_code'])) || 'BR',
        state: escText(pick(item, ['state', 'estado', 'region'])),
        state_code: escText(pick(item, ['stateCode', 'state_code', 'uf'])),
        city: escText(pick(item, ['city', 'cidade'])),
        neighborhood: escText(pick(item, ['neighborhood', 'bairro'])),
        address: escText(pick(item, ['address', 'endereco', 'street'])),
        zip_code: escText(pick(item, ['postalCode', 'zipCode', 'zip_code', 'cep'])),
        latitude: pick(item, ['latitude', 'lat']) ? Number(String(pick(item, ['latitude', 'lat'])).replace(',', '.')) : null,
        longitude: pick(item, ['longitude', 'lng', 'lon']) ? Number(String(pick(item, ['longitude', 'lng', 'lon'])).replace(',', '.')) : null,
        google_maps_url: googleMapsUrl,
        place_id: escText(pick(item, ['placeId', 'place_id', 'googlePlaceId'])),
        raw_location: item
      },
      original: item
    };
  }

  async function getAuthContext() {
    const userId =
      (typeof getCurrentSupabaseUserIdV412 === 'function' ? await getCurrentSupabaseUserIdV412() : null) ||
      window.currentUser?.id ||
      (typeof currentUser !== 'undefined' ? currentUser?.id : null);

    if (!userId) throw new Error('Usuario autenticado nao encontrado.');

    let headers = null;
    if (typeof getSupabaseAuthHeadersV423 === 'function') headers = await getSupabaseAuthHeadersV423();

    if (!headers?.apikey) {
      headers = {
        apikey: 'sb_publishable_ClGVAmaiS4tNWe8W_4EPew_aPvAzK0E',
        Authorization: 'Bearer sb_publishable_ClGVAmaiS4tNWe8W_4EPew_aPvAzK0E'
      };
    }

    return { user: { id: userId }, headers };
  }

  async function rpcImport(payload) {
    const { headers } = await getAuthContext();
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rpc_import_leads_batch`, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const textBody = await response.text();
    const json = textBody ? JSON.parse(textBody) : null;
    if (!response.ok) throw json || new Error(`Erro Supabase ${response.status}`);
    return json;
  }

  function metric(label, value, tone = '') {
    const className = tone ? ` ${tone}` : '';
    return `
      <div class="import-metric${className}" style="display:grid;grid-template-columns:minmax(3ch,max-content) auto;column-gap:4px;align-items:baseline;justify-content:start">
        <strong style="min-width:3ch;text-align:right;font-variant-numeric:tabular-nums">${escHtml(value)}</strong>
        <span>- ${escHtml(label)}</span>
      </div>
    `;
  }

  function numberValue(value) {
    const number = Number(value || 0);
    return Number.isFinite(number) ? number : 0;
  }

  function renderSeparatedImportSummary(summary) {
    const target = document.getElementById('importSummary');
    if (!target || !summary) return;

    const approved = numberValue(summary.approved || summary.created || (numberValue(summary.withWhatsapp) + numberValue(summary.instagram)));
    const rejectedLowRating = numberValue(summary.rejectedLowRating || summary.rejected_low_rating);
    const rejectedLowReviews = numberValue(summary.rejectedLowReviews || summary.rejected_low_reviews);
    const duplicates = numberValue(summary.duplicates || summary.rejected_duplicate);
    const blacklist = numberValue(summary.blacklist || summary.blacklisted);
    const errors = numberValue(summary.errors);
    const rejected = rejectedLowRating + rejectedLowReviews + duplicates + blacklist + errors;
    const total = numberValue(summary.total) || approved + rejected;

    target.innerHTML = `
      <div class="import-summary-blocks" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px">
        <div class="import-summary-section" style="border:1px solid var(--border2);border-radius:8px;padding:10px;background:var(--surface2)">
          <div style="font-family:'Syne',sans-serif;font-size:11px;font-weight:800;color:var(--text);margin-bottom:6px">Totais</div>
          ${metric('Empresas', total, 'acc')}
          ${metric('Aprovadas', approved, 'acc')}
          ${metric('Recusadas', rejected, 'err')}
        </div>
        <div class="import-summary-section" style="border:1px solid var(--accent-border);border-radius:8px;padding:10px;background:var(--accent-dim)">
          <div style="font-family:'Syne',sans-serif;font-size:11px;font-weight:800;color:var(--text);margin-bottom:6px">Aprovados</div>
          ${metric('Enviados para Validacao', approved, 'acc')}
          ${metric('Com WhatsApp', summary.withWhatsapp || 0)}
          ${metric('Com site proprio', summary.withOwnSite || 0)}
          ${metric('Sem site', summary.withoutSite || 0)}
          ${metric('Instagram', summary.instagram || 0)}
          ${metric('Sites Wix', summary.wixSites || 0, 'warn')}
        </div>
        <div class="import-summary-section" style="border:1px solid rgba(255,92,92,0.28);border-radius:8px;padding:10px;background:rgba(255,92,92,0.05)">
          <div style="font-family:'Syne',sans-serif;font-size:11px;font-weight:800;color:var(--text);margin-bottom:6px">Reprovados</div>
          ${metric('Abaixo da nota', rejectedLowRating, 'err')}
          ${metric('Abaixo das avaliacoes', rejectedLowReviews, 'err')}
          ${metric('Duplicados', duplicates, 'warn')}
          ${metric('Blacklist', blacklist, 'warn')}
          ${metric('Erros', errors, 'err')}
        </div>
      </div>
    `;
  }

  function getSeparatedPreviewStats(analyses) {
    const minRating = window.APIFY_QUALIFICATION_RULES?.minRating ?? 4;
    const minReviews = window.APIFY_QUALIFICATION_RULES?.minReviews ?? 15;
    const approved = analyses.filter((item) => item.route === 'whatsapp-validation' || item.route === 'instagram-backlog');

    return {
      total: analyses.length,
      approved: approved.length,
      withWhatsapp: approved.filter((item) => item.route === 'whatsapp-validation' && item.hasPhone).length,
      withOwnSite: approved.filter((item) => item.route === 'whatsapp-validation' && item.website?.type === 'commercial').length,
      withoutSite: approved.filter((item) => item.route === 'whatsapp-validation' && item.website?.type === 'none').length,
      instagram: approved.filter((item) => item.route === 'instagram-backlog').length,
      wixSites: approved.filter((item) => item.website?.type === 'wixsite').length,
      rejectedLowRating: analyses.filter((item) => item.ramoMatch && Number(item.qualification?.rating || 0) < minRating).length,
      rejectedLowReviews: analyses.filter((item) => (
        item.ramoMatch &&
        Number(item.qualification?.rating || 0) >= minRating &&
        Number(item.qualification?.reviews || 0) < minReviews
      )).length,
      duplicates: analyses.filter((item) => item.alreadyImported || item.payloadDuplicate).length,
      blacklist: analyses.filter((item) => ['blocked-link', 'excluded'].includes(item.website?.type)).length,
      errors: 0
    };
  }

  function patchImportPreview() {
    if (window.importPreview?.__rebuild618) return;
    if (typeof window.importPreview !== 'function') return;

    const previous = window.importPreview;
    const patched = function importPreviewSeparated618() {
      const result = previous.apply(this, arguments);

      try {
        const raw = document.getElementById('importJsonInput')?.value?.trim() || '';
        if (!raw) return result;

        const parse = typeof parseApifyJson === 'function' ? parseApifyJson : null;
        const analyze = typeof analyzeApifyRowsV430 === 'function' ? analyzeApifyRowsV430 : null;
        if (!parse || !analyze) return result;

        const rows = parse(raw);
        if (!Array.isArray(rows)) return result;

        const analyses = analyze(rows, 'preview');
        lastPreviewStats = getSeparatedPreviewStats(analyses);
        renderSeparatedImportSummary(lastPreviewStats);
      } catch (error) {
        console.warn('[rebuild618] falha ao renderizar preview separado:', error);
      }

      return result;
    };

    patched.__rebuild618 = true;
    patched.__previous = previous;
    window.importPreview = patched;
  }

  async function importarLeadsPersistente() {
    const { user } = await getAuthContext();
    const rows = getImportJson().map(normalizeLeadPayload);

    const result = await rpcImport({
      p_user_id: user.id,
      p_rows: rows,
      p_source: 'apify_json',
      p_source_file_name: 'importacao_manual_json'
    });

    const total = result.total || 0;
    const created = result.created || 0;
    const ignored = result.ignored || 0;
    const lowRating = result.rejected_low_rating || 0;
    const lowReviews = result.rejected_low_reviews || 0;
    const duplicates = result.rejected_duplicate || 0;
    const blacklisted = result.blacklisted || 0;
    const errors = result.errors || 0;

    renderSeparatedImportSummary({
      ...(lastPreviewStats || {}),
      total,
      created,
      approved: created,
      rejected_low_rating: lowRating,
      rejected_low_reviews: lowReviews,
      rejected_duplicate: duplicates,
      blacklisted,
      errors
    });

    if (typeof notify === 'function') {
      notify(`Importacao analisada: ${total} total - ${created} aprovado(s) - ${ignored} ignorado(s) - nota ${lowRating} - avaliacoes ${lowReviews} - duplicados ${duplicates} - blacklist ${blacklisted} - erros ${errors}`);
    }

    if (typeof loadSupabaseLeadsToLocalState === 'function') await loadSupabaseLeadsToLocalState();
    if (typeof renderValidationStageFromSupabase === 'function') await renderValidationStageFromSupabase();
    if (typeof renderInicio === 'function') renderInicio();
    if (typeof updateBadges === 'function') updateBadges();

    const input = document.getElementById('importJsonInput');
    if (input) input.value = '';
    lastPreviewStats = null;

    return result;
  }

  window.importarLeadsPersistente = importarLeadsPersistente;
  window.importarLeads = importarLeadsPersistente;
  window.renderSeparatedImportSummaryRebuild618 = renderSeparatedImportSummary;

  patchImportPreview();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', patchImportPreview);
  } else {
    setTimeout(patchImportPreview, 0);
  }
})();
