import { supabaseBaseRepository } from './base';
import { canonicalConfigRepository } from './config';
import { canonicalEventLogRepository } from './events';
import { supabaseImportRepository } from './import';
import { canonicalInstagramQueueRepository } from './instagram-queue';
import { localSettingsRepository } from './settings';
import { canonicalWhatsAppQueueRepository } from './whatsapp-queue';

export const repositories = {
  config: canonicalConfigRepository,
  import: supabaseImportRepository,
  whatsappQueue: canonicalWhatsAppQueueRepository,
  instagramQueue: canonicalInstagramQueueRepository,
  base: supabaseBaseRepository,
  settings: localSettingsRepository,
  events: canonicalEventLogRepository,
};

export * from './config';
export * from './import';
export * from './whatsapp-queue';
export * from './instagram-queue';
export * from './base';
export * from './settings';
export * from './events';
export * from './lead-cycle';
