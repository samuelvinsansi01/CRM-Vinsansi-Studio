import type { BaseFilters, BaseLead, BaseLeadStatus, BaseSummary, CreateBaseLeadInput, SentContactIdentities, UpdateBaseLeadInput } from '../../services/base/types';

export interface BaseRepository {
  list(filters?: BaseFilters): Promise<BaseLead[]>;
  summary(): Promise<BaseSummary>;
  options(): Promise<{
    origins: string[];
    branches: string[];
    states: string[];
    cities: string[];
    destinations: string[];
    statuses: string[];
  }>;
  listSentIdentities(): Promise<SentContactIdentities>;
  upsertSent(input: CreateBaseLeadInput): Promise<BaseLead>;
  update(id: string, input: UpdateBaseLeadInput): Promise<BaseLead>;
  setStatus(id: string, status: BaseLeadStatus): Promise<BaseLead>;
  archive(id: string): Promise<BaseLead>;
}
