export type PageId =
  | 'home'
  | 'import-approved'
  | 'import-rejected'
  | 'base'
  | 'valid'
  | 'pre-send'
  | 'whatsapp'
  | 'instagram'
  | 'chips'
  | 'instagram-settings'
  | 'branches'
  | 'templates'
  | 'import-settings'
  | 'settings';

export const navGroups = [
  { id: 'home', label: 'Início' },
  { id: 'import-approved', label: 'Importar' },
  {
    id: 'pre-send',
    label: 'Envios',
    items: [
      { id: 'pre-send', label: 'Pré-Envio' },
      { id: 'valid', label: 'Válidos' },
      { id: 'whatsapp', label: 'Fila WhatsApp' },
      { id: 'instagram', label: 'Fila Instagram' },
    ],
  },
  { id: 'base', label: 'Base Permanente' },
  {
    id: 'settings',
    label: 'Configurações',
    items: [
      { id: 'chips', label: 'Chips' },
      { id: 'instagram-settings', label: 'Instagram' },
      { id: 'branches', label: 'Ramos' },
      { id: 'templates', label: 'Templates' },
      { id: 'import-settings', label: 'Importação' },
      { id: 'settings', label: 'Disparos' },
    ],
  },
] as const;

export const pageTitles: Record<PageId, string> = {
  home: 'Início',
  'import-approved': 'Importar',
  'import-rejected': 'Importar',
  base: 'Base Permanente',
  valid: 'Válidos',
  'pre-send': 'Pré-Envio',
  whatsapp: 'Fila WhatsApp',
  instagram: 'Fila Instagram',
  chips: 'Chips',
  'instagram-settings': 'Instagram',
  branches: 'Ramos',
  templates: 'Templates',
  'import-settings': 'Importação',
  settings: 'Disparos',
};
