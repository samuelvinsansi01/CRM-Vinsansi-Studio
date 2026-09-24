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
import { useAuthContext } from './AuthProvider';
import { getSupabaseClient } from '../lib/supabase';
import {
  acceptPendingOrganizationInvitations,
  getOrganizationContext,
  switchActiveOrganization,
  type OrganizationContext,
} from '../services/organization/organization.service';
import { getActiveOrganizationSessionId, setActiveOrganizationSessionId } from '../services/organization/organizationSession';

type OrganizationContextValue = {
  context: OrganizationContext | null;
  loading: boolean;
  error: string | null;
  organizationId: string | null;
  organizationName: string;
  memberId: string | null;
  accessLevel: string;
  isPlatformOwner: boolean;
  organizations: OrganizationContext['organizations'];
  permissions: ReadonlySet<string>;
  hasPermission: (permission: string) => boolean;
  switchOrganization: (organizationId: string) => Promise<void>;
  refreshOrganization: () => Promise<void>;
};

const Context = createContext<OrganizationContextValue | null>(null);
const ORGANIZATION_CACHE_KEY = 'crm:organization-context-cache:v2';
const ORGANIZATION_PERSISTENT_CACHE_PREFIX = 'crm:organization-context-last-good:v1:';
const INVITATION_CHECK_PREFIX = 'crm:organization-invitations-checked:v1:';

function validCachedContext(value: OrganizationContext | null, usersId: string) {
  return Boolean(value && String(value.actorUsersId ?? '') === usersId && Array.isArray(value.permissions) && Array.isArray(value.organizations));
}

function readCachedOrganizationContext(usersId: string): OrganizationContext | null {
  if (!usersId || typeof window === 'undefined') return null;
  try {
    const sessionRaw = window.sessionStorage.getItem(ORGANIZATION_CACHE_KEY);
    if (sessionRaw) {
      const sessionValue = JSON.parse(sessionRaw) as OrganizationContext;
      if (validCachedContext(sessionValue, usersId)) return sessionValue;
    }
    const persistentRaw = window.localStorage.getItem(`${ORGANIZATION_PERSISTENT_CACHE_PREFIX}${usersId}`);
    if (!persistentRaw) return null;
    const record = JSON.parse(persistentRaw) as { savedAt?: string; value?: OrganizationContext };
    const savedAt = Date.parse(String(record.savedAt || ''));
    if (!Number.isFinite(savedAt) || Date.now() - savedAt > 7 * 24 * 60 * 60 * 1000) return null;
    return validCachedContext(record.value ?? null, usersId) ? record.value! : null;
  } catch {
    return null;
  }
}

function persistCachedOrganizationContext(value: OrganizationContext | null) {
  if (typeof window === 'undefined') return;
  try {
    if (value) {
      window.sessionStorage.setItem(ORGANIZATION_CACHE_KEY, JSON.stringify(value));
      window.localStorage.setItem(`${ORGANIZATION_PERSISTENT_CACHE_PREFIX}${value.actorUsersId}`, JSON.stringify({ savedAt: new Date().toISOString(), value }));
    } else window.sessionStorage.removeItem(ORGANIZATION_CACHE_KEY);
  } catch {
    // Cache contém apenas contexto de UI. RLS/RPCs continuam autoritativos.
  }
}

async function withDeadline<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: number | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = window.setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) window.clearTimeout(timer);
  }
}

async function loadOrganizationContextResilient(): Promise<OrganizationContext> {
  const client = getSupabaseClient();
  const { data: sessionData, error: sessionError } = await withDeadline(
    client.auth.getSession(),
    5_000,
    'Tempo excedido ao validar a sessão antes de carregar a organização.',
  );
  if (sessionError) throw new Error(`Não foi possível validar a sessão: ${sessionError.message}`);
  if (!sessionData.session) throw new Error('Sessão expirada. Entre novamente para carregar a organização.');

  // Uma única leitura autoritativa evita duplicar carga justamente quando o banco
  // já está lento. O cache mantém o painel montado durante refreshes transitórios.
  return withDeadline(
    getOrganizationContext(),
    20_000,
    'Tempo excedido ao carregar a organização. O banco pode estar ocupado; tente novamente.',
  );
}

export function OrganizationProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, user, passwordRecovery } = useAuthContext();
  const [context, setContextState] = useState<OrganizationContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);
  const contextRef = useRef<OrganizationContext | null>(null);

  const setContext = useCallback((next: OrganizationContext | null) => {
    contextRef.current = next;
    setContextState(next);
    persistCachedOrganizationContext(next);
  }, []);

  const syncOrganization = useCallback(async (background = false) => {
    if (!isAuthenticated || !user || passwordRecovery) {
      setContext(null);
      setError(null);
      setLoading(false);
      return;
    }

    const current = ++sequence.current;
    const preserveCurrent = Boolean(contextRef.current);
    if (!background && !preserveCurrent) setLoading(true);

    try {
      // get_organization_context é a leitura autoritativa. Convites não fazem mais
      // parte do caminho bloqueante de todo refresh do navegador.
      const next = await loadOrganizationContextResilient();
      if (sequence.current !== current) return;
      if (next.organization?.id && getActiveOrganizationSessionId() !== next.organization.id) {
        setActiveOrganizationSessionId(next.organization.id);
      }
      setContext(next);
      setError(null);
    } catch (cause) {
      if (sequence.current !== current) return;
      const message = cause instanceof Error ? cause.message : 'Falha ao carregar organização.';
      // Uma falha transitória de background não desmonta um painel já válido.
      if (!contextRef.current) setError(message);
      else console.warn('[organization-background-refresh]', message);
    } finally {
      if (sequence.current === current && !background) setLoading(false);
    }
  }, [isAuthenticated, passwordRecovery, setContext, user]);

  const refreshOrganization = useCallback(async () => {
    await syncOrganization(false);
  }, [syncOrganization]);

  useEffect(() => {
    if (!isAuthenticated || !user || passwordRecovery) {
      sequence.current += 1;
      setContext(null);
      setError(null);
      setLoading(false);
      return undefined;
    }

    const cached = readCachedOrganizationContext(user.usersId);
    if (cached) {
      setContext(cached);
      setError(null);
      setLoading(false);
      void syncOrganization(true);
    } else {
      void syncOrganization(false);
    }

    // Convites são verificados no máximo uma vez por sessão autenticada. Antes,
    // essa RPC de escrita rodava em TODO refresh e ainda expirava convites globais.
    const inviteKey = `${INVITATION_CHECK_PREFIX}${user.id}`;
    let inviteTimer: number | null = null;
    if (typeof window !== 'undefined' && !window.sessionStorage.getItem(inviteKey)) {
      window.sessionStorage.setItem(inviteKey, '1');
      // Convites são tarefa secundária: não competem com o primeiro paint do painel.
      inviteTimer = window.setTimeout(() => {
        void acceptPendingOrganizationInvitations()
          .then((accepted) => {
            if (accepted > 0) return syncOrganization(true);
            return undefined;
          })
          .catch((cause) => console.warn('[organization-invitations]', cause instanceof Error ? cause.message : String(cause)));
      }, 3_000);
    }

    return () => {
      sequence.current += 1;
      if (inviteTimer !== null) window.clearTimeout(inviteTimer);
    };
  }, [isAuthenticated, passwordRecovery, setContext, syncOrganization, user]);

  useEffect(() => {
    if (!isAuthenticated || passwordRecovery || context || !error) return undefined;
    const timer = window.setInterval(() => void syncOrganization(true), 15_000);
    return () => window.clearInterval(timer);
  }, [context, error, isAuthenticated, passwordRecovery, syncOrganization]);

  const switchOrganization = useCallback(async (organizationId: string) => {
    if (!organizationId || organizationId === contextRef.current?.organization?.id) return;
    setLoading(true);
    setError(null);
    const previousOrganizationId = getActiveOrganizationSessionId();
    try {
      setActiveOrganizationSessionId(organizationId);
      await switchActiveOrganization(organizationId);
      const next = await loadOrganizationContextResilient();
      setContext(next);
      window.sessionStorage.removeItem('painel:active-page');
      window.location.assign(window.location.pathname);
    } catch (cause) {
      setActiveOrganizationSessionId(previousOrganizationId || null);
      setError(cause instanceof Error ? cause.message : 'Falha ao trocar organização.');
      setLoading(false);
      throw cause;
    }
  }, [setContext]);

  const permissionSet = useMemo(() => new Set(context?.permissions ?? []), [context?.permissions]);
  const hasPermission = useCallback((permission: string) => (
    Boolean(context?.isPlatformOwner) || permissionSet.has(permission)
  ), [context?.isPlatformOwner, permissionSet]);

  const value = useMemo<OrganizationContextValue>(() => ({
    context,
    loading,
    error,
    organizationId: context?.organization?.id ?? null,
    organizationName: context?.organization?.name ?? '',
    memberId: context?.member?.id ?? null,
    accessLevel: context?.isPlatformOwner && !context?.member ? 'platform_owner' : context?.member?.accessLevel ?? 'none',
    isPlatformOwner: Boolean(context?.isPlatformOwner),
    organizations: context?.organizations ?? [],
    permissions: permissionSet,
    hasPermission,
    switchOrganization,
    refreshOrganization,
  }), [context, error, hasPermission, loading, permissionSet, refreshOrganization, switchOrganization]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useOrganizationContext() {
  const value = useContext(Context);
  if (!value) throw new Error('useOrganizationContext deve ser usado dentro de OrganizationProvider.');
  return value;
}
