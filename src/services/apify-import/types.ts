export type StartGoogleMapsImportInput = {
  apifyAccountId: number;
  searchTerms: string[];
  location: string;
  limit: number;
  branchId?: number;
  branchName?: string;
};

export type StartGoogleMapsImportResult = {
  success?: boolean;
  message?: string;
  jobId: number;
  runId: string;
  datasetId: string | null;
  status: string;
  apifyJobStatusId?: number | null;
  accountId?: number;
  accountName: string;
  account?: {
    id: number;
    name: string;
  };
};

export type SyncGoogleMapsImportResult = {
  success?: boolean;
  jobId: number;
  runId: string;
  datasetId: string | null;
  status: string;
  imported: boolean;
  items: unknown[] | null;
};

export type FinalizeGoogleMapsImportInput = {
  jobId: number;
  processed: number;
  imported: number;
  duplicates: number;
  rejected: number;
};

export type PendingGoogleMapsJob = {
  jobId: number;
  runId: string;
  status: string;
};

export type ApifyImportJob = {
  jobId: number;
  accountName: string;
  branchId: number | null;
  branchName: string;
  location: string;
  status: string;
  runId: string | null;
  datasetId: string | null;
  totalReceived: number;
  totalImported: number;
  totalDuplicates: number;
  totalRejected: number;
  createdAt: string;
  finishedAt: string | null;
};

export type ApifyLocationOption = {
  cityId: number;
  stateId: number;
  cityName: string;
  stateCode: string;
  label: string;
};
