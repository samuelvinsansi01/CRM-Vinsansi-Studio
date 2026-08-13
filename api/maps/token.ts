export const MAPS_EXTENSION_SCOPES = [
  'maps:catalogs:read',
  'maps:targets:read',
  'maps:searches:read',
  'maps:searches:write',
  'maps:candidates:read',
  'maps:candidates:write',
  'maps:leads:promote',
] as const;

export type MapsExtensionScope = typeof MAPS_EXTENSION_SCOPES[number];
export type MapsExtensionTokenPayload = {
  v: 1;
  iss: 'painel-crm';
  aud: 'google-maps-extension';
  sub: string;
  extensionType: 'google_maps';
  installationId: string;
  scopes: MapsExtensionScope[];
  iat: number;
  exp: number;
  jti: string;
};

declare const process: { env: Record<string, string | undefined> };

function secret() {
  const value = String(process.env.GMAPS_EXTENSION_SIGNING_SECRET ?? '').trim();
  if (value.length < 32) throw new Error('gmaps_extension_signing_secret_not_configured');
  return value;
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value: string) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

async function signature(value: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret()), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)));
}

export async function sha256(value: string) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function issueMapsExtensionToken(input: { userId: number; installationId: string; scopes?: MapsExtensionScope[]; ttlSeconds?: number }) {
  const now = Math.floor(Date.now() / 1000);
  const scopes = input.scopes ?? [...MAPS_EXTENSION_SCOPES];
  const payload: MapsExtensionTokenPayload = {
    v: 1,
    iss: 'painel-crm',
    aud: 'google-maps-extension',
    sub: String(input.userId),
    extensionType: 'google_maps',
    installationId: String(input.installationId).trim(),
    scopes,
    iat: now,
    exp: now + Math.min(24 * 60 * 60, Math.max(15 * 60, Number(input.ttlSeconds ?? 6 * 60 * 60))),
    jti: crypto.randomUUID(),
  };
  if (!payload.installationId || !payload.sub || !payload.scopes.length) throw new Error('gmaps_extension_token_scope_invalid');
  const encoded = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  return { token: `${encoded}.${bytesToBase64Url(await signature(encoded))}`, payload };
}

export async function verifyMapsExtensionToken(token: string, requiredScopes: MapsExtensionScope[] = []) {
  const [encoded, receivedSignature, extra] = String(token ?? '').trim().split('.');
  if (!encoded || !receivedSignature || extra) throw new Error('gmaps_extension_token_invalid');
  const expected = await signature(encoded);
  const received = base64UrlToBytes(receivedSignature);
  if (received.length !== expected.length) throw new Error('gmaps_extension_token_invalid');
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) mismatch |= expected[index] ^ received[index];
  if (mismatch !== 0) throw new Error('gmaps_extension_token_invalid');
  let payload: MapsExtensionTokenPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(encoded))) as MapsExtensionTokenPayload;
  } catch {
    throw new Error('gmaps_extension_token_invalid');
  }
  const now = Math.floor(Date.now() / 1000);
  if (payload.v !== 1 || payload.iss !== 'painel-crm' || payload.aud !== 'google-maps-extension' || payload.extensionType !== 'google_maps') throw new Error('gmaps_extension_token_invalid');
  if (!payload.sub || !payload.installationId || !payload.jti || !Array.isArray(payload.scopes)) throw new Error('gmaps_extension_token_invalid');
  if (!Number.isFinite(payload.exp) || payload.exp <= now) throw new Error('gmaps_extension_token_expired');
  if (!Number.isFinite(payload.iat) || payload.iat > now + 60 || payload.exp - payload.iat > 24 * 60 * 60) throw new Error('gmaps_extension_token_invalid');
  for (const scope of requiredScopes) if (!payload.scopes.includes(scope)) throw new Error(`gmaps_extension_scope_required:${scope}`);
  return payload;
}
