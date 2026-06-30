import type { InstagramQueueLead } from './types';

export type InstagramGatewayResult = {
  leadId: string;
  status: 'sent' | 'error';
  errorMessage?: string;
};

export interface InstagramGateway {
  send(leads: InstagramQueueLead[]): Promise<InstagramGatewayResult[]>;
}

export const mockInstagramGateway: InstagramGateway = {
  async send(leads) {
    return leads.map((lead) => ({ leadId: lead.id, status: 'sent' }));
  },
};
