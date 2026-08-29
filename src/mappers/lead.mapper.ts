import type { BaseLead, BaseLeadDestination, BaseLeadOrigin } from '../services/base/types';
import { normalizeBrazilState } from '../services/geo/brazilState';
import type { LeadDatabaseRow, LeadRelation } from '../types/lead.types';

function one<T>(relation: LeadRelation<T>): T | null {
  if (Array.isArray(relation)) return relation[0] ?? null;
  return relation ?? null;
}

function normalizePhone(value: string | null) {
  let digits = String(value ?? '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('55')) return digits;
  return digits.length === 10 || digits.length === 11 ? `55${digits}` : digits;
}

function normalizeDomain(value: string | null) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return '';
  try {
    const url = /^https?:\/\//.test(raw) ? new URL(raw) : new URL(`https://${raw}`);
    return url.hostname.replace(/^www\./, '');
  } catch {
    return raw.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  }
}

function normalizeInstagram(value: string | null) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//, '')
    .replace(/^@/, '')
    .split(/[/?#\s]/)[0];
}

function normalizedChannel(channelName: string | undefined) {
  return String(channelName ?? '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

function originFromChannel(channelName: string | undefined): BaseLeadOrigin {
  const channel = normalizedChannel(channelName);
  if (channel === 'instagram') return 'Instagram';
  if (channel === 'sem destino') return 'Sem destino';
  if (channel === 'whatsapp') return 'WhatsApp';
  return 'Sem canal';
}

function destinationFromLead(channelName: string | undefined, sourceId: number, website: string): BaseLeadDestination {
  const channel = normalizedChannel(channelName);
  if (channel === 'instagram') return 'Instagram';
  if (channel === 'sem destino') return 'Sem destino';
  if (channel === 'whatsapp') return 'WhatsApp';
  // Compatibilidade apenas para linhas históricas sem channels_id.
  if (sourceId === 4) return 'Instagram';
  if (sourceId === 3) return 'Agregador';
  if (sourceId === 2 || website.trim()) return 'Com site';
  return 'WhatsApp';
}

export function mapLead(row: LeadDatabaseRow): BaseLead {
  const branch = one(row.branches);
  const state = one(row.states);
  const city = one(row.cities);
  const channel = one(row.channels);
  const status = one(row.lead_status);
  const website = row.leads_website ?? '';
  const phone = row.leads_phone ?? '';
  const instagram = row.leads_instagram ?? '';
  const origin = originFromChannel(channel?.channels_name);
  const destination = destinationFromLead(channel?.channels_name, row.contact_sources_id, website);

  return {
    id: String(row.leads_id),
    company: row.leads_name,
    branch: branch?.branches_name ?? '',
    branch_id: String(row.branches_id),
    state: normalizeBrazilState(state?.states_code ?? state?.states_name ?? ''),
    city: city?.cities_name ?? '',
    phone,
    normalizedPhone: normalizePhone(phone),
    site: website,
    normalizedSite: normalizeDomain(website),
    instagram,
    normalizedInstagram: normalizeInstagram(instagram),
    mapsUrl: row.leads_maps ?? '',
    origin,
    destination,
    status: status?.lead_status_name ?? ({ 1: 'importado', 2: 'revisao', 3: 'sem_contato', 4: 'na_fila', 5: 'enviado', 6: 'invalido', 7: 'duplicado' } as const)[row.lead_status_id],
    statusId: row.lead_status_id as BaseLead['statusId'],
    finalizedAt: row.leads_updated_at ?? row.leads_created_at,
  };
}
