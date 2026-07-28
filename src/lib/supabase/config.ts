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
    events: string;
    settings: string;
    dispatchMessageLogs: string;
  };
};

export function getSupabaseConfig(): SupabaseRuntimeConfig {
  const url = import.meta.env.VITE_SUPABASE_URL ?? '';
  const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '';
  const isConfigured = Boolean(url && supabaseKey);

  return {
    url,
    supabaseKey,
    isConfigured,
    tables: {
      chips: import.meta.env.VITE_SUPABASE_TABLE_CHIPS ?? 'chips',
      instagramProfiles: import.meta.env.VITE_SUPABASE_TABLE_INSTAGRAM_PROFILES ?? 'instagram_profiles',
      branches: import.meta.env.VITE_SUPABASE_TABLE_BRANCHES ?? 'branches',
      templates: import.meta.env.VITE_SUPABASE_TABLE_TEMPLATES ?? 'templates',
      importLeads: import.meta.env.VITE_SUPABASE_TABLE_IMPORT_LEADS ?? 'leads',
      whatsappQueueItems: import.meta.env.VITE_SUPABASE_TABLE_WHATSAPP_QUEUE_ITEMS ?? 'whatsapp_queue_items',
      instagramQueueItems: import.meta.env.VITE_SUPABASE_TABLE_INSTAGRAM_QUEUE_ITEMS ?? 'instagram_queue_items',
      events: import.meta.env.VITE_SUPABASE_TABLE_EVENTS ?? 'lead_events',
      settings: import.meta.env.VITE_SUPABASE_TABLE_SETTINGS ?? 'app_settings',
      dispatchMessageLogs: import.meta.env.VITE_SUPABASE_TABLE_DISPATCH_MESSAGE_LOGS ?? 'lead_dispatch_messages',
    },
  };
}
