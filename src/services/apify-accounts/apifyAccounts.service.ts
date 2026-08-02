import { getSupabaseClient } from '../../lib/supabase';
import { currentUserIdNumber } from '../../repositories/schemaCatalog';
import type { ApifyAccount, CheckApifyAccountResult, SaveApifyAccountInput } from './types';

type AccountRow = {
  apify_accounts_id: number;
  account_name: string;
  is_active: boolean;
  connection_status: string | null;
  external_username: string | null;
  last_checked_at: string | null;
  last_used_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

function mapAccount(row: AccountRow): ApifyAccount {
  const connectionStatus = row.connection_status === 'connected' || row.connection_status === 'error'
    ? row.connection_status
    : 'not_verified';
  return {
    id: Number(row.apify_accounts_id),
    name: row.account_name,
    active: Boolean(row.is_active),
    // token_secret e deliberadamente excluido do SELECT e nunca volta ao navegador.
    tokenMask: '••••••••',
    connectionStatus,
    externalUsername: row.external_username ?? '',
    lastCheckedAt: row.last_checked_at,
    lastUsedAt: row.last_used_at,
    lastError: row.last_error ?? '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function invokeAccountCheck(accountId: number): Promise<CheckApifyAccountResult> {
  const { data, error } = await getSupabaseClient().functions.invoke('apify-account-check', {
    body: { apifyAccountId: accountId },
  });
  if (error) throw new Error(error.message);
  if (!data || typeof data !== 'object') throw new Error('Resposta inválida ao verificar a conta Apify.');
  if ('error' in data && data.error) throw new Error(String(data.error));
  const result = data as Partial<CheckApifyAccountResult>;
  if (!result.accountId || result.connected !== true || !result.checkedAt) {
    throw new Error('A verificação da conta Apify retornou dados incompletos.');
  }
  return {
    accountId: Number(result.accountId),
    connected: true,
    username: String(result.username ?? ''),
    plan: String(result.plan ?? ''),
    checkedAt: String(result.checkedAt),
  };
}

const ACCOUNT_SELECT = 'apify_accounts_id,account_name,is_active,connection_status,external_username,last_checked_at,last_used_at,last_error,created_at,updated_at';

export const apifyAccountsService = {
  async list(): Promise<ApifyAccount[]> {
    const userId = await currentUserIdNumber();
    const { data, error } = await getSupabaseClient()
      .from('apify_accounts')
      .select(ACCOUNT_SELECT)
      .eq('users_id', userId)
      .order('account_name');
    if (error) throw new Error(`Não foi possível carregar as contas Apify: ${error.message}`);
    return ((data ?? []) as AccountRow[]).map(mapAccount);
  },

  async save(input: SaveApifyAccountInput): Promise<number> {
    const name = input.name.trim();
    const token = input.token?.trim() ?? '';
    if (!name) throw new Error('Informe o nome da conta Apify.');
    if (!input.id && !token) throw new Error('Informe o token da nova conta Apify.');

    const { data, error } = await getSupabaseClient().rpc('save_apify_account', {
      p_apify_accounts_id: input.id ?? null,
      p_account_name: name,
      p_token: token || null,
      p_is_active: input.active,
    });
    if (error) throw new Error(error.message);
    const id = Number(data);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('A conta Apify não retornou um identificador válido.');
    return id;
  },

  async check(id: number): Promise<CheckApifyAccountResult> {
    if (!Number.isInteger(id) || id <= 0) throw new Error('Conta Apify inválida.');
    return invokeAccountCheck(id);
  },

  async remove(id: number): Promise<void> {
    if (!Number.isInteger(id) || id <= 0) throw new Error('Conta Apify inválida.');
    const { error } = await getSupabaseClient().rpc('delete_apify_account', { p_apify_accounts_id: id });
    if (error) throw new Error(error.message);
  },
};
