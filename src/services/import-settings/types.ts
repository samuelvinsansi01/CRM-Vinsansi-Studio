export type ImportRouteSettings = {
  whatsapp: boolean;
  instagram: boolean;
  ownSite: boolean;
  aggregators: boolean;
  blockFacebookAsSite: boolean;
  requireConfiguredCategory: boolean;
  rejectOutOfProfile: boolean;
};

export type ImportDeduplicationSettings = {
  enabled: boolean;
  byPhone: boolean;
  bySite: boolean;
  blockBasePermanent: boolean;
  blockSentContacts: boolean;
  allowSmartReimport: boolean;
  incrementalImport: boolean;
};

export type ImportLogSettings = {
  enabled: boolean;
  logRejected: boolean;
  logRejectionReason: boolean;
};

export type ImportSafeModeSettings = {
  simulationMode: boolean;
};

export type ImportBranchRule = {
  id: string;
  branchId?: string;
  branchSlug?: string;
  branch: string;
  subcategories: string[];
  minRating: number;
  minReviews: number;
  enabled: boolean;
};

export type ImportInstagramSecondarySettings = {
  enabled: boolean;
  minRating: number;
  minReviews: number;
};

export type ImportSettings = {
  minRating: number;
  minReviews: number;
  safeMode: ImportSafeModeSettings;
  instagramSecondary: ImportInstagramSecondarySettings;
  branchRules: ImportBranchRule[];
  deduplication: ImportDeduplicationSettings;
  routes: ImportRouteSettings;
  logs: ImportLogSettings;
};

export type UpdateImportSettingsInput = Partial<{
  minRating: number;
  minReviews: number;
  safeMode: Partial<ImportSafeModeSettings>;
  instagramSecondary: Partial<ImportInstagramSecondarySettings>;
  branchRules: ImportBranchRule[];
  deduplication: Partial<ImportDeduplicationSettings>;
  routes: Partial<ImportRouteSettings>;
  logs: Partial<ImportLogSettings>;
}>;
