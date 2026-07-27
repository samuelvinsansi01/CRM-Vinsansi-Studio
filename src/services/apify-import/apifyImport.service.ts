import { getSupabaseClient } from '../../lib/supabase';
import type { ApifyImportJob, FinalizeGoogleMapsImportInput, PendingGoogleMapsJob, StartGoogleMapsImportInput, StartGoogleMapsImportResult, SyncGoogleMapsImportResult } from './types';

export const apifyImportService = {
  async startGoogleMapsExtractor(input: StartGoogleMapsImportInput): Promise<StartGoogleMapsImportResult> {
    const { data, error } = await getSupabaseClient().functions.invoke('apify-google-maps-start', {
      body: {
        apifyAccountId: input.apifyAccountId,
        searchTerms: input.searchTerms.map((term) => term.trim()).filter(Boolean),
        locationQuery: input.location.trim(),
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

    if (!response.jobId || !response.runId || !accountName) {
      throw new Error('A Edge Function retornou dados incompletos ao iniciar a coleta.');
    }

    return {
      ...response,
      jobId: response.jobId,
      runId: response.runId,
      datasetId: response.datasetId ?? null,
      status: response.status ?? 'running',
      accountId: response.account?.id ?? response.accountId,
      accountName,
    };
  },


  async listGoogleMapsJobs(): Promise<ApifyImportJob[]> {
    const { data, error } = await getSupabaseClient()
      .from('apify_import_jobs')
      .select('apify_import_jobs_id, branches_id, branch_name, location_query, status, external_run_id, external_dataset_id, total_received, total_imported, total_duplicates, total_rejected, created_at, finished_at, apify_accounts:apify_accounts_id(account_name)')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return (data ?? []).map((row: any) => ({
      jobId: Number(row.apify_import_jobs_id),
      accountName: String((Array.isArray(row.apify_accounts) ? row.apify_accounts[0]?.account_name : row.apify_accounts?.account_name) ?? '—'),
      branchId: row.branches_id == null ? null : Number(row.branches_id),
      branchName: String(row.branch_name ?? '—'),
      location: String(row.location_query ?? '—'),
      status: String(row.status ?? '—'),
      runId: row.external_run_id ? String(row.external_run_id) : null,
      datasetId: row.external_dataset_id ? String(row.external_dataset_id) : null,
      totalReceived: Number(row.total_received ?? 0),
      totalImported: Number(row.total_imported ?? 0),
      totalDuplicates: Number(row.total_duplicates ?? 0),
      totalRejected: Number(row.total_rejected ?? 0),
      createdAt: String(row.created_at ?? ''),
      finishedAt: row.finished_at ? String(row.finished_at) : null,
    }));
  },

  async getGoogleMapsJobDetails(jobId: number): Promise<SyncGoogleMapsImportResult> {
    const { data, error } = await getSupabaseClient().functions.invoke('apify-google-maps-sync', {
      body: { action: 'details', jobId },
    });
    if (error) throw new Error(error.message);
    if (!data || typeof data !== 'object') throw new Error('Resposta inválida ao carregar os resultados.');
    if ('error' in data && data.error) throw new Error(String(data.error));
    return data as SyncGoogleMapsImportResult;
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
    return {
      jobId: Number(data.apify_import_jobs_id),
      runId: String(data.external_run_id),
      status: String(data.status ?? 'running'),
    };
  },

  async syncGoogleMapsExtractor(jobId: number): Promise<SyncGoogleMapsImportResult> {
    const { data, error } = await getSupabaseClient().functions.invoke('apify-google-maps-sync', {
      body: { action: 'status', jobId },
    });
    if (error) throw new Error(error.message);
    if (!data || typeof data !== 'object') throw new Error('Resposta inválida ao consultar a coleta.');
    if ('error' in data && data.error) throw new Error(String(data.error));
    return data as SyncGoogleMapsImportResult;
  },

  async finalizeGoogleMapsImport(input: FinalizeGoogleMapsImportInput): Promise<void> {
    const { data, error } = await getSupabaseClient().functions.invoke('apify-google-maps-sync', {
      body: { action: 'finalize', ...input },
    });
    if (error) throw new Error(error.message);
    if (!data || typeof data !== 'object') throw new Error('Resposta inválida ao concluir a importação.');
    if ('error' in data && data.error) throw new Error(String(data.error));
  },
};
