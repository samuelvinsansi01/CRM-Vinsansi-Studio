import type { ConfigRepository } from './config/config.repository';
import type { SettingsRepository } from './settings/settings.repository';

function unavailable(scope: string): never {
  throw new Error(`${scope} exige conexao ativa com o Supabase. O modo mock foi removido deste fluxo.`);
}

export const unavailableConfigRepository: ConfigRepository = {
  list: async () => unavailable('Configuracoes operacionais'),
  create: async () => unavailable('Configuracoes operacionais'),
  update: async () => unavailable('Configuracoes operacionais'),
  remove: async () => unavailable('Configuracoes operacionais'),
  toggleArchive: async () => unavailable('Configuracoes operacionais'),
};

export const unavailableSettingsRepository: SettingsRepository = {
  getImportSettings: async () => unavailable('Configuracoes de importacao'),
  updateImportSettings: async () => unavailable('Configuracoes de importacao'),
  resetImportSettings: async () => unavailable('Configuracoes de importacao'),
  getDispatchSettings: async () => unavailable('Configuracoes de disparo'),
  updateDispatchSettings: async () => unavailable('Configuracoes de disparo'),
  resetDispatchSettings: async () => unavailable('Configuracoes de disparo'),
  getExtensionRuntimeConfig: async () => unavailable('Configuracao da extensao'),
  updateExtensionRuntimeConfig: async () => unavailable('Configuracao da extensao'),
};
