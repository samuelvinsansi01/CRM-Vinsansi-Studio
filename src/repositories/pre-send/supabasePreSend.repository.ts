import { getSupabaseClient, getSupabaseConfig } from '../../lib/supabase';
import { branchIdOrNull } from '../../services/config/branchIdentity';
import { normalizeBrazilState } from '../../services/geo/brazilState';
import type { CreatePreSendLeadInput, PreSendChannel, PreSendDayCard, PreSendFilters, PreSendLead, PreSendQueueFilter, PreSendSummary } from '../../services/pre-send/types';
import { isStatusGroup, normalizePreSendStatus } from '../../services/status/status.mapper';
import { createId, getCurrentUserId, insertJsonRecord, updateJsonRecord } from '../supabase.helpers';
import type { PreSendRepository } from './preSend.repository';

function table() {
  return getSupabaseConfig().tables.preSendLeads;
}

function matchesQueueFilter(lead: PreSendLead, filter?: PreSendQueueFilter) {
  if (!filter || filter === 'Geral') return true;
  if (filter === 'WhatsApp') return lead.destination === 'WhatsApp';
  return lead.destination === 'Com site' || lead.destination === 'Agregadores';
}

function leadKey(lead: Pick<PreSendLead, 'sourceImportId' | 'phone' | 'instagram'>) {
  return lead.sourceImportId || lead.phone || lead.instagram || '';
}

function normalizeLeadState<T extends { state?: string }>(lead: T): T {
  return {
    ...lead,
    state: normalizeBrazilState(lead.state),
  };
}

function leadFlatExtra(lead: PreSendLead) {
  return {
    status: lead.status,
    channel: lead.channel,
    branch_id: branchIdOrNull(lead.branch_id),
    branch_name: lead.branch,
  };
}

async function allLeads() {
  const { data, error } = await getSupabaseClient().from(table()).select('id,data,status,active,kind,channel,created_at,updated_at');
  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => {
    const lead = (row.data ?? {}) as PreSendLead;
    return {
    ...lead,
    id: lead.id ?? String(row.id),
    state: normalizeBrazilState(lead.state),
    status: normalizePreSendStatus(row.status ?? lead.status),
    };
  }).filter((lead) => !isStatusGroup(lead.status, 'deleted'));
}

export const supabasePreSendRepository: PreSendRepository = {
  async listDayCards(): Promise<PreSendDayCard[]> {
    const leads = await allLeads();
    const grouped = new Map<string, PreSendDayCard>();
    for (const lead of leads) {
      if (isStatusGroup(lead.status, 'sent') || isStatusGroup(lead.status, 'archived')) continue;
      const current = grouped.get(lead.dayId) ?? { id: lead.dayId, channel: lead.channel, label: lead.dayId.split('-').slice(1).join(' ') || lead.dayId, queued: 0, limit: 0 };
      if (isStatusGroup(lead.status, 'review') || isStatusGroup(lead.status, 'approved') || isStatusGroup(lead.status, 'queued')) current.queued += 1;
      grouped.set(lead.dayId, current);
    }
    return Array.from(grouped.values());
  },

  async summary(): Promise<PreSendSummary> {
    const validLeads = (await allLeads()).filter((lead) => !isStatusGroup(lead.status, 'archived') && !isStatusGroup(lead.status, 'sent'));
    return {
      whatsapp: validLeads.filter((lead) => lead.channel === 'WhatsApp' && isStatusGroup(lead.status, 'approved')).length,
      instagram: validLeads.filter((lead) => lead.channel === 'Instagram' && isStatusGroup(lead.status, 'approved')).length,
      queued: validLeads.filter((lead) => isStatusGroup(lead.status, 'queued')).length,
      total: validLeads.length,
    };
  },

  async listProfiles(channel: PreSendChannel) {
    return Array.from(new Set((await allLeads()).filter((lead) => lead.channel === channel && !isStatusGroup(lead.status, 'archived') && !isStatusGroup(lead.status, 'sent')).map((lead) => lead.profile)));
  },

  async listLeads(filters: PreSendFilters) {
    return (await allLeads()).filter((lead) => {
      const matchesChannel = lead.channel === filters.channel;
      const matchesDay = !filters.dayId || lead.dayId === filters.dayId;
      const matchesProfile = !filters.profile || lead.profile === filters.profile;
      const matchesFilter = matchesQueueFilter(lead, filters.queueFilter);
      return matchesChannel && matchesDay && matchesProfile && matchesFilter && !isStatusGroup(lead.status, 'archived') && !isStatusGroup(lead.status, 'sent');
    });
  },

  async addLeads(inputLeads: CreatePreSendLeadInput[]) {
    const existing = await allLeads();
    const blockingExisting = existing.filter((lead) =>
      !isStatusGroup(lead.status, 'archived') &&
      !isStatusGroup(lead.status, 'sent') &&
      !isStatusGroup(lead.status, 'deleted') &&
      !isStatusGroup(lead.status, 'invalid'),
    );
    const existingKeys = new Set(blockingExisting.map(leadKey).filter(Boolean));
    const created: PreSendLead[] = [];
    const userId = await getCurrentUserId();
    for (const input of inputLeads) {
      const key = leadKey(input);
      if (key && existingKeys.has(key)) continue;
      const lead: PreSendLead = normalizeLeadState({ id: createId('pre-send'), ...input });
      await insertJsonRecord(table(), lead, { ...leadFlatExtra(lead), user_id: userId });
      created.push(lead);
      if (key) existingKeys.add(key);
    }
    return created;
  },

  async moveToQueue(ids: string[]) {
    await Promise.all(ids.map(async (id) => {
      const lead = (await allLeads()).find((item) => item.id === id);
      const canQueue = lead && (
        isStatusGroup(lead.status, 'approved') ||
        (lead.channel === 'Instagram' && isStatusGroup(lead.status, 'review') && Boolean(lead.send_instagram) && !lead.instagramPendingLink)
      );
      if (lead && canQueue) await updateJsonRecord(table(), { ...lead, status: 'queued' }, { ...leadFlatExtra({ ...lead, status: 'queued' }) });
    }));
  },

  async markSent(ids: string[]) {
    await Promise.all(ids.map(async (id) => {
      const lead = (await allLeads()).find((item) => item.id === id);
      if (lead) await updateJsonRecord(table(), { ...lead, status: 'sent' }, { ...leadFlatExtra({ ...lead, status: 'sent' }) });
    }));
  },

  async validateLead(id: string) {
    const lead = (await allLeads()).find((item) => item.id === id);
    if (lead) await updateJsonRecord(table(), { ...lead, status: 'approved' }, { ...leadFlatExtra({ ...lead, status: 'approved' }) });
  },

  async archiveLead(id: string) {
    const lead = (await allLeads()).find((item) => item.id === id);
    if (lead) await updateJsonRecord(table(), { ...lead, status: 'archived' }, { ...leadFlatExtra({ ...lead, status: 'archived' }) });
  },

  async updateLead(id: string, input: Partial<PreSendLead>) {
    const lead = (await allLeads()).find((item) => item.id === id);
    if (!lead) throw new Error('Lead nao encontrado no pre-envio.');
    const updated = normalizeLeadState({ ...lead, ...input });
    await updateJsonRecord(table(), updated, leadFlatExtra(updated));
  },
};
