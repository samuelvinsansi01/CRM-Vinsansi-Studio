import { eventBus } from '../../lib/events';
import { getSupabaseClient } from '../../lib/supabase';
import { repositories } from '../../repositories';
import { permissionsFor } from '../permissions';
import { assertTransition } from '../state-machine';
import { isStatusGroup, normalizeStatusGroup } from '../status/status.mapper';
import { toLocalDateInputValue } from '../../utils/date';
import { queueCapacityRollover } from '../queue-rollover/queueCapacityRollover.service';
import type { InstagramQueueFilters, InstagramQueueLead, UpdateInstagramQueueLeadInput } from './types';
import type { PageRequest } from '../pagination/types';

async function getSelectedLeads(ids: string[]) {
  const batches = await repositories.instagramQueue.listBatches({});
  const idSet = new Set(ids);
  return batches.flatMap((batch) => batch.leads).filter((lead) => idSet.has(lead.id));
}

function assertStatusPatch(current: InstagramQueueLead, input: UpdateInstagramQueueLeadInput) {
  if (input.status === undefined || normalizeStatusGroup(input.status) === normalizeStatusGroup(current.status)) return;
  assertTransition({ entity: 'instagram-queue', fromStatus: current.status, toStatus: input.status, action: 'status_update' });
}

function assertAllAllowed(
  leads: InstagramQueueLead[],
  action: 'pause' | 'resume' | 'reprocess' | 'invalidate',
  toStatus: string,
  message: string,
) {
  if (!leads.length) throw new Error(message);
  for (const lead of leads) {
    assertTransition({ entity: 'instagram-queue', fromStatus: lead.status, toStatus, action });
  }
  return leads.map((lead) => lead.id);
}

function queueRolloverTargetDate() {
  return toLocalDateInputValue();
}

let instagramRolloverPromise: Promise<void> | null = null;

async function runInstagramRollover() {
  await queueCapacityRollover.run('instagram', queueRolloverTargetDate());
}

async function rolloverOverdueInstagramItems() {
  if (!instagramRolloverPromise) {
    instagramRolloverPromise = runInstagramRollover().finally(() => {
      instagramRolloverPromise = null;
    });
  }
  await instagramRolloverPromise;
}


export const instagramQueueService = {
  async listProfiles() {
    return repositories.instagramQueue.listProfiles();
  },

  async listBatches(filters: InstagramQueueFilters) {
    await rolloverOverdueInstagramItems();
    return repositories.instagramQueue.listBatches(filters);
  },

  async page(filters: InstagramQueueFilters, request: PageRequest) {
    await rolloverOverdueInstagramItems();
    return repositories.instagramQueue.page(filters, request);
  },

  async summary(filters: InstagramQueueFilters = {}) {
    await rolloverOverdueInstagramItems();
    return repositories.instagramQueue.summary(filters);
  },

  async updateLead(id: string, input: UpdateInstagramQueueLeadInput) {
    const [current] = await getSelectedLeads([id]);
    if (!current) throw new Error('Item não encontrado na fila Instagram.');
    if (!permissionsFor('instagram-queue', current.status).canEdit()) throw new Error('Este item não pode ser editado no estado atual.');
    assertStatusPatch(current, input);
    const lead = await repositories.instagramQueue.updateLead(id, input);
    eventBus.emit('instagram-queue:changed', { action: 'update' });
    return lead;
  },

  async pause(ids: string[]) {
    const leads = await getSelectedLeads(ids);
    const allowed = assertAllAllowed(leads, 'pause', 'paused', 'Todos os itens selecionados precisam estar disponíveis para pausa.');
    await repositories.instagramQueue.pause(allowed);
    eventBus.emit('instagram-queue:changed', { action: 'pause' });
  },

  async resume(ids: string[]) {
    const leads = await getSelectedLeads(ids);
    const allowed = assertAllAllowed(leads, 'resume', 'queued', 'Todos os itens selecionados precisam estar pausados.');
    await repositories.instagramQueue.resume(allowed);
    eventBus.emit('instagram-queue:changed', { action: 'resume' });
  },

  async reprocessScope(filters: InstagramQueueFilters) {
    if (!filters.profile || !filters.scheduledDate) return 0;
    const { data, error } = await getSupabaseClient().rpc('queue_final_retryable_ids_r59', {
      p_channel: 'instagram',
      p_resource_key: filters.profile,
      p_scheduled_date: filters.scheduledDate,
    });
    if (error) throw new Error(error.message);
    const ids = (Array.isArray(data) ? data : []).map((value) => String(value)).filter(Boolean);
    if (!ids.length) return 0;
    await repositories.instagramQueue.reprocess(ids);
    eventBus.emit('instagram-queue:changed', { action: 'reprocess' });
    return ids.length;
  },

  async reprocess(ids: string[]) {
    const leads = await getSelectedLeads(ids);
    const allowed = assertAllAllowed(leads, 'reprocess', 'queued', 'Apenas itens Instagram com erro podem ser reprocessados.');
    await repositories.instagramQueue.reprocess(allowed);
    eventBus.emit('instagram-queue:changed', { action: 'reprocess' });
  },

  async invalidate(id: string) {
    const [lead] = await getSelectedLeads([id]);
    if (!lead) throw new Error('Item não encontrado na fila Instagram.');
    assertTransition({ entity: 'instagram-queue', fromStatus: lead.status, toStatus: 'invalid', action: 'invalidate' });
    await repositories.instagramQueue.invalidate(id);
    eventBus.emit('instagram-queue:changed', { action: 'invalidate' });
  },
};
