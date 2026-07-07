import { useCallback, useEffect, useRef, useState } from 'react';
import { instagramQueueService } from '../services/instagram-queue/instagramQueue.service';
import type { InstagramQueueBatch, InstagramQueueLead, InstagramQueueSummary, UpdateInstagramQueueLeadInput } from '../services/instagram-queue/types';

const emptySummary: InstagramQueueSummary = {
  total: 0,
  queued: 0,
  sent: 0,
  errors: 0,
  invalid: 0,
};

export function useInstagramQueue(profile: string, scheduledDate: string) {
  const [profiles, setProfiles] = useState<string[]>([]);
  const [batches, setBatches] = useState<InstagramQueueBatch[]>([]);
  const [summary, setSummary] = useState<InstagramQueueSummary>(emptySummary);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const hasLoadedRef = useRef(false);

  const refresh = useCallback(() => setRefreshKey((current) => current + 1), []);

  useEffect(() => {
    let active = true;

    async function load() {
      const isInitialLoad = !hasLoadedRef.current;
      if (isInitialLoad) setLoading(true);
      else setRefreshing(true);
      setError(null);

      try {
        const nextProfiles = await instagramQueueService.listProfiles();
        const safeProfile = profile || nextProfiles[0] || '';
        const [nextBatches, nextSummary] = await Promise.all([
          instagramQueueService.listBatches({ profile: safeProfile, scheduledDate }),
          instagramQueueService.summary({ profile: safeProfile, scheduledDate }),
        ]);

        if (!active) return;
        setProfiles(nextProfiles);
        setBatches(nextBatches);
        setSummary(nextSummary);
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Erro ao carregar fila Instagram.');
        if (isInitialLoad) {
          setProfiles([]);
          setBatches([]);
          setSummary(emptySummary);
        }
      } finally {
        if (active) {
          hasLoadedRef.current = true;
          setLoading(false);
          setRefreshing(false);
        }
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, [profile, scheduledDate, refreshKey]);

  const updateLead = useCallback(
    async (id: string, input: UpdateInstagramQueueLeadInput) => {
      await instagramQueueService.updateLead(id, input);
      refresh();
    },
    [refresh],
  );

  const send = useCallback(
    async (ids: string[]) => {
      await instagramQueueService.send(ids);
      refresh();
    },
    [refresh],
  );

  const pause = useCallback(
    async (ids: string[]) => {
      await instagramQueueService.pause(ids);
      refresh();
    },
    [refresh],
  );

  const resume = useCallback(
    async (ids: string[]) => {
      await instagramQueueService.resume(ids);
      refresh();
    },
    [refresh],
  );

  const reprocess = useCallback(
    async (ids: string[]) => {
      await instagramQueueService.reprocess(ids);
      refresh();
    },
    [refresh],
  );

  const invalidate = useCallback(
    async (lead: InstagramQueueLead) => {
      await instagramQueueService.invalidate(lead.id);
      refresh();
    },
    [refresh],
  );

  return {
    profiles,
    batches,
    summary,
    loading,
    refreshing,
    error,
    refresh,
    updateLead,
    send,
    pause,
    resume,
    reprocess,
    invalidate,
  };
}
