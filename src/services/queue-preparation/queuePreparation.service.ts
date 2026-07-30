import { LEAD_STATUS } from '../status/leadStatus';
import { eventBus } from '../../lib/events';
import { repositories } from '../../repositories';
import { supabaseLeadCycleRepository } from '../../repositories/lead-cycle';
import { channelId } from '../../repositories/schemaCatalog';
import type { LeadDatabaseRow } from '../../types/lead.types';
import { branchForBoundRecord } from '../config/branchMedia';
import { chipInstance, isOperationalWhatsAppChip } from '../config/chipOperational';
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
import type { CreateInstagramQueueLeadInput, InstagramQueueLead } from '../instagram-queue/types';
import type { CreateWhatsAppQueueLeadInput, WhatsAppQueueLead } from '../whatsapp-queue/types';
import { effectiveScheduleDate } from './queuePreparation.rules';
import type {
  QueuePreparationChannel,
  QueuePreparationFailure,
  QueuePreparationLead,
  QueuePreparationResource,
  QueuePreparationResult,
  QueuePreparationSnapshot,
} from './types';

const activeCommits = new Set<string>();

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

function resourceKey(channel: QueuePreparationChannel, id: string, date: string) {
  return `${channel}:${id}:${date}`;
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
      const id = lead.chip_instance || lead.chip;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }

  const leads = (await repositories.instagramQueue.listBatches({ scheduledDate })).flatMap((batch) => batch.leads);
  const counts = new Map<string, number>();
  for (const lead of leads) {
    if (!activeQueueStatus(lead.status)) continue;
    counts.set(lead.profile, (counts.get(lead.profile) ?? 0) + 1);
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
        const id = chipInstance(chip);
        const used = usage.get(id) ?? 0;
        const limit = Math.max(1, Number(chip.dailyLimit || 0));
        return {
          id,
          label: chip.name || id,
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
      const id = normalizeInstagramUsername(profile.username);
      const used = usage.get(id) ?? 0;
      const limit = Math.max(1, Number(profile.dailyLimit || instagramDefaults.dailyLimit || 1));
      return {
        id,
        label: profile.name || `@${id}`,
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

function prepareWhatsAppInput(
  row: LeadDatabaseRow,
  resource: QueuePreparationResource,
  scheduledDate: string,
  expectedChannelId: number,
  chips: ChipConfigRecord[],
  branches: BranchConfigRecord[],
  templates: TemplateConfigRecord[],
): CreateWhatsAppQueueLeadInput {
  const reason = preparationReason(row, 'WhatsApp', expectedChannelId, branches, templates);
  if (reason) throw new Error(reason);
  const context = leadContext(row, 'WhatsApp');
  const selection = selectTemplateForLead(context, templates)!;
  const messages = renderLeadMessages(context, selection.template);
  const branch = findBranch(row, branches);
  const chip = chips.find((item) => chipInstance(item) === resource.id);
  if (!chip) throw new Error('O chip selecionado não está mais ativo ou conectado.');

  return {
    lead_id: String(row.leads_id),
    company: row.leads_name,
    phone: normalizePhone(row.leads_phone),
    branch: context.branch,
    branch_id: String(row.branches_id),
    branch_slug: branch?.slug,
    type: context.site ? 'Com site' : 'Sem site',
    original_destination: context.original_destination,
    status: 'queued',
    chip: resource.id,
    chip_instance: resource.id,
    chip_label: resource.label,
    chip_id: String(chip.id),
    scheduled_date: scheduledDate,
    batchLimit: resource.batchSize,
    template_id: selection.template.id,
    message1: messages.message1,
    message2: messages.message2,
    message3: messages.message3,
    message4: messages.message4,
    imageName: branch?.imageName ?? '',
    imageRequired: Boolean(branch?.imageRequired),
    image_url: branch?.imageRequired ? branch.imageName : '',
    city: context.city,
    state: context.state,
    site: context.site,
    instagram: context.instagram,
    instagram_url: context.instagram,
    mapsUrl: context.mapsUrl,
  };
}

function prepareInstagramInput(
  row: LeadDatabaseRow,
  resource: QueuePreparationResource,
  scheduledDate: string,
  expectedChannelId: number,
  profiles: InstagramConfigRecord[],
  branches: BranchConfigRecord[],
  templates: TemplateConfigRecord[],
): CreateInstagramQueueLeadInput {
  const reason = preparationReason(row, 'Instagram', expectedChannelId, branches, templates);
  if (reason) throw new Error(reason);
  const context = leadContext(row, 'Instagram');
  const selection = selectTemplateForLead(context, templates)!;
  const messages = renderLeadMessages(context, selection.template);
  const branch = findBranch(row, branches);
  const profile = profiles.find((item) => normalizeInstagramUsername(item.username) === resource.id);
  if (!profile) throw new Error('O perfil Instagram selecionado não está mais ativo.');

  return {
    lead_id: String(row.leads_id),
    company: row.leads_name,
    instagram: normalizeInstagramUsername(row.leads_instagram),
    instagram_url: row.leads_instagram ?? '',
    profile: resource.id,
    branch: context.branch,
    branch_id: String(row.branches_id),
    branch_slug: branch?.slug,
    type: 'Instagram',
    original_destination: 'Instagram',
    send_instagram: true,
    status: 'queued',
    scheduled_date: scheduledDate,
    batchLimit: resource.batchSize,
    template_id: selection.template.id,
    message1: messages.message1,
    message2: messages.message2,
    message3: messages.message3,
    message4: messages.message4,
    imageName: branch?.imageName ?? '',
    imageRequired: Boolean(branch?.imageRequired),
    image_url: branch?.imageRequired ? branch.imageName : '',
    city: context.city,
    state: context.state,
    phone: context.phone,
    site: context.site,
    mapsUrl: context.mapsUrl,
  };
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

async function existingQueuedLeadIds(channel: QueuePreparationChannel, scheduledDate: string) {
  if (channel === 'WhatsApp') {
    return new Set((await repositories.whatsappQueue.listBatches({ scheduledDate }))
      .flatMap((batch) => batch.leads)
      .map((lead: WhatsAppQueueLead) => String(lead.lead_id))
      .filter(Boolean));
  }
  return new Set((await repositories.instagramQueue.listBatches({ scheduledDate }))
    .flatMap((batch) => batch.leads)
    .map((lead: InstagramQueueLead) => String(lead.lead_id))
    .filter(Boolean));
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
  const lockKey = resourceKey(channel, resourceId, date.effectiveDate);
  if (activeCommits.has(lockKey)) throw new Error('Já existe uma preparação em andamento para este recurso e esta data.');
  activeCommits.add(lockKey);

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

  try {
    const usage = await queueUsage(channel, date.effectiveDate);
    const resources = buildResources(channel, usage, config.chips, config.profiles, config.settings.instagram);
    const resource = resources.find((item) => item.id === resourceId);
    if (!resource) throw new Error(channel === 'WhatsApp' ? 'Chip ativo não encontrado.' : 'Perfil Instagram ativo não encontrado.');
    if (resource.available <= 0) throw new Error('A capacidade diária deste recurso já foi atingida.');

    const expectedChannelId = Number(await channelId(channel));
    const rows = await supabaseLeadCycleRepository.listByIds(uniqueIds);
    const byId = new Map(rows.map((row) => [String(row.leads_id), row]));
    const alreadyQueued = await existingQueuedLeadIds(channel, date.effectiveDate);
    let remainingCapacity = resource.available;

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
      if (remainingCapacity <= 0) {
        addFailure(result, { id, company: row.leads_name, reason: 'Sem capacidade diária disponível para este recurso.' });
        continue;
      }

      const reason = preparationReason(row, channel, expectedChannelId, config.branches, config.templates);
      if (reason) {
        addFailure(result, { id, company: row.leads_name, reason });
        continue;
      }

      // Se o item já existe na fila, apenas reconcilia o status canônico.
      if (alreadyQueued.has(id)) {
        const reconciled = await supabaseLeadCycleRepository.compareAndSet(id, LEAD_STATUS.VALIDATED, { lead_status_id: LEAD_STATUS.QUEUED });
        if (!reconciled) {
          addFailure(result, { id, company: row.leads_name, reason: 'O item já existe na fila, mas o lead foi alterado por outra operação.' }, true);
          continue;
        }
        result.queued += 1;
        result.queuedLeadIds.push(id);
        remainingCapacity -= 1;
        continue;
      }

      let queueItemId = '';
      try {
        const createdIds = channel === 'WhatsApp'
          ? await repositories.whatsappQueue.enqueue([
              prepareWhatsAppInput(row, resource, date.effectiveDate, expectedChannelId, config.chips, config.branches, config.templates),
            ])
          : await repositories.instagramQueue.enqueue([
              prepareInstagramInput(row, resource, date.effectiveDate, expectedChannelId, config.profiles, config.branches, config.templates),
            ]);

        queueItemId = createdIds[0] ?? '';
        if (!queueItemId) {
          addFailure(result, { id, company: row.leads_name, reason: 'O item não foi criado porque já existe uma duplicidade ativa na fila.' }, true);
          continue;
        }

        const updated = await supabaseLeadCycleRepository.compareAndSet(id, LEAD_STATUS.VALIDATED, { lead_status_id: LEAD_STATUS.QUEUED });
        if (!updated) {
          if (channel === 'WhatsApp') await repositories.whatsappQueue.removeQueued(queueItemId);
          else await repositories.instagramQueue.removeQueued(queueItemId);
          addFailure(result, { id, company: row.leads_name, reason: 'O lead foi alterado por outra operação; o item recém-criado foi desfeito.' }, true);
          continue;
        }

        result.queued += 1;
        result.queuedLeadIds.push(id);
        alreadyQueued.add(id);
        remainingCapacity -= 1;

        try {
          await appendAudit(row, channel, resource, date.effectiveDate, queueItemId);
        } catch (error) {
          result.auditWarnings.push(`Lead ${id}: ${error instanceof Error ? error.message : 'falha ao registrar auditoria.'}`);
        }
      } catch (error) {
        if (queueItemId) {
          try {
            if (channel === 'WhatsApp') await repositories.whatsappQueue.removeQueued(queueItemId);
            else await repositories.instagramQueue.removeQueued(queueItemId);
          } catch {
            // A reconciliação completa de compensações falhas pertence ao F10.
          }
        }
        addFailure(result, {
          id,
          company: row.leads_name,
          reason: error instanceof Error ? error.message : 'Falha inesperada ao preparar a fila.',
        });
      }
    }

    if (result.queued) {
      eventBus.emit('import:changed', { source: 'move' });
      eventBus.emit(channel === 'WhatsApp' ? 'whatsapp-queue:changed' : 'instagram-queue:changed', { action: 'update' });
    }
    return result;
  } finally {
    activeCommits.delete(lockKey);
  }
}

export const queuePreparationService = {
  snapshot,
  enqueueValidated,
  effectiveScheduleDate,
};
