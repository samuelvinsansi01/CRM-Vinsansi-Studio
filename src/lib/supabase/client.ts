import { createClient } from '@supabase/supabase-js';
import { getSupabaseConfig } from './config';
import type { AppSupabaseClient } from './types';
import { getActiveOrganizationSessionId, ORGANIZATION_HEADER } from '../../services/organization/organizationSession';

let client: AppSupabaseClient | null = null;

export function getSupabaseClient(): AppSupabaseClient {
  if (client) return client;

  const config = getSupabaseConfig();

  if (!config.isConfigured) {
    throw new Error('Supabase nao configurado pelo Control Plane do CRM.');
  }

  client = createClient(config.url, config.supabaseKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
    global: {
      // A organização ativa é contexto desta sessão do navegador, não um estado
      // global do usuário. Cada requisição envia o tenant explicitamente.
      fetch: (input, init = {}) => {
        const headers = new Headers(init.headers ?? {});
        const organizationId = getActiveOrganizationSessionId();
        if (organizationId) headers.set(ORGANIZATION_HEADER, organizationId);
        return fetch(input, { ...init, headers });
      },
    },
  });

  return client;
}

export function isSupabaseConfigured() {
  return getSupabaseConfig().isConfigured;
}
