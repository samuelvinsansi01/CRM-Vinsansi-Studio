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
import { hasAllTemplateMessages } from '../templates/templateContract';
import { toLocalDateInputValue } from '../../utils/date';
import { queueCapacityRollover } from '../queue-rollover/queueCapacityRollover.service';
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

function queueRolloverTargetDate() {
  // R59 FIX 17: corte real à meia-noite local. A redistribuição e a capacidade
  // são calculadas atomicamente no banco, incluindo Revisão + Fila final.
  return toLocalDateInputValue();
}

let whatsappRolloverPromise: Promise<void> | null = null;

async function runWhatsAppRollover() {
  await queueCapacityRollover.run('whatsapp', queueRolloverTargetDate());
}

async function rolloverOverdueWhatsAppItems() {
  if (!whatsappRolloverPromise) {
    whatsappRolloverPromise = runWhatsAppRollover().finally(() => {
      whatsappRolloverPromise = null;
    });
  }
  await whatsappRolloverPromise;
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
  if (missing) throw new Error(`Template WhatsApp ausente ou sem Mensagem 1/sequência válida para ${missing.branch} / ${missing.type}.`);
}

function assertWorkerContractReady(leads: WhatsAppQueueLead[]) {
  const missing = leads.find((lead) => !hasWhatsAppWorkerContract(lead));
  if (!missing) return;
  throw new Error(`Item WhatsApp sem contrato de worker (${missing.company || missing.id}): ${missingWhatsAppWorkerFields(missing).join(', ')}.`);
}



async function syncCanonicalSentStatus(leads: WhatsAppQueueLead[]) {
  await Promise.allSettled(leads.map(async (lead) => {
    const leadId = sourceLeadId(lead);
    if (!/^\d+$/.test(leadId)) return;
    const updated = await supabaseLeadCycleRepository.compareAndSet(leadId, LEAD_STATUS.QUEUED, { lead_status_id: LEAD_STATUS.SENT });
    if (updated) return;
    console.warn(`Lead ${leadId} não estava mais em Na fila ao sincronizar Enviado; mantendo o estado canônico atual.`);
  }));
}
async function finishSentPersistence({
  queueIds,
  leads,
}: {
  queueIds: string[];
  leads: WhatsAppQueueLead[];
}) {
  // O estado do lead é atualizado; a Base Permanente consolidada é sincronizada pelos triggers do banco.
  if (leads.length) await syncCanonicalSentStatus(leads);
  if (queueIds.length) await repositories.whatsappQueue.send(queueIds);
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
    eventBus.emit('whatsapp-queue:changed', { action: 'sending' });
  },

  async markSent(ids: string[]) {
    const sentLeads = await getSelectedLeads(ids);
    const allowed = assertAllAllowed(sentLeads, 'mark_sent', 'sent', 'Todos os itens selecionados precisam estar em envio para marcar como enviados.');
    const allowedLeads = sentLeads.filter((lead) => allowed.includes(lead.id));
    await finishSentPersistence({ queueIds: allowed, leads: allowedLeads });
    eventBus.emit('whatsapp-queue:changed', { action: 'worker-sent' });
    if (allowedLeads.length) eventBus.emit('base:changed', { action: 'update' });
  },

  async registerError(id: string, message: string) {
    const [lead] = await getSelectedLeads([id]);
    if (lead) assertTransition({ entity: 'whatsapp-queue', fromStatus: lead.status, toStatus: 'error', action: 'fail' });
    await repositories.whatsappQueue.updateLead(id, { status: 'error', error_message: message });
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
    try {
      return await whatsappBatchGateway.status(chip);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('batch_not_found')) {
        return { status: 'idle', enabled: false, chip: chip ?? '', total: 0, remaining: 0 };
      }
      throw error;
    }
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
