const REDIS_URL   = process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN;

async function redisGet(key) {
  const res = await fetch(`${REDIS_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
  });
  if (!res.ok) return null;
  const data = await res.json();

  let current = data.result;
  while (typeof current === 'string') {
    try { current = JSON.parse(current); }
    catch { break; }
  }
  if (current && typeof current === 'object' && current.value !== undefined) {
    current = current.value;
    while (typeof current === 'string') {
      try { current = JSON.parse(current); }
      catch { break; }
    }
  }
  return current;
}

async function redisSet(key, value) {
  const res = await fetch(`${REDIS_URL}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${REDIS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ value }),  // sem JSON.stringify(value)
  });
  if (!res.ok) throw new Error(`Redis SET failed: ${await res.text()}`);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });

  const { alias, deskUrl, mobUrl } = req.body;
  if (!alias)
    return res.status(400).json({ error: 'alias é obrigatório' });
  if (!deskUrl && !mobUrl)
    return res.status(400).json({ error: 'Informe ao menos um link para atualizar' });

  try {
    const current = await redisGet(`redirect:${alias}`);
    if (!current)
      return res.status(404).json({ error: `Alias "${alias}" não encontrado no banco` });

    const updated = {
      ...current,
      deskUrl:   deskUrl   || current.deskUrl,
      mobUrl:    mobUrl    || current.mobUrl,
      updatedAt: new Date().toISOString(),
    };

    await redisSet(`redirect:${alias}`, updated);

    return res.status(200).json({
      ok: true,
      alias,
      deskUrl: updated.deskUrl,
      mobUrl:  updated.mobUrl,
    });
  } catch (err) {
    console.error('update error:', err);
    return res.status(500).json({ error: 'Erro ao atualizar no banco' });
  }
}
