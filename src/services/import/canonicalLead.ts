import { normalizeBrazilState } from '../geo/brazilState';
import { normalizeInstagramUsername } from '../instagram/instagram.utils';
import { calculateLeadScore } from '../lead-score/leadScore.service';
import { isStatusGroup } from '../status/status.mapper';
import { LEAD_STATUS } from '../status/leadStatus';
import { normalizePhone, normalizeSiteIdentity } from './importValidation';
import type { LeadOrigin, LeadStatusId } from '../../types/lead.types';
import type { ImportLead, ImportLeadDestination } from './types';

export type CanonicalLeadLookup = {
  branchId: number;
  countryId: number;
  stateId: number | null;
  cityId: number | null;
  channelId: number;
  contactSourceId: number;
};

/**
 * Payload estritamente limitado às colunas que já existem na tabela public.leads.
 * Nenhuma coluna auxiliar de identidade ou payload JSON é exigida.
 */
export type ExistingLeadInsert = {
  users_id: string;
  branches_id: number;
  countries_id: number;
  states_id: number | null;
  cities_id: number | null;
  channels_id: number;
  lead_status_id: LeadStatusId;
  contact_sources_id: number;
  apify_import_jobs_id: number | null;
  leads_name: string;
  leads_phone: string | null;
  leads_instagram: string | null;
  leads_website: string | null;
  leads_maps: string | null;
  leads_categories: string[];
  leads_score: number;
  leads_reviews_count: number;
  leads_origin: LeadOrigin;
  leads_created_at: string;
  leads_updated_at: string;
};

export type ExistingLeadUpdate = Omit<ExistingLeadInsert, 'users_id' | 'leads_created_at'>;

function destinationOf(lead: ImportLead): ImportLeadDestination {
  return lead.send_instagram ? 'Instagram' : lead.destination ?? lead.destino;
}

export function canonicalStatusId(status: unknown): LeadStatusId {
  if (isStatusGroup(status, 'pending')) return LEAD_STATUS.IMPORTED;
  if (isStatusGroup(status, 'approved')) return LEAD_STATUS.VALIDATED;
  if (isStatusGroup(status, 'review')) return LEAD_STATUS.PRE_SEND;
  if (isStatusGroup(status, 'queued')) return LEAD_STATUS.QUEUED;
  if (isStatusGroup(status, 'sent')) return LEAD_STATUS.SENT;
  if (isStatusGroup(status, 'rejected') || isStatusGroup(status, 'invalid')) return LEAD_STATUS.INVALID;
  if (String(status ?? '').trim().toLowerCase() === 'duplicado') return LEAD_STATUS.DUPLICATE;
  if (isStatusGroup(status, 'archived') || isStatusGroup(status, 'deleted')) return LEAD_STATUS.ARCHIVED;
  throw new Error(`Status de lead desconhecido: ${String(status ?? '') || 'vazio'}.`);
}

function compactCategories(values: Array<string | undefined>) {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const text = String(value ?? '').trim();
    const key = text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

function validateLead(lead: ImportLead, lookup: CanonicalLeadLookup, allowFinalStatus: boolean) {
  const name = lead.empresa.trim();
  if (!name) throw new Error('O lead não pode ser persistido sem nome da empresa.');
  if (!Number.isInteger(lookup.branchId) || lookup.branchId <= 0) {
    throw new Error(`Ramo inválido para o lead “${name}”.`);
  }
  if (!Number.isInteger(lookup.countryId) || lookup.countryId <= 0) {
    throw new Error('País padrão do CRM não foi encontrado.');
  }

  const phone = normalizePhone(lead.normalizedPhone || lead.whatsapp);
  const instagram = normalizeInstagramUsername(lead.normalizedInstagram || lead.instagram_url || lead.instagram);
  if (!phone && !instagram) {
    throw new Error(`O lead “${name}” precisa ter telefone ou Instagram para ser persistido.`);
  }

  const statusId = canonicalStatusId(lead.status);
  if (!allowFinalStatus && statusId !== LEAD_STATUS.IMPORTED && statusId !== LEAD_STATUS.PRE_SEND && statusId !== LEAD_STATUS.VALIDATED) {
    throw new Error(`Status de importação não persistível: ${String(lead.status ?? '') || 'vazio'}.`);
  }
}

function commonPayload(
  lead: ImportLead,
  lookup: CanonicalLeadLookup,
  options: {
    apifyImportJobId?: number | null;
    origin?: LeadOrigin;
    allowFinalStatus?: boolean;
  },
) {
  validateLead(lead, lookup, Boolean(options.allowFinalStatus));

  const rawSite = String(lead.site ?? '').trim();
  const website = normalizeSiteIdentity(lead.normalizedSite || rawSite) ? rawSite : '';
  const instagram = String(lead.instagram_url ?? lead.instagram ?? '').trim();
  const maps = String(lead.normalizedMapsUrl ?? '').trim();

  return {
    branches_id: lookup.branchId,
    countries_id: lookup.countryId,
    states_id: lookup.stateId,
    cities_id: lookup.cityId,
    channels_id: lookup.channelId,
    lead_status_id: canonicalStatusId(lead.status),
    contact_sources_id: lookup.contactSourceId,
    apify_import_jobs_id: options.apifyImportJobId ?? null,
    leads_name: lead.empresa.trim(),
    leads_phone: String(lead.whatsapp ?? '').trim() || null,
    leads_instagram: instagram || null,
    leads_website: website || null,
    leads_maps: maps || null,
    leads_categories: compactCategories([lead.ramo, lead.subcategoria]),
    leads_score: calculateLeadScore(lead),
    leads_reviews_count: Math.max(0, Math.trunc(Number(lead.reviews ?? 0) || 0)),
    leads_origin: options.origin ?? (options.apifyImportJobId ? 'apify' : 'api'),
    leads_updated_at: new Date().toISOString(),
  } as const;
}

export function buildExistingLeadInsert(
  lead: ImportLead,
  lookup: CanonicalLeadLookup,
  userId: string,
  options: {
    apifyImportJobId?: number | null;
    origin?: LeadOrigin;
  } = {},
): ExistingLeadInsert {
  const timestamp = new Date().toISOString();
  return {
    users_id: userId,
    ...commonPayload(lead, lookup, options),
    leads_created_at: timestamp,
    leads_updated_at: timestamp,
  };
}

export function buildExistingLeadUpdate(
  lead: ImportLead,
  lookup: CanonicalLeadLookup,
  options: {
    apifyImportJobId?: number | null;
    origin?: LeadOrigin;
  } = {},
): ExistingLeadUpdate {
  return commonPayload(lead, lookup, { ...options, allowFinalStatus: true });
}

export function leadIdentityValues(lead: ImportLead) {
  return {
    phone: normalizePhone(lead.normalizedPhone || lead.whatsapp),
    website: normalizeSiteIdentity(lead.normalizedSite || lead.site),
    instagram: normalizeInstagramUsername(lead.normalizedInstagram || lead.instagram_url || lead.instagram),
    maps: String(lead.normalizedMapsUrl ?? '').trim().toLowerCase(),
  };
}

export function mergePersistedLead(original: ImportLead, persisted: ImportLead): ImportLead {
  return {
    ...original,
    ...persisted,
    id: persisted.id,
    sourceLeadId: original.sourceLeadId,
    rating: original.rating,
    motivo: original.motivo,
    rejectionCode: original.rejectionCode,
    original_destination: original.original_destination ?? persisted.original_destination,
    destination_override: original.destination_override,
    instagram_override_reason: original.instagram_override_reason,
    override_by: original.override_by,
    override_at: original.override_at,
  };
}

export function normalizeLeadState(value: unknown) {
  return normalizeBrazilState(value);
}
