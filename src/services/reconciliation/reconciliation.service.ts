import { eventBus } from '../../lib/events';
import { isSupabaseConfigured } from '../../lib/supabase';
import { canonicalReconciliationRepository } from '../../repositories/reconciliation';
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



function emitRefreshEvents(issue: ReconciliationIssue) {
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
    canonicalReconciliationRepository.loadLeads(),
    canonicalReconciliationRepository.loadQueueItems(),
  ]);
  const result = analyzeReconciliationSnapshot(leads, queueItems, staleAfterMinutes());
  return result;
}

async function repair(issue: ReconciliationIssue): Promise<ReconciliationRepairResult> {
  if (!isSupabaseConfigured()) throw new Error('A reconciliação exige conexão com o Supabase.');
  const result = await canonicalReconciliationRepository.repair(issue);
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
