import type {
  BaseFilters,
  BaseFinalStatusId,
  BaseLead,
  BaseSummary,
  FinalLeadIdentities,
} from '../../services/base/types';

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
    outcomes: string[];
  }>;
  listFinalIdentities(): Promise<FinalLeadIdentities>;
  listByIds(ids: string[]): Promise<BaseLead[]>;
  compareAndArchive(id: string, expectedStatus: Exclude<BaseFinalStatusId, 8>): Promise<BaseLead | null>;
  updateMetadata(id: string, outcome: string, notes: string): Promise<void>;
}
