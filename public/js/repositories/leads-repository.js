window.LeadsRepository = (() => {
  async function list({ stage = null, channel = null, search = '', limit = 50 } = {}) {
    return window.DbClient.select('v_lead_cards', q => {
      let query = q.order('created_at', { ascending: false }).limit(limit);
      if (stage) query = query.eq('current_stage', stage);
      if (channel) query = query.eq('lead_channel', channel);
      if (search) query = query.ilike('company_name', `%${search}%`);
      return query;
    });
  }

  async function getById(id) {
    const rows = await window.DbClient.select('v_lead_cards', q => q.eq('id', id).limit(1));
    return rows[0] || null;
  }

  async function createManual(payload) {
    return window.DbClient.rpc('rpc_create_lead_manual', {
      p_company_name: payload.company_name,
      p_phone: payload.phone || null,
      p_website: payload.website || null,
      p_instagram_url: payload.instagram_url || null,
      p_location: payload.location || {}
    });
  }

  async function moveStage(leadId, toStage, reason = null) {
    return window.DbClient.rpc('rpc_move_lead_stage', {
      p_lead_id: leadId,
      p_to_stage: toStage,
      p_reason: reason
    });
  }

  async function addToBacklog(leadId, channel, reason = null) {
    return window.DbClient.rpc('rpc_add_to_backlog', {
      p_lead_id: leadId,
      p_channel: channel,
      p_reason: reason
    });
  }

  async function addToQueue(leadId, channel, scheduledFor = null) {
    return window.DbClient.rpc('rpc_add_to_queue', {
      p_lead_id: leadId,
      p_channel: channel,
      p_scheduled_for: scheduledFor
    });
  }

  return { list, getById, createManual, moveStage, addToBacklog, addToQueue };
})();
