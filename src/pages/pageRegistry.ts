export type PageId =
  | 'home'
  | 'import-approved'
  | 'import-rejected'
  | 'maps-searches'
  | 'base'
  | 'whatsapp'
  | 'instagram'
  | 'conversations'
  | 'sender-chips'
  | 'sender-instagram'
  | 'message-branches'
  | 'message-templates'
  | 'settings'
  | 'config-contact-sources'
  | 'config-import-rules'
  | 'config-channels'
  | 'config-levels'
  | 'config-instances'
  | 'config-template-channels'
  | 'config-template-types'
  | 'organization-settings'
  | 'organization-members'
  | 'organization-roles'
  | 'platform-organizations'
  | 'account'
  | 'tools'
  | 'monitoring'
  | 'homologation';

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
      { id: 'maps-searches', label: 'Pesquisas Google Maps' },
      { id: 'base', label: 'Base Permanente' },
    ],
  },
  {
    id: 'whatsapp',
    label: 'Disparos',
    items: [
      { id: 'whatsapp', label: 'Fila WhatsApp' },
      { id: 'instagram', label: 'Fila Instagram' },
      { id: 'conversations', label: 'Conversas' },
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
    ],
  },
  {
    id: 'organization-settings',
    label: 'Organização',
    items: [
      { id: 'organization-settings', label: 'Organização' },
      { id: 'organization-members', label: 'Membros' },
      { id: 'organization-roles', label: 'Funções e acessos' },
      { id: 'platform-organizations', label: 'Plataforma' },
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
          { id: 'config-contact-sources', label: 'Fontes de contato' },
          { id: 'config-import-rules', label: 'Critérios de importação' },
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
          { id: 'homologation', label: 'Homologação final' },
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
  'maps-searches': 'Pesquisas Google Maps',
  base: 'Base Permanente',
  whatsapp: 'Fila WhatsApp',
  instagram: 'Fila Instagram',
  conversations: 'Conversas',
  'sender-chips': 'Chips WhatsApp',
  'sender-instagram': 'Perfis Instagram',
  'message-branches': 'Ramos',
  'message-templates': 'Templates de mensagens',
  settings: 'Configurações',
  'config-contact-sources': 'Fontes de contato',
  'config-import-rules': 'Critérios de importação',
  'config-channels': 'Canais do sistema',
  'config-levels': 'Níveis',
  'config-instances': 'Instâncias',
  'config-template-channels': 'Canais de template',
  'config-template-types': 'Tipos de template',
  'organization-settings': 'Organização',
  'organization-members': 'Membros',
  'organization-roles': 'Funções e acessos',
  'platform-organizations': 'Organizações da plataforma',
  account: 'Minha conta',
  tools: 'Ferramentas',
  monitoring: 'Monitoramento',
  homologation: 'Homologação final',
};

export const pagePermissions: Partial<Record<PageId, string>> = {
  'import-approved': 'leads.view',
  'import-rejected': 'leads.view',
  'maps-searches': 'capture.use',
  base: 'leads.view',
  whatsapp: 'queues.view',
  instagram: 'queues.view',
  conversations: 'whatsapp.view',
  'sender-chips': 'whatsapp.view',
  'sender-instagram': 'instagram.view',
  'message-branches': 'templates.view',
  'message-templates': 'templates.view',
  settings: 'settings.view',
  'config-contact-sources': 'settings.view',
  'config-import-rules': 'settings.view',
  'config-channels': 'settings.view',
  'config-levels': 'settings.view',
  'config-instances': 'whatsapp.instances.manage',
  'config-template-channels': 'templates.view',
  'config-template-types': 'templates.view',
  'organization-settings': 'organization.view',
  'organization-members': 'members.view',
  'organization-roles': 'roles.view',
  'platform-organizations': 'platform.organizations.manage',
  tools: 'tools.view',
  monitoring: 'monitoring.view',
  homologation: 'monitoring.view',
};
