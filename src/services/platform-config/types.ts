import type { DispatchSettings } from '../settings/types';

export type ExtensionRuntimeConfig = {
  version: 1;
  source: 'platform';
  generatedAt: string;
  instagram: {
    queueContract: {
      table: 'instagram_dispatch_items';
      profileField: 'profile_username';
      scheduledDateField: 'scheduled_date';
      statusField: 'status';
      blockField: 'block_number';
      orderBy: ['block_number', 'position'];
      readableStatuses: ['queued', 'ready_to_dispatch', 'scheduled'];
    };
    dispatch: DispatchSettings['instagram'];
    profiles: Array<{
      id: string;
      name: string;
      username: string;
      active: boolean;
      status: string;
    }>;
    templates: Array<{
      id: string;
      branchId: string;
      branchName: string;
      channel: string;
      type: string;
      message1: string;
      message2: string;
      active: boolean;
    }>;
  };
  whatsapp: {
    dispatch: DispatchSettings['whatsapp'];
    chips: Array<{
      id: string;
      name: string;
      instance: string;
      number: string;
      active: boolean;
      status: string;
      connectionStatus: string;
      dailyLimit: number;
      blockSize: number;
      intervalSeconds: number;
      batches: string[];
    }>;
  };
};
