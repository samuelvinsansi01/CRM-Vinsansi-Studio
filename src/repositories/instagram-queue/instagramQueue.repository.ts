import type { CreateInstagramQueueLeadInput, InstagramQueueBatch, InstagramQueueFilters, InstagramQueueSummary, UpdateInstagramQueueLeadInput } from '../../services/instagram-queue/types';

export interface InstagramQueueRepository {
  listProfiles(): Promise<string[]>;
  listBatches(filters: InstagramQueueFilters): Promise<InstagramQueueBatch[]>;
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
