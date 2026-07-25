import type { BaseRepository } from './base/base.repository';
import type { ConfigRepository } from './config/config.repository';
import type { EventLogRepository } from './events/eventLog.repository';
import type { ImportRepository } from './import/import.repository';
import type { InstagramQueueRepository } from './instagram-queue/instagramQueue.repository';
import type { PreSendRepository } from './pre-send/preSend.repository';
import type { SettingsRepository } from './settings/settings.repository';
import type { WhatsAppQueueRepository } from './whatsapp-queue/whatsappQueue.repository';
import { defaultImportSettings } from '../services/import-settings/importSettings.seed';
import { defaultDispatchSettings } from '../services/settings/settings.seed';

const unavailable = (action: string) => Promise.reject(new Error(`Ação "${action}" ainda não foi conectada ao banco novo.`));

export const emptyBaseRepository: BaseRepository = {
  list: async () => [],
  summary: async () => ({ total: 0, sent: 0, sentWhatsApp: 0, sentInstagram: 0, archived: 0, invalid: 0, errors: 0 }),
  options: async () => ({ origins: ['Todos'], branches: ['Todos'], states: ['Todos'], cities: ['Todos'], destinations: ['Todos'], statuses: ['Todos'] }),
  listSentIdentities: async () => ({ phones: [], sites: [], instagrams: [], mapsUrls: [] }),
  upsertSent: async () => unavailable('salvar contato'),
  update: async () => unavailable('atualizar contato'),
  setStatus: async () => unavailable('alterar status'),
  archive: async () => unavailable('arquivar contato'),
  restore: async () => unavailable('restaurar contato'),
  remove: async () => unavailable('excluir contato'),
};

export const emptyConfigRepository: ConfigRepository = {
  list: async () => [],
  create: async () => unavailable('criar configuração'),
  update: async () => unavailable('atualizar configuração'),
  remove: async () => unavailable('excluir configuração'),
  toggleArchive: async () => unavailable('arquivar configuração'),
};

export const emptyEventLogRepository: EventLogRepository = {
  append: async () => unavailable('registrar evento'),
  appendDispatchMessageLog: async () => undefined,
  list: async () => [],
};

export const emptyImportRepository: ImportRepository = {
  list: async () => [],
  summary: async () => ({ total: 0, pending: 0, approved: 0, rejected: 0, whatsapp: 0, ownSite: 0, aggregators: 0, instagram: 0 }),
  importFromJson: async () => unavailable('importar leads'),
  create: async () => unavailable('criar lead'),
  update: async () => unavailable('atualizar lead'),
  remove: async () => unavailable('excluir lead'),
  move: async () => unavailable('mover lead'),
};

const emptyWhatsAppQueueSummary = { total: 0, queued: 0, sent: 0, finished: 0, errors: 0 };
const emptyInstagramQueueSummary = { total: 0, queued: 0, sent: 0, errors: 0, invalid: 0 };
export const emptyWhatsAppQueueRepository: WhatsAppQueueRepository = {
  listChips: async () => [], listBatches: async () => [], summary: async () => emptyWhatsAppQueueSummary,
  enqueue: async () => unavailable('adicionar à fila'), updateLead: async () => unavailable('atualizar fila'),
  send: async () => unavailable('enviar'), pause: async () => unavailable('pausar'), resume: async () => unavailable('retomar'),
  reprocess: async () => unavailable('reprocessar'), invalidate: async () => unavailable('invalidar'),
};
export const emptyInstagramQueueRepository: InstagramQueueRepository = {
  listProfiles: async () => [], listBatches: async () => [], summary: async () => emptyInstagramQueueSummary,
  enqueue: async () => unavailable('adicionar à fila'), updateLead: async () => unavailable('atualizar fila'),
  send: async () => unavailable('enviar'), pause: async () => unavailable('pausar'), resume: async () => unavailable('retomar'),
  reprocess: async () => unavailable('reprocessar'), invalidate: async () => unavailable('invalidar'),
};

export const emptyPreSendRepository: PreSendRepository = {
  listDayCards: async () => [],
  summary: async () => ({ total: 0, whatsapp: 0, instagram: 0, queued: 0 }),
  listProfiles: async () => [], listLeads: async () => [], addLeads: async () => unavailable('adicionar leads'),
  moveToQueue: async () => unavailable('mover para fila'), markSent: async () => unavailable('marcar envio'),
  validateLead: async () => unavailable('validar lead'), archiveLead: async () => unavailable('arquivar lead'), updateLead: async () => unavailable('atualizar lead'),
};

export const emptySettingsRepository: SettingsRepository = {
  getImportSettings: async () => defaultImportSettings,
  updateImportSettings: async () => unavailable('salvar configurações de importação'),
  resetImportSettings: async () => defaultImportSettings,
  getDispatchSettings: async () => defaultDispatchSettings,
  updateDispatchSettings: async () => unavailable('salvar configurações de disparo'),
  resetDispatchSettings: async () => defaultDispatchSettings,
  getExtensionRuntimeConfig: async () => null,
  updateExtensionRuntimeConfig: async () => unavailable('salvar configuração da extensão'),
};
