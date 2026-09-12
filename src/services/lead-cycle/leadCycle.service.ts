import { eventBus } from '../../lib/events';
import { supabaseLeadCycleRepository } from '../../repositories/lead-cycle';
import type { LeadDatabaseRow, LeadStatusId, LeadStatusName } from '../../types/lead.types';
import { LEAD_STATUS } from '../status/leadStatus';
import { channelId } from '../../repositories/schemaCatalog';
import { isRoutingNoop, routingDecision, validateRoutingCommand } from './leadRouting.rules';
import { isValidInstagram, normalizeInstagramUsername } from '../instagram/instagram.utils';
import { getEffectiveWhatsAppPhone } from '../leads/leadContact';
import type {
  LeadCycleDetailsInput,
  LeadCycleLead,
  LeadCyclePage,
  LeadCyclePageFilters,
  LeadRoutingCommand,
  LeadRoutingFailure,
  LeadRoutingResult,
} from './types';
import { normalizePageRequest, type PageRequest } from '../pagination/types';

function normalizeEditedPhone(value: string) {
  return value.replace(/\D/g, '');
}

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function mapRow(row: LeadDatabaseRow, whatsappId: number, instagramId: number, noDestinationId: number): LeadCycleLead {
  const branch = one(row.branches);
  const state = one(row.states);
  const city = one(row.cities);
  const source = one(row.contact_sources);
  const status = one(row.lead_status);
  const resolvedChannelId = row.channels_id == null ? null : Number(row.channels_id);
  const channel = resolvedChannelId == null
    ? null
    : resolvedChannelId === instagramId
      ? 'Instagram'
      : resolvedChannelId === noDestinationId
        ? 'Sem destino'
        : 'WhatsApp';

  return {
    id: String(row.leads_id),
    company: row.leads_name,
    alternativeName: row.leads_alternative_name ?? '',
    displayCompany: row.leads_name,
    branchId: String(row.branches_id),
    branch: branch?.branches_name ?? '',
    state: state?.states_code ?? state?.states_name ?? '',
    city: city?.cities_name ?? '',
    phone: getEffectiveWhatsAppPhone(row),
    rawPhone: row.leads_phone ?? '',
    whatsapp: row.leads_whatsapp ?? '',
    instagram: row.leads_instagram ?? '',
    website: row.leads_website ?? '',
    mapsUrl: row.leads_maps ?? '',
    channelId: resolvedChannelId,
    channel,
    contactSourceId: row.contact_sources_id,
    contactSource: source?.contact_sources_name ?? '',
    statusId: row.lead_status_id,
    status: (status?.lead_status_name ?? '') as LeadStatusName,
    createdAt: row.leads_created_at,
    updatedAt: row.leads_updated_at ?? row.leads_created_at,
    rating: Number(row.leads_score ?? 0),
    reviews: Number(row.leads_reviews_count ?? 0),
  };
}


function pagedLead(value: Record<string, unknown>): LeadCycleLead {
  const channel = String(value.channel ?? '').trim();
  return {
    id: String(value.id ?? ''),
    company: String(value.company ?? ''),
    alternativeName: String(value.alternative_name ?? ''),
    displayCompany: String(value.company ?? ''),
    branchId: String(value.branch_id ?? ''),
    branch: String(value.branch ?? ''),
    state: String(value.state ?? ''),
    city: String(value.city ?? ''),
    phone: String(value.phone ?? ''),
    rawPhone: String(value.raw_phone ?? ''),
    whatsapp: String(value.whatsapp ?? ''),
    instagram: String(value.instagram ?? ''),
    website: String(value.website ?? ''),
    mapsUrl: String(value.maps_url ?? ''),
    channelId: value.channel_id == null ? null : Number(value.channel_id),
    channel: channel === 'Instagram' || channel === 'WhatsApp' || channel === 'Sem destino' ? channel : null,
    contactSourceId: Number(value.contact_source_id ?? 0),
    contactSource: String(value.contact_source ?? ''),
    statusId: Number(value.status_id ?? LEAD_STATUS.IMPORTED) as LeadStatusId,
    status: String(value.status ?? 'Importado') as LeadStatusName,
    createdAt: String(value.created_at ?? ''),
    updatedAt: String(value.updated_at ?? value.created_at ?? ''),
    rating: Number(value.rating ?? 0),
    reviews: Number(value.reviews ?? 0),
  };
}

async function listImportedPage(filters: LeadCyclePageFilters, request: Partial<PageRequest> = {}): Promise<LeadCyclePage> {
  const normalized = normalizePageRequest(request);
  const payload = await supabaseLeadCycleRepository.listImportedPage(filters, normalized);
  const rawItems = Array.isArray(payload.items) ? payload.items : [];
  const summary = payload.summary && typeof payload.summary === 'object' && !Array.isArray(payload.summary)
    ? payload.summary as Record<string, unknown>
    : {};
  return {
    items: rawItems.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item)).map(pagedLead),
    total: Math.max(0, Number(payload.total ?? 0)),
    page: Math.max(1, Number(payload.page ?? normalized.page)),
    pageSize: Math.max(1, Number(payload.pageSize ?? payload.page_size ?? normalized.pageSize)),
    summary: {
      total: Math.max(0, Number(summary.total ?? 0)),
      noDestination: Math.max(0, Number(summary.noDestination ?? summary.no_destination ?? 0)),
      whatsapp: Math.max(0, Number(summary.whatsapp ?? 0)),
      instagram: Math.max(0, Number(summary.instagram ?? 0)),
    },
  };
}

async function catalogIds() {
  const [whatsapp, instagram, noDestination] = await Promise.all([
    channelId('WhatsApp'),
    channelId('Instagram'),
    channelId('Sem destino'),
  ]);
  return { whatsapp: Number(whatsapp), instagram: Number(instagram), noDestination: Number(noDestination) };
}

async function listByStatuses(statusIds: LeadStatusId[], filterChannelId?: number): Promise<LeadCycleLead[]> {
  const ids = await catalogIds();
  return (await supabaseLeadCycleRepository.listByStatuses(statusIds, filterChannelId))
    .map((row) => mapRow(row, ids.whatsapp, ids.instagram, ids.noDestination));
}

function emptyRoutingResult(command: LeadRoutingCommand, requested: number): LeadRoutingResult {
  return {
    command,
    requested,
    succeeded: 0,
    unchanged: 0,
    failed: 0,
    succeededIds: [],
    unchangedIds: [],
    failures: [],
    auditWarnings: [],
  };
}

function addFailure(result: LeadRoutingResult, failure: LeadRoutingFailure) {
  result.failures.push(failure);
  result.failed = result.failures.length;
}

async function executeRoutingCommand(command: LeadRoutingCommand, ids: string[]): Promise<LeadRoutingResult> {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (!uniqueIds.length) throw new Error('Selecione pelo menos um lead.');

  const result = emptyRoutingResult(command, uniqueIds.length);
  const rows = await supabaseLeadCycleRepository.listByIds(uniqueIds);
  const rowsById = new Map(rows.map((row) => [String(row.leads_id), row]));

  for (const id of uniqueIds) {
    const before = rowsById.get(id);
    if (!before) {
      addFailure(result, { id, reason: 'Lead não encontrado ou sem permissão de acesso.' });
      continue;
    }
    const reason = validateRoutingCommand(before, command);
    if (reason) {
      addFailure(result, { id, company: before.leads_name, reason });
      continue;
    }

    const decision = routingDecision(command);
    const noop = isRoutingNoop(before, command);
    try {
      const after = await supabaseLeadCycleRepository.compareAndSet(id, decision.expectedStatus, {
        lead_status_id: decision.targetStatus,
      });
      if (!after) {
        addFailure(result, { id, company: before.leads_name, reason: 'O lead foi alterado por outra operação.' });
        continue;
      }
      if (noop) {
        result.unchangedIds.push(id);
        result.unchanged += 1;
      } else {
        result.succeededIds.push(id);
        result.succeeded += 1;
      }
    } catch (error) {
      addFailure(result, {
        id,
        company: before.leads_name,
        reason: error instanceof Error ? error.message : 'Falha inesperada ao atualizar o lead.',
      });
    }
  }

  if (result.succeeded || result.unchanged) eventBus.emit('import:changed', { source: 'move' });
  return result;
}

async function updateDetails(lead: LeadCycleLead, input: LeadCycleDetailsInput) {
  const company = input.company.trim();
  if (!company) throw new Error('Informe o nome da empresa.');

  const branchId = Number(input.branchId);
  if (!Number.isSafeInteger(branchId) || branchId <= 0) throw new Error('Selecione um ramo válido.');

  const rawPhone = normalizeEditedPhone(input.rawPhone);
  const whatsapp = normalizeEditedPhone(input.whatsapp);
  const instagram = normalizeInstagramUsername(input.instagram);
  if (input.instagram.trim() && (!instagram || !isValidInstagram(instagram))) {
    throw new Error('Informe um username ou URL canônica de perfil do Instagram.');
  }

  const effectivePhone = whatsapp || rawPhone;
  if (!effectivePhone && !instagram) throw new Error('Mantenha pelo menos um contato: telefone, WhatsApp ou Instagram.');

  const before = (await supabaseLeadCycleRepository.listByIds([lead.id]))[0];
  if (!before) throw new Error('Lead não encontrado ou sem permissão de acesso.');
  if (before.lead_status_id !== lead.statusId) throw new Error('O lead mudou de status. Atualize a página e tente novamente.');

  const ids = await catalogIds();
  let targetChannelId = before.channels_id == null ? null : Number(before.channels_id);

  let targetStatusId = lead.statusId;
  if (lead.statusId === LEAD_STATUS.IMPORTED || lead.statusId === LEAD_STATUS.NO_CONTACT) {
    targetChannelId = effectivePhone && instagram
      ? ids.noDestination
      : instagram
        ? ids.instagram
        : ids.whatsapp;
    if (lead.statusId === LEAD_STATUS.NO_CONTACT) targetStatusId = LEAD_STATUS.IMPORTED;
  } else if (input.channel === 'Instagram') {
    if (!instagram) throw new Error('Para usar Instagram como destino, informe um Instagram válido.');
    targetChannelId = ids.instagram;
  } else if (input.channel === 'WhatsApp') {
    if (effectivePhone.length < 10) throw new Error('Para usar WhatsApp como destino, informe um telefone ou WhatsApp válido.');
    targetChannelId = ids.whatsapp;
  }

  const updated = await supabaseLeadCycleRepository.compareAndSet(lead.id, lead.statusId, {
    branches_id: branchId,
    leads_name: company,
    leads_alternative_name: input.alternativeName.trim() || null,
    leads_phone: rawPhone || null,
    leads_whatsapp: whatsapp || null,
    leads_instagram: instagram || null,
    leads_website: input.website.trim() || null,
    leads_maps: input.mapsUrl.trim() || null,
    channels_id: targetChannelId,
    ...(targetStatusId !== lead.statusId ? { lead_status_id: targetStatusId } : {}),
  }, before.channels_id == null ? undefined : Number(before.channels_id));
  if (!updated) throw new Error('O lead foi alterado por outra operação. Atualize a página e tente novamente.');

  eventBus.emit('import:changed', { source: 'update' });
  return mapRow(updated, ids.whatsapp, ids.instagram, ids.noDestination);
}


async function getById(id: string): Promise<LeadCycleLead> {
  const row = (await supabaseLeadCycleRepository.listByIds([id]))[0];
  if (!row) throw new Error('Lead não encontrado ou sem permissão de acesso.');
  const ids = await catalogIds();
  return mapRow(row, ids.whatsapp, ids.instagram, ids.noDestination);
}


async function invalidateLead(id: string): Promise<LeadCycleLead> {
  const before = (await supabaseLeadCycleRepository.listByIds([id]))[0];
  if (!before) throw new Error('Lead não encontrado ou sem permissão de acesso.');
  if (![LEAD_STATUS.IMPORTED, LEAD_STATUS.NO_CONTACT].includes(before.lead_status_id as 1 | 3)) {
    throw new Error('Este lead não pode ser invalidado por esta tela no estágio atual.');
  }
  const ids = await catalogIds();
  const updated = await supabaseLeadCycleRepository.compareAndSet(id, before.lead_status_id, {
    lead_status_id: LEAD_STATUS.INVALID,
  }, before.channels_id == null ? undefined : Number(before.channels_id));
  if (!updated) throw new Error('O lead foi alterado por outra operação. Atualize a página e tente novamente.');
  eventBus.emit('import:changed', { source: 'move' });
  return mapRow(updated, ids.whatsapp, ids.instagram, ids.noDestination);
}

async function restoreInvalidToImported(id: string): Promise<LeadCycleLead> {
  const before = (await supabaseLeadCycleRepository.listByIds([id]))[0];
  if (!before) throw new Error('Lead não encontrado ou sem permissão de acesso.');
  if (before.lead_status_id !== LEAD_STATUS.INVALID) throw new Error('Somente leads inválidos podem retornar para Importado por esta ação.');

  const effectivePhone = normalizeEditedPhone(getEffectiveWhatsAppPhone(before));
  const instagram = normalizeInstagramUsername(before.leads_instagram ?? '');
  if (!effectivePhone && !instagram) throw new Error('Edite o lead e informe um WhatsApp/telefone ou Instagram antes de retorná-lo para a operação.');

  const ids = await catalogIds();
  const targetChannelId = effectivePhone && instagram
    ? ids.noDestination
    : instagram
      ? ids.instagram
      : ids.whatsapp;
  const updated = await supabaseLeadCycleRepository.compareAndSet(id, LEAD_STATUS.INVALID, {
    lead_status_id: LEAD_STATUS.IMPORTED,
    channels_id: targetChannelId,
  }, before.channels_id == null ? undefined : Number(before.channels_id));
  if (!updated) throw new Error('O lead foi alterado por outra operação. Atualize a página e tente novamente.');
  eventBus.emit('import:changed', { source: 'move' });
  return mapRow(updated, ids.whatsapp, ids.instagram, ids.noDestination);
}

export const leadCycleService = {
  listImported: () => listByStatuses([LEAD_STATUS.IMPORTED]),
  listImportedPage,
  executeRoutingCommand,
  getById,
  invalidateLead,
  restoreInvalidToImported,
  updateDetails,
};
