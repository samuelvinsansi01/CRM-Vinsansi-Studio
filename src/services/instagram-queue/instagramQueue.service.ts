import { eventBus } from '../../lib/events';
import { repositories } from '../../repositories';
import { permissionsFor } from '../permissions';
import { settingsService } from '../settings/settings.service';
import { assertTransition } from '../state-machine';
import { isStatusGroup, normalizeStatusGroup } from '../status/status.mapper';
import { dateInputAddDays, toLocalDateInputValue } from '../../utils/date';
import type { InstagramQueueFilters, InstagramQueueLead, UpdateInstagramQueueLeadInput } from './types';

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

function activeQueueStatus(status: unknown) {
  return isStatusGroup(status, 'queued') || isStatusGroup(status, 'paused') || isStatusGroup(status, 'following') || isStatusGroup(status, 'dm_opened');
}

function queueRolloverTargetDate() {
  const today = toLocalDateInputValue();
  return new Date().getHours() >= 22 ? dateInputAddDays(today, 1) : today;
}

async function rolloverOverdueInstagramItems() {
  const targetDate = queueRolloverTargetDate();
  const settings = await settingsService.getDispatchSettings();
  const fallbackDailyLimit = Math.max(1, settings.instagram.dailyLimit);
  const allLeads = (await repositories.instagramQueue.listBatches({})).flatMap((batch) => batch.leads);
  const candidates = allLeads
    .filter((lead) => (isStatusGroup(lead.status, 'queued') || isStatusGroup(lead.status, 'paused')) && lead.scheduled_date < targetDate)
    .sort((a, b) => `${a.scheduled_date}:${a.batch_number}:${a.position}:${a.created_at}`.localeCompare(`${b.scheduled_date}:${b.batch_number}:${b.position}:${b.created_at}`));

  if (!candidates.length) return;
  const candidateIds = new Set(candidates.map((lead) => lead.id));
  const occupancy = new Map<string, number>();
  for (const lead of allLeads) {
    if (candidateIds.has(lead.id) || !activeQueueStatus(lead.status)) continue;
    const key = `${lead.profile}:${lead.scheduled_date}`;
    occupancy.set(key, (occupancy.get(key) ?? 0) + 1);
  }

  for (const lead of candidates) {
    let scheduledDate = targetDate;
    let key = `${lead.profile}:${scheduledDate}`;
    while ((occupancy.get(key) ?? 0) >= fallbackDailyLimit) {
      scheduledDate = dateInputAddDays(scheduledDate, 1);
      key = `${lead.profile}:${scheduledDate}`;
    }
    const nextPosition = (occupancy.get(key) ?? 0) + 1;
    occupancy.set(key, nextPosition);
    await repositories.instagramQueue.updateLead(lead.id, {
      scheduled_date: scheduledDate,
      position: nextPosition,
    });
  }
}

function logQueueEvent(action: string, lead: Partial<InstagramQueueLead>, status?: string, message?: string) {
  void repositories.events.append({
    source: 'instagram-queue',
    action,
    channel: 'instagram',
    leadId: lead.lead_id,
    queueItemId: lead.id,
    status,
    message,
    metadata: {
      batch_id: lead.batch_id ?? lead.batchId,
      profile_id: lead.profile_id ?? lead.profile,
      template_id: lead.template_id,
    },
  }).catch(() => undefined);
}

export const instagramQueueService = {
  async listProfiles() {
    return repositories.instagramQueue.listProfiles();
  },

  async listBatches(filters: InstagramQueueFilters) {
    await rolloverOverdueInstagramItems();
    return repositories.instagramQueue.listBatches(filters);
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
    logQueueEvent('updated', current, current.status);
    eventBus.emit('instagram-queue:changed', { action: 'update' });
    return lead;
  },

  async pause(ids: string[]) {
    const leads = await getSelectedLeads(ids);
    const allowed = assertAllAllowed(leads, 'pause', 'paused', 'Todos os itens selecionados precisam estar disponíveis para pausa.');
    await repositories.instagramQueue.pause(allowed);
    leads.forEach((lead) => logQueueEvent('paused', lead, 'paused'));
    eventBus.emit('instagram-queue:changed', { action: 'pause' });
  },

  async resume(ids: string[]) {
    const leads = await getSelectedLeads(ids);
    const allowed = assertAllAllowed(leads, 'resume', 'queued', 'Todos os itens selecionados precisam estar pausados.');
    await repositories.instagramQueue.resume(allowed);
    leads.forEach((lead) => logQueueEvent('resumed', lead, 'queued'));
    eventBus.emit('instagram-queue:changed', { action: 'resume' });
  },

  async reprocess(ids: string[]) {
    const leads = await getSelectedLeads(ids);
    const allowed = assertAllAllowed(leads, 'reprocess', 'queued', 'Apenas itens Instagram com erro podem ser reprocessados.');
    await repositories.instagramQueue.reprocess(allowed);
    leads.forEach((lead) => logQueueEvent('reprocessed', lead, 'queued'));
    eventBus.emit('instagram-queue:changed', { action: 'reprocess' });
  },

  async invalidate(id: string) {
    const [lead] = await getSelectedLeads([id]);
    if (!lead) throw new Error('Item não encontrado na fila Instagram.');
    assertTransition({ entity: 'instagram-queue', fromStatus: lead.status, toStatus: 'invalid', action: 'invalidate' });
    await repositories.instagramQueue.invalidate(id);
    logQueueEvent('invalidated', lead, 'invalid');
    eventBus.emit('instagram-queue:changed', { action: 'invalidate' });
  },
};
