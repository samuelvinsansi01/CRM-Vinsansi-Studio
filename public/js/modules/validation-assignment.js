// Fase 4 — Validação e Atribuição
// Módulo frontend simples para consumir as views/RPCs da fase 4.
// Não persiste dados localmente. O banco continua sendo a única fonte da verdade.

export async function loadValidationQueue(supabase) {
  const { data, error } = await supabase
    .from('v_validation_queue')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

export async function loadAssignmentSummary(supabase) {
  const { data, error } = await supabase
    .from('v_assignment_summary')
    .select('*');

  if (error) throw error;
  return data || [];
}

export async function loadAssignedLeads(supabase, channel) {
  const viewByChannel = {
    whatsapp: 'v_assignment_whatsapp',
    website: 'v_assignment_website',
    instagram: 'v_assignment_instagram',
  };

  const view = viewByChannel[channel];
  if (!view) throw new Error('Canal inválido para atribuição.');

  const { data, error } = await supabase
    .from(view)
    .select('*')
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

export async function registerWhatsappValidation(supabase, payload) {
  const { data, error } = await supabase.rpc('rpc_register_whatsapp_validation', {
    p_lead_id: payload.leadId,
    p_whatsapp_instance_id: payload.whatsappInstanceId || null,
    p_attempted_phone: payload.phone || null,
    p_result: payload.result || 'pending',
    p_provider_response: payload.providerResponse || {},
    p_technical_error: payload.technicalError || null,
  });

  if (error) throw error;
  return data;
}

export async function assignLead(supabase, leadId, reason = 'Atribuição manual') {
  const { data, error } = await supabase.rpc('rpc_assign_lead', {
    p_lead_id: leadId,
    p_reason: reason,
  });

  if (error) throw error;
  return data;
}

export async function assignPendingLeads(supabase, limit = 200) {
  const { data, error } = await supabase.rpc('rpc_assign_pending_leads', {
    p_limit: limit,
  });

  if (error) throw error;
  return data || [];
}

export async function sendAssignedLeadToBacklog(supabase, leadId, reason = 'Enviado para backlog') {
  const { data, error } = await supabase.rpc('rpc_send_assigned_to_backlog', {
    p_lead_id: leadId,
    p_reason: reason,
  });

  if (error) throw error;
  return data;
}
