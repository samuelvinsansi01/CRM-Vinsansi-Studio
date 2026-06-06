import { db } from '../core/supabase-client.js';
import { rpc } from './database.service.js';

export async function listAssignment(channel = null) {
  let q = db
    .from('assignment_items')
    .select('*, leads(*, lead_contacts(*), lead_websites(*))')
    .eq('status', 'pending')
    .is('deleted_at', null)
    .order('position', { ascending: true });
  if (channel) q = q.eq('channel', channel);
  const { data, error } = await q;
  if (error) throw error;
  return data;
}

export async function moveAssignmentToBacklog(assignmentId) {
  return rpc('rpc_move_assignment_to_backlog', { p_assignment_id: assignmentId });
}
