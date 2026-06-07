/* CRM Rebuild Fase 6.16 — Importação persistente via RPC + classificação correta de links */
(function(){
  function escText(v){ return (v == null ? '' : String(v)).trim(); }
  function onlyDigits(v){ return escText(v).replace(/\D+/g, '') || null; }

  function normalizeUrl(v){
    const s = escText(v);
    if (!s) return '';
    return s;
  }

  function isInstagramUrl(url){
    return /(^|\.)instagram\.com\//i.test(normalizeUrl(url).replace(/^https?:\/\//i, '').replace(/^www\./i, ''));
  }

  function isMapsUrl(url){
    const v = normalizeUrl(url);
    return /(google\.[^/]+\/maps|maps\.app\.goo\.gl|goo\.gl\/maps|query_place_id=|\/place\/|\/search\/?api=1)/i.test(v);
  }

  function isBlockedAsWebsite(url){
    return isInstagramUrl(url) || isMapsUrl(url) || /(^|\.)facebook\.com\//i.test(url) || /(^|\.)wa\.me\//i.test(url) || /api\.whatsapp\.com/i.test(url);
  }

  function pick(obj, keys){
    for (const k of keys) {
      if (obj && obj[k] != null && String(obj[k]).trim() !== '') return obj[k];
    }
    return null;
  }

  function pickFirstUrl(item, keys, predicate){
    for (const k of keys) {
      const v = normalizeUrl(item?.[k]);
      if (v && (!predicate || predicate(v))) return v;
    }
    return null;
  }

  function normalizeInstagramFromAny(item){
    const direct = pick(item, ['instagram','instagramUrl','instagram_url','instagramLink','instagram_link','insta']);
    const fromUrl = pickFirstUrl(item, ['website','site','url','domain','webSite','googleMapsUrl','google_maps_url','mapsUrl','placeUrl','searchPageUrl'], isInstagramUrl);
    const url = normalizeUrl(direct) || fromUrl;
    if (!url) return { url: null, username: null };
    const m = url.match(/instagram\.com\/([^/?#]+)/i);
    const raw = m ? m[1] : '';
    const username = raw && !['invites','p','reel','stories','explore'].includes(raw.toLowerCase()) ? raw.toLowerCase().replace('@','') : null;
    return { url, username };
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

  function parseNumber(v){
    const s = escText(v).replace(',', '.');
    return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null;
  }

  function parseInteger(v){
    const s = escText(v).replace(/\D+/g, '');
    return s ? Number(s) : null;
  }

  function normalizeLeadPayload(item){
    const companyName = escText(pick(item, ['title','name','company_name','companyName','nome','empresa'])) || 'Empresa sem nome';

    const maps =
      pickFirstUrl(item, ['googleMapsUrl','google_maps_url','googleMapsURL','mapsUrl','placeUrl','searchPageUrl','url','website','site','domain','webSite'], isMapsUrl) || null;

    const instagram = normalizeInstagramFromAny(item);

    const rawWebsite =
      pickFirstUrl(item, ['website','site','domain','webSite','url'], function(url){
        return !!url && !isBlockedAsWebsite(url);
      }) || null;

    const phone = escText(pick(item, ['phone','phoneNumber','telefone','whatsapp','contactPhone']));
    const rating = parseNumber(pick(item, ['rating','totalScore','stars','nota']));
    const reviewsCount = parseInteger(pick(item, ['reviews_count','reviewsCount','reviews','reviewCount','avaliacoes']));

    return {
      lead: {
        company_name: companyName,
        category: escText(pick(item, ['categoryName','category','categoria'])),
        description: escText(pick(item, ['description','descricao','about'])),
        rating,
        reviews_count: reviewsCount,
        phone: phone || null,
        normalized_phone: onlyDigits(phone),
        whatsapp_status: phone ? 'pending' : 'unknown',
        website: rawWebsite,
        website_type: rawWebsite ? 'own_site' : null,
        has_own_site: !!rawWebsite,
        instagram_url: instagram.url,
        instagram_username: instagram.username,
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
        latitude: parseNumber(pick(item, ['latitude','lat'])),
        longitude: parseNumber(pick(item, ['longitude','lng','lon'])),
        google_maps_url: maps,
        place_id: escText(pick(item, ['placeId','place_id','googlePlaceId'])),
        raw_location: item
      },
      original: item
    };
  }

  function getCurrentUserId(){
    return (typeof getCurrentSupabaseUserIdV412 === 'function' ? getCurrentSupabaseUserIdV412() : null) ||
      window.currentUser?.id ||
      (typeof currentUser !== 'undefined' ? currentUser?.id : null);
  }

  async function rpcImport(userId, rows){
    const client = window.supabaseClient || window.crmSupabase || window.sb;
    if (client?.rpc) {
      const { data, error } = await client.rpc('rpc_import_leads_batch', {
        p_user_id: userId,
        p_rows: rows,
        p_source: 'apify_json',
        p_source_file_name: 'importacao_manual_json'
      });
      if (!error) return data;
      console.warn('[CRM 6.16] RPC via client falhou, tentando fetch:', error);
    }

    const response = await fetch('https://txyknazfufashgzlxkqh.supabase.co/rest/v1/rpc/rpc_import_leads_batch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': 'sb_publishable_ClGVAmaiS4tNWe8W_4EPew_aPvAzK0E',
        'Authorization': 'Bearer sb_publishable_ClGVAmaiS4tNWe8W_4EPew_aPvAzK0E'
      },
      body: JSON.stringify({
        p_user_id: userId,
        p_rows: rows,
        p_source: 'apify_json',
        p_source_file_name: 'importacao_manual_json'
      })
    });

    const text = await response.text();
    const json = text ? JSON.parse(text) : null;
    if (!response.ok) throw json || new Error('Falha na RPC de importação.');
    return json;
  }

  function buildImportSummary(result){
    const total = Number(result?.total || 0);
    const created = Number(result?.created || 0);
    const merged = Number(result?.merged || 0);
    const ignored = Number(result?.ignored || 0);
    const lowRating = Number(result?.rejected_low_rating || 0);
    const lowReviews = Number(result?.rejected_low_reviews || 0);
    const duplicate = Number(result?.rejected_duplicate || 0);
    const blacklisted = Number(result?.blacklisted || 0);
    const errors = Number(result?.errors || 0);

    return `Importação analisada\n\nTotal: ${total}\n\nAprovados:\n${created} salvos\n${merged} mesclados\n\nReprovados/Ignorados:\n${ignored} ignorados\n${lowRating} abaixo da nota mínima\n${lowReviews} abaixo das avaliações mínimas\n${duplicate} duplicados\n${blacklisted} blacklist\n${errors} erros`;
  }

  async function importarLeadsPersistente(){
    const userId = await getCurrentUserId();
    if (!userId) throw new Error('Usuário autenticado não encontrado. Faça login novamente.');

    const rows = getImportJson().map(normalizeLeadPayload);
    if (!rows.length) throw new Error('Nenhum lead encontrado para importar.');

    const result = await rpcImport(userId, rows);

    if (typeof notify === 'function') notify(buildImportSummary(result));
    if (typeof loadSupabaseLeadsToLocalState === 'function') await loadSupabaseLeadsToLocalState();
    if (typeof window.renderValidationStageFromSupabase === 'function') await window.renderValidationStageFromSupabase();
    if (typeof renderInicio === 'function') renderInicio();
    if (typeof updateBadges === 'function') updateBadges();

    return result;
  }

  window.importarLeadsPersistente = importarLeadsPersistente;
  window.importarLeads = importarLeadsPersistente;
})();
