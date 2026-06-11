/**
 * POST /api/prospeccao/validar-numero
 * Body: { numbers: ["5511999999999"], chipUrl: "...", instance: "...", apikey: "..." }
 * Retorna: [{ number, exists, jid }]
 *
 * O frontend chama diretamente a Evolution API, mas essa rota existe como proxy
 * para evitar expor a apikey no client e contornar CORS caso necessário.
 */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const { numbers, chipUrl, instance, apikey } = req.body || {};

  if (!numbers || !Array.isArray(numbers) || !numbers.length)
    return res.status(400).json({ error: 'numbers é obrigatório e deve ser um array' });
  if (!chipUrl || !instance || !apikey)
    return res.status(400).json({ error: 'chipUrl, instance e apikey são obrigatórios' });

  try {
    const url = `${chipUrl.replace(/\/$/, '')}/chat/whatsappNumbers/${instance}`;
    const evoRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey },
      body: JSON.stringify({ numbers }),
    });

    if (!evoRes.ok) {
      const errText = await evoRes.text();
      return res.status(502).json({ error: `Evolution API erro ${evoRes.status}: ${errText}` });
    }

    const data = await evoRes.json();
    return res.status(200).json(data);
  } catch (err) {
    console.error('validar-numero error:', err);
    return res.status(500).json({ error: 'Erro ao conectar com a Evolution API' });
  }
}
