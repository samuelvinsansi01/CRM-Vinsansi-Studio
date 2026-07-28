import { getSupabaseClient } from '../../lib/supabase';
import { eventBus } from '../../lib/events';
import { repositories } from '../../repositories';
import { supabaseLeadCycleRepository } from '../../repositories/lead-cycle';
import { getCurrentUserId } from '../../repositories/supabase.helpers';
import type { LeadDatabaseRow, LeadStatusId, LeadStatusName } from '../../types/lead.types';
import { isRoutingNoop, routingDecision, validateRoutingCommand } from './leadRouting.rules';
import type {
  LeadCycleLead,
  LeadCycleUpdate,
  LeadRoutingCommand,
  LeadRoutingFailure,
  LeadRoutingResult,
} from './types';

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function mapRow(row: LeadDatabaseRow): LeadCycleLead {
  const branch = one(row.branches);
  const state = one(row.states);
  const city = one(row.cities);
  const source = one(row.contact_sources);
  const status = one(row.lead_status);
  const channelId = row.channels_id === 2 ? 2 : 1;

  return {
    id: String(row.leads_id),
    company: row.leads_name,
    branch: branch?.branches_name ?? row.leads_categories?.[0] ?? '',
    state: state?.states_code ?? state?.states_name ?? '',
    city: city?.cities_name ?? '',
    phone: row.leads_phone ?? '',
    instagram: row.leads_instagram ?? '',
    website: row.leads_website ?? '',
    mapsUrl: row.leads_maps ?? '',
    channelId,
    channel: channelId === 2 ? 'Instagram' : 'WhatsApp',
    contactSourceId: row.contact_sources_id,
    contactSource: source?.contact_sources_name ?? '',
    statusId: row.lead_status_id,
    status: (status?.lead_status_name ?? '') as LeadStatusName,
    createdAt: row.leads_created_at,
    updatedAt: row.leads_updated_at ?? row.leads_created_at,
  };
}

async function listByStatuses(statusIds: LeadStatusId[], channelId?: 1 | 2): Promise<LeadCycleLead[]> {
  return (await supabaseLeadCycleRepository.listByStatuses(statusIds, channelId)).map(mapRow);
}

/**
 * API temporária para os fluxos que ainda não foram migrados para comandos.
 * O F04 usa exclusivamente executeRoutingCommand.
 */
async function update(ids: string[], input: LeadCycleUpdate, expectedStatuses?: LeadStatusId[]) {
  if (!ids.length) return;
  const numericIds = Array.from(new Set(ids)).map(Number);
  if (numericIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    throw new Error('Um ou mais identificadores de lead são inválidos.');
  }

  const userId = await getCurrentUserId();
  let query = getSupabaseClient()
    .from('leads')
    .update({ ...input, leads_updated_at: new Date().toISOString() })
    .in('leads_id', numericIds)
    .eq('users_id', userId);
  if (expectedStatuses?.length) query = query.in('lead_status_id', expectedStatuses);
  const { error } = await query;
  if (error) throw new Error(error.message);
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
  for (const id of uniqueIds) {
    const before = rowsById.get(id)!;
    const noop = isRoutingNoop(before, command);

    try {
      // Mesmo quando o destino já é o atual, executamos o compare-and-set.
      // Isso confirma que o status não mudou entre a leitura e a ação do usuário.
      const after = await supabaseLeadCycleRepository.compareAndSet(id, decision.expectedStatus, {
        lead_status_id: decision.targetStatus,
        ...(decision.targetChannel ? { channels_id: decision.targetChannel } : {}),
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

export const leadCycleService = {
  listImported: () => listByStatuses([1]),
  listValid: () => listByStatuses([2]),
  listPreSend: () => listByStatuses([3], 1),
  executeRoutingCommand,
  update,
};
