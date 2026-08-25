import { eventBus } from '../../lib/events';
import { repositories } from '../../repositories';
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

function mapRow(row: LeadDatabaseRow, whatsappId: number, instagramId: number): LeadCycleLead {
  const branch = one(row.branches);
  const state = one(row.states);
  const city = one(row.cities);
  const source = one(row.contact_sources);
  const status = one(row.lead_status);
  const resolvedChannelId = Number(row.channels_id ?? whatsappId);

  return {
    id: String(row.leads_id),
    company: row.leads_name,
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
    channel: resolvedChannelId === instagramId ? 'Instagram' : 'WhatsApp',
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

async function listByStatuses(statusIds: LeadStatusId[], filterChannelId?: number): Promise<LeadCycleLead[]> {
  const [whatsappId, instagramId] = await Promise.all([channelId('WhatsApp'), channelId('Instagram')]);
  return (await supabaseLeadCycleRepository.listByStatuses(statusIds, filterChannelId)).map((row) => mapRow(row, Number(whatsappId), Number(instagramId)));
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

function commandChannel(command: LeadRoutingCommand): 'whatsapp' | 'instagram' | undefined {
  if (command.includes('whatsapp')) return 'whatsapp';
  if (command.includes('instagram')) return 'instagram';
  return undefined;
}

async function appendRoutingAudit(
  command: LeadRoutingCommand,
  before: LeadDatabaseRow,
  after: LeadDatabaseRow,
) {
  await repositories.events.append({
    source: 'lead-routing',
    action: command,
    channel: commandChannel(command),
    leadId: String(after.leads_id),
    status: String(after.lead_status_id),
    metadata: {
      company_name: after.leads_name,
      previous_status_id: before.lead_status_id,
      target_status_id: after.lead_status_id,
      previous_channel_id: before.channels_id,
      target_channel_id: after.channels_id,
      flow: 'F04',
    },
  });
}

function addFailure(result: LeadRoutingResult, failure: LeadRoutingFailure) {
  result.failures.push(failure);
  result.failed = result.failures.length;
}

function prevalidateBatch(
  ids: string[],
  rowsById: Map<string, LeadDatabaseRow>,
  command: LeadRoutingCommand,
) {
  const failures: LeadRoutingFailure[] = [];

  for (const id of ids) {
    const row = rowsById.get(id);
    if (!row) {
      failures.push({ id, reason: 'Lead não encontrado ou sem permissão de acesso.' });
      continue;
    }
    const reason = validateRoutingCommand(row, command);
    if (reason) failures.push({ id, company: row.leads_name, reason });
  }

  return failures;
}

async function executeRoutingCommand(command: LeadRoutingCommand, ids: string[]): Promise<LeadRoutingResult> {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (!uniqueIds.length) throw new Error('Selecione pelo menos um lead.');

  const result = emptyRoutingResult(command, uniqueIds.length);
  const rows = await supabaseLeadCycleRepository.listByIds(uniqueIds);
  const rowsById = new Map(rows.map((row) => [String(row.leads_id), row]));
  const validationFailures = prevalidateBatch(uniqueIds, rowsById, command);

  // Não inicia um lote quando já sabemos que parte da seleção é inválida.
  // Isso evita alterações parciais causadas por erro de entrada ou seleção desatualizada.
  if (validationFailures.length) {
    const invalidIds = new Set(validationFailures.map((failure) => failure.id));
    validationFailures.forEach((failure) => addFailure(result, failure));
    uniqueIds
      .filter((id) => !invalidIds.has(id))
      .forEach((id) => addFailure(result, {
        id,
        company: rowsById.get(id)?.leads_name,
        reason: 'Ação não executada porque o lote contém leads inválidos ou desatualizados.',
      }));
    return result;
  }

  const decision = routingDecision(command);
  const targetChannelId = decision.targetChannel ? Number(await channelId(decision.targetChannel)) : undefined;
  for (const id of uniqueIds) {
    const before = rowsById.get(id)!;
    const noop = isRoutingNoop(before, command, targetChannelId);

    try {
      // Mesmo quando o destino já é o atual, executamos o compare-and-set.
      // Isso confirma que o status não mudou entre a leitura e a ação do usuário.
      const after = await supabaseLeadCycleRepository.compareAndSet(id, decision.expectedStatus, {
        lead_status_id: decision.targetStatus,
        ...(targetChannelId ? { channels_id: targetChannelId } : {}),
      });

      if (!after) {
        addFailure(result, {
          id,
          company: before.leads_name,
          reason: 'O lead foi alterado por outra operação. Atualize a tela e tente novamente.',
        });
        continue;
      }

      if (noop) {
        result.unchangedIds.push(id);
        result.unchanged += 1;
        continue;
      }

      result.succeededIds.push(id);
      result.succeeded += 1;

      try {
        await appendRoutingAudit(command, before, after);
      } catch (error) {
        result.auditWarnings.push(
          `Lead ${id}: ${error instanceof Error ? error.message : 'falha ao registrar auditoria.'}`,
        );
      }
    } catch (error) {
      addFailure(result, {
        id,
        company: before.leads_name,
        reason: error instanceof Error ? error.message : 'Falha inesperada ao atualizar o lead.',
      });
    }
  }

  if (result.succeeded || result.unchanged) {
    eventBus.emit('import:changed', { source: 'move' });
  }
  return result;
}


async function updateDetails(lead: LeadCycleLead, input: LeadCycleDetailsInput) {
  const company = input.company.trim();
  if (!company) throw new Error('Informe o nome da empresa.');

  const rawPhone = normalizeEditedPhone(input.rawPhone);
  const whatsapp = normalizeEditedPhone(input.whatsapp);
  const instagram = normalizeInstagramUsername(input.instagram);
  if (input.instagram.trim() && (!instagram || !isValidInstagram(instagram))) {
    throw new Error('Informe um username ou URL canônica de perfil do Instagram.');
  }
  if (!rawPhone && !whatsapp && !instagram) {
    throw new Error('Mantenha pelo menos um contato: telefone, WhatsApp ou Instagram.');
  }

  if (input.channel === 'Instagram' && (!instagram || !isValidInstagram(instagram))) {
    throw new Error('Para usar Instagram como destino, informe um Instagram válido.');
  }
  if (input.channel === 'WhatsApp' && (whatsapp || rawPhone).length < 10) {
    throw new Error('Para usar WhatsApp como destino, informe um telefone ou WhatsApp válido.');
  }
  if (lead.statusId === LEAD_STATUS.PRE_SEND && input.channel !== lead.channel) {
    throw new Error('O destino não pode ser alterado enquanto o lead estiver aguardando validação.');
  }

  const before = (await supabaseLeadCycleRepository.listByIds([lead.id]))[0];
  if (!before) throw new Error('Lead não encontrado ou sem permissão de acesso.');
  if (before.lead_status_id !== lead.statusId) {
    throw new Error('O lead mudou de status. Atualize a página e tente novamente.');
  }

  const [whatsappId, instagramId] = await Promise.all([channelId('WhatsApp'), channelId('Instagram')]);
  const targetChannelId = input.channel === 'Instagram' ? Number(instagramId) : Number(whatsappId);
  const updated = await supabaseLeadCycleRepository.compareAndSet(lead.id, lead.statusId, {
    leads_name: company,
    leads_phone: rawPhone || null,
    leads_whatsapp: whatsapp || null,
    leads_instagram: instagram || null,
    leads_website: input.website.trim() || null,
    leads_maps: input.mapsUrl.trim() || null,
    channels_id: targetChannelId,
  }, Number(before.channels_id));
  if (!updated) throw new Error('O lead foi alterado por outra operação. Atualize a página e tente novamente.');

  try {
    await repositories.events.append({
      source: 'lead-routing',
      action: 'edit-details',
      channel: input.channel.toLowerCase() as 'whatsapp' | 'instagram',
      leadId: lead.id,
      status: String(updated.lead_status_id),
      metadata: {
        company_name: updated.leads_name,
        previous_phone: before.leads_phone,
        previous_whatsapp: before.leads_whatsapp,
        previous_instagram: before.leads_instagram,
        previous_channel_id: before.channels_id,
        target_channel_id: targetChannelId,
        flow: 'F04',
      },
    });
  } catch {
    // A edição canônica não deve ser revertida por falha secundária de auditoria.
  }

  eventBus.emit('import:changed', { source: 'update' });
  return mapRow(updated, Number(whatsappId), Number(instagramId));
}

async function updateImportedInstagram(id: string, value: string) {
  const username = normalizeInstagramUsername(value);
  if (!username || !isValidInstagram(username)) throw new Error('Informe um username ou URL canônica de perfil do Instagram.');
  const instagramId = Number(await channelId('Instagram'));
  const updated = await supabaseLeadCycleRepository.compareAndSet(id, LEAD_STATUS.IMPORTED, { leads_instagram: username }, instagramId);
  if (!updated) throw new Error('O lead mudou de status ou destino. Atualize a página e tente novamente.');
  eventBus.emit('import:changed', { source: 'move' });
  return mapRow(updated, Number(await channelId('WhatsApp')), instagramId);
}

export const leadCycleService = {
  listImported: () => listByStatuses([LEAD_STATUS.IMPORTED]),
  listValid: () => listByStatuses([LEAD_STATUS.VALIDATED]),
  listPreSend: async () => listByStatuses([LEAD_STATUS.PRE_SEND], Number(await channelId('WhatsApp'))),
  executeRoutingCommand,
  updateDetails,
  updateImportedInstagram,
};
