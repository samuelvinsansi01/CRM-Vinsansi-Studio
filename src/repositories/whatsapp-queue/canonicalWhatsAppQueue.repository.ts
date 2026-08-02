import { getSupabaseClient } from '../../lib/supabase';
import type {
  CreateWhatsAppQueueLeadInput,
  UpdateWhatsAppQueueLeadInput,
  WhatsAppQueueBatch,
  WhatsAppQueueFilters,
  WhatsAppQueueLead,
} from '../../services/whatsapp-queue/types';
import { normalizePhone } from '../../services/import/importValidation';
import { currentUserIdNumber, queueStatusId } from '../schemaCatalog';
import { canonicalQueueStatus, dateOnly, loadCanonicalQueue, prepareQueueItems, updateQueueItemStatus } from '../queueSchema';
import { nowIso } from '../supabase.helpers';
import type { WhatsAppQueueRepository } from './whatsappQueue.repository';

type Row = Record<string, unknown>;

function mapLead(row: Awaited<ReturnType<typeof loadCanonicalQueue>>[number]): WhatsAppQueueLead {
  const item = row.item;
  const lead = row.lead;
  const template = row.template ?? {};
  const chip = row.chip ?? {};
  const instance = row.instance ?? {};
  const branch = row.branch ?? {};
  const queueId = String(item.queues_id ?? '');
  const position = Number(item.queue_items_position ?? 1);
  const scheduled = dateOnly(item.queue_items_scheduled_at ?? row.queue.queues_scheduled_at);
  const dailyLimit = 60;
  const batchNumber = Math.floor((position - 1) / dailyLimit) + 1;
  const phone = String(lead.leads_phone ?? '');
  const website = String(lead.leads_website ?? '');
  const status = canonicalQueueStatus(row) as WhatsAppQueueLead['status'];
  return {
    id: String(item.queue_items_id),
    lead_id: String(item.leads_id),
    order: position,
    position,
    company: String(lead.leads_name ?? ''),
    company_name: String(lead.leads_name ?? ''),
    channel: 'whatsapp',
    phone,
    phone_normalized: normalizePhone(phone),
    branch: String(branch.branches_name ?? ''),
    branch_id: String(lead.branches_id ?? ''),
    branch_slug: '',
    type: website ? 'Com site' : 'Sem site',
    original_destination: website ? 'Com site' : 'WhatsApp',
    status,
    batchId: queueId,
    batch_id: queueId,
    batch_number: batchNumber,
    chip: String(instance.instances_name ?? chip.chips_name ?? ''),
    chip_instance: String(instance.instances_name ?? ''),
    chip_label: String(chip.chips_name ?? instance.instances_name ?? ''),
    chip_id: String(item.chips_id ?? ''),
    scheduled_date: scheduled,
    template_id: String(item.templates_id ?? ''),
    message1: String(template.templates_message_1 ?? ''),
    message_1: String(template.templates_message_1 ?? ''),
    message2: String(template.templates_message_2 ?? ''),
    message_2: String(template.templates_message_2 ?? ''),
    message3: String(template.templates_message_3 ?? ''),
    message_3: String(template.templates_message_3 ?? ''),
    message4: String(template.templates_message_4 ?? ''),
    message_4: String(template.templates_message_4 ?? ''),
    imageName: '',
    imageRequired: false,
    image_url: '',
    image_id: '',
    site: website,
    instagram: String(lead.leads_instagram ?? ''),
    mapsUrl: String(lead.leads_maps ?? ''),
    retry_count: Number(item.queue_items_attempts ?? 0),
    error_message: String(item.queue_items_error_message ?? ''),
    sent_at: status === 'sent' ? String(item.queue_items_finished_at ?? '') : '',
    created_at: String(item.queue_items_created_at ?? ''),
    updated_at: String(item.queue_items_updated_at ?? ''),
  };
}

async function all(filters: WhatsAppQueueFilters = {}) {
  let leads = (await loadCanonicalQueue('WhatsApp')).map(mapLead);
  if (filters.chip) leads = leads.filter((lead) => lead.chip === filters.chip || lead.chip_instance === filters.chip || lead.chip_id === filters.chip);
  if (filters.scheduledDate) leads = leads.filter((lead) => lead.scheduled_date === filters.scheduledDate);
  if (filters.search) {
    const search = filters.search.toLowerCase();
    leads = leads.filter((lead) => `${lead.company} ${lead.phone} ${lead.branch} ${lead.status}`.toLowerCase().includes(search));
  }
  return leads;
}

function batches(leads: WhatsAppQueueLead[]): WhatsAppQueueBatch[] {
  const groups = new Map<string, WhatsAppQueueLead[]>();
  for (const lead of leads) groups.set(lead.batch_id, [...(groups.get(lead.batch_id) ?? []), lead]);
  return Array.from(groups.entries()).map(([id, items], index) => ({
    id,
    number: index + 1,
    chip: items[0]?.chip_instance || items[0]?.chip || '',
    limit: Math.max(items.length, 1),
    leads: items.sort((a, b) => a.position - b.position),
  }));
}

async function resolveChip(input: CreateWhatsAppQueueLeadInput) {
  const userId = await currentUserIdNumber();
  if (input.chip_id && /^\d+$/.test(input.chip_id)) return Number(input.chip_id);
  const response = await getSupabaseClient().from('chips').select('chips_id,instances_id,chips_name').eq('users_id', userId);
  if (response.error) throw new Error(response.error.message);
  const rows = (response.data ?? []) as Row[];
  const instances = await getSupabaseClient().from('instances').select('instances_id,instances_name').eq('users_id', userId);
  if (instances.error) throw new Error(instances.error.message);
  const instanceMap = new Map(((instances.data ?? []) as Row[]).map((row) => [String(row.instances_id), String(row.instances_name)]));
  const match = rows.find((row) => {
    const instance = instanceMap.get(String(row.instances_id));
    return [row.chips_name, instance].map(String).includes(String(input.chip_instance ?? input.chip));
  });
  if (!match) throw new Error('Chip selecionado nao encontrado na tabela chips.');
  return Number(match.chips_id);
}

export const canonicalWhatsAppQueueRepository: WhatsAppQueueRepository = {
  async listChips() {
    const userId = await currentUserIdNumber();
    const response = await getSupabaseClient().from('chips').select('chips_name').eq('users_id', userId);
    if (response.error) throw new Error(response.error.message);
    return ((response.data ?? []) as Row[]).map((row) => String(row.chips_name));
  },
  async listBatches(filters) {
    return batches(await all(filters));
  },
  async summary(filters = {}) {
    const leads = await all(filters);
    return {
      total: leads.length,
      queued: leads.filter((lead) => ['queued', 'paused', 'sending'].includes(lead.status)).length,
      sent: leads.filter((lead) => lead.status === 'sent').length,
      finished: leads.filter((lead) => ['sent', 'invalid'].includes(lead.status)).length,
      errors: leads.filter((lead) => lead.status === 'error').length,
    };
  },
  async enqueue(inputs) {
    const result: string[] = [];
    for (const input of inputs) {
      const chipId = await resolveChip(input);
      const scheduled = input.scheduled_date ?? new Date().toISOString().slice(0, 10);
      const [prepared] = await prepareQueueItems('WhatsApp', chipId, scheduled, [{
        leadId: input.lead_id,
        templateId: String(input.template_id ?? ''),
      }]);
      if (!prepared) throw new Error('A transação não retornou o resultado do lead.');
      if (prepared.outcome === 'queued' || prepared.outcome === 'reconciled') {
        if (prepared.queueItemId) result.push(prepared.queueItemId);
        continue;
      }
      if (prepared.outcome === 'conflict') continue;
      throw new Error(prepared.reason || 'Não foi possível incluir o lead na fila de WhatsApp.');
    }
    return result;
  },
  async removeQueued(id) {
    const userId = await currentUserIdNumber();
    const queuedId = await queueStatusId('queued');
    const response = await getSupabaseClient().from('queue_items').delete().eq('queue_items_id', Number(id)).eq('users_id', userId).eq('status_id', queuedId);
    if (response.error) throw new Error(response.error.message);
  },
  async updateLead(id, input: UpdateWhatsAppQueueLeadInput) {
    const userId = await currentUserIdNumber();
    const patch: Row = { queue_items_updated_at: nowIso() };
    if (input.status) patch.status_id = await queueStatusId(input.status);
    if (input.retry_count !== undefined) patch.queue_items_attempts = input.retry_count;
    if (input.error_message !== undefined) patch.queue_items_error_message = input.error_message;
    if (input.position !== undefined) patch.queue_items_position = input.position;
    if (input.scheduled_date) patch.queue_items_scheduled_at = `${input.scheduled_date}T12:00:00.000Z`;
    const response = await getSupabaseClient().from('queue_items').update(patch).eq('queue_items_id', Number(id)).eq('users_id', userId).select('queue_items_id').single();
    if (response.error) throw new Error(response.error.message);
    return response.data;
  },
  async send(ids) { await updateQueueItemStatus(ids, 'sent'); },
  async pause(ids) { await updateQueueItemStatus(ids, 'paused'); },
  async resume(ids) { await updateQueueItemStatus(ids, 'queued'); },
  async reprocess(ids) {
    const userId = await currentUserIdNumber();
    const response = await getSupabaseClient().from('queue_items').update({
      status_id: await queueStatusId('queued'),
      queue_items_error_message: null,
      queue_items_updated_at: nowIso(),
    }).eq('users_id', userId).in('queue_items_id', ids.map(Number));
    if (response.error) throw new Error(response.error.message);
  },
  async invalidate(id) { await updateQueueItemStatus([id], 'invalid'); },
};
