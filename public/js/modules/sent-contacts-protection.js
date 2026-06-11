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
