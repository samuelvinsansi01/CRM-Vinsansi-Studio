const SUPABASE_URL = process.env.SUPABASE_URL || 'https://txyknazfufashgzlxkqh.supabase.co';
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function backendHeaders(extra = {}) {
  const backendKey = SUPABASE_SECRET_KEY || SUPABASE_SERVICE_ROLE_KEY;
  if (!backendKey) throw new Error('SUPABASE_SECRET_KEY ou SUPABASE_SERVICE_ROLE_KEY ausente na Vercel');
  const headers = { apikey: backendKey, 'Content-Type': 'application/json', ...extra };
  if (!backendKey.startsWith('sb_secret_')) headers.Authorization = `Bearer ${backendKey}`;
  return headers;
}

function normalizePhone(value = '') {
  let digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('55')) return digits;
  if (digits.length === 10 || digits.length === 11) return '55' + digits;
  return digits;
}


function parseRequestBody(req) {
  if (!req?.body) return {};
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch (e) { return {}; }
  }
  return req.body;
}

function getUserId(req, body = {}) {
  const query = req?.query || {};
  const qUserId = Array.isArray(query.user_id) ? query.user_id[0] : query.user_id;
  const qUserIdCamel = Array.isArray(query.userId) ? query.userId[0] : query.userId;
  const fromQuery = qUserId || qUserIdCamel || '';

  let fromUrl = '';
  try {
    const host = req?.headers?.host || 'localhost';
    const rawUrl = req?.url || req?.originalUrl || '';
    const url = new URL(rawUrl, `https://${host}`);
    fromUrl = url.searchParams.get('user_id') || url.searchParams.get('userId') || '';
  } catch (e) {
    fromUrl = '';
  }

  const fromBody = body?.user_id || body?.userId || '';

  return String(fromQuery || fromUrl || fromBody || '').trim();
}

function isValidUserId(value = '') {
  const str = String(value || '').trim();
  // O Supabase usa UUID, mas aqui aceitamos qualquer identificador não vazio
  // que tenha formato seguro para filtro REST, evitando falso negativo por parsing da Vercel.
  return /^[0-9a-zA-Z_-]{8,80}$/.test(str);
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

async function supabaseFetch(path, options = {}) {
  const url = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`;
  const res = await fetch(url, { ...options, headers: backendHeaders(options.headers || {}) });
  const raw = await res.text();
  let data = raw;
  try { data = JSON.parse(raw); } catch(e) {}
  if (!res.ok) throw new Error(`Supabase HTTP ${res.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  return data;
}

async function findExistingMap({ userId, instance, lid }) {
  const data = await supabaseFetch(
    `whatsapp_contact_map?select=*&user_id=eq.${encodeURIComponent(userId)}&instance=eq.${encodeURIComponent(instance)}&lid=eq.${encodeURIComponent(lid)}&limit=1`,
    { method:'GET' }
  );
  return Array.isArray(data) ? data[0] || null : null;
}


async function listMaps({ userId }) {
  const data = await supabaseFetch(
    `whatsapp_contact_map?select=*&user_id=eq.${encodeURIComponent(userId)}&order=updated_at.desc&limit=1000`,
    { method:'GET' }
  );
  return Array.isArray(data) ? data : [];
}

async function saveContactMap({ userId, instance, lid, leadId, phoneReal, pushName }) {
  const now = new Date().toISOString();
  const record = {
    user_id: userId,
    instance,
    lid,
    lead_id: leadId,
    phone_real: phoneReal,
    push_name: pushName || null,
    updated_at: now
  };

  const existing = await findExistingMap({ userId, instance, lid });
  if (existing?.id) {
    const data = await supabaseFetch(
      `whatsapp_contact_map?id=eq.${encodeURIComponent(existing.id)}`,
      {
        method:'PATCH',
        headers:{ Prefer:'return=representation' },
        body: JSON.stringify(record)
      }
    );
    return Array.isArray(data) ? data[0] : data;
  }

  const data = await supabaseFetch('whatsapp_contact_map', {
    method:'POST',
    headers:{ Prefer:'return=representation' },
    body: JSON.stringify({ ...record, created_at: now })
  });
  return Array.isArray(data) ? data[0] : data;
}


async function findLeadForUser({ userId, leadId }) {
  const safeUserId = encodeURIComponent(userId);
  const safeLeadId = encodeURIComponent(leadId);
  const data = await supabaseFetch(
    `leads?select=id,company_name,phone,user_id&id=eq.${safeLeadId}&user_id=eq.${safeUserId}&limit=1`,
    { method:'GET' }
  );
  return Array.isArray(data) ? data[0] || null : null;
}

async function updateExistingMessages({ userId, instance, lid, leadId, phoneReal }) {
  const data = await supabaseFetch(
    `whatsapp_messages?user_id=eq.${encodeURIComponent(userId)}&instance=eq.${encodeURIComponent(instance)}&phone=eq.${encodeURIComponent(lid)}`,
    {
      method:'PATCH',
      headers:{ Prefer:'return=representation' },
      body: JSON.stringify({
        lead_id: leadId,
        updated_at: new Date().toISOString()
      })
    }
  );
  return Array.isArray(data) ? data.length : 0;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-supabase-user-id');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ success:false, error:'Method not allowed' });

  try {
    const body = parseRequestBody(req);
    const claimedUserId = getUserId(req, body);
    const userId = await verifyRequestUserV23(req, claimedUserId);
    console.log('[contact-map][request]', {
      method: req.method,
      query: req.query || {},
      url: req.url,
      body: req.method === 'GET' ? null : body,
      claimedUserId,
      userIdResolved: userId
    });

    if (req.method === 'GET') {
      if (!isValidUserId(userId)) throw new Error('user_id inválido ou ausente');
      const maps = await listMaps({ userId });
      return res.status(200).json({ success:true, maps });
    }

    const instance = String(body.instance || '').trim();
    const lid = normalizePhone(body.lid || body.phone_lid || '');
    const leadId = String(body.lead_id || body.leadId || '').trim();
    const phoneReal = normalizePhone(body.phone_real || body.phoneReal || body.phone || '');
    const pushName = String(body.push_name || body.pushName || '').trim();

    if (!isValidUserId(userId)) throw new Error('user_id inválido ou ausente');
    if (!instance) throw new Error('instance ausente');
    if (!lid) throw new Error('lid ausente');
    if (!leadId) throw new Error('lead_id ausente');
    if (!phoneReal) throw new Error('phone_real ausente');

    const lead = await findLeadForUser({ userId, leadId });
    if (!lead?.id) throw new Error('lead_id não pertence à sessão autenticada');
    const safePhoneReal = normalizePhone(lead.phone || phoneReal);
    if (!safePhoneReal) throw new Error('lead selecionado está sem telefone');

    const map = await saveContactMap({ userId, instance, lid, leadId: lead.id, phoneReal: safePhoneReal, pushName });
    const updatedMessages = await updateExistingMessages({ userId, instance, lid, leadId: lead.id, phoneReal: safePhoneReal });

    return res.status(200).json({ success:true, map, updatedMessages });
  } catch (error) {
    console.error('[api/whatsapp/contact-map] error', error?.message || error);
    return res.status(500).json({ success:false, error:error?.message || 'Erro ao associar conversa' });
  }
}
