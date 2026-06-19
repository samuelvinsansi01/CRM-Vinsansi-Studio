import { assertMethod, assertSecret, cleanUsername, todayISO, sbRest } from './_utils.js';

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
