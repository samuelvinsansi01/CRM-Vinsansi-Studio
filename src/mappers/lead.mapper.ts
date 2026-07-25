import type { BaseLead, BaseLeadDataOrigin, BaseLeadDestination, BaseLeadOrigin } from '../services/base/types';
import { normalizeBrazilState } from '../services/geo/brazilState';
import type { LeadDatabaseRow, LeadRelation, LeadStatusName } from '../types/lead.types';

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

function dataOrigin(value: string): BaseLeadDataOrigin {
  return value === 'manual' || value === 'apify' || value === 'csv' || value === 'api' ? value : 'manual';
}

function originFromChannel(channelName: string | undefined): BaseLeadOrigin {
  return channelName?.trim().toLowerCase() === 'instagram' ? 'Instagram' : 'WhatsApp';
}

function destinationFromLead(channelName: string | undefined, sourceId: number, website: string): BaseLeadDestination {
  if (channelName?.toLowerCase() === 'instagram' || sourceId === 4) return 'Instagram';
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
  const source = one(row.contact_sources);
  const website = row.leads_website ?? '';
  const phone = row.leads_phone ?? '';
  const instagram = row.leads_instagram ?? '';
  const origin = originFromChannel(channel?.channels_name);
  const sourceOrigin = dataOrigin(row.leads_origin);
  const destination = destinationFromLead(channel?.channels_name, row.contact_sources_id, website);
  const statusName = (status?.lead_status_name ?? '') as LeadStatusName;

  return {
    id: String(row.leads_id),
    sourceLeadId: row.apify_import_jobs_id ? String(row.apify_import_jobs_id) : undefined,
    company: row.leads_name,
    branch: branch?.branches_name ?? row.leads_categories?.[0] ?? '',
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
    dataOrigin: sourceOrigin,
    destination,
    original_destination: destination,
    send_instagram: destination === 'Instagram',
    status: statusName,
    sentAt: row.leads_updated_at ?? row.leads_created_at,
    template: '',
    chipOrProfile: '',
    notes: '',
    history: [{
      id: `lead-${row.leads_id}-created`,
      date: row.leads_created_at.slice(0, 10),
      title: 'Lead cadastrado',
      description: `Origem: ${source?.contact_sources_name ?? row.leads_origin}`,
    }],
  };
}
