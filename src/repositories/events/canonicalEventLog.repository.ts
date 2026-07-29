import { getSupabaseClient } from '../../lib/supabase';
import { channelId, currentUserIdNumber, queueStatusId } from '../schemaCatalog';
import { nowIso } from '../supabase.helpers';
import type { DispatchMessageLogInput, EventLogInput, EventLogRecord, EventLogRepository } from './eventLog.repository';

const STORAGE_KEY = 'painel.audit-events.v1';

function readLocal(): EventLogRecord[] {
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]') as EventLogRecord[];
  } catch {
    return [];
  }
}

function writeLocal(records: EventLogRecord[]) {
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records.slice(0, 1000))); } catch { /* sem espaco local */ }
}

export const canonicalEventLogRepository: EventLogRepository = {
  async append(input) {
    const timestamp = nowIso();
    const record: EventLogRecord = {
      id: crypto.randomUUID(),
      created_at: timestamp,
      updated_at: timestamp,
      ...input,
    };
    writeLocal([record, ...readLocal()]);
    return record;
  },
  async appendDispatchMessageLog(input: DispatchMessageLogInput) {
    const userId = await currentUserIdNumber();
    const channel = input.responsePayload?.channel === 'instagram' ? 'Instagram' : 'WhatsApp';
    const body = JSON.stringify({
      part: input.part,
      body: input.body ?? '',
      direction: input.direction ?? 'outbound',
      instance: input.instance ?? null,
      phone: input.phone ?? null,
      normalized_phone: input.normalizedPhone ?? null,
      response: input.responsePayload ?? {},
    });
    const { error } = await getSupabaseClient().from('sents').insert({
      users_id: userId,
      leads_id: input.leadId && /^\d+$/.test(input.leadId) ? Number(input.leadId) : null,
      channels_id: Number(await channelId(channel)),
      chips_id: input.chipId && /^\d+$/.test(input.chipId) ? Number(input.chipId) : null,
      status_id: await queueStatusId(input.status ?? 'sent'),
      sents_recipient: input.normalizedPhone || input.phone || null,
      sents_body: body,
      sents_attempt: 1,
      sents_error_message: input.status === 'error' ? String(input.responsePayload?.error ?? '') : null,
      sents_sent_at: input.status === 'sent' ? nowIso() : null,
    });
    if (error) throw new Error(`Nao foi possivel registrar o envio em sents: ${error.message}`);
  },
  async list(limit = 100) {
    return readLocal().slice(0, limit);
  },
};
