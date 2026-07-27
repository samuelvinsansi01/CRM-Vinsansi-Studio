import { getSupabaseClient } from '../../lib/supabase';
import type { ApifyAccount, SaveApifyAccountInput } from './types';

type AccountRpcRow = {
  apify_accounts_id: number;
  account_name: string;
  is_active: boolean;
  token_mask: string | null;
  connection_status: string | null;
  external_username: string | null;
  last_checked_at: string | null;
  last_used_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

function mapAccount(row: AccountRpcRow): ApifyAccount {
  const connectionStatus = row.connection_status === 'connected' || row.connection_status === 'error'
    ? row.connection_status
    : 'not_verified';

  return {
    id: Number(row.apify_accounts_id),
    name: row.account_name,
    active: Boolean(row.is_active),
    tokenMask: row.token_mask ?? '',
    connectionStatus,
    externalUsername: row.external_username ?? '',
    lastCheckedAt: row.last_checked_at,
    lastUsedAt: row.last_used_at,
    lastError: row.last_error ?? '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const apifyAccountsService = {
  async list(): Promise<ApifyAccount[]> {
    const { data, error } = await getSupabaseClient().rpc('list_apify_accounts');
    if (error) throw new Error(error.message);
    return ((data ?? []) as AccountRpcRow[]).map(mapAccount);
  },

  async save(input: SaveApifyAccountInput): Promise<void> {
    const { error } = await getSupabaseClient().rpc('save_apify_account', {
      p_apify_accounts_id: input.id ?? null,
      p_account_name: input.name.trim(),
      p_token: input.token?.trim() || null,
      p_is_active: input.active,
    });
    if (error) throw new Error(error.message);
  },

  async remove(id: number): Promise<void> {
    const { error } = await getSupabaseClient().rpc('delete_apify_account', {
      p_apify_accounts_id: id,
    });
    if (error) throw new Error(error.message);
  },
};
