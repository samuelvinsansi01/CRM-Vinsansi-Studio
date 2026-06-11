import { getSupabaseAdmin, normalizePhone, isChipConnected } from '../../../_lib/supabase.js';

async function sendText(chip, number, text) {
  const base = String(chip.base_url || chip.evolution_url || chip.url || '').replace(/\/$/, '');
  const endpoint = `${base}/message/sendText/${encodeURIComponent(chip.instance)}`;
  const res = await fetch(endpoint, {
    method:'POST',
    headers:{ 'Content-Type':'application/json', apikey: chip.api_key },
    body: JSON.stringify({ number, options:{ delay:1000 }, textMessage:{ text:String(text || '') } })
  });
  const data = await res.json().catch(async () => ({ raw: await res.text().catch(()=>'') }));
  if (!res.ok) throw new Error(data?.message || data?.error || `Evolution HTTP ${res.status}`);
  return data;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error:'Method not allowed' });

  try {
    const { user_id, item = {}, chip: chipClient = {} } = req.body || {};
    if (!user_id) return res.status(400).json({ error:'user_id obrigatório' });
    const sb = getSupabaseAdmin();
    const normalized = normalizePhone(item.telefone || item.phone || item.whatsapp);
    if (!normalized || normalized.length < 12) return res.status(400).json({ error:'telefone inválido' });

    const { data: blocked } = await sb.from('sent_contacts').select('id').eq('user_id', user_id).eq('normalized_phone', normalized).eq('active', true).maybeSingle();
    if (blocked) return res.status(409).json({ ok:false, blocked:true, error:'telefone já está na proteção/já enviados' });

    const instance = chipClient.instance || item.chipInstance;
    const { data: chip, error: chipErr } = await sb.from('whatsapp_instances').select('*').eq('user_id', user_id).eq('instance', instance).maybeSingle();
    if (chipErr) throw chipErr;
    if (!chip) return res.status(404).json({ error:'chip não encontrado no banco' });
    if (!isChipConnected(chip)) return res.status(409).json({ error:`chip ${chip.label || chip.instance} não está conectado/open` });

    const msg1 = item.templateText || item.message_1 || item.mensagem || '';
    const msg2 = item.message_2 || item.linkSite || '';
    if (!msg1) return res.status(400).json({ error:'mensagem ausente' });

    let dispatchItemId = item.dbDispatchItemId || null;
    if (!dispatchItemId) {
      const { data: created, error: createErr } = await sb.from('dispatch_items').insert({
        user_id, lead_id:item.leadId || item.lead_id || null, chip_id:chip.id, instance:chip.instance,
        phone:item.telefone || item.phone || item.whatsapp, normalized_phone:normalized,
        company_name:item.nome || item.company_name || item.empresa || '', message_1:msg1, message_2:msg2 || null,
        status:'sending', position:item.position || 0
      }).select('id').single();
      if (createErr) throw createErr;
      dispatchItemId = created.id;
    }

    const response1 = await sendText(chip, normalized, msg1);
    await sb.from('dispatch_message_logs').insert({ user_id, dispatch_item_id:dispatchItemId, lead_id:item.leadId || null, chip_id:chip.id, instance:chip.instance, phone:normalized, direction:'out', part:'message_1', body:msg1, status:'sent', response_payload:response1 });

    let response2 = null;
    if (msg2) {
      response2 = await sendText(chip, normalized, msg2);
      await sb.from('dispatch_message_logs').insert({ user_id, dispatch_item_id:dispatchItemId, lead_id:item.leadId || null, chip_id:chip.id, instance:chip.instance, phone:normalized, direction:'out', part:'message_2', body:msg2, status:'sent', response_payload:response2 });
    }

    await sb.from('dispatch_items').update({ status:'sent', sent_at:new Date().toISOString(), response_payload:{ message_1:response1, message_2:response2 }, updated_at:new Date().toISOString() }).eq('id', dispatchItemId);
    if (item.leadId) await sb.from('leads').update({ current_status:'sent', current_stage:'archived', updated_at:new Date().toISOString() }).eq('id', item.leadId).eq('user_id', user_id);
    await sb.from('sent_contacts').upsert({ user_id, lead_id:item.leadId || null, company_name:item.nome || item.company_name || '', phone:item.telefone || item.phone || item.whatsapp, normalized_phone:normalized, block_type:'already_sent', source:'dispatch', reason:'enviado com sucesso pela Evolution', active:true, dispatched_at:new Date().toISOString(), raw_payload:{ item, response1, response2 } }, { onConflict:'user_id,normalized_phone,active' });

    return res.status(200).json({ ok:true, status:'sent', normalized_phone:normalized, dispatch_item_id:dispatchItemId, response:{ message_1:response1, message_2:response2 } });
  } catch (err) {
    return res.status(500).json({ ok:false, error:err.message });
  }
}
