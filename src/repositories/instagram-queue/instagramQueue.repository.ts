import type { CreateInstagramQueueLeadInput, InstagramQueueBatch, InstagramQueueFilters, InstagramQueueSummary, UpdateInstagramQueueLeadInput } from '../../services/instagram-queue/types';

export interface InstagramQueueRepository {
  listProfiles(): Promise<string[]>;
  listBatches(filters: InstagramQueueFilters): Promise<InstagramQueueBatch[]>;
  summary(filters?: InstagramQueueFilters): Promise<InstagramQueueSummary>;
  enqueue(leads: CreateInstagramQueueLeadInput[]): Promise<void>;
  updateLead(id: string, input: UpdateInstagramQueueLeadInput): Promise<unknown>;
  send(ids: string[]): Promise<void>;
  pause(ids: string[]): Promise<void>;
  resume(ids: string[]): Promise<void>;
  reprocess(ids: string[]): Promise<void>;
  invalidate(id: string): Promise<void>;
}
