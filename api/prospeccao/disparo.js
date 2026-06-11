/**
 * Proxy de disparo WhatsApp via Evolution API
 *
 * POST /api/prospeccao/disparo
 *
 * Body:
 * {
 *   chipId:       string   – id do chip no Redis (busca credenciais)
 *   empresas: [
 *     {
 *       id:            string,
 *       nome:          string,
 *       whatsapp:      string,          – qualquer formato, normalizado aqui
 *       mensagem:      string,          – MSG 1: texto de apresentação
 *       linkSite:      string,          – MSG 2: link (opcional, usa env BASE_URL se omitido)
 *       imagemBase64:  string|null,     – MSG 3: base64 com data URI (ex: "data:image/jpeg;base64,...")
 *       imagemNome:    string|null,     – nome do arquivo (para log)
 *     }
 *   ],
 *   delayMinSeg:  number  – delay mínimo entre empresas (seg, default 15)
 *   delayMaxSeg:  number  – delay máximo entre empresas (seg, default 30)
 *   msgDelaySeg:  number  – delay entre as 3 mensagens da mesma empresa (seg, default 15)
 * }
 *
 * Retorna:
 * {
 *   ok:       boolean,
 *   results: [{ id, nome, status: 'enviado'|'erro', error?: string }]
 * }
 *
 * NOTA: O frontend já faz o disparo diretamente na Evolution API.
 * Esta rota existe como alternativa server-side para ocultar as credenciais
 * do client e permitir disparo via automação externa (ex: n8n, cron).
 */

const REDIS_URL   = process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN;
const LINK_PADRAO = process.env.BASE_URL || 'https://samuelvinsansi.com.br';

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

/* ── Helpers ────────────────────────────────────────────────────────────── */
function normalizePhone(raw) {
  const digits = (raw || '').replace(/\D/g, '');
  return digits.startsWith('55') ? digits : '55' + digits;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function randDelay(minSeg, maxSeg) {
  return Math.floor((minSeg + Math.random() * (maxSeg - minSeg)) * 1000);
}

/* ── Evolution API calls ────────────────────────────────────────────────── */
async function evoSendText(chip, numero, text) {
  const url  = `${chip.url}/message/sendText/${chip.instance}`;
  const body = { number: numero, options: { delay: 1000 }, textMessage: { text } };
  const res  = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: chip.key },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`sendText HTTP ${res.status}: ${err}`);
  }
  return res.json();
}

async function evoSendMedia(chip, numero, base64WithUri, imagemNome) {
  const url = `${chip.url}/message/sendMedia/${chip.instance}`;

  // Aceita "data:image/jpeg;base64,AAA..." ou base64 puro
  let base64data = base64WithUri;
  let mimeType   = 'image/jpeg';
  if (base64WithUri.startsWith('data:')) {
    const parts = base64WithUri.split(',');
    base64data  = parts[1] || '';
    mimeType    = (parts[0].split(';')[0].split(':')[1]) || 'image/jpeg';
  }

  const body = {
    number: numero,
    options: { delay: 1000 },
    mediaMessage: {
      mediatype: 'image',
      media:     base64data,
      mimetype:  mimeType,
      fileName:  imagemNome || 'imagem.jpg',
      caption:   '',
    },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: chip.key },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`sendMedia HTTP ${res.status}: ${err}`);
  }
  return res.json();
}

/* ── Handler ────────────────────────────────────────────────────────────── */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const {
    chipId,
    empresas,
    delayMinSeg = 15,
    delayMaxSeg = 30,
    msgDelaySeg = 15,
  } = req.body || {};

  if (!chipId)
    return res.status(400).json({ error: 'chipId é obrigatório' });
  if (!empresas || !Array.isArray(empresas) || !empresas.length)
    return res.status(400).json({ error: 'empresas deve ser um array não vazio' });

  // Busca credenciais do chip no Redis
  const chips = (await redisGet('prospeccao:chips')) || [];
  const chip  = chips.find(c => c.id === chipId);
  if (!chip)
    return res.status(404).json({ error: `Chip "${chipId}" não encontrado` });

  const results = [];
  const msgDelayMs = msgDelaySeg * 1000;

  for (let i = 0; i < empresas.length; i++) {
    const emp = empresas[i];
    const numero = normalizePhone(emp.whatsapp);

    if (numero.length < 12) {
      results.push({ id: emp.id, nome: emp.nome, status: 'erro', error: 'número inválido' });
      continue;
    }

    try {
      // MSG 1 — Apresentação
      await evoSendText(chip, numero, emp.mensagem);
      await sleep(msgDelayMs);

      // MSG 2 — Link do site
      const link = emp.linkSite || LINK_PADRAO;
      await evoSendText(chip, numero, link);
      await sleep(msgDelayMs);

      // MSG 3 — Imagem (opcional)
      if (emp.imagemBase64) {
        await evoSendMedia(chip, numero, emp.imagemBase64, emp.imagemNome);
      }

      results.push({ id: emp.id, nome: emp.nome, status: 'enviado' });
    } catch (err) {
      results.push({ id: emp.id, nome: emp.nome, status: 'erro', error: err.message });
    }

    // Delay entre empresas (exceto depois da última)
    if (i < empresas.length - 1) {
      await sleep(randDelay(delayMinSeg, delayMaxSeg));
    }
  }

  const enviados = results.filter(r => r.status === 'enviado').length;
  const erros    = results.filter(r => r.status === 'erro').length;

  return res.status(200).json({ ok: true, enviados, erros, results });
}
