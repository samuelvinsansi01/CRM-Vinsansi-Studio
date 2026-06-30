import { useState } from 'react';
import { DashboardLayout } from './design-system/layouts/DashboardLayout';
import { BasePage } from './pages/BasePage';
import { ConfigTablePage } from './pages/ConfigTablePage';
import { HomePage } from './pages/HomePage';
import { ImportPage } from './pages/ImportPage';
import { ImportSettingsPage } from './pages/ImportSettingsPage';
import { LoginPage } from './pages/LoginPage';
import { PreSendPage } from './pages/PreSendPage';
import { QueuePage } from './pages/QueuePage';
import { SettingsPage } from './pages/SettingsPage';
import type { PageId } from './pages/pageRegistry';
import { useAuthContext } from './providers/AuthProvider';

export function App() {
  const { isAuthenticated, loading } = useAuthContext();
  const [activePage, setActivePage] = useState<PageId>('home');

  if (loading) {
    return (
      <div className="login-page">
        <div className="login-panel login-panel--loading">Carregando sessao...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return (
    <DashboardLayout activePage={activePage} onNavigate={setActivePage}>
      {activePage === 'home' ? <HomePage /> : null}
      {activePage === 'import-approved' || activePage === 'import-rejected' ? (
        <ImportPage rejected={activePage === 'import-rejected'} onStatusChange={(isRejected) => setActivePage(isRejected ? 'import-rejected' : 'import-approved')} />
      ) : null}
      {activePage === 'base' ? <BasePage /> : null}
      {activePage === 'pre-send' ? <PreSendPage /> : null}
      {activePage === 'whatsapp' ? <QueuePage channel="whatsapp" /> : null}
      {activePage === 'instagram' ? <QueuePage channel="instagram" /> : null}
      {activePage === 'chips' ? <ConfigTablePage kind="chips" /> : null}
      {activePage === 'instagram-settings' ? <ConfigTablePage kind="instagram" /> : null}
      {activePage === 'branches' ? <ConfigTablePage kind="branches" /> : null}
      {activePage === 'templates' ? <ConfigTablePage kind="templates" /> : null}
      {activePage === 'import-settings' ? <ImportSettingsPage /> : null}
      {activePage === 'settings' ? <SettingsPage /> : null}
    </DashboardLayout>
  );
}
