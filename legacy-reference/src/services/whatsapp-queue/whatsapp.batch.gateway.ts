import { getSupabaseClient } from '../../lib/supabase';

export type WhatsAppBatchState = {
  status: 'idle' | 'running' | 'paused' | 'stopped' | 'completed' | 'error';
  enabled: boolean;
  chip?: string;
  total: number;
  remaining: number;
  sent_in_block?: number;
  block_number?: number;
  next_run_at?: string;
  started_at?: string;
  last_error?: string;
  already_running?: boolean;
};

type BatchAction = 'start' | 'pause' | 'resume' | 'stop' | 'status';

function endpoint() {
  return '/api/whatsapp/batch';
}

async function headers() {
  const { data, error } = await getSupabaseClient().auth.getSession();
  if (error) throw new Error(error.message);
  const token = data.session?.access_token;
  if (!token) throw new Error('Sessão inválida. Entre novamente no painel.');
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

async function call(action: BatchAction, input: { ids?: string[]; chip?: string } = {}): Promise<WhatsAppBatchState> {
  const response = await fetch(endpoint(), {
    method: 'POST',
    headers: await headers(),
    body: JSON.stringify({
      action,
      queue_item_ids: input.ids ?? [],
      chip_instance: input.chip ?? '',
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.message || payload?.error || response.statusText || 'Falha ao comunicar com o agendador WhatsApp.';
    throw new Error(String(message));
  }
  return {
    status: String(payload?.status || 'idle') as WhatsAppBatchState['status'],
    enabled: payload?.enabled === true || payload?.status === 'running',
    chip: String(payload?.chip || ''),
    total: Number(payload?.total || 0),
    remaining: Number(payload?.remaining ?? payload?.total ?? 0),
    sent_in_block: Number(payload?.sent_in_block || 0),
    block_number: Number(payload?.block_number || 1),
    next_run_at: String(payload?.next_run_at || ''),
    started_at: String(payload?.started_at || ''),
    last_error: String(payload?.last_error || ''),
    already_running: payload?.already_running === true,
  };
}

export const whatsappBatchGateway = {
  start(ids: string[], chip?: string) {
    return call('start', { ids, chip });
  },
  pause(chip?: string) {
    return call('pause', { chip });
  },
  resume(chip?: string) {
    return call('resume', { chip });
  },
  stop(chip?: string) {
    return call('stop', { chip });
  },
  status(chip?: string) {
    return call('status', { chip });
  },
};
