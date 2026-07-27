import { useCallback, useEffect, useState } from 'react';
import { apifyAccountsService, type ApifyAccount, type SaveApifyAccountInput } from '../services/apify-accounts';

export function useApifyAccounts() {
  const [accounts, setAccounts] = useState<ApifyAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setAccounts(await apifyAccountsService.list());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível carregar as contas Apify.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const save = async (input: SaveApifyAccountInput) => {
    setSaving(true);
    setError('');
    try {
      await apifyAccountsService.save(input);
      await refresh();
    } finally {
      setSaving(false);
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

  return { accounts, activeAccounts: accounts.filter((account) => account.active), loading, saving, error, refresh, save, remove };
}
