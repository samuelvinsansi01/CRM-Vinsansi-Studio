import { repositories } from '../../repositories';
import type { BaseFilters } from './types';

export const baseService = {
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
