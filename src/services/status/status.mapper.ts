export type StatusGroup =
  | 'approved'
  | 'pending'
  | 'sent'
  | 'rejected'
  | 'queued'
  | 'invalid'
  | 'error'
  | 'review'
  | 'archived'
  | 'sending'
  | 'paused'
  | 'following'
  | 'dm_opened'
  | 'deleted'
  | 'unknown';

export type CanonicalStatus =
  | 'APPROVED'
  | 'PENDING'
  | 'SENT'
  | 'REJECTED'
  | 'QUEUED'
  | 'INVALID'
  | 'ERROR'
  | 'REVIEW'
  | 'ARCHIVED'
  | 'SENDING'
  | 'PAUSED'
  | 'FOLLOWING'
  | 'DM_OPENED'
  | 'DELETED'
  | 'UNKNOWN';

export type StatusTone = 'neutral' | 'success' | 'warning' | 'danger' | 'primary';

export type StatusInfo = {
  group: StatusGroup;
  canonical: CanonicalStatus;
  label: string;
  tone: StatusTone;
};

const STATUS_GROUPS: Record<StatusGroup, { canonical: CanonicalStatus; label: string; tone: StatusTone; aliases: string[] }> = {
  approved: {
    canonical: 'APPROVED',
    label: 'Aprovado',
    tone: 'success',
    aliases: ['approved', 'aprovado', 'validado', 'aprovados', 'approved_for_queue', 'approved for queue', 'approved_for_instagram_queue', 'approved for instagram queue', 'whatsapp_valid'],
  },
  pending: {
    canonical: 'PENDING',
    label: 'Em aguarde',
    tone: 'warning',
    aliases: ['pending', 'pendente', 'importado', 'pendentes', 'aguardando', 'em aguarde', 'waiting', 'not_sent', 'not sent', 'nao enviada', 'nao enviado', 'nao contatado', 'aguardando alocacao instagram', 'new'],
  },
  sent: {
    canonical: 'SENT',
    label: 'J\u00e1 enviado',
    tone: 'success',
    aliases: ['sent', 'enviado', 'enviada', 'enviados', 'enviadas', 'ja_enviado', 'ja enviado', 'ja enviada', 'ja enviados', 'ja enviadas', 'whatsapp_sent', 'whatsapp sent', 'instagram_sent', 'instagram sent', 'enviada instagram', 'dm enviada', 'test_sent'],
  },
  rejected: {
    canonical: 'REJECTED',
    label: 'Recusado',
    tone: 'danger',
    aliases: ['rejected', 'recusado', 'recusada', 'recusados', 'recusadas', 'recusou'],
  },
  queued: {
    canonical: 'QUEUED',
    label: 'Em fila',
    tone: 'primary',
    aliases: ['queued', 'na_fila', 'em_fila', 'em fila', 'fila', 'ready', 'ready_to_dispatch', 'ready to dispatch', 'dispatch_queue', 'dispatch queue', 'scheduled', 'pronto'],
  },
  invalid: {
    canonical: 'INVALID',
    label: 'Inv\u00e1lido',
    tone: 'danger',
    aliases: ['invalid', 'invalido', 'duplicado', 'invalida', 'invalidado', 'invalidada', 'invalidated', 'invalidado instagram', 'fora_do_ramo', 'fora do ramo', 'out_of_profile', 'out of profile', 'invalid_manual', 'whatsapp_invalid', 'duplicado'],
  },
  error: {
    canonical: 'ERROR',
    label: 'Erro',
    tone: 'danger',
    aliases: ['error', 'erro', 'failed', 'falha', 'failure'],
  },
  review: {
    canonical: 'REVIEW',
    label: 'Em revis\u00e3o',
    tone: 'warning',
    aliases: ['review', 'pre_envio', 'pre envio', 'pré-envio', 'em revisao', 'revisao', 'validation retry'],
  },
  archived: {
    canonical: 'ARCHIVED',
    label: 'Arquivado',
    tone: 'neutral',
    aliases: ['archived', 'arquivado', 'arquivada', 'removed_from_queue', 'removed from queue'],
  },
  sending: {
    canonical: 'SENDING',
    label: 'Enviando',
    tone: 'warning',
    aliases: ['sending', 'enviando'],
  },
  paused: {
    canonical: 'PAUSED',
    label: 'Pausado',
    tone: 'neutral',
    aliases: ['paused', 'pausado', 'pausada'],
  },
  following: {
    canonical: 'FOLLOWING',
    label: 'Seguindo',
    tone: 'warning',
    aliases: ['following', 'seguindo', 'followed', 'already_following'],
  },
  dm_opened: {
    canonical: 'DM_OPENED',
    label: 'DM aberta',
    tone: 'warning',
    aliases: ['dm_opened', 'dm opened', 'dm aberta', 'dm aberto'],
  },
  deleted: {
    canonical: 'DELETED',
    label: 'Excluido',
    tone: 'neutral',
    aliases: ['deleted', 'deletado', 'deletada', 'excluido', 'excluida', 'excluido definitivo', 'excluida definitiva', 'removed', 'soft deleted'],
  },
  unknown: {
    canonical: 'UNKNOWN',
    label: 'Status desconhecido',
    tone: 'neutral',
    aliases: [],
  },
};

function normalizeComparable(value: unknown) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

const ALIAS_TO_GROUP = new Map<string, StatusGroup>();

Object.entries(STATUS_GROUPS).forEach(([group, config]) => {
  config.aliases.forEach((alias) => {
    const normalized = normalizeComparable(alias);
    if (!ALIAS_TO_GROUP.has(normalized)) {
      ALIAS_TO_GROUP.set(normalized, group as StatusGroup);
    }
  });
});

export function normalizeStatusGroup(value: unknown): StatusGroup {
  const normalized = normalizeComparable(value);
  return ALIAS_TO_GROUP.get(normalized) ?? 'unknown';
}

export function canonicalStatus(value: unknown): CanonicalStatus {
  return STATUS_GROUPS[normalizeStatusGroup(value)].canonical;
}

export function getStatusInfo(value: unknown): StatusInfo {
  const group = normalizeStatusGroup(value);
  const config = STATUS_GROUPS[group];
  return {
    group,
    canonical: config.canonical,
    label: config.label,
    tone: config.tone,
  };
}

export function statusLabel(value: unknown) {
  return getStatusInfo(value).label;
}

export function statusTone(value: unknown) {
  return getStatusInfo(value).tone;
}

export function isStatusGroup(value: unknown, group: StatusGroup) {
  return normalizeStatusGroup(value) === group;
}

export type NormalizedPreSendStatus = 'review' | 'approved' | 'queued' | 'rejected' | 'invalid' | 'archived' | 'sent' | 'deleted';
export type NormalizedWhatsAppQueueStatus = 'queued' | 'sending' | 'sent' | 'paused' | 'error' | 'invalid';
export type NormalizedInstagramQueueStatus = 'queued' | 'following' | 'dm_opened' | 'sent' | 'paused' | 'error' | 'invalid';
export type NormalizedBaseStatus = 'sent' | 'archived' | 'invalid' | 'error' | 'deleted';

export function normalizePreSendStatus(value: unknown, fallback: NormalizedPreSendStatus = 'review'): NormalizedPreSendStatus {
  const group = normalizeStatusGroup(value);
  if (group === 'approved' || group === 'queued' || group === 'rejected' || group === 'invalid' || group === 'archived' || group === 'sent' || group === 'deleted') return group;
  if (group === 'pending' || group === 'review' || group === 'error') return 'review';
  return fallback;
}

export function normalizeWhatsAppQueueStatus(value: unknown, fallback: NormalizedWhatsAppQueueStatus = 'queued'): NormalizedWhatsAppQueueStatus {
  const group = normalizeStatusGroup(value);
  if (group === 'queued' || group === 'sending' || group === 'sent' || group === 'paused' || group === 'error' || group === 'invalid') return group;
  if (group === 'pending') return 'queued';
  return fallback;
}

export function normalizeInstagramQueueStatus(value: unknown, fallback: NormalizedInstagramQueueStatus = 'queued'): NormalizedInstagramQueueStatus {
  const group = normalizeStatusGroup(value);
  if (group === 'queued' || group === 'following' || group === 'dm_opened' || group === 'sent' || group === 'paused' || group === 'error' || group === 'invalid') return group;
  if (group === 'pending') return 'queued';
  return fallback;
}

export function normalizeBaseStatus(value: unknown, fallback: NormalizedBaseStatus = 'sent'): NormalizedBaseStatus {
  const group = normalizeStatusGroup(value);
  if (group === 'sent' || group === 'archived' || group === 'invalid' || group === 'error' || group === 'deleted') return group;
  return fallback;
}

export function isFinalStatus(value: unknown) {
  const group = normalizeStatusGroup(value);
  return group === 'sent' || group === 'archived' || group === 'invalid' || group === 'deleted';
}
