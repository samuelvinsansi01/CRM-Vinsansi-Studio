import { Panel, Tag } from '../design-system/components';
import { PageHeader } from '../design-system/layouts/PageHeader';

type ConfigurationPlaceholderPageProps = {
  title: string;
  description: string;
  tableName: string;
  mode?: 'catalog' | 'form';
};

const sections = [
  {
    title: 'Importação',
    items: ['Contas Apify', 'Fontes de contato', 'Critérios de importação'],
  },
  {
    title: 'Validação e roteamento',
    items: ['Regras de validação'],
  },
  {
    title: 'Disparos',
    items: ['Canais do sistema', 'Níveis', 'Instâncias'],
  },
  {
    title: 'Templates',
    items: ['Canais de template', 'Tipos de template'],
  },
];

export function SettingsOverviewPage() {
  return (
    <div className="settings-page settings-overview-page">
      <PageHeader
        title="Configurações"
        description="Cadastros técnicos e regras globais da operação. Escolha uma opção no menu Configurações."
      />
      <section className="settings-overview-grid">
        {sections.map((section) => (
          <Panel title={section.title} className="settings-card settings-overview-card" key={section.title}>
            <ul>
              {section.items.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </Panel>
        ))}
      </section>
    </div>
  );
}

export function ConfigurationPlaceholderPage({ title, description, tableName, mode = 'catalog' }: ConfigurationPlaceholderPageProps) {
  return (
    <div className="settings-page configuration-placeholder-page">
      <PageHeader title={title} description={description} />
      <Panel title="Estrutura preparada" className="settings-card configuration-placeholder-card">
        <div className="configuration-placeholder-card__meta">
          <Tag tone="success">Rota criada</Tag>
          <code>{tableName}</code>
        </div>
        <p className="settings-note">
          {mode === 'form'
            ? 'Esta página receberá um formulário global conectado à tabela indicada na próxima etapa funcional.'
            : 'Esta página receberá listagem, filtros e cadastro por modal conectado à tabela indicada na próxima etapa funcional.'}
        </p>
      </Panel>
    </div>
  );
}
