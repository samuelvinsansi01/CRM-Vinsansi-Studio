import { ArrowRight, Building2, MessageSquareText, RadioTower, Settings2, Users } from 'lucide-react';
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
    title: 'Leads e captação',
    description: 'Estrutura usada para classificar empresas e orientar o Motor de Captura.',
    icon: Users,
    items: [
      { label: 'Ramos', page: 'message-branches', description: 'Ramos, categorias e termos usados na operação.' },
      { label: 'Critérios de captação', page: 'config-import-rules', description: 'Regras globais de nota, avaliações e entrada de leads.' },
    ],
  },
  {
    title: 'Canais',
    description: 'Recursos que representam os remetentes e seus limites de operação.',
    icon: RadioTower,
    items: [
      { label: 'Chips WhatsApp', page: 'sender-chips', description: 'Chips, instâncias e vínculo operacional.' },
      { label: 'Perfis Instagram', page: 'sender-instagram', description: 'Perfis utilizados pelo Motor Instagram.' },
      { label: 'Níveis', page: 'config-levels', description: 'Limites diários e distribuição por lote.' },
    ],
  },
  {
    title: 'Mensagens',
    description: 'Conteúdo utilizado pelos canais durante os envios.',
    icon: MessageSquareText,
    items: [
      { label: 'Templates de mensagens', page: 'message-templates', description: 'Textos e sequências vinculados aos ramos.' },
    ],
  },
  {
    title: 'Automação',
    description: 'Regras globais obedecidas pelos motores do Gerenciador de Disparos.',
    icon: Settings2,
    items: [
      { label: 'Central de Ferramentas', page: 'tools', description: 'Delays, janelas, intervalos e configurações dos motores.' },
    ],
  },
  {
    title: 'Organização',
    description: 'Estrutura da conta, membros e controle de acesso.',
    icon: Building2,
    items: [
      { label: 'Dados da organização', page: 'organization-settings', description: 'Informações e preferências da organização ativa.' },
      { label: 'Membros', page: 'organization-members', description: 'Pessoas que acessam esta organização.' },
      { label: 'Funções e acessos', page: 'organization-roles', description: 'Papéis e permissões delegáveis.' },
      { label: 'Organizações da plataforma', page: 'platform-organizations', description: 'Administração exclusiva do Platform Owner.' },
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
        description="Administração da operação. Configurações técnicas que não fazem parte do trabalho diário ficam concentradas aqui."
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
