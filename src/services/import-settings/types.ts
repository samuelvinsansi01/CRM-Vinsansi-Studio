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

export type ImportInstagramLowRatingSettings = {
  enabled: boolean;
  minRating: number;
  maxRatingExclusive: number;
  minReviews: number;
};

export type ImportBranchRule = {
  id: string;
  branchId?: string;
  branchSlug?: string;
  branch: string;
  subcategories: string[];
  associatedCategories: string[];
  minRating: number;
  minReviews: number;
  enabled: boolean;
};

export type ImportSettings = {
  minRating: number;
  minReviews: number;
  safeMode: ImportSafeModeSettings;
  instagramLowRating: ImportInstagramLowRatingSettings;
  branchRules: ImportBranchRule[];
  deduplication: ImportDeduplicationSettings;
  routes: ImportRouteSettings;
  logs: ImportLogSettings;
};

export type UpdateImportSettingsInput = Partial<{
  minRating: number;
  minReviews: number;
  safeMode: Partial<ImportSafeModeSettings>;
  instagramLowRating: Partial<ImportInstagramLowRatingSettings>;
  branchRules: ImportBranchRule[];
  deduplication: Partial<ImportDeduplicationSettings>;
  routes: Partial<ImportRouteSettings>;
  logs: Partial<ImportLogSettings>;
}>;
