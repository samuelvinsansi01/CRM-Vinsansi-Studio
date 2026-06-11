
function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body;
}

function normalizeBaseUrl(value = '') {
  return String(value || '').trim().replace(/\/+$/, '');
}

function normalizePhone(value = '') {
  let digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (!digits.startsWith('55') && (digits.length === 10 || digits.length === 11)) digits = `55${digits}`;
  return digits;
}

function uniq(values = []) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function getApiKeys(inputKey = '') {
  return uniq([
    inputKey,
    process.env.EVOLUTION_API_KEY,
    process.env.EVOLUTION_APIKEY,
    process.env.EVOLUTION_GLOBAL_API_KEY,
    process.env.EVOLUTION_AUTHENTICATION_API_KEY,
    process.env.EVOLUTION_AUTH_KEY
  ]);
}

function headersFor(key) {
  return {
    'Content-Type': 'application/json',
    apikey: key,
    Authorization: `Bearer ${key}`
  };
}

async function readResponse(response) {
  const raw = await response.text();
  let data = raw;
  try { data = raw ? JSON.parse(raw) : {}; } catch {}
  return { data, raw };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 25000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const parsed = await readResponse(response);
    return { response, ...parsed };
  } finally {
    clearTimeout(timer);
  }
}

function textPayload(number, text) {
  return {
    number,
    options: { delay: 1000 },
    textMessage: { text: String(text || '') }
  };
}

async function sendText({ baseUrl, instance, key, phone, text, part }) {
  const url = `${baseUrl}/message/sendText/${encodeURIComponent(instance)}`;
  const { response, data, raw } = await fetchWithTimeout(url, {
    method: 'POST',
    headers: headersFor(key),
    body: JSON.stringify(textPayload(phone, text))
  });

  if (!response.ok) {
    const message = data?.message || data?.error || raw || `sendText HTTP ${response.status}`;
    const error = new Error(Array.isArray(message) ? message.join(', ') : String(message));
    error.status = response.status;
    error.part = part;
    error.response = data;
    throw error;
  }

  return { ok: true, part, status: response.status, data };
}

async function sendMedia({ baseUrl, instance, key, phone, imageBase64, mimetype = 'image/jpeg' }) {
  if (!imageBase64) return { ok: true, skipped: true, part: 'image' };

  const media = String(imageBase64 || '').includes(',')
    ? String(imageBase64).split(',')[1]
    : String(imageBase64 || '');

  if (!media) return { ok: true, skipped: true, part: 'image' };

  const url = `${baseUrl}/message/sendMedia/${encodeURIComponent(instance)}`;
  const payload = {
    number: phone,
    options: { delay: 1000 },
    mediaMessage: {
      mediatype: 'image',
      media,
      mimetype,
      fileName: 'lead-teste.jpg',
      caption: ''
    }
  };

  const { response, data, raw } = await fetchWithTimeout(url, {
    method: 'POST',
    headers: headersFor(key),
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const message = data?.message || data?.error || raw || `sendMedia HTTP ${response.status}`;
    const error = new Error(Array.isArray(message) ? message.join(', ') : String(message));
    error.status = response.status;
    error.part = 'image';
    error.response = data;
    throw error;
  }

  return { ok: true, part: 'image', status: response.status, data };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const body = parseBody(req);
  const baseUrl = normalizeBaseUrl(body.baseUrl || body.url || body.evolutionUrl || process.env.EVOLUTION_BASE_URL || process.env.EVOLUTION_URL);
  const instance = String(body.instance || body.instanceName || '').trim();
  const phone = normalizePhone(body.phone || body.whatsapp || body.number);
  const message1 = String(body.message1 || body.text1 || body.mensagem || '').trim();
  const message2 = String(body.message2 || body.text2 || body.mensagem2 || '').trim();
  const imageBase64 = body.imageBase64 || body.image || '';
  const mimetype = body.mimetype || 'image/jpeg';
  const keys = getApiKeys(body.apiKey || body.apikey || body.key);

  if (!baseUrl) return res.status(400).json({ ok: false, error: 'baseUrl ausente.' });
  if (!instance) return res.status(400).json({ ok: false, error: 'instance ausente.' });
  if (!phone || phone.length < 12) return res.status(400).json({ ok: false, error: 'telefone inválido.', phone });
  if (!message1 && !message2 && !imageBase64) return res.status(400).json({ ok: false, error: 'mensagem/imagem ausente.' });
  if (!keys.length) return res.status(400).json({ ok: false, error: 'apiKey ausente.' });

  const attempts = [];

  for (const key of keys) {
    try {
      const results = [];
      if (message1) results.push(await sendText({ baseUrl, instance, key, phone, text: message1, part: 'part-1' }));
      if (message2) results.push(await sendText({ baseUrl, instance, key, phone, text: message2, part: 'part-2' }));
      if (imageBase64) results.push(await sendMedia({ baseUrl, instance, key, phone, imageBase64, mimetype }));

      return res.status(200).json({
        ok: true,
        mode: 'direct-test-send',
        baseUrl,
        instance,
        phone,
        sent: results
      });
    } catch (error) {
      attempts.push({
        keyTail: String(key).slice(-4),
        part: error.part || '',
        status: error.status || 0,
        message: error.message,
        response: error.response || null
      });
    }
  }

  return res.status(502).json({
    ok: false,
    error: attempts[attempts.length - 1]?.message || 'Falha ao enviar Lead Teste.',
    attempts,
    baseUrl,
    instance,
    phone
  });
};
