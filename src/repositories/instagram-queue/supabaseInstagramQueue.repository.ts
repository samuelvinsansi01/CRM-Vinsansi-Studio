import { getSupabaseClient, getSupabaseConfig } from '../../lib/supabase';
import { branchIdOrNull } from '../../services/config/branchIdentity';
import { applyCurrentBranchMedia, branchForBoundRecord, normalizeStoredBoolean } from '../../services/config/branchMedia';
import { normalizeInstagramUsername } from '../../services/instagram/instagram.utils';
import { isStatusGroup, normalizeInstagramQueueStatus } from '../../services/status/status.mapper';
import type {
  CreateInstagramQueueLeadInput,
  InstagramQueueBatch,
  InstagramQueueFilters,
  InstagramQueueLead,
  InstagramQueueStatus,
  InstagramQueueSummary,
  UpdateInstagramQueueLeadInput,
} from '../../services/instagram-queue/types';
import { createUuid, getCurrentUserId, nowIso, todayIsoDate } from '../supabase.helpers';
import type { InstagramQueueRepository } from './instagramQueue.repository';

function table() {
  return getSupabaseConfig().tables.instagramQueueItems;
}

function uuidOrNull(value: unknown) {
  const text = String(value ?? '');
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text) ? text : null;
}

function rowToLead(row: Record<string, unknown>): InstagramQueueLead {
  const data = (row.data && typeof row.data === 'object' ? row.data : {}) as Partial<InstagramQueueLead>;
  const profile = String(row.profile_username ?? data.profile ?? 'Todos');
  const batchNumber = Number(row.batch_number ?? row.block_number ?? data.batch_number ?? 1);
  const batchId = String(row.batch_id ?? data.batch_id ?? `ig-batch-${profile}-${batchNumber}`);
  const position = Number(row.position ?? data.position ?? 1);
  const instagram = String(row.instagram_url ?? data.instagram_url ?? data.instagram ?? '');
  return {
    ...data,
    ...(row.block_size ? { block_size: Number(row.block_size) } : {}),
    ...(row.batch_limit ? { batch_limit: Number(row.batch_limit) } : {}),
    id: String(row.id),
    lead_id: String(row.lead_id ?? data.lead_id ?? ''),
    sourcePreSendId: String(data.sourcePreSendId ?? row.source_pre_send_id ?? row.lead_id ?? ''),
    order: position,
    position,
    company: String(row.company_name ?? data.company ?? ''),
    company_name: String(row.company_name ?? data.company_name ?? data.company ?? ''),
    channel: 'instagram',
    instagram,
    profile,
    profile_id: String(row.profile_id ?? data.profile_id ?? profile),
    branch: String(row.parent_category ?? data.branch ?? ''),
    branch_id: String(row.branch_id ?? data.branch_id ?? ''),
    branch_slug: String(row.branch_slug ?? data.branch_slug ?? ''),
    type: (row.lead_type ?? data.type ?? 'Instagram') as InstagramQueueLead['type'],
    original_destination: data.original_destination ?? (row.original_destination as InstagramQueueLead['original_destination']),
    destination_override: data.destination_override ?? (row.destination_override as InstagramQueueLead['destination_override']),
    send_instagram: data.send_instagram ?? Boolean(row.send_instagram ?? false),
    instagram_url: instagram,
    instagram_username: String(row.instagram_username ?? data.instagram_username ?? normalizeInstagramUsername(instagram)),
    instagram_override_reason: data.instagram_override_reason ?? String(row.instagram_override_reason ?? ''),
    override_by: data.override_by ?? String(row.override_by ?? ''),
    override_at: data.override_at ?? String(row.override_at ?? ''),
    status: normalizeInstagramQueueStatus(row.status ?? data.status ?? 'queued') as InstagramQueueStatus,
    batchId,
    batch_id: batchId,
    batch_number: batchNumber,
    // Instagram does not use a WhatsApp chip. Keep legacy JSON only for reads.
    chip_id: String(data.chip_id ?? ''),
    scheduled_date: String(row.scheduled_date ?? data.scheduled_date ?? todayIsoDate()),
    template_id: String(row.template_id ?? data.template_id ?? ''),
    message1: String(row.message_1 ?? data.message1 ?? data.message_1 ?? ''),
    message_1: String(row.message_1 ?? data.message_1 ?? data.message1 ?? ''),
    message2: String(row.message_2 ?? data.message2 ?? data.message_2 ?? ''),
    message_2: String(row.message_2 ?? data.message_2 ?? data.message2 ?? ''),
    message3: String(row.message_3 ?? data.message3 ?? data.message_3 ?? ''),
    message_3: String(row.message_3 ?? data.message_3 ?? data.message3 ?? ''),
    message4: String(row.message_4 ?? data.message4 ?? data.message_4 ?? ''),
    message_4: String(row.message_4 ?? data.message_4 ?? data.message4 ?? ''),
    imageName: String(data.imageName ?? (data as Record<string, unknown>).image_name ?? row.image_url ?? ''),
    imageRequired: normalizeStoredBoolean(data.imageRequired ?? (data as Record<string, unknown>).image_required, Boolean(row.image_url ?? data.imageName)),
    image_url: String(row.image_url ?? data.image_url ?? ''),
    image_id: String(row.image_id ?? data.image_id ?? ''),
    city: data.city,
    state: data.state,
    phone: String(row.phone ?? data.phone ?? ''),
    site: data.site,
    mapsUrl: data.mapsUrl,
    retry_count: Number(row.retry_count ?? data.retry_count ?? 0),
    error_message: String(row.error_message ?? data.error_message ?? ''),
    sent_at: String(row.sent_at ?? data.sent_at ?? ''),
    created_at: String(row.created_at ?? data.created_at ?? nowIso()),
    updated_at: String(row.updated_at ?? data.updated_at ?? nowIso()),
    invalidReason: data.invalidReason,
  };
}

function isDeletedRow(row: Record<string, unknown>) {
  const data = (row.data && typeof row.data === 'object' ? row.data : {}) as Partial<InstagramQueueLead>;
  return isStatusGroup(row.status ?? data.status, 'deleted');
}

async function allLeads() {
  const client = getSupabaseClient();
  const [queueResponse, branchResponse] = await Promise.all([
    client.from(table()).select('*'),
    client.from(getSupabaseConfig().tables.branches).select('*'),
  ]);
  if (queueResponse.error) throw new Error(queueResponse.error.message);

  const branches = branchResponse.error
    ? []
    : (branchResponse.data ?? []).map((row) => {
        const data = row.data && typeof row.data === 'object' ? row.data as Record<string, unknown> : {};
        return {
          id: String(row.id ?? data.id ?? ''),
          kind: 'branches' as const,
          slug: String(row.slug ?? data.slug ?? ''),
          name: String(row.name ?? data.name ?? row.category ?? data.category ?? ''),
          category: String(row.category ?? data.category ?? row.name ?? data.name ?? ''),
          subcategories: Array.isArray(row.subcategories ?? data.subcategories) ? (row.subcategories ?? data.subcategories) as string[] : [],
          associatedCategories: Array.isArray(row.associated_categories ?? data.associatedCategories) ? (row.associated_categories ?? data.associatedCategories) as string[] : [],
          order: Number(row.order_index ?? data.order ?? 0),
          minRating: Number(row.min_rating ?? data.minRating ?? 0),
          minReviews: Number(row.min_reviews ?? data.minReviews ?? 0),
          imageName: String(row.image_name ?? data.imageName ?? ''),
          imageRequired: normalizeStoredBoolean(row.image_required ?? data.imageRequired ?? data.image_required, Boolean(row.image_name ?? data.imageName)),
          active: normalizeStoredBoolean(row.active ?? data.active, true),
          status: String(row.status ?? data.status ?? 'Ativo') as 'Ativo',
          createdAt: String(row.created_at ?? data.createdAt ?? ''),
          updatedAt: String(row.updated_at ?? data.updatedAt ?? ''),
        };
      });

  return (queueResponse.data ?? [])
    .filter((row) => !isDeletedRow(row))
    .map((row) => rowToLead(row))
    .map((lead) => applyCurrentBranchMedia(lead, branchForBoundRecord(lead, branches)));
}

async function loadValidLeadIds(ids: string[]) {
  const uniqueIds = Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)));
  if (!uniqueIds.length) return new Set<string>();

  const { data, error } = await getSupabaseClient()
    .from(getSupabaseConfig().tables.importLeads)
    .select('id')
    .in('id', uniqueIds);

  if (error) return new Set<string>();
  return new Set((data ?? []).map((row) => String(row.id)));
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

function applySearch(batch: InstagramQueueBatch, search?: string): InstagramQueueBatch {
  const query = search?.trim().toLowerCase() ?? '';
  if (!query) return batch;
  return {
    ...batch,
    leads: batch.leads.filter((lead) => `${lead.company} ${lead.instagram} ${lead.branch} ${lead.type} ${lead.status}`.toLowerCase().includes(query)),
  };
}

function inferBatchLimit(leads: InstagramQueueLead[], fallback = 15) {
  const configured = leads
    .map((lead) => {
      const record = lead as InstagramQueueLead & { batchLimit?: unknown; batch_limit?: unknown; blockSize?: unknown; block_size?: unknown };
      return Number(record.batchLimit ?? record.batch_limit ?? record.blockSize ?? record.block_size ?? 0);
    })
    .find((value) => Number.isFinite(value) && value > 0);

  return configured ?? fallback;
}

function leadSortKey(lead: InstagramQueueLead) {
  return `${lead.scheduled_date}:${String(lead.batch_number).padStart(6, '0')}:${String(lead.position).padStart(6, '0')}:${lead.created_at}:${lead.id}`;
}

function groupBatches(leads: InstagramQueueLead[], defaultLimit = 15): InstagramQueueBatch[] {
  const groups = new Map<string, InstagramQueueLead[]>();

  for (const lead of leads) {
    const key = `${lead.profile}:${lead.scheduled_date}`;
    groups.set(key, [...(groups.get(key) ?? []), lead]);
  }

  return Array.from(groups.entries())
    .flatMap(([key, groupLeads]) => {
      const [profile, scheduledDate] = key.split(':');
      const sorted = [...groupLeads].sort((a, b) => leadSortKey(a).localeCompare(leadSortKey(b)));
      const limit = inferBatchLimit(sorted, defaultLimit);
      const batches: InstagramQueueBatch[] = [];

      for (let index = 0; index < sorted.length; index += limit) {
        const number = Math.floor(index / limit) + 1;
        batches.push({
          id: `ig-batch-${profile}-${scheduledDate}-${number}`,
          number,
          profile,
          limit,
          leads: sorted.slice(index, index + limit),
        });
      }

      return batches;
    })
    .sort((a, b) => a.profile.localeCompare(b.profile) || a.number - b.number);
}

function nextBatch(leads: InstagramQueueLead[], profile: string, limit: number, scheduledDate: string) {
  const profileBatches = groupBatches(leads.filter((lead) => lead.scheduled_date === scheduledDate), limit)
    .filter((batch) => batch.profile === profile)
    .sort((a, b) => a.number - b.number);
  const openBatch = profileBatches.find((batch) => batch.leads.length < limit);
  if (openBatch) return openBatch;
  const number = profileBatches.length ? Math.max(...profileBatches.map((batch) => batch.number)) + 1 : 1;
  return { id: `ig-batch-${profile}-${scheduledDate}-${number}`, number, profile, limit, leads: [] };
}

function buildLead(input: CreateInstagramQueueLeadInput, batch: InstagramQueueBatch): InstagramQueueLead {
  const id = createUuid();
  const timestamp = nowIso();
  return {
    ...input,
    id,
    lead_id: input.lead_id ?? '',
    order: batch.leads.length + 1,
    position: batch.leads.length + 1,
    company_name: input.company,
    channel: 'instagram',
    profile_id: input.profile,
    branch_id: input.branch_id,
    branch_slug: input.branch_slug,
    batchId: batch.id,
    batch_id: batch.id,
    batch_number: batch.number,
    scheduled_date: input.scheduled_date ?? todayIsoDate(),
    template_id: input.template_id ?? '',
    message_1: input.message1,
    message_2: input.message2,
    message_3: input.message3,
    message_4: input.message4,
    imageRequired: input.imageRequired ?? Boolean(input.imageName ?? input.image_url),
    image_url: input.imageRequired === false ? '' : (input.image_url ?? input.imageName),
    image_id: input.image_id,
    instagram_username: normalizeInstagramUsername(input.instagram_url ?? input.instagram),
    retry_count: 0,
    error_message: '',
    sent_at: '',
    created_at: timestamp,
    updated_at: timestamp,
  };
}

function dbPayload(lead: InstagramQueueLead, userId: string) {
  return {
    id: lead.id,
    user_id: userId,
    lead_id: lead.lead_id || null,
    source_pre_send_id: lead.sourcePreSendId ?? null,
    scheduled_date: lead.scheduled_date,
    status: lead.status,
    position: lead.position,
    profile_id: uuidOrNull(lead.profile_id),
    profile_username: lead.profile,
    block_number: lead.batch_number,
    block_size: 15,
    message_1: lead.message_1,
    message_2: lead.message_2,
    message_3: lead.message_3,
    message_4: lead.message_4,
    image_url: lead.image_url,
    instagram_username: lead.instagram_username,
    instagram_url: lead.instagram_url,
    company_name: lead.company_name,
    branch_id: branchIdOrNull(lead.branch_id),
    branch_name: lead.branch,
    branch_slug: lead.branch_slug,
    parent_category: lead.branch,
    lead_type: lead.type,
    follow_status: lead.status,
    sent_at: lead.sent_at || null,
    error_message: lead.error_message,
    last_action_at: nowIso(),
    template_id: uuidOrNull(lead.template_id),
    data: lead,
    active: true,
    kind: 'instagram_queue',
    channel: 'instagram',
    batch_id: lead.batch_id,
    batch_number: lead.batch_number,
    destination: 'Instagram',
    original_destination: lead.original_destination,
    destination_override: lead.destination_override,
    send_instagram: lead.send_instagram,
    instagram_override_reason: lead.instagram_override_reason,
    override_by: lead.override_by,
    override_at: lead.override_at || null,
    phone: lead.phone,
    image_id: lead.image_id,
    retry_count: lead.retry_count,
    updated_at: nowIso(),
  };
}

async function updateStatus(ids: string[], status: InstagramQueueStatus, errorMessage = '') {
  const timestamp = nowIso();
  const leads = await allLeads();
  const userId = await getCurrentUserId();
  await Promise.all(ids.map(async (id) => {
    const lead = leads.find((item) => item.id === id);
    if (!lead) return;
    const updated: InstagramQueueLead = {
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

export const supabaseInstagramQueueRepository: InstagramQueueRepository = {
  async listProfiles() {
    return Array.from(new Set((await allLeads()).map((lead) => lead.profile).filter(Boolean)));
  },

  async listBatches(filters) {
    const scoped = (await allLeads()).filter((lead) =>
      (!filters.profile || lead.profile === filters.profile) &&
      (!filters.scheduledDate || lead.scheduled_date === filters.scheduledDate),
    );
    return groupBatches(scoped).map((batch) => applySearch(batch, filters.search));
  },

  async summary(filters: InstagramQueueFilters = {}) {
    const scoped = (await allLeads()).filter((lead) =>
      (!filters.profile || lead.profile === filters.profile) &&
      (!filters.scheduledDate || lead.scheduled_date === filters.scheduledDate),
    );
    return calculateSummary(scoped);
  },

  async enqueue(inputLeads) {
    const persisted = await allLeads();
    const existingSources = new Set(persisted.map((lead) => lead.sourcePreSendId).filter(Boolean));
    const existingInstagrams = new Set(persisted.map((lead) => lead.instagram_username || normalizeInstagramUsername(lead.instagram_url ?? lead.instagram)).filter(Boolean));
    const validLeadIds = await loadValidLeadIds(inputLeads.map((lead) => lead.lead_id ?? ''));
    const working = [...persisted];
    const userId = await getCurrentUserId();

    for (const input of inputLeads) {
      const safeInput = input.lead_id && !validLeadIds.has(input.lead_id) ? { ...input, lead_id: undefined } : input;
      const username = normalizeInstagramUsername(safeInput.instagram_url ?? safeInput.instagram);
      if (safeInput.sourcePreSendId && existingSources.has(safeInput.sourcePreSendId)) continue;
      if (username && existingInstagrams.has(username)) continue;

      const limit = safeInput.batchLimit ?? 15;
      const scheduledDate = safeInput.scheduled_date ?? todayIsoDate();
      const batch = nextBatch(working, safeInput.profile, limit, scheduledDate);
      const lead = buildLead(safeInput, batch);
      // The legacy database may expose source_pre_send_id only through a partial
      // unique index. PostgREST cannot use a partial index as an ON CONFLICT
      // target, which made a valid Instagram queue allocation fail before the
      // item was created. Duplicates are guarded above from the persisted queue
      // snapshot, so this path can use a regular insert and remain idempotent
      // for normal panel actions.
      const { error } = await getSupabaseClient().from(table()).insert({ ...dbPayload(lead, userId), created_at: lead.created_at });
      if (error) throw new Error(error.message);
      working.push(lead);
      if (lead.sourcePreSendId) existingSources.add(lead.sourcePreSendId);
      if (lead.instagram_username) existingInstagrams.add(lead.instagram_username);
    }
  },

  async updateLead(id: string, input: UpdateInstagramQueueLeadInput) {
    const lead = (await allLeads()).find((item) => item.id === id);
    if (!lead) throw new Error('Lead nao encontrado na fila Instagram.');
    const updated: InstagramQueueLead = {
      ...lead,
      ...input,
      message_1: input.message1 ?? lead.message_1,
      message_2: input.message2 ?? lead.message_2,
      message_3: input.message3 ?? lead.message_3,
      message_4: input.message4 ?? lead.message_4,
      imageRequired: input.imageRequired ?? lead.imageRequired,
      image_url: input.image_url ?? input.imageName ?? lead.image_url,
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
