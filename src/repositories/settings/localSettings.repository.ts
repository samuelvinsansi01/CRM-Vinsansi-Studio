import type { ImportSettings, UpdateImportSettingsInput } from '../../services/import-settings';
import { defaultImportSettings } from '../../services/import-settings/importSettings.seed';
import type { ExtensionRuntimeConfig } from '../../services/platform-config/types';
import { defaultDispatchSettings } from '../../services/settings/settings.seed';
import type { DispatchSettings, UpdateDispatchSettingsInput } from '../../services/settings/types';
import { getCurrentUserId } from '../supabase.helpers';
import type { SettingsRepository } from './settings.repository';

const PREFIX = 'painel.local-settings.v1';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function key(name: string) {
  return `${PREFIX}:${await getCurrentUserId()}:${name}`;
}

async function read<T>(name: string, fallback: T): Promise<T> {
  try {
    const raw = window.localStorage.getItem(await key(name));
    return raw ? ({ ...clone(fallback), ...JSON.parse(raw) } as T) : clone(fallback);
  } catch {
    return clone(fallback);
  }
}

async function write<T>(name: string, value: T): Promise<T> {
  window.localStorage.setItem(await key(name), JSON.stringify(value));
  return clone(value);
}

function mergeDispatch(current: DispatchSettings, input: UpdateDispatchSettingsInput): DispatchSettings {
  const chipLevels = { ...current.chipLevels };
  for (const [name, value] of Object.entries(input.chipLevels ?? {})) {
    if (value !== undefined) chipLevels[name] = value;
  }
  return {
    whatsapp: { ...current.whatsapp, ...(input.whatsapp ?? {}) },
    instagram: { ...current.instagram, ...(input.instagram ?? {}) },
    chipLevels,
  };
}

function mergeImport(current: ImportSettings, input: UpdateImportSettingsInput): ImportSettings {
  return {
    ...current,
    ...input,
    safeMode: { ...current.safeMode, ...(input.safeMode ?? {}) },
    instagramLowRating: { ...current.instagramLowRating, ...(input.instagramLowRating ?? {}) },
    deduplication: { ...current.deduplication, ...(input.deduplication ?? {}) },
    routes: { ...current.routes, ...(input.routes ?? {}) },
    logs: { ...current.logs, ...(input.logs ?? {}) },
    branchRules: input.branchRules ?? current.branchRules,
  };
}

export const localSettingsRepository: SettingsRepository = {
  async getImportSettings() {
    return read('import', defaultImportSettings);
  },
  async updateImportSettings(input) {
    return write('import', mergeImport(await this.getImportSettings(), input));
  },
  async resetImportSettings() {
    return write('import', defaultImportSettings);
  },
  async getDispatchSettings() {
    return read('dispatch', defaultDispatchSettings);
  },
  async updateDispatchSettings(input) {
    return write('dispatch', mergeDispatch(await this.getDispatchSettings(), input));
  },
  async resetDispatchSettings() {
    return write('dispatch', defaultDispatchSettings);
  },
  async getExtensionRuntimeConfig() {
    return read<ExtensionRuntimeConfig | null>('extension-runtime', null);
  },
  async updateExtensionRuntimeConfig(input) {
    return write('extension-runtime', input);
  },
};
