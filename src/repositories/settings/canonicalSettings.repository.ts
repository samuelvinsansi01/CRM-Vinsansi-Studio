import type { ImportSettings, UpdateImportSettingsInput } from '../../services/import-settings';
import { defaultImportSettings } from '../../services/import-settings/importSettings.seed';
import { defaultDispatchSettings } from '../../services/settings/settings.seed';
import type { DispatchSettings, UpdateDispatchSettingsInput } from '../../services/settings/types';
import { getSupabaseClient } from '../../lib/supabase';
import { getCurrentUserId } from '../supabase.helpers';
import type { SettingsRepository } from './settings.repository';

const LEGACY_PREFIX = 'painel.local-settings.v1';
const MIGRATION_PREFIX = 'painel.settings-db-migrated.v1';

type OperationalSettingsRow = {
  dispatch_settings?: DispatchSettings | null;
  import_settings?: ImportSettings | null;
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
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

async function row(): Promise<OperationalSettingsRow> {
  const response = await getSupabaseClient().rpc('get_user_operational_settings');
  if (response.error) throw new Error(`Não foi possível carregar as configurações centralizadas: ${response.error.message}`);
  const result = Array.isArray(response.data) ? response.data[0] : response.data;
  return (result ?? {}) as OperationalSettingsRow;
}

function legacyKey(userId: string, name: string) {
  return `${LEGACY_PREFIX}:${userId}:${name}`;
}

function legacyValue<T>(userId: string, name: string): T | null {
  try {
    const raw = window.localStorage.getItem(legacyKey(userId, name));
    return raw ? JSON.parse(raw) as T : null;
  } catch {
    return null;
  }
}

async function migrateLegacyOnce() {
  if (typeof window === 'undefined') return;
  const userId = await getCurrentUserId();
  const marker = `${MIGRATION_PREFIX}:${userId}`;
  if (window.localStorage.getItem(marker) === 'done') return;

  const dispatch = legacyValue<DispatchSettings>(userId, 'dispatch');
  const importSettings = legacyValue<ImportSettings>(userId, 'import');
  const client = getSupabaseClient();

  if (dispatch) {
    const response = await client.rpc('save_dispatch_settings', { p_settings: dispatch });
    if (response.error) throw new Error(`Falha ao migrar configurações locais de disparo: ${response.error.message}`);
  }
  if (importSettings) {
    const response = await client.rpc('save_import_settings', { p_settings: importSettings });
    if (response.error) throw new Error(`Falha ao migrar configurações locais de importação: ${response.error.message}`);
  }
  window.localStorage.setItem(marker, 'done');
}

async function initializedRow() {
  await migrateLegacyOnce();
  return row();
}

export const canonicalSettingsRepository: SettingsRepository = {
  async getImportSettings() {
    const settings = (await initializedRow()).import_settings;
    return clone(settings ?? defaultImportSettings);
  },
  async updateImportSettings(input) {
    const candidate = mergeImport(await this.getImportSettings(), input);
    const response = await getSupabaseClient().rpc('save_import_settings', { p_settings: candidate });
    if (response.error) throw new Error(`Não foi possível salvar as configurações de importação: ${response.error.message}`);
    return clone((response.data ?? candidate) as ImportSettings);
  },
  async resetImportSettings() {
    const response = await getSupabaseClient().rpc('reset_import_settings');
    if (response.error) throw new Error(`Não foi possível restaurar as configurações de importação: ${response.error.message}`);
    return clone((response.data ?? defaultImportSettings) as ImportSettings);
  },
  async getDispatchSettings() {
    const settings = (await initializedRow()).dispatch_settings;
    return clone(settings ?? defaultDispatchSettings);
  },
  async updateDispatchSettings(input) {
    const candidate = mergeDispatch(await this.getDispatchSettings(), input);
    const response = await getSupabaseClient().rpc('save_dispatch_settings', { p_settings: candidate });
    if (response.error) throw new Error(`Não foi possível salvar as configurações de disparo: ${response.error.message}`);
    return clone((response.data ?? candidate) as DispatchSettings);
  },
  async resetDispatchSettings() {
    const response = await getSupabaseClient().rpc('reset_dispatch_settings');
    if (response.error) throw new Error(`Não foi possível restaurar as configurações de disparo: ${response.error.message}`);
    return clone((response.data ?? defaultDispatchSettings) as DispatchSettings);
  },
};
