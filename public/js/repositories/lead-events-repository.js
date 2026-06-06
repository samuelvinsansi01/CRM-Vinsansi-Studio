window.LeadEventsRepository = (() => {
  async function timeline(leadId) {
    return window.DbClient.select('lead_events', q => q.eq('lead_id', leadId).order('created_at', { ascending: false }));
  }

  async function log(leadId, eventType, payload = {}) {
    return window.DbClient.rpc('rpc_log_lead_event', {
      p_lead_id: leadId,
      p_event_type: eventType,
      p_payload: payload
    });
  }

  return { timeline, log };
})();
