import { useEffect, useState } from 'react';
import { DashboardLayout } from './design-system/layouts/DashboardLayout';
import { ApifyAccountsPage } from './pages/ApifyAccountsPage';
import { AuditPage } from './pages/AuditPage';
import { BasePage } from './pages/BasePage';
import { SettingsOverviewPage } from './pages/ConfigurationPages';
import { CatalogCrudPage } from './pages/CatalogCrudPage';
import { ChannelsPage } from './pages/ChannelsPage';
import { ImportRulesPage } from './pages/ImportRulesPage';
import { ValidationRulesSettingsPage } from './pages/ValidationRulesSettingsPage';
import { ConfigTablePage } from './pages/ConfigTablePage';
import { HomePage } from './pages/HomePage';
import { ImportPage } from './pages/ImportPage';
import { LoginPage } from './pages/LoginPage';
import { QueuePage } from './pages/QueuePage';
import { ValidationRoutingPage } from './pages/ValidationRoutingPage';
import { pageTitles, type PageId } from './pages/pageRegistry';
import { useAuthContext } from './providers/AuthProvider';

const ACTIVE_PAGE_STORAGE_KEY = 'painel:active-page';
const validPageIds = new Set<PageId>(Object.keys(pageTitles) as PageId[]);
const legacyPageMap: Record<string, PageId> = {
  valid: 'validation-routing',
  'pre-send': 'validation-routing',
  chips: 'sender-chips',
  'instagram-settings': 'sender-instagram',
  branches: 'message-branches',
  templates: 'message-templates',
  'import-settings': 'config-import-apify',
};

function initialPage(): PageId {
  if (typeof window === 'undefined') return 'home';
  const storedPage = window.sessionStorage.getItem(ACTIVE_PAGE_STORAGE_KEY);
  if (!storedPage) return 'home';
  if (validPageIds.has(storedPage as PageId)) return storedPage as PageId;
  return legacyPageMap[storedPage] ?? 'home';
}

export function App() {
  const { isAuthenticated, loading } = useAuthContext();
  const [activePage, setActivePage] = useState<PageId>(initialPage);

  useEffect(() => {
    window.sessionStorage.setItem(ACTIVE_PAGE_STORAGE_KEY, activePage);
  }, [activePage]);

  // Não desmontar o painel autenticado durante renovação de token ou recuperação de foco.
  if (loading && !isAuthenticated) {
    return (
      <div className="login-page">
        <div className="login-panel login-panel--loading">Carregando sessão...</div>
      </div>
    );
  }

  if (!isAuthenticated) return <LoginPage />;

  return (
    <DashboardLayout activePage={activePage} onNavigate={setActivePage}>
      {activePage === 'home' ? <HomePage /> : null}
      {activePage === 'import-approved' || activePage === 'import-rejected' ? (
        <ImportPage
          rejected={activePage === 'import-rejected'}
          onStatusChange={(isRejected) => setActivePage(isRejected ? 'import-rejected' : 'import-approved')}
        />
      ) : null}
      {activePage === 'validation-routing' ? <ValidationRoutingPage /> : null}
      {activePage === 'base' ? <BasePage /> : null}
      {activePage === 'whatsapp' ? <QueuePage channel="whatsapp" /> : null}
      {activePage === 'instagram' ? <QueuePage channel="instagram" /> : null}

      {activePage === 'sender-chips' ? <ConfigTablePage kind="chips" /> : null}
      {activePage === 'sender-instagram' ? <ConfigTablePage kind="instagram" /> : null}
      {activePage === 'message-branches' ? <ConfigTablePage kind="branches" /> : null}
      {activePage === 'message-templates' ? <ConfigTablePage kind="templates" /> : null}
      {activePage === 'message-variables' ? <CatalogCrudPage kind="template_variables" /> : null}

      {activePage === 'settings' ? <SettingsOverviewPage onNavigate={setActivePage} /> : null}
      {activePage === 'config-import-apify' ? <ApifyAccountsPage /> : null}
      {activePage === 'config-contact-sources' ? <CatalogCrudPage kind="contact_sources" /> : null}
      {activePage === 'config-import-rules' ? <ImportRulesPage /> : null}
      {activePage === 'config-validation-rules' ? <ValidationRulesSettingsPage /> : null}
      {activePage === 'config-channels' ? <ChannelsPage /> : null}
      {activePage === 'config-levels' ? <CatalogCrudPage kind="levels" /> : null}
      {activePage === 'config-instances' ? <CatalogCrudPage kind="instances" /> : null}
      {activePage === 'config-template-channels' ? <CatalogCrudPage kind="template_channels" /> : null}
      {activePage === 'config-template-types' ? <CatalogCrudPage kind="template_types" /> : null}

      {activePage === 'audit' ? <AuditPage /> : null}
    </DashboardLayout>
  );
}
