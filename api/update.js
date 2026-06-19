const REDIS_URL   = process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN;

const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://txyknazfufashgzlxkqh.supabase.co').replace(/\/$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
const EXTENSION_SECRET = process.env.INSTAGRAM_EXTENSION_SECRET || '';

async function redisGet(key) {
  const res = await fetch(`${REDIS_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
  });
  if (!res.ok) return null;
  const data = await res.json();

  let current = data.result;
  while (typeof current === 'string') {
    try { current = JSON.parse(current); }
    catch { break; }
  }
  if (current && typeof current === 'object' && current.value !== undefined) {
    current = current.value;
    while (typeof current === 'string') {
      try { current = JSON.parse(current); }
      catch { break; }
    }
  }
  return current;
}

async function redisSet(key, value) {
  const res = await fetch(`${REDIS_URL}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${REDIS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ value }),
  });
  if (!res.ok) throw new Error(`Redis SET failed: ${await res.text()}`);
}

function isFigmaUrl(url) {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    return parsed.protocol === 'https:' && (hostname === 'figma.com' || hostname.endsWith('.figma.com'));
  } catch {
    return false;
  }
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
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

async function instagramNext(input) {
  const userId = String(input.user_id || input.userId || '').trim();
  const profileUsername = cleanUsername(input.profile_username || input.profileUsername || input.profile || '');
  const scheduledDate = String(input.scheduled_date || input.scheduledDate || todayISO()).slice(0, 10);
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


async function instagramQueue(input) {
  const userId = String(input.user_id || input.userId || '').trim();
  const profileUsername = cleanUsername(input.profile_username || input.profileUsername || input.profile || '');
  const scheduledDate = String(input.scheduled_date || input.scheduledDate || todayISO()).slice(0, 10);
  if (!userId) throw new Error('user_id ausente');
  if (!profileUsername) throw new Error('profile_username ausente');

  const profileRows = await sbRest(
    `instagram_profiles?select=*&user_id=eq.${encodeURIComponent(userId)}&username=eq.${encodeURIComponent(profileUsername)}&active=eq.true&limit=1`,
    { method:'GET', prefer:'return=minimal' }
  );
  const profile = Array.isArray(profileRows) ? profileRows[0] || null : null;

  const path = [
    'instagram_dispatch_items?select=*',
    `user_id=eq.${encodeURIComponent(userId)}`,
    `profile_username=eq.${encodeURIComponent(profileUsername)}`,
    `scheduled_date=eq.${encodeURIComponent(scheduledDate)}`,
    'status=in.(queued,sending,error)',
    'order=block_number.asc,position.asc'
  ].join('&');
  const rows = await sbRest(path, { method:'GET', prefer:'return=minimal' });
  return { profile, items: Array.isArray(rows) ? rows : [] };
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
  if (or.length) {
    existing = await sbRest(`base_permanente?select=id&user_id=eq.${encodeURIComponent(userId)}&or=(${or.join(',')})&limit=1`, { method:'GET', prefer:'return=minimal' });
  }
  if (Array.isArray(existing) && existing[0] && existing[0].id) {
    return sbRest(`base_permanente?id=eq.${encodeURIComponent(existing[0].id)}`, { method:'PATCH', body: JSON.stringify(payload) });
  }
  payload.created_at = new Date().toISOString();
  return sbRest('base_permanente', { method:'POST', body: JSON.stringify(payload) });
}

async function instagramUpdate(input) {
  const userId = String(input.user_id || input.userId || '').trim();
  const id = String(input.id || input.item_id || input.itemId || '').trim();
  const action = String(input.item_action || input.action_item || input.update_action || input.action || '').trim().toLowerCase();
  const reason = String(input.reason || input.error_message || '').trim();
  const followStatus = input.follow_status || input.followStatus || null;
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


async function instagramProfilesList(input) {
  const userId = String(input.user_id || input.userId || '').trim();
  if (!userId) throw new Error('user_id ausente');
  const rows = await sbRest(
    `instagram_profiles?select=*&user_id=eq.${encodeURIComponent(userId)}&active=eq.true&order=username.asc`,
    { method:'GET', prefer:'return=minimal' }
  );
  return Array.isArray(rows) ? rows : [];
}

async function instagramProfileUpsert(input) {
  const userId = String(input.user_id || input.userId || '').trim();
  const username = cleanUsername(input.username || input.profile_username || input.profileUsername || input.profile || '');
  if (!userId) throw new Error('user_id ausente');
  if (!username) throw new Error('username do perfil ausente');
  const now = new Date().toISOString();
  const payload = {
    user_id: userId,
    username,
    display_name: input.display_name || input.displayName || username,
    active: true,
    daily_limit: Number(input.daily_limit || input.dailyLimit || 60) || 60,
    blocks: Number(input.blocks || 4) || 4,
    block_size: Number(input.block_size || input.blockSize || 15) || 15,
    interval_minutes: Number(input.interval_minutes || input.intervalMinutes || 120) || 120,
    status: input.status || 'active',
    updated_at: now
  };
  const existing = await sbRest(
    `instagram_profiles?select=id&user_id=eq.${encodeURIComponent(userId)}&username=eq.${encodeURIComponent(username)}&limit=1`,
    { method:'GET', prefer:'return=minimal' }
  );
  if (Array.isArray(existing) && existing[0] && existing[0].id) {
    const rows = await sbRest(
      `instagram_profiles?id=eq.${encodeURIComponent(existing[0].id)}&user_id=eq.${encodeURIComponent(userId)}`,
      { method:'PATCH', body: JSON.stringify(payload) }
    );
    return Array.isArray(rows) ? rows[0] : rows;
  }
  payload.created_at = now;
  const rows = await sbRest('instagram_profiles', { method:'POST', body: JSON.stringify(payload) });
  return Array.isArray(rows) ? rows[0] : rows;
}

async function instagramProfileRemove(input) {
  const userId = String(input.user_id || input.userId || '').trim();
  const id = String(input.id || input.profile_id || input.profileId || '').trim();
  if (!userId) throw new Error('user_id ausente');
  if (!id) throw new Error('id do perfil ausente');
  const rows = await sbRest(
    `instagram_profiles?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}`,
    { method:'PATCH', body: JSON.stringify({ active:false, updated_at:new Date().toISOString() }) }
  );
  return Array.isArray(rows) ? rows[0] || { id, active:false } : rows;
}

async function handleInstagram(input, req) {
  if (EXTENSION_SECRET) {
    const provided = String(req.headers['x-instagram-extension-secret'] || '').trim();
    if (provided !== EXTENSION_SECRET) throw new Error('Extensão não autorizada');
  }
  const action = String(input.action || '').trim().toLowerCase();
  if (action === 'instagram_next' || action === 'next') {
    const item = await instagramNext(input);
    return { success:true, item, empty:!item };
  }
  if (action === 'instagram_queue' || action === 'queue') {
    const queue = await instagramQueue(input);
    return { success:true, ...queue, empty:!queue.items.length };
  }
  if (action === 'instagram_update' || action === 'update') {
    const item = await instagramUpdate(input);
    return { success:true, item };
  }
  if (action === 'instagram_profiles_list') {
    const profiles = await instagramProfilesList(input);
    return { success:true, profiles };
  }
  if (action === 'instagram_profile_upsert') {
    const profile = await instagramProfileUpsert(input);
    return { success:true, profile };
  }
  if (action === 'instagram_profile_remove') {
    const profile = await instagramProfileRemove(input);
    return { success:true, profile };
  }
  throw new Error('action obrigatória: instagram_next, instagram_queue, instagram_update ou instagram_profile_*');
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET' || req.method === 'POST') {
      const input = req.method === 'GET' ? (req.query || {}) : (req.body || {});
      const action = String(input.action || '').trim().toLowerCase();
      if (action === 'instagram_next' || action === 'instagram_queue' || action === 'instagram_update' || action === 'next' || action === 'queue' || action === 'update' || action === 'instagram_profiles_list' || action === 'instagram_profile_upsert' || action === 'instagram_profile_remove') {
        const result = await handleInstagram(input, req);
        return res.status(200).json(result);
      }
    }

    if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });

    const { alias, deskUrl, mobUrl } = req.body;
    if (!alias) return res.status(400).json({ error: 'alias é obrigatório' });
    if (!deskUrl && !mobUrl) return res.status(400).json({ error: 'Informe ao menos um link para atualizar' });
    if ((deskUrl && !isFigmaUrl(deskUrl)) || (mobUrl && !isFigmaUrl(mobUrl))) {
      return res.status(400).json({ error: 'Os links precisam ser URLs HTTPS do Figma' });
    }

    const current = await redisGet(`redirect:${alias}`);
    if (!current) return res.status(404).json({ error: `Alias "${alias}" não encontrado no banco` });

    const updated = {
      ...current,
      deskUrl: deskUrl || current.deskUrl,
      mobUrl: mobUrl || current.mobUrl,
      updatedAt: new Date().toISOString(),
    };

    await redisSet(`redirect:${alias}`, updated);

    return res.status(200).json({
      ok: true,
      alias,
      deskUrl: updated.deskUrl,
      mobUrl: updated.mobUrl,
    });
  } catch (err) {
    console.error('update error:', err);
    return res.status(500).json({ success:false, error: err && err.message ? err.message : 'Erro ao atualizar no banco' });
  }
}
