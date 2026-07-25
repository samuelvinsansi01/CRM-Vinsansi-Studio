import { eventBus } from '../../lib/events';
import { repositories } from '../../repositories';
import { assertDirectStatusChangeAllowed, assertLeadCanBeArchived } from './lead-status.service';
import type { BaseFilters, BaseLeadStatus, UpdateBaseLeadInput } from './types';

export const baseService = {
  async list(filters: BaseFilters = {}) {
    return repositories.base.list(filters);
  },

  async summary() {
    return repositories.base.summary();
  },

  async options() {
    return repositories.base.options();
  },

  async update(id: string, input: UpdateBaseLeadInput) {
    if (input.status !== undefined) {
      const current = (await repositories.base.list({})).find((lead) => lead.id === id);
      if (!current) throw new Error('Lead não encontrado.');
      assertDirectStatusChangeAllowed(current.status, input.status);
    }
    const lead = await repositories.base.update(id, input);
    eventBus.emit('base:changed', { action: 'update' });
    return lead;
  },

  async setStatus(id: string, status: BaseLeadStatus) {
    const current = (await repositories.base.list({})).find((lead) => lead.id === id);
    if (!current) throw new Error('Lead não encontrado.');
    assertDirectStatusChangeAllowed(current.status, status);
    return current;
  },

  async archive(id: string) {
    const current = (await repositories.base.list({})).find((lead) => lead.id === id);
    if (!current) throw new Error('Lead não encontrado.');
    assertLeadCanBeArchived(current.status);
    const lead = await repositories.base.archive(id);
    eventBus.emit('base:changed', { action: 'archive' });
    return lead;
  },

  async archiveMany(ids: string[]) {
    if (!ids.length) throw new Error('Selecione pelo menos um lead.');
    const uniqueIds = Array.from(new Set(ids));
    const records = await repositories.base.list({});
    const byId = new Map(records.map((lead) => [lead.id, lead]));
    const leads = uniqueIds.map((id) => byId.get(id));
    if (leads.some((lead) => !lead)) throw new Error('Um ou mais leads não foram encontrados.');
    const selected = leads as NonNullable<(typeof leads)[number]>[];
    selected.forEach((lead) => assertLeadCanBeArchived(lead.status));
    const updated = await Promise.all(selected.map((lead) => repositories.base.archive(lead.id)));
    eventBus.emit('base:changed', { action: 'archive' });
    return updated;
  },
};
