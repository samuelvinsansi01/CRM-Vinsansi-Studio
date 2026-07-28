import { supabaseBaseRepository } from './base';
import { supabaseConfigRepository } from './config';
import { supabaseEventLogRepository } from './events';
import { supabaseImportRepository } from './import';
import { supabaseInstagramQueueRepository } from './instagram-queue';
import { supabaseSettingsRepository } from './settings';
import { supabaseWhatsAppQueueRepository } from './whatsapp-queue';

export const repositories = {
  config: supabaseConfigRepository,
  import: supabaseImportRepository,
  whatsappQueue: supabaseWhatsAppQueueRepository,
  instagramQueue: supabaseInstagramQueueRepository,
  base: supabaseBaseRepository,
  settings: supabaseSettingsRepository,
  events: supabaseEventLogRepository,
};

export * from './config';
export * from './import';
export * from './whatsapp-queue';
export * from './instagram-queue';
export * from './base';
export * from './settings';
export * from './events';
export * from './lead-cycle';
