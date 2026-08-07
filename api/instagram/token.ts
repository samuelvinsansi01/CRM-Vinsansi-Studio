import { normalizeInstagramUsername } from './identity';
export { normalizeInstagramUsername as normalizeInstagramProfile } from './identity';

type ExtensionTokenPayload = {
  v: 1;
  iss: 'painel-crm';
  aud: 'instagram-extension';
  sub: string;
  profile: string;
  iat: number;
  exp: number;
  jti: string;
};

declare const process: { env: Record<string, string | undefined> };

function envAny(...names: string[]) {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return '';
}

function signingSecret() {
  const value = envAny('INSTAGRAM_EXTENSION_SIGNING_SECRET');
  if (!value || value.length < 32) throw new Error('instagram_extension_signing_secret_not_configured');
  return value;
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function textToBase64Url(value: string) {
  return bytesToBase64Url(new TextEncoder().encode(value));
}

function base64UrlToBytes(value: string) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function bytesToText(value: Uint8Array) {
  return new TextDecoder().decode(value);
}

async function hmac(value: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(signingSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)));
}

export async function issueInstagramExtensionToken(input: { userId: string; profile: string; ttlSeconds?: number }) {
  const now = Math.floor(Date.now() / 1000);
  const ttl = Math.min(12 * 60 * 60, Math.max(15 * 60, Number(input.ttlSeconds ?? 6 * 60 * 60)));
  const payload: ExtensionTokenPayload = {
    v: 1,
    iss: 'painel-crm',
    aud: 'instagram-extension',
    sub: String(input.userId),
    profile: normalizeInstagramUsername(input.profile),
    iat: now,
    exp: now + ttl,
    jti: crypto.randomUUID(),
  };
  if (!payload.sub || !payload.profile) throw new Error('instagram_extension_scope_invalid');
  const encodedPayload = textToBase64Url(JSON.stringify(payload));
  const signature = bytesToBase64Url(await hmac(encodedPayload));
  return { token: `${encodedPayload}.${signature}`, payload };
}

export async function verifyInstagramExtensionToken(token: string): Promise<ExtensionTokenPayload> {
  const [encodedPayload, encodedSignature, extra] = String(token ?? '').trim().split('.');
  if (!encodedPayload || !encodedSignature || extra) throw new Error('instagram_extension_token_invalid');
  const expected = await hmac(encodedPayload);
  const received = base64UrlToBytes(encodedSignature);
  if (received.length !== expected.length) throw new Error('instagram_extension_token_invalid');
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) mismatch |= expected[index] ^ received[index];
  if (mismatch !== 0) throw new Error('instagram_extension_token_invalid');

  let payload: ExtensionTokenPayload;
  try {
    payload = JSON.parse(bytesToText(base64UrlToBytes(encodedPayload))) as ExtensionTokenPayload;
  } catch {
    throw new Error('instagram_extension_token_invalid');
  }
  const now = Math.floor(Date.now() / 1000);
  if (payload.v !== 1 || payload.iss !== 'painel-crm' || payload.aud !== 'instagram-extension' || !payload.sub || !payload.profile || !payload.jti) throw new Error('instagram_extension_token_invalid');
  if (!Number.isFinite(payload.exp) || payload.exp <= now) throw new Error('instagram_extension_token_expired');
  if (!Number.isFinite(payload.iat) || payload.iat > now + 60 || payload.exp - payload.iat > 12 * 60 * 60) throw new Error('instagram_extension_token_invalid');
  payload.profile = normalizeInstagramUsername(payload.profile);
  if (!payload.profile) throw new Error('instagram_extension_token_invalid');
  return payload;
}
