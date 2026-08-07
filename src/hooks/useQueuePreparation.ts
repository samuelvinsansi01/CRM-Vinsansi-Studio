import { useCallback, useEffect, useRef, useState } from 'react';
import { eventBus } from '../lib/events';
import { queuePreparationService } from '../services/queue-preparation';
import type { QueuePreparationChannel, QueuePreparationResult, QueuePreparationSnapshot } from '../services/queue-preparation';

export function useQueuePreparation(
  channel: QueuePreparationChannel,
  requestedDate: string,
  resourceId: string,
) {
  const [snapshot, setSnapshot] = useState<QueuePreparationSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const hasLoaded = useRef(false);

  const refresh = useCallback(() => setRefreshKey((value) => value + 1), []);

  useEffect(() => {
    const offImport = eventBus.on('import:changed', refresh);
    const offConfig = eventBus.on('config:changed', refresh);
    const offSettings = eventBus.on('dispatch-settings:changed', refresh);
    const offWhatsApp = eventBus.on('whatsapp-queue:changed', refresh);
    const offInstagram = eventBus.on('instagram-queue:changed', refresh);
    return () => {
      offImport();
      offConfig();
      offSettings();
      offWhatsApp();
      offInstagram();
    };
  }, [refresh]);

  useEffect(() => {
    let active = true;
    async function load() {
      if (hasLoaded.current) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const next = await queuePreparationService.snapshot(channel, requestedDate, resourceId);
        if (active) setSnapshot(next);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Não foi possível carregar a preparação das filas.');
      } finally {
        if (active) {
          hasLoaded.current = true;
          setLoading(false);
          setRefreshing(false);
        }
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [channel, requestedDate, resourceId, refreshKey]);

  const enqueue = useCallback(async (ids: string[]): Promise<QueuePreparationResult> => {
    const selectedResource = resourceId || snapshot?.selectedResource?.id || '';
    if (!selectedResource) throw new Error(channel === 'WhatsApp' ? 'Selecione um chip ativo.' : 'Selecione um perfil Instagram ativo.');
    setSaving(true);
    try {
      const result = await queuePreparationService.enqueueValidated(channel, ids, requestedDate, selectedResource);
      refresh();
      return result;
    } finally {
      setSaving(false);
    }
  }, [channel, requestedDate, resourceId, snapshot?.selectedResource?.id, refresh]);

  return { snapshot, loading, refreshing, saving, error, refresh, enqueue };
}
