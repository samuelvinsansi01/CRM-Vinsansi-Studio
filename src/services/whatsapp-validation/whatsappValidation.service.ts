import { eventBus } from '../../lib/events';
import { supabaseLeadCycleRepository } from '../../repositories/lead-cycle';
import { channelId } from '../../repositories/schemaCatalog';
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
import { validationSelectionError } from './whatsappValidation.rules';
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

function validateSelection(ids: string[], byId: Map<string, LeadDatabaseRow>, mode: WhatsAppValidationMode, whatsappChannelId: number) {
  const failures: WhatsAppValidationFailure[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) {
      failures.push({ id, reason: 'Lead não encontrado ou sem permissão de acesso.' });
      continue;
    }
    const reason = validationSelectionError(row, mode, whatsappChannelId);
    if (reason) failures.push({ id, company: row.leads_name, reason });
  }
  return failures;
}

async function operationalChips(selectedResourceId?: string) {
  const records = await configService.list('chips');
  const chips = records
    .filter((record): record is ChipConfigRecord => record.kind === 'chips')
    .filter(isOperationalWhatsAppChip)
    .sort((left, right) => Number(left.priority ?? 0) - Number(right.priority ?? 0) || left.name.localeCompare(right.name));
  if (!selectedResourceId) return chips;
  return chips.filter((chip) => chip.id === selectedResourceId || chipInstance(chip) === selectedResourceId);
}

function requestsForRows(rows: LeadDatabaseRow[], chips: ChipConfigRecord[]): WhatsAppValidationRequest[] {
  return rows.map((row, index) => ({
    id: String(row.leads_id),
    sourceImportId: String(row.leads_id),
    company: row.leads_name,
    phone: row.leads_whatsapp || row.leads_phone || '',
    normalizedPhone: normalizePhone(row.leads_whatsapp || row.leads_phone),
    chipInstance: chipInstance(chips[index % chips.length]),
  }));
}

function addOutcome(result: WhatsAppValidationBatchResult, id: string, outcome: NonNullable<WhatsAppValidationResult['outcome']>) {
  if (outcome === 'approved') {
    result.approved += 1;
    result.approvedIds.push(id);
  } else if (outcome === 'revalidated') {
    result.revalidated += 1;
    result.revalidatedIds.push(id);
  } else if (outcome === 'instagram_review_required') {
    result.redirectedToInstagram += 1;
    result.redirectedIds.push(id);
  } else {
    result.errors += 1;
    result.errorIds.push(id);
  }
}

function applyPersistedResult(batch: WhatsAppValidationBatchResult, row: LeadDatabaseRow, providerResult: WhatsAppValidationResult) {
  const id = String(row.leads_id);
  if (providerResult.persisted !== true || !providerResult.outcome) {
    addFailure(batch, { id, company: row.leads_name, reason: 'A API não confirmou a persistência do resultado.' });
    return;
  }
  if ((providerResult.outcome === 'approved' || providerResult.outcome === 'revalidated') && providerResult.proofValid !== true) {
    addFailure(batch, { id, company: row.leads_name, reason: 'O WhatsApp confirmou o número, mas a prova do telefone atual não foi persistida. Tente validar novamente.' });
    return;
  }
  addOutcome(batch, id, providerResult.outcome);
}

async function executeValidation(mode: WhatsAppValidationMode, rawIds: string[], selectedResourceId?: string) {
  const ids = numericIds(rawIds);
  const result = emptyResult(mode, ids.length);
  const whatsappChannelId = Number(await channelId('WhatsApp'));
  const rows = await supabaseLeadCycleRepository.listByIds(ids);
  const byId = rowsById(rows);
  const selectionFailures = validateSelection(ids, byId, mode, whatsappChannelId);

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
  const chips = await operationalChips(selectedResourceId);
  if (!chips.length) {
    throw new WhatsAppValidationUnavailableError(selectedResourceId
      ? 'O chip selecionado não está ativo e conectado. Nenhum lead do lote foi alterado.'
      : 'Nenhum chip WhatsApp ativo e conectado está disponível para validação. Nenhum lead do lote foi alterado.');
  }

  const requests = requestsForRows(selected, chips);
  const providerResults = mode === 'initial'
    ? await whatsappValidationGateway.validateInitial(requests)
    : await whatsappValidationGateway.revalidateApproved(requests);
  result.providerChecked = providerResults.length;
  const providerById = new Map(providerResults.map((item) => [item.leadId, item]));

  for (const row of selected) {
    const providerResult = providerById.get(String(row.leads_id));
    if (!providerResult) {
      addFailure(result, { id: String(row.leads_id), company: row.leads_name, reason: 'A API não retornou o resultado persistido deste lead.' });
      continue;
    }
    applyPersistedResult(result, row, providerResult);
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
  validateInitialWithChip(ids: string[], selectedResourceId: string) {
    return executeValidation('initial', ids, selectedResourceId);
  },
  revalidateApproved(ids: string[]) {
    return executeValidation('revalidation', ids);
  },
  revalidateApprovedWithChip(ids: string[], selectedResourceId: string) {
    return executeValidation('revalidation', ids, selectedResourceId);
  },
};
