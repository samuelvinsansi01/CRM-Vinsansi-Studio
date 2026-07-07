import { getSupabaseClient, getSupabaseConfig } from '../../lib/supabase';
import { branchIdOrNull } from '../../services/config/branchIdentity';
import { normalizePhone } from '../../services/import/importValidation';
import { normalizeInstagramUsername } from '../../services/instagram/instagram.utils';
import { isStatusGroup, normalizeWhatsAppQueueStatus } from '../../services/status/status.mapper';
import { hasWhatsAppOperationalIssue, hasWhatsAppWorkerContract, isSanitizedLegacyWhatsAppItem } from '../../services/whatsapp-queue/whatsappQueue.guards';
import type {
  CreateWhatsAppQueueLeadInput,
  UpdateWhatsAppQueueLeadInput,
  WhatsAppQueueBatch,
  WhatsAppQueueFilters,
  WhatsAppQueueLead,
  WhatsAppQueueStatus,
  WhatsAppQueueSummary,
} from '../../services/whatsapp-queue/types';
import { createUuid, getCurrentUserId, nowIso, todayIsoDate } from '../supabase.helpers';
import type { WhatsAppQueueRepository } from './whatsappQueue.repository';

function table() {
  return getSupabaseConfig().tables.whatsappQueueItems;
}

function uuidOrNull(value: unknown) {
  const text = String(value ?? '');
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text) ? text : null;
}

function rowToLead(row: Record<string, unknown>): WhatsAppQueueLead {
  const data = (row.data && typeof row.data === 'object' ? row.data : row.raw_payload && typeof row.raw_payload === 'object' ? row.raw_payload : {}) as Partial<WhatsAppQueueLead>;
  const chipInstance = String(row.chip_instance ?? data.chip_instance ?? data.chip ?? '');
  const chipLabel = String(row.chip_label ?? data.chip_label ?? chipInstance);
  const chip = chipInstance;
  const batchId = String(row.batch_id ?? data.batch_id ?? `wa-batch-${chip}-${row.scheduled_date ?? todayIsoDate()}`);
  const batchNumber = Number(row.batch_number ?? data.batch_number ?? 1);
  const position = Number(row.position ?? data.position ?? 1);
  const phone = String(row.phone ?? data.phone ?? '');
  const instagram = String(row.instagram_url ?? data.instagram_url ?? data.instagram ?? '');
  return {
    ...data,
    ...(row.block_size ? { block_size: Number(row.block_size) } : {}),
    ...(row.batch_limit ? { batch_limit: Number(row.batch_limit) } : {}),
    id: String(row.id),
    lead_id: String(row.lead_id ?? data.lead_id ?? data.sourcePreSendId ?? row.id),
    sourcePreSendId: String(data.sourcePreSendId ?? row.lead_id ?? ''),
    order: position,
    position,
    company: String(row.company_name ?? data.company ?? ''),
    company_name: String(row.company_name ?? data.company_name ?? data.company ?? ''),
    channel: 'whatsapp',
    phone,
    phone_normalized: String(row.phone_normalized ?? row.normalized_phone ?? data.phone_normalized ?? normalizePhone(phone)),
    branch: String(row.parent_category ?? data.branch ?? ''),
    branch_id: String(row.branch_id ?? data.branch_id ?? ''),
    branch_slug: String(row.branch_slug ?? data.branch_slug ?? ''),
    type: (row.lead_type ?? data.type ?? 'Sem site') as WhatsAppQueueLead['type'],
    status: normalizeWhatsAppQueueStatus(row.status ?? data.status ?? 'queued') as WhatsAppQueueStatus,
    batchId,
    batch_id: batchId,
    batch_number: batchNumber,
    chip,
    chip_instance: chipInstance,
    chip_label: chipLabel,
    chip_id: String(row.chip_id ?? data.chip_id ?? ''),
    scheduled_date: String(row.scheduled_date ?? data.scheduled_date ?? todayIsoDate()),
    template_id: String(row.template_id ?? data.template_id ?? ''),
    message1: String(row.message_1 ?? data.message1 ?? data.message_1 ?? ''),
    message_1: String(row.message_1 ?? data.message_1 ?? data.message1 ?? ''),
    message2: String(row.message_2 ?? data.message2 ?? data.message_2 ?? ''),
    message_2: String(row.message_2 ?? data.message_2 ?? data.message2 ?? ''),
    imageName: String(data.imageName ?? row.image_url ?? ''),
    image_url: String(row.image_url ?? data.image_url ?? ''),
    image_id: String(row.image_id ?? data.image_id ?? ''),
    city: data.city,
    state: data.state,
    site: data.site,
    instagram: String(data.instagram ?? instagram),
    instagram_url: instagram,
    instagram_username: String(row.instagram_username ?? data.instagram_username ?? normalizeInstagramUsername(instagram)),
    mapsUrl: data.mapsUrl,
    original_destination: data.original_destination,
    destination_override: data.destination_override,
    send_instagram: data.send_instagram ?? false,
    instagram_override_reason: data.instagram_override_reason,
    override_by: data.override_by,
    override_at: data.override_at,
    retry_count: Number(row.retry_count ?? data.retry_count ?? row.validation_attempts ?? 0),
    error_message: String(row.error_message ?? row.validation_error ?? data.error_message ?? ''),
    invalid_reason: String(row.invalid_reason ?? data.invalid_reason ?? ''),
    notes: String(row.notes ?? data.notes ?? ''),
    sent_at: String(row.sent_at ?? data.sent_at ?? ''),
    created_at: String(row.created_at ?? data.created_at ?? nowIso()),
    updated_at: String(row.updated_at ?? data.updated_at ?? nowIso()),
  };
}

function isDeletedRow(row: Record<string, unknown>) {
  const data = (row.data && typeof row.data === 'object' ? row.data : row.raw_payload && typeof row.raw_payload === 'object' ? row.raw_payload : {}) as Partial<WhatsAppQueueLead>;
  return isStatusGroup(row.status ?? data.status, 'deleted');
}

async function allLeads() {
  const { data, error } = await getSupabaseClient().from(table()).select('*');
  if (error) throw new Error(error.message);
  return (data ?? []).filter((row) => !isDeletedRow(row)).map((row) => rowToLead(row)).filter((lead) => !isSanitizedLegacyWhatsAppItem(lead));
}

function calculateSummary(leads: WhatsAppQueueLead[]): WhatsAppQueueSummary {
  return {
    total: leads.length,
    queued: leads.filter((lead) => (isStatusGroup(lead.status, 'queued') || isStatusGroup(lead.status, 'paused')) && hasWhatsAppWorkerContract(lead)).length,
    sent: leads.filter((lead) => isStatusGroup(lead.status, 'sent')).length,
    finished: leads.filter((lead) => isStatusGroup(lead.status, 'sent') || isStatusGroup(lead.status, 'invalid')).length,
    errors: leads.filter((lead) => isStatusGroup(lead.status, 'error') || hasWhatsAppOperationalIssue(lead)).length,
  };
}

function applySearch(batch: WhatsAppQueueBatch, search?: string): WhatsAppQueueBatch {
  const query = search?.trim().toLowerCase() ?? '';
  if (!query) return batch;
  return {
    ...batch,
    leads: batch.leads.filter((lead) => `${lead.company} ${lead.phone} ${lead.branch} ${lead.type} ${lead.status}`.toLowerCase().includes(query)),
  };
}

function inferBatchLimit(leads: WhatsAppQueueLead[], fallback = 30) {
  const configured = leads
    .map((lead) => {
      const record = lead as WhatsAppQueueLead & { batchLimit?: unknown; batch_limit?: unknown; blockSize?: unknown; block_size?: unknown };
      return Number(record.batchLimit ?? record.batch_limit ?? record.blockSize ?? record.block_size ?? 0);
    })
    .find((value) => Number.isFinite(value) && value > 0);

  return configured ?? fallback;
}

function leadSortKey(lead: WhatsAppQueueLead) {
  return `${lead.scheduled_date}:${String(lead.batch_number).padStart(6, '0')}:${String(lead.position).padStart(6, '0')}:${lead.created_at}:${lead.id}`;
}

function groupBatches(leads: WhatsAppQueueLead[], defaultLimit = 30): WhatsAppQueueBatch[] {
  const groups = new Map<string, WhatsAppQueueLead[]>();

  for (const lead of leads) {
    const key = `${lead.chip}:${lead.scheduled_date}`;
    groups.set(key, [...(groups.get(key) ?? []), lead]);
  }

  return Array.from(groups.entries())
    .flatMap(([key, groupLeads]) => {
      const [chip, scheduledDate] = key.split(':');
      const sorted = [...groupLeads].sort((a, b) => leadSortKey(a).localeCompare(leadSortKey(b)));
      const limit = inferBatchLimit(sorted, defaultLimit);
      const batches: WhatsAppQueueBatch[] = [];

      for (let index = 0; index < sorted.length; index += limit) {
        const number = Math.floor(index / limit) + 1;
        batches.push({
          id: `wa-batch-${chip}-${scheduledDate}-${number}`,
          number,
          chip,
          limit,
          leads: sorted.slice(index, index + limit),
        });
      }

      return batches;
    })
    .sort((a, b) => a.chip.localeCompare(b.chip) || a.number - b.number);
}

function nextBatch(leads: WhatsAppQueueLead[], chip: string, limit: number, scheduledDate: string) {
  const chipBatches = groupBatches(leads.filter((lead) => lead.scheduled_date === scheduledDate), limit)
    .filter((batch) => batch.chip === chip)
    .sort((a, b) => a.number - b.number);
  const openBatch = chipBatches.find((batch) => batch.leads.length < limit);
  if (openBatch) return openBatch;
  const number = chipBatches.length ? Math.max(...chipBatches.map((batch) => batch.number)) + 1 : 1;
  return { id: `wa-batch-${chip}-${scheduledDate}-${number}`, number, chip, limit, leads: [] };
}

function buildLead(input: CreateWhatsAppQueueLeadInput, batch: WhatsAppQueueBatch): WhatsAppQueueLead {
  const id = createUuid();
  const timestamp = nowIso();
  return {
    ...input,
    id,
    lead_id: input.lead_id ?? input.sourcePreSendId ?? id,
    order: batch.leads.length + 1,
    position: batch.leads.length + 1,
    company_name: input.company,
    channel: 'whatsapp',
    phone_normalized: normalizePhone(input.phone),
    branch_id: input.branch_id,
    branch_slug: input.branch_slug,
    batchId: batch.id,
    batch_id: batch.id,
    batch_number: batch.number,
    chip_id: input.chip_id ?? input.chip,
    profile_id: undefined,
    scheduled_date: input.scheduled_date ?? todayIsoDate(),
    template_id: input.template_id ?? '',
    message_1: input.message1,
    message_2: input.message2,
    image_url: input.image_url ?? input.imageName,
    image_id: input.image_id,
    instagram_username: normalizeInstagramUsername(input.instagram_url ?? input.instagram),
    retry_count: 0,
    error_message: '',
    sent_at: '',
    created_at: timestamp,
    updated_at: timestamp,
  };
}

function dbPayload(lead: WhatsAppQueueLead, userId: string) {
  const chipInstance = lead.chip_instance || lead.chip;
  const chipLabel = lead.chip_label || chipInstance;
  return {
    id: lead.id,
    user_id: userId,
    lead_id: lead.lead_id,
    source_pre_send_id: lead.sourcePreSendId ?? null,
    scheduled_date: lead.scheduled_date,
    status: lead.status,
    position: lead.position,
    chip_instance: chipInstance,
    chip_label: chipLabel,
    lead_type: lead.type,
    notes: lead.imageName ?? '',
    raw_payload: lead,
    validation_attempts: lead.retry_count,
    validation_error: lead.error_message || null,
    validation_status: lead.status,
    data: lead,
    active: true,
    kind: 'whatsapp_queue',
    channel: 'whatsapp',
    batch_id: lead.batch_id,
    batch_number: lead.batch_number,
    company_name: lead.company_name,
    phone: lead.phone,
    normalized_phone: lead.phone_normalized,
    phone_normalized: lead.phone_normalized,
    branch_id: branchIdOrNull(lead.branch_id),
    branch_name: lead.branch,
    branch_slug: lead.branch_slug,
    parent_category: lead.branch,
    destination: lead.type,
    original_destination: lead.original_destination,
    destination_override: lead.destination_override,
    send_instagram: lead.send_instagram,
    instagram_url: lead.instagram_url,
    instagram_username: lead.instagram_username,
    instagram_override_reason: lead.instagram_override_reason,
    override_by: lead.override_by,
    override_at: lead.override_at || null,
    chip_id: uuidOrNull(lead.chip_id),
    template_id: uuidOrNull(lead.template_id),
    message_1: lead.message_1,
    message_2: lead.message_2,
    image_url: lead.image_url,
    image_id: lead.image_id,
    retry_count: lead.retry_count,
    error_message: lead.error_message,
    sent_at: lead.sent_at || null,
    updated_at: nowIso(),
  };
}

async function updateStatus(ids: string[], status: WhatsAppQueueStatus, errorMessage = '') {
  const leads = await allLeads();
  const timestamp = nowIso();
  const userId = await getCurrentUserId();
  await Promise.all(ids.map(async (id) => {
    const lead = leads.find((item) => item.id === id);
    if (!lead) return;
    const updated: WhatsAppQueueLead = {
      ...lead,
      status,
      error_message: errorMessage || (status === 'error' ? lead.error_message : ''),
      sent_at: status === 'sent' ? timestamp : lead.sent_at,
      retry_count: status === 'queued' ? lead.retry_count + 1 : lead.retry_count,
      updated_at: timestamp,
    };
    const { error } = await getSupabaseClient().from(table()).update(dbPayload(updated, userId)).eq('id', id);
    if (error) throw new Error(error.message);
  }));
}

export const supabaseWhatsAppQueueRepository: WhatsAppQueueRepository = {
  async listChips() {
    return Array.from(new Set((await allLeads()).map((lead) => lead.chip).filter(Boolean)));
  },

  async listBatches(filters) {
    const scoped = (await allLeads()).filter((lead) =>
      (!filters.chip || lead.chip === filters.chip) &&
      (!filters.scheduledDate || lead.scheduled_date === filters.scheduledDate),
    );
    return groupBatches(scoped).map((batch) => applySearch(batch, filters.search));
  },

  async summary(filters: WhatsAppQueueFilters = {}) {
    const scoped = (await allLeads()).filter((lead) =>
      (!filters.chip || lead.chip === filters.chip) &&
      (!filters.scheduledDate || lead.scheduled_date === filters.scheduledDate),
    );
    return calculateSummary(scoped);
  },

  async enqueue(inputLeads) {
    const persisted = await allLeads();
    const existingSources = new Set(persisted.map((lead) => lead.sourcePreSendId).filter(Boolean));
    const existingPhones = new Set(persisted.map((lead) => lead.phone_normalized || normalizePhone(lead.phone)).filter(Boolean));
    const working = [...persisted];
    const userId = await getCurrentUserId();

    for (const input of inputLeads) {
      const normalizedPhone = normalizePhone(input.phone);
      if (input.sourcePreSendId && existingSources.has(input.sourcePreSendId)) continue;
      if (normalizedPhone && existingPhones.has(normalizedPhone)) continue;

      const limit = input.batchLimit ?? 30;
      const scheduledDate = input.scheduled_date ?? todayIsoDate();
      const batch = nextBatch(working, input.chip, limit, scheduledDate);
      const lead = buildLead(input, batch);
      // The legacy database may expose source_pre_send_id only through a partial
      // unique index. PostgREST cannot use a partial index as an ON CONFLICT
      // target, which made a valid WhatsApp queue allocation fail before the
      // item was created. Duplicates are guarded above from the persisted queue
      // snapshot, so this path can use a regular insert and remain idempotent
      // for normal panel actions.
      const { error } = await getSupabaseClient().from(table()).insert({ ...dbPayload(lead, userId), created_at: lead.created_at });
      if (error) throw new Error(error.message);
      working.push(lead);
      if (lead.sourcePreSendId) existingSources.add(lead.sourcePreSendId);
      if (lead.phone_normalized) existingPhones.add(lead.phone_normalized);
    }
  },

  async updateLead(id: string, input: UpdateWhatsAppQueueLeadInput) {
    const lead = (await allLeads()).find((item) => item.id === id);
    if (!lead) throw new Error('Lead nao encontrado na fila.');
    const updated: WhatsAppQueueLead = {
      ...lead,
      ...input,
      message_1: input.message1 ?? lead.message_1,
      message_2: input.message2 ?? lead.message_2,
      image_url: input.image_url ?? input.imageName ?? lead.image_url,
      phone_normalized: input.phone ? normalizePhone(input.phone) : lead.phone_normalized,
      instagram_username: input.instagram_url || input.instagram ? normalizeInstagramUsername(input.instagram_url ?? input.instagram) : lead.instagram_username,
      updated_at: nowIso(),
    };
    const { error } = await getSupabaseClient().from(table()).update(dbPayload(updated, await getCurrentUserId())).eq('id', id);
    if (error) throw new Error(error.message);
    return updated;
  },

  async send(ids) {
    await updateStatus(ids, 'sent');
  },

  async pause(ids) {
    await updateStatus(ids, 'paused');
  },

  async resume(ids) {
    await updateStatus(ids, 'queued');
  },

  async reprocess(ids) {
    await updateStatus(ids, 'queued');
  },

  async invalidate(id) {
    await updateStatus([id], 'invalid');
  },
};
