import { useCallback, useEffect, useRef, useState } from 'react';
import { useMidnightRefresh } from './useMidnightRefresh';
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
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPageState] = useState(20);
  const [summary, setSummary] = useState<InstagramQueueSummary>(emptySummary);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const hasLoadedRef = useRef(false);
  const scopeRef = useRef('');

  const refresh = useCallback(() => setRefreshKey((current) => current + 1), []);
  useMidnightRefresh(refresh);

  useEffect(() => {
    let active = true;

    async function load() {
      const scopeKey = `${profile}:${scheduledDate}`;
      const scopeChanged = scopeRef.current !== scopeKey;
      if (scopeChanged) {
        scopeRef.current = scopeKey;
        hasLoadedRef.current = false;
        setBatches([]);
        setTotal(0);
        setSummary(emptySummary);
      }
      const isInitialLoad = !hasLoadedRef.current;
      if (isInitialLoad) setLoading(true);
      else setRefreshing(true);
      setError(null);

      try {
        const nextProfiles = await instagramQueueService.listProfiles();
        const pageResult = profile
          ? await instagramQueueService.page({ profile, scheduledDate }, { page, pageSize: rowsPerPage })
          : { batches: [], total: 0, summary: emptySummary };
        const nextBatches = pageResult.batches;
        const nextSummary = pageResult.summary;

        if (!active) return;
        setProfiles(nextProfiles);
        setBatches(nextBatches);
        setTotal(pageResult.total);
        setSummary(nextSummary);
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Erro ao carregar fila Instagram.');
        if (isInitialLoad) {
          setProfiles([]);
          setBatches([]);
          setTotal(0);
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
  }, [profile, scheduledDate, page, rowsPerPage, refreshKey]);

  useEffect(() => { setPage(1); }, [profile, scheduledDate]);
  const setRowsPerPage = useCallback((value: number) => { setRowsPerPageState(value); setPage(1); }, []);

  const updateLead = useCallback(
    async (id: string, input: UpdateInstagramQueueLeadInput) => {
      await instagramQueueService.updateLead(id, input);
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

  const reprocessScope = useCallback(async () => {
    const count = await instagramQueueService.reprocessScope({ profile, scheduledDate });
    if (count) refresh();
    return count;
  }, [profile, scheduledDate, refresh]);

  const patchLeadLocally = useCallback((id: string, patch: Partial<InstagramQueueLead>) => {
    setBatches((current) => current.map((batch) => ({
      ...batch,
      leads: batch.leads.map((lead) => lead.id === id ? { ...lead, ...patch } : lead),
    })));
  }, []);

  const invalidate = useCallback(
    async (lead: InstagramQueueLead) => {
      await instagramQueueService.invalidate(lead.id);
      setBatches((current) => current
        .map((batch) => ({ ...batch, leads: batch.leads.filter((candidate) => candidate.id !== lead.id) }))
        .filter((batch) => batch.leads.length > 0));
      setTotal((current) => Math.max(0, current - 1));
      setSummary((current) => ({
        ...current,
        total: Math.max(0, current.total - 1),
        queued: Math.max(0, current.queued - (['queued', 'paused', 'following', 'dm_opened'].includes(lead.status) ? 1 : 0)),
        sent: current.sent,
        errors: Math.max(0, current.errors - (['error', 'reconciliation_required'].includes(lead.status) ? 1 : 0)),
        invalid: current.invalid,
      }));
    },
    [],
  );

  return {
    profiles,
    batches,
    total,
    page,
    setPage,
    rowsPerPage,
    setRowsPerPage,
    summary,
    loading,
    refreshing,
    error,
    refresh,
    updateLead,
    pause,
    resume,
    reprocess,
    reprocessScope,
    patchLeadLocally,
    invalidate,
  };
}
