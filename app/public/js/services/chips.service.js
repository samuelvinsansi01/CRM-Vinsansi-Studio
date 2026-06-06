import { db } from '../core/supabase-client.js';

export async function listChips() {
  const { data, error } = await db
    .from('whatsapp_instances')
    .select('*')
    .eq('active', true)
    .is('deleted_at', null)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

export async function upsertChip(chip) {
  const { data, error } = await db
    .from('whatsapp_instances')
    .upsert(chip, { onConflict: 'user_id,instance_name' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function removeChip(id) {
  const { error } = await db
    .from('whatsapp_instances')
    .update({ active: false, status: 'removed', deleted_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}
