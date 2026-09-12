import { getSupabaseClient } from '../../lib/supabase';
import { eventBus } from '../../lib/events';
import { queuePreparationService } from '../queue-preparation';
import { whatsappValidationService, type PreparedWhatsAppValidationLead } from '../whatsapp-validation/whatsappValidation.service';
import type { QueueReviewBatch, QueueReviewBranch, QueueReviewChannel, QueueReviewItem, QueueReviewPullFilters, QueueReviewPullPreview, QueueReviewPullResult, QueueReviewResource, QueueReviewState } from './types';
import { normalizePageRequest, type PageRequest } from '../pagination/types';

function rpcRow<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function channelKey(channel: QueueReviewChannel) {
  return channel === 'Instagram' ? 'instagram' : 'whatsapp';
}

type PullCapacityBase = {
  batchId: string;
  scheduledDate: string;
  resource: QueueReviewResource;
  providerKey: string;
  selectionKey: string;
};

function resourceFromRow(channel: QueueReviewChannel, value: Record<string, unknown>): QueueReviewResource {
  return {
    id: String(value.resource_id ?? value.resourceId ?? ''),
    label: String(value.resource_label ?? value.resourceLabel ?? value.resource_id ?? ''),
    channel,
    dailyLimit: Number(value.daily_limit ?? value.dailyLimit ?? 0),
    finalUsed: Math.max(0, Number(value.final_used ?? value.finalUsed ?? 0)),
    reviewOpen: Math.max(0, Number(value.review_open ?? value.reviewOpen ?? 0)),
    used: Math.max(0, Number(value.used ?? 0)),
    available: Math.max(0, Number(value.available ?? value.missingCount ?? value.missing_count ?? 0)),
  };
}

async function branches(): Promise<QueueReviewBranch[]> {
  const { data, error } = await getSupabaseClient().rpc('list_queue_review_branches_r59');
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.branch_id ?? row.branches_id ?? ''),
    name: String(row.branch_name ?? row.branches_name ?? ''),
  })).filter((branch) => branch.id && branch.name);
}

async function states(): Promise<QueueReviewState[]> {
  const { data, error } = await getSupabaseClient()
    .from('states')
    .select('states_id,states_name,states_code')
    .order('states_name', { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.states_id ?? ''),
    name: String(row.states_name ?? ''),
    code: String(row.states_code ?? ''),
  })).filter((state) => state.id && state.name);
}

async function resources(channel: QueueReviewChannel, scheduledDate: string) {
  const { data, error } = await getSupabaseClient().rpc('list_queue_review_resources', {
    p_channel: channelKey(channel),
    p_scheduled_date: scheduledDate,
  });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => resourceFromRow(channel, row));
}

type ReservedReviewLead = PreparedWhatsAppValidationLead & {
  reviewItemId: string;
  instagram: string;
};

type PullCapacityContext = PullCapacityBase & {
  capacityToFill: number;
  reserved: ReservedReviewLead[];
};

function reservedLeadFrom(value: Record<string, unknown>): ReservedReviewLead {
  return {
    id: String(value.leadId ?? value.lead_id ?? ''),
    reviewItemId: String(value.reviewItemId ?? value.review_item_id ?? ''),
    company: String(value.company ?? ''),
    phone: String(value.phone ?? ''),
    normalizedPhone: String(value.normalizedPhone ?? value.normalized_phone ?? ''),
    instagram: String(value.instagram ?? ''),
  };
}

async function pullCapacity(channel: QueueReviewChannel, resourceKey: string, scheduledDate: string, filters: QueueReviewPullFilters): Promise<PullCapacityContext> {
  const { data, error } = await getSupabaseClient().rpc('pull_queue_review_to_capacity', {
    p_channel: channelKey(channel),
    p_resource_key: resourceKey,
    p_scheduled_date: scheduledDate,
    p_site_filter: filters.site,
    p_instagram_filter: filters.instagram,
    p_branch_ids: filters.branchIds.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0),
    p_state_ids: filters.stateIds.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0),
    p_name_keyword: filters.nameKeyword.trim() || null,
  });
  if (error) throw new Error(error.message);
  const row = rpcRow(data as Record<string, unknown> | Record<string, unknown>[] | null);
  if (!row) throw new Error('O banco não retornou o resultado da puxada.');
  const rawReserved = Array.isArray(row.reserved) ? row.reserved : [];
  const reserved = rawReserved
    .filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value))
    .map(reservedLeadFrom)
    .filter((lead) => lead.id && lead.reviewItemId);
  return {
    batchId: String(row.batchId ?? row.batch_id ?? ''),
    scheduledDate: String(row.scheduledDate ?? row.scheduled_date ?? ''),
    resource: resourceFromRow(channel, row),
    providerKey: String(row.providerKey ?? row.provider_key ?? ''),
    selectionKey: String(row.selectionKey ?? row.selection_key ?? row.resourceLabel ?? row.resource_label ?? ''),
    capacityToFill: Math.max(0, Number(row.capacityToFill ?? row.capacity_to_fill ?? 0)),
    reserved,
  };
}

async function pullToCapacity(
  channel: QueueReviewChannel,
  resourceKey: string,
  scheduledDate: string,
  filters: QueueReviewPullFilters,
): Promise<QueueReviewPullResult> {
  const context = await pullCapacity(channel, resourceKey, scheduledDate, filters);
  let { resource } = context;
  const { reserved, capacityToFill } = context;
  let invalidatedByProvider = 0;
  let redirectedToInstagram = 0;
  let errors = 0;
  let technicalStop = false;
  let technicalReasons: string[] = [];
  let ready = 0;
  const movedLeadIds = new Set<string>();
  const redirectedLeadIds = new Set<string>();

  // O banco reserva exatamente a capacidade restante do recurso/data.
  // Não existe quantidade manual, oversampling, refill, segunda passagem ou retry automático.
  const exhausted = capacityToFill > 0 && reserved.length < capacityToFill;

  if (channel === 'WhatsApp' && reserved.length) {
    const validation = await whatsappValidationService.validatePreparedInitial(reserved, context.providerKey);
    const readyIds = Array.from(new Set(validation.approvedIds));
    readyIds.forEach((id) => movedLeadIds.add(id));
    // Sem contato saiu definitivamente da Importação. Redirecionados e erros técnicos
    // continuam/importam novamente e portanto não são removidos da tabela local.
    validation.invalidatedIds.forEach((id) => movedLeadIds.add(id));
    validation.redirectedIds.forEach((id) => redirectedLeadIds.add(id));
    invalidatedByProvider = validation.invalidated;
    redirectedToInstagram = validation.redirectedToInstagram;
    errors = validation.errors + validation.failed;
    technicalStop = validation.errorIds.length > 0 || validation.failures.length > 0;
    technicalReasons = Array.from(new Set([
      ...validation.technicalErrors.map((item) => item.reason.trim()),
      ...validation.failures.map((item) => item.reason.trim()),
    ].filter(Boolean))).slice(0, 3);
    ready = readyIds.length;

    // A validação pode liberar reservas (inválido/erro). Recarrega só o card de capacidade;
    // a tabela de leads/revisão continua sendo atualizada localmente, sem piscar.
    const refreshed = await resources(channel, scheduledDate);
    resource = refreshed.find((item) => item.id === context.resource.id) ?? resource;
  }

  if (channel === 'Instagram') {
    reserved.forEach((lead) => movedLeadIds.add(lead.id));
    ready = reserved.length;
  }

  eventBus.emit('import:changed', { source: 'move' });
  return {
    scheduledDate: context.scheduledDate,
    resource,
    resourceSelectionKey: context.selectionKey,
    capacityToFill,
    reserved: reserved.length,
    ready,
    invalidatedByProvider,
    redirectedToInstagram,
    errors,
    exhausted,
    technicalStop,
    technicalReasons,
    movedLeadIds: Array.from(movedLeadIds),
    redirectedLeadIds: Array.from(redirectedLeadIds),
  };
}

const DEFAULT_PULL_FILTERS: QueueReviewPullFilters = { site: 'any', instagram: 'any', branchIds: [], stateIds: [], nameKeyword: '' };

async function preview(channel: QueueReviewChannel, scheduledDate: string, preferredResourceId: string, filters: QueueReviewPullFilters = DEFAULT_PULL_FILTERS): Promise<QueueReviewPullPreview> {
  if (!preferredResourceId) throw new Error(channel === 'WhatsApp' ? 'Selecione um chip.' : 'Selecione um perfil.');
  const { data, error } = await getSupabaseClient().rpc('preview_queue_review_pull', {
    p_channel: channelKey(channel),
    p_resource_key: preferredResourceId,
    p_scheduled_date: scheduledDate,
    p_site_filter: filters.site,
    p_instagram_filter: filters.instagram,
    p_branch_ids: filters.branchIds.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0),
    p_state_ids: filters.stateIds.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0),
    p_name_keyword: filters.nameKeyword.trim() || null,
  });
  if (error) throw new Error(error.message);
  const row = rpcRow(data as Record<string, unknown> | Record<string, unknown>[] | null);
  if (!row) throw new Error('O banco não retornou a prévia da puxada.');
  return {
    scheduledDate: String(row.scheduledDate ?? row.scheduled_date ?? scheduledDate),
    resource: resourceFromRow(channel, row),
    eligible: Math.max(0, Number(row.eligible ?? 0)),
    willPull: Math.max(0, Number(row.willPull ?? row.will_pull ?? 0)),
  };
}

async function pull(channel: QueueReviewChannel, scheduledDate: string, preferredResourceId: string, filters: QueueReviewPullFilters = DEFAULT_PULL_FILTERS) {
  if (!preferredResourceId) {
    throw new Error(channel === 'WhatsApp'
      ? 'Selecione um chip específico antes de puxar e validar a fila WhatsApp.'
      : 'Selecione um perfil específico antes de puxar a fila Instagram.');
  }
  if (!scheduledDate) throw new Error('Selecione a data que receberá os leads.');
  return pullToCapacity(channel, preferredResourceId, scheduledDate, filters);
}

async function list(channel: QueueReviewChannel, preferredResourceId = '', scheduledDate = ''): Promise<QueueReviewBatch[]> {
  if (!preferredResourceId || !scheduledDate) return [];

  const { data, error } = await getSupabaseClient().rpc('list_queue_review_for_resource', {
    p_channel: channelKey(channel),
    p_resource_key: preferredResourceId,
    p_scheduled_date: scheduledDate,
  });
  if (error) throw new Error(error.message);
  const rows = ((data ?? []) as Array<Record<string, unknown>>).map<QueueReviewItem & { resourceLabel: string }>((row) => ({
    batchId: String(row.batch_id ?? ''),
    reviewItemId: String(row.review_item_id ?? ''),
    channel: String(row.channel_key ?? '') === 'instagram' ? 'instagram' : 'whatsapp',
    resourceId: String(row.resource_id ?? ''),
    resourceLabel: String(row.resource_label ?? row.resource_id ?? ''),
    scheduledDate: String(row.scheduled_date ?? ''),
    targetCount: Number(row.target_count ?? 0),
    leadId: String(row.lead_id ?? ''),
    position: Number(row.position ?? 0),
    company: String(row.company ?? ''),
    branchId: String(row.branch_id ?? ''),
    branch: String(row.branch_name ?? ''),
    city: String(row.city ?? ''),
    state: String(row.state ?? ''),
    phone: String(row.phone ?? ''),
    whatsapp: String(row.whatsapp ?? ''),
    instagram: String(row.instagram ?? ''),
    website: String(row.website ?? ''),
    mapsUrl: String(row.maps_url ?? ''),
    rating: Number(row.rating ?? 0),
    reviews: Number(row.reviews ?? 0),
  }));

  const grouped = new Map<string, QueueReviewBatch>();
  for (const item of rows) {
    let batch = grouped.get(item.batchId);
    if (!batch) {
      batch = {
        batchId: item.batchId,
        channel,
        resourceId: item.resourceId,
        resourceLabel: item.resourceLabel,
        scheduledDate: item.scheduledDate,
        targetCount: item.targetCount,
        items: [],
      };
      grouped.set(item.batchId, batch);
    }
    batch.items.push(item);
  }
  return Array.from(grouped.values());
}


async function listPage(channel: QueueReviewChannel, preferredResourceId = '', scheduledDate = '', request: Partial<PageRequest> = {}) {
  const normalized = normalizePageRequest(request);
  if (!preferredResourceId || !scheduledDate) return { batches: [], total: 0, page: normalized.page, pageSize: normalized.pageSize };
  const { data, error } = await getSupabaseClient().rpc('list_queue_review_page_r59', {
    p_channel: channelKey(channel), p_resource_key: preferredResourceId, p_scheduled_date: scheduledDate,
    p_page: normalized.page, p_page_size: normalized.pageSize,
  });
  if (error) throw new Error(error.message);
  const payload = (data && typeof data === 'object' && !Array.isArray(data) ? data : {}) as Record<string, unknown>;
  const rawItems = Array.isArray(payload.items) ? payload.items : [];
  const items = rawItems.filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)).map<QueueReviewItem & { resourceLabel: string }>((row) => ({
    batchId: String(row.batch_id ?? ''), reviewItemId: String(row.review_item_id ?? ''), channel: String(row.channel_key ?? '') === 'instagram' ? 'instagram' : 'whatsapp',
    resourceId: String(row.resource_id ?? ''), resourceLabel: String(row.resource_label ?? row.resource_id ?? ''), scheduledDate: String(row.scheduled_date ?? ''), targetCount: Number(row.target_count ?? 0),
    leadId: String(row.lead_id ?? ''), position: Number(row.position ?? 0), company: String(row.company ?? ''), branchId: String(row.branch_id ?? ''), branch: String(row.branch_name ?? ''), city: String(row.city ?? ''), state: String(row.state ?? ''),
    phone: String(row.phone ?? ''), whatsapp: String(row.whatsapp ?? ''), instagram: String(row.instagram ?? ''), website: String(row.website ?? ''), mapsUrl: String(row.maps_url ?? ''), rating: Number(row.rating ?? 0), reviews: Number(row.reviews ?? 0),
  }));
  const grouped = new Map<string, QueueReviewBatch>();
  for (const item of items) {
    let batch = grouped.get(item.batchId);
    if (!batch) { batch = { batchId:item.batchId, channel, resourceId:item.resourceId, resourceLabel:item.resourceLabel, scheduledDate:item.scheduledDate, targetCount:item.targetCount, items:[] }; grouped.set(item.batchId,batch); }
    batch.items.push(item);
  }
  return { batches:Array.from(grouped.values()), total:Math.max(0,Number(payload.total??0)), page:Math.max(1,Number(payload.page??normalized.page)), pageSize:Math.max(1,Number(payload.pageSize??payload.page_size??normalized.pageSize)) };
}

async function count(channel: QueueReviewChannel, preferredResourceId = '', scheduledDate = '') {
  if (!preferredResourceId || !scheduledDate) return 0;
  const { data, error } = await getSupabaseClient().rpc('queue_review_count_r59', { p_channel:channelKey(channel), p_resource_key:preferredResourceId, p_scheduled_date:scheduledDate });
  if (error) throw new Error(error.message);
  return Math.max(0, Number(data ?? 0));
}

async function approve(item: QueueReviewItem, channel: QueueReviewChannel) {
  const prepared = await queuePreparationService.buildReviewLockItems(channel, [item.leadId]);
  if (prepared.failures.length) {
    const first = prepared.failures[0];
    throw new Error(`${first.company ? `${first.company}: ` : ''}${first.reason}`);
  }
  const preparedItem = prepared.items[0];
  if (!preparedItem) throw new Error('O lead não está pronto para aprovação.');

  const { data, error } = await getSupabaseClient().rpc('approve_queue_review_item', {
    p_review_item_id: Number(item.reviewItemId),
    p_template_id: Number(preparedItem.templateId),
  });
  if (error) throw new Error(error.message);

  const approval = rpcRow(data as Record<string, unknown> | Record<string, unknown>[] | null);
  if (!approval || approval.persisted !== true || approval.reviewStatus !== 'locked' || !approval.queueItemId) {
    const { data: stateData, error: stateError } = await getSupabaseClient().rpc('queue_review_approval_state', {
      p_review_item_id: Number(item.reviewItemId),
    });
    if (stateError) throw new Error(`A aprovação não pôde ser confirmada no banco: ${stateError.message}`);
    const state = rpcRow(stateData as Record<string, unknown> | Record<string, unknown>[] | null);
    if (!state || state.persisted !== true) {
      const detail = state?.reason ? ` (${String(state.reason)})` : '';
      throw new Error(`A aprovação não foi persistida no banco${detail}.`);
    }
  }

  eventBus.emit('import:changed', { source: 'move' });
  eventBus.emit(channel === 'WhatsApp' ? 'whatsapp-queue:changed' : 'instagram-queue:changed', { action: 'update' });
  return approval ?? data;
}

async function invalidate(item: QueueReviewItem, channel: QueueReviewChannel) {
  const { error } = await getSupabaseClient().rpc('invalidate_queue_review_item', { p_review_item_id: Number(item.reviewItemId) });
  if (error) throw new Error(error.message);
  eventBus.emit('import:changed', { source: 'move' });
}

export const queueReviewService = { branches, states, resources, preview, pull, list, listPage, count, approve, invalidate };
