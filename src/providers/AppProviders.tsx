import type { ReactNode } from 'react';
import { AuthProvider } from './AuthProvider';
import { ConfigProvider } from './ConfigProvider';
import { NotificationProvider } from './NotificationProvider';
import { NotificationCenterProvider } from './NotificationCenterProvider';
import { OrganizationProvider } from './OrganizationProvider';
import { UIProvider } from './UIProvider';

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <OrganizationProvider>
        <NotificationCenterProvider>
          <ConfigProvider>
            <UIProvider>
              <NotificationProvider>{children}</NotificationProvider>
            </UIProvider>
          </ConfigProvider>
        </NotificationCenterProvider>
      </OrganizationProvider>
    </AuthProvider>
  );
}
