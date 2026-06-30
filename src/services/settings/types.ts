export type DispatchChannelSettings = {
  startTime: string;
  endTime: string;
  delayMinSeconds: number;
  delayMaxSeconds: number;
  perBatch: number;
  batches: number;
  batchDelayMinutes: number;
  dailyLimit: number;
  activeDays: string[];
  batchBehavior: string;
};

export type DispatchSettings = {
  whatsapp: DispatchChannelSettings;
  instagram: DispatchChannelSettings & {
    profile: string;
    profiles: string[];
    delayMinutes: number;
  };
};

export type UpdateDispatchSettingsInput = Partial<{
  whatsapp: Partial<DispatchSettings['whatsapp']>;
  instagram: Partial<DispatchSettings['instagram']>;
}>;
