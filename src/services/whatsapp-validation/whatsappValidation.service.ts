import { eventBus } from '../../lib/events';
import { repositories } from '../../repositories';
import { supabaseLeadCycleRepository } from '../../repositories/lead-cycle';
import type { LeadDatabaseRow } from '../../types/lead.types';
import { chipInstance, isOperationalWhatsAppChip } from '../config/chipOperational';
import { configService } from '../config/config.service';
import type { ChipConfigRecord } from '../config/types';
import { normalizePhone } from '../import/importValidation';
import {
  whatsappValidationGateway,
  WhatsAppValidationUnavailableError,
  type WhatsAppValidationRequest,
  type WhatsAppValidationResult,
} from './whatsappValidation.gateway';
import {
  expectedStatusForValidation,
  invalidWhatsAppTarget,
  isLikelyValidWhatsApp,
  validWhatsAppTarget,
  validationSelectionError,
} from './whatsappValidation.rules';
import type {
  WhatsAppValidationBatchResult,
  WhatsAppValidationFailure,
  WhatsAppValidationMode,
} from './types';

function emptyResult(mode: WhatsAppValidationMode, requested: number): WhatsAppValidationBatchResult {
  return {
    mode,
    requested,
    providerChecked: 0,
    approved: 0,
    revalidated: 0,
    redirectedToInstagram: 0,
    invalidated: 0,
    errors: 0,
    conflicts: 0,
    failed: 0,
    approvedIds: [],
    revalidatedIds: [],
    redirectedIds: [],
    invalidatedIds: [],
    errorIds: [],
    conflictIds: [],
    failures: [],
    auditWarnings: [],
  };
}

function addFailure(result: WhatsAppValidationBatchResult, failure: WhatsAppValidationFailure) {
  result.failures.push(failure);
  result.failed = result.failures.length;
}

function numericIds(ids: string[]) {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (!unique.length) throw new Error('Selecione pelo menos um lead para validar.');
  if (unique.some((id) => !Number.isSafeInteger(Number(id)) || Number(id) <= 0)) {
    throw new Error('Um ou mais identificadores de lead são inválidos.');
  }
  return unique;
}

function rowsById(rows: LeadDatabaseRow[]) {
  return new Map(rows.map((row) => [String(row.leads_id), row]));
}

function validateSelection(ids: string[], byId: Map<string, LeadDatabaseRow>, mode: WhatsAppValidationMode) {
  const failures: WhatsAppValidationFailure[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) {
      failures.push({ id, reason: 'Lead não encontrado ou sem permissão de acesso.' });
      continue;
    }
    const reason = validationSelectionError(row, mode);
    if (reason) failures.push({ id, company: row.leads_name, reason });
  }
  return failures;
}

async function operationalChips() {
  const records = await configService.list('chips');
  return records
    .filter((record): record is ChipConfigRecord => record.kind === 'chips')
    .filter(isOperationalWhatsAppChip)
    .sort((left, right) => Number(left.priority ?? 0) - Number(right.priority ?? 0) || left.name.localeCompare(right.name));
}

function requestsForRows(rows: LeadDatabaseRow[], chips: ChipConfigRecord[]): WhatsAppValidationRequest[] {
  return rows.map((row, index) => ({
    id: String(row.leads_id),
    sourceImportId: String(row.leads_id),
    company: row.leads_name,
    phone: row.leads_phone ?? '',
    normalizedPhone: normalizePhone(row.leads_phone),
    chipInstance: chipInstance(chips[index % chips.length]),
  }));
}

async function appendAudit(input: {
  action: string;
  row: LeadDatabaseRow;
  status: string;
  message?: string;
  metadata?: Record<string, unknown>;
}) {
  await repositories.events.append({
    source: 'whatsapp-validation',
    action: input.action,
    channel: 'whatsapp',
    leadId: String(input.row.leads_id),
    status: input.status,
    message: input.message,
    metadata: {
      flow: 'F05',
      company_name: input.row.leads_name,
      normalized_phone: normalizePhone(input.row.leads_phone),
      previous_status_id: input.row.lead_status_id,
      previous_channel_id: input.row.channels_id,
      ...input.metadata,
    },
  });
}

function addOutcome(result: WhatsAppValidationBatchResult, id: string, outcome: 'approved' | 'revalidated' | 'redirected' | 'invalidated') {
  if (outcome === 'approved') {
    result.approved += 1;
    result.approvedIds.push(id);
  } else if (outcome === 'revalidated') {
    result.revalidated += 1;
    result.revalidatedIds.push(id);
  } else if (outcome === 'redirected') {
    result.redirectedToInstagram += 1;
    result.redirectedIds.push(id);
  } else {
    result.invalidated += 1;
    result.invalidatedIds.push(id);
  }
}

async function applyConfirmedResult(
  batch: WhatsAppValidationBatchResult,
  row: LeadDatabaseRow,
  mode: WhatsAppValidationMode,
  providerResult: WhatsAppValidationResult | null,
  localReason?: string,
) {
  const id = String(row.leads_id);
  if (providerResult?.status === 'error') {
    batch.errors += 1;
    batch.errorIds.push(id);
    const reason = providerResult.errorMessage || 'O provedor não retornou confirmação explícita para este número.';
    try {
      await appendAudit({
        action: mode === 'initial' ? 'whatsapp_validation_error' : 'whatsapp_revalidation_error',
        row,
        status: String(row.lead_status_id),
        message: reason,
        metadata: { unchanged: true, provider_status: 'error' },
      });
    } catch (error) {
      batch.auditWarnings.push(`Lead ${id}: ${error instanceof Error ? error.message : 'falha ao registrar auditoria.'}`);
    }
    return;
  }

  const valid = providerResult?.valid === true;
  const target = valid ? validWhatsAppTarget(mode) : invalidWhatsAppTarget(row);
  const after = await supabaseLeadCycleRepository.compareAndSet(id, expectedStatusForValidation(mode), {
    lead_status_id: target.statusId,
    channels_id: target.channelId,
  });

  if (!after) {
    batch.conflicts += 1;
    batch.conflictIds.push(id);
    addFailure(batch, {
      id,
      company: row.leads_name,
      reason: 'O lead foi alterado por outra operação durante a validação. Atualize a tela antes de tentar novamente.',
    });
    return;
  }

  addOutcome(batch, id, target.outcome);
  const invalidReason = localReason || providerResult?.errorMessage || 'Número não confirmado como WhatsApp.';
  const action = valid
    ? mode === 'initial' ? 'whatsapp_validation_approved' : 'whatsapp_revalidation_approved'
    : target.outcome === 'redirected' ? 'whatsapp_invalid_redirected_to_instagram' : 'whatsapp_invalid_without_instagram';

  try {
    await appendAudit({
      action,
      row,
      status: String(target.statusId),
      message: valid ? 'WhatsApp confirmado pelo provedor.' : invalidReason,
      metadata: {
        target_status_id: target.statusId,
        target_channel_id: target.channelId,
        validation_mode: mode,
        provider_status: providerResult?.status ?? 'local_invalid_format',
        instagram_fallback: target.outcome === 'redirected',
        unchanged: false,
      },
    });
  } catch (error) {
    batch.auditWarnings.push(`Lead ${id}: ${error instanceof Error ? error.message : 'falha ao registrar auditoria.'}`);
  }
}

async function executeValidation(mode: WhatsAppValidationMode, rawIds: string[]) {
  const ids = numericIds(rawIds);
  const result = emptyResult(mode, ids.length);
  const rows = await supabaseLeadCycleRepository.listByIds(ids);
  const byId = rowsById(rows);
  const selectionFailures = validateSelection(ids, byId, mode);

  if (selectionFailures.length) {
    const invalid = new Set(selectionFailures.map((failure) => failure.id));
    selectionFailures.forEach((failure) => addFailure(result, failure));
    ids.filter((id) => !invalid.has(id)).forEach((id) => addFailure(result, {
      id,
      company: byId.get(id)?.leads_name,
      reason: 'Validação não iniciada porque o lote contém leads inválidos ou desatualizados.',
    }));
    return result;
  }

  const selected = ids.map((id) => byId.get(id)!);
  const malformed = selected.filter((row) => !isLikelyValidWhatsApp(row.leads_phone));
  const remoteCandidates = selected.filter((row) => isLikelyValidWhatsApp(row.leads_phone));

  let providerById = new Map<string, WhatsAppValidationResult>();
  if (remoteCandidates.length) {
    const chips = await operationalChips();
    if (!chips.length) {
      throw new WhatsAppValidationUnavailableError('Nenhum chip WhatsApp ativo e conectado está disponível para validação. Nenhum lead do lote foi alterado.');
    }

    // O provider é consultado antes da primeira mutação. Se o Worker/Evolution
    // estiver indisponível ou devolver um contrato inválido, o lote inteiro
    // permanece exatamente no estado anterior.
    const requests = requestsForRows(remoteCandidates, chips);
    const providerResults = mode === 'initial'
      ? await whatsappValidationGateway.validateInitial(requests)
      : await whatsappValidationGateway.revalidateApproved(requests);
    result.providerChecked = providerResults.length;
    providerById = new Map(providerResults.map((item) => [item.leadId, item]));
  }

  // Formato inequivocamente inválido é tratado localmente somente depois que o
  // preflight remoto do mesmo lote foi concluído com sucesso.
  for (const row of malformed) {
    await applyConfirmedResult(result, row, mode, null, 'Telefone fora do formato brasileiro esperado para WhatsApp.');
  }

  for (const row of remoteCandidates) {
    const providerResult = providerById.get(String(row.leads_id));
    if (!providerResult) {
      // O gateway já protege a cardinalidade. Este fallback mantém o serviço fail-closed.
      result.errors += 1;
      result.errorIds.push(String(row.leads_id));
      continue;
    }
    await applyConfirmedResult(result, row, mode, providerResult);
  }

  if (result.approved || result.revalidated || result.redirectedToInstagram || result.invalidated) {
    eventBus.emit('pre-send:changed', { action: mode === 'initial' ? 'validate' : 'whatsapp-revalidate' });
    eventBus.emit('import:changed', { source: 'move' });
  }
  return result;
}

export const whatsappValidationService = {
  validateInitial(ids: string[]) {
    return executeValidation('initial', ids);
  },
  revalidateApproved(ids: string[]) {
    return executeValidation('revalidation', ids);
  },
};
