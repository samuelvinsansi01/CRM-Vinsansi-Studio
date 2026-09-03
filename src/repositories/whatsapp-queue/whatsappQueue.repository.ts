import type { CreateWhatsAppQueueLeadInput, UpdateWhatsAppQueueLeadInput, WhatsAppQueueBatch, WhatsAppQueueFilters, WhatsAppQueuePage, WhatsAppQueueSummary } from '../../services/whatsapp-queue/types';
import type { PageRequest } from '../../services/pagination/types';

export interface WhatsAppQueueRepository {
  listChips(): Promise<string[]>;
  listBatches(filters: WhatsAppQueueFilters): Promise<WhatsAppQueueBatch[]>;
  page(filters: WhatsAppQueueFilters, request: PageRequest): Promise<WhatsAppQueuePage>;
  summary(filters?: WhatsAppQueueFilters): Promise<WhatsAppQueueSummary>;
  /** Retorna somente os IDs realmente criados. Duplicidades ignoradas não aparecem no resultado. */
  enqueue(leads: CreateWhatsAppQueueLeadInput[]): Promise<string[]>;
  /** Remove apenas um item ainda não iniciado. Usado como compensação quando o status canônico não pode avançar. */
  removeQueued(id: string): Promise<void>;
  updateLead(id: string, input: UpdateWhatsAppQueueLeadInput): Promise<unknown>;
  send(ids: string[]): Promise<void>;
  pause(ids: string[]): Promise<void>;
  resume(ids: string[]): Promise<void>;
  reprocess(ids: string[]): Promise<void>;
  invalidate(id: string): Promise<void>;
}
