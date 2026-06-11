import { getSupabaseAdmin, normalizePhone, isChipConnected } from '../../../_lib/supabase.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error:'Method not allowed' });
  try {
    const { user_id, instance, phone, text } = req.body || {};
    if (!user_id || !instance || !phone || !text) return res.status(400).json({ error:'user_id, instance, phone e text são obrigatórios' });
    const sb = getSupabaseAdmin();
    const { data: chip } = await sb.from('whatsapp_instances').select('*').eq('user_id', user_id).eq('instance', instance).maybeSingle();
    if (!chip) return res.status(404).json({ error:'chip não encontrado' });
    if (!isChipConnected(chip)) return res.status(409).json({ error:'chip não conectado/open' });
    const number = normalizePhone(phone);
    const endpoint = `${String(chip.base_url || chip.evolution_url || chip.url).replace(/\/$/,'')}/message/sendText/${encodeURIComponent(chip.instance)}`;
    const evo = await fetch(endpoint, { method:'POST', headers:{ 'Content-Type':'application/json', apikey:chip.api_key }, body:JSON.stringify({ number, options:{ delay:1000 }, textMessage:{ text } }) });
    const data = await evo.json().catch(() => ({}));
    await sb.from('dispatch_message_logs').insert({ user_id, chip_id:chip.id, instance:chip.instance, phone:number, direction:'out', part:'message_1', body:text, status:evo.ok?'sent':'error', response_payload:data });
    if (!evo.ok) return res.status(evo.status).json({ ok:false, error:data?.message || `HTTP ${evo.status}`, response:data });
    return res.status(200).json({ ok:true, response:data });
  } catch (err) { return res.status(500).json({ ok:false, error:err.message }); }
}
