import type { BaseLead } from '../base/types';

export type DuplicateField = 'phone' | 'instagram' | 'domain' | 'maps';

export type LeadDuplicateMatch = {
  lead: BaseLead;
  field: DuplicateField;
  value: string;
};

function normalizePhone(value: unknown) {
  let digits = String(value ?? '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('55')) return digits;
  return digits.length === 10 || digits.length === 11 ? `55${digits}` : digits;
}

function normalizeInstagram(value: unknown) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//, '')
    .replace(/^@/, '')
    .split(/[/?#\s]/)[0];
}

function normalizeDomain(value: unknown) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return '';
  try {
    const url = /^https?:\/\//.test(raw) ? new URL(raw) : new URL(`https://${raw}`);
    return url.hostname.replace(/^www\./, '');
  } catch {
    return raw.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  }
}

function normalizeMaps(value: unknown) {
  return String(value ?? '').trim().toLowerCase().replace(/\/+$/, '');
}

function numericId(lead: BaseLead) {
  const id = Number(lead.id);
  return Number.isFinite(id) ? id : Number.MAX_SAFE_INTEGER;
}

export function findDuplicate(lead: BaseLead, candidates: BaseLead[]): LeadDuplicateMatch | null {
  const ordered = candidates
    .filter((candidate) => candidate.id !== lead.id)
    .filter((candidate) => candidate.status !== 'invalido' && candidate.status !== 'arquivado' && candidate.status !== 'duplicado')
    .sort((a, b) => numericId(a) - numericId(b));

  const checks: Array<{ field: DuplicateField; value: string; read: (candidate: BaseLead) => string }> = [
    { field: 'phone', value: normalizePhone(lead.normalizedPhone || lead.phone), read: (candidate) => normalizePhone(candidate.normalizedPhone || candidate.phone) },
    { field: 'instagram', value: normalizeInstagram(lead.normalizedInstagram || lead.instagram), read: (candidate) => normalizeInstagram(candidate.normalizedInstagram || candidate.instagram) },
    { field: 'domain', value: normalizeDomain(lead.normalizedSite || lead.site), read: (candidate) => normalizeDomain(candidate.normalizedSite || candidate.site) },
    { field: 'maps', value: normalizeMaps(lead.mapsUrl), read: (candidate) => normalizeMaps(candidate.mapsUrl) },
  ];

  for (const check of checks) {
    if (!check.value) continue;
    const duplicate = ordered.find((candidate) => check.read(candidate) === check.value);
    if (duplicate) return { lead: duplicate, field: check.field, value: check.value };
  }

  return null;
}

export const leadDuplicateService = { findDuplicate };
