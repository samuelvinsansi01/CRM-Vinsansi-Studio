import { exchangePairing, startPairing } from '../../../tools/executor.js';

type ApiRequest = { method?: string; body?: unknown; headers?: Record<string, string | string[] | undefined> };
type ApiResponse = { status(code: number): ApiResponse; json(body: unknown): void; setHeader(name: string, value: string): void };
type RecordValue = Record<string, unknown>;
declare const process: { env: Record<string, string | undefined> };

const DEFAULT_TUNNEL_ID = '42e52d34-34e7-4f2d-a626-4f550500b610';
const DEFAULT_TUNNEL_NAME = 'vinsansi-docker';
const DEFAULT_EVOLUTION_PUBLIC_URL = 'https://evolution.samuelvinsansi.com.br';
const DEFAULT_EVOLUTION_SERVICE_URL = 'http://host.docker.internal:8080';
const DEFAULT_WORKER_PUBLIC_URL = 'https://worker.samuelvinsansi.com.br';
const DEFAULT_WORKER_SERVICE_URL = 'http://lead-certo-whatsapp-worker:8787';
const DEFAULT_CLOUDFLARE_IMAGE = 'cloudflare/cloudflared:2026.7.3';
const DEFAULT_CLOUDFLARE_CONTAINER = 'vinsansi-cloudflared';
const DEFAULT_DOCKER_NETWORK = 'vinsansi-network';

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

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method_not_allowed' });
  try {
    if (envAny('DESKTOP_WORKER_PROVISIONING_ENABLED').toLowerCase() !== 'true') {
      return send(res, 503, { ok: false, error: 'worker_provisioning_disabled' });
    }

    const token = bearer(req);
    const supabaseUrl = envAny('SUPABASE_URL', 'VITE_SUPABASE_URL');
    const cloudflareTunnelToken = envAny('DESKTOP_CLOUDFLARE_TUNNEL_TOKEN');
    if (!token) return send(res, 401, { ok: false, error: 'auth_required' });
    if (!supabaseUrl || !envAny('SUPABASE_SERVICE_ROLE_KEY') || !cloudflareTunnelToken) {
      return send(res, 503, { ok: false, error: 'worker_provisioning_backend_not_configured' });
    }

    const body = bodyRecord(req.body);
    const action = String(body.action ?? 'provision').trim().toLowerCase();
    if (action !== 'provision') return send(res, 400, { ok: false, error: 'worker_provisioning_action_invalid' });
    const pem = String(body.public_key_pem ?? '').trim();
    if (!pem.startsWith('-----BEGIN PUBLIC KEY-----') || pem.length > 8192) {
      return send(res, 400, { ok: false, error: 'worker_provisioning_public_key_invalid' });
    }

    let key: CryptoKey;
    try { key = await importRsaPublicKey(pem); }
    catch { return send(res, 400, { ok: false, error: 'worker_provisioning_public_key_invalid' }); }

    const organizationId = Number(body.organization_id);
    const externalInstallationId = String(body.external_installation_id ?? '').trim();
    if (!Number.isSafeInteger(organizationId) || organizationId <= 0 || !externalInstallationId) {
      return send(res, 400, { ok: false, error: 'worker_provisioning_context_invalid' });
    }
    const pairing = await startPairing(req, {
      toolId: 'vinsansi_whatsapp_manager', organizationId, externalInstallationId,
      version: String(body.app_version ?? '1.1.0'),
      capabilities: ['organization.context','member.context','settings.read','presence.heartbeat','activity.report','whatsapp.instances.manage','whatsapp.queue.execute'],
    });
    const exchanged = await exchangePairing({ pairingCode: pairing.pairingCode });
    const [encryptedInstallationCredential, encryptedUserSession, encryptedCloudflareTunnelToken] = await Promise.all([
      encryptValue(key, exchanged.installationCredential),
      encryptValue(key, exchanged.userSession),
      encryptValue(key, cloudflareTunnelToken),
    ]);

    return send(res, 200, {
      ok: true,
      version: 5,
      supabaseUrl,
      cloudflareTunnelId: envAny('DESKTOP_CLOUDFLARE_TUNNEL_ID') || DEFAULT_TUNNEL_ID,
      cloudflareTunnelName: envAny('DESKTOP_CLOUDFLARE_TUNNEL_NAME') || DEFAULT_TUNNEL_NAME,
      evolutionPublicUrl: envAny('DESKTOP_EVOLUTION_PUBLIC_URL') || DEFAULT_EVOLUTION_PUBLIC_URL,
      evolutionTunnelServiceUrl: envAny('DESKTOP_EVOLUTION_SERVICE_URL') || DEFAULT_EVOLUTION_SERVICE_URL,
      workerPublicUrl: envAny('DESKTOP_WORKER_PUBLIC_URL') || DEFAULT_WORKER_PUBLIC_URL,
      workerTunnelServiceUrl: envAny('DESKTOP_WORKER_SERVICE_URL') || DEFAULT_WORKER_SERVICE_URL,
      cloudflareTunnelImage: envAny('DESKTOP_CLOUDFLARE_IMAGE') || DEFAULT_CLOUDFLARE_IMAGE,
      cloudflareTunnelContainerName: envAny('DESKTOP_CLOUDFLARE_CONTAINER_NAME') || DEFAULT_CLOUDFLARE_CONTAINER,
      dockerNetworkName: envAny('DESKTOP_DOCKER_NETWORK_NAME') || DEFAULT_DOCKER_NETWORK,
      organizationId,
      encryptedInstallationCredential,
      encryptedUserSession,
      encryptedCloudflareTunnelToken,
    });
  } catch {
    return send(res, 500, { ok: false, error: 'worker_provisioning_failed' });
  }
}
