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
  LeadRoutingCommand,
  LeadRoutingFailure,
  LeadRoutingResult,
} from './types';

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

  if (lead.statusId === LEAD_STATUS.IMPORTED) {
    targetChannelId = effectivePhone && instagram
      ? ids.noDestination
      : instagram
        ? ids.instagram
        : ids.whatsapp;
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
  }, before.channels_id == null ? undefined : Number(before.channels_id));
  if (!updated) throw new Error('O lead foi alterado por outra operação. Atualize a página e tente novamente.');

  eventBus.emit('import:changed', { source: 'update' });
  return mapRow(updated, ids.whatsapp, ids.instagram, ids.noDestination);
}

export const leadCycleService = {
  listImported: () => listByStatuses([LEAD_STATUS.IMPORTED]),
  executeRoutingCommand,
  updateDetails,
};
