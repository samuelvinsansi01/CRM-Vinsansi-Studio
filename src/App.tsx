import { useEffect, useState } from 'react';
import { DashboardLayout } from './design-system/layouts/DashboardLayout';
import { ApifyAccountsPage } from './pages/ApifyAccountsPage';
import { AuditPage } from './pages/AuditPage';
import { BasePage } from './pages/BasePage';
import { ConfigurationPlaceholderPage, SettingsOverviewPage } from './pages/ConfigurationPages';
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
      {activePage === 'message-variables' ? (
        <ConfigurationPlaceholderPage
          title="Variáveis"
          description="Gerencie as variáveis disponíveis para composição dos templates de mensagens."
          tableName="template_variables"
        />
      ) : null}

      {activePage === 'settings' ? <SettingsOverviewPage /> : null}
      {activePage === 'config-import-apify' ? <ApifyAccountsPage /> : null}
      {activePage === 'config-contact-sources' ? (
        <ConfigurationPlaceholderPage
          title="Fontes de contato"
          description="Cadastre e organize as origens usadas para classificar os leads importados."
          tableName="contact_sources"
        />
      ) : null}
      {activePage === 'config-import-rules' ? (
        <ConfigurationPlaceholderPage
          title="Critérios de importação"
          description="Defina os critérios globais usados na entrada e deduplicação de leads."
          tableName="import_rules"
          mode="form"
        />
      ) : null}
      {activePage === 'config-validation-rules' ? (
        <ConfigurationPlaceholderPage
          title="Regras de validação e roteamento"
          description="Configure a origem elegível, o canal validado e o fallback operacional."
          tableName="validation_rules"
          mode="form"
        />
      ) : null}
      {activePage === 'config-channels' ? (
        <ConfigurationPlaceholderPage
          title="Canais do sistema"
          description="Consulte os canais canônicos usados pelos fluxos e filas."
          tableName="channels"
        />
      ) : null}
      {activePage === 'config-levels' ? (
        <ConfigurationPlaceholderPage
          title="Níveis"
          description="Gerencie limites operacionais que serão herdados pelos remetentes."
          tableName="levels"
        />
      ) : null}
      {activePage === 'config-instances' ? (
        <ConfigurationPlaceholderPage
          title="Instâncias"
          description="Cadastre as instâncias de integração usadas pelos chips WhatsApp."
          tableName="instances"
        />
      ) : null}
      {activePage === 'config-template-channels' ? (
        <ConfigurationPlaceholderPage
          title="Canais de template"
          description="Gerencie as classificações de canal disponíveis para os templates."
          tableName="template_channels"
        />
      ) : null}
      {activePage === 'config-template-types' ? (
        <ConfigurationPlaceholderPage
          title="Tipos de template"
          description="Gerencie os tipos utilizados para organizar templates de mensagens."
          tableName="template_types"
        />
      ) : null}

      {activePage === 'audit' ? <AuditPage /> : null}
    </DashboardLayout>
  );
}
