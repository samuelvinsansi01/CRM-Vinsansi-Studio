import type {
  ReconciliationIssue,
  ReconciliationLeadSnapshot,
  ReconciliationQueueSnapshot,
  ReconciliationRepairResult,
} from '../../services/reconciliation/types';

export interface ReconciliationRepository {
  loadLeads(): Promise<ReconciliationLeadSnapshot[]>;
  loadQueueItems(): Promise<ReconciliationQueueSnapshot[]>;
  repair(issue: ReconciliationIssue): Promise<ReconciliationRepairResult>;
}
