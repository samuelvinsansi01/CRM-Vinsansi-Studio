import type { LeadDatabaseRow, LeadStatusId } from '../../types/lead.types';

export type LeadCycleTransitionPatch = Partial<{
  branches_id: number;
  channels_id: number | null;
  lead_status_id: LeadStatusId;
  leads_name: string;
  leads_phone: string | null;
  leads_whatsapp: string | null;
  leads_instagram: string | null;
  leads_website: string | null;
  leads_maps: string | null;
}>;

export interface LeadCycleRepository {
  listByStatuses(statusIds: LeadStatusId[], channelId?: number): Promise<LeadDatabaseRow[]>;
  listByIds(ids: string[]): Promise<LeadDatabaseRow[]>;
  compareAndSet(
    id: string,
    expectedStatus: LeadStatusId,
    patch: LeadCycleTransitionPatch,
    expectedChannelId?: number,
  ): Promise<LeadDatabaseRow | null>;
}
