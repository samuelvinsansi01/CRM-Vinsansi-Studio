import type { WhatsAppQueueRepository } from './whatsappQueue.repository';
import type { CreateWhatsAppQueueLeadInput, UpdateWhatsAppQueueLeadInput, WhatsAppQueueBatch, WhatsAppQueueFilters, WhatsAppQueueLead, WhatsAppQueueStatus, WhatsAppQueueSummary } from '../../services/whatsapp-queue/types';
import { normalizePhone } from '../../services/import/importValidation';
import { normalizeInstagramUsername } from '../../services/instagram/instagram.utils';
import { isStatusGroup } from '../../services/status/status.mapper';
import { toLocalDateInputValue } from '../../utils/date';

let batches: WhatsAppQueueBatch[] = [];

const delay = async () => new Promise((resolve) => setTimeout(resolve, 120));

function allLeads() {
  return batches.flatMap((batch) => batch.leads);
}

function applySearch(batch: WhatsAppQueueBatch, search?: string): WhatsAppQueueBatch {
  const query = search?.trim().toLowerCase() ?? '';
  if (!query) return batch;

  return {
    ...batch,
    leads: batch.leads.filter((lead) => `${lead.company} ${lead.phone} ${lead.branch} ${lead.type} ${lead.status}`.toLowerCase().includes(query)),
  };
}

function groupForDisplay(leads: WhatsAppQueueLead[], limit: number): WhatsAppQueueBatch[] {
  const grouped = new Map<string, WhatsAppQueueLead[]>();

  leads.forEach((lead) => {
    const key = `${lead.chip}:${lead.scheduled_date}`;
    grouped.set(key, [...(grouped.get(key) ?? []), lead]);
  });

  return Array.from(grouped.entries()).flatMap(([key, groupLeads]) => {
    const [chip, scheduledDate] = key.split(':');
    const sorted = [...groupLeads].sort((a, b) =>
      `${a.scheduled_date}:${String(a.batch_number).padStart(6, '0')}:${String(a.position).padStart(6, '0')}:${a.created_at}`.localeCompare(
        `${b.scheduled_date}:${String(b.batch_number).padStart(6, '0')}:${String(b.position).padStart(6, '0')}:${b.created_at}`,
      ),
    );

    const nextBatches: WhatsAppQueueBatch[] = [];
    for (let index = 0; index < sorted.length; index += limit) {
      const number = Math.floor(index / limit) + 1;
      nextBatches.push({
        id: `wa-batch-${chip}-${scheduledDate}-${number}`,
        number,
        chip,
        limit,
        leads: sorted.slice(index, index + limit),
      });
    }
    return nextBatches;
  });
}

function calculateSummary(leads: WhatsAppQueueLead[]): WhatsAppQueueSummary {
  return {
    total: leads.length,
    queued: leads.filter((lead) => isStatusGroup(lead.status, 'queued') || isStatusGroup(lead.status, 'paused')).length,
    sent: leads.filter((lead) => isStatusGroup(lead.status, 'sent')).length,
    finished: leads.filter((lead) => isStatusGroup(lead.status, 'sent') || isStatusGroup(lead.status, 'invalid')).length,
    errors: leads.filter((lead) => isStatusGroup(lead.status, 'error')).length,
  };
}

function setStatus(ids: string[], status: WhatsAppQueueStatus) {
  const now = new Date().toISOString();
  batches = batches.map((batch) => ({
    ...batch,
    leads: batch.leads.map((lead) => (ids.includes(lead.id) ? { ...lead, status, sent_at: status === 'sent' ? now : lead.sent_at, updated_at: now } : lead)),
  }));
}

function createLeadId() {
  return `wa-lead-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function nextBatch(chip: string, limit: number, scheduledDate: string) {
  const chipBatches = groupForDisplay(allLeads().filter((lead) => lead.chip === chip && lead.scheduled_date === scheduledDate), limit)
    .sort((a, b) => a.number - b.number);
  const openBatch = chipBatches.find((batch) => batch.leads.length < batch.limit);
  if (openBatch) return openBatch;

  const number = chipBatches.length ? Math.max(...chipBatches.map((batch) => batch.number)) + 1 : 1;
  const batch: WhatsAppQueueBatch = {
    id: `wa-batch-${chip}-${scheduledDate}-${number}`,
    number,
    chip,
    limit,
    leads: [],
  };
  batches.push(batch);
  return batch;
}

export const mockWhatsAppQueueRepository: WhatsAppQueueRepository = {
  async listChips() {
    await delay();
    return Array.from(new Set(batches.map((batch) => batch.chip)));
  },

  async listBatches(filters: WhatsAppQueueFilters) {
    await delay();
    const scoped = allLeads().filter((lead) =>
      (!filters.chip || lead.chip === filters.chip) &&
      (!filters.scheduledDate || lead.scheduled_date === filters.scheduledDate),
    );
    return groupForDisplay(scoped, 30).map((batch) => applySearch(batch, filters.search));
  },

  async summary(filters: WhatsAppQueueFilters = {}) {
    await delay();
    const scopedLeads = allLeads().filter((lead) =>
      (!filters.chip || lead.chip === filters.chip) &&
      (!filters.scheduledDate || lead.scheduled_date === filters.scheduledDate),
    );
    return calculateSummary(scopedLeads);
  },

  async enqueue(inputLeads: CreateWhatsAppQueueLeadInput[]) {
    await delay();
    const existingSources = new Set(allLeads().map((lead) => lead.sourcePreSendId).filter(Boolean));
    const existingPhones = new Set(allLeads().map((lead) => lead.phone).filter(Boolean));

    for (const input of inputLeads) {
      if (input.sourcePreSendId && existingSources.has(input.sourcePreSendId)) continue;
      if (input.phone && existingPhones.has(input.phone)) continue;

      const limit = input.batchLimit ?? 30;
      const scheduledDate = input.scheduled_date ?? toLocalDateInputValue();
      const batch = nextBatch(input.chip, limit, scheduledDate);
      const id = createLeadId();
      const now = new Date().toISOString();
      const lead: WhatsAppQueueLead = {
        ...input,
        id,
        lead_id: input.sourcePreSendId ?? id,
        order: batch.leads.length + 1,
        position: batch.leads.length + 1,
        company_name: input.company,
        channel: 'whatsapp',
        phone_normalized: normalizePhone(input.phone),
        batchId: batch.id,
        batch_id: batch.id,
        batch_number: batch.number,
        chip_id: input.chip,
        profile_id: undefined,
        scheduled_date: scheduledDate,
        template_id: input.template_id ?? '',
        message_1: input.message1,
        message_2: input.message2,
        image_url: input.image_url ?? input.imageName,
        image_id: input.image_id,
        instagram_username: normalizeInstagramUsername(input.instagram_url ?? input.instagram),
        retry_count: 0,
        error_message: '',
        sent_at: '',
        created_at: now,
        updated_at: now,
      };
      delete (lead as { batchLimit?: number }).batchLimit;
      const storageBatch = batches.find((item) => item.id === batch.id) ?? { ...batch, leads: [] };
      if (!batches.some((item) => item.id === storageBatch.id)) batches.push(storageBatch);
      storageBatch.leads.push(lead);
      if (lead.sourcePreSendId) existingSources.add(lead.sourcePreSendId);
      if (lead.phone) existingPhones.add(lead.phone);
    }
  },

  async updateLead(id: string, input: UpdateWhatsAppQueueLeadInput) {
    await delay();
    let updated: WhatsAppQueueLead | null = null;

    batches = batches.map((batch) => ({
      ...batch,
      leads: batch.leads.map((lead) => {
        if (lead.id !== id) return lead;
        updated = {
          ...lead,
          ...input,
          message_1: input.message1 ?? lead.message_1,
          message_2: input.message2 ?? lead.message_2,
          image_url: input.image_url ?? input.imageName ?? lead.image_url,
          phone_normalized: input.phone ? normalizePhone(input.phone) : lead.phone_normalized,
          instagram_username: input.instagram_url || input.instagram ? normalizeInstagramUsername(input.instagram_url ?? input.instagram) : lead.instagram_username,
          updated_at: new Date().toISOString(),
        };
        return updated;
      }),
    }));

    if (!updated) throw new Error('Lead não encontrado na fila.');
    return updated;
  },

  async send(ids: string[]) {
    await delay();
    setStatus(ids, 'sent');
  },

  async pause(ids: string[]) {
    await delay();
    setStatus(ids, 'paused');
  },

  async resume(ids: string[]) {
    await delay();
    setStatus(ids, 'queued');
  },

  async reprocess(ids: string[]) {
    await delay();
    setStatus(ids, 'queued');
  },

  async invalidate(id: string) {
    await delay();
    setStatus([id], 'invalid');
  },
};
