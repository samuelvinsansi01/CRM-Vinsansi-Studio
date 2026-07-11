import { eventBus } from '../../lib/events';
import { repositories } from '../../repositories';
import type { EventLogInput } from '../../repositories/events/eventLog.repository';
import { dateInputAddDays, toLocalDateInputValue } from '../../utils/date';
import { settingsService } from '../settings/settings.service';
import type { BranchConfigRecord, ChipConfigRecord, ConfigRecord, InstagramConfigRecord, TemplateConfigRecord } from '../config/types';
import { chipInstance, chipLevelDefaults, inferChipLevelFromConfig, isOperationalWhatsAppChip } from '../config/chipOperational';
import { normalizePhone } from '../import/importValidation';
import { isValidInstagram, normalizeInstagramUsername } from '../instagram/instagram.utils';
import { sortByLeadScore } from '../lead-score/leadScore.service';
import type { ImportLead } from '../import/types';
import type { CreateInstagramQueueLeadInput, InstagramQueueLead } from '../instagram-queue/types';
import type { CreateBaseLeadInput } from '../base/types';
import { isStatusGroup, normalizeStatusGroup } from '../status/status.mapper';
import { assertTransition } from '../state-machine';
import { renderLeadMessages } from '../templates/templateVariables';
import { selectTemplateForLead, templateTypeForLead } from '../templates/templateSelector';
import type { CreateWhatsAppQueueLeadInput, WhatsAppQueueLead } from '../whatsapp-queue/types';
import { preSendLeadToWhatsAppValidationRequest, whatsappValidationGateway, WhatsAppValidationUnavailableError } from '../whatsapp-validation/whatsappValidation.gateway';
import type { CreatePreSendLeadInput, InstagramQueueFillResult, PreSendCapacity, PreSendChannel, PreSendDayCard, PreSendFilters, PreSendLead, PreSendQueueFilter, PreSendValidationSummary } from './types';

type QueueAssignmentOptions = {
  whatsappProfile?: string;
  instagramProfile?: string;
};

type ImportToPreSendOverrides = {
  dayId?: string;
  profile?: string;
  forceApproved?: boolean;
};

const WEEK_DAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const MONTH_NAMES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

const ROLLOVER_HOUR = 22;

function dayId(channel: PreSendChannel, label: string) {
  return `${channel.toLowerCase()}-${label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')}`;
}

function startOfCurrentWeek(reference = new Date()) {
  const start = new Date(reference);
  start.setHours(12, 0, 0, 0);
  start.setDate(start.getDate() - start.getDay());
  return start;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function dateForWeekdayIndex(index: number, reference = new Date()) {
  return addDays(startOfCurrentWeek(reference), index);
}

function formatWeekDateLabel(weekday: string, date: Date) {
  return `${weekday}, ${date.getDate()} de ${MONTH_NAMES[date.getMonth()]}`;
}

function normalize(value: unknown) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function isChip(record: ConfigRecord): record is ChipConfigRecord {
  return record.kind === 'chips';
}

function isBranch(record: ConfigRecord): record is BranchConfigRecord {
  return record.kind === 'branches';
}

function isTemplate(record: ConfigRecord): record is TemplateConfigRecord {
  return record.kind === 'templates';
}

function isInstagramProfile(record: ConfigRecord): record is InstagramConfigRecord {
  return record.kind === 'instagram';
}

function whatsappDispatch(settings: Awaited<ReturnType<typeof settingsService.getDispatchSettings>>) {
  return settings.whatsapp;
}

function instagramDispatch(settings: Awaited<ReturnType<typeof settingsService.getDispatchSettings>>) {
  return settings.instagram;
}

async function whatsappChannelLimit() {
  const chips = await loadActiveChips();
  return chips.reduce((total, chip) => total + Math.max(1, chip.dailyLimit), 0);
}

async function channelLimit(channel: PreSendChannel, settings: Awaited<ReturnType<typeof settingsService.getDispatchSettings>>) {
  return channel === 'WhatsApp' ? whatsappChannelLimit() : instagramDispatch(settings).dailyLimit;
}

function channelDays(channel: PreSendChannel, settings: Awaited<ReturnType<typeof settingsService.getDispatchSettings>>) {
  return channel === 'WhatsApp' ? whatsappDispatch(settings).activeDays : instagramDispatch(settings).activeDays;
}

function firstDayId(channel: PreSendChannel, settings: Awaited<ReturnType<typeof settingsService.getDispatchSettings>>) {
  const [firstDay] = channelDays(channel, settings);
  return effectiveDayId(channel, dayId(channel, firstDay ?? 'Geral'));
}

function scheduledDate() {
  return toLocalDateInputValue();
}

function dayKeyFromId(id: string) {
  return id
    .replace(/^whatsapp-/, '')
    .replace(/^instagram-/, '');
}

function formatDateLabel(date: Date) {
  return `${date.getDate()} de ${MONTH_NAMES[date.getMonth()]}`;
}

function weekdayIndexFromDayId(id: string) {
  const key = dayKeyFromId(id);
  return WEEK_DAYS.findIndex((weekday) => dayId('WhatsApp', weekday).replace(/^whatsapp-/, '') === key);
}

function currentDayId(channel: PreSendChannel, reference = new Date()) {
  return dayId(channel, WEEK_DAYS[reference.getDay()]);
}

function nextDayId(channel: PreSendChannel, id: string) {
  const index = weekdayIndexFromDayId(id);
  const nextIndex = index >= 0 ? index + 1 : new Date().getDay() + 1;
  return dayId(channel, WEEK_DAYS[nextIndex % WEEK_DAYS.length]);
}

function isRolloverCutoffPassed(reference = new Date()) {
  return reference.getHours() >= ROLLOVER_HOUR;
}

function effectiveDayId(channel: PreSendChannel, requestedDayId: string, reference = new Date()) {
  if (isRolloverCutoffPassed(reference) && requestedDayId === currentDayId(channel, reference)) {
    return nextDayId(channel, requestedDayId);
  }

  return requestedDayId;
}

/**
 * O prefixo do identificador de dia sempre acompanha o canal.
 * Isso recupera registros legados que ficaram como whatsapp-terca após
 * migrarem para Instagram e impede que desapareçam do card correto.
 */
function canonicalDayIdForChannel(channel: PreSendChannel, requestedDayId: string) {
  const weekday = dayKeyFromId(requestedDayId) || dayKeyFromId(currentDayId(channel));
  return `${channel.toLowerCase()}-${weekday}`;
}

function operationalDayIdForChannel(channel: PreSendChannel, requestedDayId: string, reference = new Date()) {
  return effectiveDayId(channel, canonicalDayIdForChannel(channel, requestedDayId), reference);
}

function scheduledDateForDayId(id: string) {
  const index = weekdayIndexFromDayId(id);
  if (index < 0) return scheduledDate();
  return toLocalDateInputValue(dateForWeekdayIndex(index));
}

function isActivePreSendStatus(status: PreSendLead['status']) {
  return isStatusGroup(status, 'review') || isStatusGroup(status, 'approved') || isStatusGroup(status, 'queued');
}

function isVisiblePreSendStatus(status: PreSendLead['status']) {
  return isStatusGroup(status, 'review') || isStatusGroup(status, 'approved') || isStatusGroup(status, 'rejected') || isStatusGroup(status, 'invalid');
}

function isLikelyValidWhatsApp(value: unknown) {
  return normalizePhone(value).length >= 10;
}

function isActiveWhatsAppQueueStatus(status: unknown) {
  return isStatusGroup(status, 'queued') || isStatusGroup(status, 'paused') || isStatusGroup(status, 'sending');
}

function isMovableWhatsAppQueueStatus(status: unknown) {
  return isStatusGroup(status, 'queued') || isStatusGroup(status, 'paused');
}

function isActiveInstagramQueueStatus(status: unknown) {
  return isStatusGroup(status, 'queued') || isStatusGroup(status, 'paused') || isStatusGroup(status, 'following') || isStatusGroup(status, 'dm_opened');
}

function isMovableInstagramQueueStatus(status: unknown) {
  return isStatusGroup(status, 'queued') || isStatusGroup(status, 'paused');
}

function assertStatusPatch(current: PreSendLead, input: Partial<PreSendLead>) {
  if (input.status === undefined || normalizeStatusGroup(input.status) === normalizeStatusGroup(current.status)) return;
  assertTransition({ entity: 'pre-send', fromStatus: current.status, toStatus: input.status, action: 'status_update' });
}

function isUnassignedProfile(value: unknown) {
  const profile = normalize(value);
  return !profile || ['geral', 'todos', 'default', 'sem chip ativo', 'sem perfil'].includes(profile);
}

function matchesSelectedProfile(lead: PreSendLead, profile?: string) {
  if (!profile) return true;
  return lead.profile === profile || isUnassignedProfile(lead.profile);
}

async function listFilteredLeads(filters: PreSendFilters) {
  await rolloverPreSendAfterCutoff();
  const leads = await repositories.preSend.listLeads({ ...filters, profile: undefined });

  return sortByLeadScore(leads.filter((lead) => {
    if (!isVisiblePreSendStatus(lead.status)) return false;

    // Retornos do WhatsApp ficam no card Instagram do próprio Pré-Envio.
    // Eles não devem desaparecer quando o perfil ainda estiver vazio, legado ou
    // diferente do perfil selecionado, porque não consomem capacidade até entrar
    // efetivamente na fila Instagram.
    if (filters.channel === 'Instagram' && isInstagramReturn(lead)) {
      return true;
    }

    return matchesSelectedProfile(lead, filters.profile);
  }));
}

async function listAllLeads() {
  const [whatsapp, instagram] = await Promise.all([
    repositories.preSend.listLeads({ channel: 'WhatsApp' }),
    repositories.preSend.listLeads({ channel: 'Instagram' }),
  ]);
  return [...whatsapp, ...instagram];
}

async function rolloverPreSendAfterCutoff() {
  if (!isRolloverCutoffPassed()) return;

  const leads = await listAllLeads();
  const updates = leads
    .filter((lead) => isActivePreSendStatus(lead.status))
    .filter((lead) => lead.dayId === currentDayId(lead.channel))
    .map((lead) => repositories.preSend.updateLead(lead.id, { dayId: nextDayId(lead.channel, lead.dayId) }));

  if (!updates.length) return;
  await Promise.all(updates);
  eventBus.emit('pre-send:changed', { action: 'rollover' });
}

type QueueAllocationSnapshot = {
  counts: Map<string, number>;
  preSendIds: Set<string>;
};

async function rolloverWhatsAppQueueAfterCutoff(targetDate: string) {
  const chips = (await repositories.config.list('chips')).filter(isChip).filter(isOperationalWhatsAppChip);
  const chipMap = new Map(chips.map((chip) => [chipInstance(chip), chip]));
  if (!chipMap.size) return 0;

  const allLeads = (await repositories.whatsappQueue.listBatches({})).flatMap((batch) => batch.leads);
  const candidates = allLeads
    .filter((lead) => isMovableWhatsAppQueueStatus(lead.status) && lead.scheduled_date < targetDate)
    .filter((lead) => chipMap.has(lead.chip_instance || lead.chip))
    .sort((a, b) => `${a.scheduled_date}:${a.batch_number}:${a.position}:${a.created_at}`.localeCompare(`${b.scheduled_date}:${b.batch_number}:${b.position}:${b.created_at}`));

  if (!candidates.length) return 0;

  const candidateIds = new Set(candidates.map((lead) => lead.id));
  const occupancy = new Map<string, number>();

  for (const lead of allLeads) {
    if (candidateIds.has(lead.id) || !isActiveWhatsAppQueueStatus(lead.status)) continue;
    const instance = lead.chip_instance || lead.chip;
    if (!chipMap.has(instance)) continue;
    const key = `${instance}:${lead.scheduled_date}`;
    occupancy.set(key, (occupancy.get(key) ?? 0) + 1);
  }

  for (const lead of candidates) {
    const instance = lead.chip_instance || lead.chip;
    const chip = chipMap.get(instance);
    if (!chip) continue;
    const dailyLimit = Math.max(1, chip.dailyLimit);
    const batchLimit = Math.max(1, chip.blockSize);
    let scheduledDate = targetDate;
    let key = `${instance}:${scheduledDate}`;

    while ((occupancy.get(key) ?? 0) >= dailyLimit) {
      scheduledDate = dateInputAddDays(scheduledDate, 1);
      key = `${instance}:${scheduledDate}`;
    }

    const nextPosition = (occupancy.get(key) ?? 0) + 1;
    const batchNumber = Math.floor((nextPosition - 1) / batchLimit) + 1;
    occupancy.set(key, nextPosition);

    await repositories.whatsappQueue.updateLead(lead.id, {
      scheduled_date: scheduledDate,
      position: nextPosition,
      batch_number: batchNumber,
      batch_id: `wa-batch-${instance}-${scheduledDate}-${batchNumber}`,
    });
  }

  eventBus.emit('whatsapp-queue:changed', { action: 'update' });
  return candidates.length;
}

async function rolloverInstagramQueueAfterCutoff(targetDate: string) {
  const settings = await settingsService.getDispatchSettings();
  const dailyLimit = Math.max(1, settings.instagram.dailyLimit);
  const batchLimit = Math.max(1, settings.instagram.perBatch);
  const allLeads = (await repositories.instagramQueue.listBatches({})).flatMap((batch) => batch.leads);
  const candidates = allLeads
    .filter((lead) => isMovableInstagramQueueStatus(lead.status) && lead.scheduled_date < targetDate)
    .sort((a, b) => `${a.scheduled_date}:${a.batch_number}:${a.position}:${a.created_at}`.localeCompare(`${b.scheduled_date}:${b.batch_number}:${b.position}:${b.created_at}`));

  if (!candidates.length) return 0;

  const candidateIds = new Set(candidates.map((lead) => lead.id));
  const occupancy = new Map<string, number>();

  for (const lead of allLeads) {
    if (candidateIds.has(lead.id) || !isActiveInstagramQueueStatus(lead.status)) continue;
    const key = `${lead.profile}:${lead.scheduled_date}`;
    occupancy.set(key, (occupancy.get(key) ?? 0) + 1);
  }

  for (const lead of candidates) {
    let scheduledDate = targetDate;
    let key = `${lead.profile}:${scheduledDate}`;

    while ((occupancy.get(key) ?? 0) >= dailyLimit) {
      scheduledDate = dateInputAddDays(scheduledDate, 1);
      key = `${lead.profile}:${scheduledDate}`;
    }

    const nextPosition = (occupancy.get(key) ?? 0) + 1;
    const batchNumber = Math.floor((nextPosition - 1) / batchLimit) + 1;
    occupancy.set(key, nextPosition);

    await repositories.instagramQueue.updateLead(lead.id, {
      scheduled_date: scheduledDate,
      position: nextPosition,
      batch_number: batchNumber,
      batch_id: `ig-batch-${lead.profile}-${scheduledDate}-${batchNumber}`,
    });
  }

  eventBus.emit('instagram-queue:changed', { action: 'update' });
  return candidates.length;
}

async function rolloverQueuesAfterCutoff() {
  if (!isRolloverCutoffPassed()) return;
  const targetDate = dateInputAddDays(toLocalDateInputValue(), 1);
  await Promise.all([
    rolloverWhatsAppQueueAfterCutoff(targetDate),
    rolloverInstagramQueueAfterCutoff(targetDate),
  ]);
}

function addQueueAllocation(snapshot: QueueAllocationSnapshot, channel: PreSendChannel, scheduledDate: string, lead: { sourcePreSendId?: string; status: unknown }) {
  const active = channel === 'WhatsApp' ? isActiveWhatsAppQueueStatus(lead.status) : isActiveInstagramQueueStatus(lead.status);
  if (!active) return;
  const key = `${channel}:${scheduledDate}`;
  snapshot.counts.set(key, (snapshot.counts.get(key) ?? 0) + 1);
  if (lead.sourcePreSendId) snapshot.preSendIds.add(lead.sourcePreSendId);
}

async function queueAllocationsByDate(): Promise<QueueAllocationSnapshot> {
  await rolloverQueuesAfterCutoff();
  const [whatsappBatches, instagramBatches] = await Promise.all([
    repositories.whatsappQueue.listBatches({}),
    repositories.instagramQueue.listBatches({}),
  ]);
  const snapshot: QueueAllocationSnapshot = { counts: new Map(), preSendIds: new Set() };

  whatsappBatches.flatMap((batch) => batch.leads).forEach((lead: WhatsAppQueueLead) => {
    addQueueAllocation(snapshot, 'WhatsApp', lead.scheduled_date, lead);
  });
  instagramBatches.flatMap((batch) => batch.leads).forEach((lead: InstagramQueueLead) => {
    addQueueAllocation(snapshot, 'Instagram', lead.scheduled_date, lead);
  });

  return snapshot;
}

async function scheduledDayCards(): Promise<PreSendDayCard[]> {
  await rolloverPreSendAfterCutoff();
  const settings = await settingsService.getDispatchSettings();
  const [leads, queueAllocations, whatsappLimit] = await Promise.all([
    listAllLeads(),
    queueAllocationsByDate(),
    channelLimit('WhatsApp', settings),
  ]);
  const instagramLimit = await channelLimit('Instagram', settings);
  const todayIndex = new Date().getDay();

  return (['WhatsApp', 'Instagram'] as PreSendChannel[]).flatMap((channel) =>
    WEEK_DAYS.map((weekday, index) => {
      const id = dayId(channel, weekday);
      const date = dateForWeekdayIndex(index);
      const scheduledDate = toLocalDateInputValue(date);
      const preSendQueued = channel === 'WhatsApp'
        ? leads.filter((lead) =>
            lead.channel === channel &&
            lead.dayId === id &&
            isActivePreSendStatus(lead.status) &&
            !queueAllocations.preSendIds.has(lead.id),
          ).length
        : 0;
      const queued = preSendQueued + (queueAllocations.counts.get(`${channel}:${scheduledDate}`) ?? 0);

      return {
        id,
        channel,
        label: formatWeekDateLabel(weekday, date),
        queued,
        limit: channel === 'WhatsApp' ? whatsappLimit : instagramLimit,
        isToday: index === todayIndex,
      };
    }),
  );
}

async function assertQueueLimits(ids: string[]) {
  const settings = await settingsService.getDispatchSettings();
  const [leads, whatsappLimit, instagramLimit] = await Promise.all([
    listAllLeads(),
    channelLimit('WhatsApp', settings),
    channelLimit('Instagram', settings),
  ]);
  const selected = leads.filter((lead) => ids.includes(lead.id) && isStatusGroup(lead.status, 'approved'));
  const queuedByDay = new Map<string, number>();

  for (const lead of leads) {
    if (!isStatusGroup(lead.status, 'queued')) continue;
    const key = `${lead.channel}:${lead.dayId}`;
    queuedByDay.set(key, (queuedByDay.get(key) ?? 0) + 1);
  }

  for (const lead of selected) {
    const key = `${lead.channel}:${lead.dayId}`;
    const limit = lead.channel === 'WhatsApp' ? whatsappLimit : instagramLimit;
    const current = queuedByDay.get(key) ?? 0;
    if (current >= limit) throw new Error(`Limite diario atingido para ${lead.channel}.`);
    queuedByDay.set(key, current + 1);
  }
}

function importFinalDestination(lead: ImportLead): PreSendLead['destination'] | null {
  if (lead.send_instagram) return 'Instagram';
  const destination = lead.destination ?? lead.destino;
  if (destination === 'WhatsApp' || destination === 'Com site' || destination === 'Agregadores' || destination === 'Instagram') return destination;
  return null;
}

function importDestinationToChannel(lead: ImportLead): PreSendChannel | null {
  if (!isStatusGroup(lead.status, 'approved')) return null;
  const destination = importFinalDestination(lead);
  if (destination === 'Instagram') return 'Instagram';
  if (destination === 'WhatsApp' || destination === 'Com site' || destination === 'Agregadores') return 'WhatsApp';
  return null;
}

function importToPreSendLead(
  lead: ImportLead,
  settings: Awaited<ReturnType<typeof settingsService.getDispatchSettings>>,
  defaultWhatsAppChip = '',
  defaultInstagramProfile = '',
  overrides: ImportToPreSendOverrides = {},
): CreatePreSendLeadInput | null {
  const channel = importDestinationToChannel(lead);
  if (!channel) return null;
  const destination = importFinalDestination(lead);
  if (!destination) return null;
  const instagramUrl = lead.instagram_url ?? lead.instagram;
  const originalDestination =
    lead.original_destination === 'WhatsApp' ||
    lead.original_destination === 'Com site' ||
    lead.original_destination === 'Agregadores' ||
    lead.original_destination === 'Instagram'
      ? lead.original_destination
      : destination;
  const destinationOverride =
    lead.send_instagram
      ? 'Instagram'
      : lead.destination_override === 'WhatsApp' ||
          lead.destination_override === 'Com site' ||
          lead.destination_override === 'Agregadores' ||
          lead.destination_override === 'Instagram'
        ? lead.destination_override
        : undefined;

  if (lead.send_instagram && !isValidInstagram(instagramUrl)) {
    throw new Error('Lead sem Instagram valido');
  }

  const templateType = templateTypeForLead({
    channel,
    destination,
    original_destination: originalDestination,
    site: lead.site,
  });

  return {
    sourceImportId: lead.id,
    company: lead.empresa,
    branch: lead.ramo,
    branch_id: lead.branch_id,
    branch_slug: lead.branch_slug,
    channel,
    destination,
    original_destination: originalDestination,
    templateType,
    destination_override: destinationOverride,
    send_instagram: lead.send_instagram ?? false,
    instagram_url: instagramUrl,
    instagram_override_reason: lead.instagram_override_reason,
    override_by: lead.override_by,
    override_at: lead.override_at,
    profile: overrides.profile ?? (channel === 'Instagram' ? defaultInstagramProfile : defaultWhatsAppChip),
    dayId: effectiveDayId(channel, overrides.dayId ?? firstDayId(channel, settings)),
    status: overrides.forceApproved || channel === 'Instagram' ? 'approved' : 'review',
    phone: lead.whatsapp,
    instagram: lead.instagram,
    site: lead.site,
    mapsUrl: lead.normalizedMapsUrl,
    city: lead.cidade,
    state: lead.estado,
  };
}

function importLeadMatchesQueueFilter(lead: ImportLead, filter?: PreSendQueueFilter) {
  if (!filter || filter === 'Geral') return true;
  const destination = importFinalDestination(lead);
  if (filter === 'WhatsApp') return destination === 'WhatsApp';
  return destination === 'Com site' || destination === 'Agregadores';
}


async function releasePreSendLinksForImports(imports: ImportLead[], channel: PreSendChannel) {
  const sourceIds = new Set(imports.map((lead) => lead.id).filter(Boolean));
  if (!sourceIds.size) return;
  const existing = await repositories.preSend.listLeads({ channel, queueFilter: 'Geral' });
  const stale = existing.filter((lead) =>
    lead.sourceImportId &&
    sourceIds.has(lead.sourceImportId) &&
    (isStatusGroup(lead.status, 'review') || isStatusGroup(lead.status, 'approved')),
  );
  await Promise.all(stale.map((lead) => repositories.preSend.archiveLead(lead.id)));
}

async function approvedImportsForPreSend(channel: PreSendChannel, queueFilter?: PreSendQueueFilter) {
  const approved = await repositories.import.list({ status: 'approved' });
  return sortByLeadScore(approved.filter((lead) => importDestinationToChannel(lead) === channel && importLeadMatchesQueueFilter(lead, queueFilter)));
}

async function markImportsQueued(imports: ImportLead[]) {
  const queuedAt = new Date().toISOString();
  imports.forEach((lead) => assertTransition({ entity: 'import', fromStatus: lead.status, toStatus: 'queued', action: 'queue' }));
  await Promise.all(imports.map((lead) =>
    repositories.import.update(lead.id, {
      status: 'queued',
      queued_at: queuedAt,
    } as Partial<ImportLead>),
  ));
  eventBus.emit('import:changed', { source: 'pre-send' });
}

/** Mantem a importacao sincronizada com a conclusao real registrada na fila/Base. */
async function markSourceImportsSent(leads: PreSendLead[], reason: string, sentAt = new Date().toISOString()) {
  const sourceIds = Array.from(new Set(leads.map((lead) => lead.sourceImportId).filter((id): id is string => Boolean(id))));
  if (!sourceIds.length) return 0;

  const statuses = ['pending', 'approved', 'rejected', 'invalid', 'review', 'queued', 'sent', 'archived'] as const;
  const records = (await Promise.all(statuses.map((status) => repositories.import.list({ status })))).flat();
  const importsById = new Map(records.map((lead) => [lead.id, lead]));
  let updated = 0;

  await Promise.all(leads.map(async (lead) => {
    if (!lead.sourceImportId) return;
    const source = importsById.get(lead.sourceImportId);
    if (!source || isStatusGroup(source.status, 'sent')) return;

    assertTransition({ entity: 'import', fromStatus: source.status, toStatus: 'sent', action: 'mark_sent' });
    await repositories.import.update(source.id, {
      status: 'sent',
      motivo: reason,
      destino: lead.destination,
      destination: lead.destination,
      original_destination: lead.original_destination ?? lead.destination,
      destination_override: lead.destination_override,
      send_instagram: lead.send_instagram,
      instagram_url: lead.instagram_url,
      instagram_override_reason: lead.instagram_override_reason,
      override_by: lead.override_by,
      override_at: lead.override_at,
      sent_at: sentAt,
    } as Partial<ImportLead>);
    updated += 1;
  }));

  return updated;
}

async function loadTemplate(lead: PreSendLead) {
  const templates = (await repositories.config.list('templates')).filter(isTemplate);
  const expectedType = templateTypeForLead(lead);
  const selection = selectTemplateForLead({ ...lead, templateType: expectedType }, templates);

  // Registros legados não guardavam o tipo do template. Persistimos a
  // classificação antes da fila para que uma troca de canal não altere a
  // abordagem (com-site/sem-site) em tentativas futuras.
  if (!lead.id.startsWith('direct-import-')) {
    const shouldPersistType = lead.templateType !== expectedType;
    const shouldPersistTemplate = Boolean(selection) && lead.templateId !== selection?.template.id;
    if (shouldPersistType || shouldPersistTemplate) {
      await repositories.preSend.updateLead(lead.id, {
        templateType: expectedType,
        ...(selection
          ? {
              templateId: selection.template.id,
              templateAssignedAt: new Date().toISOString(),
              templateSelectionSource: selection.source,
            }
          : {}),
      });
    }
  }

  return selection?.template;
}

async function loadBranches() {
  return (await repositories.config.list('branches')).filter(isBranch);
}

function branchMediaForLead(lead: PreSendLead, branches: BranchConfigRecord[]) {
  const branch =
    branches.find((item) => lead.branch_id && item.id === lead.branch_id) ??
    branches.find((item) => normalize(item.name) === normalize(lead.branch));

  return {
    imageName: branch?.imageName ?? '',
    // Compatibilidade para ramos antigos: se ja havia um nome de imagem,
    // a imagem continua obrigatoria ate o usuario escolher o modo opcional.
    imageRequired: branch?.imageRequired ?? Boolean(branch?.imageName),
  };
}

function assertTemplate(lead: PreSendLead, template: TemplateConfigRecord | undefined): asserts template is TemplateConfigRecord {
  if (!template || !template.message1.trim()) {
    const requiredType = templateTypeForLead(lead);
    throw new Error(`Template ${requiredType} valido ausente para ${lead.channel} / ${lead.branch}.`);
  }
}

async function loadActiveChips() {
  const settings = await settingsService.getDispatchSettings();
  const chips = (await repositories.config.list('chips'))
    .filter(isChip)
    .filter(isOperationalWhatsAppChip)
    .sort((a, b) => a.priority - b.priority);

  return chips.map((chip) => {
    const inferredLevel = inferChipLevelFromConfig({
      level: chip.level,
      dailyLimit: chip.dailyLimit,
      batchCount: Math.max(1, Array.isArray(chip.batches) && chip.batches.length ? chip.batches.length : Math.round(Number(chip.dailyLimit || 0) / Math.max(1, Number(chip.blockSize || 1)))),
      intervalSeconds: chip.intervalSeconds,
      batches: Array.isArray(chip.batches) ? chip.batches : [],
      startTime: chip.startTime,
      endTime: chip.endTime,
    }, settings.chipLevels);

    return {
      ...chip,
      level: inferredLevel,
      ...chipLevelDefaults(inferredLevel, settings.chipLevels),
    };
  });
}

async function loadActiveInstagramProfiles() {
  return (await repositories.config.list('instagram'))
    .filter(isInstagramProfile)
    .filter((profile) => profile.active && profile.status !== 'Arquivado' && profile.status !== 'deleted' && profile.username.trim())
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

async function activeChipByInstance(instance: string) {
  const chips = await loadActiveChips();
  return chips.find((chip) => chipInstance(chip) === instance);
}

async function assignProfilesAndLimitCapacity(leads: PreSendLead[], options: QueueAssignmentOptions = {}): Promise<PreSendLead[]> {
  const settings = await settingsService.getDispatchSettings();
  const [chips, instagramProfiles, whatsappBatches, instagramBatches] = await Promise.all([
    loadActiveChips(),
    loadActiveInstagramProfiles(),
    repositories.whatsappQueue.listBatches({}),
    repositories.instagramQueue.listBatches({}),
  ]);
  const whatsappUsage = new Map<string, number>();
  const instagramUsage = new Map<string, number>();

  for (const batch of whatsappBatches) {
    for (const lead of batch.leads) {
      const key = `${batch.chip}:${lead.scheduled_date}`;
      whatsappUsage.set(key, (whatsappUsage.get(key) ?? 0) + 1);
    }
  }

  for (const batch of instagramBatches) {
    for (const lead of batch.leads) {
      const key = `${batch.profile}:${lead.scheduled_date}`;
      instagramUsage.set(key, (instagramUsage.get(key) ?? 0) + 1);
    }
  }

  const assigned: PreSendLead[] = [];

  for (const lead of leads) {
    const selectedDate = scheduledDateForDayId(lead.dayId);

    if (lead.channel === 'WhatsApp') {
      if (!chips.length) throw new Error('Nenhum chip ativo configurado.');
      const requestedProfile = options.whatsappProfile || (isUnassignedProfile(lead.profile) ? '' : lead.profile);
      const chip = requestedProfile ? chips.find((item) => chipInstance(item) === requestedProfile) : chips[0];
      if (!chip) throw new Error(`Chip ${requestedProfile || 'selecionado'} inativo, offline ou indisponivel.`);
      const instance = chipInstance(chip);
      const key = `${instance}:${selectedDate}`;
      const current = whatsappUsage.get(key) ?? 0;
      if (current >= chip.dailyLimit) continue;
      whatsappUsage.set(key, current + 1);
      assigned.push(lead.profile === instance ? lead : { ...lead, profile: instance });
      continue;
    }

    if (!instagramProfiles.length) throw new Error('Nenhum perfil Instagram ativo configurado.');
    const requestedProfile = options.instagramProfile || (isUnassignedProfile(lead.profile) ? '' : lead.profile);
    const profile = requestedProfile
      ? instagramProfiles.find((item) => item.username === normalizeInstagramUsername(requestedProfile))
      : instagramProfiles[0];
    if (!profile) throw new Error(`Perfil Instagram ${requestedProfile || 'selecionado'} inativo ou indisponivel.`);
    const username = profile.username;
    const key = `${username}:${selectedDate}`;
    const current = instagramUsage.get(key) ?? 0;
    if (current >= instagramDispatch(settings).dailyLimit) continue;
    instagramUsage.set(key, current + 1);
    assigned.push(lead.profile === username ? lead : { ...lead, profile: username });
  }

  return assigned;
}

async function toWhatsAppQueueLeads(leads: PreSendLead[]): Promise<CreateWhatsAppQueueLeadInput[]> {
  const chips = await loadActiveChips();
  if (!chips.length) throw new Error('Nenhum chip ativo configurado.');
  const branches = await loadBranches();
  const existingBatches = await repositories.whatsappQueue.listBatches({});
  const usageByChip = new Map<string, number>();

  for (const batch of existingBatches) {
    for (const lead of batch.leads) {
      const key = `${batch.chip}:${lead.scheduled_date}`;
      usageByChip.set(key, (usageByChip.get(key) ?? 0) + 1);
    }
  }

  const queueLeads: CreateWhatsAppQueueLeadInput[] = [];

  for (const lead of leads) {
    if (!normalizePhone(lead.phone).trim()) throw new Error(`Lead sem WhatsApp valido: ${lead.company}.`);
    const template = await loadTemplate(lead);
    assertTemplate(lead, template);
    const selectedChip = lead.profile ? await activeChipByInstance(lead.profile) : chips[0];
    const selectedDate = scheduledDateForDayId(lead.dayId);
    const usageKey = selectedChip ? `${chipInstance(selectedChip)}:${selectedDate}` : '';
    const availableChip = selectedChip && (usageByChip.get(usageKey) ?? 0) < selectedChip.dailyLimit ? selectedChip : undefined;

    if (!availableChip) throw new Error(`Chip ${lead.profile || 'selecionado'} inativo, offline ou com limite diario atingido.`);
    const instance = chipInstance(availableChip);
    const branchMedia = branchMediaForLead(lead, branches);
    const messages = renderLeadMessages(lead, template);
    usageByChip.set(usageKey, (usageByChip.get(usageKey) ?? 0) + 1);

    queueLeads.push({
      lead_id: lead.sourceImportId ?? lead.id,
      sourcePreSendId: lead.id,
      company: lead.company,
      phone: lead.phone ?? '',
      branch: lead.branch,
      branch_id: lead.branch_id,
      branch_slug: lead.branch_slug,
      type: templateTypeForLead(lead) === 'com-site' ? 'Com site' : 'Sem site',
      original_destination: lead.original_destination,
      destination_override: lead.destination_override,
      send_instagram: lead.send_instagram,
      instagram_url: lead.instagram_url,
      instagram_override_reason: lead.instagram_override_reason,
      override_by: lead.override_by,
      override_at: lead.override_at,
      status: 'queued',
      chip: instance,
      chip_instance: instance,
      chip_label: availableChip.name,
      chip_id: availableChip.id,
      message1: messages.message1,
      message2: messages.message2,
      imageName: branchMedia.imageName,
      imageRequired: branchMedia.imageRequired,
      image_url: branchMedia.imageRequired ? branchMedia.imageName : '',
      template_id: template.id,
      scheduled_date: selectedDate,
      city: lead.city,
      state: lead.state,
      site: lead.site,
      instagram: lead.instagram,
      mapsUrl: lead.mapsUrl,
      batchLimit: availableChip.blockSize,
    });
  }

  return queueLeads;
}

async function toInstagramQueueLeads(leads: PreSendLead[]): Promise<CreateInstagramQueueLeadInput[]> {
  const settings = await settingsService.getDispatchSettings();
  const activeProfiles = await loadActiveInstagramProfiles();
  const branches = await loadBranches();
  const limit = instagramDispatch(settings).perBatch;
  const baseLeads = await repositories.base.list({});
  const baseInstagrams = new Set(baseLeads.map((lead) => normalizeInstagramUsername(lead.normalizedInstagram ?? lead.instagram)).filter(Boolean));

  return Promise.all(
    leads.map(async (lead) => {
      const instagram = lead.instagram_url || lead.instagram || '';
      const normalizedInstagram = normalizeInstagramUsername(instagram);
      if (!isValidInstagram(instagram)) throw new Error('Lead sem Instagram valido');
      if (normalizedInstagram && baseInstagrams.has(normalizedInstagram)) throw new Error(`Instagram ja existe na Base Permanente: ${instagram}.`);
      const template = await loadTemplate(lead);
      assertTemplate(lead, template);
      const branchMedia = branchMediaForLead(lead, branches);
      const messages = renderLeadMessages(lead, template);
      const selectedProfile =
        activeProfiles.find((profile) => profile.username === normalizeInstagramUsername(lead.profile)) ??
        activeProfiles[0];
      if (!selectedProfile) throw new Error('Nenhum perfil Instagram ativo configurado.');

      return {
        lead_id: lead.sourceImportId ?? '',
        sourcePreSendId: lead.id,
        company: lead.company,
        instagram,
        profile: selectedProfile.username,
        profile_id: selectedProfile.id,
        branch: lead.branch,
        branch_id: lead.branch_id,
        branch_slug: lead.branch_slug,
        type: lead.destination === 'Instagram' || lead.destination === 'Agregadores' ? 'Instagram' : 'Sem WhatsApp',
        original_destination: lead.original_destination,
        destination_override: lead.destination_override,
        send_instagram: lead.send_instagram,
        instagram_url: lead.instagram_url,
        instagram_override_reason: lead.instagram_override_reason,
        override_by: lead.override_by,
        override_at: lead.override_at,
        status: 'queued' as const,
        message1: messages.message1,
        message2: messages.message2,
        imageName: branchMedia.imageName,
        imageRequired: branchMedia.imageRequired,
        image_url: branchMedia.imageRequired ? branchMedia.imageName : '',
        template_id: template.id,
        scheduled_date: scheduledDateForDayId(lead.dayId),
        city: lead.city,
        state: lead.state,
        phone: lead.phone,
        site: lead.site,
        mapsUrl: lead.mapsUrl,
        batchLimit: limit,
      };
    }),
  );
}

function baseDestinationFromPreSend(destination: PreSendLead['destination']): CreateBaseLeadInput['destination'] {
  if (destination === 'Agregadores') return 'Agregador';
  if (destination === 'Com site') return 'Com site';
  if (destination === 'Instagram') return 'Instagram';
  return 'WhatsApp';
}

function preSendLeadToBaseInput(lead: PreSendLead, sentAt: string, reason: string): CreateBaseLeadInput {
  return {
    sourceLeadId: lead.sourceImportId,
    company: lead.company,
    branch: lead.branch,
    branch_id: lead.branch_id,
    branch_slug: lead.branch_slug,
    state: lead.state ?? '',
    city: lead.city ?? '',
    phone: lead.phone ?? '',
    site: lead.site ?? '',
    instagram: lead.instagram_url ?? lead.instagram ?? '',
    mapsUrl: lead.mapsUrl ?? '',
    origin: lead.channel,
    destination: baseDestinationFromPreSend(lead.destination),
    original_destination: lead.original_destination ?? lead.destination,
    destination_override: lead.destination_override,
    send_instagram: lead.send_instagram,
    instagram_override_reason: lead.instagram_override_reason,
    override_by: lead.override_by,
    override_at: lead.override_at,
    status: 'sent',
    sentAt,
    template: '',
    chipOrProfile: lead.profile,
    notes: reason,
    history: [
      {
        id: `history-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        date: sentAt.slice(0, 10),
        title: 'Marcado como ja enviado',
        description: reason,
      },
    ],
  };
}

async function appendValidationAudit(input: EventLogInput) {
  try {
    await repositories.events.append(input);
  } catch (error) {
    // Auditoria não pode desfazer uma decisão já confirmada pelo provider.
    // O repositório usa RPC seguro quando a migration V3.5 estiver aplicada;
    // este fallback protege o fluxo caso o banco ainda esteja com política antiga.
    console.error('Falha ao gravar auditoria de validacao WhatsApp.', error);
  }
}

/**
 * Retornos inválidos do WhatsApp entram no fluxo Instagram no dia operacional
 * em que a validação ocorreu. Eles não podem herdar o dia original do WhatsApp,
 * pois isso pode deslocá-los para uma data passada/próxima semana.
 */
function operationalInstagramReturnDayId(reference = new Date()) {
  return effectiveDayId('Instagram', currentDayId('Instagram', reference), reference);
}

function isInstagramReturn(lead: PreSendLead) {
  return lead.channel === 'Instagram' &&
    Boolean(lead.send_instagram) &&
    normalize(lead.instagram_override_reason).includes('whatsapp_invalid');
}

function isInstagramReturnPendingLink(lead: PreSendLead) {
  return isInstagramReturn(lead) && Boolean(lead.instagramPendingLink);
}

function isInstagramReturnReadyForQueue(lead: PreSendLead) {
  return isInstagramReturn(lead) &&
    !lead.instagramPendingLink &&
    isValidInstagram(lead.instagram_url ?? lead.instagram);
}

function queueBlockReason(error: unknown) {
  const message = error instanceof Error ? error.message : 'Não foi possível preparar o lead para a fila Instagram.';
  if (/template/i.test(message)) return `Aguardando template compatível: ${message}`;
  if (/base permanente/i.test(message)) return `Revisão necessária: ${message}`;
  if (/perfil instagram ativo/i.test(message)) return `Aguardando perfil Instagram ativo: ${message}`;
  if (/instagram valido/i.test(message)) return `Aguardando Instagram válido: ${message}`;
  return `Aguardando correção operacional: ${message}`;
}

function isInstagramImport(lead: ImportLead) {
  return importFinalDestination(lead) === 'Instagram';
}

async function moveInvalidWhatsAppToInstagram(lead: PreSendLead, reason: string) {
  const settings = await settingsService.getDispatchSettings();
  const [firstProfile] = await loadActiveInstagramProfiles();
  const routedAt = new Date().toISOString();
  const instagram = lead.instagram_url ?? lead.instagram ?? '';
  const hasValidInstagram = isValidInstagram(instagram);
  const operationalDayId = operationalInstagramReturnDayId();

  assertTransition({ entity: 'pre-send', fromStatus: lead.status, toStatus: 'review', action: 'review' });
  await repositories.preSend.updateLead(lead.id, {
    channel: 'Instagram',
    destination: 'Instagram',
    destination_override: 'Instagram',
    send_instagram: true,
    instagram_url: instagram,
    instagram: instagram || lead.instagram,
    instagram_override_reason: 'whatsapp_invalid',
    // Mantém a classificação de site original mesmo após trocar o destino para
    // Instagram. Registros legados sem esse campo serão normalizados em loadTemplate.
    templateType: templateTypeForLead(lead),
    // O retorno só fica aguardando edição quando realmente não há um Instagram
    // aproveitável. Links já existentes seguem prontos para a tentativa automática.
    instagramPendingLink: !hasValidInstagram,
    instagramReadyAt: hasValidInstagram ? routedAt : '',
    queueWaitReason: hasValidInstagram
      ? 'Instagram já informado. Aguardando tentativa automática de entrada na fila.'
      : 'Aguardando link do Instagram.',
    override_by: 'Sistema',
    override_at: routedAt,
    profile: firstProfile?.username || settings.instagram.profile || '',
    dayId: operationalDayId,
    status: 'review',
    validationStatus: 'invalid',
    validationError: reason,
    validationAttempts: (lead.validationAttempts ?? 0) + 1,
    lastValidatedAt: routedAt,
  });

  await appendValidationAudit({
    source: 'pre-send',
    action: hasValidInstagram
      ? 'whatsapp_invalid_to_instagram_ready_for_auto_queue'
      : 'whatsapp_invalid_to_instagram_pending_link',
    channel: 'instagram',
    leadId: lead.sourceImportId ?? lead.id,
    status: 'review',
    message: hasValidInstagram
      ? `${reason} Instagram existente preservado; o sistema tentará inserir o retorno automaticamente na fila Instagram.`
      : `${reason} Lead mantido no Pré-Envio Instagram aguardando link.`,
    metadata: {
      pre_send_id: lead.id,
      previous_channel: 'whatsapp',
      dayId: operationalDayId,
      scheduled_date: scheduledDateForDayId(operationalDayId),
      company_name: lead.company,
      normalized_phone: normalizePhone(lead.phone),
      validation_reason: reason,
      instagram_url: instagram,
      instagram_ready_for_auto_queue: hasValidInstagram,
    },
  });
}

/**
 * Após uma invalidação explícita do WhatsApp, aproveita links Instagram que já
 * estavam cadastrados. A função usa a mesma fila por prioridade: retornos do
 * WhatsApp são preenchidos antes dos leads vindos diretamente do Início.
 * Falhas operacionais não desfazem a invalidação; o lead continua visível no
 * Pré-Envio Instagram com o motivo para nova tentativa automática ou manual.
 */
async function autoQueueReadyInstagramReturns(returnedIds: Iterable<string>) {
  const ids = new Set(Array.from(returnedIds));
  if (!ids.size) return;

  const routedLeads = (await listAllLeads()).filter((lead) =>
    ids.has(lead.id) &&
    lead.dayId === operationalInstagramReturnDayId() &&
    isInstagramReturnReadyForQueue(lead),
  );

  if (!routedLeads.length) return;

  try {
    await fillInstagramQueueByPriority({ dayId: operationalInstagramReturnDayId() });
  } catch (error) {
    const reason = queueBlockReason(error);
    await Promise.all(routedLeads.map(async (lead) => {
      await repositories.preSend.updateLead(lead.id, {
        status: 'review',
        instagramPendingLink: false,
        queueWaitReason: reason,
      });
      await appendValidationAudit({
        source: 'pre-send',
        action: 'instagram_auto_queue_unavailable',
        channel: 'instagram',
        leadId: lead.sourceImportId ?? lead.id,
        status: 'review',
        message: reason,
        metadata: {
          pre_send_id: lead.id,
          company_name: lead.company,
          instagram_url: lead.instagram_url ?? lead.instagram,
        },
      });
    }));
  }
}

async function markWhatsAppValidationForReview(
  lead: PreSendLead,
  validationStatus: 'invalid' | 'error',
  reason: string,
) {
  const reviewedAt = new Date().toISOString();
  assertTransition({ entity: 'pre-send', fromStatus: lead.status, toStatus: 'review', action: 'review' });
  await repositories.preSend.updateLead(lead.id, {
    status: 'review',
    validationStatus,
    validationError: reason,
    validationAttempts: (lead.validationAttempts ?? 0) + 1,
    lastValidatedAt: reviewedAt,
  });
  await appendValidationAudit({
    source: 'pre-send',
    action: validationStatus === 'invalid' ? 'whatsapp_validation_requires_review' : 'whatsapp_validation_error_requires_review',
    channel: 'whatsapp',
    leadId: lead.sourceImportId ?? lead.id,
    status: 'review',
    message: reason,
    metadata: {
      pre_send_id: lead.id,
      dayId: lead.dayId,
      scheduled_date: scheduledDateForDayId(lead.dayId),
      company_name: lead.company,
      normalized_phone: normalizePhone(lead.phone),
      validation_status: validationStatus,
      validation_attempts: (lead.validationAttempts ?? 0) + 1,
    },
  });
}

/** Resultado inválido confirmado: transfere ao Instagram e aproveita o link já existente, quando houver. */
async function handleInvalidWhatsApp(lead: PreSendLead, reason: string) {
  await moveInvalidWhatsAppToInstagram(lead, reason);
  return 'instagram' as const;
}

async function queueCapacity(channel: PreSendChannel, requestedDayId: string, requestedProfile?: string): Promise<PreSendCapacity> {
  await rolloverPreSendAfterCutoff();
  const dayId = effectiveDayId(channel, requestedDayId);
  const scheduledDate = scheduledDateForDayId(dayId);
  const settings = await settingsService.getDispatchSettings();

  if (channel === 'WhatsApp') {
    const chips = await loadActiveChips();
    const chip = requestedProfile
      ? chips.find((item) => chipInstance(item) === requestedProfile)
      : chips[0];
    const profile = chip ? chipInstance(chip) : requestedProfile ?? '';
    const limit = chip?.dailyLimit ?? 0;
    const [leads, allocations, batches] = await Promise.all([listAllLeads(), queueAllocationsByDate(), repositories.whatsappQueue.listBatches({})]);
    const reserved = leads.filter((lead) =>
      lead.channel === 'WhatsApp' &&
      lead.dayId === dayId &&
      matchesSelectedProfile(lead, profile) &&
      isActivePreSendStatus(lead.status) &&
      !allocations.preSendIds.has(lead.id),
    ).length;
    const queued = batches.flatMap((batch) => batch.leads).filter((lead) =>
      isActiveWhatsAppQueueStatus(lead.status) &&
      lead.scheduled_date === scheduledDate &&
      (lead.chip_instance || lead.chip) === profile,
    ).length;
    const used = reserved + queued;
    return { channel, dayId, scheduledDate, profile, limit, used, available: Math.max(0, limit - used) };
  }

  const profiles = await loadActiveInstagramProfiles();
  const profile = requestedProfile
    ? profiles.find((item) => item.username === normalizeInstagramUsername(requestedProfile))?.username ?? requestedProfile
    : profiles[0]?.username ?? '';
  const batches = await repositories.instagramQueue.listBatches({});
  const limit = Math.max(0, settings.instagram.dailyLimit);
  const used = batches.flatMap((batch) => batch.leads).filter((lead) =>
    isActiveInstagramQueueStatus(lead.status) && lead.scheduled_date === scheduledDate && lead.profile === profile,
  ).length;
  return { channel, dayId, scheduledDate, profile, limit, used, available: Math.max(0, limit - used) };
}

async function directInstagramQueueInput(lead: ImportLead, profile: string, dayId: string): Promise<CreateInstagramQueueLeadInput> {
  const settings = await settingsService.getDispatchSettings();
  const transient = importToPreSendLead(lead, settings, '', profile, { dayId, profile, forceApproved: true });
  if (!transient || transient.channel !== 'Instagram') throw new Error('Lead aprovado não está configurado para Instagram.');
  const [queueLead] = await toInstagramQueueLeads([{ id: `direct-import-${lead.id}`, ...transient }]);
  if (!queueLead) throw new Error('Não foi possível preparar o lead para a fila Instagram.');
  return { ...queueLead, lead_id: lead.id, sourcePreSendId: undefined };
}

async function fillInstagramQueueByPriority({ dayId: requestedDayId, profile: requestedProfile }: { dayId: string; profile?: string }): Promise<InstagramQueueFillResult> {
  await rolloverPreSendAfterCutoff();
  let capacity = await queueCapacity('Instagram', requestedDayId, requestedProfile);
  const result: InstagramQueueFillResult = {
    queued: 0,
    fromPreSend: 0,
    fromImport: 0,
    waitingPreSend: 0,
    waitingImport: 0,
    blockedPreSend: 0,
    blockedImport: 0,
    notices: [],
    scheduledDate: capacity.scheduledDate,
  };

  // Retornos WhatsApp -> Instagram são processados um a um. Um lead sem
  // template, perfil ou dado válido não pode interromper a fila inteira nem
  // desaparecer do Pré-Envio.
  const allLeads = await listAllLeads();
  const readyPreSend = sortByLeadScore(allLeads.filter((lead) =>
    lead.dayId === capacity.dayId &&
    (isStatusGroup(lead.status, 'review') || isStatusGroup(lead.status, 'approved')) &&
    isInstagramReturnReadyForQueue(lead),
  ));

  for (const lead of readyPreSend) {
    capacity = await queueCapacity('Instagram', capacity.dayId, capacity.profile);
    if (capacity.available <= 0) {
      await repositories.preSend.updateLead(lead.id, {
        queueWaitReason: 'Aguardando capacidade do perfil Instagram.',
      });
      result.waitingPreSend += 1;
      continue;
    }

    try {
      const assigned = await assignProfilesAndLimitCapacity([lead], { instagramProfile: capacity.profile });
      if (!assigned.length) {
        await repositories.preSend.updateLead(lead.id, {
          queueWaitReason: 'Aguardando capacidade do perfil Instagram.',
        });
        result.waitingPreSend += 1;
        continue;
      }

      const queueLeads = await toInstagramQueueLeads(assigned);
      await repositories.instagramQueue.enqueue(queueLeads);
      await repositories.preSend.moveToQueue([lead.id]);
      result.fromPreSend += 1;
      result.queued += 1;
    } catch (error) {
      const reason = queueBlockReason(error);
      await repositories.preSend.updateLead(lead.id, {
        // O link confirmado continua salvo, porém o retorno fica visível no
        // card Instagram até a pendência operacional ser resolvida.
        status: 'review',
        instagramPendingLink: false,
        queueWaitReason: reason,
      });
      result.blockedPreSend += 1;
      result.notices.push(reason);
    }
  }

  // Depois de zerar a prioridade do Pré-Envio Instagram, o espaço restante
  // pode ser usado pelos leads já aprovados para Instagram no Início.
  capacity = await queueCapacity('Instagram', capacity.dayId, capacity.profile);
  if (capacity.available > 0) {
    const allPreSend = await listAllLeads();
    const activePreSendSourceIds = new Set(allPreSend
      .filter((lead) => isActivePreSendStatus(lead.status))
      .map((lead) => lead.sourceImportId)
      .filter((id): id is string => Boolean(id)));
    const imports = sortByLeadScore((await repositories.import.list({ status: 'approved' }))
      .filter(isInstagramImport)
      .filter((lead) => isValidInstagram(lead.instagram_url ?? lead.instagram))
      .filter((lead) => !activePreSendSourceIds.has(lead.id)));

    for (const lead of imports) {
      capacity = await queueCapacity('Instagram', capacity.dayId, capacity.profile);
      if (capacity.available <= 0) {
        result.waitingImport += 1;
        continue;
      }

      try {
        const queueInput = await directInstagramQueueInput(lead, capacity.profile, capacity.dayId);
        await repositories.instagramQueue.enqueue([queueInput]);
        await markImportsQueued([lead]);
        result.fromImport += 1;
        result.queued += 1;
      } catch (error) {
        // Leads vindos do Início devem continuar no Início se não houver
        // template/configuração completa; não podem ser marcados como queued.
        result.blockedImport += 1;
        result.notices.push(queueBlockReason(error));
      }
    }
  }

  if (result.queued || result.waitingPreSend || result.blockedPreSend) {
    eventBus.emit('instagram-queue:changed', { action: 'update' });
    eventBus.emit('pre-send:changed', { action: 'update' });
  }
  if (result.fromImport) eventBus.emit('import:changed', { source: 'update' });
  return result;
}

export const preSendService = {
  async listDayCards() {
    return scheduledDayCards();
  },

  async summary(filters?: { whatsappDayId?: string; instagramDayId?: string }) {
    await rolloverPreSendAfterCutoff();
    if (!filters?.whatsappDayId && !filters?.instagramDayId) return repositories.preSend.summary();

    const [leads, queueAllocations] = await Promise.all([listAllLeads(), queueAllocationsByDate()]);
    const whatsappDayId = filters.whatsappDayId;
    const instagramDayId = filters.instagramDayId;
    const dateId = whatsappDayId ?? instagramDayId ?? '';
    const dateLabel = dateId ? formatDateLabel(new Date(`${scheduledDateForDayId(dateId)}T12:00:00`)) : undefined;
    const whatsappScheduledDate = whatsappDayId ? scheduledDateForDayId(whatsappDayId) : '';
    const whatsappPreSend = whatsappDayId
      ? leads.filter((lead) =>
          lead.channel === 'WhatsApp' &&
          lead.dayId === whatsappDayId &&
          (isStatusGroup(lead.status, 'approved') || isStatusGroup(lead.status, 'queued')) &&
          !queueAllocations.preSendIds.has(lead.id),
        ).length
      : 0;
    const whatsappQueue = whatsappScheduledDate ? queueAllocations.counts.get(`WhatsApp:${whatsappScheduledDate}`) ?? 0 : 0;
    const whatsapp = whatsappPreSend + whatsappQueue;
    const instagram = instagramDayId
      ? leads.filter((lead) => lead.dayId === instagramDayId && isInstagramReturn(lead) && isVisiblePreSendStatus(lead.status)).length
      : 0;
    const queued = leads.filter((lead) =>
      ((whatsappDayId && lead.channel === 'WhatsApp' && lead.dayId === whatsappDayId) ||
        (instagramDayId && lead.channel === 'Instagram' && lead.dayId === instagramDayId)) &&
      isStatusGroup(lead.status, 'queued') &&
      !queueAllocations.preSendIds.has(lead.id),
    ).length + (whatsappScheduledDate ? queueAllocations.counts.get(`WhatsApp:${whatsappScheduledDate}`) ?? 0 : 0) +
      (instagramDayId ? queueAllocations.counts.get(`Instagram:${scheduledDateForDayId(instagramDayId)}`) ?? 0 : 0);

    return {
      whatsapp,
      instagram,
      queued,
      total: whatsapp + instagram,
      dateLabel,
    };
  },

  async listProfiles(channel: PreSendChannel) {
    if (channel === 'WhatsApp') {
      return (await loadActiveChips()).map(chipInstance);
    }

    return (await loadActiveInstagramProfiles()).map((profile) => profile.username).filter(Boolean);
  },

  async listLeads(filters: PreSendFilters) {
    return listFilteredLeads(filters);
  },

  async addFromImport(leads: ImportLead[]) {
    await rolloverPreSendAfterCutoff();
    const settings = await settingsService.getDispatchSettings();
    const [firstChip, firstInstagramProfile] = await Promise.all([
      loadActiveChips().then((chips) => chips[0]),
      loadActiveInstagramProfiles().then((profiles) => profiles[0]),
    ]);
    const defaultWhatsAppChip = firstChip ? chipInstance(firstChip) : '';
    const defaultInstagramProfile = firstInstagramProfile?.username ?? '';
    const payload = leads.map((lead) => importToPreSendLead(lead, settings, defaultWhatsAppChip, defaultInstagramProfile)).filter((lead): lead is CreatePreSendLeadInput => Boolean(lead));
    const created = await repositories.preSend.addLeads(payload);
    const createdSourceIds = new Set(created.map((lead) => lead.sourceImportId).filter((id): id is string => Boolean(id)));
    if (createdSourceIds.size) await markImportsQueued(leads.filter((lead) => createdSourceIds.has(lead.id)));
    eventBus.emit('pre-send:changed', { action: 'update' });
    return created;
  },

  async getQueueCapacity(input: { channel: PreSendChannel; dayId: string; profile?: string }) {
    return queueCapacity(input.channel, input.dayId, input.profile);
  },

  async fillInstagramQueueByPriority(input: { dayId: string; profile?: string }) {
    return fillInstagramQueueByPriority(input);
  },

  async enqueueApprovedInstagramImports() {
    const [profile] = await loadActiveInstagramProfiles();
    if (!profile) return { queued: 0, fromPreSend: 0, fromImport: 0, waitingPreSend: 0, waitingImport: 0, blockedPreSend: 0, blockedImport: 0, notices: [], scheduledDate: toLocalDateInputValue() } satisfies InstagramQueueFillResult;
    return fillInstagramQueueByPriority({
      dayId: effectiveDayId('Instagram', currentDayId('Instagram')),
      profile: profile.username,
    });
  },

  async moveApprovedImportsToQueue({
    channel,
    dayId,
    profile,
    queueFilter = 'Geral',
  }: {
    channel: PreSendChannel;
    dayId: string;
    profile?: string;
    queueFilter?: PreSendQueueFilter;
  }) {
    await rolloverPreSendAfterCutoff();

    if (channel === 'Instagram') {
      const filled = await fillInstagramQueueByPriority({ dayId, profile });
      if (!filled.queued) {
        throw new Error(filled.waitingPreSend || filled.waitingImport
          ? 'Fila Instagram sem capacidade disponível hoje.'
          : 'Nenhum lead Instagram pronto para entrar na fila.');
      }
      return filled.queued;
    }

    const settings = await settingsService.getDispatchSettings();
    const capacity = await queueCapacity('WhatsApp', dayId, profile);
    if (capacity.available <= 0) throw new Error('Limite diário do chip atingido. Preencha novas vagas somente quando houver capacidade.');
    const imports = (await approvedImportsForPreSend(channel, queueFilter)).slice(0, capacity.available);
    if (!imports.length) throw new Error('Nenhum lead aprovado disponível no Início para este canal/filtro.');
    await releasePreSendLinksForImports(imports, channel);

    const [firstChip, firstInstagramProfile] = await Promise.all([
      loadActiveChips().then((chips) => chips[0]),
      loadActiveInstagramProfiles().then((profiles) => profiles[0]),
    ]);
    const defaultWhatsAppChip = firstChip ? chipInstance(firstChip) : '';
    const defaultInstagramProfile = firstInstagramProfile?.username ?? '';
    const targetProfile = profile || defaultWhatsAppChip;
    if (!targetProfile) throw new Error('Nenhum chip ativo/conectado selecionado.');
    const targetDayId = effectiveDayId(channel, dayId);

    const payload = imports
      .map((lead) => importToPreSendLead(lead, settings, defaultWhatsAppChip, defaultInstagramProfile, { dayId: targetDayId, profile: targetProfile }))
      .filter((lead): lead is CreatePreSendLeadInput => Boolean(lead));

    const created = await repositories.preSend.addLeads(payload);
    const createdSourceIds = new Set(created.map((lead) => lead.sourceImportId).filter((id): id is string => Boolean(id)));
    if (createdSourceIds.size) await markImportsQueued(imports.filter((lead) => createdSourceIds.has(lead.id)));
    eventBus.emit('pre-send:changed', { action: 'fill' });
    return created.length;
  },

  async moveToQueue(ids: string[], options: QueueAssignmentOptions = {}) {
    await rolloverPreSendAfterCutoff();
    const allLeads = await listAllLeads();
    const selected = sortByLeadScore(allLeads.filter((lead) => ids.includes(lead.id) && isStatusGroup(lead.status, 'approved')));
    if (ids.length && !selected.length) throw new Error('Apenas leads aprovados podem ir para a fila.');
    const assigned = await assignProfilesAndLimitCapacity(selected, options);
    if (!assigned.length) throw new Error('Limite diario atingido para o chip/perfil selecionado.');
    assigned.forEach((lead) => assertTransition({ entity: 'pre-send', fromStatus: lead.status, toStatus: 'queued', action: 'queue' }));

    await Promise.all(assigned.map((lead) => {
      const original = selected.find((item) => item.id === lead.id);
      return original && original.profile !== lead.profile ? repositories.preSend.updateLead(lead.id, { profile: lead.profile }) : Promise.resolve();
    }));

    const whatsapp = assigned.filter((lead) => lead.channel === 'WhatsApp');
    const instagram = assigned.filter((lead) => lead.channel === 'Instagram');
    const movedIds = assigned.map((lead) => lead.id);

    if (whatsapp.length) await repositories.whatsappQueue.enqueue(await toWhatsAppQueueLeads(whatsapp));
    if (instagram.length) await repositories.instagramQueue.enqueue(await toInstagramQueueLeads(instagram));

    await repositories.preSend.moveToQueue(movedIds);
    eventBus.emit('pre-send:changed', { action: 'move-to-queue' });
    if (whatsapp.length) eventBus.emit('whatsapp-queue:changed', { action: 'update' });
    if (instagram.length) eventBus.emit('instagram-queue:changed', { action: 'update' });
    return movedIds.length;
  },

  async moveDayToQueue({
    whatsappDayId,
    instagramDayId,
    whatsappProfile,
    instagramProfile,
    queueFilter = 'Geral',
  }: {
    whatsappDayId: string;
    instagramDayId: string;
    whatsappProfile?: string;
    instagramProfile?: string;
    queueFilter?: PreSendFilters['queueFilter'];
  }) {
    await rolloverPreSendAfterCutoff();
    const [whatsapp, instagram] = await Promise.all([
      whatsappProfile
        ? listFilteredLeads({ channel: 'WhatsApp', dayId: whatsappDayId, profile: whatsappProfile, queueFilter })
        : Promise.resolve([]),
      listFilteredLeads({ channel: 'Instagram', dayId: instagramDayId, profile: instagramProfile, queueFilter: 'Geral' }),
    ]);
    const ids = sortByLeadScore([...whatsapp, ...instagram].filter((lead) => isStatusGroup(lead.status, 'approved'))).map((lead) => lead.id);
    if (!ids.length) throw new Error('Nenhum lead aprovado no dia selecionado.');
    return this.moveToQueue(ids, { whatsappProfile, instagramProfile });
  },

  async moveInstagramDayToQueue({ instagramDayId, instagramProfile }: { instagramDayId: string; instagramProfile?: string }) {
    await rolloverPreSendAfterCutoff();
    const leads = await listFilteredLeads({ channel: 'Instagram', dayId: instagramDayId, profile: instagramProfile, queueFilter: 'Geral' });
    const ids = sortByLeadScore(leads.filter((lead) => isStatusGroup(lead.status, 'approved'))).map((lead) => lead.id);
    if (!ids.length) throw new Error('Nenhum retorno Instagram aprovado no dia selecionado.');
    return this.moveToQueue(ids, { instagramProfile });
  },

  async returnDayToImport({ whatsappDayId, instagramDayId }: { whatsappDayId: string; instagramDayId: string }) {
    await rolloverPreSendAfterCutoff();
    const [whatsapp, instagram] = await Promise.all([
      repositories.preSend.listLeads({ channel: 'WhatsApp', dayId: whatsappDayId, queueFilter: 'Geral' }),
      repositories.preSend.listLeads({ channel: 'Instagram', dayId: instagramDayId, queueFilter: 'Geral' }),
    ]);
    const leads = [...whatsapp, ...instagram].filter((lead) =>
      (isStatusGroup(lead.status, 'approved') || isStatusGroup(lead.status, 'review') || isStatusGroup(lead.status, 'queued')) && Boolean(lead.sourceImportId),
    );

    if (!leads.length) throw new Error('Nenhum lead disponivel para retornar ao Inicio no dia selecionado.');

    const returnedAt = new Date().toISOString();
    await Promise.all(leads.map((lead) => {
      assertTransition({ entity: 'import', fromStatus: 'queued', toStatus: 'approved', action: 'return_to_import' });
      return repositories.import.update(lead.sourceImportId!, {
      status: 'approved',
      destino: lead.destination,
      destination: lead.destination,
      original_destination: lead.original_destination ?? lead.destination,
      destination_override: lead.destination_override,
      send_instagram: lead.send_instagram,
      instagram_url: lead.instagram_url,
      instagram_override_reason: lead.instagram_override_reason,
      override_by: lead.override_by,
      override_at: lead.override_at,
      returned_from_queue: true,
      returned_at: returnedAt,
      return_reason: 'manual',
    });
    }));
    await Promise.all(leads.map((lead) => repositories.preSend.archiveLead(lead.id)));
    eventBus.emit('import:changed', { source: 'update' });
    eventBus.emit('pre-send:changed', { action: 'update' });
  },

  async markSent(ids: string[]) {
    if (!ids.length) return;
    await rolloverPreSendAfterCutoff();
    const allLeads = await listAllLeads();
    const selected = allLeads.filter((lead) => ids.includes(lead.id));
    selected.forEach((lead) => assertTransition({ entity: 'pre-send', fromStatus: lead.status, toStatus: 'sent', action: 'mark_sent' }));
    const importsUpdated = await markSourceImportsSent(selected, 'Envio confirmado pela fila operacional.');
    await repositories.preSend.markSent(selected.map((lead) => lead.id));
    eventBus.emit('pre-send:changed', { action: 'sent' });
    if (importsUpdated) eventBus.emit('import:changed', { source: 'update' });
  },

  async markAlreadySent(ids: string[], reason = 'Marcado manualmente como ja enviado no Pre-Envio.') {
    await rolloverPreSendAfterCutoff();
    const uniqueIds = Array.from(new Set(ids));
    if (!uniqueIds.length) throw new Error('Selecione pelo menos um lead.');
    const allLeads = await listAllLeads();
    const selected = sortByLeadScore(allLeads.filter((lead) => uniqueIds.includes(lead.id)));
    if (!selected.length) throw new Error('Nenhum lead encontrado no pre-envio.');
    selected.forEach((lead) => assertTransition({ entity: 'pre-send', fromStatus: lead.status, toStatus: 'sent', action: 'mark_sent' }));

    const sentAt = new Date().toISOString();

    for (const lead of selected) {
      await repositories.base.upsertSent(preSendLeadToBaseInput(lead, sentAt, reason));
      await repositories.events.append({
        source: 'pre-send',
        action: 'manual_mark_sent',
        channel: lead.channel === 'Instagram' ? 'instagram' : 'whatsapp',
        leadId: lead.sourceImportId ?? lead.id,
        status: 'sent',
        message: reason,
        metadata: {
          pre_send_id: lead.id,
          company_name: lead.company,
          normalized_phone: normalizePhone(lead.phone),
          instagram_url: lead.instagram_url ?? lead.instagram,
          website: lead.site,
          maps_url: lead.mapsUrl,
          destination: lead.destination,
          original_destination: lead.original_destination,
          destination_override: lead.destination_override,
          manual: true,
          sent_at: sentAt,
        },
      });
    }

    await markSourceImportsSent(selected, reason, sentAt);
    await repositories.preSend.markSent(selected.map((lead) => lead.id));
    eventBus.emit('pre-send:changed', { action: 'sent' });
    eventBus.emit('base:changed', { action: 'update' });
    eventBus.emit('import:changed', { source: 'update' });
    return selected.length;
  },

  async validateLeads(ids: string[]): Promise<PreSendValidationSummary> {
    await rolloverPreSendAfterCutoff();
    const uniqueIds = Array.from(new Set(ids));
    if (!uniqueIds.length) return { approved: 0, revalidated: 0, returned: 0, requiresReview: 0, errors: 0, skipped: 0 };

    const allLeads = await listAllLeads();
    const selected = uniqueIds.map((id) => allLeads.find((lead) => lead.id === id)).filter((lead): lead is PreSendLead => Boolean(lead));
    const pending = selected.filter((lead) => !isStatusGroup(lead.status, 'approved'));
    pending.forEach((lead) => assertTransition({ entity: 'pre-send', fromStatus: lead.status, toStatus: 'approved', action: 'approve' }));

    const whatsapp = pending.filter((lead) => lead.channel === 'WhatsApp');
    const nonWhatsApp = pending.filter((lead) => lead.channel !== 'WhatsApp');
    const malformed = whatsapp.filter((lead) => !isLikelyValidWhatsApp(lead.phone));
    const validFormat = whatsapp.filter((lead) => isLikelyValidWhatsApp(lead.phone));
    const approvedIds = new Set(nonWhatsApp.map((lead) => lead.id));
    const returnedIds = new Set<string>();
    const reviewIds = new Set<string>();
    const errorIds = new Set<string>();

    await Promise.all(malformed.map(async (lead) => {
      const outcome = await handleInvalidWhatsApp(lead, 'WhatsApp sem formato valido na validacao do Pre-Envio.');
      if (outcome === 'instagram') returnedIds.add(lead.id);
      else reviewIds.add(lead.id);
    }));

    if (validFormat.length) {
      try {
        const results = await whatsappValidationGateway.validateInitial(validFormat.map(preSendLeadToWhatsAppValidationRequest));
        const byId = new Map(results.map((result) => [result.leadId, result]));

        await Promise.all(validFormat.map(async (lead) => {
          const result = byId.get(lead.id);
          if (!result || result.status === 'error') {
            errorIds.add(lead.id);
            const message = result?.errorMessage || 'Worker WhatsApp nao retornou resultado para este lead.';
            await markWhatsAppValidationForReview(lead, 'error', message);
            reviewIds.add(lead.id);
            return;
          }

          if (result.valid) {
            approvedIds.add(lead.id);
            return;
          }

          const outcome = await handleInvalidWhatsApp(lead, result.errorMessage || 'WhatsApp inexistente na validacao real do Pre-Envio.');
          if (outcome === 'instagram') returnedIds.add(lead.id);
          else reviewIds.add(lead.id);
        }));
      } catch (error) {
        // Falha de infraestrutura (Docker desligado, Evolution desconectada ou
        // preflight sem resposta) não muda nenhum lead. A UI mostra o erro e
        // o usuário pode tentar novamente quando o ambiente voltar.
        if (error instanceof WhatsAppValidationUnavailableError) throw error;
        const message = error instanceof Error ? error.message : 'Falha inesperada no provider de validacao WhatsApp.';
        await Promise.all(validFormat.map(async (lead) => {
          errorIds.add(lead.id);
          reviewIds.add(lead.id);
          await markWhatsAppValidationForReview(lead, 'error', message);
        }));
      }
    }

    if (approvedIds.size) {
      const validatedAt = new Date().toISOString();
      await Promise.all(Array.from(approvedIds).map(async (id) => {
        const lead = allLeads.find((item) => item.id === id);
        await repositories.preSend.updateLead(id, {
          status: 'approved',
          validationStatus: 'valid',
          validationError: '',
          validationAttempts: (lead?.validationAttempts ?? 0) + 1,
          lastValidatedAt: validatedAt,
        });
        await appendValidationAudit({
          source: 'pre-send',
          action: 'whatsapp_validation_approved',
          channel: 'whatsapp',
          leadId: lead?.sourceImportId ?? id,
          status: 'approved',
          message: 'WhatsApp confirmado pelo worker/Evolution no Pre-Envio.',
          metadata: {
            pre_send_id: id,
            company_name: lead?.company ?? '',
            normalized_phone: normalizePhone(lead?.phone),
            validation_attempts: (lead?.validationAttempts ?? 0) + 1,
            validated_at: validatedAt,
          },
        });
      }));
    }

    if (returnedIds.size) {
      await autoQueueReadyInstagramReturns(returnedIds);
      eventBus.emit('import:changed', { source: 'pre-send' });
    }
    eventBus.emit('pre-send:changed', { action: returnedIds.size ? 'whatsapp-invalid-return' : reviewIds.size ? 'whatsapp-validation-review' : 'validate' });
    return {
      approved: approvedIds.size,
      revalidated: 0,
      returned: returnedIds.size,
      requiresReview: reviewIds.size,
      errors: errorIds.size,
      skipped: selected.length - pending.length,
    };
  },

  /**
   * Confere de novo somente os leads WhatsApp já aprovados. Resultado ambíguo
   * continua em revisão; resultado explicitamente inválido segue a mesma rota
   * segura do fluxo inicial e aproveita Instagram já cadastrado.
   */
  async revalidateApprovedLeads(ids: string[]): Promise<PreSendValidationSummary> {
    await rolloverPreSendAfterCutoff();
    const uniqueIds = Array.from(new Set(ids));
    if (!uniqueIds.length) return { approved: 0, revalidated: 0, returned: 0, requiresReview: 0, errors: 0, skipped: 0 };

    const allLeads = await listAllLeads();
    const selected = uniqueIds.map((id) => allLeads.find((lead) => lead.id === id)).filter((lead): lead is PreSendLead => Boolean(lead));
    const candidates = selected.filter((lead) => lead.channel === 'WhatsApp' && isStatusGroup(lead.status, 'approved'));
    const malformed = candidates.filter((lead) => !isLikelyValidWhatsApp(lead.phone));
    const validFormat = candidates.filter((lead) => isLikelyValidWhatsApp(lead.phone));
    const approvedIds = new Set<string>();
    const returnedIds = new Set<string>();
    const reviewIds = new Set<string>();
    const errorIds = new Set<string>();

    // Revalidação mantém erros/ambiguidade em revisão. Quando a inexistência
    // do WhatsApp é explícita, aplica a rota Instagram com a mesma segurança
    // da validação inicial.
    await Promise.all(malformed.map(async (lead) => {
      const outcome = await handleInvalidWhatsApp(lead, 'WhatsApp sem formato valido na revalidacao do Pre-Envio.');
      if (outcome === 'instagram') returnedIds.add(lead.id);
      else reviewIds.add(lead.id);
    }));

    if (validFormat.length) {
      try {
        const results = await whatsappValidationGateway.revalidateApproved(validFormat.map(preSendLeadToWhatsAppValidationRequest));
        const byId = new Map(results.map((result) => [result.leadId, result]));

        await Promise.all(validFormat.map(async (lead) => {
          const result = byId.get(lead.id);
          if (!result || result.status === 'error') {
            errorIds.add(lead.id);
            reviewIds.add(lead.id);
            await markWhatsAppValidationForReview(
              lead,
              'error',
              result?.errorMessage || 'Worker WhatsApp nao retornou confirmação explícita para a revalidacao.',
            );
            return;
          }

          if (!result.valid) {
            const outcome = await handleInvalidWhatsApp(
              lead,
              result.errorMessage || 'WhatsApp inexistente na revalidacao real do Pre-Envio.',
            );
            if (outcome === 'instagram') returnedIds.add(lead.id);
            else reviewIds.add(lead.id);
            return;
          }

          approvedIds.add(lead.id);
        }));
      } catch (error) {
        // Nunca rebaixa/retorna leads por indisponibilidade de infraestrutura.
        if (error instanceof WhatsAppValidationUnavailableError) throw error;
        const message = error instanceof Error ? error.message : 'Falha inesperada no provider de revalidacao WhatsApp.';
        await Promise.all(validFormat.map(async (lead) => {
          errorIds.add(lead.id);
          reviewIds.add(lead.id);
          await markWhatsAppValidationForReview(lead, 'error', message);
        }));
      }
    }

    if (approvedIds.size) {
      const validatedAt = new Date().toISOString();
      await Promise.all(Array.from(approvedIds).map(async (id) => {
        const lead = allLeads.find((item) => item.id === id);
        await repositories.preSend.updateLead(id, {
          status: 'approved',
          validationStatus: 'valid',
          validationError: '',
          validationAttempts: (lead?.validationAttempts ?? 0) + 1,
          lastValidatedAt: validatedAt,
        });
        await appendValidationAudit({
          source: 'pre-send',
          action: 'whatsapp_revalidation_approved',
          channel: 'whatsapp',
          leadId: lead?.sourceImportId ?? id,
          status: 'approved',
          message: 'WhatsApp reconfirmado pelo worker/Evolution no Pre-Envio.',
          metadata: {
            pre_send_id: id,
            company_name: lead?.company ?? '',
            normalized_phone: normalizePhone(lead?.phone),
            validation_attempts: (lead?.validationAttempts ?? 0) + 1,
            revalidated_at: validatedAt,
            previous_status: 'approved',
          },
        });
      }));
    }

    if (returnedIds.size) {
      await autoQueueReadyInstagramReturns(returnedIds);
      eventBus.emit('import:changed', { source: 'pre-send' });
    }
    eventBus.emit('pre-send:changed', { action: returnedIds.size ? 'whatsapp-invalid-return' : reviewIds.size ? 'whatsapp-revalidation-review' : 'whatsapp-revalidate' });
    return {
      approved: approvedIds.size,
      revalidated: candidates.length,
      returned: returnedIds.size,
      requiresReview: reviewIds.size,
      errors: errorIds.size,
      skipped: selected.length - candidates.length,
    };
  },

  async validateLead(id: string) {
    await this.validateLeads([id]);
  },

  async invalidateLead(id: string, reason = 'Invalidado manualmente no Pré-Envio Instagram.') {
    await rolloverPreSendAfterCutoff();
    const allLeads = await listAllLeads();
    const current = allLeads.find((lead) => lead.id === id);
    if (!current) throw new Error('Lead não encontrado no Pré-Envio.');
    assertTransition({ entity: 'pre-send', fromStatus: current.status, toStatus: 'invalid', action: 'invalidate' });
    await repositories.preSend.updateLead(id, {
      status: 'invalid',
      queueWaitReason: reason,
    });
    await appendValidationAudit({
      source: 'pre-send',
      action: 'instagram_pending_link_invalidated',
      channel: 'instagram',
      leadId: current.sourceImportId ?? current.id,
      status: 'invalid',
      message: reason,
      metadata: {
        pre_send_id: current.id,
        company_name: current.company,
        instagram_url: current.instagram_url ?? current.instagram,
      },
    });
    eventBus.emit('pre-send:changed', { action: 'update' });
  },

  async archiveLead(id: string) {
    await rolloverPreSendAfterCutoff();
    const allLeads = await listAllLeads();
    const current = allLeads.find((lead) => lead.id === id);
    if (current) assertTransition({ entity: 'pre-send', fromStatus: current.status, toStatus: 'archived', action: 'archive' });
    await repositories.preSend.archiveLead(id);
    eventBus.emit('pre-send:changed', { action: 'archive' });
  },

  async updateLead(id: string, input: Partial<PreSendLead>) {
    await rolloverPreSendAfterCutoff();
    const allLeads = await listAllLeads();
    const current = allLeads.find((lead) => lead.id === id);
    let nextInput = { ...input };
    let shouldAutoQueueInstagram = false;

    if (current) {
      assertTransition({ entity: 'pre-send', fromStatus: current.status, action: 'edit' });
      assertStatusPatch(current, input);
    }

    if (current && isInstagramReturn(current)) {
      const instagramUrl = input.instagram_url ?? input.instagram ?? current.instagram_url ?? current.instagram ?? '';
      if (!isValidInstagram(instagramUrl)) {
        throw new Error('Informe o link ou usuário completo do Instagram. Não use somente o domínio instagram.com.');
      }
      // Tanto retornos novos quanto registros antigos já com link salvo devem
      // ficar visíveis no card Instagram e tentar a fila somente depois de
      // persistir a edição. Nunca mantemos o antigo status approved isolado.
      assertTransition({ entity: 'pre-send', fromStatus: current.status, toStatus: 'review', action: 'review' });
      const [firstInstagramProfile] = await loadActiveInstagramProfiles();
      const readyAt = new Date().toISOString();
      nextInput = {
        ...nextInput,
        channel: 'Instagram',
        destination: 'Instagram',
        destination_override: 'Instagram',
        send_instagram: true,
        instagram: instagramUrl,
        instagram_url: instagramUrl,
        instagram_override_reason: 'whatsapp_invalid',
        instagramPendingLink: false,
        instagramReadyAt: current.instagramReadyAt || readyAt,
        queueWaitReason: '',
        status: 'review',
        profile: firstInstagramProfile?.username || current.profile,
        // Ao confirmar o link de um retorno, tente sempre a fila da data
        // operacional atual (ou do próximo dia após 22h), nunca o dia legado.
        dayId: operationalInstagramReturnDayId(),
      };
      shouldAutoQueueInstagram = true;
    } else if (current && Object.prototype.hasOwnProperty.call(input, 'send_instagram')) {
      assertTransition({ entity: 'pre-send', fromStatus: current.status, action: 'instagram_override' });
      const settings = await settingsService.getDispatchSettings();
      const wasInstagram = Boolean(current.send_instagram);
      const willInstagram = Boolean(input.send_instagram);

      if (input.send_instagram) {
        const instagramUrl = input.instagram_url ?? input.instagram ?? current.instagram_url ?? current.instagram;
        if (!isValidInstagram(instagramUrl)) throw new Error('Lead sem Instagram válido');
        nextInput = {
          ...nextInput,
          channel: 'Instagram',
          destination: 'Instagram',
          destination_override: 'Instagram',
          instagram_url: instagramUrl,
          instagram_override_reason: input.instagram_override_reason || current.instagram_override_reason || 'Override manual para Instagram',
          override_by: input.override_by || current.override_by || 'Operador local',
          override_at: input.override_at || current.override_at || new Date().toISOString(),
          profile: settings.instagram.profile,
          dayId: firstDayId('Instagram', settings),
        };
      } else if (current.send_instagram) {
        const destination =
          current.original_destination === 'WhatsApp' ||
          current.original_destination === 'Com site' ||
          current.original_destination === 'Agregadores' ||
          current.original_destination === 'Instagram'
            ? current.original_destination
            : 'WhatsApp';
        const channel = destination === 'Instagram' ? 'Instagram' : 'WhatsApp';
        nextInput = {
          ...nextInput,
          channel,
          destination,
          destination_override: undefined,
          instagram_override_reason: '',
          override_by: '',
          override_at: '',
          profile: channel === 'Instagram' ? settings.instagram.profile : 'Geral',
          dayId: firstDayId(channel, settings),
        };
      }

      if (wasInstagram !== willInstagram) {
        void repositories.events.append({
          source: 'pre-send',
          action: 'destination_override',
          channel: willInstagram ? 'instagram' : 'whatsapp',
          leadId: current.sourceImportId ?? current.id,
          status: current.status,
          message: willInstagram ? 'Override manual para Instagram aplicado.' : 'Override manual para Instagram removido.',
          metadata: {
            pre_send_id: current.id,
            original_destination: current.original_destination,
            destination: willInstagram ? 'Instagram' : current.original_destination,
            destination_override: willInstagram,
            override_by: nextInput.override_by,
            override_at: nextInput.override_at,
            reason: nextInput.instagram_override_reason,
          },
        }).catch(() => undefined);
      }
    }

    await repositories.preSend.updateLead(id, nextInput);
    eventBus.emit('pre-send:changed', { action: 'update' });

    if (shouldAutoQueueInstagram) {
      const filled = await fillInstagramQueueByPriority({
        dayId: String(nextInput.dayId ?? current?.dayId ?? currentDayId('Instagram')),
        profile: String(nextInput.profile ?? current?.profile ?? ''),
      });
      return filled;
    }

    return undefined;
  },
};
