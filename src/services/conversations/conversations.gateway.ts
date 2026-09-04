import { getSupabaseClient } from '../../lib/supabase';
import { COMMERCIAL_STAGES, type CommercialStage } from '../leads/crmLead.types';
import { organizationRequestHeaders } from '../organization/organizationSession';

type SendResult = { ok: boolean; message_id?: number | string; external_message_id?: string | null; status?: string; error?: string; message?: string };
type ApiEnvelope = { ok?: boolean; data?: unknown; error?: string; message?: string };
type Row = Record<string, unknown>;

export type ConversationCommercialContext = {
  contractVersion: string;
  conversationId: string;
  linked: boolean;
  leadId: string | null;
  leadName: string;
  alternativeName: string;
  displayName: string;
  leadStatusId: number | null;
  stage: CommercialStage | null;
  editable: boolean;
  allowedTransitions: CommercialStage[];
  previewDueDate: string;
  previewDueDateEditable: boolean;
  updatedAt: string | null;
};

const text = (value: unknown) => String(value ?? '').trim();
const row = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const stageSet = new Set<string>(COMMERCIAL_STAGES);
const stage = (value: unknown): CommercialStage | null => {
  const raw = text(value).toLowerCase();
  const normalized = raw === 'aguardando_design' ? 'aguardando_previa' : raw === 'design_enviado' ? 'previa_enviada' : raw === 'fechado' ? 'aprovado' : raw;
  return stageSet.has(normalized) ? normalized as CommercialStage : null;
};

async function authorizedHeaders(contentType = false) {
  const session = await getSupabaseClient().auth.getSession();
  if (session.error) throw new Error(session.error.message);
  const token = session.data.session?.access_token;
  if (!token) throw new Error('Sessão expirada. Entre novamente.');
  return organizationRequestHeaders({
    ...(contentType ? { 'Content-Type': 'application/json' } : {}),
    Authorization: `Bearer ${token}`,
  });
}

async function parseCommercialResponse(response: Response): Promise<ConversationCommercialContext> {
  const payload = await response.json().catch(() => null) as ApiEnvelope | null;
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.message || payload?.error || `Falha ao atualizar o Comercial (${response.status}).`);
  }
  const data = row(payload.data);
  const leadIdValue = data.leadId == null ? null : text(data.leadId);
  const leadStatusValue = data.leadStatusId == null ? null : Number(data.leadStatusId);
  const currentStage = stage(data.stage);
  const allowedTransitions = Array.isArray(data.allowedTransitions)
    ? data.allowedTransitions.map(stage).filter((value): value is CommercialStage => value !== null)
    : currentStage ? [currentStage] : [];
  return {
    contractVersion: text(data.contractVersion) || 'conversation-commercial-v0.3',
    conversationId: text(data.conversationId),
    linked: data.linked === true,
    leadId: leadIdValue,
    leadName: text(data.leadName),
    alternativeName: text(data.alternativeName),
    displayName: text(data.displayName) || text(data.alternativeName) || text(data.leadName),
    leadStatusId: Number.isSafeInteger(leadStatusValue) ? leadStatusValue : null,
    stage: currentStage,
    editable: data.editable === true,
    allowedTransitions,
    previewDueDate: text((data.previewDueDate ?? data.designDueDate)).slice(0, 10),
    previewDueDateEditable: data.previewDueDateEditable === true,
    updatedAt: data.updatedAt == null ? null : text(data.updatedAt),
  };
}

export async function sendConversationMessage(conversationId: string, message: string, idempotencyKey = crypto.randomUUID()): Promise<SendResult> {
  const response = await fetch('/api/whatsapp/conversation-send', {
    method: 'POST',
    headers: await authorizedHeaders(true),
    body: JSON.stringify({ conversationId: Number(conversationId), body: message, idempotencyKey }),
  });
  const payload = await response.json().catch(() => null) as SendResult | null;
  if (!response.ok || !payload?.ok) {
    const error = payload?.message || payload?.error || `Falha ao enviar a mensagem (${response.status}).`;
    throw new Error(error);
  }
  return payload;
}

export async function getConversationCommercial(conversationId: string): Promise<ConversationCommercialContext> {
  const response = await fetch(`/api/whatsapp/conversation-commercial?conversationId=${encodeURIComponent(conversationId)}`, {
    method: 'GET',
    headers: await authorizedHeaders(),
  });
  return parseCommercialResponse(response);
}

export async function setConversationCommercialStage(conversationId: string, nextStage: CommercialStage): Promise<ConversationCommercialContext> {
  const response = await fetch('/api/whatsapp/conversation-commercial', {
    method: 'POST',
    headers: await authorizedHeaders(true),
    body: JSON.stringify({ action: 'stage', conversationId: Number(conversationId), stage: nextStage }),
  });
  return parseCommercialResponse(response);
}

export async function setConversationPreviewDueDate(conversationId: string, previewDueDate: string | null): Promise<ConversationCommercialContext> {
  const response = await fetch('/api/whatsapp/conversation-commercial', {
    method: 'POST',
    headers: await authorizedHeaders(true),
    body: JSON.stringify({ action: 'preview_due_date', conversationId: Number(conversationId), previewDueDate: previewDueDate || null }),
  });
  return parseCommercialResponse(response);
}
