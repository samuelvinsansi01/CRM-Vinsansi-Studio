const SUPABASE_URL = process.env.SUPABASE_URL || 'https://txyknazfufashgzlxkqh.supabase.co';
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function debugOutgoingApi(step, data = {}) {
  try { console.log(`[api/whatsapp/outgoing] ${step}`, JSON.stringify(data)); }
  catch (e) { console.log(`[api/whatsapp/outgoing] ${step}`, data); }
}

function normalizePhone(value = '') {
  let digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('55')) return digits;
  if (digits.length === 10 || digits.length === 11) return '55' + digits;
  return digits;
}

function isValidUuid(value = '') {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}


function getBearerTokenV23(req) {
  const authorization = String(req?.headers?.authorization || req?.headers?.Authorization || '');
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

async function verifyRequestUserV23(req, claimedUserId = '') {
  const token = getBearerTokenV23(req);
  if (!token) throw new Error('auth ausente');
  const backendKey = SUPABASE_SECRET_KEY || SUPABASE_SERVICE_ROLE_KEY;
  if (!backendKey) throw new Error('SUPABASE_SECRET_KEY ou SUPABASE_SERVICE_ROLE_KEY ausente na Vercel');
  const res = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/auth/v1/user`, {
    method: 'GET',
    headers: {
      apikey: backendKey,
      Authorization: `Bearer ${token}`
    }
  });
  const raw = await res.text();
  let data = raw;
  try { data = JSON.parse(raw); } catch(e) {}
  if (!res.ok || !data?.id) throw new Error('auth inválida');
  const authUserId = String(data.id || '').trim();
  const requestedUserId = String(claimedUserId || '').trim();
  if (requestedUserId && requestedUserId !== authUserId) {
    throw new Error('user_id não pertence à sessão autenticada');
  }
  return authUserId;
}


async function leadBelongsToUserV23({ userId, leadId }) {
  if (!leadId) return true;
  const backendKey = SUPABASE_SECRET_KEY || SUPABASE_SERVICE_ROLE_KEY;
  const endpoint = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/leads?select=id&user_id=eq.${encodeURIComponent(userId)}&id=eq.${encodeURIComponent(leadId)}&limit=1`;
  const headers = { apikey: backendKey, 'Content-Type': 'application/json' };
  if (!backendKey.startsWith('sb_secret_')) headers.Authorization = `Bearer ${backendKey}`;
  const res = await fetch(endpoint, { method:'GET', headers });
  const raw = await res.text();
  let data = raw;
  try { data = JSON.parse(raw); } catch(e) {}
  if (!res.ok) throw new Error(`lead lookup HTTP ${res.status}`);
  return Array.isArray(data) && data.length > 0;
}

function makeExternalId(value = '') {
  const clean = String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120);
  return clean || `out_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

async function persistOutgoing(body = {}, req = null) {
  debugOutgoingApi('request:body', body);
  const backendKey = SUPABASE_SECRET_KEY || SUPABASE_SERVICE_ROLE_KEY;
  if (!backendKey) throw new Error('SUPABASE_SECRET_KEY ou SUPABASE_SERVICE_ROLE_KEY ausente na Vercel');

  const claimedUserId = String(body.user_id || body.userId || '').trim();
  const userId = await verifyRequestUserV23(req, claimedUserId);
  if (!isValidUuid(userId)) throw new Error('user_id inválido ou ausente');

  const instance = String(body.instance || '').trim();
  const phone = normalizePhone(body.phone || body.phone_normalized || '');
  const text = String(body.body || body.text || '');
  const leadId = String(body.lead_id || body.leadId || '').trim();
  if (leadId && !(await leadBelongsToUserV23({ userId, leadId }))) throw new Error('lead_id não pertence à sessão autenticada');
  if (!instance) throw new Error('instance ausente');
  if (!phone) throw new Error('phone ausente');
  if (!text) throw new Error('body/text ausente');

  const record = {
    external_id: makeExternalId(body.external_id || body.id),
    user_id: userId,
    lead_id: leadId || null,
    instance,
    phone,
    direction: 'out',
    message_type: body.message_type || 'text',
    body: text,
    status: body.status || 'sent',
    occurred_at: body.occurred_at || body.occurredAt || new Date().toISOString(),
    updated_at: new Date().toISOString(),
    raw_payload: body.raw_payload || body.response || null
  };

  debugOutgoingApi('record:prepared', record);

  const endpoint = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/whatsapp_messages`;
  const headers = {
    apikey: backendKey,
    'Content-Type': 'application/json',
    Prefer: 'return=representation'
  };
  if (!backendKey.startsWith('sb_secret_')) headers.Authorization = `Bearer ${backendKey}`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(record)
  });

  const raw = await res.text();
  debugOutgoingApi('supabase:response', { status: res.status, ok: res.ok, raw });
  let data = raw;
  try { data = JSON.parse(raw); } catch(e) {}

  if (!res.ok) {
    throw new Error(`Supabase HTTP ${res.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  }

  return Array.isArray(data) ? data[0] : data;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-supabase-user-id');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success:false, error:'Method not allowed' });

  try {
    const stored = await persistOutgoing(req.body || {}, req);
    return res.status(200).json({ success:true, stored:true, id:stored?.id || null, external_id:stored?.external_id || null });
  } catch (error) {
    debugOutgoingApi('error', { error: error?.message || error });
    return res.status(500).json({ success:false, error:error?.message || 'Erro ao salvar mensagem enviada' });
  }
}
