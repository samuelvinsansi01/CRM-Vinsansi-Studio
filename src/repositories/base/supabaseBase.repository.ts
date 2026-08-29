import { getSupabaseClient } from '../../lib/supabase';
import { normalizeInstagramUsername } from '../../services/instagram/instagram.utils';
import { normalizePhone, normalizeSiteIdentity } from '../../services/import/importValidation';
import type { BaseFilters, BaseFinalStatusId, BaseLead, BaseSummary, FinalLeadIdentities } from '../../services/base/types';
import { getCurrentUserId } from '../supabase.helpers';
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
    return finalIdentities(await all());
  },
};
