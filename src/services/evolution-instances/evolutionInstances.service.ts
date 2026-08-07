import { eventBus } from '../../lib/events';
import { getSupabaseClient } from '../../lib/supabase';

export type EvolutionInstanceSyncItem = {
  instanceId: string;
  instanceName: string;
  state: string;
  active: boolean;
  changed: boolean;
  webhookConfigured: boolean;
  error?: string;
  webhookError?: string;
};

export type EvolutionInstanceSyncResult = {
  checkedAt: string;
  total: number;
  active: number;
  inactive: number;
  changed: number;
  webhookConfigured: number;
  results: EvolutionInstanceSyncItem[];
};

export type EvolutionInstanceSyncOptions = {
  instanceId?: string;
  configureWebhook?: boolean;
  emitChange?: boolean;
};

let backgroundSync: Promise<EvolutionInstanceSyncResult> | null = null;

async function invokeSync(options: EvolutionInstanceSyncOptions) {
  const { data, error } = await getSupabaseClient().functions.invoke('evolution-instance-sync', {
    body: {
      instanceId: options.instanceId ? Number(options.instanceId) : undefined,
      configureWebhook: options.configureWebhook !== false,
    },
  });

  if (error) throw new Error(error.message || 'Falha ao sincronizar as instâncias Evolution.');
  if (data?.error) throw new Error(String(data.error));

  const result = data as EvolutionInstanceSyncResult;
  if (options.emitChange !== false) eventBus.emit('config:changed', { kind: 'instances' });
  return result;
}

export async function syncEvolutionInstances(options: EvolutionInstanceSyncOptions = {}) {
  // Chamadas periódicas são agrupadas para evitar múltiplas reconciliações concorrentes.
  if (options.configureWebhook === false) {
    if (backgroundSync) return backgroundSync;
    backgroundSync = invokeSync(options).finally(() => {
      backgroundSync = null;
    });
    return backgroundSync;
  }

  // Uma solicitação que configura webhook não pode ser descartada por uma consulta em andamento.
  if (backgroundSync) await backgroundSync.catch(() => undefined);
  return invokeSync(options);
}
