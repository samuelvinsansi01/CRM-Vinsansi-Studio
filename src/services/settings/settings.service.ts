import { eventBus } from '../../lib/events';
import { repositories } from '../../repositories';
import { platformConfigService } from '../platform-config/platformConfig.service';
import type { UpdateDispatchSettingsInput } from './types';

export const settingsService = {
  async getDispatchSettings() {
    return repositories.settings.getDispatchSettings();
  },

  async updateDispatchSettings(input: UpdateDispatchSettingsInput) {
    const settings = await repositories.settings.updateDispatchSettings(input);
    await platformConfigService.publishExtensionRuntimeConfig();
    eventBus.emit('dispatch-settings:changed', { source: 'settings' });
    return settings;
  },

  async resetDispatchSettings() {
    const settings = await repositories.settings.resetDispatchSettings();
    await platformConfigService.publishExtensionRuntimeConfig();
    eventBus.emit('dispatch-settings:changed', { source: 'reset' });
    return settings;
  },
};
