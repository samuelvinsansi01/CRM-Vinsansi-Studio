import { getSupabaseClient } from '../../lib/supabase';

export type OperationalHealth = {
  checkedAt: string;
  workers: { online: number; stale: number };
  queues: { pending: number; processing: number; staleProcessing: number; errors: number };
  reconciliation: { whatsapp: number; instagram: number };
  batches: { active: number; stale: number };
  alerts: { open: number; critical: number };
  latestRecovery?: Record<string, unknown> | null;
};

const empty: OperationalHealth = {
  checkedAt: '', workers: { online: 0, stale: 0 }, queues: { pending: 0, processing: 0, staleProcessing: 0, errors: 0 },
  reconciliation: { whatsapp: 0, instagram: 0 }, batches: { active: 0, stale: 0 }, alerts: { open: 0, critical: 0 }, latestRecovery: null,
};

export async function getOperationalHealth(): Promise<OperationalHealth> {
  const response = await getSupabaseClient().rpc('get_operational_health');
  if (response.error) throw new Error(`Não foi possível consultar a saúde operacional: ${response.error.message}`);
  const value = (response.data ?? {}) as Partial<OperationalHealth>;
  return {
    ...empty, ...value,
    workers: { ...empty.workers, ...(value.workers ?? {}) }, queues: { ...empty.queues, ...(value.queues ?? {}) },
    reconciliation: { ...empty.reconciliation, ...(value.reconciliation ?? {}) }, batches: { ...empty.batches, ...(value.batches ?? {}) },
    alerts: { ...empty.alerts, ...(value.alerts ?? {}) },
  };
}

export async function listOperationalAlerts() {
  const response = await getSupabaseClient().from('operational_alerts')
    .select('operational_alerts_id,severity,status,title,message,source,entity_type,entity_id,last_detected_at,metadata')
    .neq('status', 'resolved').order('last_detected_at', { ascending: false }).limit(100);
  if (response.error) throw new Error(`Não foi possível carregar os alertas: ${response.error.message}`);
  return (response.data ?? []) as Array<Record<string, unknown>>;
}

export async function requestOperationalRecovery(scope: 'all' | 'whatsapp' | 'instagram' = 'all') {
  const response = await getSupabaseClient().rpc('request_operational_recovery', { p_scope: scope });
  if (response.error) throw new Error(`Não foi possível solicitar a recuperação: ${response.error.message}`);
  return Number(response.data);
}
