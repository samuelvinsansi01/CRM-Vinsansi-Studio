import { getSupabaseClient } from '../../lib/supabase';
import type { LeadDatabaseRow, LeadStatusId } from '../../types/lead.types';
import { getCurrentUserId } from '../supabase.helpers';
import type { LeadCycleRepository, LeadCycleTransitionPatch } from './leadCycle.repository';

export const LEAD_CYCLE_SELECT = `
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

function numericLeadIds(ids: string[]) {
  const values = Array.from(new Set(ids)).map((id) => Number(id));
  if (values.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    throw new Error('Um ou mais identificadores de lead são inválidos.');
  }
  return values;
}

async function listByStatuses(statusIds: LeadStatusId[], channelId?: number) {
  const userId = await getCurrentUserId();
  const pageSize = 1000;
  const rows: LeadDatabaseRow[] = [];

  for (let from = 0; ; from += pageSize) {
    let query = getSupabaseClient()
      .from('leads')
      .select(LEAD_CYCLE_SELECT)
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

  return rows;
}

async function listByIds(ids: string[]) {
  if (!ids.length) return [];
  const userId = await getCurrentUserId();
  const { data, error } = await getSupabaseClient()
    .from('leads')
    .select(LEAD_CYCLE_SELECT)
    .eq('users_id', userId)
    .in('leads_id', numericLeadIds(ids));

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as LeadDatabaseRow[];
}

async function compareAndSet(id: string, expectedStatus: LeadStatusId, patch: LeadCycleTransitionPatch) {
  const userId = await getCurrentUserId();
  const [numericId] = numericLeadIds([id]);
  const { data, error } = await getSupabaseClient()
    .from('leads')
    .update({ ...patch, leads_updated_at: new Date().toISOString() })
    .eq('leads_id', numericId)
    .eq('users_id', userId)
    .eq('lead_status_id', expectedStatus)
    .select(LEAD_CYCLE_SELECT)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ? data as unknown as LeadDatabaseRow : null;
}

export const supabaseLeadCycleRepository: LeadCycleRepository = {
  listByStatuses,
  listByIds,
  compareAndSet,
};
