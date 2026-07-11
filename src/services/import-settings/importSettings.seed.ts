import type { ImportSettings } from './types';

export const defaultImportSettings: ImportSettings = {
  minRating: 4,
  minReviews: 10,
  safeMode: {
    simulationMode: true,
  },
  instagramSecondary: {
    enabled: true,
    minRating: 4,
    minReviews: 5,
  },
  branchRules: [],
  deduplication: {
    enabled: true,
    byPhone: true,
    bySite: true,
    blockBasePermanent: true,
    blockSentContacts: true,
    allowSmartReimport: false,
    incrementalImport: true,
  },
  routes: {
    whatsapp: true,
    instagram: true,
    ownSite: true,
    aggregators: true,
    blockFacebookAsSite: true,
    requireConfiguredCategory: true,
    rejectOutOfProfile: true,
  },
  logs: {
    enabled: true,
    logRejected: true,
    logRejectionReason: true,
  },
};
