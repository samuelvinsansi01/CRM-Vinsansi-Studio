import { FINAL_LEAD_STATUS_IDS, LEAD_STATUS } from '../../services/status/leadStatus';
import { getSupabaseClient } from '../../lib/supabase';
import { mapLead } from '../../mappers/lead.mapper';
import type {
  BaseFilters,
  BaseFinalStatusId,
  BaseLead,
  BaseSummary,
  FinalLeadIdentities,
} from '../../services/base/types';
import type { LeadDatabaseRow } from '../../types/lead.types';
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
  const sent = records.filter((lead) => lead.statusId === 5);
  return {
    total: records.length,
    sent: sent.length,
    sentWhatsApp: sent.filter((lead) => lead.origin === 'WhatsApp').length,
    sentInstagram: sent.filter((lead) => lead.origin === 'Instagram').length,
    archived: records.filter((lead) => lead.statusId === 8).length,
    invalid: records.filter((lead) => lead.statusId === 6).length,
    duplicates: records.filter((lead) => lead.statusId === 7).length,
  };
}

async function listRowsByStatuses(statuses: readonly number[]): Promise<LeadDatabaseRow[]> {
  const userId = await getCurrentUserId();
  const pageSize = 1000;
  const rows: LeadDatabaseRow[] = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await getSupabaseClient()
      .from('leads')
      .select(LEADS_SELECT)
      .eq('users_id', userId)
      .in('lead_status_id', [...statuses])
      .order('leads_updated_at', { ascending: false, nullsFirst: false })
      .order('leads_id', { ascending: false })
      .range(from, from + pageSize - 1);

    if (error) throw new Error(`Não foi possível carregar a Base Permanente: ${error.message}`);
    const page = (data ?? []) as unknown as LeadDatabaseRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }

  return rows.filter((row) => FINAL_LEAD_STATUS_IDS.includes(Number(row.lead_status_id) as (typeof FINAL_LEAD_STATUS_IDS)[number]));
}

async function listAll(): Promise<BaseLead[]> {
  return (await listRowsByStatuses(FINAL_LEAD_STATUS_IDS)).map(mapLead);
}

async function listByIds(ids: string[]): Promise<BaseLead[]> {
  const numericIds = Array.from(new Set(ids)).map(Number);
  if (!numericIds.length) return [];
  if (numericIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    throw new Error('Um ou mais identificadores de lead são inválidos.');
  }

  const userId = await getCurrentUserId();
  const { data, error } = await getSupabaseClient()
    .from('leads')
    .select(LEADS_SELECT)
    .eq('users_id', userId)
    .in('leads_id', numericIds)
    .in('lead_status_id', [...FINAL_LEAD_STATUS_IDS]);

  if (error) throw new Error(`Não foi possível carregar os leads finalizados: ${error.message}`);
  return ((data ?? []) as unknown as LeadDatabaseRow[]).map(mapLead);
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

  async listFinalIdentities(): Promise<FinalLeadIdentities> {
    const response = await getSupabaseClient()
      .from('contact_suppressions')
      .select('identity_type,identity_value,expires_at')
      .eq('is_active', true);
    if (response.error) throw new Error(`Não foi possível carregar as supressões de contato: ${response.error.message}`);
    const active = (response.data ?? []).filter((row) => !row.expires_at || new Date(String(row.expires_at)).getTime() > Date.now());
    const values = (type: string) => Array.from(new Set(active.filter((row) => row.identity_type === type).map((row) => String(row.identity_value)).filter(Boolean)));
    return { phones: values('phone'), sites: values('domain'), instagrams: values('instagram'), mapsUrls: values('maps') };
  },

  listByIds,

  async compareAndArchive(id: string, expectedStatus: Exclude<BaseFinalStatusId, 8>) {
    const numericId = Number(id);
    if (!Number.isSafeInteger(numericId) || numericId <= 0) throw new Error('Identificador de lead inválido.');
    const userId = await getCurrentUserId();
    const { data, error } = await getSupabaseClient()
      .from('leads')
      .update({ lead_status_id: LEAD_STATUS.ARCHIVED, leads_updated_at: new Date().toISOString() })
      .eq('leads_id', numericId)
      .eq('users_id', userId)
      .eq('lead_status_id', expectedStatus)
      .select(LEADS_SELECT)
      .maybeSingle();

    if (error) throw new Error(`Não foi possível arquivar o lead: ${error.message}`);
    return data ? mapLead(data as unknown as LeadDatabaseRow) : null;
  },
};
