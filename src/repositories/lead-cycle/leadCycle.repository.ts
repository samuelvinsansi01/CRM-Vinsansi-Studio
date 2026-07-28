import type { LeadDatabaseRow, LeadStatusId } from '../../types/lead.types';

export type LeadCycleTransitionPatch = Partial<{
  channels_id: 1 | 2;
  lead_status_id: LeadStatusId;
}>;

export interface LeadCycleRepository {
  listByStatuses(statusIds: LeadStatusId[], channelId?: 1 | 2): Promise<LeadDatabaseRow[]>;
  listByIds(ids: string[]): Promise<LeadDatabaseRow[]>;
  compareAndSet(
    id: string,
    expectedStatus: LeadStatusId,
    patch: LeadCycleTransitionPatch,
  ): Promise<LeadDatabaseRow | null>;
}
