import { LEAD_STATUS } from '../../services/status/leadStatus';
import { getSupabaseClient } from '../../lib/supabase';
import { mapLead } from '../../mappers/lead.mapper';
import { normalizeBrazilState } from '../../services/geo/brazilState';
import {
  buildExistingLeadInsert,
  buildExistingLeadUpdate,
  leadIdentityValues,
  mergePersistedLead,
  type CanonicalLeadLookup,
} from '../../services/import/canonicalLead';
import {
  extractImportItems,
  normalizeImportItems,
  normalizePhone,
  normalizeSiteIdentity,
} from '../../services/import/importValidation';
import type {
  ImportExecutionOptions,
  ImportLead,
  ImportLeadDestination,
  ImportLeadInput,
  ImportListFilters,
  ImportParseResult,
  ImportPersistResult,
  ImportSummary,
} from '../../services/import/types';
import { normalizeInstagramUsername } from '../../services/instagram/instagram.utils';
import { isStatusGroup } from '../../services/status/status.mapper';
import type { LeadDatabaseRow, LeadStatusId } from '../../types/lead.types';
import { createId, getCurrentUserId } from '../supabase.helpers';
import type { ImportRepository } from './import.repository';

/** Somente colunas já existentes no banco novo. */
const NORMALIZED_LEADS_SELECT = `
  leads_id,
  users_id,
  branches_id,
  countries_id,
  states_id,
  cities_id,
  channels_id,
  lead_status_id,
  contact_sources_id,
  apify_import_jobs_id,
  leads_name,
  leads_phone,
  leads_instagram,
  leads_website,
  leads_maps,
  leads_street,
  leads_postal_code,
  leads_categories,
  leads_score,
  leads_reviews_count,
  leads_origin,
  leads_created_at,
  leads_updated_at,
  branches:branches_id ( branches_id, branches_name ),
  countries:countries_id ( countries_id, countries_name, countries_code ),
  states:states_id ( states_id, states_name, states_code ),
  cities:cities_id ( cities_id, cities_name ),
  channels:channels_id ( channels_id, channels_name ),
  lead_status:lead_status_id ( lead_status_id, lead_status_name ),
  contact_sources:contact_sources_id ( contact_sources_id, contact_sources_name )
`;

const ACTIVE_IMPORT_STATUS_IDS: LeadStatusId[] = [LEAD_STATUS.IMPORTED, LEAD_STATUS.VALIDATED];
const ALL_LEAD_STATUS_IDS: LeadStatusId[] = Object.values(LEAD_STATUS);

type LookupRow = Record<string, unknown>;
type IdentityType = keyof ReturnType<typeof leadIdentityValues>;
type IdentityIndex = Record<IdentityType, Map<string, string>>;

function normalizeComparable(value: unknown) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function normalizeLeadInput(input: ImportLeadInput): ImportLeadInput {
  const sendInstagram = input.send_instagram ?? false;
  const now = new Date().toISOString();
  return {
    ...input,
    estado: normalizeBrazilState(input.estado),
    original_destination: input.original_destination ?? input.destino,
    destination: sendInstagram ? 'Instagram' : input.destination ?? input.destino,
    destination_override: sendInstagram ? 'Instagram' : input.destination_override,
    send_instagram: sendInstagram,
    instagram_url: input.instagram_url ?? input.instagram,
    instagram_override_reason: sendInstagram
      ? input.instagram_override_reason || 'Override manual para Instagram'
      : '',
    override_by: sendInstagram ? input.override_by || 'Operador local' : '',
    override_at: sendInstagram ? input.override_at || now : '',
  };
}

function rowToImportLead(row: LeadDatabaseRow): ImportLead {
  const mapped = mapLead(row);
  const destination = mapped.destination === 'Agregador' ? 'Agregadores' : mapped.destination;

  return {
    id: mapped.id,
    empresa: mapped.company,
    ramo: mapped.branch,
    branch_id: mapped.branch_id,
    subcategoria: row.leads_categories?.[1] ?? row.leads_categories?.[0] ?? mapped.branch,
    destino: destination,
    original_destination: destination,
    destination,
    send_instagram: destination === 'Instagram',
    instagram_url: mapped.instagram,
    status: mapped.status,
    motivo: '',
    rating: 0,
    reviews: Number(row.leads_reviews_count ?? 0),
    whatsapp: mapped.phone,
    instagram: mapped.instagram,
    site: mapped.site,
    cidade: mapped.city,
    estado: mapped.state,
    normalizedPhone: normalizePhone(mapped.phone),
    normalizedSite: normalizeSiteIdentity(mapped.site),
    normalizedInstagram: normalizeInstagramUsername(mapped.instagram),
    normalizedMapsUrl: String(row.leads_maps ?? '').trim().toLowerCase(),
    sourceLeadId: '',
  };
}

function applyFilters(records: ImportLead[], filters: ImportListFilters) {
  const query = filters.search?.trim().toLowerCase() ?? '';
  return records.filter((lead) => {
    const matchesStatus = filters.status === 'rejected'
      ? isStatusGroup(lead.status, 'rejected') || isStatusGroup(lead.status, 'invalid')
      : isStatusGroup(lead.status, filters.status);
    const matchesQuery = !query || JSON.stringify(lead).toLowerCase().includes(query);
    return matchesStatus && matchesQuery;
  });
}

function calculateSummary(records: ImportLead[]): ImportSummary {
  const approved = records.filter((lead) => isStatusGroup(lead.status, 'approved'));
  const pending = records.filter((lead) => isStatusGroup(lead.status, 'pending'));
  const operational = [...approved, ...pending];
  const rejected = records.filter((lead) => isStatusGroup(lead.status, 'rejected') || isStatusGroup(lead.status, 'invalid'));
  const finalDestination = (lead: ImportLead) => (lead.send_instagram ? 'Instagram' : lead.destination ?? lead.destino);

  return {
    total: records.length,
    approved: approved.length,
    pending: pending.length,
    rejected: rejected.length,
    whatsapp: approved.filter((lead) => finalDestination(lead) === 'WhatsApp').length,
    ownSite: operational.filter((lead) => finalDestination(lead) === 'Com site').length,
    aggregators: operational.filter((lead) => finalDestination(lead) === 'Agregadores').length,
    instagram: operational.filter((lead) => finalDestination(lead) === 'Instagram').length,
  };
}

function idMap(records: ImportLead[], key: 'normalizedPhone' | 'normalizedSite' | 'normalizedInstagram' | 'normalizedMapsUrl' | 'sourceLeadId') {
  const map = new Map<string, string>();
  for (const lead of records) {
    const value = String(lead[key] ?? '').trim();
    if (value && !map.has(value)) map.set(value, lead.id);
  }
  return map;
}

function isOperationalStoredLead(lead: ImportLead) {
  return !isStatusGroup(lead.status, 'rejected')
    && !isStatusGroup(lead.status, 'invalid')
    && !isStatusGroup(lead.status, 'deleted');
}

async function listRows(statusIds?: LeadStatusId[]): Promise<LeadDatabaseRow[]> {
  const userId = await getCurrentUserId();
  const pageSize = 1000;
  const rows: LeadDatabaseRow[] = [];

  for (let from = 0; ; from += pageSize) {
    let query = getSupabaseClient()
      .from('leads')
      .select(NORMALIZED_LEADS_SELECT)
      .eq('users_id', userId)
      .order('leads_created_at', { ascending: false })
      .order('leads_id', { ascending: false })
      .range(from, from + pageSize - 1);

    if (statusIds?.length) query = query.in('lead_status_id', statusIds);
    const { data, error } = await query;
    if (error) throw new Error(`Não foi possível carregar os leads: ${error.message}`);

    const page = (data ?? []) as unknown as LeadDatabaseRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }

  return rows;
}

function statusIdsForFilter(status: ImportListFilters['status']): LeadStatusId[] {
  if (status === 'pending') return [1];
  if (status === 'approved') return [2];
  if (status === 'review') return [3];
  if (status === 'queued') return [4];
  if (status === 'sent') return [5];
  if (status === 'rejected' || status === 'invalid') return [6, 7];
  if (status === 'archived' || status === 'deleted') return [8];
  return ALL_LEAD_STATUS_IDS;
}

async function allLeads(statusIds: LeadStatusId[] = ACTIVE_IMPORT_STATUS_IDS) {
  return (await listRows(statusIds)).map(rowToImportLead);
}

async function getLeadRow(id: string): Promise<LeadDatabaseRow> {
  if (!/^\d+$/.test(id)) throw new Error('O lead ainda não foi persistido no banco.');
  const userId = await getCurrentUserId();
  const { data, error } = await getSupabaseClient()
    .from('leads')
    .select(NORMALIZED_LEADS_SELECT)
    .eq('leads_id', Number(id))
    .eq('users_id', userId)
    .single();

  if (error) throw new Error(`Lead não encontrado: ${error.message}`);
  return data as unknown as LeadDatabaseRow;
}

async function selectLookupRows(table: string, columns: string): Promise<LookupRow[]> {
  type Result = { data: LookupRow[] | null; error: { message: string } | null };
  const query = getSupabaseClient().from(table) as unknown as {
    select: (columns: string) => PromiseLike<Result>;
  };
  const { data, error } = await query.select(columns);
  if (error) throw new Error(`Falha ao carregar ${table}: ${error.message}`);
  return data ?? [];
}

async function resolveLookups(leads: ImportLead[]): Promise<Map<string, CanonicalLeadLookup>> {
  const [branches, countries, states, cities] = await Promise.all([
    selectLookupRows('branches', 'branches_id,branches_name'),
    selectLookupRows('countries', 'countries_id,countries_name,countries_code'),
    selectLookupRows('states', 'states_id,states_name,states_code'),
    selectLookupRows('cities', 'cities_id,cities_name,states_id'),
  ]);

  const brazil = countries.find((row) => {
    const code = normalizeComparable(row.countries_code);
    const name = normalizeComparable(row.countries_name);
    return code === 'br' || name === 'brasil' || name === 'brazil';
  }) ?? countries.find((row) => Number(row.countries_id) === 1);

  if (!brazil) throw new Error('O país Brasil não foi encontrado na tabela countries.');
  const countryId = Number(brazil.countries_id);
  const result = new Map<string, CanonicalLeadLookup>();

  for (const lead of leads) {
    const explicitBranchId = Number(lead.branch_id);
    const branch = Number.isInteger(explicitBranchId) && explicitBranchId > 0
      ? branches.find((row) => Number(row.branches_id) === explicitBranchId)
      : branches.find((row) => normalizeComparable(row.branches_name) === normalizeComparable(lead.ramo));

    if (!branch) {
      throw new Error(`O ramo “${lead.ramo || 'não informado'}” do lead “${lead.empresa}” não existe em branches.`);
    }

    const state = states.find((row) => {
      const value = normalizeComparable(lead.estado);
      return value && (normalizeComparable(row.states_name) === value || normalizeComparable(row.states_code) === value);
    });
    const stateId = state ? Number(state.states_id) : null;
    const city = cities.find((row) => {
      if (normalizeComparable(row.cities_name) !== normalizeComparable(lead.cidade)) return false;
      if (!stateId || row.states_id == null) return true;
      return Number(row.states_id) === stateId;
    });

    result.set(lead.id, {
      branchId: Number(branch.branches_id),
      countryId,
      stateId,
      cityId: city ? Number(city.cities_id) : null,
    });
  }

  return result;
}

function emptyIdentityIndex(): IdentityIndex {
  return {
    phone: new Map(),
    website: new Map(),
    instagram: new Map(),
    maps: new Map(),
  };
}

function addLeadToIdentityIndex(index: IdentityIndex, lead: ImportLead) {
  const identities = leadIdentityValues(lead);
  (Object.keys(identities) as IdentityType[]).forEach((type) => {
    const value = identities[type];
    if (value && !index[type].has(value)) index[type].set(value, lead.id);
  });
}

function buildIdentityIndex(leads: ImportLead[]) {
  const index = emptyIdentityIndex();
  leads.forEach((lead) => addLeadToIdentityIndex(index, lead));
  return index;
}

function duplicateId(index: IdentityIndex, lead: ImportLead) {
  const identities = leadIdentityValues(lead);
  for (const type of Object.keys(identities) as IdentityType[]) {
    const value = identities[type];
    if (!value) continue;
    const existing = index[type].get(value);
    if (existing) return existing;
  }
  return null;
}

function matchPersistedRows(originals: ImportLead[], rows: LeadDatabaseRow[]) {
  const remaining = rows.map((row) => ({ row, lead: rowToImportLead(row) }));
  return originals.map((original) => {
    const originalIdentities = leadIdentityValues(original);
    const index = remaining.findIndex(({ lead }) => {
      const persistedIdentities = leadIdentityValues(lead);
      return (Object.keys(originalIdentities) as IdentityType[])
        .some((type) => Boolean(originalIdentities[type] && originalIdentities[type] === persistedIdentities[type]));
    });

    if (index < 0) {
      throw new Error(`O banco criou o lead “${original.empresa}”, mas não foi possível reconciliar o registro retornado.`);
    }
    const [{ lead }] = remaining.splice(index, 1);
    return mergePersistedLead(original, lead);
  });
}

async function persistExistingSchemaLeads(
  leads: ImportLead[],
  options: ImportExecutionOptions = {},
): Promise<ImportPersistResult> {
  if (!leads.length) return { created: [], duplicateClientIds: [] };

  // Releitura imediatamente antes da gravação reduz a janela de duplicidade
  // sem exigir tabela, coluna, índice ou função nova no banco.
  const existing = (await allLeads(ALL_LEAD_STATUS_IDS)).filter(isOperationalStoredLead);
  const identityIndex = buildIdentityIndex(existing);
  const accepted: ImportLead[] = [];
  const duplicateClientIds: string[] = [];

  for (const lead of leads) {
    if (duplicateId(identityIndex, lead)) {
      duplicateClientIds.push(lead.id);
      continue;
    }
    accepted.push(lead);
    addLeadToIdentityIndex(identityIndex, lead);
  }

  if (!accepted.length) return { created: [], duplicateClientIds };

  const userId = await getCurrentUserId();
  const lookupByLeadId = await resolveLookups(accepted);
  const payload = accepted.map((lead) => {
    const lookup = lookupByLeadId.get(lead.id);
    if (!lookup) throw new Error(`Não foi possível resolver os relacionamentos do lead “${lead.empresa}”.`);
    return buildExistingLeadInsert(lead, lookup, userId, {
      apifyImportJobId: options.apifyImportJobId,
      origin: options.origin,
    });
  });

  const { data, error } = await getSupabaseClient()
    .from('leads')
    .insert(payload)
    .select(NORMALIZED_LEADS_SELECT);

  if (error) {
    throw new Error(`Não foi possível persistir o lote na tabela leads existente: ${error.message}`);
  }

  const rows = (data ?? []) as unknown as LeadDatabaseRow[];
  if (rows.length !== accepted.length) {
    throw new Error(`O banco retornou ${rows.length} de ${accepted.length} leads inseridos; a importação não pode ser confirmada.`);
  }

  return {
    created: matchPersistedRows(accepted, rows),
    duplicateClientIds,
  };
}

function leadIdentityKeys(lead: ImportLead) {
  const identities = leadIdentityValues(lead);
  return Object.values(identities).filter(Boolean);
}

function duplicateLead(lead: ImportLead): ImportLead {
  return {
    ...lead,
    status: 'rejected',
    destino: 'Recusado',
    destination: 'Recusado',
    motivo: 'Lead duplicado: identidade já existente na plataforma.',
    rejectionCode: 'duplicate_site',
  };
}

export const supabaseImportRepository: ImportRepository = {
  async list(filters) {
    return applyFilters(await allLeads(statusIdsForFilter(filters.status)), filters);
  },

  async summary() {
    return calculateSummary(await allLeads());
  },

  async importFromJson(jsonText: string, options: ImportExecutionOptions = {}): Promise<ImportParseResult> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      throw new Error('JSON inválido. Revise o conteúdo colado e tente novamente.');
    }

    const existing = (await allLeads(ALL_LEAD_STATUS_IDS)).filter(isOperationalStoredLead);
    const startedAt = performance.now?.() ?? Date.now();
    const normalized = await normalizeImportItems(extractImportItems(parsed), {
      existingLeadIds: new Set(options.context?.existingLeadIds ?? []),
      existingPhones: new Set(existing.map((lead) => normalizePhone(lead.whatsapp)).filter(Boolean)),
      existingSites: new Set(existing.map((lead) => normalizeSiteIdentity(lead.normalizedSite || lead.site)).filter(Boolean)),
      existingInstagrams: new Set(existing.map((lead) => String(lead.normalizedInstagram ?? '').trim()).filter(Boolean)),
      existingMapsUrls: new Set(existing.map((lead) => String(lead.normalizedMapsUrl ?? '').trim()).filter(Boolean)),
      existingLeadIdToId: new Map((options.context?.existingLeadIds ?? []).map((id) => [id, id])),
      existingPhoneToId: idMap(existing, 'normalizedPhone'),
      existingSiteToId: new Map(existing.map((lead) => [normalizeSiteIdentity(lead.normalizedSite || lead.site), lead.id] as const).filter(([value]) => Boolean(value))),
      existingInstagramToId: idMap(existing, 'normalizedInstagram'),
      existingMapsUrlToId: idMap(existing, 'normalizedMapsUrl'),
      baseLeadIds: new Set(options.context?.baseLeadIds ?? []),
      basePhones: new Set(options.context?.basePhones ?? []),
      baseSites: new Set(options.context?.baseSites ?? []),
      baseInstagrams: new Set(options.context?.baseInstagrams ?? []),
      baseMapsUrls: new Set(options.context?.baseMapsUrls ?? []),
    });

    const duplicateCodes = new Set([
      'payload_duplicate',
      'duplicate_phone',
      'duplicate_site',
      'already_in_base',
      'duplicate_lead_id',
    ]);
    const preparedItems = normalized.items.map((item) => ({
      ...item,
      lead: { id: createId('lead'), ...normalizeLeadInput(item.input) } as ImportLead,
    }));
    const sessionLeads = preparedItems
      .filter((item) => !item.ignored && !duplicateCodes.has(String(item.code)))
      .map((item) => item.lead);
    const duplicateAuditItems = preparedItems.filter((item) => !item.ignored && duplicateCodes.has(String(item.code)));
    const operationalLeads = sessionLeads.filter((lead) =>
      isStatusGroup(lead.status, 'approved') || isStatusGroup(lead.status, 'pending'));
    const simulation = Boolean(options.simulate);

    let persisted: ImportPersistResult = { created: [], duplicateClientIds: [] };
    if (!simulation) persisted = await persistExistingSchemaLeads(operationalLeads, options);

    const createdByIdentity = new Map<string, ImportLead>();
    for (const lead of persisted.created) {
      leadIdentityKeys(lead).forEach((key) => createdByIdentity.set(key, lead));
    }
    const createdByOriginalId = new Map<string, ImportLead>();
    for (const original of operationalLeads) {
      const match = leadIdentityKeys(original)
        .map((key) => createdByIdentity.get(key))
        .find(Boolean);
      if (match) createdByOriginalId.set(original.id, match);
    }

    const finalSessionLeads = sessionLeads.map((lead) => {
      const persistedLead = createdByOriginalId.get(lead.id)
        ?? leadIdentityKeys(lead).map((key) => createdByIdentity.get(key)).find(Boolean);
      if (persistedLead) return persistedLead;
      if (persisted.duplicateClientIds.includes(lead.id)) return duplicateLead(lead);
      return lead;
    });
    const finalApproved = finalSessionLeads.filter((lead) => isStatusGroup(lead.status, 'approved')).length;
    const finalRejected = finalSessionLeads.filter((lead) => isStatusGroup(lead.status, 'rejected')).length;
    const ignored = normalized.items.filter((item) => item.ignored).length
      + duplicateAuditItems.length
      + persisted.duplicateClientIds.length;

    return {
      created: simulation ? 0 : persisted.created.length,
      approved: finalApproved,
      rejected: finalRejected,
      ignored,
      errors: normalized.errors,
      leads: finalSessionLeads,
      report: {
        simulation,
        processed: normalized.processed,
        created: simulation ? 0 : persisted.created.length,
        approved: finalApproved,
        rejected: finalRejected,
        ignored,
        duplicates: normalized.duplicates + persisted.duplicateClientIds.length,
        durationMs: Math.max(0, Math.round((performance.now?.() ?? Date.now()) - startedAt)),
        reasons: normalized.reasons,
      },
    };
  },

  async persist(leads, options = {}) {
    const operational = leads.filter((lead) =>
      !/^\d+$/.test(lead.id)
      && (isStatusGroup(lead.status, 'approved') || isStatusGroup(lead.status, 'pending')));
    return persistExistingSchemaLeads(operational, options);
  },

  async create(input) {
    const lead = { id: createId('lead'), ...normalizeLeadInput(input) } as ImportLead;
    const result = await persistExistingSchemaLeads([lead], { origin: 'manual' });
    if (result.duplicateClientIds.length) throw new Error('duplicate_identity: lead já existente na plataforma.');
    if (!result.created[0]) throw new Error('O banco não retornou o lead criado.');
    return result.created[0];
  },

  async update(id, input) {
    const currentRow = await getLeadRow(id);
    const current = rowToImportLead(currentRow);
    const updated = { id, ...normalizeLeadInput({ ...current, ...input }) } as ImportLead;

    const otherLeads = (await allLeads(ALL_LEAD_STATUS_IDS))
      .filter((lead) => lead.id !== id && isOperationalStoredLead(lead));
    if (duplicateId(buildIdentityIndex(otherLeads), updated)) {
      throw new Error('duplicate_identity: outra empresa já utiliza telefone, site, Instagram ou Maps informado.');
    }

    const lookupById = await resolveLookups([updated]);
    const lookup = lookupById.get(id);
    if (!lookup) throw new Error('Não foi possível resolver os relacionamentos do lead.');
    const payload = buildExistingLeadUpdate(updated, lookup, {
      apifyImportJobId: currentRow.apify_import_jobs_id,
      origin: currentRow.leads_origin,
    });
    const userId = await getCurrentUserId();

    const { data, error } = await getSupabaseClient()
      .from('leads')
      .update(payload)
      .eq('leads_id', Number(id))
      .eq('users_id', userId)
      .select(NORMALIZED_LEADS_SELECT)
      .maybeSingle();

    if (error) throw new Error(`Não foi possível atualizar o lead: ${error.message}`);
    if (!data) throw new Error('Lead não encontrado ou sem permissão para atualizar.');
    return mergePersistedLead(updated, rowToImportLead(data as unknown as LeadDatabaseRow));
  },

  async remove(id) {
    const userId = await getCurrentUserId();
    const { data, error } = await getSupabaseClient()
      .from('leads')
      .update({ lead_status_id: LEAD_STATUS.ARCHIVED, leads_updated_at: new Date().toISOString() })
      .eq('leads_id', Number(id))
      .eq('users_id', userId)
      .select('leads_id')
      .maybeSingle();
    if (error) throw new Error(`Não foi possível arquivar o lead: ${error.message}`);
    if (!data) throw new Error('Lead não encontrado ou sem permissão para arquivar.');
  },

  async move(id, status: 'approved' | 'rejected') {
    const userId = await getCurrentUserId();
    const statusId: LeadStatusId = status === 'approved' ? LEAD_STATUS.VALIDATED : LEAD_STATUS.INVALID;
    const { data, error } = await getSupabaseClient()
      .from('leads')
      .update({ lead_status_id: statusId, leads_updated_at: new Date().toISOString() })
      .eq('leads_id', Number(id))
      .eq('users_id', userId)
      .select('leads_id')
      .maybeSingle();
    if (error) throw new Error(`Não foi possível mover o lead: ${error.message}`);
    if (!data) throw new Error('Lead não encontrado ou sem permissão para mover.');
    const moved = rowToImportLead(await getLeadRow(id));
    return status === 'rejected'
      ? { ...moved, status: 'rejected', destino: 'Recusado', destination: 'Recusado', motivo: 'Movido manualmente para recusados.' }
      : moved;
  },
};
