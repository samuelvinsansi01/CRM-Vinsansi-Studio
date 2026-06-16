/* Proteção central por telefone: evita reimportar/reenviar números já enviados. */
(function(){
  function normalizeSentContactPhoneV30(value){
    let digits = String(value || '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits.startsWith('00')) digits = digits.slice(2);
    if (digits.startsWith('55')) return digits;
    if (digits.length === 10 || digits.length === 11) return '55' + digits;
    return digits;
  }

  function getSentContactsUserIdV30(){
    try { return currentUser?.id ? String(currentUser.id) : ''; } catch(e) { return ''; }
  }

  async function isPhoneAlreadySentV30(phone){
    const normalizedPhone = normalizeSentContactPhoneV30(phone);
    const userId = getSentContactsUserIdV30();
    if (!normalizedPhone) return { ok:false, blocked:false, normalizedPhone, error:'Telefone inválido' };
    if (!userId) return { ok:false, blocked:false, normalizedPhone, error:'Usuário não autenticado' };
    if (typeof sbClient === 'undefined' || !sbClient) return { ok:false, blocked:false, normalizedPhone, error:'Supabase não inicializado' };

    const { data, error } = await sbClient
      .from('sent_contacts')
      .select('id,company_name,phone,normalized_phone,reason,dispatched_at,created_at')
      .eq('user_id', userId)
      .eq('normalized_phone', normalizedPhone)
      .eq('active', true)
      .maybeSingle();

    if (error) return { ok:false, blocked:false, normalizedPhone, error:error.message || String(error) };
    return { ok:true, blocked:!!data, normalizedPhone, contact:data || null };
  }

  async function assertPhoneNotAlreadySentV30(phone){
    const check = await isPhoneAlreadySentV30(phone);
    if (!check.ok) throw new Error('Proteção de enviados indisponível: ' + check.error);
    if (check.blocked) throw new Error('Envio bloqueado: telefone já está em Já enviados');
    return check;
  }

  async function markPhoneAsSentV30(payload = {}){
    const userId = getSentContactsUserIdV30();
    const normalizedPhone = normalizeSentContactPhoneV30(payload.phone || payload.whatsapp || payload.normalized_phone || '');
    if (!userId) return { ok:false, error:'Usuário não autenticado' };
    if (!normalizedPhone) return { ok:false, error:'Telefone inválido' };
    if (typeof sbClient === 'undefined' || !sbClient) return { ok:false, error:'Supabase não inicializado' };

    const row = {
      user_id: userId,
      lead_id: payload.leadId || payload.lead_id || null,
      company_name: payload.companyName || payload.company_name || payload.nome || payload.name || null,
      phone: payload.phone || payload.whatsapp || normalizedPhone,
      normalized_phone: normalizedPhone,
      block_type: 'already_sent',
      source: payload.source || 'dispatch',
      reason: payload.reason || 'sent_success',
      active: true,
      dispatched_at: payload.dispatchedAt || new Date().toISOString(),
      raw_payload: payload.rawPayload || payload.raw_payload || {}
    };

    const existing = await isPhoneAlreadySentV30(normalizedPhone);
    let data = null;
    if (existing.ok && existing.blocked && existing.contact?.id) {
      const updateRes = await sbClient
        .from('sent_contacts')
        .update({
          lead_id: row.lead_id || existing.contact.lead_id || null,
          company_name: row.company_name || existing.contact.company_name || null,
          phone: row.phone || existing.contact.phone || normalizedPhone,
          dispatched_at: existing.contact.dispatched_at || row.dispatched_at,
          raw_payload: row.raw_payload
        })
        .eq('id', existing.contact.id)
        .select('id')
        .maybeSingle();
      if (updateRes.error) return { ok:false, error:updateRes.error.message || String(updateRes.error), normalizedPhone };
      data = updateRes.data;
    } else {
      const insertRes = await sbClient
        .from('sent_contacts')
        .insert(row)
        .select('id')
        .maybeSingle();
      if (insertRes.error) return { ok:false, error:insertRes.error.message || String(insertRes.error), normalizedPhone };
      data = insertRes.data;
    }

    try {
      const normalizeUrl = (v) => String(v || '').trim().replace(/\/+$/, '').toLowerCase();
      let website = normalizeUrl(payload.website || payload.site || payload.website_url || payload.rawPayload?.website || payload.raw_payload?.website || '');
      try {
        if (website) {
          const u = website.startsWith('http') ? new URL(website) : new URL('https://' + website);
          website = u.hostname.replace(/^www\./,'').toLowerCase();
        }
      } catch(_) {}
      let instagram = normalizeUrl(payload.instagram_url || payload.instagram || payload.rawPayload?.instagram_url || payload.raw_payload?.instagram_url || '');
      if (instagram.includes('instagram.com')) {
        try { instagram = (new URL(instagram.startsWith('http') ? instagram : 'https://' + instagram)).pathname.split('/').filter(Boolean)[0] || instagram; } catch(_) {}
      }
      let maps = normalizeUrl(payload.maps_url || payload.googleUrl || payload.google_url || payload.rawPayload?.maps_url || payload.raw_payload?.maps_url || '');
      const sentChannel = String(payload.channel || payload.sent_channel || payload.source_channel || 'whatsapp').toLowerCase();
      const sentAt = row.dispatched_at || new Date().toISOString();
      const baseRow = {
        user_id: userId,
        company_name: row.company_name,
        normalized_phone: normalizedPhone,
        website: website || null,
        instagram_url: instagram || null,
        maps_url: maps || null,
        status: 'ja_enviado',
        notes: payload.notes || payload.reason || 'salvo automaticamente ao marcar/enviar',
        last_channel: sentChannel,
        source_account: payload.source_account || payload.source || null,
        source_instance: payload.source_instance || payload.instance || null,
        last_contact_at: sentAt,
        whatsapp_sent_at: sentChannel === 'whatsapp' ? sentAt : null,
        instagram_sent_at: sentChannel === 'instagram' ? sentAt : null,
        email_sent_at: sentChannel === 'email' ? sentAt : null,
        manual_sent_at: sentChannel === 'manual' ? sentAt : null,
        sent_channels: [sentChannel],
        last_event_type: 'sent',
        last_event_status: 'sent',
        updated_at: new Date().toISOString()
      };
      await sbClient.from('base_permanente').upsert(baseRow, { onConflict:'user_id,normalized_phone' });
      if (typeof window.recordContactEventV38 === 'function') { await window.recordContactEventV38({ ...payload, lead_id: row.lead_id, company_name: row.company_name, normalized_phone: normalizedPhone, phone: row.phone, channel: sentChannel, source_account: baseRow.source_account, source_instance: baseRow.source_instance, event_type:'sent', status:'sent', sent_at: sentAt, metadata:{ origem:'sent-contacts-protection' } }); }
    } catch(e) { console.warn('[base_permanente][mark-sent-warning]', e?.message || e); }

    try {
      const leadId = row.lead_id;
      if (leadId) {
        await sbClient
          .from('leads')
          .update({ current_status:'sent', current_stage:'archived', updated_at:new Date().toISOString() })
          .eq('user_id', userId)
          .eq('id', leadId);
      }
    } catch(e) {}

    return { ok:true, id:data?.id || null, normalizedPhone };
  }

  window.normalizeSentContactPhoneV30 = normalizeSentContactPhoneV30;
  window.isPhoneAlreadySentV30 = isPhoneAlreadySentV30;
  window.assertPhoneNotAlreadySentV30 = assertPhoneNotAlreadySentV30;
  window.markPhoneAsSentV30 = markPhoneAsSentV30;
})();
