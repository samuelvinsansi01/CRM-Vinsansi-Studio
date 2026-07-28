import { getSupabaseClient } from '../../lib/supabase';
import type {
  ApifyImportJob,
  ApifyJobStatus,
  ApifyLocationOption,
  FinalizeGoogleMapsImportInput,
  PendingGoogleMapsJob,
  ReleaseGoogleMapsImportClaimInput,
  StartGoogleMapsImportInput,
  StartGoogleMapsImportResult,
  SyncGoogleMapsImportResult,
} from './types';

const terminalStatuses = new Set<ApifyJobStatus>(['succeeded', 'failed', 'aborted', 'timed_out']);

function normalizeStatus(value: unknown): ApifyJobStatus {
  const status = String(value ?? 'running').toLowerCase().replace('-', '_');
  if (status === 'starting' || status === 'ready' || status === 'running' || status === 'succeeded' || status === 'failed' || status === 'aborted' || status === 'timed_out') return status;
  return 'running';
}

function normalizeTerms(values: string[]) {
  const seen = new Set<string>();
  return values.flatMap((value) => String(value ?? '').split(/[\n,;|]/)).map((value) => value.trim()).filter((value) => {
    const key = value.toLocaleLowerCase('pt-BR');
    if (value.length < 2 || value.length > 100 || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 20);
}

async function invokeSync(body: Record<string, unknown>): Promise<SyncGoogleMapsImportResult> {
  const { data, error } = await getSupabaseClient().functions.invoke('apify-google-maps-sync', { body });
  if (error) throw new Error(error.message);
  if (!data || typeof data !== 'object') throw new Error('Resposta inválida da integração Apify.');
  if ('error' in data && data.error) throw new Error(String(data.error));
  const result = data as Partial<SyncGoogleMapsImportResult>;
  if (!result.jobId || !result.runId || !result.status) throw new Error('A integração Apify retornou dados incompletos.');
  return {
    jobId: Number(result.jobId),
    runId: String(result.runId),
    datasetId: result.datasetId ? String(result.datasetId) : null,
    status: normalizeStatus(result.status),
    imported: Boolean(result.imported),
    items: Array.isArray(result.items) ? result.items : null,
    totalItems: result.totalItems == null ? undefined : Number(result.totalItems),
    previewTruncated: Boolean(result.previewTruncated),
    claimToken: result.claimToken ? String(result.claimToken) : undefined,
    claimedAt: result.claimedAt ? String(result.claimedAt) : undefined,
  };
}

export const apifyImportService = {
  async listBrazilLocations(): Promise<ApifyLocationOption[]> {
    const { data, error } = await getSupabaseClient()
      .from('cities')
      .select('cities_id, cities_name, states_id, states:states_id(states_id, states_name, states_code)')
      .order('cities_name', { ascending: true });
    if (error) throw new Error(error.message);

    return (data ?? []).flatMap((row: any) => {
      const state = Array.isArray(row.states) ? row.states[0] : row.states;
      const cityName = String(row.cities_name ?? '').trim();
      const stateCode = String(state?.states_code ?? state?.states_name ?? '').trim();
      if (!cityName || !stateCode) return [];
      return [{
        cityId: Number(row.cities_id),
        stateId: Number(row.states_id ?? state?.states_id),
        cityName,
        stateCode,
        label: `${cityName}, ${stateCode}`,
      }];
    });
  },

  async listSuccessfullySearchedLocations(branchId: number): Promise<string[]> {
    const { data, error } = await getSupabaseClient()
      .from('apify_import_jobs')
      .select('location_query')
      .eq('branches_id', branchId)
      .eq('status', 'succeeded')
      .not('location_query', 'is', null);
    if (error) throw new Error(error.message);
    return Array.from(new Set((data ?? []).map((row: any) => String(row.location_query ?? '').trim()).filter(Boolean)));
  },

  async startGoogleMapsExtractor(input: StartGoogleMapsImportInput): Promise<StartGoogleMapsImportResult> {
    const searchTerms = normalizeTerms(input.searchTerms);
    if (!searchTerms.length) throw new Error('Informe ao menos um termo de busca válido.');
    if (!Number.isInteger(input.locationCityId) || input.locationCityId <= 0) throw new Error('Selecione uma localidade cadastrada.');
    if (!Number.isInteger(input.branchId) || input.branchId <= 0) throw new Error('Selecione um ramo cadastrado.');

    const { data, error } = await getSupabaseClient().functions.invoke('apify-google-maps-start', {
      body: {
        apifyAccountId: input.apifyAccountId,
        searchTerms,
        locationQuery: input.location.trim(),
        locationCityId: input.locationCityId,
        maxCrawledPlacesPerSearch: input.limit,
        branchId: input.branchId,
        branchName: input.branchName,
      },
    });
    if (error) throw new Error(error.message);
    if (!data || typeof data !== 'object') throw new Error('Resposta inválida ao iniciar o Google Maps Extractor.');
    if ('error' in data && data.error) throw new Error(String(data.error));

    const response = data as Partial<StartGoogleMapsImportResult>;
    const accountName = response.account?.name ?? response.accountName;
    if (!response.jobId || !response.runId || !accountName) throw new Error('A Edge Function retornou dados incompletos ao iniciar a coleta.');

    return {
      jobId: Number(response.jobId),
      runId: String(response.runId),
      datasetId: response.datasetId ? String(response.datasetId) : null,
      status: normalizeStatus(response.status),
      apifyJobStatusId: response.apifyJobStatusId ?? null,
      accountId: response.account?.id ?? response.accountId,
      accountName,
      reusedExistingJob: Boolean(response.reusedExistingJob),
      account: response.account,
    };
  },

  async listGoogleMapsJobs(): Promise<ApifyImportJob[]> {
    const { data, error } = await getSupabaseClient()
      .from('apify_import_jobs')
      .select('apify_import_jobs_id, apify_accounts_id, branches_id, branch_name, location_query, search_terms, requested_limit, status, external_run_id, external_dataset_id, total_received, total_imported, total_duplicates, total_rejected, error_message, imported_at, started_at, created_at, updated_at, finished_at, apify_accounts:apify_accounts_id(account_name)')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return (data ?? []).map((row: any) => ({
      jobId: Number(row.apify_import_jobs_id),
      accountId: row.apify_accounts_id == null ? null : Number(row.apify_accounts_id),
      accountName: String((Array.isArray(row.apify_accounts) ? row.apify_accounts[0]?.account_name : row.apify_accounts?.account_name) ?? '—'),
      branchId: row.branches_id == null ? null : Number(row.branches_id),
      branchName: String(row.branch_name ?? '—'),
      location: String(row.location_query ?? '—'),
      searchTerms: Array.isArray(row.search_terms) ? row.search_terms.map(String) : [],
      requestedLimit: Number(row.requested_limit ?? 0),
      status: normalizeStatus(row.status),
      runId: row.external_run_id ? String(row.external_run_id) : null,
      datasetId: row.external_dataset_id ? String(row.external_dataset_id) : null,
      totalReceived: Number(row.total_received ?? 0),
      totalImported: Number(row.total_imported ?? 0),
      totalDuplicates: Number(row.total_duplicates ?? 0),
      totalRejected: Number(row.total_rejected ?? 0),
      errorMessage: String(row.error_message ?? ''),
      importedAt: row.imported_at ? String(row.imported_at) : null,
      startedAt: row.started_at ? String(row.started_at) : null,
      createdAt: String(row.created_at ?? ''),
      updatedAt: String(row.updated_at ?? ''),
      finishedAt: row.finished_at ? String(row.finished_at) : null,
    }));
  },

  async getGoogleMapsJobDetails(jobId: number): Promise<SyncGoogleMapsImportResult> {
    return invokeSync({ action: 'details', jobId, previewLimit: 100 });
  },

  async findLatestPendingGoogleMapsJob(): Promise<PendingGoogleMapsJob | null> {
    const { data, error } = await getSupabaseClient()
      .from('apify_import_jobs')
      .select('apify_import_jobs_id, external_run_id, status, imported_at')
      .in('status', ['starting', 'ready', 'running', 'succeeded'])
      .is('imported_at', null)
      .not('external_run_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data?.apify_import_jobs_id || !data.external_run_id) return null;
    return { jobId: Number(data.apify_import_jobs_id), runId: String(data.external_run_id), status: normalizeStatus(data.status) };
  },

  async syncGoogleMapsExtractor(jobId: number): Promise<SyncGoogleMapsImportResult> {
    return invokeSync({ action: 'status', jobId });
  },

  async claimGoogleMapsDataset(jobId: number): Promise<SyncGoogleMapsImportResult> {
    return invokeSync({ action: 'claim', jobId });
  },

  async finalizeGoogleMapsImport(input: FinalizeGoogleMapsImportInput): Promise<void> {
    await invokeSync({ action: 'finalize', ...input });
  },

  async releaseGoogleMapsImportClaim(input: ReleaseGoogleMapsImportClaimInput): Promise<void> {
    await invokeSync({ action: 'release', ...input });
  },

  async abortGoogleMapsJob(jobId: number): Promise<SyncGoogleMapsImportResult> {
    return invokeSync({ action: 'abort', jobId });
  },

  async recoverStaleImportClaims(): Promise<number> {
    const result = await invokeSync({ action: 'recover_stale' });
    return Number(result.totalItems ?? 0);
  },

  isTerminal(status: ApifyJobStatus) {
    return terminalStatuses.has(status);
  },
};
