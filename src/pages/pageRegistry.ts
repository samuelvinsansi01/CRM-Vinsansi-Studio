export type PageId =
  | 'home'
  | 'import-approved'
  | 'import-rejected'
  | 'validation-routing'
  | 'base'
  | 'whatsapp'
  | 'instagram'
  | 'sender-chips'
  | 'sender-instagram'
  | 'message-branches'
  | 'message-templates'
  | 'message-variables'
  | 'settings'
  | 'config-import-apify'
  | 'config-contact-sources'
  | 'config-import-rules'
  | 'config-validation-rules'
  | 'config-channels'
  | 'config-levels'
  | 'config-instances'
  | 'config-template-channels'
  | 'config-template-types'
  | 'account'
  | 'tools'
  | 'monitoring'
  | 'audit';

export type NavItem = {
  id: PageId;
  label: string;
};

export type NavSection = {
  label: string;
  items: readonly NavItem[];
};

export type NavGroup = {
  id: PageId;
  label: string;
  items?: readonly NavItem[];
  sections?: readonly NavSection[];
  menuClassName?: string;
};

export const navGroups: readonly NavGroup[] = [
  { id: 'home', label: 'Início' },
  {
    id: 'import-approved',
    label: 'Leads',
    items: [
      { id: 'import-approved', label: 'Importação' },
      { id: 'validation-routing', label: 'Validação e roteamento' },
      { id: 'base', label: 'Base Permanente' },
    ],
  },
  {
    id: 'whatsapp',
    label: 'Disparos',
    items: [
      { id: 'whatsapp', label: 'Fila WhatsApp' },
      { id: 'instagram', label: 'Fila Instagram' },
    ],
  },
  {
    id: 'sender-chips',
    label: 'Remetentes',
    items: [
      { id: 'sender-chips', label: 'Chips WhatsApp' },
      { id: 'sender-instagram', label: 'Perfis Instagram' },
    ],
  },
  {
    id: 'message-branches',
    label: 'Central de Mensagens',
    items: [
      { id: 'message-branches', label: 'Ramos' },
      { id: 'message-templates', label: 'Templates de mensagens' },
      { id: 'message-variables', label: 'Variáveis' },
    ],
  },
  {
    id: 'settings',
    label: 'Configurações',
    menuClassName: 'nav-menu--settings',
    sections: [
      {
        label: 'Importação',
        items: [
          { id: 'config-import-apify', label: 'Contas Apify' },
          { id: 'config-contact-sources', label: 'Fontes de contato' },
          { id: 'config-import-rules', label: 'Critérios de importação' },
        ],
      },
      {
        label: 'Validação e roteamento',
        items: [
          { id: 'config-validation-rules', label: 'Regras de validação' },
        ],
      },
      {
        label: 'Disparos',
        items: [
          { id: 'config-channels', label: 'Canais do sistema' },
          { id: 'config-levels', label: 'Níveis' },
          { id: 'config-instances', label: 'Instâncias' },
        ],
      },
      {
        label: 'Sistema',
        items: [
          { id: 'tools', label: 'Ferramentas' },
          { id: 'monitoring', label: 'Monitoramento' },
        ],
      },
      {
        label: 'Templates',
        items: [
          { id: 'config-template-channels', label: 'Canais de template' },
          { id: 'config-template-types', label: 'Tipos de template' },
        ],
      },
    ],
  },
];

export const pageTitles: Record<PageId, string> = {
  home: 'Início',
  'import-approved': 'Importação',
  'import-rejected': 'Importação',
  'validation-routing': 'Validação e roteamento',
  base: 'Base Permanente',
  whatsapp: 'Fila WhatsApp',
  instagram: 'Fila Instagram',
  'sender-chips': 'Chips WhatsApp',
  'sender-instagram': 'Perfis Instagram',
  'message-branches': 'Ramos',
  'message-templates': 'Templates de mensagens',
  'message-variables': 'Variáveis',
  settings: 'Configurações',
  'config-import-apify': 'Contas Apify',
  'config-contact-sources': 'Fontes de contato',
  'config-import-rules': 'Critérios de importação',
  'config-validation-rules': 'Regras de validação e roteamento',
  'config-channels': 'Canais do sistema',
  'config-levels': 'Níveis',
  'config-instances': 'Instâncias',
  'config-template-channels': 'Canais de template',
  'config-template-types': 'Tipos de template',
  account: 'Minha conta',
  tools: 'Ferramentas',
  monitoring: 'Monitoramento',
  audit: 'Auditoria',
};
