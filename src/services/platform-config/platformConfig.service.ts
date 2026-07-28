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
          table: 'instagram_queue_items',
          profileField: 'profile_username',
          scheduledDateField: 'scheduled_date',
          statusField: 'status',
          blockField: 'block_number',
          orderBy: ['block_number', 'position'],
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
    const config = await this.buildExtensionRuntimeConfig();
    return repositories.settings.updateExtensionRuntimeConfig(config);
  },

  async getExtensionRuntimeConfig() {
    return repositories.settings.getExtensionRuntimeConfig();
  },
};
