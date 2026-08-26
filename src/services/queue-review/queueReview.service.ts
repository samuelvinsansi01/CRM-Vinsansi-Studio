import { getSupabaseClient } from '../../lib/supabase';
import { eventBus } from '../../lib/events';
import { queuePreparationService, type QueuePreparationResource } from '../queue-preparation';
import { whatsappValidationService } from '../whatsapp-validation/whatsappValidation.service';
import type { QueueReviewBatch, QueueReviewChannel, QueueReviewItem, QueueReviewOpenBatch, QueueReviewPullResult } from './types';

function rpcRow<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function channelKey(channel: QueueReviewChannel) {
  return channel === 'Instagram' ? 'instagram' : 'whatsapp';
}

function openBatchFrom(value: Record<string, unknown>): QueueReviewOpenBatch {
  return {
    batchId: String(value.batchId ?? value.batch_id ?? ''),
    channel: String(value.channel ?? '') === 'instagram' ? 'instagram' : 'whatsapp',
    resourceId: String(value.resourceId ?? value.resource_id ?? ''),
    scheduledDate: String(value.scheduledDate ?? value.scheduled_date ?? ''),
    dailyLimit: Number(value.dailyLimit ?? value.daily_limit ?? 0),
    used: Number(value.used ?? 0),
    targetCount: Number(value.targetCount ?? value.target_count ?? 0),
    openCount: Number(value.openCount ?? value.open_count ?? 0),
    missingCount: Number(value.missingCount ?? value.missing_count ?? 0),
  };
}

async function openBatch(channel: QueueReviewChannel, resourceId: string, scheduledDate: string) {
  const { data, error } = await getSupabaseClient().rpc('open_queue_review_batch', {
    p_channel: channelKey(channel),
    p_resource_id: Number(resourceId),
    p_scheduled_date: scheduledDate,
  });
  if (error) throw new Error(error.message);
  const row = rpcRow(data as Record<string, unknown> | Record<string, unknown>[] | null);
  if (!row) throw new Error('O banco não retornou a revisão aberta.');
  return openBatchFrom(row);
}

async function candidateIds(batchId: string, limit: number) {
  const { data, error } = await getSupabaseClient().rpc('queue_review_candidate_ids', {
    p_batch_id: Number(batchId),
    p_limit: Math.max(1, Math.min(500, limit)),
  });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<{ lead_id?: number | string }>).map((row) => String(row.lead_id ?? '')).filter(Boolean);
}

async function reserve(batchId: string, ids: string[]) {
  if (!ids.length) return [];
  const { data, error } = await getSupabaseClient().rpc('reserve_queue_review_items', {
    p_batch_id: Number(batchId),
    p_lead_ids: ids.map(Number),
  });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<Record<string, unknown>>)
    .filter((row) => row.outcome === 'reserved')
    .map((row) => String(row.lead_id ?? ''))
    .filter(Boolean);
}


async function release(batchId: string, ids: string[]) {
  if (!ids.length) return;
  const { error } = await getSupabaseClient().rpc('release_queue_review_items', {
    p_batch_id: Number(batchId),
    p_lead_ids: ids.map(Number),
  });
  if (error) throw new Error(error.message);
}

async function restoreWhatsAppValid(batchId: string, ids: string[]) {
  if (!ids.length) return;
  const { error } = await getSupabaseClient().rpc('restore_queue_review_whatsapp_valid', {
    p_batch_id: Number(batchId),
    p_lead_ids: ids.map(Number),
  });
  if (error) throw new Error(error.message);
}

async function prune(batchId: string) {
  const { error } = await getSupabaseClient().rpc('prune_queue_review_items', { p_batch_id: Number(batchId) });
  if (error) throw new Error(error.message);
}

async function resources(channel: QueueReviewChannel, scheduledDate: string) {
  const snapshot = await queuePreparationService.snapshot(channel, scheduledDate);
  return snapshot.resources;
}

async function openReviewLeadIds(batchId: string, channel: QueueReviewChannel) {
  const { data, error } = await getSupabaseClient().rpc('list_open_queue_review', { p_channel: channelKey(channel) });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<{ batch_id?: number | string; lead_id?: number | string }>)
    .filter((row) => String(row.batch_id ?? '') === batchId)
    .map((row) => String(row.lead_id ?? ''))
    .filter(Boolean);
}

async function fillBatch(
  channel: QueueReviewChannel,
  resource: QueuePreparationResource,
  scheduledDate: string,
  options: { revalidateExisting?: boolean } = {},
): Promise<QueueReviewPullResult> {
  let batch = await openBatch(channel, resource.id, scheduledDate);
  let added = 0;
  let invalidatedByProvider = 0;
  let redirectedToInstagram = 0;
  let errors = 0;
  let exhausted = false;
  let guard = 0;

  if (channel === 'WhatsApp' && options.revalidateExisting && batch.openCount > 0) {
    const existingIds = await openReviewLeadIds(batch.batchId, channel);
    if (existingIds.length) {
      const validation = await whatsappValidationService.validateInitialWithChip(existingIds, resource.id);
      await restoreWhatsAppValid(batch.batchId, validation.approvedIds);
      const retryable = Array.from(new Set([...validation.errorIds, ...validation.conflictIds]));
      await release(batch.batchId, retryable);
      invalidatedByProvider += validation.invalidated;
      redirectedToInstagram += validation.redirectedToInstagram;
      errors += validation.errors + validation.failed;
      await prune(batch.batchId);
      batch = await openBatch(channel, resource.id, scheduledDate);
    }
  }

  while (batch.missingCount > 0 && guard < 100) {
    guard += 1;
    const wanted = Math.max(1, Math.min(batch.missingCount, resource.batchSize || batch.missingCount));
    const candidates = await candidateIds(batch.batchId, Math.max(wanted * 3, 20));
    if (!candidates.length) {
      exhausted = true;
      break;
    }
    const reserved = await reserve(batch.batchId, candidates.slice(0, wanted));
    if (!reserved.length) {
      exhausted = true;
      break;
    }

    if (channel === 'WhatsApp') {
      try {
        const validation = await whatsappValidationService.validateInitialWithChip(reserved, resource.id);
        await restoreWhatsAppValid(batch.batchId, validation.approvedIds);
        const retryable = Array.from(new Set([...validation.errorIds, ...validation.conflictIds]));
        await release(batch.batchId, retryable);
        invalidatedByProvider += validation.invalidated;
        redirectedToInstagram += validation.redirectedToInstagram;
        errors += validation.errors + validation.failed;
        await prune(batch.batchId);
      } catch (error) {
        // Falha técnica não pode deixar uma reserva PRE_SEND ocupando a revisão.
        await release(batch.batchId, reserved).catch(() => undefined);
        throw error;
      }
    }
    added += reserved.length;
    batch = await openBatch(channel, resource.id, scheduledDate);
  }

  eventBus.emit('import:changed', { source: 'move' });
  return { batch, resource, added, invalidatedByProvider, redirectedToInstagram, errors, exhausted };
}

async function pullToCapacity(channel: QueueReviewChannel, scheduledDate: string, preferredResourceId = '') {
  if (!preferredResourceId) {
    throw new Error(channel === 'WhatsApp'
      ? 'Selecione um chip específico antes de puxar e validar a fila WhatsApp.'
      : 'Selecione um perfil específico antes de puxar a fila Instagram.');
  }
  const availableResources = await resources(channel, scheduledDate);
  const matchesPreferred = (item: QueuePreparationResource) => item.id === preferredResourceId || item.label === preferredResourceId || item.aliases?.includes(preferredResourceId);
  const resource = availableResources.find(matchesPreferred);
  if (!resource) throw new Error(channel === 'WhatsApp' ? 'O chip selecionado não está operacional.' : 'O perfil Instagram selecionado não está operacional.');
  return fillBatch(channel, resource, scheduledDate, { revalidateExisting: channel === 'WhatsApp' });
}

async function list(channel: QueueReviewChannel, preferredResourceId = '', scheduledDate = ''): Promise<QueueReviewBatch[]> {
  const resourceDate = scheduledDate || new Date().toISOString().slice(0, 10);
  const [{ data, error }, availableResources] = await Promise.all([
    getSupabaseClient().rpc('list_open_queue_review', { p_channel: channelKey(channel) }),
    resources(channel, resourceDate),
  ]);
  if (error) throw new Error(error.message);
  const rows = ((data ?? []) as Array<Record<string, unknown>>).map<QueueReviewItem>((row) => ({
    batchId: String(row.batch_id ?? ''),
    reviewItemId: String(row.review_item_id ?? ''),
    channel: String(row.channel_key ?? '') === 'instagram' ? 'instagram' : 'whatsapp',
    resourceId: String(row.resource_id ?? ''),
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
    mapsUrl: '',
    rating: Number(row.rating ?? 0),
    reviews: Number(row.reviews ?? 0),
  }));

  const leadIds = Array.from(new Set(rows.map((row) => Number(row.leadId)).filter((id) => Number.isSafeInteger(id) && id > 0)));
  if (leadIds.length) {
    const mapsResponse = await getSupabaseClient().from('leads').select('leads_id,leads_maps').in('leads_id', leadIds);
    if (mapsResponse.error) throw new Error(mapsResponse.error.message);
    const mapsByLeadId = new Map(((mapsResponse.data ?? []) as Array<{ leads_id?: number | string; leads_maps?: string | null }>).map((row) => [String(row.leads_id ?? ''), String(row.leads_maps ?? '')]));
    rows.forEach((row) => { row.mapsUrl = mapsByLeadId.get(row.leadId) ?? ''; });
  }

  const grouped = new Map<string, QueueReviewBatch>();
  for (const item of rows) {
    let batch = grouped.get(item.batchId);
    if (!batch) {
      const resource = availableResources.find((entry: QueuePreparationResource) => entry.id === item.resourceId);
      batch = {
        batchId: item.batchId,
        channel,
        resourceId: item.resourceId,
        resourceLabel: resource?.label ?? item.resourceId,
        scheduledDate: item.scheduledDate,
        targetCount: item.targetCount,
        items: [],
      };
      grouped.set(item.batchId, batch);
    }
    batch.items.push(item);
  }
  const result = Array.from(grouped.values())
    .filter((batch) => !scheduledDate || batch.scheduledDate === scheduledDate);
  if (!preferredResourceId) return result;
  return result.filter((batch) => {
    const resource = availableResources.find((entry) => entry.id === batch.resourceId);
    return batch.resourceId === preferredResourceId
      || batch.resourceLabel === preferredResourceId
      || resource?.label === preferredResourceId
      || resource?.aliases?.includes(preferredResourceId);
  });
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
  eventBus.emit('import:changed', { source: 'move' });
  eventBus.emit(channel === 'WhatsApp' ? 'whatsapp-queue:changed' : 'instagram-queue:changed', { action: 'update' });
  return data;
}

async function invalidate(item: QueueReviewItem, channel: QueueReviewChannel) {
  const { error } = await getSupabaseClient().rpc('invalidate_queue_review_item', { p_review_item_id: Number(item.reviewItemId) });
  if (error) throw new Error(error.message);
  // R29: invalidar apenas libera a vaga. Nenhum canal repõe automaticamente.

  eventBus.emit('import:changed', { source: 'move' });
}

async function lock(batch: QueueReviewBatch) {
  const leadIds = batch.items.map((item) => item.leadId);
  const prepared = await queuePreparationService.buildReviewLockItems(batch.channel, leadIds);
  if (prepared.failures.length) {
    const first = prepared.failures[0];
    throw new Error(`${first.company ? `${first.company}: ` : ''}${first.reason}`);
  }
  if (prepared.items.length !== leadIds.length) throw new Error('A revisão mudou antes de ser trancada. Atualize e tente novamente.');
  const { data, error } = await getSupabaseClient().rpc('lock_queue_review_batch', {
    p_batch_id: Number(batch.batchId),
    p_items: prepared.items.map((item) => ({ lead_id: Number(item.leadId), template_id: Number(item.templateId) })),
  });
  if (error) throw new Error(error.message);
  eventBus.emit('import:changed', { source: 'move' });
  eventBus.emit(batch.channel === 'WhatsApp' ? 'whatsapp-queue:changed' : 'instagram-queue:changed', { action: 'update' });
  return data;
}

export const queueReviewService = { resources, openBatch, pullToCapacity, fillBatch, list, approve, invalidate };
