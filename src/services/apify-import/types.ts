export type ApifyJobStatus =
  | 'starting'
  | 'ready'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'aborted'
  | 'timed_out';

export type StartGoogleMapsImportInput = {
  apifyAccountId: number;
  locationCityId: number;
  limit: number;
  branchId: number;
};

export type StartGoogleMapsImportResult = {
  success?: boolean;
  message?: string;
  jobId: number;
  runId: string;
  datasetId: string | null;
  status: ApifyJobStatus;
  apifyJobStatusId?: number | null;
  accountId?: number;
  accountName: string;
  reusedExistingJob?: boolean;
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
  status: ApifyJobStatus;
  imported: boolean;
  items: unknown[] | null;
  totalItems?: number;
  previewTruncated?: boolean;
  claimToken?: string;
  claimedAt?: string;
};

export type FinalizeGoogleMapsImportInput = {
  jobId: number;
  claimToken: string;
  claimedAt: string;
  processed: number;
  imported: number;
  duplicates: number;
  rejected: number;
};

export type ReleaseGoogleMapsImportClaimInput = {
  jobId: number;
  claimToken: string;
  claimedAt: string;
  reason?: string;
};

export type PendingGoogleMapsJob = {
  jobId: number;
  runId: string;
  status: ApifyJobStatus;
};

export type ApifyImportJob = {
  jobId: number;
  accountId: number | null;
  accountName: string;
  branchId: number | null;
  branchName: string;
  location: string;
  requestedLimit: number;
  status: ApifyJobStatus;
  runId: string | null;
  datasetId: string | null;
  totalReceived: number;
  totalImported: number;
  totalDuplicates: number;
  totalRejected: number;
  errorMessage: string;
  importedAt: string | null;
  startedAt: string | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
};

export type ApifyLocationOption = {
  cityId: number;
  stateId: number;
  cityName: string;
  stateCode: string;
  label: string;
};
