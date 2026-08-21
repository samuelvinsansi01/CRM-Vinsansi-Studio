import { repositories } from '../../repositories';
import { chipLevelDefaults } from '../config/chipOperational';
import type { ChipConfigRecord, ConfigRecord, InstagramConfigRecord, TemplateConfigRecord } from '../config/types';
import type { ExtensionRuntimeConfig } from './types';

function isChip(record: ConfigRecord): record is ChipConfigRecord {
  return record.kind === 'chips';
}

function isInstagramProfile(record: ConfigRecord): record is InstagramConfigRecord {
  return record.kind === 'instagram';
}

function isTemplate(record: ConfigRecord): record is TemplateConfigRecord {
  return record.kind === 'templates';
}

function isOperationalStatus(record: ConfigRecord) {
  return record.active && record.status !== 'Arquivado' && record.status !== 'deleted';
}

export const platformConfigService = {
  async buildExtensionRuntimeConfig(): Promise<ExtensionRuntimeConfig> {
    const [dispatch, instagramRecords, chipRecords, templateRecords] = await Promise.all([
      repositories.settings.getDispatchSettings(),
      repositories.config.list('instagram'),
      repositories.config.list('chips'),
      repositories.config.list('templates'),
    ]);

    const profiles = instagramRecords
      .filter(isInstagramProfile)
      .filter(isOperationalStatus)
      .filter((profile) => profile.username.trim())
      .map((profile) => ({
        id: profile.id,
        name: profile.name,
        username: profile.username,
        active: profile.active,
        status: profile.status,
      }));

    const chips = chipRecords
      .filter(isChip)
      .filter(isOperationalStatus)
      .map((chip) => {
        const preset = chipLevelDefaults(chip.level, dispatch.chipLevels);
        return {
          id: chip.id,
          name: chip.name,
          instance: chip.instance,
          number: chip.number,
          active: chip.active,
          status: chip.status,
          connectionStatus: chip.connectionStatus,
          dailyLimit: preset.dailyLimit,
          blockSize: preset.blockSize,
          intervalSeconds: preset.intervalSeconds,
          batches: preset.batches,
        };
      });

    const templates = templateRecords
      .filter(isTemplate)
      .filter(isOperationalStatus)
      .filter((template) => template.channel === 'Instagram' || template.channel === 'Geral')
      .map((template) => ({
        id: template.id,
        branchId: template.branchId,
        branchName: template.branchName,
        channel: template.channel,
        type: template.type,
        message1: template.message1,
        message2: template.message2,
        message3: template.message3,
        message4: template.message4,
        active: template.active,
      }));

    return {
      version: 1,
      source: 'platform',
      generatedAt: new Date().toISOString(),
      instagram: {
        queueContract: {
          table: 'queue_items',
          profileField: 'socials_id',
          scheduledDateField: 'queue_items_scheduled_at',
          statusField: 'status_id',
          blockField: 'queues_id',
          orderBy: ['queues_id', 'queue_items_position'],
          readableStatuses: ['queued', 'ready_to_dispatch', 'scheduled'],
        },
        dispatch: dispatch.instagram,
        profiles,
        templates,
      },
      whatsapp: {
        dispatch: dispatch.whatsapp,
        chips,
      },
    };
  },

  async publishExtensionRuntimeConfig() {
    // Bridge read-through da Etapa 3: o shape legado e sempre gerado a partir
    // das configuracoes canonicas e dos recursos atuais. Nao persiste blob derivado.
    return this.buildExtensionRuntimeConfig();
  },

  async getExtensionRuntimeConfig() {
    return this.buildExtensionRuntimeConfig();
  },
};
