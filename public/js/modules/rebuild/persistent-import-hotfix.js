/* CRM Rebuild Fase 6.17 — Importação persistente sem salvar rejeitados */
(function(){
  const SUPABASE_URL = 'https://txyknazfufashgzlxkqh.supabase.co';

  function escText(v){ return (v == null ? '' : String(v)).trim(); }
  function onlyDigits(v){ return escText(v).replace(/\D+/g, '') || null; }
  function isInstagramUrl(url){ return /(^|\.)instagram\.com\//i.test(escText(url)); }
  function isMapsUrl(url){ return /google\.[^/]+\/maps|maps\.app\.goo\.gl|goo\.gl\/maps|query_place_id=/i.test(escText(url)); }
  function isRealWebsite(url){ return !!escText(url) && !isInstagramUrl(url) && !isMapsUrl(url); }

  function normalizeInstagram(url){
    const v = escText(url);
    if (!v || !isInstagramUrl(v)) return { url: null, username: null };
    const m = v.match(/instagram\.com\/([^/?#]+)/i);
    const username = m && !['invites','p','reel','stories','explore'].includes(String(m[1]).toLowerCase())
      ? String(m[1]).replace('@','').toLowerCase()
      : null;
    return { url: v, username };
  }

  function pick(obj, keys){
    for (const k of keys) {
      if (obj && obj[k] != null && String(obj[k]).trim() !== '') return obj[k];
    }
    return null;
  }

  function getImportJson(){
    const el = document.getElementById('importJsonInput');
    if (!el) throw new Error('Campo importJsonInput não encontrado.');
    const txt = el.value.trim();
    if (!txt) throw new Error('Cole o JSON da Apify antes de importar.');
    const parsed = JSON.parse(txt);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed.results)) return parsed.results;
    if (Array.isArray(parsed.data)) return parsed.data;
    throw new Error('JSON inválido: esperado array ou objeto com results[].');
  }

  function normalizeLeadPayload(item){
    const companyName = escText(pick(item, ['title','name','company_name','companyName','nome','empresa'])) || 'Empresa sem nome';

    const candidates = [
      escText(pick(item, ['website','site','domain','webSite','url_site'])),
      escText(pick(item, ['url'])),
      escText(pick(item, ['googleMapsUrl','google_maps_url','mapsUrl','placeUrl','searchPageUrl'])),
      escText(pick(item, ['instagram','instagramUrl','instagram_url','instagramLink']))
    ].filter(Boolean);

    let website = null;
    let googleMapsUrl = null;
    let instagramUrl = null;

    for (const c of candidates) {
      if (!instagramUrl && isInstagramUrl(c)) instagramUrl = c;
      else if (!googleMapsUrl && isMapsUrl(c)) googleMapsUrl = c;
      else if (!website && isRealWebsite(c)) website = c;
    }

    const directInsta = normalizeInstagram(instagramUrl || pick(item, ['instagram','instagramUrl','instagram_url','instagramLink']));
    const phone = escText(pick(item, ['phone','phoneNumber','telefone','whatsapp','contactPhone']));
    const rating = pick(item, ['rating','totalScore','stars','nota']);
    const reviews = pick(item, ['reviewsCount','reviews','reviewCount','reviews_count','avaliacoes']);

    return {
      lead: {
        company_name: companyName,
        category: escText(pick(item, ['categoryName','category','categoria'])),
        description: escText(pick(item, ['description','descricao','about'])),
        rating: rating != null && String(rating).trim() !== '' ? Number(String(rating).replace(',', '.')) : null,
        reviews_count: reviews != null && String(reviews).trim() !== '' ? Number(String(reviews).replace(/\D+/g, '')) : null,
        phone: phone || null,
        normalized_phone: onlyDigits(phone),
        whatsapp_status: phone ? 'pending' : 'unknown',
        website,
        website_type: website ? 'external' : null,
        has_own_site: !!website,
        instagram_url: directInsta.url,
        instagram_username: directInsta.username,
        current_stage: 'validation',
        current_status: 'pending_validation'
      },
      location: {
        country: escText(pick(item, ['country','pais'])) || 'Brasil',
        country_code: escText(pick(item, ['countryCode','country_code'])) || 'BR',
        state: escText(pick(item, ['state','estado','region'])),
        state_code: escText(pick(item, ['stateCode','state_code','uf'])),
        city: escText(pick(item, ['city','cidade'])),
        neighborhood: escText(pick(item, ['neighborhood','bairro'])),
        address: escText(pick(item, ['address','endereco','street'])),
        zip_code: escText(pick(item, ['postalCode','zipCode','zip_code','cep'])),
        latitude: pick(item, ['latitude','lat']) ? Number(String(pick(item, ['latitude','lat'])).replace(',', '.')) : null,
        longitude: pick(item, ['longitude','lng','lon']) ? Number(String(pick(item, ['longitude','lng','lon'])).replace(',', '.')) : null,
        google_maps_url: googleMapsUrl,
        place_id: escText(pick(item, ['placeId','place_id','googlePlaceId'])),
        raw_location: item
      },
      original: item
    };
  }

  async function getAuthContext(){
    const userId =
      (typeof getCurrentSupabaseUserIdV412 === 'function' ? await getCurrentSupabaseUserIdV412() : null) ||
      window.currentUser?.id ||
      (typeof currentUser !== 'undefined' ? currentUser?.id : null);

    if (!userId) throw new Error('Usuário autenticado não encontrado.');

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

  async function rpcImport(payload){
    const { headers } = await getAuthContext();
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rpc_import_leads_batch`, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const text = await response.text();
    const json = text ? JSON.parse(text) : null;
    if (!response.ok) throw json || new Error(`Erro Supabase ${response.status}`);
    return json;
  }

  async function importarLeadsPersistente(){
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

    if (typeof notify === 'function') {
      notify(`Importação analisada: ${total} total · ${created} aprovado(s) · ${ignored} ignorado(s) · nota ${lowRating} · avaliações ${lowReviews} · duplicados ${duplicates} · blacklist ${blacklisted} · erros ${errors}`);
    }

    if (typeof loadSupabaseLeadsToLocalState === 'function') await loadSupabaseLeadsToLocalState();
    if (typeof renderValidationStageFromSupabase === 'function') await renderValidationStageFromSupabase();
    if (typeof renderInicio === 'function') renderInicio();
    if (typeof updateBadges === 'function') updateBadges();

    return result;
  }

  window.importarLeadsPersistente = importarLeadsPersistente;
  window.importarLeads = importarLeadsPersistente;
})();
