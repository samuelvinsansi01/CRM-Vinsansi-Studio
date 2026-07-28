import { eventBus } from '../../lib/events';
import { isSupabaseConfigured } from '../../lib/supabase';
import { repositories } from '../../repositories';
import { supabaseReconciliationRepository } from '../../repositories/reconciliation';
import { analyzeReconciliationSnapshot } from './reconciliation.rules';
import type {
  ReconciliationBulkResult,
  ReconciliationIssue,
  ReconciliationRepairResult,
  ReconciliationScan,
} from './types';

function staleAfterMinutes() {
  const configured = Number(import.meta.env.VITE_RECONCILIATION_STALE_MINUTES ?? 45);
  return Number.isFinite(configured) && configured >= 15 ? Math.floor(configured) : 45;
}

function emptyScan(): ReconciliationScan {
  return {
    issues: [],
    summary: { total: 0, critical: 0, warnings: 0, repairable: 0, manualReview: 0, safeBulk: 0 },
    scannedAt: new Date().toISOString(),
    staleAfterMinutes: staleAfterMinutes(),
  };
}

function eventChannel(issue: ReconciliationIssue) {
  return issue.channel;
}

async function appendRepairAudit(issue: ReconciliationIssue, result: ReconciliationRepairResult) {
  await repositories.events.append({
    source: 'reconciliation',
    action: issue.repairAction ?? 'manual-review',
    channel: eventChannel(issue),
    leadId: issue.leadId,
    queueItemId: issue.queueItemId,
    status: result.repaired ? 'repaired' : 'unchanged',
    message: result.message,
    metadata: {
      flow: 'F10',
      issue_id: issue.id,
      issue_type: issue.type,
      severity: issue.severity,
      previous_lead_status_id: issue.leadStatusId,
      previous_queue_status: issue.queueStatusRaw ?? issue.queueStatus,
      safe_for_bulk_repair: issue.safeForBulkRepair,
      company_name: issue.leadName,
    },
  });
}

function emitRefreshEvents(issue: ReconciliationIssue) {
  eventBus.emit('audit:changed', { action: 'repair', issueId: issue.id });
  if (issue.channel === 'whatsapp') eventBus.emit('whatsapp-queue:changed', { action: 'update' });
  if (issue.channel === 'instagram') eventBus.emit('instagram-queue:changed', { action: 'update' });
  if (issue.leadId) {
    eventBus.emit('import:changed', { source: 'update' });
    eventBus.emit('base:changed', { action: 'status' });
  }
}

async function scan(): Promise<ReconciliationScan> {
  if (!isSupabaseConfigured()) return emptyScan();
  const [leads, queueItems] = await Promise.all([
    supabaseReconciliationRepository.loadLeads(),
    supabaseReconciliationRepository.loadQueueItems(),
  ]);
  const result = analyzeReconciliationSnapshot(leads, queueItems, staleAfterMinutes());
  eventBus.emit('audit:changed', { action: 'scan' });
  return result;
}

async function repair(issue: ReconciliationIssue): Promise<ReconciliationRepairResult> {
  if (!isSupabaseConfigured()) throw new Error('A reconciliação exige conexão com o Supabase.');
  const result = await supabaseReconciliationRepository.repair(issue);
  try {
    await appendRepairAudit(issue, result);
  } catch (error) {
    result.auditWarning = error instanceof Error ? error.message : 'Falha ao registrar auditoria do reparo.';
  }
  emitRefreshEvents(issue);
  return result;
}

async function repairSafeIssues(issues: ReconciliationIssue[]): Promise<ReconciliationBulkResult> {
  const safeIssues = issues.filter((issue) => issue.safeForBulkRepair && issue.repairAction);
  const result: ReconciliationBulkResult = {
    requested: safeIssues.length,
    repaired: 0,
    unchanged: 0,
    failed: 0,
    results: [],
    failures: [],
  };

  for (const issue of safeIssues) {
    try {
      const repaired = await repair(issue);
      result.results.push(repaired);
      if (repaired.repaired) result.repaired += 1;
      else result.unchanged += 1;
    } catch (error) {
      result.failures.push({
        issueId: issue.id,
        reason: error instanceof Error ? error.message : 'Falha inesperada durante a reconciliação.',
      });
    }
  }
  result.failed = result.failures.length;
  return result;
}

export const reconciliationService = {
  scan,
  repair,
  repairSafeIssues,
};
