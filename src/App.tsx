import { useEffect, useState } from 'react';
import { DashboardLayout } from './design-system/layouts/DashboardLayout';
import { AccountPage } from './pages/AccountPage';
import { BasePage } from './pages/BasePage';
import { DashboardPage } from './pages/DashboardPage';
import { LeadsPage } from './pages/LeadsPage';
import { CommercialPage } from './pages/CommercialPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { SendsPage } from './pages/SendsPage';
import { SettingsOverviewPage } from './pages/ConfigurationPages';
import { CatalogCrudPage } from './pages/CatalogCrudPage';
import { ChannelsPage } from './pages/ChannelsPage';
import { ConversationsPage } from './pages/ConversationsPage';
import { ImportSettingsPage } from './pages/ImportSettingsPage';
import { ConfigTablePage } from './pages/ConfigTablePage';
import { HomePage } from './pages/HomePage';
import { ImportPage } from './pages/ImportPage';
import { LoginPage } from './pages/LoginPage';
import { PasswordRecoveryPage } from './pages/PasswordRecoveryPage';
import { QueuePage } from './pages/QueuePage';
import { ToolsPage } from './pages/ToolsPage';
import { MonitoringPage } from './pages/MonitoringPage';
import { HomologationPage } from './pages/HomologationPage';
import { ToolBrowserAuthorizePage } from './pages/ToolBrowserAuthorizePage';
import { MapsSearchesPage } from './pages/MapsSearchesPage';
import { OrganizationMembersPage } from './pages/OrganizationMembersPage';
import { OrganizationRolesPage } from './pages/OrganizationRolesPage';
import { OrganizationSettingsPage } from './pages/OrganizationSettingsPage';
import { PlatformOrganizationsPage } from './pages/PlatformOrganizationsPage';
import { pagePermissions, pageTitles, type PageId } from './pages/pageRegistry';
import { useAuthContext } from './providers/AuthProvider';
import { useOrganizationContext } from './providers/OrganizationProvider';
import { syncEvolutionInstances } from './services/evolution-instances/evolutionInstances.service';

const ACTIVE_PAGE_STORAGE_KEY = 'painel:active-page';
const validPageIds = new Set<PageId>(Object.keys(pageTitles) as PageId[]);
const legacyPageMap: Record<string, PageId> = {
  dashboard: 'dashboard',
  home: 'dashboard',
  valid: 'dashboard',
  'pre-send': 'dashboard',
  'import-approved': 'leads',
  'import-rejected': 'leads',
  'maps-searches': 'leads',
  base: 'leads',
  sends: 'whatsapp',
  whatsapp: 'whatsapp',
  instagram: 'instagram',
  chips: 'sender-chips',
  'instagram-settings': 'sender-instagram',
  branches: 'message-branches',
  templates: 'message-templates',
  'import-settings': 'config-import-rules',
  'config-validation-rules': 'dashboard',
  'validation-rules': 'dashboard',
  'validation-settings': 'dashboard',
  'validation-rules-settings': 'dashboard',
};

function initialPage(): PageId {
  if (typeof window === 'undefined') return 'dashboard';
  const storedPage = window.sessionStorage.getItem(ACTIVE_PAGE_STORAGE_KEY);
  if (!storedPage) return 'dashboard';
  if (legacyPageMap[storedPage]) return legacyPageMap[storedPage];
  if (validPageIds.has(storedPage as PageId)) return storedPage as PageId;
  return 'dashboard';
}

export function App() {
  const { isAuthenticated, loading, passwordRecovery } = useAuthContext();
  const { context: organizationContext, organizationId, loading: organizationLoading, error: organizationError, hasPermission } = useOrganizationContext();
  const [activePage, setActivePage] = useState<PageId>(initialPage);
  const canSyncEvolution = hasPermission('whatsapp.instances.manage');

  useEffect(() => {
    window.sessionStorage.setItem(ACTIVE_PAGE_STORAGE_KEY, activePage);
  }, [activePage]);

  useEffect(() => {
    if (!isAuthenticated || organizationLoading || !organizationContext) return;
    const permission = pagePermissions[activePage];
    if (permission && !hasPermission(permission)) setActivePage('dashboard');
  }, [activePage, hasPermission, isAuthenticated, organizationContext, organizationLoading]);

  useEffect(() => {
    if (!isAuthenticated || !organizationId || !canSyncEvolution) return undefined;
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
  }, [canSyncEvolution, isAuthenticated, organizationId]);

  // Não desmontar o painel autenticado durante renovação de token ou recuperação de foco.
  if (passwordRecovery) return <PasswordRecoveryPage />;

  if (loading && !isAuthenticated) {
    return (
      <div className="login-page">
        <div className="login-panel login-panel--loading">Carregando sessão...</div>
      </div>
    );
  }

  if (!isAuthenticated) return <LoginPage />;

  if (organizationLoading && !organizationContext) {
    return <div className="login-page"><div className="login-panel login-panel--loading">Carregando organização...</div></div>;
  }

  if (organizationError && !organizationContext) {
    return (
      <div className="login-page">
        <div className="login-panel">
          <strong>Não foi possível carregar a organização.</strong>
          <p>{organizationError}</p>
        </div>
      </div>
    );
  }

  const toolPairingId = new URLSearchParams(window.location.search).get('tool_pairing');
  if (toolPairingId) return <ToolBrowserAuthorizePage pairingId={toolPairingId} />;

  return (
    <DashboardLayout activePage={activePage} onNavigate={setActivePage}>
      {activePage === 'dashboard' ? <DashboardPage onNavigate={setActivePage} /> : null}
      {activePage === 'leads' ? <LeadsPage /> : null}
      {activePage === 'commercial' ? <CommercialPage /> : null}
      {activePage === 'projects' ? <ProjectsPage /> : null}
      {activePage === 'sends' ? <SendsPage /> : null}
      {activePage === 'home' ? <HomePage /> : null}
      {activePage === 'import-approved' || activePage === 'import-rejected' ? (
        <ImportPage
          rejected={activePage === 'import-rejected'}
          onStatusChange={(isRejected) => setActivePage(isRejected ? 'import-rejected' : 'import-approved')}
        />
      ) : null}
      {activePage === 'maps-searches' ? <MapsSearchesPage /> : null}
      {activePage === 'base' ? <BasePage /> : null}
      {activePage === 'whatsapp' ? <QueuePage channel="whatsapp" /> : null}
      {activePage === 'instagram' ? <QueuePage channel="instagram" /> : null}
      {activePage === 'conversations' ? <ConversationsPage /> : null}

      {activePage === 'sender-chips' ? <ConfigTablePage kind="chips" /> : null}
      {activePage === 'sender-instagram' ? <ConfigTablePage kind="instagram" /> : null}
      {activePage === 'message-branches' ? <ConfigTablePage kind="branches" /> : null}
      {activePage === 'message-templates' ? <ConfigTablePage kind="templates" /> : null}

      {activePage === 'organization-settings' ? <OrganizationSettingsPage /> : null}
      {activePage === 'organization-members' ? <OrganizationMembersPage /> : null}
      {activePage === 'organization-roles' ? <OrganizationRolesPage /> : null}
      {activePage === 'platform-organizations' ? <PlatformOrganizationsPage /> : null}

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
      {activePage === 'homologation' ? <HomologationPage /> : null}
    </DashboardLayout>
  );
}
