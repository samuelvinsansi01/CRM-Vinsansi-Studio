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

export function OrganizationProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, user } = useAuthContext();
  const [context, setContext] = useState<OrganizationContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);

  const refreshOrganization = useCallback(async () => {
    if (!isAuthenticated || !user) {
      setContext(null);
      setError(null);
      return;
    }
    const current = ++sequence.current;
    setLoading(true);
    try {
      await acceptPendingOrganizationInvitations();
      const next = await getOrganizationContext();
      if (sequence.current !== current) return;
      if (next.organization?.id && getActiveOrganizationSessionId() !== next.organization.id) {
        setActiveOrganizationSessionId(next.organization.id);
      }
      setContext(next);
      setError(null);
    } catch (cause) {
      if (sequence.current !== current) return;
      setError(cause instanceof Error ? cause.message : 'Falha ao carregar organização.');
    } finally {
      if (sequence.current === current) setLoading(false);
    }
  }, [isAuthenticated, user]);

  useEffect(() => {
    void refreshOrganization();
    return () => { sequence.current += 1; };
  }, [refreshOrganization]);

  const switchOrganization = useCallback(async (organizationId: string) => {
    if (!organizationId || organizationId === context?.organization?.id) return;
    setLoading(true);
    setError(null);
    const previousOrganizationId = getActiveOrganizationSessionId();
    try {
      // O header deve mudar antes do RPC para que todas as consultas seguintes
      // já nasçam no novo tenant desta sessão específica.
      setActiveOrganizationSessionId(organizationId);
      await switchActiveOrganization(organizationId);
      const next = await getOrganizationContext();
      setContext(next);
      // O contexto de tenant mudou. Recarregar evita qualquer estado React de uma
      // organização anterior permanecer montado em páginas operacionais.
      window.sessionStorage.removeItem('painel:active-page');
      window.location.assign(window.location.pathname);
    } catch (cause) {
      setActiveOrganizationSessionId(previousOrganizationId || null);
      setError(cause instanceof Error ? cause.message : 'Falha ao trocar organização.');
      setLoading(false);
      throw cause;
    }
  }, [context?.organization?.id]);

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
