import type { ImportLead, ImportLeadInput, ImportListFilters, ImportExecutionOptions, ImportParseResult, ImportPersistResult, ImportSummary } from '../../services/import/types';

export interface ImportRepository {
  list(filters: ImportListFilters): Promise<ImportLead[]>;
  summary(): Promise<ImportSummary>;
  importFromJson(jsonText: string, options?: ImportExecutionOptions): Promise<ImportParseResult>;
  persist(leads: ImportLead[], options?: ImportExecutionOptions): Promise<ImportPersistResult>;
  create(input: ImportLeadInput): Promise<ImportLead>;
  update(id: string, input: Partial<ImportLeadInput>): Promise<ImportLead>;
  remove(id: string): Promise<void>;
  move(id: string, status: 'approved' | 'rejected'): Promise<ImportLead>;
}
