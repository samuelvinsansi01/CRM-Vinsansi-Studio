export type QueuePreparationChannel = 'WhatsApp' | 'Instagram';

export type QueuePreparationResource = {
  id: string;
  label: string;
  aliases?: string[];
  channel: QueuePreparationChannel;
  dailyLimit: number;
  batchSize: number;
  used: number;
  available: number;
  startTime?: string;
  endTime?: string;
};

export type QueuePreparationLead = {
  id: string;
  company: string;
  branch: string;
  city: string;
  state: string;
  contact: string;
  channel: QueuePreparationChannel;
  score: number;
  templateType: 'sem-site' | 'com-site';
  ready: boolean;
  blockReason?: string;
  requiresWhatsAppValidation?: boolean;
};

export type QueuePreparationSnapshot = {
  channel: QueuePreparationChannel;
  requestedDate: string;
  effectiveDate: string;
  cutoffApplied: boolean;
  activeDayAdjusted: boolean;
  resources: QueuePreparationResource[];
  selectedResource?: QueuePreparationResource;
  leads: QueuePreparationLead[];
  ready: number;
  blocked: number;
  capacity: number;
};

export type QueuePreparationFailure = {
  id: string;
  company?: string;
  reason: string;
};

export type QueuePreparationResult = {
  channel: QueuePreparationChannel;
  requested: number;
  queued: number;
  conflicts: number;
  failed: number;
  effectiveDate: string;
  resourceId: string;
  queuedLeadIds: string[];
  failures: QueuePreparationFailure[];
  auditWarnings: string[];
};
