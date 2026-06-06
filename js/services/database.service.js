import { db } from '../core/supabase-client.js';

export async function rpc(name, args = {}) {
  const { data, error } = await db.rpc(name, args);
  if (error) throw error;
  return data;
}

export async function select(table, query = '*', filters = []) {
  let q = db.from(table).select(query);
  for (const filter of filters) q = filter(q);
  const { data, error } = await q;
  if (error) throw error;
  return data;
}
