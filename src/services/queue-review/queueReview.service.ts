import { getSupabaseClient } from '../../lib/supabase';
import { eventBus } from '../../lib/events';
import { queuePreparationService } from '../queue-preparation';
import { whatsappValidationService, type PreparedWhatsAppValidationLead } from '../whatsapp-validation/whatsappValidation.service';
import type { QueueReviewBatch, QueueReviewChannel, QueueReviewItem, QueueReviewPullResult, QueueReviewResource } from './types';

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
};

function resourceFromRow(channel: QueueReviewChannel, value: Record<string, unknown>): QueueReviewResource {
  return {
    id: String(value.resource_id ?? value.resourceId ?? ''),
    label: String(value.resource_label ?? value.resourceLabel ?? value.resource_id ?? ''),
    channel,
    dailyLimit: Number(value.daily_limit ?? value.dailyLimit ?? 0),
    available: Math.max(0, Number(value.available ?? value.missingCount ?? value.missing_count ?? 0)),
  };
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

async function pullCapacity(channel: QueueReviewChannel, resourceKey: string, scheduledDate: string): Promise<PullCapacityContext> {
  const { data, error } = await getSupabaseClient().rpc('pull_queue_review_to_capacity', {
    p_channel: channelKey(channel),
    p_resource_key: resourceKey,
    p_scheduled_date: scheduledDate,
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
    capacityToFill: Math.max(0, Number(row.capacityToFill ?? row.capacity_to_fill ?? 0)),
    reserved,
  };
}

async function pullToCapacity(
  channel: QueueReviewChannel,
  resourceKey: string,
  scheduledDate: string,
): Promise<QueueReviewPullResult> {
  const context = await pullCapacity(channel, resourceKey, scheduledDate);
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

async function pull(channel: QueueReviewChannel, scheduledDate: string, preferredResourceId: string) {
  if (!preferredResourceId) {
    throw new Error(channel === 'WhatsApp'
      ? 'Selecione um chip específico antes de puxar e validar a fila WhatsApp.'
      : 'Selecione um perfil específico antes de puxar a fila Instagram.');
  }
  if (!scheduledDate) throw new Error('Selecione a data que receberá os leads.');
  return pullToCapacity(channel, preferredResourceId, scheduledDate);
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

export const queueReviewService = { resources, pull, list, approve, invalidate };
