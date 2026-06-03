/**
 * Fila semanal WhatsApp por chip e dia
 *
 * GET    /api/prospeccao/fila?chip=chip1&dia=19/05/2025   → lista fila do dia/chip
 * GET    /api/prospeccao/fila?chip=chip1                  → lista todos os dias da semana para o chip
 * POST   /api/prospeccao/fila                             → adiciona empresa(s) à fila
 * PATCH  /api/prospeccao/fila                             → atualiza status de empresa na fila
 * DELETE /api/prospeccao/fila?chip=chip1&dia=19/05/2025&id=xxx → remove empresa da fila
 *
 * Chave Redis:  prospeccao:fila:{chip}:{dia}   → array de empresas
 *
 * Regras:
 *  - Máximo 60 por chip por dia
 *  - Excedente vai automaticamente para o próximo dia útil (seg-sáb)
 *  - Dias: seg=1 ... sáb=6  (domingo=0 é pulado)
 */

const REDIS_URL   = process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN;
const LIMITE_DIA  = 60;

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

/* ── Date helpers ───────────────────────────────────────────────────────── */
/**
 * Retorna os próximos N dias úteis (seg–sáb) a partir de uma data base (inclusive).
 * dateStr formato: "DD/MM/YYYY"
 */
function proximosDiasUteis(dateStr, quantidade = 7) {
  const [d, m, y] = dateStr.split('/').map(Number);
  const base = new Date(y, m - 1, d);
  const dias = [];
  let cursor = new Date(base);
  while (dias.length < quantidade) {
    const dow = cursor.getDay();
    if (dow !== 0) { // pula domingo
      dias.push(cursor.toLocaleDateString('pt-BR'));
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return dias;
}

function filaKey(chip, dia) {
  return `prospeccao:fila:${chip}:${dia}`;
}

/* ── Handler ────────────────────────────────────────────────────────────── */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  /* ── GET ── */
  if (req.method === 'GET') {
    const { chip, dia } = req.query;
    if (!chip) return res.status(400).json({ error: 'chip é obrigatório' });

    // Retorna um dia específico
    if (dia) {
      const fila = (await redisGet(filaKey(chip, dia))) || [];
      return res.status(200).json({ chip, dia, fila, total: fila.length });
    }

    // Retorna semana inteira do chip
    const hoje = new Date().toLocaleDateString('pt-BR');
    const dias = proximosDiasUteis(hoje, 7);
    const result = await Promise.all(
      dias.map(async d => {
        const fila = (await redisGet(filaKey(chip, d))) || [];
        return { dia: d, fila, total: fila.length, restantes: Math.max(0, LIMITE_DIA - fila.length) };
      })
    );
    return res.status(200).json({ chip, semana: result });
  }

  /* ── POST: adicionar empresa(s) à fila ── */
  if (req.method === 'POST') {
    const { chip, dia, empresas } = req.body || {};
    if (!chip) return res.status(400).json({ error: 'chip é obrigatório' });
    if (!empresas || !Array.isArray(empresas) || !empresas.length)
      return res.status(400).json({ error: 'empresas deve ser array não vazio' });

    const hoje = new Date().toLocaleDateString('pt-BR');
    const diaInicial = dia || hoje;
    const diasUteis = proximosDiasUteis(diaInicial, 14); // até 2 semanas à frente

    let adicionadas = 0;
    const overflow = [];

    for (const emp of empresas) {
      let inserida = false;
      for (const d of diasUteis) {
        const key  = filaKey(chip, d);
        const fila = (await redisGet(key)) || [];
        if (fila.length < LIMITE_DIA) {
          fila.push({ ...emp, diaFila: d, chipFila: chip, statusFila: 'aguardando' });
          await redisSet(key, fila);
          adicionadas++;
          inserida = true;
          break;
        }
      }
      if (!inserida) overflow.push(emp);
    }

    return res.status(200).json({ ok: true, adicionadas, overflow: overflow.length, overflowEmpresas: overflow });
  }

  /* ── PATCH: atualizar status de empresa na fila ── */
  if (req.method === 'PATCH') {
    const { chip, dia, id, updates } = req.body || {};
    if (!chip || !dia || !id || !updates)
      return res.status(400).json({ error: 'chip, dia, id e updates são obrigatórios' });

    const key  = filaKey(chip, dia);
    const fila = (await redisGet(key)) || [];
    const idx  = fila.findIndex(e => e.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Empresa não encontrada na fila' });

    fila[idx] = { ...fila[idx], ...updates };
    await redisSet(key, fila);
    return res.status(200).json({ ok: true, empresa: fila[idx] });
  }

  /* ── DELETE: remover empresa da fila ── */
  if (req.method === 'DELETE') {
    const { chip, dia, id } = req.query;
    if (!chip || !dia || !id)
      return res.status(400).json({ error: 'chip, dia e id são obrigatórios' });

    const key  = filaKey(chip, dia);
    const fila = (await redisGet(key)) || [];
    const nova = fila.filter(e => e.id !== id);
    await redisSet(key, nova);
    return res.status(200).json({ ok: true, removed: fila.length - nova.length });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
