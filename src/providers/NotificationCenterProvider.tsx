import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { listCrmNotifications, markAllCrmNotificationsRead, markCrmNotificationRead, type CrmNotification } from '../repositories/notifications';
import { useAuthContext } from './AuthProvider';
import { useOrganizationContext } from './OrganizationProvider';

type NotificationCenterContextValue = {
  items: CrmNotification[];
  unread: boolean;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  markRead: (notificationId: string) => Promise<void>;
  markAllRead: () => Promise<void>;
};

const Context = createContext<NotificationCenterContextValue | null>(null);

export function NotificationCenterProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuthContext();
  const { organizationId, memberId } = useOrganizationContext();
  const [items, setItems] = useState<CrmNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  const inFlight = useRef(false);
  const readOverrides = useRef(new Map<string, string>());

  const refresh = useCallback(async () => {
    if (!isAuthenticated || !organizationId || !memberId) {
      setItems([]);
      setError(null);
      return;
    }
    if (inFlight.current) return;
    inFlight.current = true;
    const current = ++request.current;
    setLoading(true);
    try {
      const next = await listCrmNotifications();
      if (request.current !== current) return;
      const merged = next.map((item) => {
        if (item.readAt) {
          readOverrides.current.delete(item.id);
          return item;
        }
        const localReadAt = readOverrides.current.get(item.id);
        return localReadAt ? { ...item, readAt: localReadAt } : item;
      });
      setItems(merged);
      setError(null);
    } catch (cause) {
      if (request.current !== current) return;
      setError(cause instanceof Error ? cause.message : 'Falha ao carregar notificações.');
    } finally {
      if (request.current === current) setLoading(false);
      inFlight.current = false;
    }
  }, [isAuthenticated, memberId, organizationId]);

  useEffect(() => {
    void refresh();
    if (!isAuthenticated || !organizationId || !memberId) return undefined;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 5_000);
    const onVisibility = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      request.current += 1;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [isAuthenticated, memberId, organizationId, refresh]);

  const markRead = useCallback(async (notificationId: string) => {
    const now = new Date().toISOString();
    readOverrides.current.set(notificationId, now);
    setItems((current) => current.map((item) => item.id === notificationId && !item.readAt ? { ...item, readAt: now } : item));
    try {
      await markCrmNotificationRead(notificationId);
    } catch (cause) {
      readOverrides.current.delete(notificationId);
      await refresh();
      throw cause;
    }
  }, [refresh]);

  const markAllRead = useCallback(async () => {
    const now = new Date().toISOString();
    const unreadIds = items.filter((item) => !item.readAt).map((item) => item.id);
    if (!unreadIds.length) return;
    unreadIds.forEach((id) => readOverrides.current.set(id, now));
    setItems((current) => current.map((item) => item.readAt ? item : { ...item, readAt: now }));
    try {
      await markAllCrmNotificationsRead();
    } catch (cause) {
      unreadIds.forEach((id) => readOverrides.current.delete(id));
      await refresh();
      throw cause;
    }
  }, [items, refresh]);

  const value = useMemo<NotificationCenterContextValue>(() => ({
    items,
    unread: items.some((item) => !item.readAt),
    loading,
    error,
    refresh,
    markRead,
    markAllRead,
  }), [error, items, loading, markAllRead, markRead, refresh]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useNotificationCenter() {
  const value = useContext(Context);
  if (!value) throw new Error('useNotificationCenter deve ser usado dentro de NotificationCenterProvider.');
  return value;
}
