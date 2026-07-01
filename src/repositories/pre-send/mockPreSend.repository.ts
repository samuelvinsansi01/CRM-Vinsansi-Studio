import type { PreSendRepository } from './preSend.repository';
import type { PreSendChannel, PreSendDayCard, PreSendFilters, PreSendLead, PreSendQueueFilter, PreSendSummary } from '../../services/pre-send/types';
import type { CreatePreSendLeadInput } from '../../services/pre-send/types';
import { normalizeBrazilState } from '../../services/geo/brazilState';
import { isStatusGroup } from '../../services/status/status.mapper';

let dayCards: PreSendDayCard[] = [];
let leads: PreSendLead[] = [];

const delay = async () => new Promise((resolve) => setTimeout(resolve, 120));

function matchesQueueFilter(lead: PreSendLead, filter?: PreSendQueueFilter) {
  if (!filter || filter === 'Geral') return true;
  if (filter === 'WhatsApp') return lead.destination === 'WhatsApp';
  return lead.destination === 'Com site' || lead.destination === 'Agregadores';
}

function refreshDayCounters() {
  dayCards = dayCards.map((day) => ({
    ...day,
    queued: leads.filter((lead) => !isStatusGroup(lead.status, 'deleted') && lead.dayId === day.id && (isStatusGroup(lead.status, 'review') || isStatusGroup(lead.status, 'approved') || isStatusGroup(lead.status, 'queued'))).length,
  }));
}

function createId() {
  return `pre-send-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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

export const mockPreSendRepository: PreSendRepository = {
  async listDayCards() {
    await delay();
    refreshDayCounters();
    return [...dayCards];
  },

  async summary(): Promise<PreSendSummary> {
    await delay();
    const validLeads = leads.filter((lead) => !isStatusGroup(lead.status, 'deleted') && !isStatusGroup(lead.status, 'archived') && !isStatusGroup(lead.status, 'sent'));
    return {
      whatsapp: validLeads.filter((lead) => lead.channel === 'WhatsApp' && isStatusGroup(lead.status, 'approved')).length,
      instagram: validLeads.filter((lead) => lead.channel === 'Instagram' && isStatusGroup(lead.status, 'approved')).length,
      queued: validLeads.filter((lead) => isStatusGroup(lead.status, 'queued')).length,
      total: validLeads.length,
    };
  },

  async listProfiles(channel: PreSendChannel) {
    await delay();
    return Array.from(new Set(leads.filter((lead) => lead.channel === channel && !isStatusGroup(lead.status, 'deleted') && !isStatusGroup(lead.status, 'archived') && !isStatusGroup(lead.status, 'sent')).map((lead) => lead.profile)));
  },

  async listLeads(filters: PreSendFilters) {
    await delay();

    return leads.map(normalizeLeadState).filter((lead) => {
      const matchesChannel = lead.channel === filters.channel;
      const matchesDay = !filters.dayId || lead.dayId === filters.dayId;
      const matchesProfile = !filters.profile || lead.profile === filters.profile;
      const matchesFilter = matchesQueueFilter(lead, filters.queueFilter);
      return matchesChannel && matchesDay && matchesProfile && matchesFilter && !isStatusGroup(lead.status, 'deleted') && !isStatusGroup(lead.status, 'archived') && !isStatusGroup(lead.status, 'sent');
    });
  },

  async addLeads(inputLeads: CreatePreSendLeadInput[]) {
    await delay();
    const existingKeys = new Set(leads.map(leadKey).filter(Boolean));
    const created: PreSendLead[] = [];

    for (const input of inputLeads) {
      const key = leadKey(input);
      if (key && existingKeys.has(key)) continue;
      const lead: PreSendLead = normalizeLeadState({ id: createId(), ...input });
      leads.push(lead);
      created.push(lead);
      if (key) existingKeys.add(key);
    }

    refreshDayCounters();
    return created;
  },

  async moveToQueue(ids: string[]) {
    await delay();
    leads = leads.map((lead) => (ids.includes(lead.id) && isStatusGroup(lead.status, 'approved') ? { ...lead, status: 'queued' } : lead));
    refreshDayCounters();
  },

  async markSent(ids: string[]) {
    await delay();
    leads = leads.map((lead) => (ids.includes(lead.id) ? { ...lead, status: 'sent' } : lead));
    refreshDayCounters();
  },

  async validateLead(id: string) {
    await delay();
    leads = leads.map((lead) => (lead.id === id ? { ...lead, status: 'approved' } : lead));
  },

  async archiveLead(id: string) {
    await delay();
    leads = leads.map((lead) => (lead.id === id ? { ...lead, status: 'archived' } : lead));
    refreshDayCounters();
  },

  async updateLead(id: string, input: Partial<PreSendLead>) {
    await delay();
    leads = leads.map((lead) => (lead.id === id ? normalizeLeadState({ ...lead, ...input }) : lead));
    refreshDayCounters();
  },
};
