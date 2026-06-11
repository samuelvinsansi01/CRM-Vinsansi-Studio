/**
 * Gerenciamento de chips (instâncias Evolution API)
 *
 * GET    /api/prospeccao/chips                      → lista todos os chips salvos no Redis
 * GET    /api/prospeccao/chips?id=xxx               → retorna um chip específico
 * GET    /api/prospeccao/chips?id=xxx&action=qr     → busca QR Code da instância
 * GET    /api/prospeccao/chips?id=xxx&action=status → busca status de conexão
 * POST   /api/prospeccao/chips                      → cria/salva novo chip e cria instância na Evo
 * DELETE /api/prospeccao/chips?id=xxx               → remove chip do Redis (e deleta instância na Evo)
 * PATCH  /api/prospeccao/chips                      → atualiza dados de um chip
 *
 * Chave Redis:  prospeccao:chips  → array de objetos chip
 *
 * Campos de um chip:
 *   id          – gerado no POST (slug do nome + timestamp)
 *   nome        – nome amigável (ex: "Chip 1 — Samsung")
 *   url         – URL base da Evolution API (ex: https://minha-evo.com)
 *   instance    – nome da instância na Evolution API
 *   key         – apiKey da instância
 *   criadoEm   – ISO string
 */

const REDIS_URL   = process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN;

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

/* ── Evolution API helpers ──────────────────────────────────────────────── */

/**
 * Cria a instância na Evolution API se ainda não existir.
 * Retorna { ok, data, error }.
 */
async function evoCreateInstance(chip) {
  try {
    const url = `${chip.url.replace(/\/$/, '')}/instance/create`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': chip.key,
      },
      body: JSON.stringify({
        instanceName: chip.instance,
        qrcode: true,
        integration: 'WHATSAPP-BAILEYS',
      }),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data?.message || `HTTP ${res.status}`, data };
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Busca o QR Code de uma instância.
 */
async function evoGetQR(chip) {
  try {
    const url = `${chip.url.replace(/\/$/, '')}/instance/connect/${chip.instance}`;
    const res = await fetch(url, {
      headers: { 'apikey': chip.key },
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data?.message || `HTTP ${res.status}` };
    // Upstash Evolution retorna { base64, code } ou { qrcode: { base64, code } }
    const qr = data?.base64 || data?.qrcode?.base64 || null;
    return { ok: true, qr, raw: data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Busca o status de conexão de uma instância.
 */
async function evoGetStatus(chip) {
  try {
    const url = `${chip.url.replace(/\/$/, '')}/instance/connectionState/${chip.instance}`;
    const res = await fetch(url, {
      headers: { 'apikey': chip.key },
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data?.message || `HTTP ${res.status}` };
    // Evolution retorna { instance: { state: 'open'|'close'|'connecting' } }
    const state = data?.instance?.state || data?.state || 'unknown';
    return { ok: true, state, raw: data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Deleta a instância na Evolution API.
 */
async function evoDeleteInstance(chip) {
  try {
    const url = `${chip.url.replace(/\/$/, '')}/instance/delete/${chip.instance}`;
    const res = await fetch(url, {
      method: 'DELETE',
      headers: { 'apikey': chip.key },
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/* ── Slug helper ────────────────────────────────────────────────────────── */
function genId(nome) {
  const slug = nome
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').slice(0, 20);
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
    const { id, action } = req.query;
    const chips = (await redisGet('prospeccao:chips')) || [];

    // Listar todos
    if (!id) {
      // Remove a key da resposta por segurança
      const safe = chips.map(({ key: _k, ...rest }) => rest);
      return res.status(200).json(safe);
    }

    const chip = chips.find(c => c.id === id);
    if (!chip) return res.status(404).json({ error: 'Chip não encontrado' });

    // QR Code
    if (action === 'qr') {
      const result = await evoGetQR(chip);
      if (!result.ok) return res.status(502).json({ error: result.error });
      return res.status(200).json({ qr: result.qr });
    }

    // Status de conexão
    if (action === 'status') {
      const result = await evoGetStatus(chip);
      if (!result.ok) return res.status(502).json({ error: result.error });
      return res.status(200).json({ state: result.state });
    }

    // Chip específico (sem key)
    const { key: _k, ...safe } = chip;
    return res.status(200).json(safe);
  }

  /* ── POST: criar novo chip ── */
  if (req.method === 'POST') {
    const { nome, url, instance, key: apiKey, criarInstancia = true } = req.body || {};
    if (!nome || !url || !instance || !apiKey)
      return res.status(400).json({ error: 'nome, url, instance e key são obrigatórios' });

    const chips = (await redisGet('prospeccao:chips')) || [];

    // Checa duplicata de instance
    if (chips.some(c => c.instance === instance && c.url === url))
      return res.status(409).json({ error: `Instância "${instance}" já existe nesta URL` });

    const novoChip = {
      id:        genId(nome),
      nome,
      url:       url.replace(/\/$/, ''),
      instance,
      key:       apiKey,
      criadoEm: new Date().toISOString(),
    };

    // Tenta criar instância na Evolution API (não bloqueia se falhar)
    let evoResult = { ok: true };
    if (criarInstancia) {
      evoResult = await evoCreateInstance(novoChip);
    }

    chips.push(novoChip);
    await redisSet('prospeccao:chips', chips);

    const { key: _k, ...safeChip } = novoChip;
    return res.status(200).json({
      ok: true,
      chip: safeChip,
      evo: evoResult.ok ? 'instância criada' : `aviso: ${evoResult.error}`,
    });
  }

  /* ── PATCH: atualizar chip ── */
  if (req.method === 'PATCH') {
    const { id, updates } = req.body || {};
    if (!id || !updates) return res.status(400).json({ error: 'id e updates são obrigatórios' });

    const chips = (await redisGet('prospeccao:chips')) || [];
    const idx = chips.findIndex(c => c.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Chip não encontrado' });

    // Não deixa sobrescrever o id
    const { id: _id, ...allowed } = updates;
    chips[idx] = { ...chips[idx], ...allowed, updatedAt: new Date().toISOString() };
    await redisSet('prospeccao:chips', chips);

    const { key: _k, ...safeChip } = chips[idx];
    return res.status(200).json({ ok: true, chip: safeChip });
  }

  /* ── DELETE: remover chip ── */
  if (req.method === 'DELETE') {
    const { id, deleteEvo = 'true' } = req.query;
    if (!id) return res.status(400).json({ error: 'id é obrigatório' });

    const chips = (await redisGet('prospeccao:chips')) || [];
    const chip  = chips.find(c => c.id === id);
    if (!chip) return res.status(404).json({ error: 'Chip não encontrado' });

    // Tenta deletar na Evolution API
    let evoMsg = 'não tentado';
    if (deleteEvo === 'true') {
      const result = await evoDeleteInstance(chip);
      evoMsg = result.ok ? 'instância deletada na Evo' : `aviso: ${result.error}`;
    }

    const nova = chips.filter(c => c.id !== id);
    await redisSet('prospeccao:chips', nova);

    return res.status(200).json({ ok: true, evo: evoMsg });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
