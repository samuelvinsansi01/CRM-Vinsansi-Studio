const RESERVED_INSTAGRAM_PATHS = new Set([
  'about',
  'accounts',
  'api',
  'challenge',
  'contact',
  'developer',
  'direct',
  'directory',
  'download',
  'emails',
  'explore',
  'graphql',
  'invites',
  'legal',
  'oauth',
  'p',
  'press',
  'reel',
  'reels',
  'stories',
  'tv',
  'web',
]);

function cleanCandidate(value: string) {
  const username = value
    .replace(/^@/, '')
    .split(/[/?#\s]/)[0]
    .trim()
    .toLowerCase();

  if (!username || RESERVED_INSTAGRAM_PATHS.has(username)) return '';
  if (!/^[a-z0-9._]{1,30}$/.test(username)) return '';
  return username;
}

export function normalizeInstagramUsername(value: unknown) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';

  const looksLikeUrl = /^https?:\/\//i.test(raw) || /^(www\.)?instagram\.com(?:\/|$)/i.test(raw);
  if (looksLikeUrl) {
    try {
      const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
      const host = url.hostname.replace(/^www\./, '').toLowerCase();
      if (host !== 'instagram.com') return '';
      return cleanCandidate(url.pathname.replace(/^\/+/, ''));
    } catch {
      return '';
    }
  }

  return cleanCandidate(raw);
}

export function isValidInstagram(value: unknown) {
  return Boolean(normalizeInstagramUsername(value));
}
