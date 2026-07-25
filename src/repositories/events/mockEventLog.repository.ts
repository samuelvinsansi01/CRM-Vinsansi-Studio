import { createId, nowIso } from '../supabase.helpers';
import type { EventLogInput, EventLogRecord, EventLogRepository } from './eventLog.repository';

let logs: EventLogRecord[] = [];

export const mockEventLogRepository: EventLogRepository = {
  async append(input: EventLogInput) {
    const timestamp = nowIso();
    const record: EventLogRecord = {
      id: createId('event'),
      created_at: timestamp,
      updated_at: timestamp,
      ...input,
    };
    logs = [record, ...logs];
    return record;
  },

  async appendDispatchMessageLog(input) {
    const timestamp = nowIso();
    logs = [
      {
        id: createId('dispatch-log'),
        created_at: timestamp,
        updated_at: timestamp,
        source: 'dispatch-message-logs',
        action: input.part,
        channel: 'whatsapp',
        leadId: input.leadId,
        status: input.status,
        message: input.body,
        metadata: input.responsePayload,
      },
      ...logs,
    ];
  },

  async list(limit = 100) {
    return logs.slice(0, limit);
  },
};
