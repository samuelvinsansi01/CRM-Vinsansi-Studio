import { getSupabaseClient } from '../../lib/supabase';
import { normalizeInstagramUsername } from '../../services/instagram/instagram.utils';
import { normalizePhone, normalizeSiteIdentity } from '../../services/import/importValidation';
import type { BaseFilters, BaseFinalStatusId, BaseLead, BasePage, BaseSummary, FinalLeadIdentities } from '../../services/base/types';
import { getCurrentUserId } from '../supabase.helpers';
import { normalizePageRequest, type PageRequest } from '../../services/pagination/types';
import type { BaseRepository } from './base.repository';

type Row = Record<string, unknown>;
type SentInfo = { sentAt: string; channelId: number | null };

const FINAL_STATUS_IDS: BaseFinalStatusId[] = [3, 5, 6, 7];
const LEADS_SELECT = `
  leads_id,users_id,branches_id,states_id,cities_id,channels_id,lead_status_id,
  leads_name,leads_phone,leads_whatsapp,leads_instagram,leads_website,leads_maps,
  leads_created_at,leads_updated_at,
  branches:branches_id(branches_name),
  states:states_id(states_name,states_code),
  cities:cities_id(cities_name),
  channels:channels_id(channels_name)
`;

function normalize(value: unknown) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function one(value: unknown): Row {
  return Array.isArray(value) ? ((value[0] as Row | undefined) ?? {}) : ((value as Row | null) ?? {});
}

function statusName(id: BaseFinalStatusId): BaseLead['status'] {
  return ({ 3: 'sem_contato', 5: 'enviado', 6: 'invalido', 7: 'duplicado' } as const)[id];
}

function originFromChannel(value: unknown): BaseLead['origin'] {
  const channel = normalize(value).replace(/[_-]+/g, ' ');
  if (channel === 'instagram') return 'Instagram';
  if (channel === 'whatsapp') return 'WhatsApp';
  return 'Sem canal';
}

function chunks<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

async function latestSentByLead(userId: string, leadIds: number[]) {
  const result = new Map<string, SentInfo>();
  for (const ids of chunks(leadIds, 500)) {
    if (!ids.length) continue;
    const response = await getSupabaseClient()
      .from('sents')
      .select('sents_id,leads_id,channels_id,sents_sent_at')
      .eq('users_id', userId)
      .in('leads_id', ids)
      .not('sents_sent_at', 'is', null)
      .order('sents_sent_at', { ascending: false });
    if (response.error) throw new Error(`Não foi possível carregar os envios da Base Permanente: ${response.error.message}`);
    for (const row of (response.data ?? []) as Row[]) {
      const leadId = String(row.leads_id ?? '');
      if (!leadId || result.has(leadId)) continue;
      result.set(leadId, {
        sentAt: String(row.sents_sent_at ?? ''),
        channelId: row.channels_id == null ? null : Number(row.channels_id),
      });
    }
  }
  return result;
}


function pageLead(value: Row): BaseLead {
  const statusId = Number(value.status_id) as BaseFinalStatusId;
  const origin = String(value.origin ?? 'Sem canal') as BaseLead['origin'];
  const phone = String(value.phone ?? '').trim();
  const site = String(value.site ?? '').trim();
  const instagram = String(value.instagram ?? '').trim();
  return {
    id: String(value.id ?? ''),
    canonicalId: String(value.id ?? ''),
    company: String(value.company ?? ''),
    branch: String(value.branch ?? ''),
    branch_id: String(value.branch_id ?? ''),
    state: String(value.state ?? ''),
    city: String(value.city ?? ''),
    phone,
    normalizedPhone: normalizePhone(phone),
    site,
    normalizedSite: normalizeSiteIdentity(site),
    instagram,
    normalizedInstagram: normalizeInstagramUsername(instagram),
    mapsUrl: String(value.maps_url ?? '').trim(),
    origin,
    destination: origin,
    status: statusName(statusId),
    statusId,
    finalizedAt: String(value.finalized_at ?? ''),
    totalLeads: 1,
    totalDispatches: Number(value.total_dispatches ?? 0),
    lastSentAt: String(value.last_sent_at ?? ''),
    suppressed: true,
  };
}

async function page(filters: BaseFilters = {}, request: PageRequest): Promise<BasePage> {
  const normalized = normalizePageRequest(request);
  const { data, error } = await getSupabaseClient().rpc('list_base_permanent_page_r59', {
    p_page: normalized.page,
    p_page_size: normalized.pageSize,
    p_search: filters.search?.trim() || null,
    p_origin: filters.origin && filters.origin !== 'Todos' ? filters.origin : null,
    p_status: filters.status && filters.status !== 'Todos' ? filters.status : null,
  });
  if (error) throw new Error(`Não foi possível carregar a Base Permanente: ${error.message}`);
  const payload = (data && typeof data === 'object' && !Array.isArray(data) ? data : {}) as Row;
  const rawItems = Array.isArray(payload.items) ? payload.items : [];
  const rawSummary = payload.summary && typeof payload.summary === 'object' && !Array.isArray(payload.summary) ? payload.summary as Row : {};
  return {
    items: rawItems.filter((item): item is Row => Boolean(item) && typeof item === 'object' && !Array.isArray(item)).map(pageLead),
    total: Math.max(0, Number(payload.total ?? 0)),
    page: Math.max(1, Number(payload.page ?? normalized.page)),
    pageSize: Math.max(1, Number(payload.pageSize ?? payload.page_size ?? normalized.pageSize)),
    summary: {
      total: Math.max(0, Number(rawSummary.total ?? 0)),
      sent: Math.max(0, Number(rawSummary.sent ?? 0)),
      sentWhatsApp: Math.max(0, Number(rawSummary.sentWhatsApp ?? rawSummary.sent_whatsapp ?? 0)),
      sentInstagram: Math.max(0, Number(rawSummary.sentInstagram ?? rawSummary.sent_instagram ?? 0)),
      noContact: Math.max(0, Number(rawSummary.noContact ?? rawSummary.no_contact ?? 0)),
      invalid: Math.max(0, Number(rawSummary.invalid ?? 0)),
      duplicates: Math.max(0, Number(rawSummary.duplicates ?? 0)),
    },
  };
}

async function all(): Promise<BaseLead[]> {
  const userId = await getCurrentUserId();
  const response = await getSupabaseClient()
    .from('leads')
    .select(LEADS_SELECT)
    .eq('users_id', userId)
    .in('lead_status_id', FINAL_STATUS_IDS)
    .order('leads_updated_at', { ascending: false, nullsFirst: false })
    .order('leads_id', { ascending: false });
  if (response.error) throw new Error(`Não foi possível carregar a Base Permanente: ${response.error.message}`);

  const rows = (response.data ?? []) as unknown as Row[];
  const sentByLead = await latestSentByLead(
    userId,
    rows.filter((row) => Number(row.lead_status_id) === 5).map((row) => Number(row.leads_id)).filter(Number.isSafeInteger),
  );

  return rows.map((row): BaseLead => {
    const branch = one(row.branches);
    const state = one(row.states);
    const city = one(row.cities);
    const channel = one(row.channels);
    const statusId = Number(row.lead_status_id) as BaseFinalStatusId;
    const sent = sentByLead.get(String(row.leads_id));
    // O canal do próprio lead é a fonte canônica. Para envios legados sem canal,
    // usamos somente o channel_id do envio quando ele realmente existe.
    let origin = originFromChannel(channel.channels_name);
    if (origin === 'Sem canal' && sent?.channelId) {
      origin = sent.channelId === 1 ? 'WhatsApp' : sent.channelId === 2 ? 'Instagram' : 'Sem canal';
    }
    const phone = String(row.leads_whatsapp ?? row.leads_phone ?? '').trim();
    const instagram = String(row.leads_instagram ?? '').trim();
    const site = String(row.leads_website ?? '').trim();
    const updatedAt = String(row.leads_updated_at ?? row.leads_created_at ?? '');
    return {
      id: String(row.leads_id),
      canonicalId: String(row.leads_id),
      company: String(row.leads_name ?? ''),
      branch: String(branch.branches_name ?? ''),
      branch_id: String(row.branches_id ?? ''),
      state: String(state.states_code ?? state.states_name ?? ''),
      city: String(city.cities_name ?? ''),
      phone,
      normalizedPhone: normalizePhone(phone),
      site,
      normalizedSite: normalizeSiteIdentity(site),
      instagram,
      normalizedInstagram: normalizeInstagramUsername(instagram),
      mapsUrl: String(row.leads_maps ?? '').trim(),
      origin,
      destination: origin,
      status: statusName(statusId),
      statusId,
      finalizedAt: updatedAt,
      totalLeads: 1,
      totalDispatches: sent ? 1 : 0,
      lastSentAt: sent?.sentAt ?? (statusId === 5 ? updatedAt : ''),
      suppressed: true,
    };
  });
}

function filtered(records: BaseLead[], filters: BaseFilters = {}) {
  const query = normalize(filters.search);
  return records.filter((lead) => (
    (!query || normalize(`${lead.company} ${lead.phone} ${lead.instagram} ${lead.site} ${lead.city} ${lead.state} ${lead.branch}`).includes(query))
    && (!filters.origin || filters.origin === 'Todos' || lead.origin === filters.origin)
    && (!filters.branch || filters.branch === 'Todos' || lead.branch === filters.branch)
    && (!filters.state || filters.state === 'Todos' || normalize(lead.state) === normalize(filters.state))
    && (!filters.city || filters.city === 'Todos' || lead.city === filters.city)
    && (!filters.destination || filters.destination === 'Todos' || lead.destination === filters.destination)
    && (!filters.status || filters.status === 'Todos' || lead.status === filters.status)
  ));
}

function summary(records: BaseLead[]): BaseSummary {
  const sent = records.filter((record) => record.statusId === 5);
  return {
    total: records.length,
    sent: sent.length,
    sentWhatsApp: sent.filter((record) => record.origin === 'WhatsApp').length,
    sentInstagram: sent.filter((record) => record.origin === 'Instagram').length,
    noContact: records.filter((record) => record.statusId === 3).length,
    invalid: records.filter((record) => record.statusId === 6).length,
    duplicates: records.filter((record) => record.statusId === 7).length,
  };
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function finalIdentities(records: BaseLead[]): FinalLeadIdentities {
  return {
    phones: unique(records.map((lead) => normalizePhone(lead.normalizedPhone || lead.phone)).filter(Boolean)),
    sites: unique(records.map((lead) => normalizeSiteIdentity(lead.normalizedSite || lead.site)).filter(Boolean)),
    instagrams: unique(records.map((lead) => normalizeInstagramUsername(lead.normalizedInstagram || lead.instagram)).filter(Boolean)),
    mapsUrls: unique(records.map((lead) => String(lead.mapsUrl ?? '').trim().toLowerCase()).filter(Boolean)),
  };
}

export const supabaseBaseRepository: BaseRepository = {
  page,
  async list(filters = {}) {
    return filtered(await all(), filters);
  },
  async summary() {
    return summary(await all());
  },
  async options() {
    const records = await all();
    const values = (items: string[]) => ['Todos', ...unique(items).sort((left, right) => left.localeCompare(right, 'pt-BR'))];
    return {
      origins: values(records.map((lead) => lead.origin)),
      branches: values(records.map((lead) => lead.branch)),
      states: values(records.map((lead) => lead.state)),
      cities: values(records.map((lead) => lead.city)),
      destinations: values(records.map((lead) => lead.destination)),
      statuses: values(records.map((lead) => lead.status)),
    };
  },
  async listFinalIdentities() {
    const userId = await getCurrentUserId();
    const pageSize = 1000;
    const phones: string[] = [];
    const sites: string[] = [];
    const instagrams: string[] = [];
    const mapsUrls: string[] = [];
    for (let from = 0; ; from += pageSize) {
      const response = await getSupabaseClient()
        .from('leads')
        .select('leads_phone,leads_whatsapp,leads_website,leads_instagram,leads_maps')
        .eq('users_id', userId)
        .in('lead_status_id', FINAL_STATUS_IDS)
        .range(from, from + pageSize - 1);
      if (response.error) throw new Error(`Não foi possível carregar as identidades finais: ${response.error.message}`);
      const rows = (response.data ?? []) as Row[];
      for (const row of rows) {
        const phone = normalizePhone(String(row.leads_whatsapp ?? row.leads_phone ?? '')); if (phone) phones.push(phone);
        const site = normalizeSiteIdentity(String(row.leads_website ?? '')); if (site) sites.push(site);
        const instagram = normalizeInstagramUsername(String(row.leads_instagram ?? '')); if (instagram) instagrams.push(instagram);
        const maps = String(row.leads_maps ?? '').trim().toLowerCase(); if (maps) mapsUrls.push(maps);
      }
      if (rows.length < pageSize) break;
    }
    return { phones: unique(phones), sites: unique(sites), instagrams: unique(instagrams), mapsUrls: unique(mapsUrls) };
  },
};
