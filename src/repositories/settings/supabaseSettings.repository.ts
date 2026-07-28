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
  if (error) throw new Error(`Nao foi possivel carregar a configuracao ${key}: ${error.message}`);
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

  const confirmation = await client
    .from(table)
    .select('value')
    .eq('user_id', userId)
    .eq('key', key)
    .maybeSingle();
  if (confirmation.error) throw new Error(`A configuracao foi gravada, mas nao pode ser confirmada: ${confirmation.error.message}`);
  if (!confirmation.data) throw new Error('A configuracao nao foi encontrada apos o salvamento.');
  if (JSON.stringify(confirmation.data.value) !== JSON.stringify(value)) {
    throw new Error('O banco retornou uma configuracao diferente da que foi salva.');
  }
  return value;
}

async function readExtensionRuntimeConfig(): Promise<ExtensionRuntimeConfig | null> {
  const table = getSupabaseConfig().tables.settings;
  const userId = await getCurrentUserId();
  const { data, error } = await getSupabaseClient().from(table).select('value').eq('user_id', userId).eq('key', 'extension_runtime').maybeSingle();
  if (error) throw new Error(`Nao foi possivel carregar a configuracao da extensao: ${error.message}`);
  return (data?.value ?? null) as ExtensionRuntimeConfig | null;
}

function normalizeDispatchSettings(raw: unknown) {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const whatsapp = (source.whatsapp ?? {}) as Record<string, unknown>;
  const instagram = (source.instagram ?? {}) as Record<string, unknown>;
  const chipLevelsRaw = (source.chipLevels ?? {}) as Record<string, unknown>;
  const chipLevels = Object.fromEntries(
    Object.entries({ ...defaultDispatchSettings.chipLevels, ...chipLevelsRaw }).map(([level, preset]) => {
      const raw = preset as Record<string, unknown>;
      const fallback = defaultDispatchSettings.chipLevels[level] ?? defaultDispatchSettings.chipLevels.estabilizado;
      const dailyLimit = Number(raw.dailyLimit ?? fallback.dailyLimit ?? 1);
      const blockSizeRaw = Number(raw.blockSize ?? 0);
      const batchCount = Number(
        raw.batchCount ?? (blockSizeRaw > 0 ? Math.max(1, Math.round(dailyLimit / blockSizeRaw)) : fallback.batchCount ?? 1),
      );
      return [level, { dailyLimit, batchCount }];
    }),
  );

  return {
    whatsapp: { ...defaultDispatchSettings.whatsapp, ...whatsapp },
    instagram: { ...defaultDispatchSettings.instagram, ...instagram },
    chipLevels,
  } as DispatchSettings;
}

function mergeImportSettings(current: ImportSettings, input: UpdateImportSettingsInput): ImportSettings {
  return {
    ...current,
    ...input,
    deduplication: { ...current.deduplication, ...(input.deduplication ?? {}) },
    routes: { ...current.routes, ...(input.routes ?? {}) },
    safeMode: { ...current.safeMode, ...(input.safeMode ?? {}) },
    instagramLowRating: { ...current.instagramLowRating, ...(input.instagramLowRating ?? {}) },
    branchRules: input.branchRules ?? current.branchRules,
    logs: { ...current.logs, ...(input.logs ?? {}) },
  };
}

function mergeDispatchSettings(current: DispatchSettings, input: UpdateDispatchSettingsInput): DispatchSettings {
  return {
    whatsapp: { ...current.whatsapp, ...(input.whatsapp ?? {}) },
    instagram: { ...current.instagram, ...(input.instagram ?? {}) },
    chipLevels: {
      ...current.chipLevels,
      ...((input as UpdateDispatchSettingsInput & { chipLevels?: DispatchSettings['chipLevels'] }).chipLevels ?? {}),
    },
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
    const table = getSupabaseConfig().tables.settings;
    const userId = await getCurrentUserId();
    const { data, error } = await getSupabaseClient().from(table).select('value').eq('user_id', userId).eq('key', 'dispatch').maybeSingle();
    if (error) throw new Error(`Nao foi possivel carregar as configuracoes de disparo: ${error.message}`);
    return normalizeDispatchSettings(data?.value ?? defaultDispatchSettings);
  },

  async updateDispatchSettings(input) {
    const current = await this.getDispatchSettings();
    return writeSetting('dispatch', normalizeDispatchSettings(mergeDispatchSettings(current, input)));
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
