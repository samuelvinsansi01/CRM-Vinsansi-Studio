import { useCallback, useEffect, useState } from 'react';
import { leadCycleService } from '../services/lead-cycle/leadCycle.service';
import type { LeadCycleLead, LeadCycleUpdate } from '../services/lead-cycle/types';
import type { LeadStatusId } from '../types/lead.types';

export type LeadCycleView = 'imported' | 'valid' | 'pre-send' | 'permanent';

const loaders = {
  imported: leadCycleService.listImported,
  valid: leadCycleService.listValid,
  'pre-send': leadCycleService.listPreSend,
  permanent: leadCycleService.listPermanent,
};

export function useLeadCycle(view: LeadCycleView) {
  const [records, setRecords] = useState<LeadCycleLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRecords(await loaders[view]());
    } catch (err) {
      setRecords([]);
      setError(err instanceof Error ? err.message : 'Não foi possível carregar os leads.');
    } finally {
      setLoading(false);
    }
  }, [view]);

  useEffect(() => { void refresh(); }, [refresh]);

  const update = useCallback(async (ids: string[], input: LeadCycleUpdate, expectedStatuses?: LeadStatusId[]) => {
    setSaving(true);
    try {
      await leadCycleService.update(ids, input, expectedStatuses);
      await refresh();
    } finally {
      setSaving(false);
    }
  }, [refresh]);

  return { records, loading, saving, error, refresh, update };
}
