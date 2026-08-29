export type WhatsAppValidationFailure = {
  id: string;
  company?: string;
  reason: string;
};

export type WhatsAppValidationBatchResult = {
  mode: 'initial';
  requested: number;
  providerChecked: number;
  approved: number;
  redirectedToInstagram: number;
  invalidated: number;
  errors: number;
  failed: number;
  approvedIds: string[];
  redirectedIds: string[];
  invalidatedIds: string[];
  errorIds: string[];
  failures: WhatsAppValidationFailure[];
};
