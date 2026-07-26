import { getSupabaseClient } from '../../lib/supabase';
import { mapLead } from '../../mappers/lead.mapper';
import type {
  BaseFilters,
  BaseLead,
  BaseLeadStatus,
  BaseSummary,
  CreateBaseLeadInput,
  SentContactIdentities,
  UpdateBaseLeadInput,
} from '../../services/base/types';
import { LEAD_STATUS, type LeadDatabaseRow } from '../../types/lead.types';
import { getCurrentUserId } from '../supabase.helpers';
import type { BaseRepository } from './base.repository';

const LEADS_SELECT = `
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

function normalizeText(value: unknown) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function filterRecords(records: BaseLead[], filters: BaseFilters = {}) {
  const query = normalizeText(filters.search);
  return records.filter((lead) => {
    const searchable = normalizeText([
      lead.company,
      lead.phone,
      lead.instagram,
      lead.site,
      lead.city,
      lead.state,
      lead.branch,
    ].join(' '));

    return (!query || searchable.includes(query))
      && (!filters.origin || filters.origin === 'Todos' || lead.origin === filters.origin)
      && (!filters.branch || filters.branch === 'Todos' || lead.branch === filters.branch)
      && (!filters.state || filters.state === 'Todos' || normalizeText(lead.state) === normalizeText(filters.state))
      && (!filters.city || filters.city === 'Todos' || lead.city === filters.city)
      && (!filters.destination || filters.destination === 'Todos' || lead.destination === filters.destination)
      && (!filters.status || filters.status === 'Todos' || lead.status === filters.status);
  });
}

function calculateSummary(records: BaseLead[]): BaseSummary {
  const sent = records.filter((lead) => lead.status === 'enviado');
  return {
    total: records.length,
    sent: sent.length,
    sentWhatsApp: sent.filter((lead) => lead.origin === 'WhatsApp').length,
    sentInstagram: sent.filter((lead) => lead.origin === 'Instagram' || lead.destination === 'Instagram').length,
    archived: records.filter((lead) => lead.status === 'arquivado').length,
    invalid: records.filter((lead) => lead.status === 'invalido' || lead.status === 'duplicado').length,
    errors: 0,
  };
}

async function listAll(): Promise<BaseLead[]> {
  const userId = await getCurrentUserId();
  const pageSize = 1000;
  const rows: LeadDatabaseRow[] = [];

  // PostgREST limita cada resposta. A paginação garante que a Base Permanente
  // sempre inclua todos os leads atuais e também os inseridos futuramente.
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await getSupabaseClient()
      .from('leads')
      .select(LEADS_SELECT)
      .eq('users_id', userId)
      .in('lead_status_id', [5, 6, 7, 8])
      .order('leads_created_at', { ascending: false })
      .order('leads_id', { ascending: false })
      .range(from, from + pageSize - 1);

    if (error) throw new Error(`Não foi possível carregar os leads: ${error.message}`);

    const page = (data ?? []) as unknown as LeadDatabaseRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }

  return rows.map(mapLead);
}

async function resolveLookupId(table: string, idColumn: string, nameColumn: string, value: string): Promise<number | null> {
  const normalized = normalizeText(value);
  if (!normalized) return null;

  type LookupQueryResult = {
    data: Record<string, unknown>[] | null;
    error: { message: string } | null;
  };

  const lookupQuery = getSupabaseClient().from(table) as unknown as {
    select: (columns: string) => PromiseLike<LookupQueryResult>;
  };

  const { data, error } = await lookupQuery.select(`${idColumn},${nameColumn}`);
  if (error) throw new Error(error.message);

  const row = (data ?? []).find((item) => normalizeText(item[nameColumn]) === normalized);
  return row ? Number(row[idColumn]) : null;
}

function statusId(status: BaseLeadStatus) {
  return LEAD_STATUS[status];
}

async function updateLeadRow(id: string, input: UpdateBaseLeadInput): Promise<BaseLead> {
  const userId = await getCurrentUserId();
  const payload: Record<string, unknown> = { leads_updated_at: new Date().toISOString() };

  if (input.company !== undefined) payload.leads_name = input.company.trim();
  if (input.phone !== undefined) payload.leads_phone = input.phone.trim() || null;
  if (input.instagram !== undefined) payload.leads_instagram = input.instagram.trim() || null;
  if (input.site !== undefined) payload.leads_website = input.site.trim() || null;
  if (input.mapsUrl !== undefined) payload.leads_maps = input.mapsUrl.trim() || null;
  if (input.status !== undefined) payload.lead_status_id = statusId(input.status);

  if (input.branch_id !== undefined && input.branch_id) {
    payload.branches_id = Number(input.branch_id);
  } else if (input.branch !== undefined) {
    const branchId = await resolveLookupId('branches', 'branches_id', 'branches_name', input.branch);
    if (!branchId) throw new Error('O ramo informado não existe na tabela branches.');
    payload.branches_id = branchId;
  }

  if (input.state !== undefined) {
    const stateId = await resolveLookupId('states', 'states_id', 'states_name', input.state)
      ?? await resolveLookupId('states', 'states_id', 'states_code', input.state);
    payload.states_id = stateId;
  }

  if (input.city !== undefined) {
    payload.cities_id = await resolveLookupId('cities', 'cities_id', 'cities_name', input.city);
  }

  const { data, error } = await getSupabaseClient()
    .from('leads')
    .update(payload)
    .eq('leads_id', Number(id))
    .eq('users_id', userId)
    .select(LEADS_SELECT)
    .single();

  if (error) throw new Error(`Não foi possível atualizar o lead: ${error.message}`);
  return mapLead(data as unknown as LeadDatabaseRow);
}

export const supabaseBaseRepository: BaseRepository = {
  async list(filters = {}) {
    return filterRecords(await listAll(), filters);
  },

  async summary() {
    return calculateSummary(await listAll());
  },

  async options() {
    const records = await listAll();
    const unique = (values: string[]) => ['Todos', ...Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR'))];
    return {
      origins: unique(records.map((lead) => lead.origin)),
      branches: unique(records.map((lead) => lead.branch)),
      states: unique(records.map((lead) => lead.state)),
      cities: unique(records.map((lead) => lead.city)),
      destinations: unique(records.map((lead) => lead.destination)),
      statuses: unique(records.map((lead) => lead.status)),
    };
  },

  async listSentIdentities(): Promise<SentContactIdentities> {
    const records = (await listAll()).filter((lead) => lead.status === 'enviado');
    return {
      phones: records.map((lead) => lead.normalizedPhone ?? '').filter(Boolean),
      sites: records.map((lead) => lead.normalizedSite ?? '').filter(Boolean),
      instagrams: records.map((lead) => lead.normalizedInstagram ?? '').filter(Boolean),
      mapsUrls: records.map((lead) => lead.mapsUrl ?? '').filter(Boolean),
    };
  },

  async upsertSent(input: CreateBaseLeadInput) {
    const userId = await getCurrentUserId();
    const branchId = input.branch_id
      ? Number(input.branch_id)
      : await resolveLookupId('branches', 'branches_id', 'branches_name', input.branch);

    if (!branchId) throw new Error('Selecione um ramo existente antes de criar o lead.');

    const stateId = input.state
      ? await resolveLookupId('states', 'states_id', 'states_name', input.state)
        ?? await resolveLookupId('states', 'states_id', 'states_code', input.state)
      : null;
    const cityId = input.city
      ? await resolveLookupId('cities', 'cities_id', 'cities_name', input.city)
      : null;

    const hasInstagram = Boolean(input.instagram?.trim());
    const hasWebsite = Boolean(input.site?.trim());
    const isAggregator = input.destination === 'Agregador';
    const contactSourceId = hasInstagram ? 4 : isAggregator ? 3 : hasWebsite ? 2 : 1;
    const channelId = hasInstagram || input.destination === 'Instagram' ? 2 : 1;

    const payload = {
      users_id: Number(userId),
      branches_id: branchId,
      countries_id: 1,
      states_id: stateId,
      cities_id: cityId,
      channels_id: channelId,
      lead_status_id: statusId(input.status),
      contact_sources_id: contactSourceId,
      leads_name: input.company.trim(),
      leads_phone: input.phone.trim() || null,
      leads_instagram: input.instagram?.trim() || null,
      leads_website: input.site.trim() || null,
      leads_maps: input.mapsUrl?.trim() || null,
      leads_categories: input.branch ? [input.branch] : [],
      leads_origin: 'manual',
    };

    const { data, error } = await getSupabaseClient()
      .from('leads')
      .insert(payload)
      .select(LEADS_SELECT)
      .single();

    if (error) throw new Error(`Não foi possível criar o lead: ${error.message}`);
    return mapLead(data as unknown as LeadDatabaseRow);
  },

  async update(id, input) {
    return updateLeadRow(id, input);
  },

  async setStatus(id, status) {
    return updateLeadRow(id, { status });
  },

  async archive(id) {
    return updateLeadRow(id, { status: 'arquivado' });
  },


};
