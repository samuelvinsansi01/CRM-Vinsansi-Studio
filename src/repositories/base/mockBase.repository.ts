import type { BaseRepository } from './base.repository';
import type { BaseFilters, BaseLead, BaseSummary } from '../../services/base/types';

let records: BaseLead[] = [];
const delay = async () => new Promise((resolve) => setTimeout(resolve, 80));

function normalize(value: unknown) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

function filtered(filters: BaseFilters = {}) {
  const search = normalize(filters.search);
  return records.filter((lead) => {
    const haystack = normalize(`${lead.company} ${lead.branch} ${lead.state} ${lead.city} ${lead.phone} ${lead.instagram ?? ''} ${lead.site}`);
    return (!search || haystack.includes(search))
      && (!filters.origin || filters.origin === 'Todos' || lead.origin === filters.origin)
      && (!filters.branch || filters.branch === 'Todos' || lead.branch === filters.branch)
      && (!filters.state || filters.state === 'Todos' || normalize(lead.state) === normalize(filters.state))
      && (!filters.city || filters.city === 'Todos' || lead.city === filters.city)
      && (!filters.destination || filters.destination === 'Todos' || lead.destination === filters.destination)
      && (!filters.status || filters.status === 'Todos' || lead.status === filters.status);
  });
}

function summary(list: BaseLead[]): BaseSummary {
  const sent = list.filter((lead) => lead.statusId === 5);
  return {
    total: list.length,
    sent: sent.length,
    sentWhatsApp: sent.filter((lead) => lead.origin === 'WhatsApp').length,
    sentInstagram: sent.filter((lead) => lead.origin === 'Instagram').length,
    archived: list.filter((lead) => lead.statusId === 8).length,
    invalid: list.filter((lead) => lead.statusId === 6).length,
    duplicates: list.filter((lead) => lead.statusId === 7).length,
  };
}

export const mockBaseRepository: BaseRepository = {
  async list(filters = {}) { await delay(); return filtered(filters); },
  async summary() { await delay(); return summary(records); },
  async options() {
    await delay();
    const unique = (values: string[]) => ['Todos', ...Array.from(new Set(values.filter(Boolean)))];
    return {
      origins: unique(records.map((lead) => lead.origin)),
      branches: unique(records.map((lead) => lead.branch)),
      states: unique(records.map((lead) => lead.state)),
      cities: unique(records.map((lead) => lead.city)),
      destinations: unique(records.map((lead) => lead.destination)),
      statuses: unique(records.map((lead) => lead.status)),
    };
  },
  async listFinalIdentities() {
    return {
      phones: records.map((lead) => lead.normalizedPhone ?? '').filter(Boolean),
      sites: records.map((lead) => lead.normalizedSite ?? '').filter(Boolean),
      instagrams: records.map((lead) => lead.normalizedInstagram ?? '').filter(Boolean),
      mapsUrls: records.map((lead) => lead.mapsUrl ?? '').filter(Boolean),
    };
  },
  async listByIds(ids) { return records.filter((lead) => ids.includes(lead.id)); },
  async compareAndArchive(id, expectedStatus) {
    const index = records.findIndex((lead) => lead.id === id && lead.statusId === expectedStatus);
    if (index < 0) return null;
    records[index] = { ...records[index], statusId: 8, status: 'arquivado', finalizedAt: new Date().toISOString() };
    return records[index];
  },
};
