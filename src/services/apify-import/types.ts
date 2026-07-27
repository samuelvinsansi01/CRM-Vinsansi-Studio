export type StartGoogleMapsImportInput = {
  apifyAccountId: number;
  search: string;
  location: string;
  limit: number;
};

export type StartGoogleMapsImportResult = {
  jobId: number;
  runId: string;
  datasetId: string | null;
  status: string;
  accountId: number;
  accountName: string;
};
