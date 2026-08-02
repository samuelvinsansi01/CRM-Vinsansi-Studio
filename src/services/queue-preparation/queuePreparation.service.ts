import { LEAD_STATUS } from '../status/leadStatus';
import { eventBus } from '../../lib/events';
import { repositories } from '../../repositories';
import { supabaseLeadCycleRepository } from '../../repositories/lead-cycle';
import { channelId } from '../../repositories/schemaCatalog';
import type { LeadDatabaseRow } from '../../types/lead.types';
import { branchForBoundRecord } from '../config/branchMedia';
import { isOperationalWhatsAppChip } from '../config/chipOperational';
import type {
  BranchConfigRecord,
  ChipConfigRecord,
  ConfigRecord,
  InstagramConfigRecord,
  TemplateConfigRecord,
} from '../config/types';
import { normalizePhone } from '../import/importValidation';
import { isValidInstagram, normalizeInstagramUsername } from '../instagram/instagram.utils';
import { renderLeadMessages } from '../templates/templateVariables';
import { missingTemplateMessageNumbers } from '../templates/templateContract';
import { settingsService } from '../settings/settings.service';
import { selectTemplateForLead, templateTypeForLead } from '../templates/templateSelector';
import { prepareQueueItems } from '../../repositories/queueSchema';
import { effectiveScheduleDate } from './queuePreparation.rules';
import type {
  QueuePreparationChannel,
  QueuePreparationFailure,
  QueuePreparationLead,
  QueuePreparationResource,
  QueuePreparationResult,
  QueuePreparationSnapshot,
} from './types';


function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function isChip(record: ConfigRecord): record is ChipConfigRecord {
  return record.kind === 'chips';
}

function isInstagramProfile(record: ConfigRecord): record is InstagramConfigRecord {
  return record.kind === 'instagram';
}

function isBranch(record: ConfigRecord): record is BranchConfigRecord {
  return record.kind === 'branches';
}

function isTemplate(record: ConfigRecord): record is TemplateConfigRecord {
  return record.kind === 'templates';
}

function activeInstagramProfile(record: InstagramConfigRecord) {
  return Boolean(record.active && record.status !== 'Arquivado' && record.status !== 'deleted' && normalizeInstagramUsername(record.username));
}

function activeQueueStatus(status: unknown) {
  const value = String(status ?? '').toLowerCase();
  return ['queued', 'sending', 'paused', 'following', 'dm_opened', 'sent'].includes(value);
}

function rowBranch(row: LeadDatabaseRow) {
  return one(row.branches)?.branches_name ?? row.leads_categories?.[0] ?? '';
}

function rowCity(row: LeadDatabaseRow) {
  return one(row.cities)?.cities_name ?? '';
}

function rowState(row: LeadDatabaseRow) {
  const state = one(row.states);
  return state?.states_code ?? state?.states_name ?? '';
}

function leadContext(row: LeadDatabaseRow, channel: QueuePreparationChannel) {
  const website = String(row.leads_website ?? '').trim();
  const destination = channel === 'Instagram' ? 'Instagram' as const : website ? 'Com site' as const : 'WhatsApp' as const;
  return {
    company: row.leads_name,
    company_name: row.leads_name,
    branch: rowBranch(row),
    branch_id: String(row.branches_id),
    city: rowCity(row),
    state: rowState(row),
    phone: row.leads_phone ?? '',
    instagram: row.leads_instagram ?? '',
    site: website,
    mapsUrl: row.leads_maps ?? '',
    channel,
    destination,
    original_destination: destination,
  };
}

async function loadConfiguration() {
  const [chips, profiles, branches, templates, settings] = await Promise.all([
    repositories.config.list('chips'),
    repositories.config.list('instagram'),
    repositories.config.list('branches'),
    repositories.config.list('templates'),
    settingsService.getDispatchSettings(),
  ]);
  return {
    chips: chips.filter(isChip).filter(isOperationalWhatsAppChip),
    profiles: profiles.filter(isInstagramProfile).filter(activeInstagramProfile),
    branches: branches.filter(isBranch),
    templates: templates.filter(isTemplate),
    settings,
  };
}

async function queueUsage(channel: QueuePreparationChannel, scheduledDate: string) {
  if (channel === 'WhatsApp') {
    const leads = (await repositories.whatsappQueue.listBatches({ scheduledDate })).flatMap((batch) => batch.leads);
    const counts = new Map<string, number>();
    for (const lead of leads) {
      if (!activeQueueStatus(lead.status)) continue;
      const id = String(lead.chip_id || '');
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }

  const leads = (await repositories.instagramQueue.listBatches({ scheduledDate })).flatMap((batch) => batch.leads);
  const counts = new Map<string, number>();
  for (const lead of leads) {
    if (!activeQueueStatus(lead.status)) continue;
    const id = String(lead.profile_id || '');
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

function buildResources(
  channel: QueuePreparationChannel,
  usage: Map<string, number>,
  chips: ChipConfigRecord[],
  profiles: InstagramConfigRecord[],
  instagramDefaults: Awaited<ReturnType<typeof settingsService.getDispatchSettings>>['instagram'],
): QueuePreparationResource[] {
  if (channel === 'WhatsApp') {
    return [...chips]
      .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name))
      .map((chip) => {
        const id = String(chip.id);
        const used = usage.get(id) ?? 0;
        const limit = Math.max(1, Number(chip.dailyLimit || 0));
        return {
          id,
          label: chip.name || id,
          aliases: [chip.name, chip.instance].filter(Boolean),
          channel,
          dailyLimit: limit,
          batchSize: Math.max(1, Number(chip.blockSize || 1)),
          used,
          available: Math.max(0, limit - used),
          startTime: chip.startTime,
          endTime: chip.endTime,
        };
      });
  }

  return [...profiles]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((profile) => {
      const id = String(profile.id);
      const used = usage.get(id) ?? 0;
      const limit = Math.max(1, Number(profile.dailyLimit || instagramDefaults.dailyLimit || 1));
      return {
        id,
        label: profile.name || `@${normalizeInstagramUsername(profile.username)}`,
        aliases: [profile.name, profile.username, normalizeInstagramUsername(profile.username)].filter(Boolean),
        channel,
        dailyLimit: limit,
        batchSize: Math.max(1, Number(instagramDefaults.perBatch || 1)),
        used,
        available: Math.max(0, limit - used),
        startTime: instagramDefaults.startTime,
        endTime: instagramDefaults.endTime,
      };
    });
}

function findBranch(row: LeadDatabaseRow, branches: BranchConfigRecord[]) {
  return branchForBoundRecord({
    branch_id: String(row.branches_id),
    branch: rowBranch(row),
  }, branches);
}

function preparationReason(
  row: LeadDatabaseRow,
  channel: QueuePreparationChannel,
  expectedChannelId: number,
  branches: BranchConfigRecord[],
  templates: TemplateConfigRecord[],
) {
  if (row.lead_status_id !== LEAD_STATUS.VALIDATED) return 'O lead não está mais no status Validado.';
  if (Number(row.channels_id) !== expectedChannelId) return 'O canal do lead foi alterado.';
  if (channel === 'WhatsApp' && normalizePhone(row.leads_phone).length < 10) return 'Telefone inválido para WhatsApp.';
  if (channel === 'Instagram' && !isValidInstagram(row.leads_instagram)) return 'Instagram inválido ou ausente.';

  const context = leadContext(row, channel);
  const selection = selectTemplateForLead(context, templates);
  if (!selection) return `Nenhum template ${channel} compatível com o ramo e o tipo ${templateTypeForLead(context)}.`;
  const messages = renderLeadMessages(context, selection.template);
  const missingMessages = missingTemplateMessageNumbers(messages);
  if (missingMessages.length) return `O template precisa ter as 4 mensagens. Ausentes: ${missingMessages.join(', ')}.`;

  const branch = findBranch(row, branches);
  if (branch?.imageRequired && !String(branch.imageName ?? '').trim()) {
    return 'O ramo exige imagem, mas nenhuma mídia foi configurada.';
  }
  return '';
}

function mapPreparationLead(
  row: LeadDatabaseRow,
  channel: QueuePreparationChannel,
  expectedChannelId: number,
  branches: BranchConfigRecord[],
  templates: TemplateConfigRecord[],
): QueuePreparationLead {
  const reason = preparationReason(row, channel, expectedChannelId, branches, templates);
  const context = leadContext(row, channel);
  return {
    id: String(row.leads_id),
    company: row.leads_name,
    branch: context.branch,
    city: context.city,
    state: context.state,
    contact: channel === 'WhatsApp' ? normalizePhone(row.leads_phone) : normalizeInstagramUsername(row.leads_instagram),
    channel,
    score: Number(row.leads_score ?? 0),
    templateType: templateTypeForLead(context),
    ready: !reason,
    blockReason: reason || undefined,
  };
}

function templateIdForLead(
  row: LeadDatabaseRow,
  channel: QueuePreparationChannel,
  templates: TemplateConfigRecord[],
) {
  const selection = selectTemplateForLead(leadContext(row, channel), templates);
  if (!selection) throw new Error(`Nenhum template ${channel} compatível com o lead.`);
  return String(selection.template.id);
}

async function appendAudit(
  row: LeadDatabaseRow,
  channel: QueuePreparationChannel,
  resource: QueuePreparationResource,
  scheduledDate: string,
  queueItemId: string,
) {
  await repositories.events.append({
    source: 'queue-preparation',
    action: 'validated_lead_enqueued',
    channel: channel.toLowerCase() as 'whatsapp' | 'instagram',
    leadId: String(row.leads_id),
    status: '4',
    metadata: {
      flow: 'F06',
      company_name: row.leads_name,
      queue_item_id: queueItemId,
      resource_id: resource.id,
      resource_label: resource.label,
      scheduled_date: scheduledDate,
      previous_status_id: 2,
      target_status_id: 4,
    },
  });
}

function addFailure(result: QueuePreparationResult, failure: QueuePreparationFailure, conflict = false) {
  result.failures.push(failure);
  result.failed = result.failures.length;
  if (conflict) result.conflicts += 1;
}

async function snapshot(
  channel: QueuePreparationChannel,
  requestedDate: string,
  resourceId?: string,
): Promise<QueuePreparationSnapshot> {
  const config = await loadConfiguration();
  const activeDays = channel === 'WhatsApp' ? config.settings.whatsapp.activeDays : config.settings.instagram.activeDays;
  const date = effectiveScheduleDate(requestedDate, activeDays);
  const resolvedChannelId = Number(await channelId(channel));
  const [usage, rows] = await Promise.all([
    queueUsage(channel, date.effectiveDate),
    supabaseLeadCycleRepository.listByStatuses([LEAD_STATUS.VALIDATED], resolvedChannelId),
  ]);
  const resources = buildResources(channel, usage, config.chips, config.profiles, config.settings.instagram);
  const selectedResource = resources.find((resource) => resource.id === resourceId) ?? resources[0];
  const leads = rows
    .map((row) => mapPreparationLead(row, channel, resolvedChannelId, config.branches, config.templates))
    .sort((a, b) => Number(b.ready) - Number(a.ready) || b.score - a.score || a.company.localeCompare(b.company));

  return {
    channel,
    ...date,
    resources,
    selectedResource,
    leads,
    ready: leads.filter((lead) => lead.ready).length,
    blocked: leads.filter((lead) => !lead.ready).length,
    capacity: selectedResource?.available ?? 0,
  };
}

async function enqueueValidated(
  channel: QueuePreparationChannel,
  ids: string[],
  requestedDate: string,
  resourceId: string,
): Promise<QueuePreparationResult> {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (!uniqueIds.length) throw new Error('Selecione pelo menos um lead validado.');

  const config = await loadConfiguration();
  const activeDays = channel === 'WhatsApp' ? config.settings.whatsapp.activeDays : config.settings.instagram.activeDays;
  const date = effectiveScheduleDate(requestedDate, activeDays);
  const result: QueuePreparationResult = {
    channel,
    requested: uniqueIds.length,
    queued: 0,
    conflicts: 0,
    failed: 0,
    effectiveDate: date.effectiveDate,
    resourceId,
    queuedLeadIds: [],
    failures: [],
    auditWarnings: [],
  };

  const usage = await queueUsage(channel, date.effectiveDate);
  const resources = buildResources(channel, usage, config.chips, config.profiles, config.settings.instagram);
  const resource = resources.find((item) => item.id === resourceId);
  if (!resource) throw new Error(channel === 'WhatsApp' ? 'Chip ativo não encontrado.' : 'Perfil Instagram ativo não encontrado.');

  const expectedChannelId = Number(await channelId(channel));
  const rows = await supabaseLeadCycleRepository.listByIds(uniqueIds);
  const byId = new Map(rows.map((row) => [String(row.leads_id), row]));
  const rpcItems: Array<{ leadId: string; templateId: string }> = [];

  for (const id of uniqueIds) {
    const row = byId.get(id);
    if (!row) {
      addFailure(result, { id, reason: 'Lead não encontrado ou sem permissão de acesso.' });
      continue;
    }

    if (row.lead_status_id !== LEAD_STATUS.VALIDATED || Number(row.channels_id) !== expectedChannelId) {
      addFailure(result, { id, company: row.leads_name, reason: 'O lead mudou de status ou canal antes da preparação.' }, true);
      continue;
    }

    const reason = preparationReason(row, channel, expectedChannelId, config.branches, config.templates);
    if (reason) {
      addFailure(result, { id, company: row.leads_name, reason });
      continue;
    }

    rpcItems.push({
      leadId: id,
      templateId: templateIdForLead(row, channel, config.templates),
    });
  }

  if (rpcItems.length) {
    const committed = await prepareQueueItems(channel, resource.id, date.effectiveDate, rpcItems);
    const returned = new Set<string>();

    for (const rowResult of committed) {
      const id = rowResult.leadId;
      returned.add(id);
      const lead = byId.get(id);
      const company = lead?.leads_name;

      if (rowResult.outcome === 'queued' || rowResult.outcome === 'reconciled') {
        result.queued += 1;
        result.queuedLeadIds.push(id);

        if (lead && rowResult.queueItemId) {
          try {
            await appendAudit(lead, channel, resource, date.effectiveDate, rowResult.queueItemId);
          } catch (error) {
            result.auditWarnings.push(`Lead ${id}: ${error instanceof Error ? error.message : 'falha ao registrar auditoria.'}`);
          }
        }
        continue;
      }

      addFailure(result, {
        id,
        company,
        reason: rowResult.reason || 'O banco recusou a preparação deste lead.',
      }, rowResult.outcome === 'conflict');
    }

    for (const item of rpcItems) {
      if (returned.has(item.leadId)) continue;
      addFailure(result, {
        id: item.leadId,
        company: byId.get(item.leadId)?.leads_name,
        reason: 'A transação não retornou um resultado para este lead.',
      });
    }
  }

  result.failed = result.failures.length;
  if (result.queued) {
    eventBus.emit('import:changed', { source: 'move' });
    eventBus.emit(channel === 'WhatsApp' ? 'whatsapp-queue:changed' : 'instagram-queue:changed', { action: 'update' });
  }
  return result;
}

export const queuePreparationService = {
  snapshot,
  enqueueValidated,
  effectiveScheduleDate,
};
