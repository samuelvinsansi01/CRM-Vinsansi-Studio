import { eventBus } from '../../lib/events';
import { repositories } from '../../repositories';
import type { BaseLead, BaseLeadStatus } from '../base/types';
import { findDuplicate, type LeadDuplicateMatch } from './lead-duplicate.service';

export type LeadValidationResult = {
  leadId: string;
  previousStatus: BaseLeadStatus;
  status: 'validado' | 'invalido' | 'duplicado';
  reason?: string;
  duplicate?: LeadDuplicateMatch;
};

export type LeadValidationSummary = {
  processed: number;
  validated: number;
  invalid: number;
  duplicated: number;
  skipped: number;
  results: LeadValidationResult[];
};

function validationError(lead: BaseLead) {
  if (!lead.company.trim()) return 'Nome da empresa ausente.';
  const hasPhone = Boolean(String(lead.normalizedPhone || lead.phone || '').replace(/\D/g, ''));
  const hasInstagram = Boolean(String(lead.normalizedInstagram || lead.instagram || '').trim());
  if (!hasPhone && !hasInstagram) return 'Lead sem telefone e sem Instagram.';
  return null;
}

export async function updateStatus(id: string, status: BaseLeadStatus) {
  return repositories.base.setStatus(id, status);
}

function evaluateLead(lead: BaseLead, records: BaseLead[]): LeadValidationResult {
  const error = validationError(lead);
  if (error) return { leadId: lead.id, previousStatus: lead.status, status: 'invalido', reason: error };

  const duplicate = findDuplicate(lead, records.filter((candidate) => Number(candidate.id) < Number(lead.id)));
  if (duplicate) {
    return {
      leadId: lead.id,
      previousStatus: lead.status,
      status: 'duplicado',
      reason: `Duplicado por ${duplicate.field} do lead #${duplicate.lead.id}.`,
      duplicate,
    };
  }

  return { leadId: lead.id, previousStatus: lead.status, status: 'validado' };
}

async function persistResults(results: LeadValidationResult[]) {
  const chunkSize = 25;
  for (let index = 0; index < results.length; index += chunkSize) {
    const chunk = results.slice(index, index + chunkSize);
    await Promise.all(chunk.map((result) => updateStatus(result.leadId, result.status)));
  }
}

export async function validateMany(ids?: string[]): Promise<LeadValidationSummary> {
  const records = await repositories.base.list({});
  const selectedIds = ids ? new Set(ids) : null;
  const targets = records
    .filter((lead) => lead.status === 'importado')
    .filter((lead) => !selectedIds || selectedIds.has(lead.id))
    .sort((a, b) => Number(a.id) - Number(b.id));

  const skipped = ids ? Math.max(0, new Set(ids).size - targets.length) : 0;
  const workingRecords = records.map((lead) => ({ ...lead }));
  const results: LeadValidationResult[] = [];

  for (const target of targets) {
    const current = workingRecords.find((lead) => lead.id === target.id) ?? target;
    const result = evaluateLead(current, workingRecords);
    results.push(result);
    current.status = result.status;
  }

  await persistResults(results);
  if (results.length) eventBus.emit('base:changed', { action: 'status' });

  return {
    processed: results.length,
    validated: results.filter((result) => result.status === 'validado').length,
    invalid: results.filter((result) => result.status === 'invalido').length,
    duplicated: results.filter((result) => result.status === 'duplicado').length,
    skipped,
    results,
  };
}

export async function validateLead(id: string) {
  const summary = await validateMany([id]);
  const result = summary.results[0];
  if (!result) throw new Error('O lead não foi encontrado ou não está com status importado.');
  return result;
}

export const leadValidationService = { validateLead, validateMany, updateStatus };
