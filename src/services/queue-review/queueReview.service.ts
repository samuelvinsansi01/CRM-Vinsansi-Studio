import { getSupabaseClient } from '../../lib/supabase';
import { eventBus } from '../../lib/events';
import { queuePreparationService } from '../queue-preparation';
import { whatsappValidationService, type PreparedWhatsAppValidationLead } from '../whatsapp-validation/whatsappValidation.service';
import type { QueueReviewBatch, QueueReviewChannel, QueueReviewItem, QueueReviewPullResult, QueueReviewResource } from './types';
import { queueRolloverService } from '../queue-rollover/queueRollover.service';

function rpcRow<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function channelKey(channel: QueueReviewChannel) {
  return channel === 'Instagram' ? 'instagram' : 'whatsapp';
}

function numericIds(ids: string[]) {
  return Array.from(new Set(ids.filter((id) => Number.isSafeInteger(Number(id)) && Number(id) > 0))).map(Number);
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

async function reconcileWhatsApp(batchId: string, approvedIds: string[], releaseIds: string[]) {
  const { data, error } = await getSupabaseClient().rpc('reconcile_queue_review_whatsapp_validation', {
    p_batch_id: Number(batchId),
    p_approved_ids: numericIds(approvedIds),
    p_release_ids: numericIds(releaseIds),
  });
  if (error) throw new Error(error.message);
  return rpcRow(data as Record<string, unknown> | Record<string, unknown>[] | null);
}

async function pullToCapacity(
  channel: QueueReviewChannel,
  resourceKey: string,
  scheduledDate: string,
): Promise<QueueReviewPullResult> {
  const context = await pullCapacity(channel, resourceKey, scheduledDate);
  let { resource } = context;
  const { batchId, reserved, capacityToFill } = context;
  let invalidatedByProvider = 0;
  let redirectedToInstagram = 0;
  let errors = 0;
  let technicalStop = false;
  let ready = 0;
  const movedLeadIds = new Set<string>();

  // R55: o banco calcula a capacidade restante do recurso/data e faz UMA
  // unica reserva ate essa capacidade. Nao existe quantidade manual, refill,
  // oversampling, segunda passagem ou retry automatico dentro do clique.
  const exhausted = capacityToFill > 0 && reserved.length < capacityToFill;

  if (channel === 'WhatsApp' && reserved.length) {
    try {
      const validation = await whatsappValidationService.validatePreparedInitial(reserved, context.providerKey);
      const readyIds = Array.from(new Set([...validation.approvedIds, ...validation.revalidatedIds]));
      const releaseIds = Array.from(new Set([...validation.errorIds, ...validation.conflictIds]));
      const reconciled = await reconcileWhatsApp(batchId, readyIds, releaseIds);
      readyIds.forEach((id) => movedLeadIds.add(id));
      validation.invalidatedIds.forEach((id) => movedLeadIds.add(id));
      validation.redirectedIds.forEach((id) => movedLeadIds.add(id));
      invalidatedByProvider += validation.invalidated;
      redirectedToInstagram += validation.redirectedToInstagram;
      errors += validation.errors + validation.failed;
      technicalStop = releaseIds.length > 0;
      ready = readyIds.length;

      const openCount = Math.max(0, Number(reconciled?.openCount ?? reconciled?.open_count ?? 0));
      if (openCount < readyIds.length) {
        throw new Error('A validação terminou, mas o banco não manteve todos os leads prontos na Revisão. A reserva deste clique será liberada para evitar uma fila invisível.');
      }
      const missingCount = Math.max(0, Number(reconciled?.missingCount ?? reconciled?.missing_count ?? resource.available));
      resource = { ...resource, available: missingCount };
    } catch (error) {
      // Falha antes de um resultado persistido: libera somente estes reservados.
      // Nao existe nova reserva nem retry dentro desta acao.
      await reconcileWhatsApp(batchId, [], reserved.map((lead) => lead.id)).catch(() => undefined);
      throw error;
    }
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
    movedLeadIds: Array.from(movedLeadIds),
  };
}

async function pull(channel: QueueReviewChannel, scheduledDate: string, preferredResourceId: string) {
  await queueRolloverService.run();
  if (!preferredResourceId) {
    throw new Error(channel === 'WhatsApp'
      ? 'Selecione um chip específico antes de puxar e validar a fila WhatsApp.'
      : 'Selecione um perfil específico antes de puxar a fila Instagram.');
  }
  if (!scheduledDate) throw new Error('Selecione a data que receberá os leads.');
  return pullToCapacity(channel, preferredResourceId, scheduledDate);
}

async function list(channel: QueueReviewChannel, preferredResourceId = '', scheduledDate = ''): Promise<QueueReviewBatch[]> {
  await queueRolloverService.run();
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
  let prepared = await queuePreparationService.buildReviewLockItems(channel, [item.leadId]);

  // Reparacao rara/legada: se faltar prova, revalida somente este lead no chip
  // do batch e reconcilia pelo mesmo contrato atomico R54/R55.
  const missingWhatsAppProof = channel === 'WhatsApp'
    && prepared.failures.some((failure) => failure.id === item.leadId && failure.reason.includes('Prova de validação WhatsApp ausente'));
  if (missingWhatsAppProof) {
    const validation = await whatsappValidationService.validateInitialWithChip([item.leadId], item.resourceId);
    const readyIds = Array.from(new Set([...validation.approvedIds, ...validation.revalidatedIds]));
    const retryable = Array.from(new Set([...validation.errorIds, ...validation.conflictIds]));
    await reconcileWhatsApp(item.batchId, readyIds, retryable);
    if (!readyIds.includes(item.leadId)) {
      const failure = validation.failures.find((candidate) => candidate.id === item.leadId);
      throw new Error(`${item.company}: ${failure?.reason || 'O telefone não foi confirmado no WhatsApp pelo chip selecionado.'}`);
    }
    prepared = await queuePreparationService.buildReviewLockItems(channel, [item.leadId]);
  }

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
  if (!approval || approval.contractVersion !== 'R46' || approval.persisted !== true || approval.reviewStatus !== 'locked' || !approval.queueItemId) {
    const { data: stateData, error: stateError } = await getSupabaseClient().rpc('queue_review_approval_state', {
      p_review_item_id: Number(item.reviewItemId),
    });
    if (stateError) {
      throw new Error(`A aprovação não retornou a confirmação R46 e o estado persistido não pôde ser conferido: ${stateError.message}. Aplique o SQL R46 no Supabase.`);
    }
    const state = rpcRow(stateData as Record<string, unknown> | Record<string, unknown>[] | null);
    if (!state || state.contractVersion !== 'R46' || state.persisted !== true) {
      const detail = state?.reason ? ` (${String(state.reason)})` : '';
      throw new Error(`A aprovação não foi persistida no banco${detail}. Aplique o SQL R46 no Supabase e tente novamente.`);
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
