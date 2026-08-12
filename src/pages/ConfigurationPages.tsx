import { ArrowRight, Database, MessageSquareText, Settings2 } from 'lucide-react';
import { Button, Panel, Tag } from '../design-system/components';
import { PageHeader } from '../design-system/layouts/PageHeader';
import type { PageId } from './pageRegistry';

type SettingsOverviewPageProps = {
  onNavigate: (page: PageId) => void;
};

type SettingsSection = {
  title: string;
  description: string;
  icon: typeof Database;
  items: Array<{ label: string; page: PageId; ready: boolean }>;
};

const sections: SettingsSection[] = [
  {
    title: 'Importação',
    description: 'Fontes e critérios aplicados na entrada dos leads.',
    icon: Database,
    items: [
      { label: 'Fontes de contato', page: 'config-contact-sources', ready: true },
      { label: 'Critérios de importação', page: 'config-import-rules', ready: true },
    ],
  },
  {
    title: 'Disparos',
    description: 'Catálogos e limites herdados pelos remetentes.',
    icon: Settings2,
    items: [
      { label: 'Canais do sistema', page: 'config-channels', ready: true },
      { label: 'Níveis', page: 'config-levels', ready: true },
      { label: 'Instâncias', page: 'config-instances', ready: true },
    ],
  },
  {
    title: 'Templates',
    description: 'Classificações usadas na composição das mensagens.',
    icon: MessageSquareText,
    items: [
      { label: 'Canais de template', page: 'config-template-channels', ready: true },
      { label: 'Tipos de template', page: 'config-template-types', ready: true },
    ],
  },
];

export function SettingsOverviewPage({ onNavigate }: SettingsOverviewPageProps) {
  return (
    <div className="settings-page settings-overview-page">
      <PageHeader
        title="Configurações"
        description="Cadastros técnicos e regras globais da operação. Escolha uma área para continuar."
      />
      <section className="settings-overview-grid">
        {sections.map((section) => {
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
                    <span>{item.label}</span>
                    <span className="settings-overview-card__status">
                      {item.ready ? <Tag tone="success">Disponível</Tag> : <Tag tone="warning">Em construção</Tag>}
                      <ArrowRight size={15} strokeWidth={1.8} />
                    </span>
                  </button>
                ))}
              </div>
            </Panel>
          );
        })}
      </section>
      <div className="settings-overview-page__footer">
        <Button variant="secondary" onClick={() => onNavigate('home')}>Voltar ao Início</Button>
      </div>
    </div>
  );
}
