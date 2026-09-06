import { getRuntimeConfig } from '../runtimeConfig';

export type SupabaseRuntimeConfig = {
  url: string;
  supabaseKey: string;
  isConfigured: boolean;
  tables: {
    chips: string;
    instagramProfiles: string;
    branches: string;
    templates: string;
    importLeads: string;
    whatsappQueueItems: string;
    instagramQueueItems: string;
    queues: string;
    events: string;
    settings: string;
    dispatchMessageLogs: string;
  };
};

export function getSupabaseConfig(): SupabaseRuntimeConfig {
  const runtime = getRuntimeConfig();
  const url = runtime?.supabaseUrl ?? '';
  const supabaseKey = runtime?.supabasePublishableKey ?? '';
  const isConfigured = Boolean(url && supabaseKey);

  return {
    url,
    supabaseKey,
    isConfigured,
    tables: {
      chips: 'chips',
      instagramProfiles: 'socials',
      branches: 'branches',
      templates: 'templates',
      importLeads: 'leads',
      whatsappQueueItems: 'queue_items',
      instagramQueueItems: 'queue_items',
      queues: 'queues',
      // O schema real nao possui lead_events/app_settings. Os eventos de envio
      // usam sents; configuracoes globais ficam locais ate existir persistencia no banco.
      events: 'sents',
      settings: '',
      dispatchMessageLogs: 'sents',
    },
  };
}
