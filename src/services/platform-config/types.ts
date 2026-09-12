import type { DispatchSettings } from '../settings/types';

export type ExtensionRuntimeConfig = {
  version: 1;
  source: 'platform';
  generatedAt: string;
  instagram: {
    queueContract: {
      table: 'queue_items';
      profileField: 'socials_id';
      scheduledDateField: 'queue_items_scheduled_at';
      statusField: 'status_id';
      blockField: 'queues_id';
      orderBy: ['queues_id', 'queue_items_position'];
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
      message3: string;
      message4: string;
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
