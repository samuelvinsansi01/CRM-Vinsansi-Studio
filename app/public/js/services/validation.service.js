import { db } from '../core/supabase-client.js';
import { rpc } from './database.service.js';

export async function listValidationPending(limit = 100) {
  const { data, error } = await db
    .from('leads')
    .select('*, lead_contacts(*)')
    .eq('current_stage', 'validation')
    .in('current_status', ['pending', 'technical_error'])
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return data;
}

export async function recordValidationResult({ leadId, contactId, instanceId, status, response = {}, error = null }) {
  return rpc('rpc_record_validation_result', {
    p_lead_id: leadId,
    p_contact_id: contactId,
    p_instance_id: instanceId,
    p_status: status,
    p_response: response,
    p_error: error
  });
}
