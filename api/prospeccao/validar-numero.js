/**
 * POST /api/prospeccao/validar-numero
 * Body: { numbers: ["5511999999999"], chipUrl: "...", instance: "...", apikey: "..." }
 * Retorna: [{ number, exists, jid }]
 *
 * Proxy serverless: o frontend chama a Vercel, e a Vercel chama a Evolution.
 * Evita CORS, evita expor a apikey e controla timeout para não virar 524.
 */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const { numbers, chipUrl, instance, apikey, timeoutMs } = req.body || {};

  if (!numbers || !Array.isArray(numbers) || !numbers.length)
    return res.status(400).json({ error: 'numbers é obrigatório e deve ser um array' });
  if (!chipUrl || !instance || !apikey)
    return res.status(400).json({ error: 'chipUrl, instance e apikey são obrigatórios' });

  try {
    const url = `${chipUrl.replace(/\/$/, '')}/chat/whatsappNumbers/${instance}`;
    const controller = new AbortController();
    const timeout = Math.max(5000, Math.min(25000, Number(timeoutMs || 22000)));
    const timer = setTimeout(() => controller.abort(), timeout);
    const evoRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey },
      body: JSON.stringify({ numbers }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));

    if (!evoRes.ok) {
      const errText = await evoRes.text();
      return res.status(502).json({ error: `Evolution API erro ${evoRes.status}: ${errText}` });
    }

    const data = await evoRes.json();
    return res.status(200).json(data);
  } catch (err) {
    console.error('validar-numero error:', err);
    if (err?.name === 'AbortError') {
      return res.status(504).json({ error: 'Timeout temporário ao validar na Evolution. Tente novamente.', transient: true });
    }
    return res.status(500).json({ error: 'Erro ao conectar com a Evolution API', transient: true });
  }
}
