import { useCallback, useEffect, useState } from 'react';
import { baseService } from '../services/base/base.service';
import type { BaseFilters, BaseLead, BaseSummary, UpdateBaseLeadInput } from '../services/base/types';

type BaseOptions = {
  origins: string[];
  branches: string[];
  states: string[];
  cities: string[];
  destinations: string[];
  statuses: string[];
};

const emptySummary: BaseSummary = {
  total: 0,
  sent: 0,
  sentWhatsApp: 0,
  sentInstagram: 0,
  archived: 0,
  invalid: 0,
  errors: 0,
};

const emptyOptions: BaseOptions = {
  origins: ['Todos'],
  branches: ['Todos'],
  states: ['Todos'],
  cities: ['Todos'],
  destinations: ['Todos'],
  statuses: ['Todos'],
};

export function useBaseRecords(filters: BaseFilters) {
  const [records, setRecords] = useState<BaseLead[]>([]);
  const [summary, setSummary] = useState<BaseSummary>(emptySummary);
  const [options, setOptions] = useState<BaseOptions>(emptyOptions);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey((current) => current + 1), []);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
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
        setRecords([]);
        setSummary(emptySummary);
        setOptions(emptyOptions);
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, [filters, refreshKey]);

  const updateLead = useCallback(
    async (id: string, input: UpdateBaseLeadInput) => {
      await baseService.update(id, input);
      refresh();
    },
    [refresh],
  );

  const archiveLead = useCallback(
    async (lead: BaseLead) => {
      await baseService.archive(lead.id);
      refresh();
    },
    [refresh],
  );

  const archiveMany = useCallback(
    async (ids: string[]) => {
      await baseService.archiveMany(ids);
      refresh();
    },
    [refresh],
  );

  const restoreLead = useCallback(
    async (lead: BaseLead) => {
      await baseService.restore(lead.id);
      refresh();
    },
    [refresh],
  );

  const restoreMany = useCallback(
    async (ids: string[]) => {
      await baseService.restoreMany(ids);
      refresh();
    },
    [refresh],
  );

  const removeLead = useCallback(
    async (lead: BaseLead) => {
      await baseService.remove(lead.id);
      refresh();
    },
    [refresh],
  );

  const removeMany = useCallback(
    async (ids: string[]) => {
      await baseService.removeMany(ids);
      refresh();
    },
    [refresh],
  );

  return {
    records,
    summary,
    options,
    loading,
    error,
    refresh,
    updateLead,
    archiveLead,
    archiveMany,
    restoreLead,
    restoreMany,
    removeLead,
    removeMany,
  };
}
