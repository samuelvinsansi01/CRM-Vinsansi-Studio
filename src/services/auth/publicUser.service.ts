import type { User } from '@supabase/supabase-js';
import { getSupabaseClient } from '../../lib/supabase';

export type PublicUserRow = {
  users_id: number | string;
  auth_user_id: string;
  status_id: number | string;
};

const PUBLIC_USER_COLUMNS = 'users_id, auth_user_id, status_id';

async function findPublicUser(authUserId: string): Promise<PublicUserRow | null> {
  const { data: rawData, error } = await getSupabaseClient()
    .from('users')
    .select(PUBLIC_USER_COLUMNS)
    .eq('auth_user_id', authUserId)
    .maybeSingle();

  if (error) {
    throw new Error(`Falha ao carregar o usuário interno: ${error.message}`);
  }

  return rawData ? rawData as PublicUserRow : null;
}

/**
 * Garante que todo usuário autenticado possua um registro correspondente em
 * public.users. A criação é feita no banco por uma função SECURITY DEFINER,
 * evitando expor status_id ou permissões administrativas ao frontend.
 */
export async function ensurePublicUser(authUser: User): Promise<PublicUserRow> {
  const existingUser = await findPublicUser(authUser.id);
  if (existingUser) return existingUser;

  const { error: provisionError } = await getSupabaseClient().rpc('ensure_current_user');

  if (provisionError) {
    throw new Error(
      `Não foi possível criar o cadastro em public.users: ${provisionError.message}. ` +
      'Execute a migration de provisionamento no Supabase.',
    );
  }

  const provisionedUser = await findPublicUser(authUser.id);
  if (!provisionedUser) {
    throw new Error('O cadastro do usuário foi solicitado, mas public.users não retornou o registro criado.');
  }

  return provisionedUser;
}

export async function getCurrentPublicUser(): Promise<PublicUserRow> {
  const { data, error } = await getSupabaseClient().auth.getUser();

  if (error || !data.user) {
    throw new Error(error?.message ?? 'Usuário não autenticado.');
  }

  return ensurePublicUser(data.user);
}
