import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import { isSupabaseConfigured, supabase } from '../../integrations/supabase/client';
import type { AppUser } from '../../integrations/supabase/database.types';

type AuthState = {
  session: Session | null;
  appUser: AppUser | null;
  loading: boolean;
  configured: boolean;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

async function loadAppUser(authUserId: string): Promise<AppUser | null> {
  const { data, error } = await supabase
    .from('users')
    .select('users_id, auth_user_id, status_id')
    .eq('auth_user_id', authUserId)
    .maybeSingle();

  if (error) throw error;
  return data as AppUser | null;
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }

    void supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      setAppUser(data.session?.user.id ? await loadAppUser(data.session.user.id) : null);
      setLoading(false);
    }).catch(() => setLoading(false));

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      void (async () => {
        setAppUser(nextSession?.user.id ? await loadAppUser(nextSession.user.id) : null);
        setLoading(false);
      })();
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  const value = useMemo<AuthState>(() => ({
    session,
    appUser,
    loading,
    configured: isSupabaseConfigured,
    async signIn(email, password) {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    },
    async signOut() {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    },
  }), [session, appUser, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth deve ser usado dentro de AuthProvider');
  return context;
}
