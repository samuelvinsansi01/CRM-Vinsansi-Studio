import { getSupabaseClient } from '../../lib/supabase';
import type { StartGoogleMapsImportInput, StartGoogleMapsImportResult } from './types';

export const apifyImportService = {
  async startGoogleMapsExtractor(input: StartGoogleMapsImportInput): Promise<StartGoogleMapsImportResult> {
    const { data, error } = await getSupabaseClient().functions.invoke('apify-google-maps-start', {
      body: {
        apifyAccountId: input.apifyAccountId,
        search: input.search.trim(),
        location: input.location.trim(),
        limit: input.limit,
      },
    });

    if (error) throw new Error(error.message);
    if (!data || typeof data !== 'object') throw new Error('Resposta inválida ao iniciar o Google Maps Extractor.');
    if ('error' in data && data.error) throw new Error(String(data.error));

    return data as StartGoogleMapsImportResult;
  },
};
