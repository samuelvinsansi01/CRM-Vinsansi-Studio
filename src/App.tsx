import { useEffect, useState } from 'react';
import { DashboardLayout } from './design-system/layouts/DashboardLayout';
import { AuditPage } from './pages/AuditPage';
import { BasePage } from './pages/BasePage';
import { ConfigTablePage } from './pages/ConfigTablePage';
import { HomePage } from './pages/HomePage';
import { ImportPage } from './pages/ImportPage';
import { ImportSettingsPage } from './pages/ImportSettingsPage';
import { LoginPage } from './pages/LoginPage';
import { PreSendPage } from './pages/PreSendPage';
import { QueuePage } from './pages/QueuePage';
import { SettingsPage } from './pages/SettingsPage';
import { pageTitles, type PageId } from './pages/pageRegistry';
import { useAuthContext } from './providers/AuthProvider';

const ACTIVE_PAGE_STORAGE_KEY = 'painel:active-page';
const validPageIds = new Set<PageId>(Object.keys(pageTitles) as PageId[]);

function initialPage(): PageId {
  if (typeof window === 'undefined') return 'home';
  const storedPage = window.sessionStorage.getItem(ACTIVE_PAGE_STORAGE_KEY) as PageId | null;
  return storedPage && validPageIds.has(storedPage) ? storedPage : 'home';
}

export function App() {
  const { isAuthenticated, loading } = useAuthContext();
  const [activePage, setActivePage] = useState<PageId>(initialPage);

  useEffect(() => {
    window.sessionStorage.setItem(ACTIVE_PAGE_STORAGE_KEY, activePage);
  }, [activePage]);

  // Nunca desmontar o painel já autenticado durante renovação de token ou recuperação de foco.
  // O carregamento bloqueante só é exibido antes de a primeira sessão ser resolvida.
  if (loading && !isAuthenticated) {
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
      {activePage === 'audit' ? <AuditPage /> : null}
      {activePage === 'valid' ? <HomePage mode="valid" /> : null}
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
