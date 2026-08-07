import { getSupabaseClient } from '../../lib/supabase';
import type { WhatsAppQueueLead } from './types';

export type WhatsAppGatewayResult = {
  leadId: string;
  status: 'sent' | 'error' | 'paused';
  errorMessage?: string;
};

export interface WhatsAppGateway {
  send(leads: WhatsAppQueueLead[]): Promise<WhatsAppGatewayResult[]>;
}


/**
 * O navegador nunca conversa diretamente com o Worker exposto no Tunnel.
 * A rota serverless recebe a sessão atual, valida a posse dos itens e injeta
 * o segredo do Worker no backend. Variáveis VITE_ com URL externa antiga são
 * ignoradas para não reexpor o token no bundle do painel.
 */
function workerDispatchEndpoint() {
  const legacy = String(import.meta.env.VITE_WHATSAPP_WORKER_DISPATCH_ENDPOINT ?? '').trim();
  return legacy.startsWith('/api/') ? legacy : '/api/whatsapp/dispatch';
}

async function authenticatedHeaders() {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const { data, error } = await getSupabaseClient().auth.getSession();
  if (error) throw new Error(error.message);
  const token = data.session?.access_token;
  if (!token) throw new Error('Sessão inválida. Entre novamente no painel.');
  headers.Authorization = `Bearer ${token}`;
  return headers;
}


export const internalWorkerWhatsAppGateway: WhatsAppGateway = {
  async send(leads) {
    const endpoint = workerDispatchEndpoint();
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: await authenticatedHeaders(),
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

export const whatsappGateway: WhatsAppGateway = internalWorkerWhatsAppGateway;
