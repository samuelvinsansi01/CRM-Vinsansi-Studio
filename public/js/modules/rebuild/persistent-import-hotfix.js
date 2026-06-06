/* CRM Rebuild Fase 6.8 — Importação persistente no schema novo */
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
    const rawWebsite = escText(pick(item, ['website','site','url','domain','webSite']));
    const googleMapsUrl = escText(pick(item, ['googleMapsUrl','google_maps_url','mapsUrl','url','placeUrl','searchPageUrl']));
    const website = rawWebsite && !isMapsUrl(rawWebsite) ? rawWebsite : null;
    const maps = googleMapsUrl || (rawWebsite && isMapsUrl(rawWebsite) ? rawWebsite : null);
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
        google_maps_url: maps || null,
        place_id: escText(pick(item, ['placeId','place_id','googlePlaceId'])),
        raw_location: item
      },
      original: item
    };
  }

  async function importarLeadsPersistente(){
    let client = null;
    if (window.supabaseClient?.from && window.supabaseClient?.auth) {
      client = window.supabaseClient;
    } else if (typeof window.resolveSupabaseClient === 'function') {
      client = window.resolveSupabaseClient();
    } else if (window.crmSupabase?.from && window.crmSupabase?.auth) {
      client = window.crmSupabase;
    } else if (window.sb?.from && window.sb?.auth) {
      client = window.sb;
    } else if (typeof window.CRMResolveSupabaseClient === 'function') {
      client = window.CRMResolveSupabaseClient();
    }
    
    if (!client?.from || !client?.auth) {
      throw new Error('Cliente Supabase não encontrado.');
    }
    
    let user = null;
    
    if (typeof window.CRMResolveCurrentUser === 'function') {
      user = await window.CRMResolveCurrentUser(client);
    }
    
    if (!user?.id) {
      const { data } = await client.auth.getUser();
      user = data?.user || null;
    }
    
    if (!user?.id) {
      throw new Error('Usuário autenticado não encontrado. Faça login novamente.');
    }
    
    const rows = getImportJson().map(normalizeLeadPayload);
    if (!rows.length) throw new Error('Nenhum lead encontrado para importar.');

    const { data: batch, error: batchError } = await client
      .from('import_batches')
      .insert({
        user_id: user.id,
        source: 'apify_json',
        source_file_name: 'importacao_manual_json',
        quantity_total: rows.length,
        raw_metadata: { source: 'frontend', version: '6.8' }
      })
      .select('id')
      .single();
    if (batchError) throw batchError;

    let created = 0;
    let merged = 0;

    for (const row of rows) {
      const leadPayload = { ...row.lead, user_id: user.id };
      let lead = null;

      const { data: inserted, error: insertError } = await client
        .from('leads')
        .insert(leadPayload)
        .select('id')
        .single();

      if (insertError) {
        const phone = row.lead.normalized_phone;
        let existingQuery = client.from('leads').select('id').eq('user_id', user.id).is('deleted_at', null).limit(1);
        if (phone) existingQuery = existingQuery.eq('normalized_phone', phone);
        else if (row.lead.website) existingQuery = existingQuery.eq('website', row.lead.website);
        else if (row.lead.instagram_username) existingQuery = existingQuery.eq('instagram_username', row.lead.instagram_username);
        else throw insertError;

        const { data: existing, error: existingError } = await existingQuery.maybeSingle();
        if (existingError || !existing?.id) throw insertError;
        lead = existing;
        merged++;
      } else {
        lead = inserted;
        created++;
      }

      const locPayload = { ...row.location, user_id: user.id, lead_id: lead.id };
      await client.from('lead_locations').upsert(locPayload, { onConflict: 'user_id,lead_id' });

      await client.from('lead_imports').upsert({
        user_id: user.id,
        import_batch_id: batch.id,
        lead_id: lead.id,
        original_payload: row.original,
        normalized_payload: { lead: row.lead, location: row.location }
      }, { onConflict: 'user_id,import_batch_id,lead_id' });

      await client.from('lead_snapshots').insert({
        user_id: user.id,
        lead_id: lead.id,
        import_batch_id: batch.id,
        snapshot_type: 'import',
        snapshot: { lead: row.lead, location: row.location, original: row.original }
      });

      await client.from('lead_events').insert({
        user_id: user.id,
        lead_id: lead.id,
        event_type: 'LEAD_IMPORTED',
        event_payload: { import_batch_id: batch.id, created: !!inserted }
      });
    }

    await client.from('import_batches').update({ quantity_created: created, quantity_merged: merged }).eq('id', batch.id).eq('user_id', user.id);

    if (typeof notify === 'function') notify(`Importação salva: ${created} novo(s), ${merged} mesclado(s).`);
    if (typeof loadSupabaseLeadsToLocalState === 'function') await loadSupabaseLeadsToLocalState();
    if (typeof renderInicio === 'function') renderInicio();
    if (typeof updateBadges === 'function') updateBadges();

    return { batch_id: batch.id, created, merged, total: rows.length };
  }

  window.importarLeadsPersistente = importarLeadsPersistente;
  window.importarLeads = importarLeadsPersistente;
})();
