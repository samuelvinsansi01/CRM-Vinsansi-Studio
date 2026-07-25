import { createClient } from '@supabase/supabase-js';
import { getSupabaseConfig } from './config';
import type { AppSupabaseClient } from './types';

let client: AppSupabaseClient | null = null;

export function getSupabaseClient(): AppSupabaseClient {
  if (client) return client;

  const config = getSupabaseConfig();

  if (!config.isConfigured) {
    throw new Error('Supabase nao configurado. Defina VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY no arquivo .env.');
  }

  client = createClient(config.url, config.supabaseKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });

  return client;
}

export function isSupabaseConfigured() {
  return getSupabaseConfig().isConfigured;
}
