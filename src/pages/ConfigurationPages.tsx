import { ArrowRight, Building2, PlugZap, Settings2, SlidersHorizontal } from 'lucide-react';
import { Button, Panel } from '../design-system/components';
import { PageHeader } from '../design-system/layouts/PageHeader';
import { useOrganizationContext } from '../providers/OrganizationProvider';
import { pagePermissions, type PageId } from './pageRegistry';

type SettingsOverviewPageProps = { onNavigate: (page: PageId) => void };
type SettingsSection = {
  title: string;
  description: string;
  icon: typeof Settings2;
  items: Array<{ label: string; page: PageId; description: string }>;
};

const sections: SettingsSection[] = [
  {
    title: 'Organização',
    description: 'Conta, equipe e controle de acesso da organização ativa.',
    icon: Building2,
    items: [
      { label: 'Dados da organização', page: 'organization-settings', description: 'Identificação da organização e dados administrativos.' },
      { label: 'Membros', page: 'organization-members', description: 'Pessoas que acessam esta organização e seus níveis.' },
      { label: 'Funções e acessos', page: 'organization-roles', description: 'Permissões delegáveis. Somente o Dono altera funções.' },
      { label: 'Organizações da plataforma', page: 'platform-organizations', description: 'Administração exclusiva do Platform Owner.' },
    ],
  },
  {
    title: 'Preferências gerais',
    description: 'Cadastros técnicos de apoio que não fazem parte do trabalho diário.',
    icon: SlidersHorizontal,
    items: [
      { label: 'Fontes de contato', page: 'config-contact-sources', description: 'Origens técnicas usadas para classificar contatos.' },
      { label: 'Canais do sistema', page: 'config-channels', description: 'Catálogo interno dos canais suportados pela plataforma.' },
      { label: 'Níveis', page: 'config-levels', description: 'Limites e capacidades operacionais dos canais.' },
      { label: 'Canais de template', page: 'config-template-channels', description: 'Catálogo técnico usado pelos templates de mensagem.' },
      { label: 'Tipos de template', page: 'config-template-types', description: 'Tipos internos utilizados pelos templates.' },
    ],
  },
  {
    title: 'Integrações e automação',
    description: 'Infraestrutura técnica usada pelas ferramentas conectadas ao CRM.',
    icon: PlugZap,
    items: [
      { label: 'Instâncias WhatsApp', page: 'config-instances', description: 'Instâncias técnicas vinculadas aos chips cadastrados.' },
      { label: 'Central de Ferramentas', page: 'tools', description: 'Parâmetros e conexões das ferramentas auxiliares.' },
    ],
  },
];

export function SettingsOverviewPage({ onNavigate }: SettingsOverviewPageProps) {
  const { hasPermission } = useOrganizationContext();
  const canAccess = (page: PageId) => {
    const permission = pagePermissions[page];
    return !permission || hasPermission(permission);
  };
  const visibleSections = sections
    .map((section) => ({ ...section, items: section.items.filter((item) => canAccess(item.page)) }))
    .filter((section) => section.items.length > 0);

  return (
    <div className="settings-page settings-overview-page">
      <PageHeader
        title="Configurações"
        description="Administração da organização e preferências técnicas. Chips, perfis, ramos e templates ficam em Biblioteca e cadastros."
      />
      <section className="settings-overview-grid settings-overview-grid--ia">
        {visibleSections.map((section) => {
          const Icon = section.icon;
          return (
            <Panel title={section.title} className="settings-card settings-overview-card" key={section.title}>
              <div className="settings-overview-card__intro">
                <Icon size={20} strokeWidth={1.8} />
                <p>{section.description}</p>
              </div>
              <div className="settings-overview-card__links">
                {section.items.map((item) => (
                  <button type="button" key={item.page} onClick={() => onNavigate(item.page)}>
                    <span className="settings-overview-card__link-copy"><strong>{item.label}</strong><small>{item.description}</small></span>
                    <ArrowRight size={15} strokeWidth={1.8} />
                  </button>
                ))}
              </div>
            </Panel>
          );
        })}
      </section>
      <div className="settings-overview-page__footer">
        <Button variant="secondary" onClick={() => onNavigate('dashboard')}>Voltar ao Dashboard</Button>
      </div>
    </div>
  );
}
