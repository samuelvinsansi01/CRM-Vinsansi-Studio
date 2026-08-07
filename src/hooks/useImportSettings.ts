import { useCallback, useEffect, useState } from 'react';
import { eventBus } from '../lib/events';
import { importSettingsService } from '../services/import-settings';
import type { ImportSettings, UpdateImportSettingsInput } from '../services/import-settings';

export function useImportSettings() {
  const [settings, setSettings] = useState<ImportSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      setSettings(await importSettingsService.get());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar configurações de importação.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    return eventBus.on('import-settings:changed', () => void refresh());
  }, [refresh]);

  const updateSettings = useCallback(async (input: UpdateImportSettingsInput) => {
    setSaving(true);
    setError(null);

    try {
      const nextSettings = await importSettingsService.update(input);
      setSettings(nextSettings);
      return nextSettings;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar configurações de importação.');
      throw err;
    } finally {
      setSaving(false);
    }
  }, []);

  const resetSettings = useCallback(async () => {
    setSaving(true);
    setError(null);

    try {
      const nextSettings = await importSettingsService.reset();
      setSettings(nextSettings);
      return nextSettings;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao restaurar configurações de importação.');
      throw err;
    } finally {
      setSaving(false);
    }
  }, []);

  return {
    settings,
    loading,
    saving,
    error,
    refresh,
    updateSettings,
    resetSettings,
  };
}
