/* CRM Rebuild Fase 6.9 — Importação persistente via RPC */
(function(){
  function escText(v){ return (v == null ? '' : String(v)).trim(); }
  function onlyDigits(v){ return escText(v).replace(/\D+/g, '') || null; }
  function isMapsUrl(url){ return /google\.[^/]+\/maps|maps\.app\.goo\.gl|goo\.gl\/maps/i.test(escText(url)); }

  function normalizeInstagram(url){
    const v = escText(url);
    if (!v) return { url: null, username: null };
    const m = v.match(/instagram\.com\/([^/?#]+)/i);
    return { url: v, username: m ? m[1].toLowerCase() : null };
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
    const rawWebsite = escText(pick(item, ['website','site','domain','webSite']));
    const rawUrl = escText(pick(item, ['url']));
    const googleMapsUrl = escText(pick(item, ['googleMapsUrl','google_maps_url','mapsUrl','placeUrl','searchPageUrl']));
    const website = rawWebsite && !isMapsUrl(rawWebsite) ? rawWebsite : null;
    const maps = googleMapsUrl || (rawWebsite && isMapsUrl(rawWebsite) ? rawWebsite : null) || (rawUrl && isMapsUrl(rawUrl) ? rawUrl : null) || null;
    const phone = escText(pick(item, ['phone','phoneNumber','telefone','whatsapp','contactPhone']));
    const insta = normalizeInstagram(pick(item, ['instagram','instagramUrl','instagram_url','instagramLink']));

    return {
      lead: {
        company_name: companyName,
        category: escText(pick(item, ['categoryName','category','categoria'])),
        description: escText(pick(item, ['description','descricao','about'])),
        rating: pick(item, ['rating','stars','nota']) ? Number(pick(item, ['rating','stars','nota'])) : null,
        reviews_count: pick(item, ['reviewsCount','reviews','reviewCount','avaliacoes']) ? Number(pick(item, ['reviewsCount','reviews','reviewCount','avaliacoes'])) : null,
        phone: phone || null,
        normalized_phone: onlyDigits(phone),
        whatsapp_status: phone ? 'pending' : 'unknown',
        website,
        website_type: website ? 'external' : null,
        has_own_site: !!website,
        instagram_url: insta.url,
        instagram_username: insta.username,
        current_stage: 'imported',
        current_status: 'imported'
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
        latitude: pick(item, ['latitude','lat']) ? Number(pick(item, ['latitude','lat'])) : null,
        longitude: pick(item, ['longitude','lng','lon']) ? Number(pick(item, ['longitude','lng','lon'])) : null,
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
      const { data, error } = await client.rpc('rpc_import_leads_persistent', {
        p_user_id: userId,
        p_rows: rows,
        p_source: 'apify_json',
        p_source_file_name: 'importacao_manual_json'
      });
      if (!error) return data;
      console.warn('[CRM 6.9] RPC via client falhou, tentando fetch anônimo:', error);
    }

    const response = await fetch('https://txyknazfufashgzlxkqh.supabase.co/rest/v1/rpc/rpc_import_leads_persistent', {
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

  async function importarLeadsPersistente(){
    const userId = await getCurrentUserId();
    if (!userId) throw new Error('Usuário autenticado não encontrado. Faça login novamente.');

    const rows = getImportJson().map(normalizeLeadPayload);
    if (!rows.length) throw new Error('Nenhum lead encontrado para importar.');

    const result = await rpcImport(userId, rows);
    const created = Number(result?.created || 0);
    const merged = Number(result?.merged || 0);

    if (typeof notify === 'function') notify(`Importação salva: ${created} novo(s), ${merged} mesclado(s).`);
    if (typeof loadSupabaseLeadsToLocalState === 'function') await loadSupabaseLeadsToLocalState();
    if (typeof renderInicio === 'function') renderInicio();
    if (typeof updateBadges === 'function') updateBadges();

    return result;
  }

  window.importarLeadsPersistente = importarLeadsPersistente;
  window.importarLeads = importarLeadsPersistente;
})();
