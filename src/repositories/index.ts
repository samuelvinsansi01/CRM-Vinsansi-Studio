import { getSupabaseConfig, isSupabaseConfigured } from '../lib/supabase';
import { mockBaseRepository, supabaseBaseRepository } from './base';
import { supabaseConfigRepository } from './config';
import { mockEventLogRepository, supabaseEventLogRepository } from './events';
import { mockImportRepository, supabaseImportRepository } from './import';
import { mockInstagramQueueRepository, supabaseInstagramQueueRepository } from './instagram-queue';
import { supabaseSettingsRepository } from './settings';
import { mockPreSendRepository, supabasePreSendRepository } from './pre-send';
import { mockWhatsAppQueueRepository, supabaseWhatsAppQueueRepository } from './whatsapp-queue';
import { unavailableConfigRepository, unavailableSettingsRepository } from './strictUnavailable.repository';

const supabase = getSupabaseConfig();
const canUseSupabase = isSupabaseConfigured();

export const repositories = {
  config: canUseSupabase && supabase.useSupabaseConfig ? supabaseConfigRepository : unavailableConfigRepository,
  import: canUseSupabase && supabase.useSupabaseImport ? supabaseImportRepository : mockImportRepository,
  preSend: canUseSupabase && supabase.useSupabasePreSend ? supabasePreSendRepository : mockPreSendRepository,
  whatsappQueue: canUseSupabase && supabase.useSupabaseWhatsAppQueue ? supabaseWhatsAppQueueRepository : mockWhatsAppQueueRepository,
  instagramQueue: canUseSupabase && supabase.useSupabaseInstagramQueue ? supabaseInstagramQueueRepository : mockInstagramQueueRepository,
  base: canUseSupabase && supabase.useSupabaseBase ? supabaseBaseRepository : mockBaseRepository,
  settings: canUseSupabase && supabase.useSupabaseSettings ? supabaseSettingsRepository : unavailableSettingsRepository,
  events: canUseSupabase ? supabaseEventLogRepository : mockEventLogRepository,
};

export * from './config';
export * from './import';
export * from './pre-send';
export * from './whatsapp-queue';
export * from './instagram-queue';
export * from './base';
export * from './settings';
export * from './events';
export * from './lead-cycle';
