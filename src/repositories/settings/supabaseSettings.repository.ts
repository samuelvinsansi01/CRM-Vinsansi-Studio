import { getSupabaseClient, getSupabaseConfig } from '../../lib/supabase';
import { defaultImportSettings } from '../../services/import-settings/importSettings.seed';
import type { ImportSettings, UpdateImportSettingsInput } from '../../services/import-settings/types';
import type { ExtensionRuntimeConfig } from '../../services/platform-config/types';
import { DEFAULT_ACTIVE_DAYS, defaultDispatchSettings } from '../../services/settings/settings.seed';
import type { DispatchSettings, UpdateDispatchSettingsInput } from '../../services/settings/types';
import { createUuid, getCurrentUserId, nowIso } from '../supabase.helpers';
import type { SettingsRepository } from './settings.repository';

type SettingsKey = 'import' | 'dispatch' | 'extension_runtime';

function safeNumber(value: unknown, fallback: number, min?: number) {
  const parsed = Number(value);
  const nextValue = Number.isFinite(parsed) ? parsed : fallback;
  return min === undefined ? nextValue : Math.max(min, nextValue);
}

function safeString(value: unknown, fallback: string) {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function safeTime(value: unknown, fallback: string) {
  const text = String(value ?? '').trim();
  return /^\d{1,2}:\d{2}$/.test(text) ? text : fallback;
}

function safeStringList(value: unknown, fallback: string[]) {
  if (Array.isArray(value)) {
    const items = value.map((item) => String(item ?? '').trim()).filter(Boolean);
    return items.length ? items : fallback;
  }

  const items = String(value ?? '')
    .split(/[,;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length ? items : fallback;
}

function normalizeImportSettings(raw: unknown): ImportSettings {
  const source = raw && typeof raw === 'object' ? (raw as Partial<ImportSettings>) : {};
  return {
    minRating: safeNumber(source.minRating, defaultImportSettings.minRating),
    minReviews: safeNumber(source.minReviews, defaultImportSettings.minReviews, 0),
    safeMode: {
      ...defaultImportSettings.safeMode,
      ...(source.safeMode ?? {}),
    },
    branchRules: Array.isArray(source.branchRules) ? source.branchRules : defaultImportSettings.branchRules,
    deduplication: {
      ...defaultImportSettings.deduplication,
      ...(source.deduplication ?? {}),
    },
    routes: {
      ...defaultImportSettings.routes,
      ...(source.routes ?? {}),
    },
    logs: {
      ...defaultImportSettings.logs,
      ...(source.logs ?? {}),
    },
  };
}

function normalizeDispatchSettings(raw: unknown): DispatchSettings {
  const source = raw && typeof raw === 'object' ? (raw as Partial<DispatchSettings> & Record<string, unknown>) : {};
  const whatsapp = (source.whatsapp ?? {}) as Record<string, unknown>;
  const instagram = (source.instagram ?? {}) as Record<string, unknown>;

  return {
    whatsapp: {
      ...defaultDispatchSettings.whatsapp,
      ...whatsapp,
      startTime: safeTime(whatsapp.startTime ?? whatsapp.horarioInicio, defaultDispatchSettings.whatsapp.startTime),
      endTime: safeTime(whatsapp.endTime ?? whatsapp.horarioFim, defaultDispatchSettings.whatsapp.endTime),
      delayMinSeconds: safeNumber(whatsapp.delayMinSeconds ?? whatsapp.delayMin ?? whatsapp.intervalSeconds, defaultDispatchSettings.whatsapp.delayMinSeconds, 1),
      delayMaxSeconds: safeNumber(whatsapp.delayMaxSeconds ?? whatsapp.delayMax ?? whatsapp.intervalSeconds, defaultDispatchSettings.whatsapp.delayMaxSeconds, 1),
      perBatch: safeNumber(whatsapp.perBatch ?? whatsapp.loteTamanho ?? whatsapp.perBlock ?? whatsapp.blockSize, defaultDispatchSettings.whatsapp.perBatch, 1),
      batches: safeNumber(whatsapp.batches ?? whatsapp.blocoQuantidade ?? whatsapp.blocks, defaultDispatchSettings.whatsapp.batches, 1),
      batchDelayMinutes: safeNumber(whatsapp.batchDelayMinutes ?? whatsapp.loteEsperaMin ?? whatsapp.delayMinutes, defaultDispatchSettings.whatsapp.batchDelayMinutes, 0),
      dailyLimit: safeNumber(whatsapp.dailyLimit ?? whatsapp.limiteDiario, defaultDispatchSettings.whatsapp.dailyLimit, 1),
      activeDays: safeStringList(whatsapp.activeDays, DEFAULT_ACTIVE_DAYS),
      batchBehavior: safeString(whatsapp.batchBehavior, defaultDispatchSettings.whatsapp.batchBehavior),
    },
    instagram: {
      ...defaultDispatchSettings.instagram,
      ...instagram,
      profile: safeString(instagram.profile, defaultDispatchSettings.instagram.profile),
      profiles: safeStringList(instagram.profiles, defaultDispatchSettings.instagram.profiles),
      startTime: safeTime(instagram.startTime ?? instagram.horarioInicio, defaultDispatchSettings.instagram.startTime),
      endTime: safeTime(instagram.endTime ?? instagram.horarioFim, defaultDispatchSettings.instagram.endTime),
      delayMinSeconds: safeNumber(instagram.delayMinSeconds ?? instagram.delayMin, defaultDispatchSettings.instagram.delayMinSeconds, 1),
      delayMaxSeconds: safeNumber(instagram.delayMaxSeconds ?? instagram.delayMax, defaultDispatchSettings.instagram.delayMaxSeconds, 1),
      perBatch: safeNumber(instagram.perBatch ?? instagram.loteTamanho, defaultDispatchSettings.instagram.perBatch, 1),
      batches: safeNumber(instagram.batches ?? instagram.blocoQuantidade, defaultDispatchSettings.instagram.batches, 1),
      batchDelayMinutes: safeNumber(instagram.batchDelayMinutes ?? instagram.loteEsperaMin ?? instagram.delayMinutes, defaultDispatchSettings.instagram.batchDelayMinutes, 0),
      delayMinutes: safeNumber(instagram.delayMinutes ?? instagram.batchDelayMinutes, defaultDispatchSettings.instagram.delayMinutes, 0),
      dailyLimit: safeNumber(instagram.dailyLimit ?? instagram.limiteDiario, defaultDispatchSettings.instagram.dailyLimit, 1),
      activeDays: safeStringList(instagram.activeDays, DEFAULT_ACTIVE_DAYS),
      batchBehavior: safeString(instagram.batchBehavior, defaultDispatchSettings.instagram.batchBehavior),
    },
  };
}

async function readSetting<T>(key: SettingsKey, fallback: T, normalize?: (value: unknown) => T): Promise<T> {
  const table = getSupabaseConfig().tables.settings;
  const userId = await getCurrentUserId();
  const { data, error } = await getSupabaseClient().from(table).select('value, data').eq('user_id', userId).eq('key', key).maybeSingle();
  if (error) throw new Error(error.message);
  const value = data?.value && Object.keys(data.value as Record<string, unknown>).length ? data.value : data?.data;
  return normalize ? normalize(value ?? fallback) : (value ? ({ ...fallback, ...value } as T) : fallback);
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
  const { data, error } = await getSupabaseClient().from(table).select('value, data').eq('user_id', userId).eq('key', 'extension_runtime').maybeSingle();
  if (error) throw new Error(error.message);
  return ((data?.value && Object.keys(data.value as Record<string, unknown>).length ? data.value : data?.data) ?? null) as ExtensionRuntimeConfig | null;
}

function mergeImportSettings(current: ImportSettings, input: UpdateImportSettingsInput): ImportSettings {
  return normalizeImportSettings({
    ...current,
    ...input,
    deduplication: { ...current.deduplication, ...(input.deduplication ?? {}) },
    routes: { ...current.routes, ...(input.routes ?? {}) },
    safeMode: { ...current.safeMode, ...(input.safeMode ?? {}) },
    branchRules: input.branchRules ?? current.branchRules,
    logs: { ...current.logs, ...(input.logs ?? {}) },
  });
}

function mergeDispatchSettings(current: DispatchSettings, input: UpdateDispatchSettingsInput): DispatchSettings {
  return normalizeDispatchSettings({
    whatsapp: { ...current.whatsapp, ...(input.whatsapp ?? {}) },
    instagram: { ...current.instagram, ...(input.instagram ?? {}) },
  });
}

export const supabaseSettingsRepository: SettingsRepository = {
  async getImportSettings() {
    return readSetting('import', defaultImportSettings, normalizeImportSettings);
  },

  async updateImportSettings(input) {
    return writeSetting('import', mergeImportSettings(await this.getImportSettings(), input));
  },

  async resetImportSettings() {
    return writeSetting('import', defaultImportSettings);
  },

  async getDispatchSettings() {
    return readSetting('dispatch', defaultDispatchSettings, normalizeDispatchSettings);
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
