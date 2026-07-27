import { getSupabaseClient } from '../../lib/supabase';
import type { StartGoogleMapsImportInput, StartGoogleMapsImportResult } from './types';

export const apifyImportService = {
  async startGoogleMapsExtractor(input: StartGoogleMapsImportInput): Promise<StartGoogleMapsImportResult> {
    const { data, error } = await getSupabaseClient().functions.invoke('apify-google-maps-start', {
      body: {
        apifyAccountId: input.apifyAccountId,
        searchTerms: input.searchTerms.map((term) => term.trim()).filter(Boolean),
        locationQuery: input.location.trim(),
        maxCrawledPlacesPerSearch: input.limit,
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
};
