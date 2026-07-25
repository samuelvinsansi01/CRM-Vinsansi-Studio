import type { InstagramQueueRepository } from './instagramQueue.repository';
import type {
  CreateInstagramQueueLeadInput,
  InstagramQueueBatch,
  InstagramQueueFilters,
  InstagramQueueLead,
  InstagramQueueStatus,
  InstagramQueueSummary,
  UpdateInstagramQueueLeadInput,
} from '../../services/instagram-queue/types';
import { normalizeInstagramUsername } from '../../services/instagram/instagram.utils';
import { isStatusGroup } from '../../services/status/status.mapper';
import { toLocalDateInputValue } from '../../utils/date';

let batches: InstagramQueueBatch[] = [];

const delay = async () => new Promise((resolve) => setTimeout(resolve, 120));

function allLeads() {
  return batches.flatMap((batch) => batch.leads);
}

function applySearch(batch: InstagramQueueBatch, search?: string): InstagramQueueBatch {
  const query = search?.trim().toLowerCase() ?? '';
  if (!query) return batch;

  return {
    ...batch,
    leads: batch.leads.filter((lead) => `${lead.company} ${lead.instagram} ${lead.branch} ${lead.type} ${lead.status}`.toLowerCase().includes(query)),
  };
}

function groupForDisplay(leads: InstagramQueueLead[], limit: number): InstagramQueueBatch[] {
  const grouped = new Map<string, InstagramQueueLead[]>();

  leads.forEach((lead) => {
    const key = `${lead.profile}:${lead.scheduled_date}`;
    grouped.set(key, [...(grouped.get(key) ?? []), lead]);
  });

  return Array.from(grouped.entries()).flatMap(([key, groupLeads]) => {
    const [profile, scheduledDate] = key.split(':');
    const sorted = [...groupLeads].sort((a, b) =>
      `${a.scheduled_date}:${String(a.batch_number).padStart(6, '0')}:${String(a.position).padStart(6, '0')}:${a.created_at}`.localeCompare(
        `${b.scheduled_date}:${String(b.batch_number).padStart(6, '0')}:${String(b.position).padStart(6, '0')}:${b.created_at}`,
      ),
    );

    const nextBatches: InstagramQueueBatch[] = [];
    for (let index = 0; index < sorted.length; index += limit) {
      const number = Math.floor(index / limit) + 1;
      nextBatches.push({
        id: `ig-batch-${profile}-${scheduledDate}-${number}`,
        number,
        profile,
        limit,
        leads: sorted.slice(index, index + limit),
      });
    }
    return nextBatches;
  });
}

function calculateSummary(leads: InstagramQueueLead[]): InstagramQueueSummary {
  return {
    total: leads.length,
    queued: leads.filter((lead) => isStatusGroup(lead.status, 'queued') || isStatusGroup(lead.status, 'paused')).length,
    sent: leads.filter((lead) => isStatusGroup(lead.status, 'sent')).length,
    errors: leads.filter((lead) => isStatusGroup(lead.status, 'error')).length,
    invalid: leads.filter((lead) => isStatusGroup(lead.status, 'invalid')).length,
  };
}

function setStatus(ids: string[], status: InstagramQueueStatus) {
  const now = new Date().toISOString();
  batches = batches.map((batch) => ({
    ...batch,
    leads: batch.leads.map((lead) => (ids.includes(lead.id) ? { ...lead, status, sent_at: status === 'sent' ? now : lead.sent_at, updated_at: now } : lead)),
  }));
}

function createLeadId() {
  return `ig-lead-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function nextBatch(profile: string, limit: number, scheduledDate: string) {
  const profileBatches = groupForDisplay(allLeads().filter((lead) => lead.profile === profile && lead.scheduled_date === scheduledDate), limit)
    .sort((a, b) => a.number - b.number);
  const openBatch = profileBatches.find((batch) => batch.leads.length < batch.limit);
  if (openBatch) return openBatch;

  const number = profileBatches.length ? Math.max(...profileBatches.map((batch) => batch.number)) + 1 : 1;
  const batch: InstagramQueueBatch = {
    id: `ig-batch-${profile}-${scheduledDate}-${number}`,
    number,
    profile,
    limit,
    leads: [],
  };
  batches.push(batch);
  return batch;
}

export const mockInstagramQueueRepository: InstagramQueueRepository = {
  async listProfiles() {
    await delay();
    return Array.from(new Set(batches.map((batch) => batch.profile)));
  },

  async listBatches(filters: InstagramQueueFilters) {
    await delay();
    const scoped = allLeads().filter((lead) =>
      (!filters.profile || lead.profile === filters.profile) &&
      (!filters.scheduledDate || lead.scheduled_date === filters.scheduledDate),
    );
    return groupForDisplay(scoped, 15).map((batch) => applySearch(batch, filters.search));
  },

  async summary(filters: InstagramQueueFilters = {}) {
    await delay();
    const scopedLeads = allLeads().filter((lead) =>
      (!filters.profile || lead.profile === filters.profile) &&
      (!filters.scheduledDate || lead.scheduled_date === filters.scheduledDate),
    );
    return calculateSummary(scopedLeads);
  },

  async enqueue(inputLeads: CreateInstagramQueueLeadInput[]) {
    await delay();
    const existingSources = new Set(allLeads().map((lead) => lead.sourcePreSendId).filter(Boolean));
    const existingInstagrams = new Set(allLeads().map((lead) => lead.instagram).filter(Boolean));

    for (const input of inputLeads) {
      if (input.sourcePreSendId && existingSources.has(input.sourcePreSendId)) continue;
      if (input.instagram && existingInstagrams.has(input.instagram)) continue;

      const limit = input.batchLimit ?? 15;
      const scheduledDate = input.scheduled_date ?? toLocalDateInputValue();
      const batch = nextBatch(input.profile, limit, scheduledDate);
      const id = createLeadId();
      const now = new Date().toISOString();
      const lead: InstagramQueueLead = {
        ...input,
        id,
        lead_id: input.lead_id ?? '',
        order: batch.leads.length + 1,
        position: batch.leads.length + 1,
        company_name: input.company,
        channel: 'instagram',
        profile_id: input.profile,
        batchId: batch.id,
        batch_id: batch.id,
        batch_number: batch.number,
        chip_id: undefined,
        scheduled_date: scheduledDate,
        template_id: input.template_id ?? '',
        message_1: input.message1,
        message_2: input.message2,
        message3: input.message3,
        message_3: input.message3,
        message4: input.message4,
        message_4: input.message4,
        imageRequired: input.imageRequired ?? Boolean(input.imageName ?? input.image_url),
        image_url: input.image_url ?? input.imageName,
        image_id: input.image_id,
        instagram_username: normalizeInstagramUsername(input.instagram_url ?? input.instagram),
        retry_count: 0,
        error_message: '',
        sent_at: '',
        created_at: now,
        updated_at: now,
      };
      const storageBatch = batches.find((item) => item.id === batch.id) ?? { ...batch, leads: [] };
      if (!batches.some((item) => item.id === storageBatch.id)) batches.push(storageBatch);
      storageBatch.leads.push(lead);
      if (lead.sourcePreSendId) existingSources.add(lead.sourcePreSendId);
      if (lead.instagram) existingInstagrams.add(lead.instagram);
    }
  },

  async updateLead(id: string, input: UpdateInstagramQueueLeadInput) {
    await delay();
    let updated: InstagramQueueLead | null = null;

    batches = batches.map((batch) => ({
      ...batch,
      leads: batch.leads.map((lead) => {
        if (lead.id !== id) return lead;
        updated = {
          ...lead,
          ...input,
          message_1: input.message1 ?? lead.message_1,
          message_2: input.message2 ?? lead.message_2,
          message3: input.message3 ?? lead.message3,
          message_3: input.message3 ?? lead.message_3,
          message4: input.message4 ?? lead.message4,
          message_4: input.message4 ?? lead.message_4,
          imageRequired: input.imageRequired ?? lead.imageRequired,
          image_url: input.image_url ?? input.imageName ?? lead.image_url,
          instagram_username: input.instagram_url || input.instagram ? normalizeInstagramUsername(input.instagram_url ?? input.instagram) : lead.instagram_username,
          updated_at: new Date().toISOString(),
        };
        return updated;
      }),
    }));

    if (!updated) throw new Error('Lead não encontrado na fila Instagram.');
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
