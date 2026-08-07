import type { ImportSettings, UpdateImportSettingsInput } from '../../services/import-settings';
import type { ExtensionRuntimeConfig } from '../../services/platform-config/types';
import type { DispatchSettings, UpdateDispatchSettingsInput } from '../../services/settings/types';

export interface SettingsRepository {
  getImportSettings(): Promise<ImportSettings>;
  updateImportSettings(input: UpdateImportSettingsInput): Promise<ImportSettings>;
  resetImportSettings(): Promise<ImportSettings>;

  getDispatchSettings(): Promise<DispatchSettings>;
  updateDispatchSettings(input: UpdateDispatchSettingsInput): Promise<DispatchSettings>;
  resetDispatchSettings(): Promise<DispatchSettings>;

  getExtensionRuntimeConfig(): Promise<ExtensionRuntimeConfig | null>;
  updateExtensionRuntimeConfig(input: ExtensionRuntimeConfig): Promise<ExtensionRuntimeConfig>;
}
