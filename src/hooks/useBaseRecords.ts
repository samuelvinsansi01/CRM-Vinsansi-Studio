import { useCallback, useEffect, useRef, useState } from 'react';
import { baseService } from '../services/base/base.service';
import type { BaseArchiveResult, BaseFilters, BaseLead, BaseSummary } from '../services/base/types';

type BaseOptions = {
  origins: string[];
  branches: string[];
  states: string[];
  cities: string[];
  destinations: string[];
  statuses: string[];
  outcomes: string[];
};

const emptySummary: BaseSummary = {
  total: 0,
  sent: 0,
  sentWhatsApp: 0,
  sentInstagram: 0,
  archived: 0,
  invalid: 0,
  duplicates: 0,
};

const emptyOptions: BaseOptions = {
  origins: ['Todos'],
  branches: ['Todos'],
  states: ['Todos'],
  cities: ['Todos'],
  destinations: ['Todos'],
  statuses: ['Todos'],
  outcomes: ['Todos'],
};

export function useBaseRecords(filters: BaseFilters) {
  const [records, setRecords] = useState<BaseLead[]>([]);
  const [summary, setSummary] = useState<BaseSummary>(emptySummary);
  const [options, setOptions] = useState<BaseOptions>(emptyOptions);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const hasLoadedRef = useRef(false);

  const refresh = useCallback(() => setRefreshKey((current) => current + 1), []);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(!hasLoadedRef.current);
      setError(null);
      try {
        const [nextRecords, nextSummary, nextOptions] = await Promise.all([
          baseService.list(filters),
          baseService.summary(),
          baseService.options(),
        ]);
        if (!active) return;
        setRecords(nextRecords);
        setSummary(nextSummary);
        setOptions(nextOptions);
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Erro ao carregar Base Permanente.');
        if (!hasLoadedRef.current) {
          setRecords([]);
          setSummary(emptySummary);
          setOptions(emptyOptions);
        }
      } finally {
        if (active) {
          hasLoadedRef.current = true;
          setLoading(false);
        }
      }
    }
    void load();
    return () => { active = false; };
  }, [filters, refreshKey]);

  const archiveMany = useCallback(async (ids: string[]): Promise<BaseArchiveResult> => {
    setSaving(true);
    try {
      const result = await baseService.archiveMany(ids);
      refresh();
      return result;
    } finally {
      setSaving(false);
    }
  }, [refresh]);

  const updateMetadata = useCallback(async (id:string,outcome:string,notes:string) => { setSaving(true); try { await baseService.updateMetadata(id,outcome,notes); refresh(); } finally { setSaving(false); } }, [refresh]);

  return { records, summary, options, loading, saving, error, refresh, archiveMany, updateMetadata };
}
