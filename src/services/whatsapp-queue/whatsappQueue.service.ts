import { eventBus } from '../../lib/events';
import { repositories } from '../../repositories';
import { normalizeDomain, normalizePhone } from '../import/importValidation';
import { normalizeInstagramUsername } from '../instagram/instagram.utils';
import { permissionsFor } from '../permissions';
import { whatsappGateway } from './whatsapp.gateway';
import { hasWhatsAppWorkerContract, missingWhatsAppWorkerFields } from './whatsappQueue.guards';
import type { UpdateWhatsAppQueueLeadInput, WhatsAppQueueFilters, WhatsAppQueueLead } from './types';
import type { ChipConfigRecord, ConfigRecord } from '../config/types';
import { chipInstance, isOperationalWhatsAppChip } from '../config/chipOperational';
import { preSendService } from '../pre-send/preSend.service';
import { assertTransition } from '../state-machine';
import { isStatusGroup, normalizeStatusGroup } from '../status/status.mapper';
import { renderTemplateVariables } from '../templates/templateVariables';
import { dateInputAddDays, toLocalDateInputValue } from '../../utils/date';

function isChip(record: ConfigRecord): record is ChipConfigRecord {
  return record.kind === 'chips';
}

async function getSelectedLeads(ids: string[]) {
  const batches = await repositories.whatsappQueue.listBatches({});
  const idSet = new Set(ids);
  return batches.flatMap((batch) => batch.leads).filter((lead) => idSet.has(lead.id));
}

async function assertLeadsUseOperationalChips(leads: WhatsAppQueueLead[]) {
  const operational = new Set((await repositories.config.list('chips')).filter(isChip).filter(isOperationalWhatsAppChip).map(chipInstance));
  const blocked = leads.find((lead) => !operational.has(lead.chip_instance || lead.chip));
  if (blocked) {
    throw new Error(`Chip desconectado ou inativo: ${blocked.chip_instance || blocked.chip}.`);
  }
}

function activeQueueStatus(status: unknown) {
  return isStatusGroup(status, 'queued') || isStatusGroup(status, 'paused') || isStatusGroup(status, 'sending');
}

function queueRolloverTargetDate() {
  const today = toLocalDateInputValue();
  return new Date().getHours() >= 22 ? dateInputAddDays(today, 1) : today;
}

async function rolloverOverdueWhatsAppItems() {
  const targetDate = queueRolloverTargetDate();
  const chips = (await repositories.config.list('chips')).filter(isChip).filter(isOperationalWhatsAppChip);
  const chipMap = new Map(chips.map((chip) => [chipInstance(chip), chip]));
  if (!chipMap.size) return;

  const allLeads = (await repositories.whatsappQueue.listBatches({})).flatMap((batch) => batch.leads);
  const candidates = allLeads
    .filter((lead) => (isStatusGroup(lead.status, 'queued') || isStatusGroup(lead.status, 'paused')) && lead.scheduled_date < targetDate)
    .filter((lead) => chipMap.has(lead.chip_instance || lead.chip))
    .sort((a, b) => `${a.scheduled_date}:${a.batch_number}:${a.position}:${a.created_at}`.localeCompare(`${b.scheduled_date}:${b.batch_number}:${b.position}:${b.created_at}`));

  if (!candidates.length) return;

  const candidateIds = new Set(candidates.map((lead) => lead.id));
  const occupancy = new Map<string, number>();

  for (const lead of allLeads) {
    if (candidateIds.has(lead.id)) continue;
    if (!activeQueueStatus(lead.status)) continue;
    const instance = lead.chip_instance || lead.chip;
    if (!chipMap.has(instance)) continue;
    const key = `${instance}:${lead.scheduled_date}`;
    occupancy.set(key, (occupancy.get(key) ?? 0) + 1);
  }

  for (const lead of candidates) {
    const instance = lead.chip_instance || lead.chip;
    const chip = chipMap.get(instance);
    if (!chip) continue;
    const dailyLimit = Math.max(1, chip.dailyLimit);
    const batchLimit = Math.max(1, chip.blockSize);
    let scheduledDate = targetDate;
    let key = `${instance}:${scheduledDate}`;

    while ((occupancy.get(key) ?? 0) >= dailyLimit) {
      scheduledDate = dateInputAddDays(scheduledDate, 1);
      key = `${instance}:${scheduledDate}`;
    }

    const nextPosition = (occupancy.get(key) ?? 0) + 1;
    const batchNumber = Math.floor((nextPosition - 1) / batchLimit) + 1;
    occupancy.set(key, nextPosition);

    await repositories.whatsappQueue.updateLead(lead.id, {
      scheduled_date: scheduledDate,
      position: nextPosition,
      batch_number: batchNumber,
      batch_id: `wa-batch-${instance}-${scheduledDate}-${batchNumber}`,
    });
  }
}

function allowedIds(leads: WhatsAppQueueLead[], action: 'mark_sending' | 'mark_sent' | 'pause' | 'resume' | 'reprocess' | 'invalidate' | 'fail', toStatus: string) {
  return leads.filter((lead) => {
    try {
      assertTransition({ entity: 'whatsapp-queue', fromStatus: lead.status, toStatus, action });
      return true;
    } catch {
      return false;
    }
  }).map((lead) => lead.id);
}

function assertAllAllowed(leads: WhatsAppQueueLead[], action: 'mark_sending' | 'mark_sent' | 'pause' | 'resume' | 'reprocess' | 'invalidate' | 'fail', toStatus: string, message: string) {
  if (!leads.length) throw new Error(message);
  const allowed = allowedIds(leads, action, toStatus);
  if (allowed.length !== leads.length) throw new Error(message);
  return allowed;
}

function assertAllSendable(leads: WhatsAppQueueLead[]) {
  if (!leads.length) throw new Error('Nenhum item selecionado pode ser enviado.');
  const blocked = leads.find((lead) => !permissionsFor('whatsapp-queue', lead.status).canSend() || !hasWhatsAppWorkerContract(lead));
  if (blocked) throw new Error(`Item WhatsApp nao pode ser enviado: ${blocked.company || blocked.id}.`);
  return leads;
}

function assertStatusPatch(current: WhatsAppQueueLead, input: UpdateWhatsAppQueueLeadInput) {
  if (input.status === undefined || normalizeStatusGroup(input.status) === normalizeStatusGroup(current.status)) return;
  if (normalizeStatusGroup(input.status) !== normalizeStatusGroup(current.status)) {
    assertTransition({ entity: 'whatsapp-queue', fromStatus: current.status, toStatus: input.status, action: 'status_update' });
  }
}

function toBaseDestination(type: WhatsAppQueueLead['type']) {
  if (type === 'Agregador') return 'Agregador';
  if (type === 'Com site') return 'Com site';
  return 'WhatsApp';
}

function sourceLeadId(lead: WhatsAppQueueLead) {
  return lead.lead_id || lead.sourcePreSendId || lead.id;
}

function assertTemplateReady(leads: WhatsAppQueueLead[]) {
  const missing = leads.find((lead) => !lead.message1.trim() || lead.message1.toLowerCase().includes('template nao configurado'));
  if (missing) throw new Error(`Template valido ausente para WhatsApp / ${missing.branch} / ${missing.type}.`);
}

function assertWorkerContractReady(leads: WhatsAppQueueLead[]) {
  const missing = leads.find((lead) => !hasWhatsAppWorkerContract(lead));
  if (!missing) return;
  throw new Error(`Item WhatsApp sem contrato de worker (${missing.company || missing.id}): ${missingWhatsAppWorkerFields(missing).join(', ')}.`);
}

async function logDispatchMessages(leads: WhatsAppQueueLead[], replayed = false) {
  // Auditoria nunca pode desfazer um envio confirmado. Falhas de log ficam registradas
  // no console/observabilidade do backend, mas nao revertem o estado operacional.
  await Promise.allSettled(
    leads.flatMap((lead) =>
      [
        { part: 'message_1', body: renderTemplateVariables(lead.message_1 || lead.message1, lead) },
        { part: 'message_2', body: renderTemplateVariables(lead.message_2 || lead.message2, lead) },
        { part: 'image', body: lead.image_url || lead.image_id || '' },
      ]
        .filter((item) => item.body.trim())
        .map((item) =>
          repositories.events.appendDispatchMessageLog({
            leadId: sourceLeadId(lead),
            chipId: lead.chip_id,
            instance: lead.chip_instance || lead.chip,
            phone: lead.phone,
            normalizedPhone: lead.phone_normalized,
            direction: 'outbound',
            part: item.part,
            body: item.body,
            status: 'sent',
            responsePayload: {
              queue_item_id: lead.id,
              batch_id: lead.batch_id ?? lead.batchId,
              template_id: lead.template_id,
              replayed_post_send: replayed,
            },
          }),
        ),
    ),
  );
}

function logQueueEvent(action: string, lead: Partial<WhatsAppQueueLead>, status?: string, message?: string) {
  void repositories.events.append({
    source: 'whatsapp-queue',
    action,
    channel: 'whatsapp',
    leadId: lead.lead_id ?? lead.sourcePreSendId,
    queueItemId: lead.id,
    status,
    message,
    metadata: {
      batch_id: lead.batch_id ?? lead.batchId,
      chip_id: lead.chip_id ?? lead.chip,
      template_id: lead.template_id,
    },
  }).catch(() => undefined);
}

async function persistSentToBase(leads: WhatsAppQueueLead[]) {
  const sentAt = new Date().toISOString();
  await Promise.all(
    leads.map((lead) =>
      repositories.base.upsertSent({
        sourceLeadId: sourceLeadId(lead),
        company: lead.company,
        branch: lead.branch,
        state: lead.state ?? '',
        city: lead.city ?? '',
        phone: lead.phone,
        site: lead.site ?? '',
        normalizedPhone: normalizePhone(lead.phone),
        normalizedSite: normalizeDomain(lead.site),
        instagram: lead.instagram_url ?? lead.instagram ?? '',
        normalizedInstagram: normalizeInstagramUsername(lead.instagram_url ?? lead.instagram),
        mapsUrl: lead.mapsUrl ?? '',
        origin: 'WhatsApp',
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
        chipOrProfile: lead.chip,
        notes: lead.imageName ? `Imagem: ${lead.imageName}` : '',
      }),
    ),
  );
}

async function finishSentPersistence({
  queueIds,
  leads,
  preSendIds,
  replayed = false,
}: {
  queueIds: string[];
  leads: WhatsAppQueueLead[];
  preSendIds: string[];
  replayed?: boolean;
}) {
  // Ordem intencional: a Base Permanente e a fonte de recuperacao. Ela precisa ser
  // gravada antes de qualquer item ser exibido como "enviado" na fila.
  if (leads.length) await persistSentToBase(leads);
  if (queueIds.length) await repositories.whatsappQueue.send(queueIds);
  if (preSendIds.length) await preSendService.markSent(preSendIds);
  if (leads.length) await logDispatchMessages(leads, replayed);
}

export const whatsappQueueService = {
  async listQueuedForWorker(limit = 50) {
    await rolloverOverdueWhatsAppItems();
    const batches = await repositories.whatsappQueue.listBatches({});
    const operational = new Set((await repositories.config.list('chips')).filter(isChip).filter(isOperationalWhatsAppChip).map(chipInstance));
    return batches
      .flatMap((batch) => batch.leads)
      .filter((lead) => isStatusGroup(lead.status, 'queued') && hasWhatsAppWorkerContract(lead) && operational.has(lead.chip_instance || lead.chip))
      .sort((a, b) => `${a.scheduled_date}:${a.batch_number}:${a.position}`.localeCompare(`${b.scheduled_date}:${b.batch_number}:${b.position}`))
      .slice(0, limit);
  },

  async markSending(ids: string[]) {
    const leads = await getSelectedLeads(ids);
    const allowed = assertAllAllowed(leads, 'mark_sending', 'sending', 'Todos os itens selecionados precisam poder iniciar envio.');
    await Promise.all(allowed.map((id) => repositories.whatsappQueue.updateLead(id, { status: 'sending' })));
    leads.forEach((lead) => logQueueEvent('sending', lead, 'sending'));
    eventBus.emit('whatsapp-queue:changed', { action: 'sending' });
  },

  async markSent(ids: string[]) {
    const sentLeads = await getSelectedLeads(ids);
    const allowed = assertAllAllowed(sentLeads, 'mark_sent', 'sent', 'Todos os itens selecionados precisam estar em envio para marcar como enviados.');
    const allowedLeads = sentLeads.filter((lead) => allowed.includes(lead.id));
    const sentPreSendIds = allowedLeads.map((lead) => lead.sourcePreSendId).filter((id): id is string => Boolean(id));

    await finishSentPersistence({ queueIds: allowed, leads: allowedLeads, preSendIds: sentPreSendIds, replayed: true });
    allowedLeads.forEach((lead) => logQueueEvent('sent', lead, 'sent'));
    eventBus.emit('whatsapp-queue:changed', { action: 'worker-sent' });
    if (allowedLeads.length) eventBus.emit('base:changed', { action: 'update' });
  },

  async registerError(id: string, message: string) {
    const [lead] = await getSelectedLeads([id]);
    if (lead) assertTransition({ entity: 'whatsapp-queue', fromStatus: lead.status, toStatus: 'error', action: 'fail' });
    await repositories.whatsappQueue.updateLead(id, { status: 'error', error_message: message });
    logQueueEvent('error', lead ?? { id }, 'error', message);
    eventBus.emit('whatsapp-queue:changed', { action: 'error' });
  },

  async listChips() {
    const configuredChips = (await repositories.config.list('chips')).filter(isChip).filter(isOperationalWhatsAppChip);
    return configuredChips.sort((a, b) => a.priority - b.priority).map(chipInstance);
  },

  async listBatches(filters: WhatsAppQueueFilters) {
    await rolloverOverdueWhatsAppItems();
    return repositories.whatsappQueue.listBatches(filters);
  },

  async summary(filters: WhatsAppQueueFilters = {}) {
    await rolloverOverdueWhatsAppItems();
    return repositories.whatsappQueue.summary(filters);
  },

  async updateLead(id: string, input: UpdateWhatsAppQueueLeadInput) {
    const [current] = await getSelectedLeads([id]);
    if (current) {
      assertTransition({ entity: 'whatsapp-queue', fromStatus: current.status, action: 'edit' });
      assertStatusPatch(current, input);
    }
    const lead = await repositories.whatsappQueue.updateLead(id, input);
    eventBus.emit('whatsapp-queue:changed', { action: 'update' });
    return lead;
  },

  async send(ids: string[]) {
    const leads = assertAllSendable(await getSelectedLeads(ids));
    await assertLeadsUseOperationalChips(leads);
    assertWorkerContractReady(leads);
    assertTemplateReady(leads);
    leads.forEach((lead) => assertTransition({ entity: 'whatsapp-queue', fromStatus: lead.status, toStatus: 'sending', action: 'mark_sending' }));

    // O item passa para envio antes de chamar o worker. Qualquer falha posterior fica
    // rastreavel como error e pode ser reprocessada, em vez de permanecer em queued.
    await Promise.all(leads.map((lead) => repositories.whatsappQueue.updateLead(lead.id, { status: 'sending', error_message: '' })));
    leads.forEach((lead) => logQueueEvent('sending', lead, 'sending'));

    let results;
    try {
      results = await whatsappGateway.send(leads);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro ao acionar worker WhatsApp.';
      await Promise.all(leads.map((lead) => repositories.whatsappQueue.updateLead(lead.id, { status: 'error', error_message: message })));
      leads.forEach((lead) => logQueueEvent('error', lead, 'error', message));
      eventBus.emit('whatsapp-queue:changed', { action: 'error' });
      throw new Error(`Worker WhatsApp indisponivel. Itens movidos para erro e prontos para reprocessamento: ${message}`);
    }

    const byId = new Map(results.map((result) => [result.leadId, result]));
    const normalizedResults = leads.map((lead) => byId.get(lead.id) ?? ({ leadId: lead.id, status: 'error' as const, errorMessage: 'Worker WhatsApp nao retornou resultado para este item.' }));
    const sentIds = normalizedResults.filter((result) => result.status === 'sent').map((result) => result.leadId);
    const errorResults = normalizedResults.filter((result) => result.status === 'error');
    const pausedResults = normalizedResults.filter((result) => result.status === 'paused');
    const sentLeads = leads.filter((lead) => sentIds.includes(lead.id));
    const sentPreSendIds = sentLeads.map((lead) => lead.sourcePreSendId).filter((id): id is string => Boolean(id));

    const sentAllowedIds = allowedIds(sentLeads.map((lead) => ({ ...lead, status: 'sending' })), 'mark_sent', 'sent');
    try {
      await finishSentPersistence({ queueIds: sentAllowedIds, leads: sentLeads, preSendIds: sentPreSendIds });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao persistir envio WhatsApp.';
      await Promise.all(sentLeads.map((lead) => repositories.whatsappQueue.updateLead(lead.id, { status: 'error', error_message: message })));
      sentLeads.forEach((lead) => logQueueEvent('error', lead, 'error', message));
      eventBus.emit('whatsapp-queue:changed', { action: 'error' });
      throw new Error(`Envio confirmado pelo worker, mas a persistencia falhou. Itens foram movidos para erro para reconciliacao: ${message}`);
    }

    await Promise.all(errorResults.map((result) => repositories.whatsappQueue.updateLead(result.leadId, { status: 'error', error_message: result.errorMessage ?? 'Erro ao enviar WhatsApp.' })));
    await Promise.all(pausedResults.map((result) => repositories.whatsappQueue.updateLead(result.leadId, { status: 'paused', error_message: result.errorMessage ?? 'Chip desconectado.' })));
    sentLeads.forEach((lead) => logQueueEvent('sent', lead, 'sent'));
    errorResults.forEach((result) => logQueueEvent('error', leads.find((lead) => lead.id === result.leadId) ?? { id: result.leadId }, 'error', result.errorMessage));
    pausedResults.forEach((result) => logQueueEvent('paused', leads.find((lead) => lead.id === result.leadId) ?? { id: result.leadId }, 'paused', result.errorMessage));
    eventBus.emit('whatsapp-queue:changed', { action: 'send' });
    if (sentLeads.length) eventBus.emit('base:changed', { action: 'update' });
  },

  async pause(ids: string[]) {
    const leads = await getSelectedLeads(ids);
    const allowed = assertAllAllowed(leads, 'pause', 'paused', 'Todos os itens selecionados precisam poder ser pausados.');
    await repositories.whatsappQueue.pause(allowed);
    eventBus.emit('whatsapp-queue:changed', { action: 'pause' });
  },

  async resume(ids: string[]) {
    const leads = await getSelectedLeads(ids);
    const allowed = assertAllAllowed(leads, 'resume', 'queued', 'Todos os itens selecionados precisam poder ser retomados.');
    await repositories.whatsappQueue.resume(allowed);
    eventBus.emit('whatsapp-queue:changed', { action: 'resume' });
  },

  async reprocess(ids: string[]) {
    const leads = await getSelectedLeads(ids);
    const allowed = assertAllAllowed(leads, 'reprocess', 'queued', 'Apenas itens com erro podem ser reprocessados.');
    await repositories.whatsappQueue.reprocess(allowed);
    eventBus.emit('whatsapp-queue:changed', { action: 'reprocess' });
  },

  async invalidate(id: string) {
    const [lead] = await getSelectedLeads([id]);
    if (lead) assertTransition({ entity: 'whatsapp-queue', fromStatus: lead.status, toStatus: 'invalid', action: 'invalidate' });
    await repositories.whatsappQueue.invalidate(id);
    eventBus.emit('whatsapp-queue:changed', { action: 'invalidate' });
  },
};
