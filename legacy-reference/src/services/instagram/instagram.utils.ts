const RESERVED_INSTAGRAM_PATHS = new Set([
  'about',
  'accounts',
  'explore',
  'p',
  'reel',
  'reels',
  'stories',
  'tv',
  'direct',
  'developer',
  'legal',
]);

export function normalizeInstagramUsername(value: unknown) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';

  try {
    const withProtocol = raw.startsWith('http://') || raw.startsWith('https://') ? raw : `https://${raw.replace(/^@/, 'instagram.com/')}`;
    const url = new URL(withProtocol);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();

    if (host.endsWith('instagram.com')) {
      return url.pathname.replace(/^\/+/, '').split('/')[0].replace(/^@/, '').trim().toLowerCase();
    }
  } catch {
    // Fall back to text cleanup below.
  }

  return raw
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
    .replace(/^@/, '')
    .split(/[/?#\s]/)[0]
    .trim()
    .toLowerCase();
}

export function isValidInstagram(value: unknown) {
  const username = normalizeInstagramUsername(value);
  if (!username || RESERVED_INSTAGRAM_PATHS.has(username)) return false;
  return /^[a-z0-9._]{2,30}$/.test(username);
}
