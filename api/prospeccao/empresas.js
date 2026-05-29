/**
 * GET  /api/prospeccao/empresas?tipo=validacao|sem-site|base&semana=DD/MM/YYYY
 * POST /api/prospeccao/empresas          → salva empresa(s) (deduplicação automática)
 * DELETE /api/prospeccao/empresas?id=xxx → remove empresa da validação
 * PATCH /api/prospeccao/empresas         → atualiza campo de empresa (ex: numStatus, instagram)
 *
 * Chaves Redis:
 *   prospeccao:validacao        → array de empresas aguardando validação
 *   prospeccao:sem-site         → array de empresas sem site (fila Instagram)
 *   prospeccao:base:phones      → set de telefones já inseridos (deduplicação)
 *   prospeccao:base:sites       → set de domínios já inseridos (deduplicação)
 */

const REDIS_URL   = process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN;

async function redisGet(key) {
  try {
    const res = await fetch(`${REDIS_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    let current = data.result;
    while (typeof current === 'string') {
      try { current = JSON.parse(current); } catch { break; }
    }
    if (current && typeof current === 'object' && current.value !== undefined) {
      current = current.value;
      while (typeof current === 'string') {
        try { current = JSON.parse(current); } catch { break; }
      }
    }
    return current;
  } catch { return null; }
}

async function redisSet(key, value) {
  const res = await fetch(`${REDIS_URL}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  });
  if (!res.ok) throw new Error(`Redis SET failed: ${await res.text()}`);
}

function extractDomain(site) {
  try { return new URL(site.trim()).hostname.replace(/^www\./, '').toLowerCase(); } catch { return null; }
}

function normalizePhone(raw) {
  if (!raw) return '';
  return raw.replace(/\D/g, '');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── GET: buscar empresas ──────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { tipo } = req.query;
    if (!tipo) return res.status(400).json({ error: 'tipo é obrigatório' });

    if (tipo === 'validacao') {
      const data = (await redisGet('prospeccao:validacao')) || [];
      return res.status(200).json(data);
    }
    if (tipo === 'sem-site') {
      const data = (await redisGet('prospeccao:sem-site')) || [];
      return res.status(200).json(data);
    }
    if (tipo === 'base-phones') {
      const data = (await redisGet('prospeccao:base:phones')) || [];
      return res.status(200).json(data);
    }
    if (tipo === 'base-sites') {
      const data = (await redisGet('prospeccao:base:sites')) || [];
      return res.status(200).json(data);
    }
    return res.status(400).json({ error: 'tipo inválido' });
  }

  // ── POST: salvar empresa(s) com deduplicação ──────────────────────────────
  if (req.method === 'POST') {
    const { empresas } = req.body || {};
    if (!empresas || !Array.isArray(empresas) || !empresas.length)
      return res.status(400).json({ error: 'empresas deve ser um array não vazio' });

    // carrega listas de deduplicação
    const [valFila, semSiteFila, basePhones, baseSites] = await Promise.all([
      redisGet('prospeccao:validacao').then(d => d || []),
      redisGet('prospeccao:sem-site').then(d => d || []),
      redisGet('prospeccao:base:phones').then(d => d || []),
      redisGet('prospeccao:base:sites').then(d => d || []),
    ]);

    const phonesSet = new Set([
      ...basePhones,
      ...valFila.map(e => normalizePhone(e.whatsapp || '')).filter(Boolean),
      ...semSiteFila.map(e => normalizePhone(e.whatsapp || '')).filter(Boolean),
    ]);
    const sitesSet = new Set([
      ...baseSites,
      ...valFila.map(e => extractDomain(e.site || '')).filter(Boolean),
      ...semSiteFila.map(e => extractDomain(e.site || '')).filter(Boolean),
    ]);

    let addedComSite = 0, addedSemSite = 0, duplicadas = 0;
    const novaValFila = [...valFila];
    const novaSemSite = [...semSiteFila];

    for (const emp of empresas) {
      const ph = normalizePhone(emp.whatsapp || '');
      const si = extractDomain(emp.site || '');

      // deduplicação
      if ((ph && phonesSet.has(ph)) || (si && sitesSet.has(si))) {
        duplicadas++;
        continue;
      }

      if (ph) phonesSet.add(ph);
      if (si) sitesSet.add(si);

      if (emp.tipo === 'com-site') {
        novaValFila.push(emp);
        addedComSite++;
      } else if (emp.tipo === 'sem-site') {
        novaSemSite.push(emp);
        addedSemSite++;
      }
    }

    // salva tudo em paralelo
    await Promise.all([
      redisSet('prospeccao:validacao', novaValFila),
      redisSet('prospeccao:sem-site', novaSemSite),
      redisSet('prospeccao:base:phones', [...phonesSet]),
      redisSet('prospeccao:base:sites', [...sitesSet]),
    ]);

    return res.status(200).json({ ok: true, addedComSite, addedSemSite, duplicadas });
  }

  // ── PATCH: atualizar campo de empresa ─────────────────────────────────────
  if (req.method === 'PATCH') {
    const { id, tipo, updates } = req.body || {};
    if (!id || !tipo || !updates) return res.status(400).json({ error: 'id, tipo e updates são obrigatórios' });

    const key = tipo === 'sem-site' ? 'prospeccao:sem-site' : 'prospeccao:validacao';
    const fila = (await redisGet(key)) || [];
    const idx = fila.findIndex(e => e.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Empresa não encontrada' });

    fila[idx] = { ...fila[idx], ...updates };
    await redisSet(key, fila);
    return res.status(200).json({ ok: true, empresa: fila[idx] });
  }

  // ── DELETE: remover empresa da validação ──────────────────────────────────
  if (req.method === 'DELETE') {
    const { id, tipo } = req.query;
    if (!id) return res.status(400).json({ error: 'id é obrigatório' });

    const key = tipo === 'sem-site' ? 'prospeccao:sem-site' : 'prospeccao:validacao';
    const fila = (await redisGet(key)) || [];
    const nova = fila.filter(e => e.id !== id);
    await redisSet(key, nova);
    return res.status(200).json({ ok: true, removed: fila.length - nova.length });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
