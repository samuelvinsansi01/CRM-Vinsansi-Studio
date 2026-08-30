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

      // A fila final e os lotes são derivados da posição operacional ativa no banco.
      // A releitura silenciosa compacta a página e faz o próximo item preencher a
      // vaga, sem puxar automaticamente um novo lead da Base de Importados.
      const expectedTotal = Math.max(0, total - 1);
      const targetPage = Math.min(page, Math.max(1, Math.ceil(expectedTotal / rowsPerPage)));
      setRefreshing(true);
      try {
        const result = profile
          ? await instagramQueueService.page({ profile, scheduledDate }, { page: targetPage, pageSize: rowsPerPage })
          : { batches: [], total: 0, summary: emptySummary };
        setBatches(result.batches);
        setTotal(result.total);
        setSummary(result.summary);
        if (targetPage !== page) setPage(targetPage);
      } catch {
        refresh();
      } finally {
        setRefreshing(false);
      }
    },
    [page, profile, refresh, rowsPerPage, scheduledDate, total],
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
