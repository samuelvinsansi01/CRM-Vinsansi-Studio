import type { PreSendLead } from '../pre-send/types';
import { normalizePhone } from '../import/importValidation';

export type WhatsAppValidationMode = 'initial' | 'revalidation';

export type WhatsAppValidationRequest = {
  id: string;
  sourceImportId?: string;
  company: string;
  phone: string;
  normalizedPhone: string;
  chipInstance?: string;
};

export type WhatsAppValidationResult = {
  leadId: string;
  status: 'valid' | 'invalid' | 'error';
  valid: boolean;
  errorMessage?: string;
};

export interface WhatsAppValidationGateway {
  validate(leads: WhatsAppValidationRequest[], mode?: WhatsAppValidationMode): Promise<WhatsAppValidationResult[]>;
}

function validationEndpoint() {
  return String(import.meta.env.VITE_WHATSAPP_WORKER_VALIDATE_ENDPOINT ?? '').trim();
}

function resultLeadId(result: Record<string, unknown>) {
  return String(result.leadId ?? result.lead_id ?? result.id ?? result.queue_item_id ?? '');
}

function resultError(result: Record<string, unknown>) {
  return String(result.errorMessage ?? result.error_message ?? result.message ?? result.error ?? '').trim() || undefined;
}

function booleanLike(value: unknown) {
  if (value === true || value === false) return value;
  const text = String(value ?? '').trim().toLowerCase();
  if (['true', '1', 'yes', 'sim'].includes(text)) return true;
  if (['false', '0', 'no', 'nao', 'não'].includes(text)) return false;
  return undefined;
}

/** Recebe apenas confirmações explícitas produzidas pelo worker. */
function normalizeValidationResult(result: unknown): WhatsAppValidationResult | null {
  if (!result || typeof result !== 'object') return null;
  const record = result as Record<string, unknown>;
  const leadId = resultLeadId(record);
  if (!leadId) return null;

  const explicit = booleanLike(record.valid ?? record.exists ?? record.hasWhatsapp ?? record.has_whatsapp ?? record.isWhatsapp ?? record.is_whatsapp);
  const status = String(record.status ?? record.result ?? '').toLowerCase();
  const invalidStatus = ['invalid', 'whatsapp_invalid', 'not_found', 'no_whatsapp', 'not_on_whatsapp'].includes(status);

  if (explicit === false || invalidStatus) {
    return { leadId, status: 'invalid', valid: false, errorMessage: resultError(record) };
  }

  if (explicit === true) {
    return { leadId, status: 'valid', valid: true };
  }

  return {
    leadId,
    status: 'error',
    valid: false,
    errorMessage: resultError(record) ?? 'Worker nao retornou confirmação explícita de WhatsApp para este lead.',
  };
}

export function preSendLeadToWhatsAppValidationRequest(lead: PreSendLead): WhatsAppValidationRequest {
  return {
    id: lead.id,
    sourceImportId: lead.sourceImportId,
    company: lead.company,
    phone: lead.phone ?? '',
    normalizedPhone: normalizePhone(lead.phone),
    chipInstance: lead.profile,
  };
}

export const workerWhatsAppValidationGateway: WhatsAppValidationGateway = {
  async validate(leads, mode: WhatsAppValidationMode = 'initial') {
    const endpoint = validationEndpoint();
    if (!endpoint) throw new Error('Configure VITE_WHATSAPP_WORKER_VALIDATE_ENDPOINT para validar WhatsApp de verdade antes de aprovar leads.');

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel: 'whatsapp',
        mode,
        leads: leads.map((lead) => ({
          id: lead.id,
          lead_id: lead.sourceImportId,
          company: lead.company,
          phone: lead.phone,
          normalized_phone: lead.normalizedPhone,
          chip_instance: lead.chipInstance,
        })),
      }),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const message = payload?.message || payload?.error || response.statusText || 'Erro ao validar WhatsApp no worker.';
      throw new Error(Array.isArray(message) ? message.flat(Infinity).join(', ') : String(message));
    }

    const results: unknown[] = Array.isArray(payload?.results) ? payload.results : Array.isArray(payload) ? payload : [];
    const normalized = results.map(normalizeValidationResult).filter((item): item is WhatsAppValidationResult => Boolean(item));
    if (normalized.length !== leads.length) throw new Error('Worker WhatsApp nao retornou um resultado confiável para cada lead.');
    return normalized;
  },
};

export const whatsappValidationGateway = workerWhatsAppValidationGateway;
