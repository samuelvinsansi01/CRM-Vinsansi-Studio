import { assertMethod, assertSecret, sbRest, getLeadById, upsertInstagramBasePermanente } from './_utils.js';

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
    let patch = { updated_at: now, last_action_at: now };

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
