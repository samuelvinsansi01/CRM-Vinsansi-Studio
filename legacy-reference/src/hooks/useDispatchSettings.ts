import { useCallback, useEffect, useState } from 'react';
import { eventBus } from '../lib/events';
import { settingsService } from '../services/settings';
import type { DispatchSettings, UpdateDispatchSettingsInput } from '../services/settings';

export function useDispatchSettings() {
  const [settings, setSettings] = useState<DispatchSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      setSettings(await settingsService.getDispatchSettings());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar configurações de disparo.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    return eventBus.on('dispatch-settings:changed', () => void refresh());
  }, [refresh]);

  const updateSettings = useCallback(async (input: UpdateDispatchSettingsInput) => {
    setSaving(true);
    setError(null);

    try {
      const nextSettings = await settingsService.updateDispatchSettings(input);
      setSettings(nextSettings);
      return nextSettings;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar configurações de disparo.');
      throw err;
    } finally {
      setSaving(false);
    }
  }, []);

  const resetSettings = useCallback(async () => {
    setSaving(true);
    setError(null);

    try {
      const nextSettings = await settingsService.resetDispatchSettings();
      setSettings(nextSettings);
      return nextSettings;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao restaurar configurações de disparo.');
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
