import type { ReactNode } from 'react';
import { AuthProvider } from './AuthProvider';
import { ConfigProvider } from './ConfigProvider';
import { NotificationProvider } from './NotificationProvider';
import { UIProvider } from './UIProvider';

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <ConfigProvider>
        <UIProvider>
          <NotificationProvider>{children}</NotificationProvider>
        </UIProvider>
      </ConfigProvider>
    </AuthProvider>
  );
}
