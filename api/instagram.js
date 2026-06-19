const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://txyknazfufashgzlxkqh.supabase.co').replace(/\/$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
const EXTENSION_SECRET = process.env.INSTAGRAM_EXTENSION_SECRET || '';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-instagram-extension-secret');
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
function todayISO() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}
function isUuid(value = '') {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}
function normalizePhone(value = '') {
  let digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('55')) return digits;
  if (digits.length === 10 || digits.length === 11) return '55' + digits;
  return digits;
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
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...options, headers });
  const raw = await r.text();
  let data = raw;
  try { data = raw ? JSON.parse(raw) : null; } catch (_) {}
  if (!r.ok) throw new Error(data && data.message ? data.message : (raw || `Supabase HTTP ${r.status}`));
  return data;
}
async function findLead(userId, leadId) {
  if (!isUuid(leadId)) return null;
  const rows = await sbRest(`leads?select=*&user_id=eq.${encodeURIComponent(userId)}&id=eq.${encodeURIComponent(leadId)}&limit=1`, { method:'GET', prefer:'return=minimal' });
  return Array.isArray(rows) ? rows[0] || null : null;
}
async function nextItem(body) {
  const userId = String(body.user_id || body.userId || '').trim();
  const profileUsername = cleanUsername(body.profile_username || body.profileUsername || body.profile || '');
  const scheduledDate = String(body.scheduled_date || body.scheduledDate || todayISO()).slice(0, 10);
  if (!userId) throw new Error('user_id ausente');
  if (!profileUsername) throw new Error('profile_username ausente');
  const path = [
    'instagram_dispatch_items?select=*',
    `user_id=eq.${encodeURIComponent(userId)}`,
    `profile_username=eq.${encodeURIComponent(profileUsername)}`,
    `scheduled_date=eq.${encodeURIComponent(scheduledDate)}`,
    'status=eq.queued',
    'order=block_number.asc,position.asc',
    'limit=1'
  ].join('&');
  const rows = await sbRest(path, { method:'GET', prefer:'return=minimal' });
  return Array.isArray(rows) ? rows[0] || null : null;
}
async function upsertBase(userId, item, lead, when) {
  const ig = cleanUsername(item.instagram_username || item.instagram_url || (lead && (lead.instagram_username || lead.instagram_url || lead.instagram)) || '');
  const phone = normalizePhone(lead && (lead.normalized_phone || lead.phone) || '');
  const payload = {
    user_id: userId,
    company_name: item.company_name || (lead && lead.company_name) || 'Lead Instagram',
    phone: lead && lead.phone || null,
    normalized_phone: phone || null,
    website: lead && lead.website || null,
    instagram_url: ig ? `https://www.instagram.com/${ig}/` : (lead && lead.instagram_url || null),
    instagram_username: ig || (lead && lead.instagram_username) || null,
    category: lead && lead.category || null,
    category_name: lead && lead.category_name || null,
    categories: lead && lead.categories || null,
    city: lead && lead.city || null,
    state: lead && lead.state || null,
    country_code: lead && lead.country_code || 'BR',
    rating: lead && lead.rating || null,
    reviews_count: lead && lead.reviews_count || null,
    maps_url: lead && lead.maps_url || null,
    raw_payload: lead && lead.raw_payload || null,
    source: 'instagram_extension_api',
    last_channel: 'instagram',
    last_event_type: 'instagram_sent',
    last_event_status: 'sent',
    instagram_sent_at: when,
    last_contact_at: when,
    status: 'instagram_sent',
    updated_at: new Date().toISOString()
  };
  const or = [];
  if (phone) or.push(`normalized_phone.eq.${encodeURIComponent(phone)}`);
  if (ig) or.push(`instagram_username.eq.${encodeURIComponent(ig)}`);
  let existing = [];
  if (or.length) existing = await sbRest(`base_permanente?select=id&user_id=eq.${encodeURIComponent(userId)}&or=(${or.join(',')})&limit=1`, { method:'GET', prefer:'return=minimal' });
  if (Array.isArray(existing) && existing[0] && existing[0].id) {
    return sbRest(`base_permanente?id=eq.${encodeURIComponent(existing[0].id)}`, { method:'PATCH', body: JSON.stringify(payload) });
  }
  payload.created_at = new Date().toISOString();
  return sbRest('base_permanente', { method:'POST', body: JSON.stringify(payload) });
}
async function updateItem(body) {
  const userId = String(body.user_id || body.userId || '').trim();
  const id = String(body.id || body.item_id || body.itemId || '').trim();
  const action = String(body.action || '').trim().toLowerCase();
  const reason = String(body.reason || body.error_message || '').trim();
  const followStatus = body.follow_status || body.followStatus || null;
  if (!userId) throw new Error('user_id ausente');
  if (!id) throw new Error('id do item ausente');
  const found = await sbRest(`instagram_dispatch_items?select=*&user_id=eq.${encodeURIComponent(userId)}&id=eq.${encodeURIComponent(id)}&limit=1`, { method:'GET', prefer:'return=minimal' });
  const item = Array.isArray(found) ? found[0] || null : null;
  if (!item) throw new Error('Item da fila Instagram não encontrado');
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
    throw new Error('action inválida');
  }
  const rows = await sbRest(`instagram_dispatch_items?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}`, { method:'PATCH', body: JSON.stringify(patch) });
  const updated = Array.isArray(rows) ? rows[0] || { ...item, ...patch } : { ...item, ...patch };
  if (patch.status === 'sent') {
    const lead = await findLead(userId, item.lead_id);
    await upsertBase(userId, updated, lead, now);
  }
  return updated;
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!['GET','POST'].includes(req.method)) return res.status(405).json({ success:false, error:'Method not allowed' });
  try {
    if (EXTENSION_SECRET) {
      const provided = String(req.headers['x-instagram-extension-secret'] || '').trim();
      if (provided !== EXTENSION_SECRET) return res.status(401).json({ success:false, error:'Extensão não autorizada' });
    }
    const input = req.method === 'GET' ? (req.query || {}) : (req.body || {});
    const action = String(input.action || req.query.action || '').trim().toLowerCase();
    if (action === 'next') {
      const item = await nextItem(input);
      return res.status(200).json({ success:true, item, empty:!item });
    }
    if (action === 'update') {
      const item = await updateItem(input);
      return res.status(200).json({ success:true, item });
    }
    return res.status(400).json({ success:false, error:'action obrigatória: next ou update' });
  } catch (e) {
    return res.status(500).json({ success:false, error:e && e.message ? e.message : 'Erro API Instagram' });
  }
};
