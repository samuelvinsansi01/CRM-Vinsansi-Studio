/**
 * POST /api/prospeccao/validar-numero
 * Body: { numbers: ["5547999999999"], chipUrl, instance, apikey }
 *
 * Proxy para validar números na Evolution sem depender de CORS no navegador.
 * 6.85:
 * - valida estado da instância antes de consultar número
 * - tenta chaves por instância e variáveis de ambiente
 * - retorna erro claro quando chip não está conectado
 * - evita loop de 502 sem diagnóstico
 */

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body;
}

function normalizeBaseUrl(value = '') {
  return String(value || '').trim().replace(/\/+$/, '');
}

function normalizeNumbers(numbers = []) {
  return numbers
    .map((number) => String(number || '').replace(/\D/g, ''))
    .filter((number) => number.length >= 10)
    .map((number) => {
      if (number.startsWith('55')) return number;
      if (number.length === 10 || number.length === 11) return `55${number}`;
      return number;
    });
}

function uniq(values = []) {
  return [...new Set(values.map((v) => String(v || '').trim()).filter(Boolean))];
}

function getApiKeys(inputKey = '') {
  return uniq([
    inputKey,
    process.env.EVOLUTION_API_KEY,
    process.env.EVOLUTION_APIKEY,
    process.env.EVOLUTION_GLOBAL_API_KEY,
    process.env.EVOLUTION_AUTHENTICATION_API_KEY,
    process.env.EVOLUTION_AUTH_KEY
  ]);
}

function headersFor(key) {
  return {
    'Content-Type': 'application/json',
    apikey: key,
    Authorization: `Bearer ${key}`
  };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 18000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const raw = await response.text();
    let data = raw;
    try { data = raw ? JSON.parse(raw) : {}; } catch {}
    return { response, data, raw };
  } finally {
    clearTimeout(timer);
  }
}

function extractConnectionState(payload) {
  const candidates = [
    payload?.instance?.state,
    payload?.instance?.connectionStatus,
    payload?.instance?.connectionState,
    payload?.state,
    payload?.status,
    payload?.connectionStatus,
    payload?.connectionState,
    payload?.data?.instance?.state,
    payload?.data?.state,
    payload?.data?.status,
    payload?.data?.connectionStatus,
    payload?.data?.connectionState
  ].filter((value) => value != null);
  return String(candidates[0] || '').trim().toLowerCase();
}

function isOpenState(state = '') {
  return ['open', 'connected', 'conectado'].includes(String(state || '').toLowerCase());
}

async function checkConnection(chipUrl, instance, apiKeys) {
  const attempts = [];

  for (const key of apiKeys) {
    const url = `${chipUrl}/instance/connectionState/${encodeURIComponent(instance)}`;
    try {
      const { response, data } = await fetchWithTimeout(url, {
        method: 'GET',
        headers: headersFor(key)
      }, 12000);

      const state = extractConnectionState(data);
      attempts.push({ endpoint: 'connectionState', status: response.status, state, data });

      if (response.ok && state) {
        return { ok: isOpenState(state), state, data, key };
      }

      if (response.ok && !state) {
        return { ok: true, state: 'unknown', data, key };
      }
    } catch (error) {
      attempts.push({ endpoint: 'connectionState', error: error?.message || String(error) });
    }
  }

  return { ok: true, state: 'unchecked', attempts };
}

async function validateNumbers(chipUrl, instance, numbers, apiKeys) {
  const endpoints = [
    {
      name: 'chat/whatsappNumbers',
      url: `${chipUrl}/chat/whatsappNumbers/${encodeURIComponent(instance)}`,
      body: { numbers }
    }
  ];

  const attempts = [];

  for (const endpoint of endpoints) {
    for (const key of apiKeys) {
      try {
        const { response, data, raw } = await fetchWithTimeout(endpoint.url, {
          method: 'POST',
          headers: headersFor(key),
          body: JSON.stringify(endpoint.body)
        });

        attempts.push({
          endpoint: endpoint.name,
          status: response.status,
          data
        });

        if (response.ok) {
          return { ok: true, data, key, endpoint: endpoint.name };
        }

        // Se a Evolution respondeu com erro de instância, não adianta repetir em todos os leads.
        const text = typeof data === 'string' ? data : JSON.stringify(data || {});
        if (/not\s*found|nao\s*encontr|não\s*encontr|disconnect|closed|connecting|timeout|bad gateway/i.test(text)) {
          return { ok: false, status: response.status, data, raw, attempts, terminal: true };
        }
      } catch (error) {
        attempts.push({
          endpoint: endpoint.name,
          error: error?.message || String(error)
        });
      }
    }
  }

  return { ok: false, attempts };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = parseBody(req);
    const numbers = normalizeNumbers(Array.isArray(body.numbers) ? body.numbers : []);
    const chipUrl = normalizeBaseUrl(body.chipUrl || body.url || body.baseUrl);
    const instance = String(body.instance || body.instanceName || '').trim();
    const apiKeys = getApiKeys(body.apikey || body.apiKey || body.key || '');

    if (!numbers.length) return res.status(400).json({ error: 'numbers obrigatorio' });
    if (!chipUrl || !instance || !apiKeys.length) {
      return res.status(400).json({ error: 'chipUrl, instance e apikey sao obrigatorios' });
    }

    const connection = await checkConnection(chipUrl, instance, apiKeys);

    if (connection.ok === false) {
      return res.status(409).json({
        error: 'INSTANCE_NOT_CONNECTED',
        message: `Chip ${instance} nao esta conectado na Evolution`,
        instance,
        state: connection.state || 'unknown',
        details: connection.data || connection.attempts || null
      });
    }

    const validation = await validateNumbers(chipUrl, instance, numbers, apiKeys);

    if (validation.ok) {
      return res.status(200).json(validation.data);
    }

    return res.status(502).json({
      error: 'EVOLUTION_VALIDATION_FAILED',
      message: `Falha ao consultar Evolution para ${instance}`,
      instance,
      details: validation.data || validation.attempts || null
    });
  } catch (error) {
    console.error('[validar-numero]', error);
    return res.status(500).json({
      error: 'VALIDATION_PROXY_ERROR',
      message: error?.message || 'Erro ao conectar com a Evolution API'
    });
  }
}
