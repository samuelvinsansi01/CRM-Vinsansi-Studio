import { getSupabaseAdmin, normalizePhone } from '../../../_lib/supabase.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    const sb = getSupabaseAdmin();
    if (req.method === 'GET') {
      const user_id = req.query.user_id;
      if (!user_id) return res.status(400).json({ error:'user_id obrigatório' });
      const { data, error } = await sb.from('sent_contacts').select('normalized_phone,phone,company_name,source,created_at').eq('user_id', user_id).eq('active', true).limit(20000);
      if (error) throw error;
      return res.status(200).json({ ok:true, contacts:data || [] });
    }
    if (req.method === 'POST') {
      const { user_id, contacts = [], source = 'manual' } = req.body || {};
      if (!user_id) return res.status(400).json({ error:'user_id obrigatório' });
      let inserted = 0, ignored = 0;
      for (const c of contacts) {
        const n = c.normalized_phone || normalizePhone(c.phone || c.telefone || c.whatsapp);
        if (!n) { ignored++; continue; }
        const { error } = await sb.from('sent_contacts').upsert({ user_id, lead_id:c.lead_id || null, company_name:c.company_name || c.nome || c.empresa || '', phone:c.phone || c.telefone || c.whatsapp || n, normalized_phone:n, block_type:c.block_type || 'already_sent', source, reason:c.reason || 'importado manualmente', active:true, dispatched_at:c.dispatched_at || c.updated_at || c.created_at || null, raw_payload:c }, { onConflict:'user_id,normalized_phone,active' });
        if (error) ignored++; else inserted++;
      }
      return res.status(200).json({ ok:true, inserted, ignored });
    }
    return res.status(405).json({ error:'Method not allowed' });
  } catch (err) { return res.status(500).json({ ok:false, error:err.message }); }
}
