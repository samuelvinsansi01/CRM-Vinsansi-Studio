import { supabaseBaseRepository } from './base';
import { canonicalConfigRepository } from './config';
import { supabaseImportRepository } from './import';
import { canonicalInstagramQueueRepository } from './instagram-queue';
import { canonicalSettingsRepository } from './settings';
import { canonicalWhatsAppQueueRepository } from './whatsapp-queue';

export const repositories = {
  config: canonicalConfigRepository,
  import: supabaseImportRepository,
  whatsappQueue: canonicalWhatsAppQueueRepository,
  instagramQueue: canonicalInstagramQueueRepository,
  base: supabaseBaseRepository,
  settings: canonicalSettingsRepository,
};

export * from './config';
export * from './import';
export * from './whatsapp-queue';
export * from './instagram-queue';
export * from './base';
export * from './settings';
export * from './lead-cycle';

export * from './notifications';
