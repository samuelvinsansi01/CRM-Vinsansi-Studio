import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { AuthChangeEvent, Session, User } from '@supabase/supabase-js';
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabase';
import { ensurePublicUser } from '../services/auth/publicUser.service';
import { createProfileAvatarUrl } from '../services/auth/userProfile.service';

export type AuthUser = {
  /** UUID do Supabase Auth. */
  id: string;
  /** ID interno bigint da tabela public.users. */
  usersId: string;
  name: string;
  email: string;
  role: string;
  statusId: string;
  avatarPath: string | null;
  avatarUrl: string | null;
};

type AuthContextValue = {
  user: AuthUser | null;
  isAuthenticated: boolean;
  /** Carregamento bloqueante, usado somente antes da primeira sessão ser resolvida ou em login explícito. */
  loading: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function loadAuthUser(authUser: User | null): Promise<AuthUser | null> {
  if (!authUser) return null;

  const data = await ensurePublicUser(authUser);
  const metadata = authUser.user_metadata ?? {};
  const fallbackName = String(
    metadata.name ?? metadata.full_name ?? authUser.email?.split('@')[0] ?? 'Operador',
  );
  const name = String(data.users_name ?? '').trim() || fallbackName;
  const avatarPath = data.users_avatar_path ? String(data.users_avatar_path) : null;
  const avatarUrl = await createProfileAvatarUrl(avatarPath);

  return {
    id: authUser.id,
    usersId: String(data.users_id),
    name,
    email: authUser.email ?? '',
    role: String(metadata.role ?? 'operador'),
    statusId: String(data.status_id),
    avatarPath,
    avatarUrl,
  };
}

type SyncOptions = {
  /** Mantém a árvore autenticada montada durante renovações de token e recuperação de foco. */
  background?: boolean;
  /** Evita derrubar uma sessão válida por falha transitória de rede durante sincronização em segundo plano. */
  preserveCurrentUserOnError?: boolean;
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const userRef = useRef<AuthUser | null>(null);
  const syncSequenceRef = useRef(0);

  const setUser = useCallback((nextUser: AuthUser | null) => {
    userRef.current = nextUser;
    setUserState(nextUser);
  }, []);

  const refreshProfile = useCallback(async () => {
    const { data, error: authError } = await getSupabaseClient().auth.getUser();
    if (authError || !data.user) {
      throw new Error(authError?.message ?? 'Usuário não autenticado.');
    }

    const refreshed = await loadAuthUser(data.user);
    setUser(refreshed);
    setError(null);
  }, [setUser]);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setLoading(false);
      setError('Supabase não configurado.');
      return;
    }

    const client = getSupabaseClient();
    let active = true;

    const syncUser = async (authUser: User | null, options: SyncOptions = {}) => {
      const sequence = ++syncSequenceRef.current;
      const background = options.background === true;
      const currentUser = userRef.current;

      if (!background) setLoading(true);

      try {
        const resolvedUser = await loadAuthUser(authUser);
        if (!active || sequence !== syncSequenceRef.current) return;
        setUser(resolvedUser);
        setError(null);
      } catch (syncError) {
        if (!active || sequence !== syncSequenceRef.current) return;

        const message = syncError instanceof Error
          ? syncError.message
          : 'Falha ao carregar usuário.';

        if (!(options.preserveCurrentUserOnError && currentUser)) {
          setUser(null);
        }
        setError(message);
      } finally {
        if (active && sequence === syncSequenceRef.current && !background) {
          setLoading(false);
        }
      }
    };

    void client.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active) return;
      if (sessionError) {
        setError(sessionError.message);
        setLoading(false);
        return;
      }
      void syncUser(data.session?.user ?? null);
    });

    const { data } = client.auth.onAuthStateChange((event: AuthChangeEvent, session: Session | null) => {
      const authUser = session?.user ?? null;
      const currentUser = userRef.current;

      if (event === 'SIGNED_OUT' || !authUser) {
        syncSequenceRef.current += 1;
        setUser(null);
        setError(null);
        setLoading(false);
        return;
      }

      // O Supabase pode emitir TOKEN_REFRESHED/SIGNED_IN quando a aba recupera foco.
      // Se o usuário é o mesmo, a sessão continua válida e a árvore React não deve ser desmontada.
      if (
        currentUser?.id === authUser.id
        && (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN' || event === 'INITIAL_SESSION')
      ) {
        return;
      }

      const background = Boolean(currentUser);
      void syncUser(authUser, {
        background,
        preserveCurrentUserOnError: background,
      });
    });

    return () => {
      active = false;
      syncSequenceRef.current += 1;
      data.subscription.unsubscribe();
    };
  }, [setUser]);

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
      setLoading(false);
    },
    refreshProfile,
  }), [error, loading, refreshProfile, setUser, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthContext() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuthContext deve ser usado dentro de AuthProvider.');
  return context;
}
