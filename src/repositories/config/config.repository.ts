import type { ConfigKind, ConfigListFilters, ConfigRecord, CreateConfigRecordInput, UpdateConfigRecordInput } from '../../services/config/types';

export interface ConfigRepository {
  list(kind: ConfigKind, filters?: ConfigListFilters): Promise<ConfigRecord[]>;
  create(kind: ConfigKind, input: CreateConfigRecordInput): Promise<ConfigRecord>;
  update(kind: ConfigKind, id: string, input: UpdateConfigRecordInput): Promise<ConfigRecord>;
  remove(kind: ConfigKind, id: string): Promise<void>;
  toggleArchive(kind: ConfigKind, id: string): Promise<ConfigRecord>;
}
