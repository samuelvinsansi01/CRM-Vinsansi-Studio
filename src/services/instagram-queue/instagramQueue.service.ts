import { eventBus } from '../../lib/events';
import { repositories } from '../../repositories';
import type { ConfigRecord, InstagramConfigRecord } from '../config/types';
import { normalizeDomain, normalizePhone } from '../import/importValidation';
import { normalizeInstagramUsername } from '../instagram/instagram.utils';
import { permissionsFor } from '../permissions';
import { mockInstagramGateway } from './instagram.gateway';
import type { InstagramQueueFilters, InstagramQueueLead, UpdateInstagramQueueLeadInput } from './types';
import { preSendService } from '../pre-send/preSend.service';
import { settingsService } from '../settings/settings.service';
import { assertTransition } from '../state-machine';
import { isStatusGroup, normalizeStatusGroup } from '../status/status.mapper';
import { renderTemplateVariables } from '../templates/templateVariables';
import { dateInputAddDays, toLocalDateInputValue } from '../../utils/date';

async function getSelectedLeads(ids: string[]) {
  const batches = await repositories.instagramQueue.listBatches({});
  const idSet = new Set(ids);
  return batches.flatMap((batch) => batch.leads).filter((lead) => idSet.has(lead.id));
}

function allowedIds(leads: InstagramQueueLead[], action: 'mark_sending' | 'mark_sent' | 'pause' | 'resume' | 'reprocess' | 'invalidate' | 'fail', toStatus: string) {
  return leads.filter((lead) => {
    try {
      assertTransition({ entity: 'instagram-queue', fromStatus: lead.status, toStatus, action });
      return true;
    } catch {
      return false;
    }
  }).map((lead) => lead.id);
}

function assertAllAllowed(leads: InstagramQueueLead[], action: 'mark_sending' | 'mark_sent' | 'pause' | 'resume' | 'reprocess' | 'invalidate' | 'fail', toStatus: string, message: string) {
  if (!leads.length) throw new Error(message);
  const allowed = allowedIds(leads, action, toStatus);
  if (allowed.length !== leads.length) throw new Error(message);
  return allowed;
}

function assertAllSendable(leads: InstagramQueueLead[]) {
  if (!leads.length) throw new Error('Nenhum item Instagram selecionado pode ser enviado.');
  const blocked = leads.find((lead) => !permissionsFor('instagram-queue', lead.status).canSend());
  if (blocked) throw new Error(`Item Instagram nao pode ser enviado: ${blocked.company || blocked.id}.`);
  return leads;
}

function assertStatusPatch(current: InstagramQueueLead, input: UpdateInstagramQueueLeadInput) {
  if (input.status === undefined || normalizeStatusGroup(input.status) === normalizeStatusGroup(current.status)) return;
  assertTransition({ entity: 'instagram-queue', fromStatus: current.status, toStatus: input.status, action: 'status_update' });
}

function toBaseDestination(type: InstagramQueueLead['type']) {
  return type === 'Agregador' ? 'Agregador' : 'Instagram';
}

function sourceLeadId(lead: InstagramQueueLead) {
  return lead.lead_id || lead.sourcePreSendId || lead.id;
}

function assertTemplateReady(leads: InstagramQueueLead[]) {
  const missing = leads.find((lead) => !lead.message1.trim() || lead.message1.toLowerCase().includes('template nao configurado'));
  if (missing) throw new Error(`Template valido ausente para Instagram / ${missing.branch} / ${missing.type}.`);
}

function activeQueueStatus(status: unknown) {
  return isStatusGroup(status, 'queued') || isStatusGroup(status, 'paused') || isStatusGroup(status, 'following') || isStatusGroup(status, 'dm_opened');
}

function isInstagramProfile(record: ConfigRecord): record is InstagramConfigRecord {
  return record.kind === 'instagram';
}

async function activeInstagramProfiles() {
  return (await repositories.config.list('instagram'))
    .filter(isInstagramProfile)
    .filter((profile) => profile.active && profile.status !== 'Arquivado' && profile.status !== 'deleted' && profile.username.trim())
    .map((profile) => profile.username);
}

function queueRolloverTargetDate() {
  const today = toLocalDateInputValue();
  return new Date().getHours() >= 22 ? dateInputAddDays(today, 1) : today;
}

async function rolloverOverdueInstagramItems() {
  const targetDate = queueRolloverTargetDate();
  const settings = await settingsService.getDispatchSettings();
  const dailyLimit = Math.max(1, settings.instagram.dailyLimit);
  const batchLimit = Math.max(1, settings.instagram.perBatch);
  const allLeads = (await repositories.instagramQueue.listBatches({})).flatMap((batch) => batch.leads);
  const candidates = allLeads
    .filter((lead) => (isStatusGroup(lead.status, 'queued') || isStatusGroup(lead.status, 'paused')) && lead.scheduled_date < targetDate)
    .sort((a, b) => `${a.scheduled_date}:${a.batch_number}:${a.position}:${a.created_at}`.localeCompare(`${b.scheduled_date}:${b.batch_number}:${b.position}:${b.created_at}`));

  if (!candidates.length) return;

  const candidateIds = new Set(candidates.map((lead) => lead.id));
  const occupancy = new Map<string, number>();

  for (const lead of allLeads) {
    if (candidateIds.has(lead.id)) continue;
    if (!activeQueueStatus(lead.status)) continue;
    const key = `${lead.profile}:${lead.scheduled_date}`;
    occupancy.set(key, (occupancy.get(key) ?? 0) + 1);
  }

  for (const lead of candidates) {
    let scheduledDate = targetDate;
    let key = `${lead.profile}:${scheduledDate}`;

    while ((occupancy.get(key) ?? 0) >= dailyLimit) {
      scheduledDate = dateInputAddDays(scheduledDate, 1);
      key = `${lead.profile}:${scheduledDate}`;
    }

    const nextPosition = (occupancy.get(key) ?? 0) + 1;
    const batchNumber = Math.floor((nextPosition - 1) / batchLimit) + 1;
    occupancy.set(key, nextPosition);

    await repositories.instagramQueue.updateLead(lead.id, {
      scheduled_date: scheduledDate,
      position: nextPosition,
      batch_number: batchNumber,
      batch_id: `ig-batch-${lead.profile}-${scheduledDate}-${batchNumber}`,
    });
  }
}

function logQueueEvent(action: string, lead: Partial<InstagramQueueLead>, status?: string, message?: string) {
  void repositories.events.append({
    source: 'instagram-queue',
    action,
    channel: 'instagram',
    leadId: lead.lead_id ?? lead.sourcePreSendId,
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

async function persistSentToBase(leads: InstagramQueueLead[]) {
  const sentAt = new Date().toISOString();
  await Promise.all(
    leads.map((lead) =>
      repositories.base.upsertSent({
        sourceLeadId: sourceLeadId(lead),
        company: lead.company,
        branch: lead.branch,
        state: lead.state ?? '',
        city: lead.city ?? '',
        phone: lead.phone ?? '',
        site: lead.site ?? '',
        normalizedPhone: normalizePhone(lead.phone),
        normalizedSite: normalizeDomain(lead.site),
        instagram: lead.instagram_url ?? lead.instagram,
        normalizedInstagram: normalizeInstagramUsername(lead.instagram_url ?? lead.instagram),
        mapsUrl: lead.mapsUrl ?? '',
        origin: 'Instagram',
        destination: toBaseDestination(lead.type),
        original_destination: lead.original_destination,
        destination_override: lead.destination_override,
        send_instagram: lead.send_instagram ?? false,
        instagram_override_reason: lead.instagram_override_reason,
        override_by: lead.override_by,
        override_at: lead.override_at,
        status: 'sent',
        sentAt,
        template: renderTemplateVariables(lead.message1, lead),
        chipOrProfile: lead.profile,
        notes: lead.instagram,
      }),
    ),
  );
}

export const instagramQueueService = {
  async listQueuedForWorker(limit = 50) {
    await rolloverOverdueInstagramItems();
    const batches = await repositories.instagramQueue.listBatches({});
    return batches
      .flatMap((batch) => batch.leads)
      .filter((lead) => isStatusGroup(lead.status, 'queued'))
      .sort((a, b) => `${a.scheduled_date}:${a.batch_number}:${a.position}`.localeCompare(`${b.scheduled_date}:${b.batch_number}:${b.position}`))
      .slice(0, limit);
  },

  async markSending(ids: string[]) {
    const leads = await getSelectedLeads(ids);
    const allowed = assertAllAllowed(leads, 'mark_sending', 'dm_opened', 'Todos os itens Instagram selecionados precisam poder iniciar envio.');
    await Promise.all(allowed.map((id) => repositories.instagramQueue.updateLead(id, { status: 'dm_opened' })));
    leads.filter((lead) => allowed.includes(lead.id)).forEach((lead) => logQueueEvent('sending', lead, 'dm_opened'));
    eventBus.emit('instagram-queue:changed', { action: 'sending' });
  },

  async markSent(ids: string[]) {
    const sentLeads = await getSelectedLeads(ids);
    const allowed = assertAllAllowed(sentLeads, 'mark_sent', 'sent', 'Todos os itens Instagram selecionados precisam estar em envio para marcar como enviados.');
    const allowedLeads = sentLeads.filter((lead) => allowed.includes(lead.id));
    const sentPreSendIds = allowedLeads.map((lead) => lead.sourcePreSendId).filter((id): id is string => Boolean(id));

    if (allowed.length) await repositories.instagramQueue.send(allowed);
    if (allowedLeads.length) await persistSentToBase(allowedLeads);
    if (sentPreSendIds.length) await preSendService.markSent(sentPreSendIds);
    allowedLeads.forEach((lead) => logQueueEvent('sent', lead, 'sent'));
    eventBus.emit('instagram-queue:changed', { action: 'worker-sent' });
    if (allowedLeads.length) eventBus.emit('base:changed', { action: 'update' });
  },

  async registerError(id: string, message: string) {
    const [lead] = await getSelectedLeads([id]);
    if (lead) assertTransition({ entity: 'instagram-queue', fromStatus: lead.status, toStatus: 'error', action: 'fail' });
    await repositories.instagramQueue.updateLead(id, { status: 'error', error_message: message });
    logQueueEvent('error', lead ?? { id }, 'error', message);
    eventBus.emit('instagram-queue:changed', { action: 'error' });
  },

  async listProfiles() {
    return activeInstagramProfiles();
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
    if (current) {
      assertTransition({ entity: 'instagram-queue', fromStatus: current.status, action: 'edit' });
      assertStatusPatch(current, input);
    }
    const lead = await repositories.instagramQueue.updateLead(id, input);
    eventBus.emit('instagram-queue:changed', { action: 'update' });
    return lead;
  },

  async send(ids: string[]) {
    const leads = assertAllSendable(await getSelectedLeads(ids));
    assertTemplateReady(leads);
    leads.forEach((lead) => assertTransition({ entity: 'instagram-queue', fromStatus: lead.status, toStatus: 'dm_opened', action: 'mark_sending' }));
    await Promise.all(leads.map((lead) => repositories.instagramQueue.updateLead(lead.id, { status: 'dm_opened' })));

    const results = await mockInstagramGateway.send(leads);
    const sentIds = results.filter((result) => result.status === 'sent').map((result) => result.leadId);
    const errorIds = results.filter((result) => result.status === 'error').map((result) => result.leadId);
    const sentLeads = leads.filter((lead) => sentIds.includes(lead.id));
    const sentPreSendIds = sentLeads.map((lead) => lead.sourcePreSendId).filter((id): id is string => Boolean(id));

    const sentAllowedIds = allowedIds(sentLeads.map((lead) => ({ ...lead, status: 'dm_opened' })), 'mark_sent', 'sent');
    if (sentAllowedIds.length) await repositories.instagramQueue.send(sentAllowedIds);
    if (sentLeads.length) await persistSentToBase(sentLeads);
    if (sentPreSendIds.length) await preSendService.markSent(sentPreSendIds);
    await Promise.all(errorIds.map((id) => repositories.instagramQueue.updateLead(id, { status: 'error' })));
    sentLeads.forEach((lead) => logQueueEvent('sent', lead, 'sent'));
    errorIds.forEach((id) => logQueueEvent('error', leads.find((lead) => lead.id === id) ?? { id }, 'error', 'Erro ao enviar Instagram.'));
    eventBus.emit('instagram-queue:changed', { action: 'send' });
    if (sentLeads.length) eventBus.emit('base:changed', { action: 'update' });
  },

  async pause(ids: string[]) {
    const leads = await getSelectedLeads(ids);
    const allowed = assertAllAllowed(leads, 'pause', 'paused', 'Todos os itens Instagram selecionados precisam poder ser pausados.');
    await repositories.instagramQueue.pause(allowed);
    eventBus.emit('instagram-queue:changed', { action: 'pause' });
  },

  async resume(ids: string[]) {
    const leads = await getSelectedLeads(ids);
    const allowed = assertAllAllowed(leads, 'resume', 'queued', 'Todos os itens Instagram selecionados precisam poder ser retomados.');
    await repositories.instagramQueue.resume(allowed);
    eventBus.emit('instagram-queue:changed', { action: 'resume' });
  },

  async reprocess(ids: string[]) {
    const leads = await getSelectedLeads(ids);
    const allowed = assertAllAllowed(leads, 'reprocess', 'queued', 'Apenas itens Instagram com erro podem ser reprocessados.');
    await repositories.instagramQueue.reprocess(allowed);
    eventBus.emit('instagram-queue:changed', { action: 'reprocess' });
  },

  async invalidate(id: string) {
    const [lead] = await getSelectedLeads([id]);
    if (lead) assertTransition({ entity: 'instagram-queue', fromStatus: lead.status, toStatus: 'invalid', action: 'invalidate' });
    await repositories.instagramQueue.invalidate(id);
    eventBus.emit('instagram-queue:changed', { action: 'invalidate' });
  },
};
