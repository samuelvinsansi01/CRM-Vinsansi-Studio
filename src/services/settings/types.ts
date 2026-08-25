import type { ChipLevelPreset } from '../config/chipOperational';

export type ChipLevelPresetConfig = Partial<ChipLevelPreset>;

export type DispatchChannelSettings = {
  delayMinSeconds: number;
  delayMaxSeconds: number;
  perBatch: number;
  batches: number;
  batchDelayMinutes: number;
  dailyLimit: number;
  batchBehavior: string;
};

export type DispatchSettings = {
  whatsapp: DispatchChannelSettings;
  instagram: DispatchChannelSettings & {
    profile: string;
    profiles: string[];
    delayMinutes: number;
  };
  chipLevels: Record<string, ChipLevelPresetConfig>;
};

export type UpdateDispatchSettingsInput = Partial<{
  whatsapp: Partial<DispatchSettings['whatsapp']>;
  instagram: Partial<DispatchSettings['instagram']>;
  chipLevels: Partial<DispatchSettings['chipLevels']>;
}>;

export type WhatsAppDispatchSettings = DispatchChannelSettings;
export type InstagramDispatchSettings = DispatchChannelSettings & {
  profile: string;
  profiles: string[];
  delayMinutes: number;
};
