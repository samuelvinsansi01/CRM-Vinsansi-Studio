import { getSupabaseClient, getSupabaseConfig } from '../../lib/supabase';
import { defaultImportSettings } from '../../services/import-settings/importSettings.seed';
import type { ImportSettings, UpdateImportSettingsInput } from '../../services/import-settings/types';
import type { ExtensionRuntimeConfig } from '../../services/platform-config/types';
import { defaultDispatchSettings } from '../../services/settings/settings.seed';
import type { DispatchSettings, UpdateDispatchSettingsInput } from '../../services/settings/types';
import { createUuid, getCurrentUserId, nowIso } from '../supabase.helpers';
import type { SettingsRepository } from './settings.repository';

type SettingsKey = 'import' | 'dispatch' | 'extension_runtime';

async function readSetting<T>(key: SettingsKey, fallback: T): Promise<T> {
  const table = getSupabaseConfig().tables.settings;
  const userId = await getCurrentUserId();
  const { data, error } = await getSupabaseClient().from(table).select('value').eq('user_id', userId).eq('key', key).maybeSingle();
  if (error) throw new Error(error.message);
  return data?.value ? ({ ...fallback, ...data.value } as T) : fallback;
}

async function writeSetting<T>(key: SettingsKey, value: T): Promise<T> {
  const table = getSupabaseConfig().tables.settings;
  const client = getSupabaseClient();
  const userId = await getCurrentUserId();
  const existing = await client.from(table).select('id').eq('user_id', userId).eq('key', key).maybeSingle();
  if (existing.error) throw new Error(existing.error.message);

  const payload = {
    id: existing.data?.id ?? createUuid(),
    user_id: userId,
    key,
    value,
    data: value,
    updated_at: nowIso(),
    created_at: existing.data?.id ? undefined : nowIso(),
  };

  const { error } = existing.data?.id
    ? await client.from(table).update(payload).eq('id', existing.data.id)
    : await client.from(table).insert(payload);
  if (error) throw new Error(error.message);
  return value;
}

async function readExtensionRuntimeConfig(): Promise<ExtensionRuntimeConfig | null> {
  const table = getSupabaseConfig().tables.settings;
  const userId = await getCurrentUserId();
  const { data, error } = await getSupabaseClient().from(table).select('value').eq('user_id', userId).eq('key', 'extension_runtime').maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.value ?? null) as ExtensionRuntimeConfig | null;
}

function mergeImportSettings(current: ImportSettings, input: UpdateImportSettingsInput): ImportSettings {
  return {
    ...current,
    ...input,
    deduplication: { ...current.deduplication, ...(input.deduplication ?? {}) },
    routes: { ...current.routes, ...(input.routes ?? {}) },
    safeMode: { ...current.safeMode, ...(input.safeMode ?? {}) },
    branchRules: input.branchRules ?? current.branchRules,
    logs: { ...current.logs, ...(input.logs ?? {}) },
  };
}

function mergeDispatchSettings(current: DispatchSettings, input: UpdateDispatchSettingsInput): DispatchSettings {
  return {
    whatsapp: { ...current.whatsapp, ...(input.whatsapp ?? {}) },
    instagram: { ...current.instagram, ...(input.instagram ?? {}) },
  };
}

export const supabaseSettingsRepository: SettingsRepository = {
  async getImportSettings() {
    return readSetting('import', defaultImportSettings);
  },

  async updateImportSettings(input) {
    return writeSetting('import', mergeImportSettings(await this.getImportSettings(), input));
  },

  async resetImportSettings() {
    return writeSetting('import', defaultImportSettings);
  },

  async getDispatchSettings() {
    return readSetting('dispatch', defaultDispatchSettings);
  },

  async updateDispatchSettings(input) {
    return writeSetting('dispatch', mergeDispatchSettings(await this.getDispatchSettings(), input));
  },

  async resetDispatchSettings() {
    return writeSetting('dispatch', defaultDispatchSettings);
  },

  async getExtensionRuntimeConfig() {
    return readExtensionRuntimeConfig();
  },

  async updateExtensionRuntimeConfig(input) {
    return writeSetting('extension_runtime', input);
  },
};
