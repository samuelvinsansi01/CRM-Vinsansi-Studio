import { normalizePhone } from '../import/importValidation';
import {
  whatsappValidationGateway,
  WhatsAppValidationUnavailableError,
  type WhatsAppValidationRequest,
} from './whatsappValidation.gateway';
import type { WhatsAppValidationBatchResult, WhatsAppValidationFailure } from './types';

export type PreparedWhatsAppValidationLead = {
  id: string;
  reviewItemId?: string;
  company: string;
  phone: string;
  normalizedPhone: string;
};

function emptyResult(requested: number): WhatsAppValidationBatchResult {
  return {
    mode: 'initial', requested, providerChecked: 0, approved: 0,
    redirectedToInstagram: 0, invalidated: 0, errors: 0, failed: 0,
    approvedIds: [], redirectedIds: [], invalidatedIds: [], errorIds: [], failures: [],
  };
}

function addFailure(result: WhatsAppValidationBatchResult, failure: WhatsAppValidationFailure) {
  result.failures.push(failure);
  result.failed = result.failures.length;
}

async function validatePreparedInitial(leadsInput: PreparedWhatsAppValidationLead[], chipInstanceName: string) {
  const unique = new Map(leadsInput.filter((lead) => lead.id).map((lead) => [lead.id, lead]));
  const leads = Array.from(unique.values());
  if (!leads.length) throw new Error('Nenhum lead foi reservado para validação.');

  const chipInstance = chipInstanceName.trim();
  if (!chipInstance) throw new WhatsAppValidationUnavailableError('A instância Evolution do chip selecionado não está disponível.');

  const result = emptyResult(leads.length);
  const invalidPrepared = leads.filter((lead) => normalizePhone(lead.normalizedPhone || lead.phone).length < 12);
  if (invalidPrepared.length) {
    invalidPrepared.forEach((lead) => addFailure(result, { id: lead.id, company: lead.company, reason: 'Telefone inválido para WhatsApp.' }));
    return result;
  }

  const requests: WhatsAppValidationRequest[] = leads.map((lead) => ({
    id: lead.id,
    reviewItemId: lead.reviewItemId,
    company: lead.company,
    phone: lead.phone,
    normalizedPhone: normalizePhone(lead.normalizedPhone || lead.phone),
    chipInstance,
  }));

  const providerResults = await whatsappValidationGateway.validateInitial(requests);
  result.providerChecked = providerResults.length;
  const providerById = new Map(providerResults.map((item) => [item.leadId, item]));

  for (const lead of leads) {
    const providerResult = providerById.get(lead.id);
    if (!providerResult?.persisted || !providerResult.outcome) {
      addFailure(result, { id: lead.id, company: lead.company, reason: 'A API não confirmou a persistência do resultado.' });
      continue;
    }
    if (providerResult.outcome === 'approved') {
      result.approved += 1;
      result.approvedIds.push(lead.id);
    } else if (providerResult.outcome === 'instagram_review_required') {
      result.redirectedToInstagram += 1;
      result.redirectedIds.push(lead.id);
    } else if (providerResult.outcome === 'no_contact') {
      result.invalidated += 1;
      result.invalidatedIds.push(lead.id);
    } else {
      result.errors += 1;
      result.errorIds.push(lead.id);
    }
  }
  return result;
}

export const whatsappValidationService = { validatePreparedInitial };
