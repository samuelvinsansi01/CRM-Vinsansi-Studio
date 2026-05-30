
let events = [];

function normalizePhone(value = '') {
  return String(value).replace(/\D/g, '');
}

function extractMessage(payload = {}) {
  const data = payload.data || payload;
  const key = data.key || {};
  const msg = data.message || data.messageData || {};

  const remoteJid =
    key.remoteJid ||
    data.remoteJid ||
    data.from ||
    data.sender ||
    '';

  const phone = normalizePhone(String(remoteJid).split('@')[0]);

  const text =
    msg.conversation ||
    msg.extendedTextMessage?.text ||
    msg.imageMessage?.caption ||
    msg.videoMessage?.caption ||
    data.text ||
    data.body ||
    data.message?.conversation ||
    '';

  const fromMe = Boolean(key.fromMe || data.fromMe);

  return {
    id: key.id || data.id || `evt_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    event: payload.event || payload.type || 'messages.upsert',
    instance: payload.instance || data.instance || '',
    phone,
    remoteJid,
    text,
    fromMe,
    receivedAt: new Date().toISOString(),
    raw: payload
  };
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const limit = Number(req.query.limit || 100);
    return res.status(200).json({
      success: true,
      count: events.length,
      events: events.slice(0, limit)
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const payload = req.body || {};
    const event = extractMessage(payload);

    // Ignore outbound messages by default; CRM wants lead replies.
    if (!event.fromMe && event.phone) {
      events.unshift(event);
      events = events.slice(0, 500);
    }

    return res.status(200).json({
      success: true,
      stored: !event.fromMe && !!event.phone,
      event
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error?.message || 'Webhook error'
    });
  }
}
