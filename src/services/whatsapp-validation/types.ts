export type WhatsAppValidationMode = 'initial' | 'revalidation';

export type WhatsAppValidationFailure = {
  id: string;
  company?: string;
  reason: string;
};

export type WhatsAppValidationBatchResult = {
  mode: WhatsAppValidationMode;
  requested: number;
  providerChecked: number;
  approved: number;
  revalidated: number;
  redirectedToInstagram: number;
  invalidated: number;
  errors: number;
  conflicts: number;
  failed: number;
  approvedIds: string[];
  revalidatedIds: string[];
  redirectedIds: string[];
  invalidatedIds: string[];
  errorIds: string[];
  conflictIds: string[];
  failures: WhatsAppValidationFailure[];
  auditWarnings: string[];
};
