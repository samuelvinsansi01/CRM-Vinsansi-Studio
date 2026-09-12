import { getSupabaseClient } from '../../lib/supabase';
import { organizationRequestHeaders } from '../organization/organizationSession';

export type WhatsAppValidationRequest = {
  id: string;
  company: string;
  phone: string;
  normalizedPhone: string;
  chipInstance: string;
  reviewItemId?: string;
};

export type WhatsAppValidationResult = {
  leadId: string;
  status: 'valid' | 'invalid' | 'error';
  valid: boolean;
  errorMessage?: string;
  outcome?: 'approved' | 'instagram_review_required' | 'no_contact' | 'error';
  persisted?: boolean;
};

export interface WhatsAppValidationGateway {
  validateInitial(leads: WhatsAppValidationRequest[]): Promise<WhatsAppValidationResult[]>;
}

/** Infraestrutura indisponível: o clique não deve gerar retry/refill automático. */
export class WhatsAppValidationUnavailableError extends Error {
  readonly code = 'validation_unavailable';

  constructor(message: string) {
    super(message);
    this.name = 'WhatsAppValidationUnavailableError';
  }
}

function resultLeadId(result: Record<string, unknown>) {
  return String(result.leadId ?? result.lead_id ?? result.id ?? '');
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

function normalizeValidationResult(result: unknown): WhatsAppValidationResult | null {
  if (!result || typeof result !== 'object') return null;
  const record = result as Record<string, unknown>;
  const leadId = resultLeadId(record);
  const outcome = String(record.outcome ?? '') as WhatsAppValidationResult['outcome'];
  const allowedOutcomes = new Set(['approved', 'instagram_review_required', 'no_contact', 'error']);
  if (!leadId || record.persisted !== true || !allowedOutcomes.has(String(outcome))) return null;

  const explicit = booleanLike(record.valid ?? record.exists ?? record.hasWhatsapp ?? record.has_whatsapp ?? record.isWhatsapp ?? record.is_whatsapp);
  const status = String(record.status ?? record.result ?? '').toLowerCase();
  const invalidStatus = ['invalid', 'whatsapp_invalid', 'not_found', 'no_whatsapp', 'not_on_whatsapp'].includes(status);

  // O backend R59 usa valid=false também para erro técnico. O outcome é o
  // discriminador comercial canônico; portanto erro precisa ser tratado antes
  // de interpretar valid=false como "sem WhatsApp". Caso contrário o resultado
  // técnico é descartado e o cliente acusa falsamente IDs sem correspondência.
  if (outcome === 'error') {
    return {
      leadId,
      status: 'error',
      valid: false,
      outcome: 'error',
      persisted: true,
      errorMessage: resultError(record) ?? 'Gateway/Evolution não confirmou o resultado deste número.',
    };
  }

  if (explicit === false || invalidStatus) {
    if (outcome !== 'instagram_review_required' && outcome !== 'no_contact') return null;
    return { leadId, status: 'invalid', valid: false, errorMessage: resultError(record), outcome, persisted: true };
  }

  if (explicit === true) {
    if (outcome !== 'approved') return null;
    return { leadId, status: 'valid', valid: true, outcome, persisted: true };
  }

  return null;
}

function assertOneResultForEachLead(leads: WhatsAppValidationRequest[], normalized: WhatsAppValidationResult[]) {
  const expected = new Set(leads.map((lead) => lead.id));
  const received = normalized.map((result) => result.leadId);
  const uniqueReceived = new Set(received);
  if (normalized.length !== leads.length || uniqueReceived.size !== leads.length || received.some((leadId) => !expected.has(leadId))) {
    throw new Error('Validação WhatsApp retornou resultados sem correspondência exata dos leads solicitados.');
  }
}

async function authenticatedHeaders() {
  const { data, error } = await getSupabaseClient().auth.getSession();
  if (error) throw new Error(error.message);
  const token = data.session?.access_token;
  if (!token) throw new Error('Sessão inválida. Entre novamente no painel.');
  return organizationRequestHeaders({
    'Content-Type': 'application/json',
    'X-Lead-Certo-Operation': 'validate',
    Authorization: `Bearer ${token}`,
  });
}

async function callValidationApi(leads: WhatsAppValidationRequest[]): Promise<WhatsAppValidationResult[]> {
  const response = await fetch('/api/whatsapp/validate', {
    method: 'POST',
    headers: await authenticatedHeaders(),
    body: JSON.stringify({
      channel: 'whatsapp',
      operation: 'validate',
      mode: 'initial',
      leads: leads.map((lead) => ({
        id: lead.id,
        lead_id: lead.id,
        company: lead.company,
        phone: lead.phone,
        normalized_phone: lead.normalizedPhone,
        chip_instance: lead.chipInstance,
        review_item_id: lead.reviewItemId,
      })),
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.message || payload?.error || response.statusText || 'Erro ao validar WhatsApp.';
    const formatted = Array.isArray(message) ? message.flat(Infinity).join(', ') : String(message);
    if (response.status === 503 && payload?.code === 'validation_unavailable') throw new WhatsAppValidationUnavailableError(formatted);
    throw new Error(formatted);
  }

  if (payload?.meta?.operation !== 'validate' || payload?.meta?.mode !== 'initial') {
    throw new Error('A validação respondeu um contrato diferente do solicitado.');
  }

  const results: unknown[] = Array.isArray(payload?.results) ? payload.results : [];
  const normalized = results.map(normalizeValidationResult).filter((item): item is WhatsAppValidationResult => Boolean(item));
  assertOneResultForEachLead(leads, normalized);
  return normalized;
}

export const whatsappValidationGateway: WhatsAppValidationGateway = {
  validateInitial(leads) {
    return callValidationApi(leads);
  },
};
