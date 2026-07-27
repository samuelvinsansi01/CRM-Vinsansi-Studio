export type StartGoogleMapsImportInput = {
  apifyAccountId: number;
  searchTerms: string[];
  location: string;
  limit: number;
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
