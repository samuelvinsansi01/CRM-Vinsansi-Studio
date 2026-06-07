const SUPABASE_URL = process.env.SUPABASE_URL || 'https://txyknazfufashgzlxkqh.supabase.co';
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const WEBHOOK_SECRET = process.env.EVOLUTION_WEBHOOK_SECRET || process.env.WEBHOOK_SECRET || '';

function backendHeaders(extra = {}) {
  const key = SUPABASE_SECRET_KEY || SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SECRET_KEY ou SUPABASE_SERVICE_ROLE_KEY ausente na Vercel');
  const headers = { apikey:key, 'Content-Type':'application/json', ...extra };
  if (!key.startsWith('sb_secret_')) headers.Authorization = `Bearer ${key}`;
  return headers;
}
function parseBody(req){ if (!req.body) return {}; if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } } return req.body; }
function normalizePhone(value=''){
  let raw = String(value || '');
  raw = raw.split('@')[0];
  let d = raw.replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d && !d.startsWith('55') && (d.length === 10 || d.length === 11)) d = '55' + d;
  return d;
}
function getTextMessage(msg={}){
  const m = msg.message || msg;
  return m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || m.videoMessage?.caption || msg.body || msg.text || '';
}
function extractMessage(payload={}){
  const data = payload.data || payload.message || payload;
  const key = data.key || {};
  const remoteJid = key.remoteJid || data.remoteJid || data.chatId || '';
  const senderJid = key.participant || data.sender || data.senderJid || '';
  const externalId = key.id || data.id || data.messageId || `evo_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const fromMe = !!key.fromMe || data.fromMe === true;
  return {
    externalId,
    remoteJid,
    senderJid,
    direction: fromMe ? 'out' : 'in',
    body: getTextMessage(data),
    occurredAt: data.messageTimestamp ? new Date(Number(data.messageTimestamp) * 1000).toISOString() : new Date().toISOString(),
    instance: payload.instance || payload.instanceName || data.instance || data.instanceName || '',
    rawPayload: payload
  };
}
async function supabaseFetch(path, options={}){ const res=await fetch(`${SUPABASE_URL.replace(/\/$/,'')}/rest/v1/${path}`, { ...options, headers:backendHeaders(options.headers||{}) }); const raw=await res.text(); let data=raw; try{data=JSON.parse(raw)}catch{} if(!res.ok) throw new Error(`Supabase HTTP ${res.status}: ${typeof data==='string'?data:JSON.stringify(data)}`); return data; }
async function findUserId(payload={}){
  return String(payload.user_id || payload.userId || payload.owner || payload.owner_id || process.env.DEFAULT_USER_ID || '').trim();
}
async function findLeadByPhone(userId, phone){
  if (!userId || !phone) return null;
  const data = await supabaseFetch(`leads?select=id,phone,normalized_phone&user_id=eq.${encodeURIComponent(userId)}&normalized_phone=eq.${encodeURIComponent(phone)}&limit=1`);
  return Array.isArray(data) ? data[0] || null : null;
}
export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization, x-webhook-secret, apikey');
  if(req.method==='OPTIONS') return res.status(200).end();
  if(req.method!=='POST') return res.status(405).json({ success:false, error:'Method not allowed' });
  try{
    if (WEBHOOK_SECRET) {
      const received = req.headers['x-webhook-secret'] || req.headers['apikey'] || req.query?.secret || '';
      if (String(received) !== String(WEBHOOK_SECRET)) return res.status(401).json({ success:false, error:'invalid webhook secret' });
    }
    const payload=parseBody(req);
    const userId=await findUserId(payload);
    if(!userId) throw new Error('user_id ausente no webhook. Configure DEFAULT_USER_ID ou envie user_id.');
    const message=extractMessage(payload);
    const phone=normalizePhone(message.remoteJid || message.senderJid);
    const lead=await findLeadByPhone(userId, phone).catch(()=>null);
    const record={
      user_id:userId,
      lead_id:lead?.id || null,
      whatsapp_instance_id:null,
      instance:message.instance || null,
      direction:message.direction,
      external_message_id:message.externalId,
      external_id:message.externalId,
      remote_jid:message.remoteJid || null,
      sender_jid:message.senderJid || null,
      phone,
      phone_normalized:phone,
      body:message.body || '',
      message_type:'text',
      payload_original:message.rawPayload || payload,
      raw_payload:message.rawPayload || payload,
      occurred_at:message.occurredAt
    };
    const data=await supabaseFetch('whatsapp_messages?on_conflict=user_id,external_message_id', {
      method:'POST',
      headers:{ Prefer:'resolution=merge-duplicates,return=representation' },
      body:JSON.stringify(record)
    });
    const stored=Array.isArray(data)?data[0]:data;
    return res.status(200).json({ success:true, id:stored?.id||null, external_message_id:stored?.external_message_id||null, lead_id:stored?.lead_id||null });
  }catch(error){ console.error('[webhook-evolution]', error); return res.status(500).json({ success:false, error:error?.message||'erro interno' }); }
}
