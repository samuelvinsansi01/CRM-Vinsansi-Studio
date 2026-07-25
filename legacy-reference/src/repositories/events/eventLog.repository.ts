export type EventLogInput = {
  source: string;
  action: string;
  channel?: 'whatsapp' | 'instagram';
  leadId?: string;
  queueItemId?: string;
  status?: string;
  message?: string;
  metadata?: Record<string, unknown>;
};

export type EventLogRecord = EventLogInput & {
  id: string;
  created_at: string;
  updated_at: string;
};

export type DispatchMessageLogInput = {
  leadId?: string;
  chipId?: string;
  instance?: string;
  phone?: string;
  normalizedPhone?: string;
  direction?: string;
  part: string;
  body?: string;
  status?: string;
  responsePayload?: Record<string, unknown>;
};

export interface EventLogRepository {
  append(input: EventLogInput): Promise<EventLogRecord>;
  appendDispatchMessageLog(input: DispatchMessageLogInput): Promise<void>;
  list(limit?: number): Promise<EventLogRecord[]>;
}
