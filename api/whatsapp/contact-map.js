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
  if (!digits.startsWith('55') && (digits.length === 10 || digits.length === 11)) digits = '55' + digits;
  return digits;
}
function parseRequestBody(req) {
  if (!req?.body) return {};
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  return req.body;
}
function getBearerToken(req) {
  const authorization = String(req?.headers?.authorization || req?.headers?.Authorization || '');
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}
async function verifyRequestUser(req, claimedUserId = '') {
  const token = getBearerToken(req);
  if (!token) throw new Error('auth ausente');
  const backendKey = SUPABASE_SECRET_KEY || SUPABASE_SERVICE_ROLE_KEY;
  const res = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/auth/v1/user`, { headers: { apikey: backendKey, Authorization: `Bearer ${token}` } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.id) throw new Error('auth inválida');
  if (claimedUserId && String(claimedUserId) !== String(data.id)) throw new Error('user_id não pertence à sessão autenticada');
  return data.id;
}
function getUserId(req, body = {}) {
  const query = req?.query || {};
  return String(query.user_id || query.userId || body.user_id || body.userId || '').trim();
}
async function supabaseFetch(path, options = {}) {
  const url = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`;
  const res = await fetch(url, { ...options, headers: backendHeaders(options.headers || {}) });
  const raw = await res.text();
  let data = raw;
  try { data = JSON.parse(raw); } catch {}
  if (!res.ok) throw new Error(`Supabase HTTP ${res.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  return data;
}
async function listMaps(userId) {
  try {
    const data = await supabaseFetch(`whatsapp_contact_map?select=*&user_id=eq.${encodeURIComponent(userId)}&order=updated_at.desc&limit=1000`);
    return Array.isArray(data) ? data : [];
  } catch (error) {
    const message = String(error?.message || error || '');
    if (message.includes('whatsapp_contact_map') || message.includes('PGRST') || message.includes('42P01')) {
      console.warn('[contact-map] tabela ausente/incompleta; rode sql/00642_whatsapp_contact_map_repair.sql', message);
      return [];
    }
    throw error;
  }
}
async function findExistingMap({ userId, lid, phoneReal }) {
  const filters = [`user_id=eq.${encodeURIComponent(userId)}`];
  if (lid) filters.push(`lid=eq.${encodeURIComponent(lid)}`);
  else if (phoneReal) filters.push(`normalized_phone_real=eq.${encodeURIComponent(phoneReal)}`);
  const data = await supabaseFetch(`whatsapp_contact_map?select=*&${filters.join('&')}&limit=1`);
  return Array.isArray(data) ? data[0] || null : null;
}
async function findLeadForUser({ userId, leadId }) {
  const data = await supabaseFetch(`leads?select=id,company_name,phone,user_id&id=eq.${encodeURIComponent(leadId)}&user_id=eq.${encodeURIComponent(userId)}&limit=1`);
  return Array.isArray(data) ? data[0] || null : null;
}
async function saveContactMap({ userId, lid, leadId, phoneReal, pushName, raw }) {
  const now = new Date().toISOString();
  const normalizedPhone = normalizePhone(phoneReal);
  const record = {
    user_id: userId,
    whatsapp_instance_id: null,
    lid: lid || null,
    lead_id: leadId || null,
    phone_real: phoneReal || null,
    normalized_phone_real: normalizedPhone || null,
    push_name: pushName || null,
    raw_payload: raw || {},
    updated_at: now
  };
  const existing = await findExistingMap({ userId, lid, phoneReal: normalizedPhone });
  if (existing?.id) {
    const data = await supabaseFetch(`whatsapp_contact_map?id=eq.${encodeURIComponent(existing.id)}`, { method:'PATCH', headers:{ Prefer:'return=representation' }, body:JSON.stringify(record) });
    return Array.isArray(data) ? data[0] : data;
  }
  const data = await supabaseFetch('whatsapp_contact_map', { method:'POST', headers:{ Prefer:'return=representation' }, body:JSON.stringify({ ...record, created_at: now }) });
  return Array.isArray(data) ? data[0] : data;
}
async function updateExistingMessages({ userId, lid, leadId }) {
  if (!lid || !leadId) return 0;
  const data = await supabaseFetch(`whatsapp_messages?user_id=eq.${encodeURIComponent(userId)}&remote_jid=ilike.*${encodeURIComponent(lid)}*`, {
    method:'PATCH', headers:{ Prefer:'return=representation' }, body:JSON.stringify({ lead_id: leadId })
  });
  return Array.isArray(data) ? data.length : 0;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-supabase-user-id');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ success:false, error:'Method not allowed' });

  const body = parseRequestBody(req);

  // A listagem de mapas é auxiliar para Conversas/Caixa de Entrada. Ela nunca deve
  // derrubar a navegação do CRM. Se auth/env/tabela falhar, devolve lista vazia.
  if (req.method === 'GET') {
    try {
      if (!SUPABASE_SECRET_KEY && !SUPABASE_SERVICE_ROLE_KEY) {
        return res.status(200).json({ success:true, maps:[], warning:'service key ausente' });
      }
      let userId = getUserId(req, body);
      try { userId = await verifyRequestUser(req, userId); } catch (authError) {
        console.warn('[contact-map:get] auth indisponível; usando user_id informado como fallback seguro de leitura vazia se necessário', authError?.message || authError);
      }
      if (!userId) return res.status(200).json({ success:true, maps:[], warning:'user_id ausente' });
      const maps = await listMaps(userId).catch(error => {
        console.warn('[contact-map:get] falha ao listar mapas; retornando vazio', error?.message || error);
        return [];
      });
      return res.status(200).json({ success:true, maps });
    } catch (error) {
      console.warn('[contact-map:get] fallback vazio', error?.message || error);
      return res.status(200).json({ success:true, maps:[], warning:error?.message || 'contact-map indisponível' });
    }
  }

  try {
    const userId = await verifyRequestUser(req, getUserId(req, body));
    const lid = normalizePhone(body.lid || body.phone_lid || body.remote_jid || '');
    const leadId = String(body.lead_id || body.leadId || '').trim();
    const phoneReal = normalizePhone(body.phone_real || body.phoneReal || body.phone || '');
    const pushName = String(body.push_name || body.pushName || '').trim();
    if (!lid) throw new Error('lid ausente');
    if (!leadId) throw new Error('lead_id ausente');
    const lead = await findLeadForUser({ userId, leadId });
    if (!lead?.id) throw new Error('lead_id não pertence à sessão autenticada');
    const safePhoneReal = normalizePhone(lead.phone || phoneReal);
    const map = await saveContactMap({ userId, lid, leadId: lead.id, phoneReal: safePhoneReal, pushName, raw: body });
    const updatedMessages = await updateExistingMessages({ userId, lid, leadId: lead.id });
    return res.status(200).json({ success:true, map, updatedMessages });
  } catch (error) {
    console.error('[contact-map:post]', error);
    return res.status(500).json({ success:false, error:error?.message || 'erro interno' });
  }
}
