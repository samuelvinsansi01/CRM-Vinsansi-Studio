const SUPABASE_URL = process.env.SUPABASE_URL || 'https://txyknazfufashgzlxkqh.supabase.co';
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const EVOLUTION_WEBHOOK_SECRET = process.env.EVOLUTION_WEBHOOK_SECRET || '';

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

  const messageType =
    msg.imageMessage ? 'image' :
    msg.videoMessage ? 'video' :
    msg.audioMessage ? 'audio' :
    msg.documentMessage ? 'document' :
    'text';

  return {
    externalId: key.id || data.id || `evt_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    instance: String(payload.instance || data.instance || '').trim(),
    phone,
    direction: Boolean(key.fromMe || data.fromMe) ? 'out' : 'in',
    messageType,
    body: text,
    occurredAt: new Date().toISOString()
  };
}

function getProvidedSecret(req) {
  const authorization = String(req.headers.authorization || '');
  return String(
    req.headers['x-webhook-secret'] ||
    req.query?.secret ||
    authorization.replace(/^Bearer\s+/i, '') ||
    ''
  );
}

async function persistMessage(message) {
  const backendKey = SUPABASE_SECRET_KEY || SUPABASE_SERVICE_ROLE_KEY;
  if (!backendKey) {
    throw new Error('SUPABASE_SECRET_KEY ausente na Vercel');
  }

  const endpoint = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/whatsapp_messages?on_conflict=instance,external_id`;
  const headers = {
    apikey: backendKey,
    'Content-Type': 'application/json',
    Prefer: 'resolution=merge-duplicates,return=representation'
  };
  if (!backendKey.startsWith('sb_secret_')) {
    headers.Authorization = `Bearer ${backendKey}`;
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      external_id: message.externalId,
      instance: message.instance,
      phone: message.phone,
      direction: message.direction,
      message_type: message.messageType,
      body: message.body,
      status: message.direction === 'in' ? 'received' : 'sent',
      occurred_at: message.occurredAt
    })
  });

  const raw = await res.text();
  let data = null;
  try { data = JSON.parse(raw); } catch { data = raw; }

  if (!res.ok) {
    throw new Error(`Supabase HTTP ${res.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  }

  return Array.isArray(data) ? data[0] : data;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: 'Consulta pública desativada. Use o CRM autenticado.'
    });
  }

  if (EVOLUTION_WEBHOOK_SECRET && getProvidedSecret(req) !== EVOLUTION_WEBHOOK_SECRET) {
    return res.status(401).json({ success: false, error: 'Webhook não autorizado' });
  }

  try {
    const message = extractMessage(req.body || {});

    if (!message.phone || !message.instance) {
      return res.status(200).json({
        success: true,
        stored: false,
        ignored: 'Evento sem telefone ou instância'
      });
    }

    const stored = await persistMessage(message);

    return res.status(200).json({
      success: true,
      stored: true,
      id: stored?.id || null,
      externalId: message.externalId
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error?.message || 'Webhook error'
    });
  }
}
