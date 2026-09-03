import { eventBus } from '../../lib/events';
import { repositories } from '../../repositories';
import { platformConfigService } from '../platform-config/platformConfig.service';
import { defaultDispatchSettings } from './settings.seed';
import { normalizeDispatchSettingsStrict } from './dispatchSettings.rules';
import type { DispatchSettings, UpdateDispatchSettingsInput } from './types';

export const settingsService = {
  async getDispatchSettings() {
    const settings = await repositories.settings.getDispatchSettings();
    return normalizeDispatchSettingsStrict(settings, defaultDispatchSettings);
  },

  async updateDispatchSettings(input: UpdateDispatchSettingsInput) {
    const current = await this.getDispatchSettings();
    const chipLevelPatch = Object.fromEntries(
      Object.entries(input.chipLevels ?? {}).filter(([, preset]) => preset !== undefined),
    ) as DispatchSettings['chipLevels'];
    const candidate: DispatchSettings = {
      whatsapp: { ...current.whatsapp, ...(input.whatsapp ?? {}) },
      instagram: { ...current.instagram, ...(input.instagram ?? {}) },
      chipLevels: { ...current.chipLevels, ...chipLevelPatch },
    };
    const normalized = normalizeDispatchSettingsStrict(candidate, defaultDispatchSettings);
    const settings = await repositories.settings.updateDispatchSettings(normalized);
    await platformConfigService.publishExtensionRuntimeConfig();
    eventBus.emit('dispatch-settings:changed', { source: 'settings' });
    return normalizeDispatchSettingsStrict(settings, defaultDispatchSettings);
  },

  async resetDispatchSettings() {
    const settings = normalizeDispatchSettingsStrict(await repositories.settings.resetDispatchSettings(), defaultDispatchSettings);
    await platformConfigService.publishExtensionRuntimeConfig();
    eventBus.emit('dispatch-settings:changed', { source: 'reset' });
    return settings;
  },
};
