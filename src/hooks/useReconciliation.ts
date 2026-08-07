import { useCallback, useEffect, useRef, useState } from 'react';
import { reconciliationService } from '../services/reconciliation/reconciliation.service';
import type {
  ReconciliationBulkResult,
  ReconciliationIssue,
  ReconciliationRepairResult,
  ReconciliationScan,
} from '../services/reconciliation/types';

const emptyScan: ReconciliationScan = {
  issues: [],
  summary: { total: 0, critical: 0, warnings: 0, repairable: 0, manualReview: 0, safeBulk: 0 },
  scannedAt: '',
  staleAfterMinutes: 45,
};

export function useReconciliation() {
  const [scan, setScan] = useState<ReconciliationScan>(emptyScan);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [repairingId, setRepairingId] = useState('');
  const [repairingSafe, setRepairingSafe] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const loadedRef = useRef(false);

  const refresh = useCallback(() => setRefreshKey((current) => current + 1), []);

  useEffect(() => {
    let active = true;
    async function load() {
      if (loadedRef.current) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const next = await reconciliationService.scan();
        if (active) setScan(next);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Falha ao executar auditoria.');
      } finally {
        if (active) {
          loadedRef.current = true;
          setLoading(false);
          setRefreshing(false);
        }
      }
    }
    void load();
    return () => { active = false; };
  }, [refreshKey]);

  const repair = useCallback(async (issue: ReconciliationIssue): Promise<ReconciliationRepairResult> => {
    setRepairingId(issue.id);
    setError(null);
    try {
      const result = await reconciliationService.repair(issue);
      refresh();
      return result;
    } finally {
      setRepairingId('');
    }
  }, [refresh]);

  const repairSafe = useCallback(async (): Promise<ReconciliationBulkResult> => {
    setRepairingSafe(true);
    setError(null);
    try {
      const result = await reconciliationService.repairSafeIssues(scan.issues);
      refresh();
      return result;
    } finally {
      setRepairingSafe(false);
    }
  }, [refresh, scan.issues]);

  return {
    scan,
    loading,
    refreshing,
    repairingId,
    repairingSafe,
    error,
    refresh,
    repair,
    repairSafe,
  };
}
