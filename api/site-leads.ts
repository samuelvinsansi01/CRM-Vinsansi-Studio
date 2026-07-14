import { createClient } from '@supabase/supabase-js';

type ApiRequest = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
};

type ApiResponse = {
  status(code: number): ApiResponse;
  json(body: unknown): void;
  setHeader(name: string, value: string): void;
  end(): void;
};

declare const process: { env: Record<string, string | undefined> };

type JsonRecord = Record<string, unknown>;
type Action = 'approve' | 'invalidate';

class ServerlessOnlyRealtimeTransport {
  constructor() {
    throw new Error('Realtime nao e utilizado pela rota serverless da extensao de leads com site.');
  }
}

function envAny(...names: string[]) {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return '';
}

function supabase() {
  const url = envAny('SUPABASE_URL', 'VITE_SUPABASE_URL');
  const key = envAny('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('Supabase service role nao configurado para a extensao de leads com site.');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: ServerlessOnlyRealtimeTransport as never },
  });
}

function tableName() {
  return envAny('SUPABASE_TABLE_IMPORT_LEADS', 'VITE_SUPABASE_TABLE_IMPORT_LEADS') || 'leads';
}

function bodyRecord(body: unknown): JsonRecord {
  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as JsonRecord : {};
    } catch {
      return {};
    }
  }
  return body && typeof body === 'object' && !Array.isArray(body) ? body as JsonRecord : {};
}

function headerValue(req: ApiRequest, name: string) {
  const headers = req.headers ?? {};
  const value = headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
  return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '');
}

function assertExtensionSecret(req: ApiRequest) {
  const expected = envAny('SITE_LEADS_EXTENSION_SECRET', 'EXTENSION_SECRET');
  if (!expected) throw new Error('SITE_LEADS_EXTENSION_SECRET nao configurado no backend.');
  const received = headerValue(req, 'x-site-leads-extension-secret');
  if (!received || received !== expected) throw new Error('Secret da extensao de leads com site invalido.');
}

function text(value: unknown) {
  return String(value ?? '').trim();
}

function dataRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

const GENERIC_DOMAINS = new Set([
  'instagram.com', 'www.instagram.com', 'facebook.com', 'www.facebook.com',
  'wa.me', 'api.whatsapp.com', 'whatsapp.com', 'www.whatsapp.com',
  'google.com', 'www.google.com', 'maps.google.com', 'goo.gl',
  'bit.ly', 'tinyurl.com', 't.co', 'ow.ly', 'is.gd', 'cutt.ly', 'rebrand.ly', 'shorturl.at',
]);

function normalizeUrl(value: unknown) {
  let raw = text(value);
  if (!raw) return '';
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  try {
    const url = new URL(raw);
    url.hash = '';
    for (const key of Array.from(url.searchParams.keys())) {
      if (/^(utm_|fbclid$|gclid$|igsh$)/i.test(key)) url.searchParams.delete(key);
    }
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    const search = url.searchParams.toString();
    return `${url.protocol}//${url.hostname}${url.port ? `:${url.port}` : ''}${url.pathname}${search ? `?${search}` : ''}`;
  } catch {
    return '';
  }
}

function domainOf(value: unknown) {
  const normalized = normalizeUrl(value);
  if (!normalized) return '';
  try {
    const hostname = new URL(normalized).hostname.toLowerCase().replace(/^www\./, '');
    return GENERIC_DOMAINS.has(hostname) ? '' : hostname;
  } catch {
    return '';
  }
}

function normalizeLinks(value: unknown) {
  const source = Array.isArray(value) ? value : [];
  const unique = new Map<string, { raw: string; normalized: string; domain: string }>();
  for (const item of source) {
    const raw = text(item);
    const normalized = normalizeUrl(raw);
    if (!normalized) continue;
    unique.set(normalized, { raw, normalized, domain: domainOf(normalized) });
  }
  return Array.from(unique.values()).slice(0, 500);
}

function collectStrings(value: unknown, keys: Set<string>, output: string[], depth = 0) {
  if (depth > 4 || value === null || value === undefined) return;
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, keys, output, depth + 1);
    return;
  }
  if (typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value as JsonRecord)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (keys.has(normalizedKey) && typeof nested === 'string' && text(nested)) output.push(text(nested));
    if (nested && typeof nested === 'object') collectStrings(nested, keys, output, depth + 1);
  }
}

const WEBSITE_KEYS = new Set([
  'website', 'site', 'websiteurl', 'siteurl', 'webpage', 'urlsite', 'companywebsite',
]);

function rowWebsites(row: JsonRecord) {
  const values: string[] = [];
  const direct = [
    row.website, row.site, row.website_url, row.site_url,
    dataRecord(row.data).website, dataRecord(row.data).site,
    dataRecord(row.crm_data).website, dataRecord(row.crm_data).site,
    dataRecord(row.raw_payload).website, dataRecord(row.raw_payload).site,
  ];
  for (const value of direct) if (text(value)) values.push(text(value));
  collectStrings(row, WEBSITE_KEYS, values);

  const unique = new Map<string, string>();
  for (const value of values) {
    const normalized = normalizeUrl(value);
    if (normalized) unique.set(normalized, value);
  }
  return Array.from(unique.entries()).map(([normalized, raw]) => ({
    raw,
    normalized,
    domain: domainOf(normalized),
  }));
}

function rowDestinationValues(row: JsonRecord) {
  const data = dataRecord(row.data);
  const crm = dataRecord(row.crm_data);
  const raw = dataRecord(row.raw_payload);
  return [
    row.destination, row.original_destination, row.destination_override,
    row.lead_channel, row.lead_type,
    data.destination, data.destino, data.original_destination, data.destination_override,
    crm.destination, crm.destino, crm.original_destination, crm.destination_override,
    raw.destination, raw.destino, raw.original_destination, raw.destination_override,
  ].map((value) => text(value).toLowerCase()).filter(Boolean);
}

function isOwnSite(row: JsonRecord) {
  if (row.has_own_site === true) return true;
  return rowDestinationValues(row).some((value) => ['com site', 'com-site', 'website', 'site'].includes(value));
}

function currentStatus(row: JsonRecord) {
  const data = dataRecord(row.data);
  return text(row.status ?? row.current_status ?? data.status).toLowerCase();
}

function setCors(res: ApiResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-site-leads-extension-secret');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
}

async function updateRow(client: ReturnType<typeof supabase>, row: JsonRecord, action: Action) {
  const timestamp = new Date().toISOString();
  const nextStatus = action === 'approve' ? 'approved' : 'invalid';
  const data = dataRecord(row.data);
  const crm = dataRecord(row.crm_data);
  const raw = dataRecord(row.raw_payload);
  const reason = action === 'approve'
    ? 'Aprovado manualmente pela extensão de validação de sites.'
    : 'Invalidado manualmente pela extensão de validação de sites.';

  const patch: JsonRecord = {
    status: nextStatus,
    current_status: nextStatus,
    pipeline_status: nextStatus,
    rejected_reason: action === 'invalidate' ? reason : null,
    data: { ...data, status: nextStatus, motivo: reason, site_validation_action: action, site_validation_at: timestamp },
    crm_data: { ...crm, status: nextStatus, motivo: reason, site_validation_action: action, site_validation_at: timestamp },
    raw_payload: { ...raw, status: nextStatus, motivo: reason, site_validation_action: action, site_validation_at: timestamp },
    updated_at: timestamp,
  };

  const { error } = await client.from(tableName()).update(patch).eq('id', text(row.id));
  if (error) throw new Error(error.message);
}

async function handle(body: JsonRecord) {
  const action = text(body.action) as Action;
  if (!['approve', 'invalidate'].includes(action)) throw new Error('Acao invalida. Use approve ou invalidate.');
  const links = normalizeLinks(body.links);
  if (!links.length) throw new Error('Informe pelo menos um link valido.');

  const client = supabase();
  const { data, error } = await client
    .from(tableName())
    .select('*')
    .in('status', ['pending', 'approved', 'invalid', 'rejected']);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as JsonRecord[];
  const candidates = rows.filter(isOwnSite).flatMap((row) => {
    const websites = rowWebsites(row);
    return websites.map((website) => ({
      row,
      website: website.raw,
      normalized: website.normalized,
      domain: website.domain,
      status: currentStatus(row),
    }));
  });

  const usedIds = new Set<string>();
  const matched: Array<{ input: string; row: JsonRecord; status: string }> = [];
  const notFound: string[] = [];
  const ambiguous: string[] = [];

  for (const link of links) {
    let options = candidates.filter((candidate) => candidate.normalized && candidate.normalized === link.normalized);
    if (!options.length && link.domain) options = candidates.filter((candidate) => candidate.domain === link.domain);
    options = options.filter((candidate) => !usedIds.has(text(candidate.row.id)));
    options = Array.from(new Map(options.map((candidate) => [text(candidate.row.id), candidate])).values());
    if (!options.length) {
      notFound.push(link.raw);
      continue;
    }
    if (options.length > 1) {
      ambiguous.push(link.raw);
      continue;
    }
    const chosen = options[0];
    usedIds.add(text(chosen.row.id));
    matched.push({ input: link.raw, row: chosen.row, status: chosen.status });
  }

  let changed = 0;
  let already = 0;
  const errors: Array<{ link: string; error: string }> = [];
  const targetStatus = action === 'approve' ? 'approved' : 'invalid';

  for (const item of matched) {
    if (item.status === targetStatus) {
      already += 1;
      continue;
    }
    try {
      await updateRow(client, item.row, action);
      changed += 1;
    } catch (error) {
      errors.push({ link: item.input, error: error instanceof Error ? error.message : 'Falha desconhecida.' });
    }
  }

  return {
    success: errors.length === 0,
    action,
    received: links.length,
    matched: matched.length,
    changed,
    already,
    not_found: notFound,
    ambiguous,
    errors,
  };
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'method_not_allowed' });

  try {
    assertExtensionSecret(req);
    const result = await handle(bodyRecord(req.body));
    return res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro na API de validação de leads com site.';
    const status = /secret/i.test(message) ? 401 : 400;
    return res.status(status).json({ success: false, error: message });
  }
}
