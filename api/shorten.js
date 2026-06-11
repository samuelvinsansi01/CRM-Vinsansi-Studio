const REDIS_URL   = process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN;

async function redisSet(key, value) {
  const res = await fetch(`${REDIS_URL}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${REDIS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ value }),
  });
  if (!res.ok) throw new Error(`Redis SET failed: ${await res.text()}`);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { deskUrl, mobUrl, companyName } = req.body;

  if (!deskUrl || !mobUrl)
    return res.status(400).json({ error: 'deskUrl e mobUrl são obrigatórios' });
  if (!companyName)
    return res.status(400).json({ error: 'Nome da empresa é obrigatório' });

  function isFigmaUrl(url) {
    try { return new URL(url).hostname.includes('figma.com'); } catch { return false; }
  }
  if (!isFigmaUrl(deskUrl) || !isFigmaUrl(mobUrl))
    return res.status(400).json({ error: 'Os links precisam ser URLs do Figma' });

  const alias = companyName
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-')
    .slice(0, 50) + '-vin';

  const baseUrl = process.env.BASE_URL || 'https://redirect-self-delta.vercel.app';
  const longUrl = `${baseUrl}/api/redirect?alias=${encodeURIComponent(alias)}`;
  const token   = process.env.TINYURL_TOKEN;

  try {
    const tinyRes = await fetch('https://api.tinyurl.com/create', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url: longUrl, alias, domain: 'tinyurl.com' }),
    });

    const tinyData = await tinyRes.json();

    if (!tinyRes.ok) {
      const errMsg = tinyData.errors?.[0] || '';
      if (errMsg.toLowerCase().includes('alias') ||
          errMsg.toLowerCase().includes('taken') ||
          errMsg.toLowerCase().includes('exist')) {
        return res.status(409).json({
          error: `O link "tinyurl.com/${alias}" já existe. Tente um nome diferente.`,
        });
      }
      return res.status(400).json({ error: errMsg || 'Erro ao criar link TinyURL' });
    }

    await redisSet(`redirect:${alias}`, {
      alias,
      deskUrl,
      mobUrl,
      companyName,
      createdAt: new Date().toISOString(),
    });

    return res.status(200).json({
      shortUrl: tinyData.data.tiny_url,
      alias,
    });
  } catch (err) {
    console.error('shorten error:', err);
    return res.status(500).json({ error: 'Erro interno ao criar o link' });
  }
}
