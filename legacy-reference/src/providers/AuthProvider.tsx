import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabase';

type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: string;
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

function toAuthUser(user: User | null): AuthUser | null {
  if (!user) return null;

  const metadata = user.user_metadata ?? {};
  const name = String(metadata.name ?? metadata.full_name ?? user.email?.split('@')[0] ?? 'Operador');

  return {
    id: user.id,
    name,
    email: user.email ?? '',
    role: String(metadata.role ?? 'operador'),
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setLoading(false);
      setError('Supabase nao configurado.');
      return;
    }

    const client = getSupabaseClient();
    let active = true;

    client.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active) return;
      if (sessionError) setError(sessionError.message);
      setUser(toAuthUser(data.session?.user ?? null));
      setLoading(false);
    });

    const { data } = client.auth.onAuthStateChange((_event, session) => {
      setUser(toAuthUser(session?.user ?? null));
      setLoading(false);
      setError(null);
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
      const { data, error: signInError } = await getSupabaseClient().auth.signInWithPassword({ email, password });
      if (signInError) {
        setError(signInError.message);
        throw new Error(signInError.message);
      }
      setUser(toAuthUser(data.user));
    },
    signInWithGoogle: async () => {
      setError(null);
      const { error: signInError } = await getSupabaseClient().auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin,
        },
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
