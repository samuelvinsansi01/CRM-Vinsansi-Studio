import {
  emptyBaseRepository,
  emptyConfigRepository,
  emptyEventLogRepository,
  emptyImportRepository,
  emptyInstagramQueueRepository,
  emptyPreSendRepository,
  emptySettingsRepository,
  emptyWhatsAppQueueRepository,
} from './empty.repositories';

export const repositories = {
  config: emptyConfigRepository,
  import: emptyImportRepository,
  preSend: emptyPreSendRepository,
  whatsappQueue: emptyWhatsAppQueueRepository,
  instagramQueue: emptyInstagramQueueRepository,
  base: emptyBaseRepository,
  settings: emptySettingsRepository,
  events: emptyEventLogRepository,
};

export * from './base/base.repository';
export * from './config/config.repository';
export * from './events/eventLog.repository';
export * from './import/import.repository';
export * from './instagram-queue/instagramQueue.repository';
export * from './pre-send/preSend.repository';
export * from './settings/settings.repository';
export * from './whatsapp-queue/whatsappQueue.repository';
