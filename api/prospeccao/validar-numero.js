/**
 * POST /api/prospeccao/validar-numero
 * Body: { numbers: ["5547999999999"], chipUrl, instance, apikey }
 *
 * Proxy leve para validar numeros na Evolution sem depender de CORS no navegador.
 */

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

function normalizeNumbers(numbers = []) {
  return numbers
    .map((number) => String(number || '').replace(/\D/g, ''))
    .filter((number) => number.length >= 10)
    .map((number) => {
      if (number.startsWith('55')) return number;
      if (number.length === 10 || number.length === 11) return `55${number}`;
      return number;
    });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = parseBody(req);
    const numbers = normalizeNumbers(Array.isArray(body.numbers) ? body.numbers : []);
    const chipUrl = normalizeBaseUrl(body.chipUrl || body.url || body.baseUrl);
    const instance = String(body.instance || '').trim();
    const apikey = String(body.apikey || body.apiKey || body.key || '').trim();

    if (!numbers.length) return res.status(400).json({ error: 'numbers obrigatorio' });
    if (!chipUrl || !instance || !apikey) {
      return res.status(400).json({ error: 'chipUrl, instance e apikey sao obrigatorios' });
    }

    const evoRes = await fetch(`${chipUrl}/chat/whatsappNumbers/${encodeURIComponent(instance)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey },
      body: JSON.stringify({ numbers })
    });

    const raw = await evoRes.text();
    let data = raw;
    try { data = raw ? JSON.parse(raw) : {}; } catch {}

    if (!evoRes.ok) {
      return res.status(502).json({
        error: `Evolution API erro ${evoRes.status}`,
        details: data
      });
    }

    return res.status(200).json(data);
  } catch (error) {
    console.error('[validar-numero]', error);
    return res.status(500).json({ error: error?.message || 'Erro ao conectar com a Evolution API' });
  }
}
