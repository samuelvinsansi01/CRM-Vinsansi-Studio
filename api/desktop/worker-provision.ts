import { createClient } from '@supabase/supabase-js';

type ApiRequest = { method?: string; body?: unknown; headers?: Record<string, string | string[] | undefined> };
type ApiResponse = { status(code: number): ApiResponse; json(body: unknown): void; setHeader(name: string, value: string): void };
type RecordValue = Record<string, unknown>;
declare const process: { env: Record<string, string | undefined> };

const DEFAULT_TUNNEL_ID = '1886e172-0796-49af-8e88-ffa7fc206fbc';
const DEFAULT_TUNNEL_NAME = 'evolution';
const DEFAULT_EVOLUTION_PUBLIC_URL = 'https://evolution.samuelvinsansi.com.br';
const DEFAULT_EVOLUTION_SERVICE_URL = 'http://127.0.0.1:8080';
const DEFAULT_WORKER_PUBLIC_URL = 'https://worker.samuelvinsansi.com.br';
const DEFAULT_WORKER_SERVICE_URL = 'http://127.0.0.1:8787';

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
function expectedTunnel() {
  return {
    tunnelId: (envAny('DESKTOP_CLOUDFLARE_TUNNEL_ID') || DEFAULT_TUNNEL_ID).toLowerCase(),
    tunnelName: envAny('DESKTOP_CLOUDFLARE_TUNNEL_NAME') || DEFAULT_TUNNEL_NAME,
    evolutionPublicUrl: envAny('DESKTOP_EVOLUTION_PUBLIC_URL') || DEFAULT_EVOLUTION_PUBLIC_URL,
    evolutionServiceUrl: envAny('DESKTOP_EVOLUTION_SERVICE_URL') || DEFAULT_EVOLUTION_SERVICE_URL,
    workerPublicUrl: envAny('DESKTOP_WORKER_PUBLIC_URL') || DEFAULT_WORKER_PUBLIC_URL,
    workerServiceUrl: envAny('DESKTOP_WORKER_SERVICE_URL') || DEFAULT_WORKER_SERVICE_URL,
  };
}
function parseTunnelCredential(raw: string, expectedTunnelId: string) {
  if (raw.length < 40 || raw.length > 16384) throw new Error('cloudflare_local_tunnel_credentials_invalid');
  let parsed: RecordValue;
  try { parsed = JSON.parse(raw) as RecordValue; }
  catch { throw new Error('cloudflare_local_tunnel_credentials_invalid'); }
  const accountTag = String(parsed.AccountTag ?? '').trim();
  const tunnelSecret = String(parsed.TunnelSecret ?? '').trim();
  const tunnelId = String(parsed.TunnelID ?? '').trim().toLowerCase();
  if (!accountTag || !tunnelSecret || !tunnelId) throw new Error('cloudflare_local_tunnel_credentials_invalid');
  if (tunnelId !== expectedTunnelId.toLowerCase()) throw new Error('cloudflare_local_tunnel_id_mismatch');
  return JSON.stringify({ AccountTag: accountTag, TunnelSecret: tunnelSecret, TunnelID: tunnelId });
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
async function encryptValue(key: CryptoKey, value: string) {
  const encrypted = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, key, new TextEncoder().encode(value));
  return arrayBufferToBase64(encrypted);
}
function migrationMissing(error: unknown) {
  const value = JSON.stringify(error ?? '').toLowerCase();
  return value.includes('service_get_desktop_tunnel_credential')
    || value.includes('service_save_desktop_tunnel_credential')
    || value.includes('desktop_tunnel_credentials')
    || value.includes('42883')
    || value.includes('schema cache');
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
    if (!supabaseUrl || !publicKey || !serviceRoleKey) {
      return send(res, 503, { ok: false, error: 'worker_provisioning_backend_not_configured' });
    }

    const authClient = createClient(supabaseUrl, publicKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const auth = await authClient.auth.getUser(token);
    if (auth.error || !auth.data.user) return send(res, 401, { ok: false, error: 'auth_invalid' });

    const email = String(auth.data.user.email ?? '').trim().toLowerCase();
    const allowed = allowedEmails();
    if (!email || !allowed.size || !allowed.has(email)) return send(res, 403, { ok: false, error: 'worker_provisioning_not_authorized' });

    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const owner = await admin.from('users').select('users_id').eq('auth_user_id', auth.data.user.id).maybeSingle();
    if (owner.error || !owner.data?.users_id) return send(res, 403, { ok: false, error: 'public_user_not_found' });
    const usersId = Number(owner.data.users_id);
    const tunnel = expectedTunnel();
    const body = bodyRecord(req.body);
    const action = String(body.action ?? 'provision').trim().toLowerCase();

    if (action === 'enroll_local_tunnel') {
      let credentialsJson: string;
      try { credentialsJson = parseTunnelCredential(String(body.credentials_json ?? ''), tunnel.tunnelId); }
      catch (error) { return send(res, 400, { ok: false, error: error instanceof Error ? error.message : 'cloudflare_local_tunnel_credentials_invalid' }); }

      const saved = await admin.rpc('service_save_desktop_tunnel_credential', {
        p_users_id: usersId,
        p_tunnel_id: tunnel.tunnelId,
        p_tunnel_name: tunnel.tunnelName,
        p_credentials_json: credentialsJson,
        p_evolution_public_url: tunnel.evolutionPublicUrl,
        p_evolution_service_url: tunnel.evolutionServiceUrl,
        p_worker_public_url: tunnel.workerPublicUrl,
        p_worker_service_url: tunnel.workerServiceUrl,
      });
      if (saved.error) {
        if (migrationMissing(saved.error)) return send(res, 503, { ok: false, error: 'cloudflare_local_tunnel_migration_missing' });
        return send(res, 500, { ok: false, error: 'cloudflare_local_tunnel_enrollment_failed' });
      }
      return send(res, 200, {
        ok: true,
        version: 3,
        enrolled: true,
        cloudflareTunnelId: tunnel.tunnelId,
        cloudflareTunnelName: tunnel.tunnelName,
        evolutionPublicUrl: tunnel.evolutionPublicUrl,
        evolutionTunnelServiceUrl: tunnel.evolutionServiceUrl,
        workerPublicUrl: tunnel.workerPublicUrl,
        workerTunnelServiceUrl: tunnel.workerServiceUrl,
      });
    }

    if (action !== 'provision') return send(res, 400, { ok: false, error: 'worker_provisioning_action_invalid' });

    const pem = String(body.public_key_pem ?? '').trim();
    if (!pem.startsWith('-----BEGIN PUBLIC KEY-----') || pem.length > 8192) {
      return send(res, 400, { ok: false, error: 'worker_provisioning_public_key_invalid' });
    }
    let key: CryptoKey;
    try { key = await importRsaPublicKey(pem); }
    catch { return send(res, 400, { ok: false, error: 'worker_provisioning_public_key_invalid' }); }

    const tunnelCredential = await admin.rpc('service_get_desktop_tunnel_credential', { p_users_id: usersId });
    if (tunnelCredential.error) {
      if (migrationMissing(tunnelCredential.error)) return send(res, 503, { ok: false, error: 'cloudflare_local_tunnel_migration_missing' });
      return send(res, 500, { ok: false, error: 'cloudflare_local_tunnel_read_failed' });
    }
    const row = Array.isArray(tunnelCredential.data) ? tunnelCredential.data[0] as RecordValue | undefined : undefined;
    const credentialsJson = String(row?.credentials_json ?? '').trim();
    if (!credentialsJson) return send(res, 409, { ok: false, error: 'cloudflare_local_tunnel_not_enrolled' });

    let normalizedCredentials: string;
    try { normalizedCredentials = parseTunnelCredential(credentialsJson, tunnel.tunnelId); }
    catch { return send(res, 503, { ok: false, error: 'cloudflare_local_tunnel_credentials_invalid' }); }

    const [encryptedServiceRoleKey, encryptedCloudflareTunnelCredentials] = await Promise.all([
      encryptValue(key, serviceRoleKey),
      encryptValue(key, normalizedCredentials),
    ]);

    return send(res, 200, {
      ok: true,
      version: 3,
      supabaseUrl,
      cloudflareTunnelId: String(row?.tunnel_id ?? tunnel.tunnelId),
      cloudflareTunnelName: String(row?.tunnel_name ?? tunnel.tunnelName),
      evolutionPublicUrl: String(row?.evolution_public_url ?? tunnel.evolutionPublicUrl),
      evolutionTunnelServiceUrl: String(row?.evolution_service_url ?? tunnel.evolutionServiceUrl),
      workerPublicUrl: String(row?.worker_public_url ?? tunnel.workerPublicUrl),
      workerTunnelServiceUrl: String(row?.worker_service_url ?? tunnel.workerServiceUrl),
      encryptedServiceRoleKey,
      encryptedCloudflareTunnelCredentials,
    });
  } catch {
    return send(res, 500, { ok: false, error: 'worker_provisioning_failed' });
  }
}
