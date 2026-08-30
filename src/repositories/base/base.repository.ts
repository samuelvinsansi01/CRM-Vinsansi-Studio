import type {
  BaseFilters,
  BaseLead,
  BasePage,
  BaseSummary,
  FinalLeadIdentities,
} from '../../services/base/types';
import type { PageRequest } from '../../services/pagination/types';

export interface BaseRepository {
  page(filters: BaseFilters, request: PageRequest): Promise<BasePage>;
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
