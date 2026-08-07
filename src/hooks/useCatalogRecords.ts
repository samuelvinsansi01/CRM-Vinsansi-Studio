import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { eventBus } from '../lib/events';
import {
  createCatalogRecord,
  deleteCatalogRecord,
  listCatalogRecords,
  updateCatalogRecord,
  type CatalogKind,
  type CatalogRecord,
} from '../repositories/configuration';

export function useCatalogRecords(kind: CatalogKind, search: string, status: string) {
  const [records, setRecords] = useState<CatalogRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadedRef = useRef(false);

  const refresh = useCallback(async () => {
    if (loadedRef.current) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      setRecords(await listCatalogRecords(kind));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao carregar os registros.');
    } finally {
      loadedRef.current = true;
      setLoading(false);
      setRefreshing(false);
    }
  }, [kind]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => eventBus.on('config:changed', ({ kind: changedKind }) => {
    if (changedKind === kind) void refresh();
  }), [kind, refresh]);

  const filteredRecords = useMemo(() => {
    const query = search.trim().toLowerCase();
    return records.filter((record) => {
      const matchesStatus = status === 'Todos'
        || (status === 'Ativos' && record.active)
        || (status === 'Inativos' && !record.active);
      if (!matchesStatus) return false;
      if (!query) return true;
      return Object.values(record).some((value) => {
        if (Array.isArray(value)) return value.join(' ').toLowerCase().includes(query);
        return String(value ?? '').toLowerCase().includes(query);
      });
    });
  }, [records, search, status]);

  const create = useCallback(async (input: Record<string, unknown>) => {
    await createCatalogRecord(kind, input);
    await refresh();
  }, [kind, refresh]);

  const update = useCallback(async (id: string, input: Record<string, unknown>) => {
    await updateCatalogRecord(kind, id, input);
    await refresh();
  }, [kind, refresh]);

  const remove = useCallback(async (id: string) => {
    await deleteCatalogRecord(kind, id);
    await refresh();
  }, [kind, refresh]);

  return { records, filteredRecords, loading, refreshing, error, refresh, create, update, remove };
}
