import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabase';
import { ensurePublicUser } from '../services/auth/publicUser.service';

type AuthUser = {
  /** UUID do Supabase Auth. */
  id: string;
  /** ID interno bigint da tabela public.users. */
  usersId: string;
  name: string;
  email: string;
  role: string;
  statusId: string;
};

type AuthContextValue = {
  user: AuthUser | null;
  isAuthenticated: boolean;
  loading: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function loadAuthUser(authUser: User | null): Promise<AuthUser | null> {
  if (!authUser) return null;

  const data = await ensurePublicUser(authUser);

  const metadata = authUser.user_metadata ?? {};
  const name = String(
    metadata.name ?? metadata.full_name ?? authUser.email?.split('@')[0] ?? 'Operador',
  );

  return {
    id: authUser.id,
    usersId: String(data.users_id),
    name,
    email: authUser.email ?? '',
    role: String(metadata.role ?? 'operador'),
    statusId: String(data.status_id),
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setLoading(false);
      setError('Supabase não configurado.');
      return;
    }

    const client = getSupabaseClient();
    let active = true;

    const syncUser = async (authUser: User | null) => {
      try {
        const resolvedUser = await loadAuthUser(authUser);
        if (!active) return;
        setUser(resolvedUser);
        setError(null);
      } catch (syncError) {
        if (!active) return;
        setUser(null);
        setError(syncError instanceof Error ? syncError.message : 'Falha ao carregar usuário.');
      } finally {
        if (active) setLoading(false);
      }
    };

    client.auth.getSession().then((result: { data: { session: { user: User } | null }; error: { message: string } | null }) => {
      const { data, error: sessionError } = result;
      if (!active) return;
      if (sessionError) {
        setError(sessionError.message);
        setLoading(false);
        return;
      }
      void syncUser(data.session?.user ?? null);
    });

    const { data } = client.auth.onAuthStateChange((_event: string, session: { user: User } | null) => {
      setLoading(true);
      void syncUser(session?.user ?? null);
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    isAuthenticated: Boolean(user),
    loading,
    error,
    signIn: async (email: string, password: string) => {
      setError(null);
      setLoading(true);
      const { data, error: signInError } = await getSupabaseClient().auth.signInWithPassword({ email, password });
      if (signInError) {
        setLoading(false);
        setError(signInError.message);
        throw new Error(signInError.message);
      }

      try {
        setUser(await loadAuthUser(data.user));
      } catch (profileError) {
        const message = profileError instanceof Error ? profileError.message : 'Falha ao carregar usuário.';
        setUser(null);
        setError(message);
        throw new Error(message);
      } finally {
        setLoading(false);
      }
    },
    signInWithGoogle: async () => {
      setError(null);
      const { error: signInError } = await getSupabaseClient().auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin },
      });
      if (signInError) {
        setError(signInError.message);
        throw new Error(signInError.message);
      }
    },
    signOut: async () => {
      setError(null);
      const { error: signOutError } = await getSupabaseClient().auth.signOut();
      if (signOutError) {
        setError(signOutError.message);
        throw new Error(signOutError.message);
      }
      setUser(null);
    },
  }), [error, loading, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthContext() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuthContext deve ser usado dentro de AuthProvider.');
  return context;
}
