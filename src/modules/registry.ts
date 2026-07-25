export const modules = [
  { id: 'leads', title: 'Leads', description: 'Importação, normalização, classificação e gestão dos contatos.', tables: ['leads', 'lead_status', 'contact_sources'] },
  { id: 'imports', title: 'Importações', description: 'Contas e execuções do Apify.', tables: ['apify_accounts', 'apify_import_jobs'] },
  { id: 'queues', title: 'Filas', description: 'Fila única por canal, sem duplicação entre WhatsApp e Instagram.', tables: ['queues', 'queue_items', 'channels'] },
  { id: 'dispatch', title: 'Disparos', description: 'Histórico e resultado das mensagens enviadas.', tables: ['sents', 'chips', 'socials'] },
  { id: 'templates', title: 'Templates', description: 'Mensagens, canais, tipos e variáveis.', tables: ['templates', 'template_channels', 'template_types', 'template_variables'] },
  { id: 'settings', title: 'Configurações', description: 'Ramos, instâncias, níveis e cadastros auxiliares.', tables: ['branches', 'instances', 'levels', 'status'] },
] as const;
export type ModuleId = typeof modules[number]['id'];
