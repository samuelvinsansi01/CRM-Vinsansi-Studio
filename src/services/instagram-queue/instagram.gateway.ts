import type { InstagramQueueLead } from './types';

export type InstagramGatewayResult = {
  leadId: string;
  status: 'sent' | 'error';
  errorMessage?: string;
};

export interface InstagramGateway {
  send(leads: InstagramQueueLead[]): Promise<InstagramGatewayResult[]>;
}

function dispatchEndpoint() {
  return String(import.meta.env.VITE_INSTAGRAM_WORKER_DISPATCH_ENDPOINT ?? '').trim();
}

function normalizeResult(result: unknown): InstagramGatewayResult | null {
  if (!result || typeof result !== 'object') return null;
  const record = result as Record<string, unknown>;
  const leadId = String(record.leadId ?? record.lead_id ?? record.queue_item_id ?? record.id ?? '').trim();
  if (!leadId) return null;
  const status = String(record.status ?? '').trim().toLowerCase();
  return {
    leadId,
    status: status === 'sent' ? 'sent' : 'error',
    errorMessage: String(record.errorMessage ?? record.error_message ?? record.message ?? record.error ?? '').trim() || undefined,
  };
}

/**
 * O painel nunca envia credenciais ou comandos diretos para o Instagram.
 * Ele apenas entrega os IDs ao worker/backend, que deve retornar um resultado por item.
 */
export const internalWorkerInstagramGateway: InstagramGateway = {
  async send(leads) {
    const endpoint = dispatchEndpoint();
    if (!endpoint) {
      throw new Error('Envio Instagram real deve ser executado pelo worker/backend. Configure VITE_INSTAGRAM_WORKER_DISPATCH_ENDPOINT; o painel nao marcara itens como enviados sem confirmacao externa.');
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel: 'instagram',
        queue_item_ids: leads.map((lead) => lead.id),
      }),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const message = payload?.message || payload?.error || response.statusText || 'Erro ao acionar worker Instagram.';
      throw new Error(Array.isArray(message) ? message.flat(Infinity).join(', ') : String(message));
    }

    const rawResults: unknown[] = Array.isArray(payload?.results) ? payload.results : Array.isArray(payload) ? payload : [];
    const results = rawResults.map(normalizeResult).filter((item): item is InstagramGatewayResult => Boolean(item));
    if (results.length !== leads.length) {
      throw new Error('Worker Instagram nao retornou um resultado para cada item solicitado. Nenhum item sera marcado como enviado automaticamente.');
    }
    return results;
  },
};
