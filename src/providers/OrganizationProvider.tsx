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
const ORGANIZATION_CACHE_KEY = 'crm:organization-context-cache:v1';
const INVITATION_CHECK_PREFIX = 'crm:organization-invitations-checked:v1:';

function readCachedOrganizationContext(usersId: string): OrganizationContext | null {
  if (!usersId || typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(ORGANIZATION_CACHE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as OrganizationContext;
    if (String(value?.actorUsersId ?? '') !== usersId) return null;
    return value;
  } catch {
    return null;
  }
}

function persistCachedOrganizationContext(value: OrganizationContext | null) {
  if (typeof window === 'undefined') return;
  try {
    if (value) window.sessionStorage.setItem(ORGANIZATION_CACHE_KEY, JSON.stringify(value));
    else window.sessionStorage.removeItem(ORGANIZATION_CACHE_KEY);
  } catch {
    // Cache é apenas uma otimização de boot; RLS e RPCs continuam autoritativos.
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
      const next = await withDeadline(getOrganizationContext(), 8_000, 'Tempo excedido ao carregar a organização.');
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

  const switchOrganization = useCallback(async (organizationId: string) => {
    if (!organizationId || organizationId === contextRef.current?.organization?.id) return;
    setLoading(true);
    setError(null);
    const previousOrganizationId = getActiveOrganizationSessionId();
    try {
      setActiveOrganizationSessionId(organizationId);
      await switchActiveOrganization(organizationId);
      const next = await withDeadline(getOrganizationContext(), 8_000, 'Tempo excedido ao trocar organização.');
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
