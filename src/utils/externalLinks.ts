function digits(value: unknown) {
  return String(value ?? '').replace(/\D/g, '');
}

export function externalHttpHref(value: unknown) {
  const raw = String(value ?? '').trim();
  if (!raw) return undefined;
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(candidate);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function mapsHref(value: unknown) {
  return externalHttpHref(value);
}

export function instagramHref(value: unknown) {
  const raw = String(value ?? '').trim();
  if (!raw) return undefined;
  if (/^https?:\/\//i.test(raw)) return externalHttpHref(raw);
  const username = raw
    .replace(/^@/, '')
    .replace(/^www\./i, '')
    .replace(/^instagram\.com\//i, '')
    .split(/[/?#\s]/)[0]
    .trim();
  return username ? `https://www.instagram.com/${encodeURIComponent(username)}/` : undefined;
}

export function whatsappHref(value: unknown) {
  const phone = digits(value);
  return phone.length >= 10 ? `https://wa.me/${phone}` : undefined;
}

export function phoneHref(value: unknown) {
  const phone = digits(value);
  return phone.length >= 10 ? `tel:+${phone}` : undefined;
}
