export type SupabaseRuntimeConfig = {
  url: string;
  supabaseKey: string;
  isConfigured: boolean;
  useSupabaseConfig: boolean;
  useSupabaseImport: boolean;
  useSupabaseBase: boolean;
  useSupabaseSettings: boolean;
  useSupabasePreSend: boolean;
  useSupabaseWhatsAppQueue: boolean;
  useSupabaseInstagramQueue: boolean;
  tables: {
    chips: string;
    instagramProfiles: string;
    branches: string;
    templates: string;
    importLeads: string;
    preSendLeads: string;
    whatsappQueueItems: string;
    instagramQueueItems: string;
    basePermanent: string;
    sentContacts: string;
    events: string;
    settings: string;
  };
};

function envFlag(value: unknown, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  return String(value).toLowerCase() === 'true';
}

export function getSupabaseConfig(): SupabaseRuntimeConfig {
  const url = import.meta.env.VITE_SUPABASE_URL ?? '';
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '';
  const legacyAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';
  const supabaseKey = publishableKey || legacyAnonKey;
  const isConfigured = Boolean(url && supabaseKey);

  return {
    url,
    supabaseKey,
    isConfigured,
    useSupabaseConfig: envFlag(import.meta.env.VITE_USE_SUPABASE_CONFIG, isConfigured),
    useSupabaseImport: envFlag(import.meta.env.VITE_USE_SUPABASE_IMPORT, isConfigured),
    useSupabaseBase: envFlag(import.meta.env.VITE_USE_SUPABASE_BASE, isConfigured),
    useSupabaseSettings: envFlag(import.meta.env.VITE_USE_SUPABASE_SETTINGS, isConfigured),
    useSupabasePreSend: envFlag(import.meta.env.VITE_USE_SUPABASE_PRE_SEND, isConfigured),
    useSupabaseWhatsAppQueue: envFlag(import.meta.env.VITE_USE_SUPABASE_WHATSAPP_QUEUE, isConfigured),
    useSupabaseInstagramQueue: envFlag(import.meta.env.VITE_USE_SUPABASE_INSTAGRAM_QUEUE, isConfigured),
    tables: {
      chips: import.meta.env.VITE_SUPABASE_TABLE_CHIPS ?? 'whatsapp_instances',
      instagramProfiles: import.meta.env.VITE_SUPABASE_TABLE_INSTAGRAM_PROFILES ?? 'instagram_profiles',
      branches: import.meta.env.VITE_SUPABASE_TABLE_BRANCHES ?? 'branches',
      templates: import.meta.env.VITE_SUPABASE_TABLE_TEMPLATES ?? 'message_templates',
      importLeads: import.meta.env.VITE_SUPABASE_TABLE_IMPORT_LEADS ?? 'leads',
      preSendLeads: import.meta.env.VITE_SUPABASE_TABLE_PRE_SEND_LEADS ?? 'pre_send_leads',
      whatsappQueueItems: import.meta.env.VITE_SUPABASE_TABLE_WHATSAPP_QUEUE_ITEMS ?? 'pre_dispatch_items',
      instagramQueueItems: import.meta.env.VITE_SUPABASE_TABLE_INSTAGRAM_QUEUE_ITEMS ?? 'instagram_dispatch_items',
      basePermanent: import.meta.env.VITE_SUPABASE_TABLE_BASE_PERMANENTE ?? 'base_permanente',
      sentContacts: import.meta.env.VITE_SUPABASE_TABLE_SENT_CONTACTS ?? 'sent_contacts',
      events: import.meta.env.VITE_SUPABASE_TABLE_EVENTS ?? 'contact_events',
      settings: import.meta.env.VITE_SUPABASE_TABLE_SETTINGS ?? 'settings',
    },
  };
}
