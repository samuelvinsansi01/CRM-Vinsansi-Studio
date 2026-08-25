import type {
  BaseFilters,
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
  }>;
  listFinalIdentities(): Promise<FinalLeadIdentities>;
}
