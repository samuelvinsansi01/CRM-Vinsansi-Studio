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
    const client = getSupabaseClient();
    const pageSize = 1000;
    const rowsById = new Map<number, any>();
    let offset = 0;

    // O PostgREST/Supabase limita a quantidade de linhas devolvidas por chamada.
    // Percorremos o catálogo inteiro para não deixar municípios posteriores no
    // alfabeto fora do seletor (por exemplo, Curitiba).
    for (let page = 0; page < 100; page += 1) {
      const { data, error } = await client
        .from('cities')
        .select('cities_id, cities_name, states_id, states:states_id(states_id, states_name, states_code)')
        .order('cities_name', { ascending: true })
        .order('cities_id', { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (error) throw new Error(error.message);

      const rows = data ?? [];
      if (!rows.length) break;

      let inserted = 0;
      for (const row of rows as any[]) {
        const cityId = Number(row.cities_id);
        if (!Number.isInteger(cityId) || cityId <= 0 || rowsById.has(cityId)) continue;
        rowsById.set(cityId, row);
        inserted += 1;
      }

      offset += rows.length;
      if (!inserted) break;
    }

    return Array.from(rowsById.values())
      .flatMap((row: any) => {
        const state = Array.isArray(row.states) ? row.states[0] : row.states;
        const cityName = String(row.cities_name ?? '').trim();
        const stateCode = String(state?.states_code ?? state?.states_name ?? '').trim();
        const cityId = Number(row.cities_id);
        const stateId = Number(row.states_id ?? state?.states_id);
        if (!cityName || !stateCode || !Number.isInteger(cityId) || !Number.isInteger(stateId)) return [];
        return [{ cityId, stateId, cityName, stateCode, label: `${cityName}, ${stateCode}` }];
      })
      .sort((left, right) => left.label.localeCompare(right.label, 'pt-BR', { sensitivity: 'base' }));
  },

  async listSuccessfullySearchedLocations(branchId: number, branchName: string): Promise<string[]> {
    const client = getSupabaseClient();
    const pageSize = 1000;
    const allRows: any[] = [];
    let offset = 0;

    // O histórico também pode ultrapassar o limite padrão do PostgREST.
    for (let page = 0; page < 100; page += 1) {
      const { data, error } = await client
        .from('apify_import_jobs')
        .select('apify_import_jobs_id, branches_id, branch_name, search_query, search_terms, location_query, branches:branches_id(branches_id, branches_name)')
        .eq('status', 'succeeded')
        .not('location_query', 'is', null)
        .order('apify_import_jobs_id', { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (error) throw new Error(error.message);

      const rows = data ?? [];
      if (!rows.length) break;
      allRows.push(...rows);
      offset += rows.length;
    }

    const normalize = (value: unknown) => String(value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('pt-BR')
      .trim()
      .replace(/\s+/g, ' ');
    const expectedBranch = normalize(branchName);

    return Array.from(new Set(allRows.flatMap((row: any) => {
      const relation = Array.isArray(row.branches) ? row.branches[0] : row.branches;
      const terms = Array.isArray(row.search_terms) ? row.search_terms.map(String) : [];
      const legacySearchQuery = String(row.search_query ?? '').split('|')[0]?.trim() ?? '';

      // A FK resolvida é a fonte mais confiável. Campos denormalizados e termos
      // históricos só entram como fallback quando o relacionamento não existe.
      const canonicalStoredBranch = normalize(
        relation?.branches_name
          ?? row.branch_name
          ?? legacySearchQuery
          ?? terms[0],
      );
      const belongsToBranch = canonicalStoredBranch
        ? canonicalStoredBranch === expectedBranch
        : Number(row.branches_id) === branchId;
      const location = String(row.location_query ?? '').trim();
      return belongsToBranch && location ? [location] : [];
    })));
  },

  async startGoogleMapsExtractor(input: StartGoogleMapsImportInput): Promise<StartGoogleMapsImportResult> {
    if (!Number.isInteger(input.locationCityId) || input.locationCityId <= 0) throw new Error('Selecione uma localidade cadastrada.');
    if (!Number.isInteger(input.branchId) || input.branchId <= 0) throw new Error('Selecione um ramo cadastrado.');

    const { data, error } = await getSupabaseClient().functions.invoke('apify-google-maps-start', {
      body: {
        apifyAccountId: input.apifyAccountId,
        locationCityId: input.locationCityId,
        maxCrawledPlacesPerSearch: input.limit,
        branchId: input.branchId,
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
      .select('apify_import_jobs_id, apify_accounts_id, branches_id, branch_name, search_query, location_query, search_terms, requested_limit, status, external_run_id, external_dataset_id, total_received, total_imported, total_duplicates, total_rejected, error_message, imported_at, started_at, created_at, updated_at, finished_at, apify_accounts:apify_accounts_id(account_name), branches:branches_id(branches_name)')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return (data ?? []).map((row: any) => {
      const account = Array.isArray(row.apify_accounts) ? row.apify_accounts[0] : row.apify_accounts;
      const branch = Array.isArray(row.branches) ? row.branches[0] : row.branches;
      const legacyTerms = Array.isArray(row.search_terms) ? row.search_terms.map(String).filter(Boolean) : [];
      const legacySearchQuery = String(row.search_query ?? '').split('|')[0]?.trim() ?? '';
      const branchName = [branch?.branches_name, row.branch_name, legacyTerms[0], legacySearchQuery]
        .map((value) => String(value ?? '').trim())
        .find(Boolean) ?? '—';

      return {
        jobId: Number(row.apify_import_jobs_id),
        accountId: row.apify_accounts_id == null ? null : Number(row.apify_accounts_id),
        accountName: String(account?.account_name ?? '—'),
        branchId: row.branches_id == null ? null : Number(row.branches_id),
        branchName,
        location: String(row.location_query ?? '—'),
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
      };
    });
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
