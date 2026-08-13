import { repositories } from '../../repositories';
import { channelId } from '../../repositories/schemaCatalog';
import { supabaseLeadCycleRepository } from '../../repositories/lead-cycle';
import type { LeadDatabaseRow } from '../../types/lead.types';
import { queuePreparationService } from '../queue-preparation';
import { LEAD_STATUS } from '../status/leadStatus';
import { whatsappValidationService } from './whatsappValidation.service';
import { calculatePersistedLeadPriorityScore } from '../lead-score/leadScore.service';
import type { WhatsAppValidationBatchResult, WhatsAppValidationFailure } from './types';

const activeRuns = new Set<string>();

export type WhatsAppCapacityValidationResult = {
  resourceId: string;
  resourceLabel: string;
  effectiveDate: string;
  dailyLimit: number;
  usedBefore: number;
  availableBefore: number;
  alreadyValidatedQueued: number;
  candidatesChecked: number;
  providerChecked: number;
  approved: number;
  redirectedToInstagram: number;
  invalidated: number;
  errors: number;
  conflicts: number;
  queued: number;
  queueFailures: number;
  remainingCapacity: number;
  exhaustedCandidates: boolean;
  failures: WhatsAppValidationFailure[];
  auditWarnings: string[];
};

function candidateOrder(left: LeadDatabaseRow, right: LeadDatabaseRow) {
  const statusPriority = Number(left.lead_status_id === LEAD_STATUS.PRE_SEND) - Number(right.lead_status_id === LEAD_STATUS.PRE_SEND);
  if (statusPriority) return -statusPriority;
  const score = calculatePersistedLeadPriorityScore(right as unknown as Record<string, unknown>) - calculatePersistedLeadPriorityScore(left as unknown as Record<string, unknown>);
  if (score) return score;
  const created = String(left.leads_created_at ?? '').localeCompare(String(right.leads_created_at ?? ''));
  if (created) return created;
  return Number(left.leads_id) - Number(right.leads_id);
}

async function appendRoutingAudit(row: LeadDatabaseRow, whatsappChannelId: number) {
  await repositories.events.append({
    source: 'capacity-validation',
    action: 'route_imported_to_whatsapp_validation',
    channel: 'whatsapp',
    leadId: String(row.leads_id),
    status: String(LEAD_STATUS.PRE_SEND),
    metadata: {
      flow: 'F04/F05',
      company_name: row.leads_name,
      previous_status_id: LEAD_STATUS.IMPORTED,
      target_status_id: LEAD_STATUS.PRE_SEND,
      target_channel_id: whatsappChannelId,
    },
  });
}

async function moveImportedCandidate(row: LeadDatabaseRow, whatsappChannelId: number, auditWarnings: string[]) {
  if (row.lead_status_id === LEAD_STATUS.PRE_SEND) return true;
  const updated = await supabaseLeadCycleRepository.compareAndSet(String(row.leads_id), LEAD_STATUS.IMPORTED, {
    lead_status_id: LEAD_STATUS.PRE_SEND,
    channels_id: whatsappChannelId,
  });
  if (!updated) return false;
  try {
    await appendRoutingAudit(row, whatsappChannelId);
  } catch (error) {
    auditWarnings.push(`Lead ${row.leads_id}: ${error instanceof Error ? error.message : 'falha ao registrar auditoria de roteamento.'}`);
  }
  return true;
}

function addValidationResult(target: WhatsAppCapacityValidationResult, batch: WhatsAppValidationBatchResult) {
  target.candidatesChecked += batch.requested;
  target.providerChecked += batch.providerChecked;
  target.approved += batch.approved + batch.revalidated;
  target.redirectedToInstagram += batch.redirectedToInstagram;
  target.invalidated += batch.invalidated;
  target.errors += batch.errors;
  target.conflicts += batch.conflicts;
  target.failures.push(...batch.failures);
  target.auditWarnings.push(...batch.auditWarnings);
}

async function enqueueReadyValidated(
  ids: string[],
  requestedDate: string,
  resourceId: string,
  result: WhatsAppCapacityValidationResult,
  existing: boolean,
) {
  if (!ids.length) return;
  const queued = await queuePreparationService.enqueueValidated('WhatsApp', ids, requestedDate, resourceId);
  result.queued += queued.queued;
  if (existing) result.alreadyValidatedQueued += queued.queued;
  result.queueFailures += queued.failed;
  result.conflicts += queued.conflicts;
  result.failures.push(...queued.failures);
  result.auditWarnings.push(...queued.auditWarnings);
}

export const whatsappCapacityValidationService = {
  async validateAndFill(resourceId: string, requestedDate: string): Promise<WhatsAppCapacityValidationResult> {
    if (!resourceId) throw new Error('Selecione um chip ativo e conectado.');
    const initialSnapshot = await queuePreparationService.snapshot('WhatsApp', requestedDate, resourceId);
    const resource = initialSnapshot.resources.find((item) => item.id === resourceId);
    if (!resource) throw new Error('O chip selecionado não está ativo e conectado.');

    const lockKey = `${resource.id}:${initialSnapshot.effectiveDate}`;
    if (activeRuns.has(lockKey)) throw new Error('Já existe uma validação em andamento para este chip e esta data.');
    activeRuns.add(lockKey);

    const result: WhatsAppCapacityValidationResult = {
      resourceId: resource.id,
      resourceLabel: resource.label,
      effectiveDate: initialSnapshot.effectiveDate,
      dailyLimit: resource.dailyLimit,
      usedBefore: resource.used,
      availableBefore: resource.available,
      alreadyValidatedQueued: 0,
      candidatesChecked: 0,
      providerChecked: 0,
      approved: 0,
      redirectedToInstagram: 0,
      invalidated: 0,
      errors: 0,
      conflicts: 0,
      queued: 0,
      queueFailures: 0,
      remainingCapacity: resource.available,
      exhaustedCandidates: false,
      failures: [],
      auditWarnings: [],
    };

    try {
      if (resource.available <= 0) return result;

      // Não validamos novos números enquanto já existirem leads confirmados e
      // prontos para ocupar as vagas do chip escolhido.
      const existingReadyIds = initialSnapshot.leads
        .filter((lead) => lead.ready)
        .slice(0, resource.available)
        .map((lead) => lead.id);
      await enqueueReadyValidated(existingReadyIds, requestedDate, resource.id, result, true);

      let currentSnapshot = await queuePreparationService.snapshot('WhatsApp', requestedDate, resource.id);
      let currentResource = currentSnapshot.resources.find((item) => item.id === resource.id);
      if (!currentResource) throw new Error('O chip deixou de estar ativo durante a operação.');
      let validationSlots = currentResource.available;
      if (validationSlots <= 0) {
        result.remainingCapacity = 0;
        return result;
      }

      const whatsappChannelId = Number(await channelId('WhatsApp'));
      const missingProofIds = new Set(initialSnapshot.leads
        .filter((lead) => lead.requiresWhatsAppValidation)
        .map((lead) => lead.id));
      const [validated, preSend, imported] = await Promise.all([
        supabaseLeadCycleRepository.listByStatuses([LEAD_STATUS.VALIDATED], whatsappChannelId),
        supabaseLeadCycleRepository.listByStatuses([LEAD_STATUS.PRE_SEND], whatsappChannelId),
        supabaseLeadCycleRepository.listByStatuses([LEAD_STATUS.IMPORTED], whatsappChannelId),
      ]);
      const legacyWithoutProof = validated.filter((row) => missingProofIds.has(String(row.leads_id)));
      const candidates = [...legacyWithoutProof, ...preSend, ...imported].sort(candidateOrder);
      let cursor = 0;

      while (validationSlots > 0 && cursor < candidates.length) {
        currentSnapshot = await queuePreparationService.snapshot('WhatsApp', requestedDate, resource.id);
        currentResource = currentSnapshot.resources.find((item) => item.id === resource.id);
        if (!currentResource) throw new Error('O chip deixou de estar ativo durante a operação.');
        if (currentResource.available <= 0) break;

        const targetBatchSize = Math.max(1, Math.min(validationSlots, currentResource.available, currentResource.batchSize));
        const batchIds: string[] = [];
        const batchMode = candidates[cursor]?.lead_status_id === LEAD_STATUS.VALIDATED ? 'revalidation' : 'initial';

        while (batchIds.length < targetBatchSize && cursor < candidates.length) {
          const candidate = candidates[cursor];
          const candidateMode = candidate.lead_status_id === LEAD_STATUS.VALIDATED ? 'revalidation' : 'initial';
          if (candidateMode !== batchMode) break;
          cursor += 1;
          try {
            const ready = batchMode === 'revalidation'
              ? true
              : await moveImportedCandidate(candidate, whatsappChannelId, result.auditWarnings);
            if (!ready) {
              result.conflicts += 1;
              result.failures.push({
                id: String(candidate.leads_id),
                company: candidate.leads_name,
                reason: 'O lead mudou de etapa antes de entrar na validação.',
              });
              continue;
            }
            batchIds.push(String(candidate.leads_id));
          } catch (error) {
            result.failures.push({
              id: String(candidate.leads_id),
              company: candidate.leads_name,
              reason: error instanceof Error ? error.message : 'Falha ao preparar o lead para validação.',
            });
          }
        }

        if (!batchIds.length) continue;
        const validation = batchMode === 'revalidation'
          ? await whatsappValidationService.revalidateApprovedWithChip(batchIds, resource.id)
          : await whatsappValidationService.validateInitialWithChip(batchIds, resource.id);
        addValidationResult(result, validation);

        // Apenas confirmações válidas consomem o orçamento de validação do chip.
        // Inválidos, redirecionados e erros liberam a vaga para o próximo candidato.
        const confirmedIds = [...validation.approvedIds, ...validation.revalidatedIds];
        validationSlots = Math.max(0, validationSlots - confirmedIds.length);
        await enqueueReadyValidated(confirmedIds, requestedDate, resource.id, result, false);
      }

      const finalSnapshot = await queuePreparationService.snapshot('WhatsApp', requestedDate, resource.id);
      const finalResource = finalSnapshot.resources.find((item) => item.id === resource.id);
      result.remainingCapacity = finalResource?.available ?? 0;
      result.exhaustedCandidates = cursor >= candidates.length && result.remainingCapacity > 0;
      return result;
    } finally {
      activeRuns.delete(lockKey);
    }
  },
};
