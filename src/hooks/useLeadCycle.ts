import { useCallback, useEffect, useRef, useState } from 'react';
import { leadCycleService } from '../services/lead-cycle/leadCycle.service';
import type {
  LeadCycleDetailsInput,
  LeadCycleLead,
  LeadRoutingCommand,
  LeadRoutingResult,
} from '../services/lead-cycle/types';

export type LeadCycleView = 'imported';

export function useLeadCycle(_view: LeadCycleView = 'imported') {
  const [records, setRecords] = useState<LeadCycleLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadedRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!loadedRef.current) setLoading(true);
    setError(null);
    try {
      setRecords(await leadCycleService.listImported());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível carregar os leads.');
      if (!loadedRef.current) setRecords([]);
    } finally {
      loadedRef.current = true;
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const executeRoutingCommand = useCallback(async (
    command: LeadRoutingCommand,
    ids: string[],
  ): Promise<LeadRoutingResult> => {
    setSaving(true);
    try {
      const result = await leadCycleService.executeRoutingCommand(command, ids);
      const moved = new Set([...result.succeededIds, ...result.unchangedIds]);
      if (moved.size) setRecords((current) => current.filter((record) => !moved.has(record.id)));
      return result;
    } finally {
      setSaving(false);
    }
  }, []);

  const updateDetails = useCallback(async (lead: LeadCycleLead, input: LeadCycleDetailsInput) => {
    setSaving(true);
    try {
      const updated = await leadCycleService.updateDetails(lead, input);
      setRecords((current) => current.map((record) => record.id === updated.id ? updated : record));
      return updated;
    } finally {
      setSaving(false);
    }
  }, []);


  const patchChannelLocally = useCallback((ids: string[], channel: LeadCycleLead['channel']) => {
    const patch = new Set(ids.filter(Boolean));
    if (!patch.size) return;
    setRecords((current) => current.map((record) =>
      patch.has(record.id) ? { ...record, channel } : record
    ));
  }, []);

  const removeLocally = useCallback((ids: string[]) => {
    const remove = new Set(ids.filter(Boolean));
    if (!remove.size) return;
    setRecords((current) => current.filter((record) => !remove.has(record.id)));
  }, []);

  return { records, loading, saving, error, refresh, removeLocally, patchChannelLocally, executeRoutingCommand, updateDetails };
}
