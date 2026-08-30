import type { CreateInstagramQueueLeadInput, InstagramQueueBatch, InstagramQueueFilters, InstagramQueuePage, InstagramQueueSummary, UpdateInstagramQueueLeadInput } from '../../services/instagram-queue/types';
import type { PageRequest } from '../../services/pagination/types';

export interface InstagramQueueRepository {
  listProfiles(): Promise<string[]>;
  listBatches(filters: InstagramQueueFilters): Promise<InstagramQueueBatch[]>;
  page(filters: InstagramQueueFilters, request: PageRequest): Promise<InstagramQueuePage>;
  summary(filters?: InstagramQueueFilters): Promise<InstagramQueueSummary>;
  /** Retorna somente os IDs realmente criados. Duplicidades ignoradas não aparecem no resultado. */
  enqueue(leads: CreateInstagramQueueLeadInput[]): Promise<string[]>;
  /** Remove apenas um item ainda não iniciado. Usado como compensação quando o status canônico não pode avançar. */
  removeQueued(id: string): Promise<void>;
  updateLead(id: string, input: UpdateInstagramQueueLeadInput): Promise<unknown>;
  pause(ids: string[]): Promise<void>;
  resume(ids: string[]): Promise<void>;
  reprocess(ids: string[]): Promise<void>;
  invalidate(id: string): Promise<void>;
}
