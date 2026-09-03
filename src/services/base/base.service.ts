import { repositories } from '../../repositories';
import type { BaseFilters } from './types';
import type { PageRequest } from '../pagination/types';

export const baseService = {
  page(filters: BaseFilters = {}, request: PageRequest) {
    return repositories.base.page(filters, request);
  },

  list(filters: BaseFilters = {}) {
    return repositories.base.list(filters);
  },

  summary() {
    return repositories.base.summary();
  },

  options() {
    return repositories.base.options();
  },

  listFinalIdentities() {
    return repositories.base.listFinalIdentities();
  },
};
