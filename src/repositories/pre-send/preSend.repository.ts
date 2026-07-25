import type { CreatePreSendLeadInput, PreSendChannel, PreSendDayCard, PreSendFilters, PreSendLead, PreSendQueueFilter, PreSendSummary } from '../../services/pre-send/types';

export interface PreSendRepository {
  listDayCards(): Promise<PreSendDayCard[]>;
  summary(): Promise<PreSendSummary>;
  listProfiles(channel: PreSendChannel): Promise<string[]>;
  listLeads(filters: PreSendFilters): Promise<PreSendLead[]>;
  addLeads(leads: CreatePreSendLeadInput[]): Promise<PreSendLead[]>;
  moveToQueue(ids: string[]): Promise<void>;
  markSent(ids: string[]): Promise<void>;
  validateLead(id: string): Promise<void>;
  archiveLead(id: string): Promise<void>;
  updateLead(id: string, input: Partial<PreSendLead>): Promise<void>;
}

export type { PreSendQueueFilter };
