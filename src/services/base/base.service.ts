import { eventBus } from '../../lib/events';
import { repositories } from '../../repositories';
import { assertTransition } from '../state-machine';
import { normalizeStatusGroup } from '../status/status.mapper';
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
      if (current && normalizeStatusGroup(input.status) !== normalizeStatusGroup(current.status)) {
        assertTransition({ entity: 'base', fromStatus: current.status, toStatus: input.status, action: 'status_update' });
      }
    }
    const lead = await repositories.base.update(id, input);
    eventBus.emit('base:changed', { action: 'update' });
    return lead;
  },

  async setStatus(id: string, status: BaseLeadStatus) {
    const current = (await repositories.base.list({})).find((lead) => lead.id === id);
    if (current) assertTransition({ entity: 'base', fromStatus: current.status, toStatus: status, action: 'status_update' });
    const lead = await repositories.base.setStatus(id, status);
    eventBus.emit('base:changed', { action: 'status' });
    return lead;
  },

  async archive(id: string) {
    const current = (await repositories.base.list({})).find((lead) => lead.id === id);
    if (current) assertTransition({ entity: 'base', fromStatus: current.status, toStatus: 'archived', action: 'archive' });
    const lead = await repositories.base.archive(id);
    eventBus.emit('base:changed', { action: 'archive' });
    return lead;
  },

  async archiveMany(ids: string[]) {
    if (!ids.length) throw new Error('Selecione pelo menos um lead.');
    const uniqueIds = Array.from(new Set(ids));
    const records = await repositories.base.list({});
    const byId = new Map(records.map((lead) => [lead.id, lead]));
    const selected = uniqueIds.map((id) => byId.get(id));
    if (selected.some((lead) => !lead)) throw new Error('Um ou mais leads nao foram encontrados.');
    const leads = selected as NonNullable<(typeof selected)[number]>[];
    leads.forEach((lead) => assertTransition({ entity: 'base', fromStatus: lead.status, toStatus: 'archived', action: 'archive' }));
    const updated = await Promise.all(leads.map((lead) => repositories.base.archive(lead.id)));
    eventBus.emit('base:changed', { action: 'archive' });
    return updated;
  },
};
