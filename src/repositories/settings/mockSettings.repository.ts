import { defaultImportSettings } from '../../services/import-settings/importSettings.seed';
import type { ImportSettings, UpdateImportSettingsInput } from '../../services/import-settings/types';
import type { ExtensionRuntimeConfig } from '../../services/platform-config/types';
import { DEFAULT_ACTIVE_DAYS, defaultDispatchSettings } from '../../services/settings/settings.seed';
import type { DispatchSettings, UpdateDispatchSettingsInput } from '../../services/settings/types';
import type { SettingsRepository } from './settings.repository';

const IMPORT_STORAGE_KEY = 'lead-certo:import-settings:v1';
const DISPATCH_STORAGE_KEY = 'lead-certo:dispatch-settings:v1';
const EXTENSION_RUNTIME_STORAGE_KEY = 'lead-certo:extension-runtime:v1';

function isBrowser() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function safeNumber(value: unknown, fallback: number, min?: number) {
  const parsed = Number(value);
  const nextValue = Number.isFinite(parsed) ? parsed : fallback;
  return min === undefined ? nextValue : Math.max(min, nextValue);
}

function safeString(value: unknown, fallback: string) {
  const text = String(value ?? '').trim();
  return text || fallback;
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

function safeTime(value: unknown, fallback: string) {
  const text = String(value ?? '').trim();
  return /^\d{1,2}:\d{2}$/.test(text) ? text : fallback;
}

function normalizeImportSettings(raw: unknown): ImportSettings {
  const source = raw && typeof raw === 'object' ? (raw as Partial<ImportSettings>) : {};

  return {
    minRating: safeNumber(source.minRating, defaultImportSettings.minRating),
    minReviews: safeNumber(source.minReviews, defaultImportSettings.minReviews),
    deduplication: {
      ...defaultImportSettings.deduplication,
      ...(source.deduplication ?? {}),
    },
    routes: {
      ...defaultImportSettings.routes,
      ...(source.routes ?? {}),
    },
    safeMode: {
      ...defaultImportSettings.safeMode,
      ...(source.safeMode ?? {}),
    },
    branchRules: Array.isArray(source.branchRules) ? source.branchRules : defaultImportSettings.branchRules,
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
      perBatch: safeNumber(whatsapp.perBatch ?? whatsapp.loteTamanho ?? whatsapp.perBlock, defaultDispatchSettings.whatsapp.perBatch, 1),
      batches: safeNumber(whatsapp.batches ?? whatsapp.blocoQuantidade ?? whatsapp.blocks, defaultDispatchSettings.whatsapp.batches, 1),
      batchDelayMinutes: safeNumber(whatsapp.batchDelayMinutes ?? whatsapp.loteEsperaMin ?? whatsapp.delayMinutes, defaultDispatchSettings.whatsapp.batchDelayMinutes, 0),
      dailyLimit: safeNumber(whatsapp.dailyLimit, defaultDispatchSettings.whatsapp.dailyLimit, 1),
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
      dailyLimit: safeNumber(instagram.dailyLimit, defaultDispatchSettings.instagram.dailyLimit, 1),
      activeDays: safeStringList(instagram.activeDays, DEFAULT_ACTIVE_DAYS),
      batchBehavior: safeString(instagram.batchBehavior, defaultDispatchSettings.instagram.batchBehavior),
    },
    chipLevels: Object.fromEntries(
      Object.entries({ ...defaultDispatchSettings.chipLevels, ...((source.chipLevels ?? {}) as Record<string, unknown>) }).map(([level, preset]) => [
        level,
        { blockSize: safeNumber((preset as Record<string, unknown>).blockSize, defaultDispatchSettings.chipLevels[level]?.blockSize ?? 30, 1) },
      ]),
    ),
  };
}

function readJson<T>(key: string, fallback: T, normalize: (raw: unknown) => T): T {
  if (!isBrowser()) return fallback;

  try {
    const stored = window.localStorage.getItem(key);
    return stored ? normalize(JSON.parse(stored)) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  if (!isBrowser()) return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

function mergeImportSettings(current: ImportSettings, input: UpdateImportSettingsInput): ImportSettings {
  return normalizeImportSettings({
    ...current,
    ...input,
    deduplication: {
      ...current.deduplication,
      ...(input.deduplication ?? {}),
    },
    routes: {
      ...current.routes,
      ...(input.routes ?? {}),
    },
    safeMode: {
      ...current.safeMode,
      ...(input.safeMode ?? {}),
    },
    branchRules: input.branchRules ?? current.branchRules,
    logs: {
      ...current.logs,
      ...(input.logs ?? {}),
    },
  });
}

function mergeDispatchSettings(current: DispatchSettings, input: UpdateDispatchSettingsInput): DispatchSettings {
  return normalizeDispatchSettings({
    whatsapp: {
      ...current.whatsapp,
      ...(input.whatsapp ?? {}),
    },
    instagram: {
      ...current.instagram,
      ...(input.instagram ?? {}),
    },
    chipLevels: {
      ...current.chipLevels,
      ...((input as UpdateDispatchSettingsInput & { chipLevels?: DispatchSettings['chipLevels'] }).chipLevels ?? {}),
    },
  });
}

export const mockSettingsRepository: SettingsRepository = {
  async getImportSettings() {
    return readJson(IMPORT_STORAGE_KEY, defaultImportSettings, normalizeImportSettings);
  },

  async updateImportSettings(input) {
    const nextSettings = mergeImportSettings(await this.getImportSettings(), input);
    writeJson(IMPORT_STORAGE_KEY, nextSettings);
    return nextSettings;
  },

  async resetImportSettings() {
    writeJson(IMPORT_STORAGE_KEY, defaultImportSettings);
    return defaultImportSettings;
  },

  async getDispatchSettings() {
    return readJson(DISPATCH_STORAGE_KEY, defaultDispatchSettings, normalizeDispatchSettings);
  },

  async updateDispatchSettings(input) {
    const nextSettings = mergeDispatchSettings(await this.getDispatchSettings(), input);
    writeJson(DISPATCH_STORAGE_KEY, nextSettings);
    return nextSettings;
  },

  async resetDispatchSettings() {
    writeJson(DISPATCH_STORAGE_KEY, defaultDispatchSettings);
    return defaultDispatchSettings;
  },

  async getExtensionRuntimeConfig() {
    return readJson<ExtensionRuntimeConfig | null>(EXTENSION_RUNTIME_STORAGE_KEY, null, (raw) => (raw && typeof raw === 'object' ? raw as ExtensionRuntimeConfig : null));
  },

  async updateExtensionRuntimeConfig(input) {
    writeJson(EXTENSION_RUNTIME_STORAGE_KEY, input);
    return input;
  },
};
