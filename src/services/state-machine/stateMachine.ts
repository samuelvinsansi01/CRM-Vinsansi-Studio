import { normalizeStatusGroup, type StatusGroup } from '../status/status.mapper';

export type EntityKind = 'import' | 'pre-send' | 'whatsapp-queue' | 'instagram-queue' | 'base';

export type StateAction =
  | 'edit'
  | 'approve'
  | 'unapprove'
  | 'reject'
  | 'invalidate'
  | 'archive'
  | 'restore'
  | 'queue'
  | 'send'
  | 'mark_sending'
  | 'mark_sent'
  | 'pause'
  | 'resume'
  | 'reprocess'
  | 'fail'
  | 'instagram_override'
  | 'review'
  | 'return_to_import'
  | 'delete'
  | 'status_update';

export type TransitionRequest = {
  entity: EntityKind;
  fromStatus: unknown;
  toStatus?: unknown;
  action: StateAction;
};

export type TransitionResult = {
  allowed: boolean;
  reason?: string;
  from: StatusGroup;
  to: StatusGroup;
};

const sameStatusActions = new Set<StateAction>(['edit', 'send', 'instagram_override']);

function includes(groups: StatusGroup[], status: StatusGroup) {
  return groups.includes(status);
}

function denied(request: TransitionRequest, reason: string): TransitionResult {
  return {
    allowed: false,
    reason,
    from: normalizeStatusGroup(request.fromStatus),
    to: normalizeStatusGroup(request.toStatus ?? request.fromStatus),
  };
}

function allowed(request: TransitionRequest): TransitionResult {
  return {
    allowed: true,
    from: normalizeStatusGroup(request.fromStatus),
    to: normalizeStatusGroup(request.toStatus ?? request.fromStatus),
  };
}

function target(request: TransitionRequest) {
  if (sameStatusActions.has(request.action) && request.toStatus === undefined) return normalizeStatusGroup(request.fromStatus);
  return normalizeStatusGroup(request.toStatus);
}

function isDirectStatusUpdate(request: TransitionRequest) {
  return request.action === 'status_update';
}

function canImport(request: TransitionRequest): TransitionResult {
  const from = normalizeStatusGroup(request.fromStatus);
  const to = target(request);

  if (request.action === 'queue') return to === 'queued' && from === 'approved' ? allowed(request) : denied(request, 'Apenas leads aprovados podem ser alocados no pre-envio.');
  if (request.action === 'return_to_import') return includes(['queued', 'review'], from) && includes(['pending', 'approved'], to) ? allowed(request) : denied(request, 'Retorno ao Inicio exige lead alocado e destino pendente ou aprovado.');
  if (request.action === 'mark_sent') return to === 'sent' && includes(['pending', 'approved', 'rejected', 'invalid', 'review', 'queued'], from) ? allowed(request) : denied(request, 'Somente leads operacionais podem ser marcados como enviados.');
  if (from === 'sent' || from === 'queued' || from === 'sending' || from === 'archived') return denied(request, 'Lead importado ja saiu da etapa de importacao.');
  if (request.action === 'edit') return allowed(request);
  if (request.action === 'instagram_override') return includes(['approved', 'pending', 'rejected', 'review'], from) ? allowed(request) : denied(request, 'Override permitido somente antes da fila.');
  if (request.action === 'approve') return to === 'approved' && includes(['pending', 'rejected', 'invalid', 'review', 'approved'], from) ? allowed(request) : denied(request, 'Somente leads pendentes, recusados ou invalidos podem ser aprovados.');
  if (request.action === 'unapprove') return to === 'pending' && from === 'approved' ? allowed(request) : denied(request, 'Somente leads aprovados podem voltar para em aguarde.');
  if (request.action === 'reject') return to === 'rejected' && includes(['pending', 'approved', 'invalid', 'review', 'rejected'], from) ? allowed(request) : denied(request, 'Somente leads antes da fila podem ser recusados.');
  if (request.action === 'invalidate') return to === 'invalid' && includes(['pending', 'approved', 'rejected', 'review', 'invalid'], from) ? allowed(request) : denied(request, 'Somente leads antes da fila podem ser invalidados.');
  if (request.action === 'archive') return to === 'archived' && includes(['pending', 'approved', 'rejected', 'invalid', 'review'], from) ? allowed(request) : denied(request, 'Somente leads antes da fila podem ser arquivados.');
  if (isDirectStatusUpdate(request) && from === to) return allowed(request);
  return denied(request, 'Transicao invalida na importacao.');
}

function canPreSend(request: TransitionRequest): TransitionResult {
  const from = normalizeStatusGroup(request.fromStatus);
  const to = target(request);

  if (from === 'sent') return denied(request, 'Lead enviado nao pode voltar ao pre-envio.');
  if (from === 'sending') return denied(request, 'Lead em envio nao pode ser alterado.');
  if (request.action === 'edit') return includes(['review', 'approved', 'rejected', 'invalid', 'pending'], from) ? allowed(request) : denied(request, 'Lead em fila ou finalizado nao pode ser editado.');
  if (request.action === 'instagram_override') return includes(['review', 'approved', 'rejected', 'invalid', 'pending'], from) ? allowed(request) : denied(request, 'Override Instagram permitido somente antes da fila.');
  if (request.action === 'approve') return to === 'approved' && includes(['review', 'rejected', 'invalid', 'pending'], from) ? allowed(request) : denied(request, 'Apenas leads em revisao, recusados ou invalidos podem ser aprovados.');
  if (request.action === 'review') return to === 'review' && includes(['review', 'approved', 'rejected', 'invalid', 'pending'], from) ? allowed(request) : denied(request, 'Somente leads ativos podem voltar para revisao.');
  if (request.action === 'unapprove') return to === 'pending' && from === 'approved' ? allowed(request) : denied(request, 'Somente leads aprovados podem voltar para em aguarde.');
  if (request.action === 'queue') return to === 'queued' && from === 'approved' ? allowed(request) : denied(request, 'Apenas leads aprovados podem entrar em fila.');
  if (request.action === 'archive') return to === 'archived' && includes(['review', 'approved', 'rejected', 'invalid', 'pending'], from) ? allowed(request) : denied(request, 'Lead em fila ou enviado nao pode ser arquivado pelo pre-envio.');
  if (request.action === 'mark_sent') return to === 'sent' && includes(['review', 'approved', 'pending', 'rejected', 'invalid', 'queued'], from) ? allowed(request) : denied(request, 'Apenas leads ativos do pre-envio podem ser marcados como enviados.');
  if (isDirectStatusUpdate(request) && from === to) return allowed(request);
  return denied(request, 'Transicao invalida no pre-envio.');
}

function canWhatsAppQueue(request: TransitionRequest): TransitionResult {
  const from = normalizeStatusGroup(request.fromStatus);
  const to = target(request);

  if (from === 'sent') return denied(request, 'Lead enviado nao pode ser alterado na fila.');
  if (request.action === 'edit') return includes(['queued', 'paused', 'error'], from) ? allowed(request) : denied(request, 'Apenas itens em fila, pausados ou com erro podem ser editados.');
  if (request.action === 'send') return includes(['queued', 'paused'], from) ? allowed(request) : denied(request, 'Apenas itens em fila ou pausados podem ser enviados.');
  if (request.action === 'mark_sending') return to === 'sending' && includes(['queued', 'paused'], from) ? allowed(request) : denied(request, 'Apenas itens em fila ou pausados podem iniciar envio.');
  if (request.action === 'mark_sent') return to === 'sent' && includes(['sending', 'queued', 'paused'], from) ? allowed(request) : denied(request, 'Apenas itens em envio ou fila podem finalizar como enviados.');
  if (request.action === 'pause') return to === 'paused' && from === 'queued' ? allowed(request) : denied(request, 'Apenas itens em fila podem ser pausados.');
  if (request.action === 'resume') return to === 'queued' && from === 'paused' ? allowed(request) : denied(request, 'Apenas itens pausados podem ser retomados.');
  if (request.action === 'reprocess') return to === 'queued' && from === 'error' ? allowed(request) : denied(request, 'Apenas itens com erro podem ser reprocessados.');
  if (request.action === 'invalidate') return to === 'invalid' && includes(['queued', 'paused', 'error'], from) ? allowed(request) : denied(request, 'Itens enviados, invalidos ou em envio nao podem ser invalidados.');
  if (request.action === 'fail') return to === 'error' && includes(['queued', 'paused', 'sending', 'error'], from) ? allowed(request) : denied(request, 'Falha so pode ser registrada em item ativo.');
  if (isDirectStatusUpdate(request) && from === to) return allowed(request);
  return denied(request, 'Transicao invalida na fila WhatsApp.');
}

function canInstagramQueue(request: TransitionRequest): TransitionResult {
  const from = normalizeStatusGroup(request.fromStatus);
  const to = target(request);

  if (from === 'sent') return denied(request, 'Lead enviado nao pode ser alterado na fila Instagram.');
  if (request.action === 'edit') return includes(['queued', 'paused', 'error', 'following', 'dm_opened'], from) ? allowed(request) : denied(request, 'Apenas itens ativos podem ser editados.');
  if (request.action === 'send') return includes(['queued', 'paused', 'following', 'dm_opened'], from) ? allowed(request) : denied(request, 'Apenas itens ativos podem ser enviados.');
  if (request.action === 'mark_sending') return to === 'dm_opened' && includes(['queued', 'paused', 'following'], from) ? allowed(request) : denied(request, 'Apenas itens ativos podem abrir DM.');
  if (request.action === 'mark_sent') return to === 'sent' && includes(['queued', 'paused', 'following', 'dm_opened'], from) ? allowed(request) : denied(request, 'Apenas itens ativos podem finalizar como enviados.');
  if (request.action === 'pause') return to === 'paused' && includes(['queued', 'following', 'dm_opened'], from) ? allowed(request) : denied(request, 'Apenas itens ativos podem ser pausados.');
  if (request.action === 'resume') return to === 'queued' && from === 'paused' ? allowed(request) : denied(request, 'Apenas itens pausados podem ser retomados.');
  if (request.action === 'reprocess') return to === 'queued' && from === 'error' ? allowed(request) : denied(request, 'Apenas itens com erro podem ser reprocessados.');
  if (request.action === 'invalidate') return to === 'invalid' && includes(['queued', 'paused', 'error', 'following', 'dm_opened'], from) ? allowed(request) : denied(request, 'Itens enviados, invalidos ou em envio nao podem ser invalidados.');
  if (request.action === 'fail') return to === 'error' && includes(['queued', 'paused', 'following', 'dm_opened', 'error'], from) ? allowed(request) : denied(request, 'Falha so pode ser registrada em item ativo.');
  if (isDirectStatusUpdate(request) && from === to) return allowed(request);
  return denied(request, 'Transicao invalida na fila Instagram.');
}

function canBase(request: TransitionRequest): TransitionResult {
  const from = normalizeStatusGroup(request.fromStatus);
  const to = target(request);

  if (request.action === 'edit') return allowed(request);
  if (request.action === 'archive') return to === 'archived' && from !== 'archived' ? allowed(request) : denied(request, 'Registro ja esta arquivado.');
  if (request.action === 'restore') return from === 'archived' ? allowed(request) : denied(request, 'Somente registros arquivados podem ser restaurados.');
  if (request.action === 'delete') return to === 'deleted' && from === 'archived' ? allowed(request) : denied(request, 'Excluir exige registro arquivado.');
  if (isDirectStatusUpdate(request) && from === to) return allowed(request);
  return denied(request, 'Status da Base Permanente deve mudar apenas por acao operacional.');
}

export function canTransition(request: TransitionRequest): TransitionResult {
  if (request.toStatus !== undefined && target(request) === 'unknown') return denied(request, 'Status de destino desconhecido.');

  if (request.entity === 'import') return canImport(request);
  if (request.entity === 'pre-send') return canPreSend(request);
  if (request.entity === 'whatsapp-queue') return canWhatsAppQueue(request);
  if (request.entity === 'instagram-queue') return canInstagramQueue(request);
  return canBase(request);
}

export function assertTransition(request: TransitionRequest) {
  const result = canTransition(request);
  if (!result.allowed) throw new Error(result.reason ?? 'Transicao de status nao permitida.');
}

export function transition(request: TransitionRequest) {
  assertTransition(request);
  return normalizeStatusGroup(request.toStatus ?? request.fromStatus);
}
