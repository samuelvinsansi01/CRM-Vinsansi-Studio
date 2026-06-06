/* CRM Rebuild Fase 6.9 — Importação persistente no schema novo via headers autenticados */
(function(){
  const SUPABASE_URL = 'https://txyknazfufashgzlxkqh.supabase.co';

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

    const website =
      rawWebsite && !isMapsUrl(rawWebsite)
        ? rawWebsite
        : null;

    const maps =
      googleMapsUrl ||
      (rawWebsite && isMapsUrl(rawWebsite) ? rawWebsite : null) ||
      (rawUrl && isMapsUrl(rawUrl) ? rawUrl : null) ||
      null;

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

  async function getAuthContext(){
    const userId =
      (typeof getCurrentSupabaseUserIdV412 === 'function' ? await getCurrentSupabaseUserIdV412() : null) ||
      window.currentUser?.id ||
      (typeof currentUser !== 'undefined' ? currentUser?.id : null);

    if (!userId) {
      throw new Error('Usuário autenticado não encontrado.');
    }

    let headers = null;

    if (typeof getSupabaseAuthHeadersV423 === 'function') {
      headers = await getSupabaseAuthHeadersV423();
    }
    
    if (!headers?.apikey) {
      headers = {
        apikey: 'sb_publishable_ClGVAmaiS4tNWe8W_4EPew_aPvAzK0E',
        Authorization: 'Bearer sb_publishable_ClGVAmaiS4tNWe8W_4EPew_aPvAzK0E'
      };
    }
    
    return { user: { id: userId }, headers };

  async function supabaseFetch(path, options = {}){
    const { headers } = await getAuthContext();

    const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      ...options,
      headers: {
        ...headers,
        'Content-Type': 'application/json',
        'Prefer': options.prefer || 'return=representation',
        ...(options.headers || {})
      }
    });

    const text = await response.text();
    const json = text ? JSON.parse(text) : null;

    if (!response.ok) {
      throw json || new Error(`Erro Supabase ${response.status}`);
    }

    return json;
  }

  async function insertRow(table, payload, query = 'select=*'){
    return supabaseFetch(`${table}?${query}`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  async function updateRow(table, payload, filters){
    return supabaseFetch(`${table}?${filters}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
      prefer: 'return=minimal'
    });
  }

  async function selectRows(table, query){
    return supabaseFetch(`${table}?${query}`, {
      method: 'GET',
      prefer: 'return=representation'
    });
  }

  async function upsertRow(table, payload, onConflict){
    return supabaseFetch(`${table}?on_conflict=${encodeURIComponent(onConflict)}&select=*`, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: {
        Prefer: 'resolution=merge-duplicates,return=representation'
      }
    });
  }

  async function importarLeadsPersistente(){
    const { user } = await getAuthContext();

    const rows = getImportJson().map(normalizeLeadPayload);
    if (!rows.length) throw new Error('Nenhum lead encontrado para importar.');

    const batchRows = await insertRow('import_batches', {
      user_id: user.id,
      source: 'apify_json',
      source_file_name: 'importacao_manual_json',
      quantity_total: rows.length,
      raw_metadata: { source: 'frontend', version: '6.9' }
    }, 'select=id');

    const batch = Array.isArray(batchRows) ? batchRows[0] : batchRows;
    if (!batch?.id) throw new Error('Falha ao criar import_batch.');

    let created = 0;
    let merged = 0;

    for (const row of rows) {
      const leadPayload = { ...row.lead, user_id: user.id };
      let lead = null;
      let inserted = null;

      try {
        const insertedRows = await insertRow('leads', leadPayload, 'select=id');
        inserted = Array.isArray(insertedRows) ? insertedRows[0] : insertedRows;
        lead = inserted;
        created++;
      } catch (insertError) {
        const phone = row.lead.normalized_phone;
        let query = `select=id&user_id=eq.${encodeURIComponent(user.id)}&deleted_at=is.null&limit=1`;

        if (phone) {
          query += `&normalized_phone=eq.${encodeURIComponent(phone)}`;
        } else if (row.lead.website) {
          query += `&website=eq.${encodeURIComponent(row.lead.website)}`;
        } else if (row.lead.instagram_username) {
          query += `&instagram_username=eq.${encodeURIComponent(row.lead.instagram_username)}`;
        } else {
          throw insertError;
        }

        const existingRows = await selectRows('leads', query);
        const existing = Array.isArray(existingRows) ? existingRows[0] : existingRows;

        if (!existing?.id) throw insertError;

        lead = existing;
        merged++;
      }

      await upsertRow('lead_locations', {
        ...row.location,
        user_id: user.id,
        lead_id: lead.id
      }, 'user_id,lead_id');

      await upsertRow('lead_imports', {
        user_id: user.id,
        import_batch_id: batch.id,
        lead_id: lead.id,
        original_payload: row.original,
        normalized_payload: { lead: row.lead, location: row.location }
      }, 'user_id,import_batch_id,lead_id');

      await insertRow('lead_snapshots', {
        user_id: user.id,
        lead_id: lead.id,
        import_batch_id: batch.id,
        snapshot_type: 'import',
        snapshot: { lead: row.lead, location: row.location, original: row.original }
      }, 'select=id');

      await insertRow('lead_events', {
        user_id: user.id,
        lead_id: lead.id,
        event_type: 'LEAD_IMPORTED',
        event_payload: { import_batch_id: batch.id, created: !!inserted }
      }, 'select=id');
    }

    await updateRow(
      'import_batches',
      { quantity_created: created, quantity_merged: merged },
      `id=eq.${encodeURIComponent(batch.id)}&user_id=eq.${encodeURIComponent(user.id)}`
    );

    if (typeof notify === 'function') notify(`Importação salva: ${created} novo(s), ${merged} mesclado(s).`);
    if (typeof loadSupabaseLeadsToLocalState === 'function') await loadSupabaseLeadsToLocalState();
    if (typeof renderInicio === 'function') renderInicio();
    if (typeof updateBadges === 'function') updateBadges();

    return { batch_id: batch.id, created, merged, total: rows.length };
  }

  window.importarLeadsPersistente = importarLeadsPersistente;
  window.importarLeads = importarLeadsPersistente;
})();
