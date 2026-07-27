export type StartGoogleMapsImportInput = {
  apifyAccountId: number;
  searchTerms: string[];
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
