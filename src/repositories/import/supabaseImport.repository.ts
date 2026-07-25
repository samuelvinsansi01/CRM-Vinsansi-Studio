import { getSupabaseClient } from '../../lib/supabase';
import { normalizeBrazilState } from '../../services/geo/brazilState';
import {
  extractImportItems,
  normalizeDomain,
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
  ImportSummary,
} from '../../services/import/types';
import { normalizeInstagramUsername } from '../../services/instagram/instagram.utils';
import { classifyLeadContact, normalizeLeadContact } from '../../services/import/leadNormalization';
import { isStatusGroup } from '../../services/status/status.mapper';
import { LEAD_STATUS } from '../../types/lead.types';
import { createId, getCurrentUserId } from '../supabase.helpers';
import type { ImportRepository } from './import.repository';

type LookupRow = Record<string, unknown>;
type LookupConfig = { table: string; id: string; name: string; alternateName?: string };

type NormalizedLeadRow = {
  leads_id: number;
  branches_id: number;
  states_id: number | null;
  cities_id: number | null;
  channels_id: number | null;
  lead_status_id: number;
  contact_sources_id: number;
  apify_import_jobs_id: number | null;
  leads_name: string;
  leads_phone: string | null;
  leads_instagram: string | null;
  leads_website: string | null;
  leads_maps: string | null;
  leads_categories: string[] | null;
  leads_score: number | null;
  leads_reviews_count: number | null;
  leads_origin: 'manual' | 'apify' | 'csv' | 'api';
  branches?: { branches_name?: string } | Array<{ branches_name?: string }> | null;
  states?: { states_name?: string; states_code?: string } | Array<{ states_name?: string; states_code?: string }> | null;
  cities?: { cities_name?: string } | Array<{ cities_name?: string }> | null;
  channels?: { channels_name?: string } | Array<{ channels_name?: string }> | null;
  lead_status?: { lead_status_name?: string } | Array<{ lead_status_name?: string }> | null;
};

const LEADS_SELECT = `
  leads_id,
  branches_id,
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
  leads_categories,
  leads_score,
  leads_reviews_count,
  leads_origin,
  branches:branches_id ( branches_name ),
  states:states_id ( states_name, states_code ),
  cities:cities_id ( cities_name ),
  channels:channels_id ( channels_name ),
  lead_status:lead_status_id ( lead_status_name )
`;

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function comparable(value: unknown) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
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
    instagram_override_reason: sendInstagram ? input.instagram_override_reason || 'Override manual para Instagram' : '',
    override_by: sendInstagram ? input.override_by || 'Operador local' : '',
    override_at: sendInstagram ? input.override_at || now : '',
  };
}

function destinationFromRow(row: NormalizedLeadRow): ImportLeadDestination {
  const channel = comparable(one(row.channels)?.channels_name);
  if (channel === 'instagram' || row.contact_sources_id === 4) return 'Instagram';
  if (row.contact_sources_id === 3) return 'Agregadores';
  if (row.contact_sources_id === 2 || String(row.leads_website ?? '').trim()) return 'Com site';
  return 'WhatsApp';
}

function legacyStatus(row: NormalizedLeadRow): ImportLead['status'] {
  if (row.lead_status_id === LEAD_STATUS.importado) return 'pending';
  if (row.lead_status_id === LEAD_STATUS.validado || row.lead_status_id === LEAD_STATUS.pre_envio) return 'approved';
  if (row.lead_status_id === LEAD_STATUS.na_fila) return 'queued';
  if (row.lead_status_id === LEAD_STATUS.enviado) return 'sent';
  return 'rejected';
}

function rowToLead(row: NormalizedLeadRow): ImportLead {
  const branch = one(row.branches);
  const state = one(row.states);
  const city = one(row.cities);
  const destination = destinationFromRow(row);
  const instagram = row.leads_instagram ?? '';
  const website = row.leads_website ?? '';
  return {
    id: String(row.leads_id),
    empresa: row.leads_name,
    ramo: branch?.branches_name ?? row.leads_categories?.[0] ?? '',
    branch_id: String(row.branches_id),
    subcategoria: row.leads_categories?.[0] ?? '',
    destino: destination,
    original_destination: destination,
    destination,
    send_instagram: destination === 'Instagram',
    instagram_url: instagram,
    status: legacyStatus(row),
    motivo: row.lead_status_id === LEAD_STATUS.duplicado ? 'Lead duplicado.' : row.lead_status_id === LEAD_STATUS.invalido ? 'Lead inválido.' : '',
    rating: Number(row.leads_score ?? 0),
    reviews: Number(row.leads_reviews_count ?? 0),
    whatsapp: row.leads_phone ?? '',
    instagram,
    site: website,
    cidade: city?.cities_name ?? '',
    estado: normalizeBrazilState(state?.states_code ?? state?.states_name ?? ''),
    normalizedPhone: normalizePhone(row.leads_phone ?? ''),
    normalizedSite: normalizeDomain(website),
    normalizedInstagram: normalizeInstagramUsername(instagram),
    normalizedMapsUrl: row.leads_maps ?? '',
    sourceLeadId: undefined,
  };
}

async function queryRows<T>(table: string, select: string): Promise<T[]> {
  type Result = { data: unknown[] | null; error: { message: string } | null };
  const query = getSupabaseClient().from(table) as unknown as { select(columns: string): PromiseLike<Result> };
  const { data, error } = await query.select(select);
  if (error) throw new Error(error.message);
  return (data ?? []) as T[];
}

async function allLeads(): Promise<ImportLead[]> {
  const userId = await getCurrentUserId();
  type Result = { data: unknown[] | null; error: { message: string } | null };
  const query = getSupabaseClient().from('leads') as unknown as {
    select(columns: string): { eq(column: string, value: string): PromiseLike<Result> };
  };
  const { data, error } = await query.select(LEADS_SELECT).eq('users_id', userId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => rowToLead(row as NormalizedLeadRow));
}

async function resolveLookup(config: LookupConfig, value: unknown, userId?: string): Promise<number | null> {
  const wanted = comparable(value);
  if (!wanted) return null;
  const columns = [config.id, config.name, config.alternateName, config.table === 'branches' ? 'users_id' : undefined].filter(Boolean).join(',');
  const rows = await queryRows<LookupRow>(config.table, columns);
  const match = rows.find((row) => comparable(row[config.name]) === wanted || (config.alternateName && comparable(row[config.alternateName]) === wanted));
  if (!match) return null;
  if (userId && 'users_id' in match && String(match.users_id) !== userId) return null;
  return Number(match[config.id]);
}


async function resolveCityId(city: unknown, stateId: number | null): Promise<number | null> {
  const wanted = comparable(city);
  if (!wanted) return null;

  type CityRow = { cities_id: number; cities_name: string; states_id: number | null };
  type Result = { data: CityRow[] | null; error: { message: string } | null };
  const baseQuery = getSupabaseClient().from('cities') as unknown as {
    select(columns: string): {
      eq(column: string, value: number): PromiseLike<Result>;
      then<TResult1 = Result, TResult2 = never>(
        onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ): PromiseLike<TResult1 | TResult2>;
    };
  };

  const selected = baseQuery.select('cities_id,cities_name,states_id');
  const { data, error } = stateId ? await selected.eq('states_id', stateId) : await selected;
  if (error) throw new Error(error.message);
  const match = (data ?? []).find((row) => comparable(row.cities_name) === wanted);
  return match ? Number(match.cities_id) : null;
}

async function normalizedPayload(lead: ImportLead, userId: string) {
  const destination = lead.send_instagram ? 'Instagram' : lead.destination ?? lead.destino;
  const branchId = Number(lead.branch_id) || await resolveLookup({ table: 'branches', id: 'branches_id', name: 'branches_name' }, lead.ramo, userId);
  if (!branchId) throw new Error(`Ramo não encontrado no banco: ${lead.ramo || lead.subcategoria || 'não informado'}.`);

  const contact = normalizeLeadContact(lead);
  const stateId = await resolveLookup({ table: 'states', id: 'states_id', name: 'states_name', alternateName: 'states_code' }, contact.state);
  const cityId = await resolveCityId(contact.city, stateId);
  const { channelId, contactSourceId } = classifyLeadContact(destination);

  return {
    users_id: Number(userId),
    branches_id: branchId,
    countries_id: 1,
    states_id: stateId,
    cities_id: cityId,
    channels_id: channelId,
    lead_status_id: LEAD_STATUS.importado,
    apify_import_jobs_id: null,
    contact_sources_id: contactSourceId,
    leads_name: lead.empresa.trim(),
    leads_phone: contact.phone,
    leads_instagram: contact.instagram,
    leads_website: contact.website,
    leads_maps: contact.mapsUrl,
    leads_street: null,
    leads_postal_code: null,
    leads_categories: contact.categories,
    leads_score: Number(lead.rating ?? 0),
    leads_reviews_count: Number(lead.reviews ?? 0),
    leads_origin: 'csv' as const,
    leads_updated_at: new Date().toISOString(),
  };
}

function applyFilters(records: ImportLead[], filters: ImportListFilters) {
  const query = String(filters.search ?? '').trim().toLowerCase();
  return records.filter((lead) => isStatusGroup(lead.status, filters.status) && (!query || JSON.stringify(lead).toLowerCase().includes(query)));
}

function calculateSummary(records: ImportLead[]): ImportSummary {
  const approved = records.filter((lead) => isStatusGroup(lead.status, 'approved'));
  const pending = records.filter((lead) => isStatusGroup(lead.status, 'pending'));
  const rejected = records.filter((lead) => isStatusGroup(lead.status, 'rejected'));
  const operational = [...approved, ...pending];
  const destination = (lead: ImportLead) => lead.send_instagram ? 'Instagram' : lead.destination ?? lead.destino;
  return {
    total: records.length,
    approved: approved.length,
    pending: pending.length,
    rejected: rejected.length,
    whatsapp: approved.filter((lead) => destination(lead) === 'WhatsApp').length,
    ownSite: operational.filter((lead) => destination(lead) === 'Com site').length,
    aggregators: operational.filter((lead) => destination(lead) === 'Agregadores').length,
    instagram: operational.filter((lead) => destination(lead) === 'Instagram').length,
  };
}

function idMap(records: ImportLead[], key: 'normalizedPhone' | 'normalizedSite' | 'normalizedInstagram' | 'normalizedMapsUrl' | 'sourceLeadId') {
  return new Map(records.map((lead) => [String(lead[key] ?? '').trim(), lead.id] as const).filter(([value]) => Boolean(value)));
}

function duplicateError(error: unknown) {
  return /duplicate|unique constraint|already exists/i.test(error instanceof Error ? error.message : String(error ?? ''));
}

export const supabaseImportRepository: ImportRepository = {
  async list(filters) {
    return applyFilters(await allLeads(), filters);
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

    const existing = await allLeads();
    const startedAt = performance.now?.() ?? Date.now();
    const normalized = await normalizeImportItems(extractImportItems(parsed), {
      existingLeadIds: new Set(existing.map((lead) => String(lead.sourceLeadId ?? '').trim()).filter(Boolean)),
      existingPhones: new Set(existing.map((lead) => normalizePhone(lead.whatsapp)).filter(Boolean)),
      existingSites: new Set(existing.map((lead) => normalizeSiteIdentity(lead.normalizedSite || lead.site)).filter(Boolean)),
      existingInstagrams: new Set(existing.map((lead) => String(lead.normalizedInstagram ?? '').trim()).filter(Boolean)),
      existingMapsUrls: new Set(existing.map((lead) => String(lead.normalizedMapsUrl ?? '').trim()).filter(Boolean)),
      existingLeadIdToId: idMap(existing, 'sourceLeadId'),
      existingPhoneToId: idMap(existing, 'normalizedPhone'),
      existingSiteToId: idMap(existing, 'normalizedSite'),
      existingInstagramToId: idMap(existing, 'normalizedInstagram'),
      existingMapsUrlToId: idMap(existing, 'normalizedMapsUrl'),
      baseLeadIds: new Set(options.context?.baseLeadIds ?? []),
      basePhones: new Set(options.context?.basePhones ?? []),
      baseSites: new Set(options.context?.baseSites ?? []),
      baseInstagrams: new Set(options.context?.baseInstagrams ?? []),
      baseMapsUrls: new Set(options.context?.baseMapsUrls ?? []),
      sentLeadIds: new Set(options.context?.sentLeadIds ?? []),
      sentPhones: new Set(options.context?.sentPhones ?? []),
      sentSites: new Set(options.context?.sentSites ?? []),
      sentInstagrams: new Set(options.context?.sentInstagrams ?? []),
      sentMapsUrls: new Set(options.context?.sentMapsUrls ?? []),
    });

    const duplicateCodes = new Set(['payload_duplicate', 'duplicate_phone', 'duplicate_site', 'already_in_base', 'duplicate_lead_id', 'already_sent']);
    const prepared = normalized.items.map((item) => ({ ...item, lead: { id: createId('lead'), ...normalizeLeadInput(item.input) } as ImportLead }));
    const sessionLeads = prepared.filter((item) => !item.ignored && !duplicateCodes.has(String(item.code))).map((item) => item.lead);
    const operational = sessionLeads.filter((lead) => isStatusGroup(lead.status, 'approved') || isStatusGroup(lead.status, 'pending'));
    const simulation = Boolean(options.simulate);
    const persisted: ImportLead[] = [];
    const databaseDuplicates: ImportLead[] = [];

    if (!simulation) {
      const userId = await getCurrentUserId();
      for (const lead of operational) {
        try {
          const payload = await normalizedPayload(lead, userId);
          type InsertResult = { data: { leads_id: number } | null; error: { message: string } | null };
          const query = getSupabaseClient().from('leads') as unknown as {
            insert(value: Record<string, unknown>): { select(columns: string): { single(): PromiseLike<InsertResult> } };
          };
          const { data, error } = await query.insert(payload).select('leads_id').single();
          if (error) throw new Error(error.message);
          persisted.push({ ...lead, existingId: lead.id, id: String(data?.leads_id ?? lead.id), status: 'pending' });
        } catch (error) {
          if (!duplicateError(error)) throw error;
          databaseDuplicates.push({ ...lead, status: 'rejected', destino: 'Recusado', destination: 'Recusado', motivo: 'Lead duplicado: identidade já existente na plataforma.', rejectionCode: 'duplicate_site' });
        }
      }
    }

    const finalLeads = sessionLeads.map((lead) => databaseDuplicates.find((item) => item.id === lead.id) ?? persisted.find((item) => item.existingId === lead.id) ?? lead);
    const approved = finalLeads.filter((lead) => isStatusGroup(lead.status, 'approved')).length;
    const rejected = finalLeads.filter((lead) => isStatusGroup(lead.status, 'rejected')).length;
    const ignored = normalized.items.filter((item) => item.ignored).length + prepared.filter((item) => duplicateCodes.has(String(item.code))).length + databaseDuplicates.length;

    return {
      created: simulation ? 0 : persisted.length,
      approved,
      rejected,
      ignored,
      errors: normalized.errors,
      leads: finalLeads,
      report: {
        simulation,
        processed: normalized.processed,
        created: simulation ? 0 : persisted.length,
        approved,
        rejected,
        ignored,
        duplicates: normalized.duplicates + databaseDuplicates.length,
        durationMs: Math.max(0, Math.round((performance.now?.() ?? Date.now()) - startedAt)),
        reasons: normalized.reasons,
      },
    };
  },

  async create(input) {
    const lead = { id: createId('lead'), ...normalizeLeadInput(input) } as ImportLead;
    const userId = await getCurrentUserId();
    const payload = await normalizedPayload(lead, userId);
    type InsertResult = { data: { leads_id: number } | null; error: { message: string } | null };
    const query = getSupabaseClient().from('leads') as unknown as {
      insert(value: Record<string, unknown>): { select(columns: string): { single(): PromiseLike<InsertResult> } };
    };
    const { data, error } = await query.insert(payload).select('leads_id').single();
    if (error) throw new Error(error.message);
    return { ...lead, id: String(data?.leads_id ?? lead.id), status: 'pending' };
  },

  async update(id, input) {
    if (!/^\d+$/.test(id)) throw new Error('Lead de prévia ainda não foi persistido.');
    const existing = (await allLeads()).find((lead) => lead.id === id);
    if (!existing) throw new Error('Lead não encontrado.');
    const updated = { ...existing, ...normalizeLeadInput({ ...existing, ...input }), id } as ImportLead;
    const userId = await getCurrentUserId();
    const payload = await normalizedPayload(updated, userId);
    const { error } = await getSupabaseClient().from('leads').update(payload).eq('leads_id', Number(id)).eq('users_id', userId);
    if (error) throw new Error(error.message);
    return updated;
  },

  async remove(id) {
    if (!/^\d+$/.test(id)) return;
    const userId = await getCurrentUserId();
    const { error } = await getSupabaseClient().from('leads').update({ lead_status_id: LEAD_STATUS.arquivado, leads_updated_at: new Date().toISOString() }).eq('leads_id', Number(id)).eq('users_id', userId);
    if (error) throw new Error(error.message);
  },

  async move(id, status) {
    if (!/^\d+$/.test(id)) throw new Error('A alteração pertence apenas à prévia da importação.');
    if (status === 'rejected') throw new Error('A tela de importação não altera diretamente o status de um lead persistido.');
    const lead = (await allLeads()).find((item) => item.id === id);
    if (!lead) throw new Error('Lead não encontrado.');
    return lead;
  },
};
