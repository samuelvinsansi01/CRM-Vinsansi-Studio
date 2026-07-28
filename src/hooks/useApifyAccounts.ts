import { useCallback, useEffect, useState } from 'react';
import { apifyAccountsService, type ApifyAccount, type CheckApifyAccountResult, type SaveApifyAccountInput } from '../services/apify-accounts';

export function useApifyAccounts() {
  const [accounts, setAccounts] = useState<ApifyAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [checkingId, setCheckingId] = useState<number | null>(null);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setAccounts(await apifyAccountsService.list());
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Não foi possível carregar as contas Apify.';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh().catch(() => undefined); }, [refresh]);

  const save = async (input: SaveApifyAccountInput) => {
    setSaving(true);
    setError('');
    try {
      const id = await apifyAccountsService.save(input);
      await refresh();
      return id;
    } finally {
      setSaving(false);
    }
  };

  const check = async (id: number): Promise<CheckApifyAccountResult> => {
    setCheckingId(id);
    setError('');
    try {
      const result = await apifyAccountsService.check(id);
      await refresh();
      return result;
    } finally {
      setCheckingId(null);
    }
  };

  const remove = async (id: number) => {
    setSaving(true);
    setError('');
    try {
      await apifyAccountsService.remove(id);
      await refresh();
    } finally {
      setSaving(false);
    }
  };

  return {
    accounts,
    activeAccounts: accounts.filter((account) => account.active && account.connectionStatus !== 'error'),
    loading,
    saving,
    checkingId,
    error,
    refresh,
    save,
    check,
    remove,
  };
}
