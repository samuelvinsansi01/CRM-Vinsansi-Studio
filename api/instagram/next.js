const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://txyknazfufashgzlxkqh.supabase.co').replace(/\/$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
const EXTENSION_SECRET = process.env.INSTAGRAM_EXTENSION_SECRET || '';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
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

function todayISO() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
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

export default async function handler(req, res) {
  if (!assertMethod(req, res, ['POST', 'GET'])) return;
  try {
    assertSecret(req);
    const body = req.method === 'POST' ? (req.body || {}) : (req.query || {});
    const userId = String(body.user_id || body.userId || '').trim();
    const profileUsername = cleanUsername(body.profile_username || body.profileUsername || body.profile || '');
    const scheduledDate = String(body.scheduled_date || body.scheduledDate || todayISO()).slice(0, 10);

    if (!userId) return res.status(400).json({ success:false, error:'user_id ausente' });
    if (!profileUsername) return res.status(400).json({ success:false, error:'profile_username ausente' });

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
    const item = Array.isArray(rows) ? rows[0] || null : null;
    return res.status(200).json({ success:true, item, empty:!item });
  } catch (error) {
    return res.status(500).json({ success:false, error:error?.message || 'Erro ao buscar próximo lead Instagram' });
  }
}
