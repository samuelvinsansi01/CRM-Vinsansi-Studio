import type { ReactNode } from 'react';
import { AuthProvider } from './AuthProvider';
import { ConfigProvider } from './ConfigProvider';
import { NotificationProvider } from './NotificationProvider';
import { OrganizationProvider } from './OrganizationProvider';
import { UIProvider } from './UIProvider';

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <OrganizationProvider>
        <ConfigProvider>
          <UIProvider>
            <NotificationProvider>{children}</NotificationProvider>
          </UIProvider>
        </ConfigProvider>
      </OrganizationProvider>
    </AuthProvider>
  );
}
