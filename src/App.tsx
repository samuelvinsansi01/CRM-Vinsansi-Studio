import { useEffect, useState } from 'react';
import { DashboardLayout } from './design-system/layouts/DashboardLayout';
import { AccountPage } from './pages/AccountPage';
import { AuditPage } from './pages/AuditPage';
import { BasePage } from './pages/BasePage';
import { SettingsOverviewPage } from './pages/ConfigurationPages';
import { CatalogCrudPage } from './pages/CatalogCrudPage';
import { ChannelsPage } from './pages/ChannelsPage';
import { ConversationsPage } from './pages/ConversationsPage';
import { ImportSettingsPage } from './pages/ImportSettingsPage';
import { ConfigTablePage } from './pages/ConfigTablePage';
import { HomePage } from './pages/HomePage';
import { ImportPage } from './pages/ImportPage';
import { LoginPage } from './pages/LoginPage';
import { QueuePage } from './pages/QueuePage';
import { ValidationRoutingPage } from './pages/ValidationRoutingPage';
import { ToolsPage } from './pages/ToolsPage';
import { MonitoringPage } from './pages/MonitoringPage';
import { MapsExtensionAuthorizePage } from './pages/MapsExtensionAuthorizePage';
import { MapsSearchesPage } from './pages/MapsSearchesPage';
import { pageTitles, type PageId } from './pages/pageRegistry';
import { useAuthContext } from './providers/AuthProvider';
import { syncEvolutionInstances } from './services/evolution-instances/evolutionInstances.service';

const ACTIVE_PAGE_STORAGE_KEY = 'painel:active-page';
const validPageIds = new Set<PageId>(Object.keys(pageTitles) as PageId[]);
const legacyPageMap: Record<string, PageId> = {
  valid: 'validation-routing',
  'pre-send': 'validation-routing',
  chips: 'sender-chips',
  'instagram-settings': 'sender-instagram',
  branches: 'message-branches',
  templates: 'message-templates',
  'import-settings': 'config-import-rules',
  'config-import-apify': 'config-import-rules',
  'config-validation-rules': 'validation-routing',
  'validation-rules': 'validation-routing',
  'validation-settings': 'validation-routing',
  'validation-rules-settings': 'validation-routing',
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

  useEffect(() => {
    if (!isAuthenticated) return undefined;
    let disposed = false;

    const reconcile = async (configureWebhook: boolean) => {
      if (disposed) return;
      try {
        await syncEvolutionInstances({ configureWebhook });
      } catch (error) {
        console.warn('Não foi possível sincronizar as instâncias Evolution.', error);
      }
    };

    const initialTimer = window.setTimeout(() => void reconcile(true), 500);
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void reconcile(false);
    }, 60_000);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void reconcile(false);
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      disposed = true;
      window.clearTimeout(initialTimer);
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [isAuthenticated]);

  // Não desmontar o painel autenticado durante renovação de token ou recuperação de foco.
  if (loading && !isAuthenticated) {
    return (
      <div className="login-page">
        <div className="login-panel login-panel--loading">Carregando sessão...</div>
      </div>
    );
  }

  if (!isAuthenticated) return <LoginPage />;

  const mapsPairingId = new URLSearchParams(window.location.search).get('maps_pairing');
  if (mapsPairingId) return <MapsExtensionAuthorizePage pairingId={mapsPairingId} />;

  return (
    <DashboardLayout activePage={activePage} onNavigate={setActivePage}>
      {activePage === 'home' ? <HomePage /> : null}
      {activePage === 'import-approved' || activePage === 'import-rejected' ? (
        <ImportPage
          rejected={activePage === 'import-rejected'}
          onStatusChange={(isRejected) => setActivePage(isRejected ? 'import-rejected' : 'import-approved')}
        />
      ) : null}
      {activePage === 'maps-searches' ? <MapsSearchesPage /> : null}
      {activePage === 'validation-routing' ? <ValidationRoutingPage /> : null}
      {activePage === 'base' ? <BasePage /> : null}
      {activePage === 'whatsapp' ? <QueuePage channel="whatsapp" /> : null}
      {activePage === 'instagram' ? <QueuePage channel="instagram" /> : null}
      {activePage === 'conversations' ? <ConversationsPage /> : null}

      {activePage === 'sender-chips' ? <ConfigTablePage kind="chips" /> : null}
      {activePage === 'sender-instagram' ? <ConfigTablePage kind="instagram" /> : null}
      {activePage === 'message-branches' ? <ConfigTablePage kind="branches" /> : null}
      {activePage === 'message-templates' ? <ConfigTablePage kind="templates" /> : null}
      {activePage === 'message-variables' ? <CatalogCrudPage kind="template_variables" /> : null}

      {activePage === 'settings' ? <SettingsOverviewPage onNavigate={setActivePage} /> : null}
      {activePage === 'config-contact-sources' ? <CatalogCrudPage kind="contact_sources" /> : null}
      {activePage === 'config-import-rules' ? <ImportSettingsPage /> : null}
      {activePage === 'config-channels' ? <ChannelsPage /> : null}
      {activePage === 'config-levels' ? <CatalogCrudPage kind="levels" /> : null}
      {activePage === 'config-instances' ? <CatalogCrudPage kind="instances" /> : null}
      {activePage === 'config-template-channels' ? <CatalogCrudPage kind="template_channels" /> : null}
      {activePage === 'config-template-types' ? <CatalogCrudPage kind="template_types" /> : null}

      {activePage === 'account' ? <AccountPage /> : null}
      {activePage === 'tools' ? <ToolsPage /> : null}
      {activePage === 'monitoring' ? <MonitoringPage /> : null}
      {activePage === 'audit' ? <AuditPage /> : null}
    </DashboardLayout>
  );
}
