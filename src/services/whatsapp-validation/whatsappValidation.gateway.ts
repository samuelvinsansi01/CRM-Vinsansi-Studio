import { getSupabaseClient } from '../../lib/supabase';

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
  validateInitial(leads: WhatsAppValidationRequest[]): Promise<WhatsAppValidationResult[]>;
  revalidateApproved(leads: WhatsAppValidationRequest[]): Promise<WhatsAppValidationResult[]>;
}

type ValidationOperation = 'validate' | 'revalidate';
type ValidationMode = 'initial' | 'revalidation';

/** Infraestrutura indisponível: a operação foi interrompida antes de alterar qualquer lead. */
export class WhatsAppValidationUnavailableError extends Error {
  readonly code = 'validation_unavailable';

  constructor(message: string) {
    super(message);
    this.name = 'WhatsAppValidationUnavailableError';
  }
}

function initialValidationEndpoint() {
  return String(import.meta.env.VITE_WHATSAPP_WORKER_VALIDATE_ENDPOINT ?? '/api/whatsapp/validate').trim();
}

function revalidationEndpoint() {
  return String(import.meta.env.VITE_WHATSAPP_WORKER_REVALIDATE_ENDPOINT ?? '/api/whatsapp/revalidate').trim();
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

function assertOneResultForEachLead(leads: WhatsAppValidationRequest[], normalized: WhatsAppValidationResult[]) {
  const expected = new Set(leads.map((lead) => lead.id));
  const received = normalized.map((result) => result.leadId);
  const uniqueReceived = new Set(received);

  if (
    normalized.length !== leads.length ||
    uniqueReceived.size !== leads.length ||
    received.some((leadId) => !expected.has(leadId))
  ) {
    throw new Error('Worker WhatsApp retornou resultados sem correspondência exata dos leads solicitados. Nenhum lead será aprovado.');
  }
}


async function authenticatedHeaders(operation: ValidationOperation) {
  const { data, error } = await getSupabaseClient().auth.getSession();
  if (error) throw new Error(error.message);
  const token = data.session?.access_token;
  if (!token) throw new Error('Sessão inválida. Entre novamente no painel.');
  return {
    'Content-Type': 'application/json',
    'X-Lead-Certo-Operation': operation,
    Authorization: `Bearer ${token}`,
  };
}

async function callValidationWorker(
  endpoint: string,
  operation: ValidationOperation,
  mode: ValidationMode,
  leads: WhatsAppValidationRequest[],
): Promise<WhatsAppValidationResult[]> {
  if (!endpoint) throw new Error(`Configure o endpoint de ${operation === 'validate' ? 'validação inicial' : 'revalidação'} do WhatsApp antes de aprovar leads.`);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: await authenticatedHeaders(operation),
    body: JSON.stringify({
      channel: 'whatsapp',
      operation,
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
    const message = payload?.message || payload?.error || response.statusText || `Erro ao executar ${operation} no worker WhatsApp.`;
    const formatted = Array.isArray(message) ? message.flat(Infinity).join(', ') : String(message);
    if (response.status === 503 && payload?.code === 'validation_unavailable') {
      throw new WhatsAppValidationUnavailableError(formatted);
    }
    throw new Error(formatted);
  }

  if (payload?.meta?.operation !== operation || payload?.meta?.mode !== mode) {
    throw new Error('Worker respondeu uma operação diferente da solicitada. Nenhum lead será aprovado.');
  }

  const results: unknown[] = Array.isArray(payload?.results) ? payload.results : Array.isArray(payload) ? payload : [];
  const normalized = results.map(normalizeValidationResult).filter((item): item is WhatsAppValidationResult => Boolean(item));
  assertOneResultForEachLead(leads, normalized);
  return normalized;
}


export const workerWhatsAppValidationGateway: WhatsAppValidationGateway = {
  validateInitial(leads) {
    return callValidationWorker(initialValidationEndpoint(), 'validate', 'initial', leads);
  },
  revalidateApproved(leads) {
    return callValidationWorker(revalidationEndpoint(), 'revalidate', 'revalidation', leads);
  },
};

export const whatsappValidationGateway = workerWhatsAppValidationGateway;
