import { normalizeStatusGroup } from '../status/status.mapper';
import type {
  ReconciliationIssue,
  ReconciliationLeadSnapshot,
  ReconciliationQueueSnapshot,
  ReconciliationScan,
  ReconciliationSummary,
} from './types';

const ACTIVE_QUEUE_GROUPS = new Set(['queued', 'sending', 'paused', 'error', 'following', 'dm_opened']);
const PROCESSING_QUEUE_GROUPS = new Set(['sending', 'following', 'dm_opened']);
const DISPATCHABLE_QUEUE_GROUPS = new Set(['queued', 'sending', 'paused', 'following', 'dm_opened']);
const FINAL_LEAD_STATUSES = new Set([5, 6, 7, 8]);

function issueId(parts: Array<string | number | undefined>) {
  return parts.filter((part) => part !== undefined && part !== '').join(':');
}

function elapsedMinutes(value: string, now: Date) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return 0;
  return Math.max(0, Math.floor((now.getTime() - timestamp) / 60_000));
}

function activeQueueItems(items: ReconciliationQueueSnapshot[]) {
  return items.filter((item) => ACTIVE_QUEUE_GROUPS.has(normalizeStatusGroup(item.status)));
}

function buildSummary(issues: ReconciliationIssue[]): ReconciliationSummary {
  return {
    total: issues.length,
    critical: issues.filter((issue) => issue.severity === 'critical').length,
    warnings: issues.filter((issue) => issue.severity === 'warning').length,
    repairable: issues.filter((issue) => Boolean(issue.repairAction)).length,
    manualReview: issues.filter((issue) => !issue.repairAction).length,
    safeBulk: issues.filter((issue) => issue.safeForBulkRepair).length,
  };
}

function queueLabel(channel: ReconciliationQueueSnapshot['channel']) {
  return channel === 'whatsapp' ? 'WhatsApp' : 'Instagram';
}

export function analyzeReconciliationSnapshot(
  leads: ReconciliationLeadSnapshot[],
  queueItems: ReconciliationQueueSnapshot[],
  staleAfterMinutes = 45,
  now = new Date(),
): ReconciliationScan {
  const issues: ReconciliationIssue[] = [];
  const leadById = new Map(leads.map((lead) => [lead.id, lead]));
  const queuesByLead = new Map<string, ReconciliationQueueSnapshot[]>();

  for (const queue of queueItems) {
    if (!queue.leadId) {
      issues.push({
        id: issueId(['orphan-queue', queue.channel, queue.id]),
        type: 'orphan-queue-item',
        severity: 'critical',
        title: 'Item de fila sem vínculo com lead',
        detail: `O item ${queue.id} da fila ${queueLabel(queue.channel)} não possui lead_id utilizável.`,
        recommendation: 'Bloqueie o item para evitar disparo sem rastreabilidade e revise sua origem.',
        channel: queue.channel,
        queueItemId: queue.id,
        queueStatus: normalizeStatusGroup(queue.status),
        queueStatusRaw: queue.statusRaw,
        queueUpdatedAt: queue.updatedAt,
        repairAction: ACTIVE_QUEUE_GROUPS.has(normalizeStatusGroup(queue.status)) ? 'mark-queue-error' : undefined,
        safeForBulkRepair: false,
      });
      continue;
    }
    queuesByLead.set(queue.leadId, [...(queuesByLead.get(queue.leadId) ?? []), queue]);
  }

  for (const queue of queueItems) {
    if (!queue.leadId) continue;
    const lead = leadById.get(queue.leadId);
    const group = normalizeStatusGroup(queue.status);
    const ageMinutes = elapsedMinutes(queue.updatedAt || queue.createdAt, now);

    if (!lead) {
      issues.push({
        id: issueId(['orphan-queue', queue.channel, queue.id, queue.leadId]),
        type: 'orphan-queue-item',
        severity: 'critical',
        title: 'Item de fila aponta para lead inexistente',
        detail: `O item ${queue.id} referencia o lead ${queue.leadId}, que não foi encontrado para o usuário atual.`,
        recommendation: 'Marque o item com erro e investigue se o lead foi removido ou se o vínculo foi gravado incorretamente.',
        channel: queue.channel,
        leadId: queue.leadId,
        queueItemId: queue.id,
        queueStatus: group,
        queueStatusRaw: queue.statusRaw,
        queueUpdatedAt: queue.updatedAt,
        repairAction: ACTIVE_QUEUE_GROUPS.has(group) ? 'mark-queue-error' : undefined,
        safeForBulkRepair: false,
      });
      continue;
    }

    if (group === 'unknown') {
      issues.push({
        id: issueId(['unknown-status', queue.channel, queue.id]),
        type: 'unknown-queue-status',
        severity: 'warning',
        title: 'Status de fila desconhecido',
        detail: `O item ${queue.id} possui o status físico “${queue.statusRaw || '(vazio)'}”, que não pertence ao contrato operacional.`,
        recommendation: 'Revise manualmente o registro antes de permitir qualquer disparo.',
        channel: queue.channel,
        leadId: lead.id,
        leadName: lead.name,
        leadStatusId: lead.statusId,
        queueItemId: queue.id,
        queueStatus: group,
        queueStatusRaw: queue.statusRaw,
        queueUpdatedAt: queue.updatedAt,
        safeForBulkRepair: false,
      });
    }

    if (PROCESSING_QUEUE_GROUPS.has(group) && ageMinutes >= staleAfterMinutes) {
      issues.push({
        id: issueId(['stuck', queue.channel, queue.id, queue.statusRaw]),
        type: 'stuck-queue-item',
        severity: 'critical',
        title: 'Item operacional travado',
        detail: `O item ${queue.id} permanece em “${group}” há aproximadamente ${ageMinutes} minutos.`,
        recommendation: 'Confirme que não há execução ativa e marque o item com erro antes de reprocessar.',
        channel: queue.channel,
        leadId: lead.id,
        leadName: lead.name,
        leadStatusId: lead.statusId,
        queueItemId: queue.id,
        queueStatus: group,
        queueStatusRaw: queue.statusRaw,
        queueUpdatedAt: queue.updatedAt,
        ageMinutes,
        repairAction: 'mark-queue-error',
        safeForBulkRepair: false,
      });
    }

    if (group === 'sent' && lead.statusId !== 5) {
      const conflictingFinal = FINAL_LEAD_STATUSES.has(lead.statusId);
      issues.push({
        id: issueId(['sent-behind', queue.channel, queue.id, lead.id, lead.statusId]),
        type: conflictingFinal ? 'terminal-conflict' : 'lead-status-behind-queue',
        severity: 'critical',
        title: conflictingFinal ? 'Conflito entre dois estados finais' : 'Envio confirmado sem status final no lead',
        detail: conflictingFinal
          ? `A fila confirma envio, mas o lead ${lead.id} está no status final ${lead.statusId}.`
          : `A fila confirma envio, mas o lead ${lead.id} ainda está no status ${lead.statusId}.`,
        recommendation: conflictingFinal
          ? 'Revise o histórico antes de decidir qual estado final prevalece.'
          : 'Sincronize o lead para o status 5 — Enviado.',
        channel: queue.channel,
        leadId: lead.id,
        leadName: lead.name,
        leadStatusId: lead.statusId,
        queueItemId: queue.id,
        queueStatus: group,
        queueStatusRaw: queue.statusRaw,
        queueUpdatedAt: queue.updatedAt,
        repairAction: conflictingFinal ? undefined : 'sync-lead-sent',
        safeForBulkRepair: !conflictingFinal,
      });
    }

    if (group === 'invalid' && lead.statusId !== 6) {
      const conflictingFinal = FINAL_LEAD_STATUSES.has(lead.statusId);
      issues.push({
        id: issueId(['invalid-behind', queue.channel, queue.id, lead.id, lead.statusId]),
        type: conflictingFinal ? 'terminal-conflict' : 'lead-status-behind-queue',
        severity: conflictingFinal ? 'critical' : 'warning',
        title: conflictingFinal ? 'Conflito entre estados finais' : 'Invalidação da fila não refletida no lead',
        detail: conflictingFinal
          ? `A fila está inválida, mas o lead ${lead.id} já está no status final ${lead.statusId}.`
          : `A fila está inválida, mas o lead ${lead.id} permanece no status ${lead.statusId}.`,
        recommendation: conflictingFinal
          ? 'Revise o histórico antes de alterar o lead.'
          : 'Sincronize o lead para o status 6 — Inválido.',
        channel: queue.channel,
        leadId: lead.id,
        leadName: lead.name,
        leadStatusId: lead.statusId,
        queueItemId: queue.id,
        queueStatus: group,
        queueStatusRaw: queue.statusRaw,
        queueUpdatedAt: queue.updatedAt,
        repairAction: conflictingFinal ? undefined : 'sync-lead-invalid',
        safeForBulkRepair: !conflictingFinal,
      });
    }

    if (DISPATCHABLE_QUEUE_GROUPS.has(group) && FINAL_LEAD_STATUSES.has(lead.statusId)) {
      issues.push({
        id: issueId(['active-final', queue.channel, queue.id, lead.id, lead.statusId]),
        type: 'active-queue-for-final-lead',
        severity: 'critical',
        title: 'Fila ativa para lead já finalizado',
        detail: `O item ${queue.id} ainda pode ser processado, mas o lead ${lead.id} está no status final ${lead.statusId}.`,
        recommendation: 'Bloqueie o item com erro para impedir novo envio e revise o encerramento do lead.',
        channel: queue.channel,
        leadId: lead.id,
        leadName: lead.name,
        leadStatusId: lead.statusId,
        queueItemId: queue.id,
        queueStatus: group,
        queueStatusRaw: queue.statusRaw,
        queueUpdatedAt: queue.updatedAt,
        repairAction: 'mark-queue-error',
        safeForBulkRepair: false,
      });
    }
  }

  for (const lead of leads) {
    const queueRows = queuesByLead.get(lead.id) ?? [];
    const active = activeQueueItems(queueRows);
    const dispatchable = queueRows.filter((item) => DISPATCHABLE_QUEUE_GROUPS.has(normalizeStatusGroup(item.status)));

    if (lead.statusId === 4 && queueRows.length === 0) {
      issues.push({
        id: issueId(['lead-without-queue', lead.id]),
        type: 'lead-without-queue',
        severity: 'critical',
        title: 'Lead marcado como “Na fila” sem item de fila',
        detail: `O lead ${lead.id} está no status 4, mas não possui item em nenhuma fila.`,
        recommendation: 'Retorne o lead ao status 2 — Validado para que ele possa ser preparado novamente.',
        leadId: lead.id,
        leadName: lead.name,
        leadStatusId: lead.statusId,
        repairAction: 'return-lead-to-valid',
        safeForBulkRepair: true,
      });
    }

    if (lead.statusId === 2 && active.length === 1) {
      const queue = active[0];
      issues.push({
        id: issueId(['valid-active-queue', queue.channel, queue.id, lead.id]),
        type: 'lead-valid-with-active-queue',
        severity: 'warning',
        title: 'Fila criada, mas lead ainda está como Validado',
        detail: `O item ${queue.id} está ativo, porém o lead ${lead.id} permanece no status 2.`,
        recommendation: 'Sincronize o lead para o status 4 — Na fila.',
        channel: queue.channel,
        leadId: lead.id,
        leadName: lead.name,
        leadStatusId: lead.statusId,
        queueItemId: queue.id,
        queueStatus: normalizeStatusGroup(queue.status),
        queueStatusRaw: queue.statusRaw,
        queueUpdatedAt: queue.updatedAt,
        repairAction: 'sync-lead-queued',
        safeForBulkRepair: true,
      });
    }

    if (dispatchable.length > 1) {
      issues.push({
        id: issueId(['duplicate-active', lead.id, ...dispatchable.map((item) => item.id).sort()]),
        type: 'duplicate-active-queue',
        severity: 'critical',
        title: 'Mais de um item ativo para o mesmo lead',
        detail: `O lead ${lead.id} possui ${dispatchable.length} itens ativos entre as filas.`,
        recommendation: 'Não processe o lead até definir manualmente qual item deve permanecer ativo.',
        leadId: lead.id,
        leadName: lead.name,
        leadStatusId: lead.statusId,
        safeForBulkRepair: false,
      });
    }
  }

  const uniqueIssues = Array.from(new Map(issues.map((issue) => [issue.id, issue])).values())
    .sort((a, b) => {
      const severityOrder = { critical: 0, warning: 1, info: 2 } as const;
      return severityOrder[a.severity] - severityOrder[b.severity] || a.title.localeCompare(b.title);
    });

  return {
    issues: uniqueIssues,
    summary: buildSummary(uniqueIssues),
    scannedAt: now.toISOString(),
    staleAfterMinutes,
  };
}
