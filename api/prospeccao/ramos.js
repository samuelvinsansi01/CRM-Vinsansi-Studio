/**
 * Ramos de prospecção
 *
 * GET    /api/prospeccao/ramos         → lista todos os ramos
 * POST   /api/prospeccao/ramos         → cria novo ramo
 * PATCH  /api/prospeccao/ramos         → atualiza ramo (nome e/ou keywords)
 * DELETE /api/prospeccao/ramos?id=xxx  → remove ramo
 *
 * Chave Redis:  prospeccao:ramos  → array de objetos ramo
 *
 * Campos de um ramo:
 *   id        – slug + timestamp
 *   nome      – ex: "Contabilidade"
 *   keywords  – array de strings para matching no JSON da Apify
 *   criadoEm – ISO string
 */

const REDIS_URL   = process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN;

/* ── Ramos padrão (espelha os RAMOS_DEFAULT do frontend) ─────────────────
   Inseridos automaticamente se o Redis ainda estiver vazio.           */
const RAMOS_DEFAULT = [
  {
    id: 'contabilidade',
    nome: 'Contabilidade',
    keywords: [
      'contabilidade','contabil','contador','contadores','escritorio contabil',
      'assessoria contabil','consultoria contabil','auditoria','fiscal',
      'tributario','tributaria','contabilista','contabilistas','accounting','bookkeeping','tax',
    ],
  },
  {
    id: 'marcenaria',
    nome: 'Marcenaria / Móveis',
    keywords: [
      'marcenaria','marceneiro','moveis planejados','móveis planejados','movelaria',
      'móveis sob medida','moveis sob medida','carpintaria','armarios planejados',
      'armários planejados','cozinhas planejadas','dormitórios planejados',
      'dormitorios planejados','móveis','moveis',
    ],
  },
];

/* ── Redis helpers ──────────────────────────────────────────────────────── */
async function redisGet(key) {
  try {
    const res = await fetch(`${REDIS_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    let v = data.result;
    while (typeof v === 'string') { try { v = JSON.parse(v); } catch { break; } }
    if (v && typeof v === 'object' && v.value !== undefined) {
      v = v.value;
      while (typeof v === 'string') { try { v = JSON.parse(v); } catch { break; } }
    }
    return v;
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

/* ── Slug helper ────────────────────────────────────────────────────────── */
function genId(nome) {
  const slug = nome
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-')
    .replace(/^-|-$/g, '').slice(0, 30);
  return `${slug}-${Date.now()}`;
}

/* ── Handler ────────────────────────────────────────────────────────────── */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  /* ── GET ── */
  if (req.method === 'GET') {
    let ramos = await redisGet('prospeccao:ramos');

    // Se nunca foi inicializado, semeia os padrões
    if (!ramos) {
      ramos = RAMOS_DEFAULT.map(r => ({ ...r, criadoEm: new Date().toISOString() }));
      await redisSet('prospeccao:ramos', ramos);
    }

    return res.status(200).json(ramos);
  }

  /* ── POST: criar ramo ── */
  if (req.method === 'POST') {
    const { nome, keywords } = req.body || {};
    if (!nome) return res.status(400).json({ error: 'nome é obrigatório' });

    const ramos = (await redisGet('prospeccao:ramos')) || RAMOS_DEFAULT;

    // Deduplica por nome (case-insensitive)
    if (ramos.some(r => r.nome.toLowerCase() === nome.toLowerCase()))
      return res.status(409).json({ error: `Ramo "${nome}" já existe` });

    // Normaliza keywords: aceita array ou string separada por vírgula
    let kws = [];
    if (Array.isArray(keywords)) {
      kws = keywords.map(k => k.trim().toLowerCase()).filter(Boolean);
    } else if (typeof keywords === 'string') {
      kws = keywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
    }
    // Sempre inclui o próprio nome normalizado como keyword
    const nomeNorm = nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    if (!kws.includes(nomeNorm)) kws.unshift(nomeNorm);

    const novoRamo = { id: genId(nome), nome, keywords: kws, criadoEm: new Date().toISOString() };
    ramos.push(novoRamo);
    await redisSet('prospeccao:ramos', ramos);

    return res.status(200).json({ ok: true, ramo: novoRamo });
  }

  /* ── PATCH: atualizar ramo ── */
  if (req.method === 'PATCH') {
    const { id, nome, keywords } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id é obrigatório' });

    const ramos = (await redisGet('prospeccao:ramos')) || [];
    const idx   = ramos.findIndex(r => r.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Ramo não encontrado' });

    if (nome) ramos[idx].nome = nome;
    if (keywords !== undefined) {
      if (Array.isArray(keywords)) {
        ramos[idx].keywords = keywords.map(k => k.trim().toLowerCase()).filter(Boolean);
      } else if (typeof keywords === 'string') {
        ramos[idx].keywords = keywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
      }
    }
    ramos[idx].updatedAt = new Date().toISOString();
    await redisSet('prospeccao:ramos', ramos);

    return res.status(200).json({ ok: true, ramo: ramos[idx] });
  }

  /* ── DELETE: remover ramo ── */
  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id é obrigatório' });

    const ramos = (await redisGet('prospeccao:ramos')) || [];
    const nova  = ramos.filter(r => r.id !== id);
    if (nova.length === ramos.length)
      return res.status(404).json({ error: 'Ramo não encontrado' });

    await redisSet('prospeccao:ramos', nova);
    return res.status(200).json({ ok: true, removed: 1 });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
