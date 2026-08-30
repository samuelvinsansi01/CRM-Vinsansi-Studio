import { getSupabaseClient } from '../../lib/supabase';
import type {
  CreateInstagramQueueLeadInput,
  InstagramQueueBatch,
  InstagramQueueFilters,
  InstagramQueueLead,
  InstagramQueuePage,
  UpdateInstagramQueueLeadInput,
} from '../../services/instagram-queue/types';
import { normalizeInstagramUsername } from '../../services/instagram/instagram.utils';
import { currentUserIdNumber, operationalStatusFromName, queueStatusId } from '../schemaCatalog';
import { canonicalQueueStatus, dateOnly, loadCanonicalQueue, prepareQueueItems, queuePayloadSnapshot, queueSnapshotMessage, queueSnapshotPart, updateQueueItemStatus } from '../queueSchema';
import { nowIso } from '../supabase.helpers';
import { normalizePageRequest, type PageRequest } from '../../services/pagination/types';
import type { InstagramQueueRepository } from './instagramQueue.repository';

type Row = Record<string, unknown>;

function progressAwareStatus(row: Awaited<ReturnType<typeof loadCanonicalQueue>>[number], progress: Row | undefined): InstagramQueueLead['status'] {
  const queueStatus = canonicalQueueStatus(row) as InstagramQueueLead['status'];
  const step = String(progress?.step ?? '').trim();
  if (!step) return queueStatus;
  if (queueStatus === 'queued' && step === 'error') return 'queued';
  if (step === 'reconciliation_required') return 'reconciliation_required';
  if (step === 'sent') return 'sent';
  if (step === 'invalid') return 'invalid';
  if (step === 'error') return 'error';
  if (['claimed', 'profile_opened', 'following', 'followed'].includes(step)) return 'following';
  if (['dm_opened', 'messages_sending', 'media_sending'].includes(step)) return 'dm_opened';
  if (step === 'queued') return 'queued';
  return queueStatus;
}

function mapLead(row: Awaited<ReturnType<typeof loadCanonicalQueue>>[number], progress?: Row): InstagramQueueLead {
  const item = row.item;
  const lead = row.lead;
  const template = row.template ?? {};
  const social = row.social ?? {};
  const branch = row.branch ?? {};
  const city = row.city ?? {};
  const state = row.state ?? {};
  const snapshot = queuePayloadSnapshot(item.queue_items_payload_snapshot);
  const snapshotLead = queueSnapshotPart(snapshot, 'lead');
  const snapshotRecipient = queueSnapshotPart(snapshot, 'recipient');
  const snapshotMedia = queueSnapshotPart(snapshot, 'media');
  const position = Number(item.queue_items_position ?? 1);
  const queueId = String(item.queues_id ?? '');
  const scheduled = dateOnly(item.queue_items_scheduled_at ?? row.queue.queues_scheduled_at);
  const instagram = String(snapshotRecipient.instagram ?? snapshotLead.instagram ?? lead.leads_instagram ?? '');
  const username = normalizeInstagramUsername(instagram);
  const originalCompany = String(snapshotLead.original_company_name ?? lead.leads_name ?? '');
  const alternativeName = String(snapshotLead.alternative_company_name ?? lead.leads_alternative_name ?? '');
  const sendCompanyName = String(snapshotLead.company_name ?? (alternativeName || originalCompany));
  const company = originalCompany;
  const branchName = String(snapshotLead.branch_name ?? branch.branches_name ?? '');
  const phone = String(snapshotLead.phone ?? lead.leads_phone ?? '');
  const website = String(snapshotLead.site ?? lead.leads_website ?? '');
  const mapsUrl = String(snapshotLead.maps_url ?? lead.leads_maps ?? '');
  const status = progressAwareStatus(row, progress);
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
    company_name: sendCompanyName,
    original_company_name: originalCompany,
    alternative_name: alternativeName,
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
    city: String(snapshotLead.city ?? city.cities_name ?? ''),
    state: String(snapshotLead.state ?? state.states_code ?? state.states_name ?? ''),
    rating: Number(lead.leads_score ?? 0),
    reviews: Number(lead.leads_reviews_count ?? 0),
    phone,
    site: website,
    mapsUrl,
    retry_count: Number(progress?.attempts ?? item.queue_items_attempts ?? 0),
    error_message: String(progress?.error_message ?? item.queue_items_error_message ?? ''),
    sent_at: status === 'sent' ? String(item.queue_items_finished_at ?? '') : '',
    created_at: String(item.queue_items_created_at ?? ''),
    updated_at: String(item.queue_items_updated_at ?? ''),
  };
}


function pagedInstagramStatus(row: Row): InstagramQueueLead['status'] {
  const queueStatus = operationalStatusFromName(row.status_name) as InstagramQueueLead['status'];
  const step = String(row.progress_step ?? '').trim();
  if (!step) return queueStatus;
  if (queueStatus === 'queued' && step === 'error') return 'queued';
  if (step === 'reconciliation_required') return 'reconciliation_required';
  if (step === 'sent') return 'sent';
  if (step === 'invalid') return 'invalid';
  if (step === 'error') return 'error';
  if (['claimed','profile_opened','following','followed'].includes(step)) return 'following';
  if (['dm_opened','messages_sending','media_sending'].includes(step)) return 'dm_opened';
  return 'queued';
}

function pagedInstagramLead(row: Row): InstagramQueueLead {
  const snapshot = queuePayloadSnapshot(row.payload_snapshot);
  const snapshotLead = queueSnapshotPart(snapshot, 'lead');
  const snapshotRecipient = queueSnapshotPart(snapshot, 'recipient');
  const snapshotMedia = queueSnapshotPart(snapshot, 'media');
  const position = Number(row.position ?? 1);
  const instagram = String(snapshotRecipient.instagram ?? snapshotLead.instagram ?? row.instagram ?? '');
  const username = normalizeInstagramUsername(instagram);
  const originalCompany = String(snapshotLead.original_company_name ?? row.company ?? '');
  const alternativeName = String(snapshotLead.alternative_company_name ?? row.alternative_name ?? '');
  const sendCompanyName = String(snapshotLead.company_name ?? (alternativeName || originalCompany));
  const website = String(snapshotLead.site ?? row.website ?? '');
  const message1 = queueSnapshotMessage(snapshot,1) || String(row.message_1 ?? '');
  const message2 = queueSnapshotMessage(snapshot,2) || String(row.message_2 ?? '');
  const message3 = queueSnapshotMessage(snapshot,3) || String(row.message_3 ?? '');
  const message4 = queueSnapshotMessage(snapshot,4) || String(row.message_4 ?? '');
  const imageName = String(snapshotMedia.name ?? '');
  const status = pagedInstagramStatus(row);
  return {
    id:String(row.id ?? ''), lead_id:String(row.lead_id ?? ''), order:position, position, company:originalCompany, company_name:sendCompanyName, original_company_name:originalCompany, alternative_name:alternativeName,
    channel:'instagram', instagram, profile:String(row.profile_username ?? ''), profile_id:String(row.resource_id ?? ''), branch:String(snapshotLead.branch_name ?? row.branch ?? ''), branch_id:String(snapshotLead.branch_id ?? row.branch_id ?? ''), branch_slug:'',
    type:'Instagram', original_destination:'Instagram', send_instagram:true, instagram_url:instagram, instagram_username:username, status, batchId:String(row.queue_id ?? ''), batch_id:String(row.queue_id ?? ''), batch_number:Number(row.dispatch_batch_number ?? 1), dispatch_batch_number:Number(row.dispatch_batch_number ?? 1), dispatch_batch_count:Number(row.dispatch_batch_count ?? 1), dispatch_batch_size:Number(row.dispatch_batch_size ?? 1), dispatch_batch_position:Number(row.dispatch_batch_position ?? 1),
    scheduled_date:String(row.scheduled_date ?? ''), template_id:String(row.template_id ?? ''), message1,message_1:message1,message2,message_2:message2,message3,message_3:message3,message4,message_4:message4,
    imageName,imageRequired:Boolean(snapshotMedia.required),image_url:imageName,image_id:String(snapshotMedia.sha256 ?? ''), city:String(snapshotLead.city ?? row.city ?? ''),state:String(snapshotLead.state ?? row.state ?? ''),rating:Number(row.rating ?? 0),reviews:Number(row.reviews ?? 0),
    phone:String(snapshotLead.phone ?? row.phone ?? ''),site:website,mapsUrl:String(snapshotLead.maps_url ?? row.maps_url ?? ''),retry_count:Number(row.progress_attempts ?? row.retry_count ?? 0),error_message:String(row.progress_error ?? row.error_message ?? ''),sent_at:status==='sent'?String(row.finished_at ?? ''):'',created_at:String(row.created_at ?? ''),updated_at:String(row.updated_at ?? ''),
  };
}

async function page(filters: InstagramQueueFilters, request: PageRequest): Promise<InstagramQueuePage> {
  const normalized=normalizePageRequest(request);
  if(!filters.profile||!filters.scheduledDate)return {batches:[],total:0,page:normalized.page,pageSize:normalized.pageSize,summary:{total:0,queued:0,sent:0,errors:0,invalid:0}};
  const {data,error}=await getSupabaseClient().rpc('list_queue_final_page_r59',{p_channel:'instagram',p_resource_key:filters.profile,p_scheduled_date:filters.scheduledDate,p_page:normalized.page,p_page_size:normalized.pageSize,p_search:filters.search?.trim()||null});
  if(error)throw new Error(`Não foi possível carregar a Fila final Instagram: ${error.message}`);
  const payload=(data&&typeof data==='object'&&!Array.isArray(data)?data:{}) as Row;
  const items=(Array.isArray(payload.items)?payload.items:[]).filter((item):item is Row=>Boolean(item)&&typeof item==='object'&&!Array.isArray(item)).map(pagedInstagramLead);
  const summary=payload.summary&&typeof payload.summary==='object'&&!Array.isArray(payload.summary)?payload.summary as Row:{};
  return {batches:batches(items),total:Number(payload.total??0),page:Number(payload.page??normalized.page),pageSize:Number(payload.pageSize??payload.page_size??normalized.pageSize),summary:{total:Number(summary.total??0),queued:Number(summary.queued??0),sent:Number(summary.sent??0),errors:Number(summary.errors??0),invalid:Number(summary.invalid??0)}};
}

async function all(filters: InstagramQueueFilters = {}) {
  const rows = await loadCanonicalQueue('Instagram');
  const itemIds = rows.map((row) => Number(row.item.queue_items_id)).filter((id) => Number.isSafeInteger(id) && id > 0);
  const progressMap = new Map<string, Row>();
  if (itemIds.length) {
    const response = await getSupabaseClient().from('instagram_queue_progress').select('*').in('queue_items_id', itemIds);
    if (response.error) throw new Error(`Não foi possível carregar o progresso Instagram: ${response.error.message}`);
    for (const progress of (response.data ?? []) as Row[]) progressMap.set(String(progress.queue_items_id), progress);
  }
  let leads = rows.map((row) => mapLead(row, progressMap.get(String(row.item.queue_items_id))));
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
  page,
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
      errors: leads.filter((lead) => lead.status === 'error' || lead.status === 'reconciliation_required').length,
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
    const numeric = ids.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0);
    if (!numeric.length) return;
    const response = await getSupabaseClient().rpc('instagram_reprocess_queue_items', { p_queue_item_ids: numeric });
    if (response.error) throw new Error(response.error.message);
  },
  async invalidate(id) {
    const numeric = Number(id);
    if (!Number.isSafeInteger(numeric) || numeric <= 0) throw new Error('Item Instagram inválido.');
    const response = await getSupabaseClient().rpc('invalidate_final_queue_item', {
      p_queue_item_id: numeric,
      p_reason: 'invalidado pelo operador',
    });
    if (response.error) throw new Error(response.error.message);
  },
};
