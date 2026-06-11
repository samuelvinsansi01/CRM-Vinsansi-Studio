import { getSupabaseAdmin, defaultChips } from '../../../_lib/supabase.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!['GET','POST'].includes(req.method)) return res.status(405).json({ error:'Method not allowed' });

  try {
    const user_id = req.query?.user_id || req.body?.user_id;
    if (!user_id) return res.status(400).json({ error:'user_id obrigatório' });
    const sb = getSupabaseAdmin();

    for (const chip of defaultChips) {
      await sb.from('whatsapp_instances').upsert({
        user_id,
        label: chip.label,
        name: chip.name,
        instance: chip.instance,
        base_url: chip.base_url,
        evolution_url: chip.base_url,
        url: chip.base_url,
        api_key: chip.api_key,
        status: chip.status,
        connection_state: chip.connection_state,
        active: chip.active,
        daily_limit: chip.daily_limit,
        block_size: chip.block_size,
        interval_seconds: chip.interval_seconds,
        blocks: chip.blocks,
        updated_at: new Date().toISOString()
      }, { onConflict:'user_id,instance' });
    }

    const { data: chips, error } = await sb.from('whatsapp_instances').select('*').eq('user_id', user_id).order('label');
    if (error) throw error;
    return res.status(200).json({ ok:true, chips });
  } catch (err) {
    return res.status(500).json({ ok:false, error: err.message });
  }
}
