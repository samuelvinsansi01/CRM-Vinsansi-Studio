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

const INSTAGRAM_USERNAME_PATTERN = /^[a-z0-9._]{1,30}$/;
const INSTAGRAM_PROFILE_HOSTS = new Set(['instagram.com', 'www.instagram.com']);

function validCandidate(value: string) {
  const username = value.toLowerCase();
  if (!INSTAGRAM_USERNAME_PATTERN.test(username)) return '';
  if (RESERVED_INSTAGRAM_PATHS.has(username)) return '';
  return username;
}

export function normalizeInstagramUsername(value: unknown) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';

  const looksLikeInstagramUrl = /^https?:\/\//i.test(raw) || /^(www\.)?instagram\.com(?:\/|$)/i.test(raw);
  if (looksLikeInstagramUrl) {
    try {
      const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
      if (!INSTAGRAM_PROFILE_HOSTS.has(url.hostname.toLowerCase())) return '';
      if (url.port || url.username || url.password) return '';
      const segments = url.pathname.split('/').filter(Boolean);
      if (segments.length !== 1) return '';
      return validCandidate(segments[0]);
    } catch {
      return '';
    }
  }

  const candidate = raw.startsWith('@') ? raw.slice(1) : raw;
  return validCandidate(candidate);
}

export function isValidInstagram(value: unknown) {
  return Boolean(normalizeInstagramUsername(value));
}
