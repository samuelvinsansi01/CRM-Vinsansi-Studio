const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://txyknazfufashgzlxkqh.supabase.co').replace(/\/$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
const EXTENSION_SECRET = process.env.INSTAGRAM_EXTENSION_SECRET || '';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-instagram-extension-secret');
}

function assertMethod(req, res, methods = []) {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(200).end(); return false; }
  if (!methods.includes(req.method)) { res.status(405).json({ success:false, error:'Method not allowed' }); return false; }
  return true;
}

function assertSecret(req) {
  if (!EXTENSION_SECRET) return true;
  const provided = String(req.headers['x-instagram-extension-secret'] || '').trim();
  if (provided !== EXTENSION_SECRET) throw new Error('Extensão não autorizada');
  return true;
}

function cleanUsername(value = '') {
  let s = String(value || '').trim();
  if (!s) return '';
  s = s.replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
    .replace(/^instagram\.com\//i, '')
    .replace(/^@/, '')
    .split(/[/?#]/)[0]
    .trim();
  return s.replace(/[^a-zA-Z0-9._]/g, '').toLowerCase();
}

function normalizePhone(value = '') {
  let digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('55')) return digits;
  if (digits.length === 10 || digits.length === 11) return '55' + digits;
  return digits;
}

function isUuid(value = '') {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

async function sbRest(path, options = {}) {
  if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY ou SUPABASE_SECRET_KEY ausente na Vercel');
  const headers = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: options.prefer || 'return=representation',
    ...(options.headers || {})
  };
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...options, headers });
  const raw = await res.text();
  let data = raw;
  try { data = raw ? JSON.parse(raw) : null; } catch (_) {}
  if (!res.ok) {
    const msg = data?.message || data?.hint || raw || `Supabase HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

async function getLeadById(userId, leadId) {
  if (!leadId || !isUuid(leadId)) return null;
  const rows = await sbRest(`leads?select=*&user_id=eq.${encodeURIComponent(userId)}&id=eq.${encodeURIComponent(leadId)}&limit=1`, { method:'GET', prefer:'return=minimal' });
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function upsertInstagramBasePermanente({ userId, item, lead, when }) {
  const ig = cleanUsername(item?.instagram_username || item?.instagram_url || lead?.instagram_username || lead?.instagram_url || lead?.instagram || '');
  const phone = normalizePhone(lead?.normalized_phone || lead?.phone || '');
  const company = item?.company_name || lead?.company_name || 'Lead Instagram';

  const payload = {
    user_id: userId,
    company_name: company,
    phone: lead?.phone || null,
    normalized_phone: phone || null,
    website: lead?.website || null,
    instagram_url: ig ? `https://www.instagram.com/${ig}/` : (lead?.instagram_url || null),
    instagram_username: ig || lead?.instagram_username || null,
    category: lead?.category || null,
    category_name: lead?.category_name || null,
    categories: lead?.categories || null,
    city: lead?.city || null,
    state: lead?.state || null,
    country_code: lead?.country_code || 'BR',
    rating: lead?.rating || null,
    reviews_count: lead?.reviews_count || null,
    maps_url: lead?.maps_url || null,
    raw_payload: lead?.raw_payload || null,
    source: 'instagram_extension_api',
    last_channel: 'instagram',
    last_event_type: 'instagram_sent',
    last_event_status: 'sent',
    instagram_sent_at: when,
    last_contact_at: when,
    status: 'instagram_sent',
    updated_at: new Date().toISOString()
  };

  let existing = [];
  if (phone || ig) {
    const or = [];
    if (phone) or.push(`normalized_phone.eq.${encodeURIComponent(phone)}`);
    if (ig) or.push(`instagram_username.eq.${encodeURIComponent(ig)}`);
    existing = await sbRest(`base_permanente?select=id&user_id=eq.${encodeURIComponent(userId)}&or=(${or.join(',')})&limit=1`, { method:'GET', prefer:'return=minimal' });
  }

  if (Array.isArray(existing) && existing[0]?.id) {
    return await sbRest(`base_permanente?id=eq.${encodeURIComponent(existing[0].id)}`, {
      method:'PATCH',
      body: JSON.stringify(payload)
    });
  }

  payload.created_at = new Date().toISOString();
  return await sbRest('base_permanente', {
    method:'POST',
    body: JSON.stringify(payload)
  });
}

export default async function handler(req, res) {
  if (!assertMethod(req, res, ['POST', 'PATCH'])) return;
  try {
    assertSecret(req);
    const body = req.body || {};
    const userId = String(body.user_id || body.userId || '').trim();
    const id = String(body.id || body.item_id || body.itemId || '').trim();
    const action = String(body.action || '').trim().toLowerCase();
    const reason = String(body.reason || body.error_message || '').trim();
    const followStatus = body.follow_status || body.followStatus || null;

    if (!userId) return res.status(400).json({ success:false, error:'user_id ausente' });
    if (!id) return res.status(400).json({ success:false, error:'id do item ausente' });

    const found = await sbRest(`instagram_dispatch_items?select=*&user_id=eq.${encodeURIComponent(userId)}&id=eq.${encodeURIComponent(id)}&limit=1`, { method:'GET', prefer:'return=minimal' });
    const item = Array.isArray(found) ? found[0] || null : null;
    if (!item) return res.status(404).json({ success:false, error:'Item da fila Instagram não encontrado' });

    const now = new Date().toISOString();
    let patch = { updated_at: now };

    if (action === 'sent' || action === 'mark_sent') {
      patch = { ...patch, status:'sent', sent_at: now, error_message:null };
      if (followStatus) patch.follow_status = followStatus;
      if (followStatus === 'followed' || followStatus === 'already_following') patch.followed_at = item.followed_at || now;
    } else if (action === 'error' || action === 'mark_error') {
      patch = { ...patch, status:'error', error_message: reason || 'erro operacional' };
    } else if (action === 'follow') {
      patch = { ...patch, follow_status: followStatus || 'followed', followed_at: item.followed_at || now };
    } else {
      return res.status(400).json({ success:false, error:'action inválida' });
    }

    const updatedRows = await sbRest(`instagram_dispatch_items?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}`, {
      method:'PATCH',
      body: JSON.stringify(patch)
    });
    const updated = Array.isArray(updatedRows) ? updatedRows[0] || { ...item, ...patch } : { ...item, ...patch };

    if (patch.status === 'sent') {
      const lead = await getLeadById(userId, item.lead_id);
      await upsertInstagramBasePermanente({ userId, item: updated, lead, when: now });
    }

    return res.status(200).json({ success:true, item:updated });
  } catch (error) {
    return res.status(500).json({ success:false, error:error?.message || 'Erro ao atualizar fila Instagram' });
  }
}
