import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { eventBus } from '../lib/events';

export type AppNotification = {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  message: string;
};

type NotificationContextValue = {
  notifications: AppNotification[];
  push: (notification: Omit<AppNotification, 'id'>) => void;
  dismiss: (id: string) => void;
};

const NotificationContext = createContext<NotificationContextValue | null>(null);

function createNotificationId() {
  return `notification-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  const dismiss = useCallback((id: string) => {
    setNotifications((current) => current.filter((notification) => notification.id !== id));
  }, []);

  const push = useCallback((notification: Omit<AppNotification, 'id'>) => {
    const nextNotification = { ...notification, id: createNotificationId() };
    setNotifications((current) => [nextNotification, ...current].slice(0, 4));
    window.setTimeout(() => dismiss(nextNotification.id), 3500);
  }, [dismiss]);

  useEffect(() => eventBus.on('toast:push', push), [push]);

  const value = useMemo(() => ({ notifications, push, dismiss }), [dismiss, notifications, push]);
  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

export function useNotificationContext() {
  const context = useContext(NotificationContext);
  if (!context) throw new Error('useNotificationContext deve ser usado dentro de NotificationProvider.');
  return context;
}
