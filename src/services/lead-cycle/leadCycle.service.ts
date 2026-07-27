import { getSupabaseClient } from '../../lib/supabase';
import { getCurrentUserId } from '../../repositories/supabase.helpers';
import type { LeadDatabaseRow, LeadStatusId, LeadStatusName } from '../../types/lead.types';
import type { LeadCycleLead, LeadCycleUpdate } from './types';

const LEADS_SELECT = `
  leads_id, users_id, branches_id, countries_id, states_id, cities_id,
  channels_id, lead_status_id, contact_sources_id, apify_import_jobs_id,
  leads_name, leads_phone, leads_instagram, leads_website, leads_maps,
  leads_street, leads_postal_code, leads_categories, leads_score,
  leads_reviews_count, leads_origin, leads_created_at, leads_updated_at,
  branches:branches_id ( branches_id, branches_name ),
  countries:countries_id ( countries_id, countries_name, countries_code ),
  states:states_id ( states_id, states_name, states_code ),
  cities:cities_id ( cities_id, cities_name ),
  channels:channels_id ( channels_id, channels_name ),
  lead_status:lead_status_id ( lead_status_id, lead_status_name ),
  contact_sources:contact_sources_id ( contact_sources_id, contact_sources_name )
`;

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function mapRow(row: LeadDatabaseRow): LeadCycleLead {
  const branch = one(row.branches);
  const state = one(row.states);
  const city = one(row.cities);
  const source = one(row.contact_sources);
  const status = one(row.lead_status);
  const channelId = row.channels_id === 2 ? 2 : 1;

  return {
    id: String(row.leads_id),
    company: row.leads_name,
    branch: branch?.branches_name ?? row.leads_categories?.[0] ?? '',
    state: state?.states_code ?? state?.states_name ?? '',
    city: city?.cities_name ?? '',
    phone: row.leads_phone ?? '',
    instagram: row.leads_instagram ?? '',
    website: row.leads_website ?? '',
    mapsUrl: row.leads_maps ?? '',
    channelId,
    channel: channelId === 2 ? 'Instagram' : 'WhatsApp',
    contactSourceId: row.contact_sources_id,
    contactSource: source?.contact_sources_name ?? '',
    statusId: row.lead_status_id,
    status: (status?.lead_status_name ?? '') as LeadStatusName,
    createdAt: row.leads_created_at,
    updatedAt: row.leads_updated_at ?? row.leads_created_at,
  };
}

async function listByStatuses(statusIds: LeadStatusId[], channelId?: 1 | 2): Promise<LeadCycleLead[]> {
  const userId = await getCurrentUserId();
  const pageSize = 1000;
  const rows: LeadDatabaseRow[] = [];

  for (let from = 0; ; from += pageSize) {
    let query = getSupabaseClient()
      .from('leads')
      .select(LEADS_SELECT)
      .eq('users_id', userId)
      .in('lead_status_id', statusIds)
      .order('leads_created_at', { ascending: false })
      .order('leads_id', { ascending: false })
      .range(from, from + pageSize - 1);

    if (channelId) query = query.eq('channels_id', channelId);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const page = (data ?? []) as unknown as LeadDatabaseRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }

  return rows.map(mapRow);
}

async function update(ids: string[], input: LeadCycleUpdate, expectedStatuses?: LeadStatusId[]) {
  if (!ids.length) return;
  const userId = await getCurrentUserId();
  let query = getSupabaseClient()
    .from('leads')
    .update({ ...input, leads_updated_at: new Date().toISOString() })
    .in('leads_id', ids.map(Number))
    .eq('users_id', userId);
  if (expectedStatuses?.length) query = query.in('lead_status_id', expectedStatuses);
  const { error } = await query;
  if (error) throw new Error(error.message);
}

export const leadCycleService = {
  listImported: () => listByStatuses([1]),
  listValid: () => listByStatuses([2]),
  listPreSend: () => listByStatuses([3], 1),
  listPermanent: () => listByStatuses([5, 6, 7, 8]),
  update,
};
