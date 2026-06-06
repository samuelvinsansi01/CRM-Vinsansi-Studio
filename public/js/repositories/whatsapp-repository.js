window.WhatsappRepository = (() => {
  async function listInstances() {
    return window.DbClient.select('whatsapp_instances', q => q.is('archived_at', null).order('created_at', { ascending: false }));
  }

  async function listMessagesByLead(leadId, limit = 100) {
    return window.DbClient.select('whatsapp_messages', q => q.eq('lead_id', leadId).order('occurred_at', { ascending: false }).limit(limit));
  }

  return { listInstances, listMessagesByLead };
})();
