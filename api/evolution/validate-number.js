/**
 * POST /api/evolution/validate-number
 * Proxy serverless para validar WhatsApp na Evolution sem CORS no navegador.
 * Body: { numbers: ["5511999999999"], chipUrl, instance, apikey }
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { numbers, chipUrl, instance, apikey } = req.body || {};
  const cleanNumbers = Array.isArray(numbers) ? numbers.map(n => String(n || '').replace(/\D/g, '')).filter(Boolean) : [];
  const baseUrl = String(chipUrl || process.env.EVOLUTION_API_URL || '').replace(/\/$/, '');
  const evoKey = String(apikey || process.env.EVOLUTION_API_KEY || '');
  const evoInstance = String(instance || '');

  if (!cleanNumbers.length) return res.status(400).json({ error: 'numbers é obrigatório e deve ser um array' });
  if (!baseUrl || !evoInstance || !evoKey) return res.status(400).json({ error: 'chipUrl, instance e apikey são obrigatórios' });

  try {
    const evoRes = await fetch(`${baseUrl}/chat/whatsappNumbers/${encodeURIComponent(evoInstance)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: evoKey },
      body: JSON.stringify({ numbers: cleanNumbers }),
    });

    const text = await evoRes.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch (_) { data = { raw: text }; }

    if (!evoRes.ok) {
      return res.status(502).json({ error: `Evolution API erro ${evoRes.status}`, details: data });
    }

    return res.status(200).json(data);
  } catch (err) {
    console.error('[api/evolution/validate-number]', err);
    return res.status(500).json({ error: 'Erro ao conectar com a Evolution API', details: String(err?.message || err) });
  }
}
