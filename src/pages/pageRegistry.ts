export type PageId =
  | 'dashboard'
  | 'leads'
  | 'commercial'
  | 'conversations'
  | 'projects'
  | 'sends'
  // Rotas internas/legadas mantidas para compatibilidade e configurações.
  | 'home'
  | 'import-approved'
  | 'import-rejected'
  | 'maps-searches'
  | 'base'
  | 'whatsapp'
  | 'instagram'
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

export type NavItem = { id: PageId; label: string };
export type NavSection = { label: string; items: readonly NavItem[] };
export type NavGroup = {
  id: PageId;
  label: string;
  items?: readonly NavItem[];
  sections?: readonly NavSection[];
  menuClassName?: string;
};

// Navegação primária final do CRM.
// Configurações administrativas ficam exclusivamente no ícone de engrenagem.
// Canais e cadastros reutilizáveis compartilham um único ponto para manter sete menus principais.
export const navGroups: readonly NavGroup[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'commercial', label: 'Comercial' },
  { id: 'projects', label: 'Projetos' },
  { id: 'conversations', label: 'Conversas' },
  { id: 'leads', label: 'Empresas' },
  {
    id: 'sends',
    label: 'Fila de Disparo',
    items: [
      { id: 'whatsapp', label: 'WhatsApp' },
      { id: 'instagram', label: 'Instagram' },
    ],
  },
  {
    id: 'sender-chips',
    label: 'Biblioteca e cadastros',
    items: [
      { id: 'sender-chips', label: 'Chips WhatsApp' },
      { id: 'sender-instagram', label: 'Perfis Instagram' },
      { id: 'message-branches', label: 'Ramos' },
      { id: 'message-templates', label: 'Templates de mensagem' },
    ],
  },
];

export const pageTitles: Record<PageId, string> = {
  dashboard: 'Dashboard',
  leads: 'Empresas',
  commercial: 'Comercial',
  conversations: 'Conversas',
  projects: 'Projetos',
  sends: 'Fila de Disparo',
  home: 'Início legado',
  'import-approved': 'Importação',
  'import-rejected': 'Importação',
  'maps-searches': 'Pesquisas Google Maps',
  base: 'Base Permanente',
  whatsapp: 'Fila WhatsApp',
  instagram: 'Fila Instagram',
  'sender-chips': 'Chips WhatsApp',
  'sender-instagram': 'Perfis Instagram',
  'message-branches': 'Ramos',
  'message-templates': 'Templates de mensagens',
  settings: 'Configurações',
  'config-contact-sources': 'Fontes de contato',
  'config-import-rules': 'Critérios de captação',
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
  tools: 'Central de Ferramentas',
  monitoring: 'Monitoramento',
  homologation: 'Homologação final',
};

export const pagePermissions: Partial<Record<PageId, string>> = {
  settings: 'settings.view',
  leads: 'leads.view',
  projects: 'leads.view',
  commercial: 'leads.view',
  sends: 'queues.view',
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
  'config-contact-sources': 'settings.view',
  'config-import-rules': 'settings.view',
  'config-channels': 'settings.view',
  'config-levels': 'settings.view',
  'config-instances': 'whatsapp.instances.manage',
  'config-template-channels': 'templates.view',
  'config-template-types': 'templates.view',
  'organization-settings': 'settings.view',
  'organization-members': 'members.view',
  'organization-roles': 'roles.view',
  'platform-organizations': 'platform.organizations.manage',
  tools: 'settings.view',
  monitoring: 'monitoring.view',
  homologation: 'monitoring.view',
};

export const settingsPageIds = new Set<PageId>([
  'settings',
  'config-contact-sources',
  'config-import-rules',
  'config-channels',
  'config-levels',
  'config-instances',
  'config-template-channels',
  'config-template-types',
  'organization-settings',
  'organization-members',
  'organization-roles',
  'platform-organizations',
  'tools',
]);
