import type { WhatsAppQueueLead } from './types';

export type WhatsAppGatewayResult = {
  leadId: string;
  status: 'sent' | 'error' | 'paused';
  errorMessage?: string;
};

export interface WhatsAppGateway {
  send(leads: WhatsAppQueueLead[]): Promise<WhatsAppGatewayResult[]>;
}

function isBrowserRuntime() {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function workerDispatchEndpoint() {
  return String(import.meta.env.VITE_WHATSAPP_WORKER_DISPATCH_ENDPOINT ?? '').trim();
}

export const mockWhatsAppGateway: WhatsAppGateway = {
  async send(leads) {
    return leads.map((lead) => ({ leadId: lead.id, status: 'sent' }));
  },
};

export const internalWorkerWhatsAppGateway: WhatsAppGateway = {
  async send(leads) {
    const endpoint = workerDispatchEndpoint();
    if (!endpoint) {
      throw new Error('Envio WhatsApp real deve ser executado pelo worker/backend. Configure VITE_WHATSAPP_WORKER_DISPATCH_ENDPOINT para delegar sem expor credenciais da Evolution.');
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel: 'whatsapp',
        queue_item_ids: leads.map((lead) => lead.id),
      }),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const message = payload?.message || payload?.error || response.statusText || 'Erro ao acionar worker WhatsApp.';
      throw new Error(Array.isArray(message) ? message.flat(Infinity).join(', ') : String(message));
    }

    const results = payload?.results;
    if (!Array.isArray(results)) {
      throw new Error('Worker WhatsApp nao retornou resultados de envio.');
    }

    return results
      .map((result: Partial<WhatsAppGatewayResult> & { lead_id?: string }): WhatsAppGatewayResult => ({
        leadId: String(result.leadId ?? result.lead_id ?? ''),
        status: result.status === 'sent' || result.status === 'paused' ? result.status : 'error',
        errorMessage: result.errorMessage,
      }))
      .filter((result) => result.leadId);
  },
};

export const whatsappGateway: WhatsAppGateway = isBrowserRuntime() ? internalWorkerWhatsAppGateway : mockWhatsAppGateway;
