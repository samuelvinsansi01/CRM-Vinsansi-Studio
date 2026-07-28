export type ReconciliationSeverity = 'critical' | 'warning' | 'info';
export type ReconciliationChannel = 'whatsapp' | 'instagram';

export type ReconciliationIssueType =
  | 'lead-without-queue'
  | 'lead-status-behind-queue'
  | 'lead-valid-with-active-queue'
  | 'active-queue-for-final-lead'
  | 'orphan-queue-item'
  | 'duplicate-active-queue'
  | 'stuck-queue-item'
  | 'unknown-queue-status'
  | 'terminal-conflict';

export type ReconciliationRepairAction =
  | 'return-lead-to-valid'
  | 'sync-lead-queued'
  | 'sync-lead-sent'
  | 'sync-lead-invalid'
  | 'mark-queue-error';

export type ReconciliationIssue = {
  id: string;
  type: ReconciliationIssueType;
  severity: ReconciliationSeverity;
  title: string;
  detail: string;
  recommendation: string;
  channel?: ReconciliationChannel;
  leadId?: string;
  leadName?: string;
  leadStatusId?: number;
  queueItemId?: string;
  queueStatus?: string;
  queueStatusRaw?: string;
  queueUpdatedAt?: string;
  ageMinutes?: number;
  repairAction?: ReconciliationRepairAction;
  safeForBulkRepair: boolean;
};

export type ReconciliationSummary = {
  total: number;
  critical: number;
  warnings: number;
  repairable: number;
  manualReview: number;
  safeBulk: number;
};

export type ReconciliationScan = {
  issues: ReconciliationIssue[];
  summary: ReconciliationSummary;
  scannedAt: string;
  staleAfterMinutes: number;
};

export type ReconciliationRepairResult = {
  issueId: string;
  repaired: boolean;
  unchanged: boolean;
  message: string;
  auditWarning?: string;
};

export type ReconciliationBulkResult = {
  requested: number;
  repaired: number;
  unchanged: number;
  failed: number;
  results: ReconciliationRepairResult[];
  failures: Array<{ issueId: string; reason: string }>;
};

export type ReconciliationLeadSnapshot = {
  id: string;
  name: string;
  statusId: number;
  channelId: number | null;
  updatedAt: string;
};

export type ReconciliationQueueSnapshot = {
  id: string;
  channel: ReconciliationChannel;
  leadId: string;
  status: string;
  statusRaw: string;
  updatedAt: string;
  createdAt: string;
};
