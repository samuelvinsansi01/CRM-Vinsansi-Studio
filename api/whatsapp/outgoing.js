const SUPABASE_URL = process.env.SUPABASE_URL || 'https://txyknazfufashgzlxkqh.supabase.co';
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
function backendHeaders(extra = {}) {
  const key = SUPABASE_SECRET_KEY || SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SECRET_KEY ou SUPABASE_SERVICE_ROLE_KEY ausente na Vercel');
  const headers = { apikey:key, 'Content-Type':'application/json', ...extra };
  if (!key.startsWith('sb_secret_')) headers.Authorization = `Bearer ${key}`;
  return headers;
}
function parseBody(req){ if (!req.body) return {}; if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } } return req.body; }
function normalizePhone(value=''){ let d=String(value||'').replace(/\D/g,''); if(d.startsWith('00')) d=d.slice(2); if(d && !d.startsWith('55') && (d.length===10||d.length===11)) d='55'+d; return d; }
function makeExternalId(value=''){ return String(value || `out_${Date.now()}_${Math.random().toString(36).slice(2)}`).trim(); }
async function supabaseFetch(path, options={}){ const res=await fetch(`${SUPABASE_URL.replace(/\/$/,'')}/rest/v1/${path}`, { ...options, headers:backendHeaders(options.headers||{}) }); const raw=await res.text(); let data=raw; try{data=JSON.parse(raw)}catch{} if(!res.ok) throw new Error(`Supabase HTTP ${res.status}: ${typeof data==='string'?data:JSON.stringify(data)}`); return data; }
export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
  if(req.method==='OPTIONS') return res.status(200).end();
  if(req.method!=='POST') return res.status(405).json({ success:false, error:'Method not allowed' });
  try{
    const body=parseBody(req);
    const userId=String(body.user_id||body.userId||'').trim();
    if(!userId) throw new Error('user_id ausente');
    const phone=normalizePhone(body.phone||body.phone_normalized||body.to||'');
    const externalMessageId=makeExternalId(body.external_message_id||body.external_id||body.id);
    const payload={
      user_id:userId,
      lead_id:body.lead_id||body.leadId||null,
      whatsapp_instance_id:null,
      instance: body.instance || body.chip_instance || null,
      direction:'out',
      external_message_id:externalMessageId,
      external_id:externalMessageId,
      remote_jid: phone ? `${phone}@s.whatsapp.net` : null,
      sender_jid: body.sender_jid || null,
      phone,
      phone_normalized: phone,
      body: body.body || body.text || body.message || '',
      message_type:'text',
      status: body.status || 'sent',
      payload_original: body.raw_payload || body.response || body,
      raw_payload: body.raw_payload || body.response || body,
      occurred_at: body.occurred_at || body.occurredAt || new Date().toISOString()
    };
    const data=await supabaseFetch('whatsapp_messages?on_conflict=user_id,external_message_id', {
      method:'POST',
      headers:{ Prefer:'resolution=merge-duplicates,return=representation' },
      body:JSON.stringify(payload)
    });
    const stored=Array.isArray(data)?data[0]:data;
    return res.status(200).json({ success:true, stored:true, id:stored?.id||null, external_message_id:stored?.external_message_id||null });
  }catch(error){ console.error('[outgoing]', error); return res.status(500).json({ success:false, error:error?.message||'erro interno' }); }
}
