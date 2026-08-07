import { getSupabaseClient } from '../../lib/supabase';
import type {
  CreateInstagramQueueLeadInput,
  InstagramQueueBatch,
  InstagramQueueFilters,
  InstagramQueueLead,
  UpdateInstagramQueueLeadInput,
} from '../../services/instagram-queue/types';
import { normalizeInstagramUsername } from '../../services/instagram/instagram.utils';
import { currentUserIdNumber, queueStatusId } from '../schemaCatalog';
import { canonicalQueueStatus, dateOnly, loadCanonicalQueue, prepareQueueItems, queuePayloadSnapshot, queueSnapshotMessage, queueSnapshotPart, updateQueueItemStatus } from '../queueSchema';
import { nowIso } from '../supabase.helpers';
import type { InstagramQueueRepository } from './instagramQueue.repository';

type Row = Record<string, unknown>;

function mapLead(row: Awaited<ReturnType<typeof loadCanonicalQueue>>[number]): InstagramQueueLead {
  const item = row.item;
  const lead = row.lead;
  const template = row.template ?? {};
  const social = row.social ?? {};
  const branch = row.branch ?? {};
  const snapshot = queuePayloadSnapshot(item.queue_items_payload_snapshot);
  const snapshotLead = queueSnapshotPart(snapshot, 'lead');
  const snapshotRecipient = queueSnapshotPart(snapshot, 'recipient');
  const snapshotMedia = queueSnapshotPart(snapshot, 'media');
  const position = Number(item.queue_items_position ?? 1);
  const queueId = String(item.queues_id ?? '');
  const scheduled = dateOnly(item.queue_items_scheduled_at ?? row.queue.queues_scheduled_at);
  const instagram = String(snapshotRecipient.instagram ?? snapshotLead.instagram ?? lead.leads_instagram ?? '');
  const username = normalizeInstagramUsername(instagram);
  const company = String(snapshotLead.company_name ?? lead.leads_name ?? '');
  const branchName = String(snapshotLead.branch_name ?? branch.branches_name ?? '');
  const phone = String(snapshotLead.phone ?? lead.leads_phone ?? '');
  const website = String(snapshotLead.site ?? lead.leads_website ?? '');
  const mapsUrl = String(snapshotLead.maps_url ?? lead.leads_maps ?? '');
  const status = canonicalQueueStatus(row) as InstagramQueueLead['status'];
  const message1 = queueSnapshotMessage(snapshot, 1) || String(template.templates_message_1 ?? '');
  const message2 = queueSnapshotMessage(snapshot, 2) || String(template.templates_message_2 ?? '');
  const message3 = queueSnapshotMessage(snapshot, 3) || String(template.templates_message_3 ?? '');
  const message4 = queueSnapshotMessage(snapshot, 4) || String(template.templates_message_4 ?? '');
  const imageName = String(snapshotMedia.name ?? '');
  const imageRequired = Boolean(snapshotMedia.required);
  return {
    id: String(item.queue_items_id),
    lead_id: String(item.leads_id),
    order: position,
    position,
    company,
    company_name: company,
    channel: 'instagram',
    instagram,
    profile: String(social.socials_username ?? ''),
    profile_id: String(item.socials_id ?? ''),
    branch: branchName,
    branch_id: String(snapshotLead.branch_id ?? lead.branches_id ?? ''),
    branch_slug: '',
    type: 'Instagram',
    original_destination: 'Instagram',
    send_instagram: true,
    instagram_url: instagram,
    instagram_username: username,
    status,
    batchId: queueId,
    batch_id: queueId,
    batch_number: 1,
    scheduled_date: scheduled,
    template_id: String(item.templates_id ?? ''),
    message1,
    message_1: message1,
    message2,
    message_2: message2,
    message3,
    message_3: message3,
    message4,
    message_4: message4,
    imageName,
    imageRequired,
    image_url: imageName,
    image_id: String(snapshotMedia.sha256 ?? ''),
    phone,
    site: website,
    mapsUrl,
    retry_count: Number(item.queue_items_attempts ?? 0),
    error_message: String(item.queue_items_error_message ?? ''),
    sent_at: status === 'sent' ? String(item.queue_items_finished_at ?? '') : '',
    created_at: String(item.queue_items_created_at ?? ''),
    updated_at: String(item.queue_items_updated_at ?? ''),
  };
}

async function all(filters: InstagramQueueFilters = {}) {
  let leads = (await loadCanonicalQueue('Instagram')).map(mapLead);
  if (filters.profile) leads = leads.filter((lead) => lead.profile === filters.profile || lead.profile_id === filters.profile);
  if (filters.scheduledDate) leads = leads.filter((lead) => lead.scheduled_date === filters.scheduledDate);
  if (filters.search) {
    const search = filters.search.toLowerCase();
    leads = leads.filter((lead) => `${lead.company} ${lead.instagram} ${lead.branch} ${lead.status}`.toLowerCase().includes(search));
  }
  return leads;
}

function batches(leads: InstagramQueueLead[]): InstagramQueueBatch[] {
  const groups = new Map<string, InstagramQueueLead[]>();
  for (const lead of leads) groups.set(lead.batch_id, [...(groups.get(lead.batch_id) ?? []), lead]);
  return Array.from(groups.entries()).map(([id, items], index) => ({
    id,
    number: index + 1,
    profile: items[0]?.profile ?? '',
    limit: Math.max(items.length, 1),
    leads: items.sort((a, b) => a.position - b.position),
  }));
}

async function resolveSocial(input: CreateInstagramQueueLeadInput) {
  const userId = await currentUserIdNumber();
  const response = await getSupabaseClient().from('socials').select('socials_id,socials_username').eq('users_id', userId);
  if (response.error) throw new Error(response.error.message);
  const profile = normalizeInstagramUsername(input.profile);
  const match = ((response.data ?? []) as Row[]).find((row) => normalizeInstagramUsername(String(row.socials_username)) === profile || String(row.socials_id) === String(input.profile));
  if (!match) throw new Error('Perfil selecionado nao encontrado na tabela socials.');
  return Number(match.socials_id);
}

export const canonicalInstagramQueueRepository: InstagramQueueRepository = {
  async listProfiles() {
    const userId = await currentUserIdNumber();
    const response = await getSupabaseClient().from('socials').select('socials_username').eq('users_id', userId);
    if (response.error) throw new Error(response.error.message);
    return ((response.data ?? []) as Row[]).map((row) => normalizeInstagramUsername(String(row.socials_username)));
  },
  async listBatches(filters) {
    return batches(await all(filters));
  },
  async summary(filters = {}) {
    const leads = await all(filters);
    return {
      total: leads.length,
      queued: leads.filter((lead) => ['queued', 'paused', 'following', 'dm_opened'].includes(lead.status)).length,
      sent: leads.filter((lead) => lead.status === 'sent').length,
      errors: leads.filter((lead) => lead.status === 'error').length,
      invalid: leads.filter((lead) => lead.status === 'invalid').length,
    };
  },
  async enqueue(inputs) {
    const result: string[] = [];
    for (const input of inputs) {
      const socialId = await resolveSocial(input);
      const scheduled = input.scheduled_date ?? new Date().toISOString().slice(0, 10);
      const [prepared] = await prepareQueueItems('Instagram', socialId, scheduled, [{
        leadId: input.lead_id,
        templateId: String(input.template_id ?? ''),
      }]);
      if (!prepared) throw new Error('A transação não retornou o resultado do lead.');
      if (prepared.outcome === 'queued' || prepared.outcome === 'reconciled') {
        if (prepared.queueItemId) result.push(prepared.queueItemId);
        continue;
      }
      if (prepared.outcome === 'conflict') continue;
      throw new Error(prepared.reason || 'Não foi possível incluir o lead na fila do Instagram.');
    }
    return result;
  },
  async removeQueued(id) {
    const userId = await currentUserIdNumber();
    const response = await getSupabaseClient().from('queue_items').delete().eq('queue_items_id', Number(id)).eq('users_id', userId).eq('status_id', await queueStatusId('queued'));
    if (response.error) throw new Error(response.error.message);
  },
  async updateLead(id, input: UpdateInstagramQueueLeadInput) {
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
