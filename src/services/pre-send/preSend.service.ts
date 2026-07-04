import { eventBus } from '../../lib/events';
import { repositories } from '../../repositories';
import { toLocalDateInputValue } from '../../utils/date';
import { settingsService } from '../settings/settings.service';
import type { BranchConfigRecord, ChipConfigRecord, ConfigRecord, InstagramConfigRecord, TemplateConfigRecord } from '../config/types';
import { chipInstance, isOperationalWhatsAppChip } from '../config/chipOperational';
import { normalizePhone } from '../import/importValidation';
import { isValidInstagram, normalizeInstagramUsername } from '../instagram/instagram.utils';
import { sortByLeadScore } from '../lead-score/leadScore.service';
import type { ImportLead } from '../import/types';
import type { CreateInstagramQueueLeadInput } from '../instagram-queue/types';
import type { CreateBaseLeadInput } from '../base/types';
import { isStatusGroup, normalizeStatusGroup } from '../status/status.mapper';
import { assertTransition } from '../state-machine';
import type { CreateWhatsAppQueueLeadInput } from '../whatsapp-queue/types';
import type { CreatePreSendLeadInput, PreSendChannel, PreSendDayCard, PreSendFilters, PreSendLead, PreSendQueueFilter } from './types';

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

function channelLimit(channel: PreSendChannel, settings: Awaited<ReturnType<typeof settingsService.getDispatchSettings>>) {
  return channel === 'WhatsApp' ? settings.whatsapp.dailyLimit : settings.instagram.dailyLimit;
}

function channelDays(channel: PreSendChannel, settings: Awaited<ReturnType<typeof settingsService.getDispatchSettings>>) {
  return channel === 'WhatsApp' ? settings.whatsapp.activeDays : settings.instagram.activeDays;
}

function firstDayId(channel: PreSendChannel, settings: Awaited<ReturnType<typeof settingsService.getDispatchSettings>>) {
  const [firstDay] = channelDays(channel, settings);
  return dayId(channel, firstDay ?? 'Geral');
}

function scheduledDate() {
  return toLocalDateInputValue();
}

function dayKeyFromId(id: string) {
  return id
    .replace(/^whatsapp-/, '')
    .replace(/^instagram-/, '');
}

function scheduledDateForDayId(id: string) {
  const key = dayKeyFromId(id);
  const index = WEEK_DAYS.findIndex((weekday) =>
    dayId('WhatsApp', weekday).replace(/^whatsapp-/, '') === key,
  );
  if (index < 0) return scheduledDate();
  return toLocalDateInputValue(addDays(startOfCurrentWeek(), index));
}

function isActivePreSendStatus(status: PreSendLead['status']) {
  return isStatusGroup(status, 'review') || isStatusGroup(status, 'approved') || isStatusGroup(status, 'queued');
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
  const leads = await repositories.preSend.listLeads({ ...filters, profile: undefined });
  return sortByLeadScore(leads.filter((lead) => matchesSelectedProfile(lead, filters.profile)));
}

async function listAllLeads() {
  const [whatsapp, instagram] = await Promise.all([
    repositories.preSend.listLeads({ channel: 'WhatsApp' }),
    repositories.preSend.listLeads({ channel: 'Instagram' }),
  ]);
  return [...whatsapp, ...instagram];
}

async function scheduledDayCards(): Promise<PreSendDayCard[]> {
  const settings = await settingsService.getDispatchSettings();
  const storedCards = await repositories.preSend.listDayCards();
  const storedById = new Map(storedCards.map((card) => [card.id, card]));
  const leads = await listAllLeads();
  const todayIndex = new Date().getDay();
  const weekStart = startOfCurrentWeek();

  return (['WhatsApp', 'Instagram'] as PreSendChannel[]).flatMap((channel) =>
    WEEK_DAYS.map((weekday, index) => {
      const id = dayId(channel, weekday);
      const stored = storedById.get(id);
      const queued = leads.filter((lead) => lead.channel === channel && lead.dayId === id && isActivePreSendStatus(lead.status)).length;
      const date = addDays(weekStart, index);

      return {
        id,
        channel,
        label: formatWeekDateLabel(weekday, date),
        queued: stored?.queued ?? queued,
        limit: channelLimit(channel, settings),
        isToday: index === todayIndex,
      };
    }),
  );
}

async function assertQueueLimits(ids: string[]) {
  const settings = await settingsService.getDispatchSettings();
  const leads = await listAllLeads();
  const selected = leads.filter((lead) => ids.includes(lead.id) && isStatusGroup(lead.status, 'approved'));
  const queuedByDay = new Map<string, number>();

  for (const lead of leads) {
    if (!isStatusGroup(lead.status, 'queued')) continue;
    const key = `${lead.channel}:${lead.dayId}`;
    queuedByDay.set(key, (queuedByDay.get(key) ?? 0) + 1);
  }

  for (const lead of selected) {
    const key = `${lead.channel}:${lead.dayId}`;
    const limit = channelLimit(lead.channel, settings);
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

  return {
    sourceImportId: lead.id,
    company: lead.empresa,
    branch: lead.ramo,
    branch_id: lead.branch_id,
    branch_slug: lead.branch_slug,
    channel,
    destination,
    original_destination: originalDestination,
    destination_override: destinationOverride,
    send_instagram: lead.send_instagram ?? false,
    instagram_url: instagramUrl,
    instagram_override_reason: lead.instagram_override_reason,
    override_by: lead.override_by,
    override_at: lead.override_at,
    profile: overrides.profile ?? (channel === 'Instagram' ? defaultInstagramProfile : defaultWhatsAppChip),
    dayId: overrides.dayId ?? firstDayId(channel, settings),
    status: 'approved',
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

function destinationToTemplateType(destination: PreSendLead['destination']) {
  if (destination === 'Com site' || destination === 'Agregadores') return 'com-site';
  return 'sem-site';
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

async function loadTemplate(lead: PreSendLead) {
  const templates = (await repositories.config.list('templates')).filter(isTemplate);
  const type = destinationToTemplateType(lead.destination);
  const candidates = templates
    .filter((template) => template.active && template.status !== 'Arquivado' && template.status !== 'deleted')
    .filter((template) => template.channel === lead.channel || template.channel === 'Geral')
    .filter((template) => template.type === type)
    .filter((template) =>
      (lead.branch_id && template.branchId === lead.branch_id) ||
      normalize(template.branchName) === normalize(lead.branch) ||
      normalize(template.branchId) === normalize(lead.branch),
    );

  if (!candidates.length) return undefined;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

async function loadBranches() {
  return (await repositories.config.list('branches')).filter(isBranch);
}

function branchImageForLead(lead: PreSendLead, branches: BranchConfigRecord[]) {
  const branch =
    branches.find((item) => lead.branch_id && item.id === lead.branch_id) ??
    branches.find((item) => normalize(item.name) === normalize(lead.branch));
  return branch?.imageName ?? '';
}

function assertTemplate(lead: PreSendLead, template: TemplateConfigRecord | undefined): asserts template is TemplateConfigRecord {
  if (!template || !template.message1.trim()) {
    throw new Error(`Template valido ausente para ${lead.channel} / ${lead.branch} / ${lead.destination}.`);
  }
}

async function loadActiveChips() {
  const chips = (await repositories.config.list('chips'))
    .filter(isChip)
    .filter(isOperationalWhatsAppChip)
    .sort((a, b) => a.priority - b.priority);

  return chips;
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
    if (current >= settings.instagram.dailyLimit) continue;
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
    const branchImage = branchImageForLead(lead, branches);
    usageByChip.set(usageKey, (usageByChip.get(usageKey) ?? 0) + 1);

    queueLeads.push({
      lead_id: lead.sourceImportId ?? lead.id,
      sourcePreSendId: lead.id,
      company: lead.company,
      phone: lead.phone ?? '',
      branch: lead.branch,
      branch_id: lead.branch_id,
      branch_slug: lead.branch_slug,
      type: lead.destination === 'Com site' || lead.destination === 'Agregadores' ? 'Com site' : 'Sem site',
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
      message1: template.message1,
      message2: template.message2,
      imageName: branchImage,
      image_url: branchImage,
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
  const limit = settings.instagram.perBatch;
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
      const branchImage = branchImageForLead(lead, branches);
      const selectedProfile =
        activeProfiles.find((profile) => profile.username === normalizeInstagramUsername(lead.profile)) ??
        activeProfiles[0];
      if (!selectedProfile) throw new Error('Nenhum perfil Instagram ativo configurado.');

      return {
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
        message1: template.message1,
        message2: template.message2,
        imageName: branchImage,
        image_url: branchImage,
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

export const preSendService = {
  async listDayCards() {
    return scheduledDayCards();
  },

  async summary() {
    return repositories.preSend.summary();
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
    const settings = await settingsService.getDispatchSettings();
    const [firstChip, firstInstagramProfile] = await Promise.all([
      loadActiveChips().then((chips) => chips[0]),
      loadActiveInstagramProfiles().then((profiles) => profiles[0]),
    ]);
    const defaultWhatsAppChip = firstChip ? chipInstance(firstChip) : '';
    const defaultInstagramProfile = firstInstagramProfile?.username ?? '';
    const payload = leads.map((lead) => importToPreSendLead(lead, settings, defaultWhatsAppChip, defaultInstagramProfile)).filter((lead): lead is CreatePreSendLeadInput => Boolean(lead));
    const created = await repositories.preSend.addLeads(payload);
    eventBus.emit('pre-send:changed', { action: 'update' });
    return created;
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
    const settings = await settingsService.getDispatchSettings();
    const imports = await approvedImportsForPreSend(channel, queueFilter);
    if (!imports.length) throw new Error('Nenhum lead aprovado disponivel no Inicio para este canal/filtro.');
    await releasePreSendLinksForImports(imports, channel);

    const [firstChip, firstInstagramProfile] = await Promise.all([
      loadActiveChips().then((chips) => chips[0]),
      loadActiveInstagramProfiles().then((profiles) => profiles[0]),
    ]);
    const defaultWhatsAppChip = firstChip ? chipInstance(firstChip) : '';
    const defaultInstagramProfile = firstInstagramProfile?.username ?? '';
    const targetProfile = profile || (channel === 'Instagram' ? defaultInstagramProfile : defaultWhatsAppChip);
    if (!targetProfile) throw new Error(channel === 'WhatsApp' ? 'Nenhum chip ativo/conectado selecionado.' : 'Nenhum perfil Instagram ativo selecionado.');

    const payload = imports
      .map((lead) => importToPreSendLead(lead, settings, defaultWhatsAppChip, defaultInstagramProfile, { dayId, profile: targetProfile, forceApproved: true }))
      .filter((lead): lead is CreatePreSendLeadInput => Boolean(lead));

    await repositories.preSend.addLeads(payload);
    const available = await listFilteredLeads({ channel, dayId, profile: targetProfile, queueFilter });
    const ids = sortByLeadScore(available.filter((lead) => isStatusGroup(lead.status, 'approved'))).map((lead) => lead.id);
    if (!ids.length) throw new Error('Os aprovados do Inicio ja foram usados, estao em outro dia/chip/perfil ou nao possuem dados suficientes.');
    return this.moveToQueue(ids, channel === 'WhatsApp' ? { whatsappProfile: targetProfile } : { instagramProfile: targetProfile });
  },

  async moveToQueue(ids: string[], options: QueueAssignmentOptions = {}) {
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
    const leads = await listFilteredLeads({ channel: 'Instagram', dayId: instagramDayId, profile: instagramProfile, queueFilter: 'Geral' });
    const ids = sortByLeadScore(leads.filter((lead) => isStatusGroup(lead.status, 'approved'))).map((lead) => lead.id);
    if (!ids.length) throw new Error('Nenhum retorno Instagram aprovado no dia selecionado.');
    return this.moveToQueue(ids, { instagramProfile });
  },

  async returnDayToImport({ whatsappDayId, instagramDayId }: { whatsappDayId: string; instagramDayId: string }) {
    const [whatsapp, instagram] = await Promise.all([
      repositories.preSend.listLeads({ channel: 'WhatsApp', dayId: whatsappDayId, queueFilter: 'Geral' }),
      repositories.preSend.listLeads({ channel: 'Instagram', dayId: instagramDayId, queueFilter: 'Geral' }),
    ]);
    const leads = [...whatsapp, ...instagram].filter((lead) =>
      (isStatusGroup(lead.status, 'approved') || isStatusGroup(lead.status, 'review') || isStatusGroup(lead.status, 'queued')) && Boolean(lead.sourceImportId),
    );

    if (!leads.length) throw new Error('Nenhum lead disponivel para retornar ao Inicio no dia selecionado.');

    const returnedAt = new Date().toISOString();
    await Promise.all(leads.map((lead) => repositories.import.update(lead.sourceImportId!, {
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
    })));
    await Promise.all(leads.map((lead) => repositories.preSend.archiveLead(lead.id)));
    eventBus.emit('import:changed', { source: 'update' });
    eventBus.emit('pre-send:changed', { action: 'update' });
  },

  async markSent(ids: string[]) {
    if (!ids.length) return;
    const allLeads = await listAllLeads();
    const selected = allLeads.filter((lead) => ids.includes(lead.id));
    selected.forEach((lead) => assertTransition({ entity: 'pre-send', fromStatus: lead.status, toStatus: 'sent', action: 'mark_sent' }));
    await repositories.preSend.markSent(ids);
    eventBus.emit('pre-send:changed', { action: 'sent' });
  },

  async markAlreadySent(ids: string[], reason = 'Marcado manualmente como ja enviado no Pre-Envio.') {
    const uniqueIds = Array.from(new Set(ids));
    if (!uniqueIds.length) throw new Error('Selecione pelo menos um lead.');
    const allLeads = await listAllLeads();
    const selected = sortByLeadScore(allLeads.filter((lead) => uniqueIds.includes(lead.id)));
    if (!selected.length) throw new Error('Nenhum lead encontrado no pre-envio.');
    selected.forEach((lead) => assertTransition({ entity: 'pre-send', fromStatus: lead.status, toStatus: 'sent', action: 'mark_sent' }));

    const sentAt = new Date().toISOString();

    for (const lead of selected) {
      await repositories.base.upsertSent(preSendLeadToBaseInput(lead, sentAt, reason));
      if (lead.sourceImportId) {
        await repositories.import.update(lead.sourceImportId, {
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
        });
      }
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

    await repositories.preSend.markSent(selected.map((lead) => lead.id));
    eventBus.emit('pre-send:changed', { action: 'sent' });
    eventBus.emit('base:changed', { action: 'update' });
    eventBus.emit('import:changed', { source: 'update' });
    return selected.length;
  },

  async validateLead(id: string) {
    const allLeads = await listAllLeads();
    const current = allLeads.find((lead) => lead.id === id);
    if (current) assertTransition({ entity: 'pre-send', fromStatus: current.status, toStatus: 'approved', action: 'approve' });
    await repositories.preSend.validateLead(id);
    eventBus.emit('pre-send:changed', { action: 'validate' });
  },

  async archiveLead(id: string) {
    const allLeads = await listAllLeads();
    const current = allLeads.find((lead) => lead.id === id);
    if (current) assertTransition({ entity: 'pre-send', fromStatus: current.status, toStatus: 'archived', action: 'archive' });
    await repositories.preSend.archiveLead(id);
    eventBus.emit('pre-send:changed', { action: 'archive' });
  },

  async updateLead(id: string, input: Partial<PreSendLead>) {
    const allLeads = await listAllLeads();
    const current = allLeads.find((lead) => lead.id === id);
    let nextInput = { ...input };

    if (current) {
      assertTransition({ entity: 'pre-send', fromStatus: current.status, action: 'edit' });
      assertStatusPatch(current, input);
    }

    if (current && Object.prototype.hasOwnProperty.call(input, 'send_instagram')) {
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
  },
};
