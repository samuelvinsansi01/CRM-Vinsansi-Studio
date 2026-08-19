import { createClient } from '@supabase/supabase-js';

type ApiRequest = { method?: string; body?: unknown; headers?: Record<string, string | string[] | undefined> };
type ApiResponse = { status(code: number): ApiResponse; json(body: unknown): void; setHeader(name: string, value: string): void };
type RecordValue = Record<string, unknown>;
declare const process: { env: Record<string, string | undefined> };

function envAny(...names: string[]) {
  for (const name of names) {
    const value = process.env[name];
    if (String(value ?? '').trim()) return String(value).trim();
  }
  return '';
}
function bodyRecord(body: unknown): RecordValue {
  if (typeof body === 'string') { try { return JSON.parse(body) as RecordValue; } catch { return {}; } }
  return body && typeof body === 'object' && !Array.isArray(body) ? body as RecordValue : {};
}
function header(req: ApiRequest, name: string) {
  const key = Object.keys(req.headers ?? {}).find((item) => item.toLowerCase() === name.toLowerCase());
  const value = key ? req.headers?.[key] : undefined;
  return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '');
}
function bearer(req: ApiRequest) { return header(req, 'authorization').match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? ''; }
function send(res: ApiResponse, status: number, payload: unknown) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  return res.status(status).json(payload);
}
function allowedEmails() {
  return new Set(envAny('DESKTOP_WORKER_PROVISIONING_ALLOWED_EMAILS')
    .split(',').map((value) => value.trim().toLowerCase()).filter(Boolean));
}

async function importRsaPublicKey(pem: string) {
  const base64 = pem.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s+/g, '');
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return crypto.subtle.importKey('spki', bytes, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
}
function arrayBufferToBase64(value: ArrayBuffer) {
  const bytes = new Uint8Array(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method_not_allowed' });
  try {
    if (envAny('DESKTOP_WORKER_PROVISIONING_ENABLED').toLowerCase() !== 'true') {
      return send(res, 503, { ok: false, error: 'worker_provisioning_disabled' });
    }

    const token = bearer(req);
    const supabaseUrl = envAny('SUPABASE_URL', 'VITE_SUPABASE_URL');
    const publicKey = envAny('SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_PUBLISHABLE_KEY');
    const serviceRoleKey = envAny('SUPABASE_SERVICE_ROLE_KEY');
    if (!token) return send(res, 401, { ok: false, error: 'auth_required' });
    if (!supabaseUrl || !publicKey || !serviceRoleKey) return send(res, 503, { ok: false, error: 'worker_provisioning_backend_not_configured' });

    const authClient = createClient(supabaseUrl, publicKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const auth = await authClient.auth.getUser(token);
    if (auth.error || !auth.data.user) return send(res, 401, { ok: false, error: 'auth_invalid' });

    const email = String(auth.data.user.email ?? '').trim().toLowerCase();
    const allowed = allowedEmails();
    if (!email || !allowed.size || !allowed.has(email)) return send(res, 403, { ok: false, error: 'worker_provisioning_not_authorized' });

    const body = bodyRecord(req.body);
    const pem = String(body.public_key_pem ?? '').trim();
    if (!pem.startsWith('-----BEGIN PUBLIC KEY-----') || pem.length > 8192) {
      return send(res, 400, { ok: false, error: 'worker_provisioning_public_key_invalid' });
    }

    let key: CryptoKey;
    try { key = await importRsaPublicKey(pem); }
    catch { return send(res, 400, { ok: false, error: 'worker_provisioning_public_key_invalid' }); }

    const encrypted = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, key, new TextEncoder().encode(serviceRoleKey));
    const encryptedServiceRoleKey = arrayBufferToBase64(encrypted);

    return send(res, 200, {
      ok: true,
      version: 1,
      supabaseUrl,
      encryptedServiceRoleKey,
    });
  } catch {
    return send(res, 500, { ok: false, error: 'worker_provisioning_failed' });
  }
}
