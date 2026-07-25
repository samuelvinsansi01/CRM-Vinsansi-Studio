import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { configService } from '../services/config/config.service';
import type { ConfigKind, ConfigListFilters, ConfigRecord, CreateConfigRecordInput, UpdateConfigRecordInput } from '../services/config/types';

export function useConfigRecords(kind: ConfigKind, filters: ConfigListFilters) {
  const [records, setRecords] = useState<ConfigRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasLoadedRef = useRef(false);

  const stableFilters = useMemo(
    () => ({ search: filters.search ?? '', status: filters.status ?? 'Todos' }),
    [filters.search, filters.status],
  );

  const refresh = useCallback(async () => {
    const isInitialLoad = !hasLoadedRef.current;
    if (isInitialLoad) setLoading(true);
    else setRefreshing(true);
    setError(null);

    try {
      const nextRecords = await configService.list(kind, stableFilters);
      setRecords(nextRecords);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar registros.');
      if (isInitialLoad) setRecords([]);
    } finally {
      hasLoadedRef.current = true;
      setLoading(false);
      setRefreshing(false);
    }
  }, [kind, stableFilters]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createRecord = useCallback(
    async (input: CreateConfigRecordInput) => {
      await configService.create(kind, input);
      await refresh();
    },
    [kind, refresh],
  );

  const updateRecord = useCallback(
    async (id: string, input: UpdateConfigRecordInput) => {
      await configService.update(kind, id, input);
      await refresh();
    },
    [kind, refresh],
  );

  const removeRecord = useCallback(
    async (id: string) => {
      await configService.remove(kind, id);
      await refresh();
    },
    [kind, refresh],
  );

  const toggleArchive = useCallback(
    async (id: string) => {
      await configService.toggleArchive(kind, id);
      await refresh();
    },
    [kind, refresh],
  );

  const bulkArchive = useCallback(
    async (ids: string[]) => {
      await configService.bulkArchive(kind, ids);
      await refresh();
    },
    [kind, refresh],
  );

  const bulkRestore = useCallback(
    async (ids: string[]) => {
      await configService.bulkRestore(kind, ids);
      await refresh();
    },
    [kind, refresh],
  );

  const bulkRemove = useCallback(
    async (ids: string[]) => {
      await configService.bulkRemove(kind, ids);
      await refresh();
    },
    [kind, refresh],
  );

  return {
    records,
    loading,
    refreshing,
    error,
    refresh,
    createRecord,
    updateRecord,
    removeRecord,
    toggleArchive,
    bulkArchive,
    bulkRestore,
    bulkRemove,
  };
}
