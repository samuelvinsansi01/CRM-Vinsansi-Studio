import { eventBus } from '../../lib/events';
import { repositories } from '../../repositories';
import type { BaseArchiveResult, BaseFilters } from './types';

function emptyResult(requested: number): BaseArchiveResult {
  return {
    requested,
    succeeded: 0,
    unchanged: 0,
    failed: 0,
    succeededIds: [],
    unchangedIds: [],
    failures: [],
    auditWarnings: [],
  };
}

export const baseService = {
  list(filters: BaseFilters = {}) {
    return repositories.base.list(filters);
  },

  summary() {
    return repositories.base.summary();
  },

  options() {
    return repositories.base.options();
  },

  listFinalIdentities() {
    return repositories.base.listFinalIdentities();
  },

  async updateMetadata(id: string, outcome: string, notes: string) {
    await repositories.base.updateMetadata(id,outcome,notes);
    eventBus.emit('base:changed',{action:'metadata'});
  },

  async archiveMany(ids: string[]): Promise<BaseArchiveResult> {
    const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
    if (!uniqueIds.length) throw new Error('Selecione pelo menos um lead finalizado.');

    const result = emptyResult(uniqueIds.length);
    const records = await repositories.base.listByIds(uniqueIds);
    const byId = new Map(records.map((lead) => [lead.id, lead]));

    for (const id of uniqueIds) {
      const current = byId.get(id);
      if (!current) {
        result.failures.push({ id, reason: 'Lead não encontrado, não finalizado ou sem permissão de acesso.' });
        continue;
      }
      if (current.statusId === 8) {
        result.unchangedIds.push(id);
        continue;
      }

      try {
        const archived = await repositories.base.compareAndArchive(id, current.statusId);
        if (!archived) {
          result.failures.push({ id, company: current.company, reason: 'O lead foi alterado por outra operação. Atualize a Base Permanente.' });
          continue;
        }
        result.succeededIds.push(id);
        try {
          await repositories.events.append({
            source: 'base-permanente',
            action: 'archive-final-lead',
            channel: current.origin === 'Instagram' ? 'instagram' : 'whatsapp',
            leadId: id,
            status: '8',
            metadata: {
              company_name: current.company,
              previous_status_id: current.statusId,
              target_status_id: 8,
              flow: 'F09',
              canonical_source: 'leads',
            },
          });
        } catch (error) {
          result.auditWarnings.push(`Lead ${id}: ${error instanceof Error ? error.message : 'falha ao registrar auditoria.'}`);
        }
      } catch (error) {
        result.failures.push({
          id,
          company: current.company,
          reason: error instanceof Error ? error.message : 'Falha inesperada ao arquivar o lead.',
        });
      }
    }

    result.succeeded = result.succeededIds.length;
    result.unchanged = result.unchangedIds.length;
    result.failed = result.failures.length;
    if (result.succeeded || result.unchanged) eventBus.emit('base:changed', { action: 'archive' });
    return result;
  },
};
