import { LEAD_STATUS } from '../status/leadStatus';
import { eventBus } from '../../lib/events';
import { repositories } from '../../repositories';
import { normalizePhone } from '../import/importValidation';
import { permissionsFor } from '../permissions';
import { whatsappGateway } from './whatsapp.gateway';
import { whatsappBatchGateway, type WhatsAppBatchState } from './whatsapp.batch.gateway';
import { hasWhatsAppWorkerContract, missingWhatsAppWorkerFields } from './whatsappQueue.guards';
import type { UpdateWhatsAppQueueLeadInput, WhatsAppQueueFilters, WhatsAppQueueLead } from './types';
import type { ChipConfigRecord, ConfigRecord } from '../config/types';
import { chipInstance, chipLevelDefaults, isOperationalWhatsAppChip } from '../config/chipOperational';
import { settingsService } from '../settings';
import { assertTransition } from '../state-machine';
import { isStatusGroup, normalizeStatusGroup } from '../status/status.mapper';
import { renderTemplateVariables } from '../templates/templateVariables';
import { hasAllTemplateMessages } from '../templates/templateContract';
import { dateInputAddDays, toLocalDateInputValue } from '../../utils/date';
import { supabaseLeadCycleRepository } from '../../repositories/lead-cycle/supabaseLeadCycle.repository';

function isChip(record: ConfigRecord): record is ChipConfigRecord {
  return record.kind === 'chips';
}

async function getSelectedLeads(ids: string[]) {
  const batches = await repositories.whatsappQueue.listBatches({});
  const idSet = new Set(ids);
  return batches.flatMap((batch) => batch.leads).filter((lead) => idSet.has(lead.id));
}

async function loadActiveChips() {
  const settings = await settingsService.getDispatchSettings();
  const chips = (await repositories.config.list('chips')).filter(isChip).filter(isOperationalWhatsAppChip);
  return chips.map((chip) => ({
    ...chip,
    ...chipLevelDefaults(chip.level, settings.chipLevels),
  }));
}

async function assertLeadsUseOperationalChips(leads: WhatsAppQueueLead[]) {
  const operational = new Set((await loadActiveChips()).map(chipInstance));
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
  const chips = await loadActiveChips();
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
    let scheduledDate = targetDate;
    let key = `${instance}:${scheduledDate}`;

    while ((occupancy.get(key) ?? 0) >= dailyLimit) {
      scheduledDate = dateInputAddDays(scheduledDate, 1);
      key = `${instance}:${scheduledDate}`;
    }

    const nextPosition = (occupancy.get(key) ?? 0) + 1;
    occupancy.set(key, nextPosition);

    await repositories.whatsappQueue.updateLead(lead.id, {
      scheduled_date: scheduledDate,
      position: nextPosition,
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

function sourceLeadId(lead: WhatsAppQueueLead) {
  return lead.lead_id || lead.id;
}

function assertTemplateReady(leads: WhatsAppQueueLead[]) {
  const missing = leads.find((lead) => !hasAllTemplateMessages(lead) || lead.message1.toLowerCase().includes('template nao configurado'));
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
        { part: 'message_3', body: renderTemplateVariables(lead.message_3 || lead.message3, lead) },
        { part: 'message_4', body: renderTemplateVariables(lead.message_4 || lead.message4, lead) },
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
    leadId: lead.lead_id,
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

async function syncCanonicalSentStatus(leads: WhatsAppQueueLead[]) {
  await Promise.allSettled(leads.map(async (lead) => {
    const leadId = sourceLeadId(lead);
    if (!/^\d+$/.test(leadId)) return;
    const updated = await supabaseLeadCycleRepository.compareAndSet(leadId, LEAD_STATUS.QUEUED, { lead_status_id: LEAD_STATUS.SENT });
    if (updated) return;
    await repositories.events.append({
      source: 'whatsapp-queue',
      action: 'canonical_sent_sync_conflict',
      channel: 'whatsapp',
      leadId,
      queueItemId: lead.id,
      status: 'sent',
      metadata: {
        flow: 'F09',
        canonical_source: 'leads',
        expected_status_id: 4,
        target_status_id: 5,
      },
    });
  }));
}
async function finishSentPersistence({
  queueIds,
  leads,
  replayed = false,
}: {
  queueIds: string[];
  leads: WhatsAppQueueLead[];
  replayed?: boolean;
}) {
  // O estado do lead é atualizado; a Base Permanente consolidada é sincronizada pelos triggers do banco.
  if (leads.length) await syncCanonicalSentStatus(leads);
  if (queueIds.length) await repositories.whatsappQueue.send(queueIds);
  if (leads.length) await logDispatchMessages(leads, replayed);
}

export const whatsappQueueService = {
  async listQueuedForWorker(limit = 50) {
    await rolloverOverdueWhatsAppItems();
    const batches = await repositories.whatsappQueue.listBatches({});
    const operational = new Set((await loadActiveChips()).map(chipInstance));
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
    await finishSentPersistence({ queueIds: allowed, leads: allowedLeads, replayed: true });
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
    const configuredChips = await loadActiveChips();
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

  async getBatchStatus(chip?: string): Promise<WhatsAppBatchState> {
    return whatsappBatchGateway.status(chip);
  },

  async startBatch(ids: string[]): Promise<WhatsAppBatchState> {
    const leads = await getSelectedLeads(ids);
    if (!leads.length) throw new Error('Nenhum item foi encontrado para iniciar o lote.');

    // Um lote pode retomar itens pausados; eles voltam para queued antes de o
    // Worker persistente assumir a cadência. Itens finais/erro não entram.
    const blocked = leads.find((lead) =>
      !hasWhatsAppWorkerContract(lead) ||
      !(permissionsFor('whatsapp-queue', lead.status).canSend() || permissionsFor('whatsapp-queue', lead.status).canResume()),
    );
    if (blocked) throw new Error(`Item WhatsApp não pode iniciar lote: ${blocked.company || blocked.id}.`);

    await assertLeadsUseOperationalChips(leads);
    assertWorkerContractReady(leads);
    assertTemplateReady(leads);

    const instances = new Set(leads.map((lead) => lead.chip_instance || lead.chip).filter(Boolean));
    if (instances.size !== 1) throw new Error('Inicie um lote por chip. Selecione somente itens do mesmo chip.');
    const chip = Array.from(instances)[0];

    const paused = leads.filter((lead) => permissionsFor('whatsapp-queue', lead.status).canResume());
    if (paused.length) {
      await Promise.all(paused.map((lead) => repositories.whatsappQueue.updateLead(lead.id, { status: 'queued', error_message: '' })));
      paused.forEach((lead) => logQueueEvent('resume_for_batch', lead, 'queued'));
    }

    const state = await whatsappBatchGateway.start(ids, chip);
    eventBus.emit('whatsapp-queue:changed', { action: 'update' });
    return state;
  },

  async pauseBatch(chip?: string): Promise<WhatsAppBatchState> {
    const state = await whatsappBatchGateway.pause(chip);
    eventBus.emit('whatsapp-queue:changed', { action: 'update' });
    return state;
  },

  async resumeBatch(chip?: string): Promise<WhatsAppBatchState> {
    const state = await whatsappBatchGateway.resume(chip);
    eventBus.emit('whatsapp-queue:changed', { action: 'update' });
    return state;
  },

  async stopBatch(chip?: string): Promise<WhatsAppBatchState> {
    const state = await whatsappBatchGateway.stop(chip);
    eventBus.emit('whatsapp-queue:changed', { action: 'update' });
    return state;
  },

  async send(ids: string[]) {
    const leads = assertAllSendable(await getSelectedLeads(ids));
    await assertLeadsUseOperationalChips(leads);
    assertWorkerContractReady(leads);
    assertTemplateReady(leads);

    let results;
    try {
      results = await whatsappGateway.send(leads);
    } catch (error) {
      // O Worker persiste qualquer item que chegou a reivindicar. Se a chamada ao
      // proxy falhar, o painel não sobrescreve estados nem cria logs artificiais.
      eventBus.emit('whatsapp-queue:changed', { action: 'update' });
      throw new Error(`Não foi possível consultar o resultado do Worker. Atualize a fila antes de tentar novamente: ${error instanceof Error ? error.message : String(error)}`);
    }

    const byId = new Map(results.map((result) => [result.leadId, result]));
    const normalizedResults = leads.map((lead) => byId.get(lead.id) ?? ({
      leadId: lead.id,
      status: 'error' as const,
      errorMessage: 'Worker não retornou resultado para este item. Atualize a fila antes de reprocessar.',
    }));

    const sentIds = normalizedResults.filter((result) => result.status === 'sent').map((result) => result.leadId);
    const sentLeads = leads.filter((lead) => sentIds.includes(lead.id));
    const errorResults = normalizedResults.filter((result) => result.status === 'error');
    const pausedResults = normalizedResults.filter((result) => result.status === 'paused');

    sentLeads.forEach((lead) => logQueueEvent('sent_by_worker', lead, 'sent'));
    errorResults.forEach((result) => logQueueEvent(
      'worker_error',
      leads.find((lead) => lead.id === result.leadId) ?? { id: result.leadId },
      'error',
      result.errorMessage,
    ));
    pausedResults.forEach((result) => logQueueEvent(
      'worker_paused',
      leads.find((lead) => lead.id === result.leadId) ?? { id: result.leadId },
      'paused',
      result.errorMessage,
    ));

    eventBus.emit('whatsapp-queue:changed', { action: 'send' });
    if (sentLeads.length) eventBus.emit('base:changed', { action: 'update' });

    if (errorResults.length || pausedResults.length) {
      const details = [
        errorResults.length ? `${errorResults.length} com erro` : '',
        pausedResults.length ? `${pausedResults.length} pausado(s)` : '',
      ].filter(Boolean).join(' e ');
      throw new Error(`O Worker concluiu parcialmente o envio: ${details}. Consulte a fila antes de reprocessar.`);
    }
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
