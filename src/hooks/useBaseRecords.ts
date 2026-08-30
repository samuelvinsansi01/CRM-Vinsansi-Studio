import { useCallback, useEffect, useRef, useState } from 'react';
import { baseService } from '../services/base/base.service';
import type { BaseFilters, BaseLead, BaseSummary } from '../services/base/types';
import { normalizePageRequest, type PageRequest } from '../services/pagination/types';

const emptySummary: BaseSummary = {
  total: 0,
  sent: 0,
  sentWhatsApp: 0,
  sentInstagram: 0,
  noContact: 0,
  invalid: 0,
  duplicates: 0,
};

export function useBaseRecords(filters: BaseFilters, request: Partial<PageRequest> = {}) {
  const normalized = normalizePageRequest(request);
  const [records, setRecords] = useState<BaseLead[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<BaseSummary>(emptySummary);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const hasLoadedRef = useRef(false);
  const requestIdRef = useRef(0);

  const refresh = useCallback(() => setRefreshKey((current) => current + 1), []);

  useEffect(() => {
    let active = true;
    const requestId = ++requestIdRef.current;
    async function load() {
      if (!hasLoadedRef.current) setLoading(true);
      else setRefreshing(true);
      setError(null);
      try {
        const result = await baseService.page(filters, normalized);
        if (!active || requestId !== requestIdRef.current) return;
        setRecords(result.items);
        setTotal(result.total);
        setSummary(result.summary);
      } catch (err) {
        if (!active || requestId !== requestIdRef.current) return;
        setError(err instanceof Error ? err.message : 'Erro ao carregar Base Permanente.');
        if (!hasLoadedRef.current) {
          setRecords([]);
          setTotal(0);
          setSummary(emptySummary);
        }
      } finally {
        if (active && requestId === requestIdRef.current) {
          hasLoadedRef.current = true;
          setLoading(false);
          setRefreshing(false);
        }
      }
    }
    void load();
    return () => { active = false; };
  }, [filters.origin, filters.search, filters.status, normalized.page, normalized.pageSize, refreshKey]);

  return { records, total, summary, loading, refreshing, error, refresh };
}
