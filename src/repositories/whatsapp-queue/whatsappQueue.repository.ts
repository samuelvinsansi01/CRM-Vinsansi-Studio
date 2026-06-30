import type { CreateWhatsAppQueueLeadInput, UpdateWhatsAppQueueLeadInput, WhatsAppQueueBatch, WhatsAppQueueFilters, WhatsAppQueueSummary } from '../../services/whatsapp-queue/types';

export interface WhatsAppQueueRepository {
  listChips(): Promise<string[]>;
  listBatches(filters: WhatsAppQueueFilters): Promise<WhatsAppQueueBatch[]>;
  summary(filters?: WhatsAppQueueFilters): Promise<WhatsAppQueueSummary>;
  enqueue(leads: CreateWhatsAppQueueLeadInput[]): Promise<void>;
  updateLead(id: string, input: UpdateWhatsAppQueueLeadInput): Promise<unknown>;
  send(ids: string[]): Promise<void>;
  pause(ids: string[]): Promise<void>;
  resume(ids: string[]): Promise<void>;
  reprocess(ids: string[]): Promise<void>;
  invalidate(id: string): Promise<void>;
}
