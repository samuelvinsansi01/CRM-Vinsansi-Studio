import { useCallback, useEffect, useRef, useState } from 'react';
import { leadCycleService } from '../services/lead-cycle/leadCycle.service';
import type {
  LeadCycleDetailsInput,
  LeadCycleImportedSummary,
  LeadCycleLead,
  LeadCyclePageFilters,
  LeadRoutingCommand,
  LeadRoutingResult,
} from '../services/lead-cycle/types';
import { normalizePageRequest, type PageRequest } from '../services/pagination/types';

export type LeadCycleView = 'imported';

const emptySummary: LeadCycleImportedSummary = { total: 0, noDestination: 0, whatsapp: 0, instagram: 0 };

export function useLeadCycle(
  _view: LeadCycleView = 'imported',
  filters: LeadCyclePageFilters = {},
  request: Partial<PageRequest> = {},
) {
  const normalizedRequest = normalizePageRequest(request);
  const [records, setRecords] = useState<LeadCycleLead[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<LeadCycleImportedSummary>(emptySummary);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const loadedRef = useRef(false);
  const requestIdRef = useRef(0);

  const refresh = useCallback(() => setRefreshKey((current) => current + 1), []);

  useEffect(() => {
    let active = true;
    const requestId = ++requestIdRef.current;
    async function load() {
      if (!loadedRef.current) setLoading(true);
      else setRefreshing(true);
      setError(null);
      try {
        const result = await leadCycleService.listImportedPage(filters, normalizedRequest);
        if (!active || requestId !== requestIdRef.current) return;
        setRecords(result.items);
        setTotal(result.total);
        setSummary(result.summary);
      } catch (err) {
        if (!active || requestId !== requestIdRef.current) return;
        setError(err instanceof Error ? err.message : 'Não foi possível carregar os leads.');
        if (!loadedRef.current) {
          setRecords([]);
          setTotal(0);
          setSummary(emptySummary);
        }
      } finally {
        if (active && requestId === requestIdRef.current) {
          loadedRef.current = true;
          setLoading(false);
          setRefreshing(false);
        }
      }
    }
    void load();
    return () => { active = false; };
  }, [
    filters.branchId,
    filters.instagram,
    filters.search,
    filters.site,
    filters.state,
    normalizedRequest.page,
    normalizedRequest.pageSize,
    refreshKey,
  ]);

  const executeRoutingCommand = useCallback(async (
    command: LeadRoutingCommand,
    ids: string[],
  ): Promise<LeadRoutingResult> => {
    setSaving(true);
    try {
      const result = await leadCycleService.executeRoutingCommand(command, ids);
      const moved = new Set([...result.succeededIds, ...result.unchangedIds]);
      if (moved.size) {
        setRecords((current) => current.filter((record) => !moved.has(record.id)));
        setTotal((current) => Math.max(0, current - moved.size));
        refresh();
      }
      return result;
    } finally {
      setSaving(false);
    }
  }, [refresh]);

  const updateDetails = useCallback(async (lead: LeadCycleLead, input: LeadCycleDetailsInput) => {
    setSaving(true);
    try {
      const updated = await leadCycleService.updateDetails(lead, input);
      setRecords((current) => current.map((record) => record.id === updated.id ? updated : record));
      refresh();
      return updated;
    } finally {
      setSaving(false);
    }
  }, [refresh]);

  const patchChannelLocally = useCallback((ids: string[], channel: LeadCycleLead['channel']) => {
    const patch = new Set(ids.filter(Boolean));
    if (!patch.size) return;
    setRecords((current) => current.map((record) => patch.has(record.id) ? { ...record, channel } : record));
  }, []);

  const removeLocally = useCallback((ids: string[]) => {
    const remove = new Set(ids.filter(Boolean));
    if (!remove.size) return;
    setRecords((current) => current.filter((record) => !remove.has(record.id)));
    setTotal((current) => Math.max(0, current - remove.size));
  }, []);

  return {
    records,
    total,
    summary,
    loading,
    refreshing,
    saving,
    error,
    refresh,
    removeLocally,
    patchChannelLocally,
    executeRoutingCommand,
    updateDetails,
  };
}
