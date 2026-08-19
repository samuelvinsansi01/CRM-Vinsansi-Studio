import { getSupabaseClient } from '../../lib/supabase';
import { branchSlug } from '../../services/config/branchIdentity';
import { chipLevelDefaults } from '../../services/config/chipOperational';
import type {
  BranchConfigRecord,
  ChipConfigRecord,
  ConfigKind,
  ConfigListFilters,
  ConfigRecord,
  InstagramConfigRecord,
  TemplateConfigRecord,
  TemplateType,
} from '../../services/config/types';
import { nowIso } from '../supabase.helpers';
import {
  activeStatusId,
  currentUserIdNumber,
  inactiveStatusId,
  listStatuses,
  normalizeCatalogName,
} from '../schemaCatalog';
import type { ConfigRepository } from './config.repository';

type Row = Record<string, unknown>;

function bool(value: unknown, fallback = true) {
  if (typeof value === 'boolean') return value;
  const normalized = normalizeCatalogName(value);
  if (['true', '1', 'sim', 'ativo', 'active'].includes(normalized)) return true;
  if (['false', '0', 'nao', 'inativo', 'inactive', 'arquivado'].includes(normalized)) return false;
  return fallback;
}

function number(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function list(value: unknown) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value ?? '').split(/[,;\n]/).map((item) => item.trim()).filter(Boolean);
}

function categoryData(row: Row) {
  return row.branches_categories && typeof row.branches_categories === 'object' && !Array.isArray(row.branches_categories)
    ? row.branches_categories as Row
    : {};
}

async function statusContext() {
  const statuses = await listStatuses();
  const activeId = await activeStatusId();
  return {
    activeId,
    nameById: new Map(statuses.map((status) => [status.id, status.name])),
  };
}

function isActiveStatus(statusId: unknown, activeId: string, nameById: Map<string, string>) {
  if (String(statusId) === activeId) return true;
  const name = normalizeCatalogName(nameById.get(String(statusId)) ?? '');
  return ['ativo', 'active', 'enabled', 'conectado', 'connected'].some((marker) => name.includes(marker));
}

function applyFilters(records: ConfigRecord[], filters?: ConfigListFilters) {
  const search = normalizeCatalogName(filters?.search);
  const status = normalizeCatalogName(filters?.status);
  return records.filter((record) => {
    const matchesSearch = !search || normalizeCatalogName(JSON.stringify(record)).includes(search);
    const matchesStatus = !status || status === 'todos' ||
      (status === 'ativos' && record.active) ||
      (status === 'inativos' && !record.active) ||
      normalizeCatalogName(record.status) === status;
    return matchesSearch && matchesStatus;
  });
}

async function listBranches(userId: number): Promise<BranchConfigRecord[]> {
  const { data, error } = await getSupabaseClient()
    .from('branches')
    .select('branches_id,users_id,status_id,branches_name,branches_categories,branches_created_at,branches_updated_at')
    .eq('users_id', userId)
    .order('branches_name');
  if (error) throw new Error(`Nao foi possivel carregar os ramos: ${error.message}`);
  const { activeId, nameById } = await statusContext();
  return ((data ?? []) as Row[]).map((row) => {
    const metadata = categoryData(row);
    const name = String(row.branches_name ?? '');
    const active = isActiveStatus(row.status_id, activeId, nameById);
    return {
      id: String(row.branches_id),
      kind: 'branches',
      categories: row.branches_categories ?? null,
      slug: String(metadata.slug ?? branchSlug(name)),
      name,
      category: String(metadata.category ?? name),
      subcategories: list(metadata.subcategories ?? row.branches_categories),
      associatedCategories: list(metadata.associatedCategories ?? metadata.associated_categories),
      order: number(metadata.order, 0),
      minRating: number(metadata.minRating ?? metadata.min_rating, 4),
      minReviews: number(metadata.minReviews ?? metadata.min_reviews, 10),
      imageName: String(metadata.imageName ?? metadata.image_name ?? ''),
      imageRequired: bool(metadata.imageRequired ?? metadata.image_required, false),
      active,
      status: active ? 'Ativo' : 'Inativo',
      createdAt: String(row.branches_created_at ?? ''),
      updatedAt: String(row.branches_updated_at ?? ''),
    } satisfies BranchConfigRecord;
  });
}

async function templateCatalogs(userId: number) {
  const [channelResponse, typeResponse] = await Promise.all([
    getSupabaseClient().from('template_channels').select('template_channels_id,template_channels_name').eq('users_id', userId),
    getSupabaseClient().from('template_types').select('template_types_id,template_types_name').eq('users_id', userId),
  ]);
  if (channelResponse.error) throw new Error(`Nao foi possivel carregar os canais de template: ${channelResponse.error.message}`);
  if (typeResponse.error) throw new Error(`Nao foi possivel carregar os tipos de template: ${typeResponse.error.message}`);
  return {
    channelById: new Map(((channelResponse.data ?? []) as Row[]).map((row) => [String(row.template_channels_id), String(row.template_channels_name)])),
    typeById: new Map(((typeResponse.data ?? []) as Row[]).map((row) => [String(row.template_types_id), String(row.template_types_name)])),
  };
}

function templateType(value: unknown): TemplateType {
  const normalized = normalizeCatalogName(value);
  return normalized.includes('com site') || normalized.includes('agreg') ? 'com-site' : 'sem-site';
}

async function listTemplates(userId: number): Promise<TemplateConfigRecord[]> {
  const [templateResponse, branches, catalogs, status] = await Promise.all([
    getSupabaseClient().from('templates').select('*').eq('users_id', userId).order('templates_name'),
    listBranches(userId),
    templateCatalogs(userId),
    statusContext(),
  ]);
  if (templateResponse.error) throw new Error(`Nao foi possivel carregar os templates: ${templateResponse.error.message}`);
  const branchRows = branches as BranchConfigRecord[];
  const branchById = new Map<string, BranchConfigRecord>(branchRows.map((branch: BranchConfigRecord) => [branch.id, branch]));
  return ((templateResponse.data ?? []) as Row[]).map((row) => {
    const branch = branchById.get(String(row.branches_id));
    const channelName = catalogs.channelById.get(String(row.template_channels_id)) ?? 'WhatsApp';
    const typeName = catalogs.typeById.get(String(row.template_types_id)) ?? 'Sem site';
    const active = isActiveStatus(row.status_id, status.activeId, status.nameById);
    const channel = normalizeCatalogName(channelName).includes('instagram')
      ? 'Instagram'
      : normalizeCatalogName(channelName).includes('geral') ? 'Geral' : 'WhatsApp';
    return {
      id: String(row.templates_id),
      kind: 'templates',
      name: String(row.templates_name ?? ''),
      branchId: String(row.branches_id),
      branchName: branch?.name ?? '',
      templateChannelId: String(row.template_channels_id ?? ''),
      templateChannelName: channelName,
      templateTypeId: String(row.template_types_id ?? ''),
      templateTypeName: typeName,
      channel,
      type: templateType(typeName),
      message1: String(row.templates_message_1 ?? ''),
      message2: String(row.templates_message_2 ?? ''),
      message3: String(row.templates_message_3 ?? ''),
      message4: String(row.templates_message_4 ?? ''),
      preview: String(row.templates_message_1 ?? ''),
      active,
      status: active ? 'Ativo' : 'Inativo',
      createdAt: String(row.templates_created_at ?? ''),
      updatedAt: String(row.templates_updated_at ?? ''),
    } satisfies TemplateConfigRecord;
  });
}

async function listChips(userId: number): Promise<ChipConfigRecord[]> {
  const [chipResponse, instanceResponse, levelResponse, status] = await Promise.all([
    getSupabaseClient().from('chips').select('*').eq('users_id', userId).order('chips_name'),
    getSupabaseClient().from('instances').select('instances_id,status_id,instances_name,instances_url,instances_created_at,instances_updated_at').eq('users_id', userId),
    getSupabaseClient().from('levels').select('*').eq('users_id', userId),
    statusContext(),
  ]);
  if (chipResponse.error) throw new Error(`Nao foi possivel carregar os chips: ${chipResponse.error.message}`);
  if (instanceResponse.error) throw new Error(`Nao foi possivel carregar as instancias: ${instanceResponse.error.message}`);
  if (levelResponse.error) throw new Error(`Nao foi possivel carregar os niveis: ${levelResponse.error.message}`);
  const instances = new Map(((instanceResponse.data ?? []) as Row[]).map((row) => [String(row.instances_id), row]));
  const levels = new Map(((levelResponse.data ?? []) as Row[]).map((row) => [String(row.levels_id), row]));
  return ((chipResponse.data ?? []) as Row[]).map((row) => {
    const instance = instances.get(String(row.instances_id)) ?? {};
    const level = levels.get(String(row.levels_id)) ?? {};
    const levelName = String(level.levels_name ?? 'Padrao');
    const defaults = chipLevelDefaults(levelName);
    const active = isActiveStatus(row.status_id, status.activeId, status.nameById) && isActiveStatus(instance.status_id, status.activeId, status.nameById);
    const dailyLimit = number(level.levels_daily_limit, defaults.dailyLimit);
    const batchCount = Math.max(1, number(level.levels_queues, defaults.batchCount));
    return {
      id: String(row.chips_id),
      kind: 'chips',
      name: String(row.chips_name ?? ''),
      number: String(row.chips_phone ?? ''),
      instanceId: String(row.instances_id ?? ''),
      levelId: String(row.levels_id ?? ''),
      level: levelName,
      url: String(instance.instances_url ?? ''),
      instance: String(instance.instances_name ?? ''),
      apiKey: '',
      connectionStatus: active ? 'connected' : 'inactive',
      priority: 1,
      startTime: '13:00',
      endTime: '18:00',
      dailyLimit,
      intervalSeconds: 120,
      blockSize: Math.max(1, Math.floor(dailyLimit / batchCount)),
      batches: Array.from({ length: batchCount }, (_, index) => String(index + 1)),
      paused: !active,
      active,
      status: active ? 'Ativo' : 'Inativo',
      createdAt: String(row.chips_created_at ?? ''),
      updatedAt: String(row.chips_updated_at ?? ''),
    } satisfies ChipConfigRecord;
  });
}

async function listSocials(userId: number): Promise<InstagramConfigRecord[]> {
  const [socialResponse, levelResponse, status] = await Promise.all([
    getSupabaseClient().from('socials').select('*').eq('users_id', userId).order('socials_name'),
    getSupabaseClient().from('levels').select('*').eq('users_id', userId),
    statusContext(),
  ]);
  if (socialResponse.error) throw new Error(`Nao foi possivel carregar os perfis Instagram: ${socialResponse.error.message}`);
  if (levelResponse.error) throw new Error(`Nao foi possivel carregar os niveis do Instagram: ${levelResponse.error.message}`);
  const levels = new Map(((levelResponse.data ?? []) as Row[]).map((row) => [String(row.levels_id), row]));
  return ((socialResponse.data ?? []) as Row[]).map((row) => {
    const level = levels.get(String(row.levels_id)) ?? {};
    const active = isActiveStatus(row.status_id, status.activeId, status.nameById);
    return {
      id: String(row.socials_id),
      kind: 'instagram',
      name: String(row.socials_name ?? ''),
      username: String(row.socials_username ?? '').replace(/^@/, ''),
      levelId: String(row.levels_id ?? ''),
      levelName: String(level.levels_name ?? ''),
      dailyLimit: number(level.levels_daily_limit, 60),
      active,
      status: active ? 'Ativo' : 'Inativo',
      createdAt: String(row.socials_created_at ?? ''),
      updatedAt: String(row.socials_updated_at ?? ''),
    } satisfies InstagramConfigRecord;
  });
}

async function createRecord(kind: ConfigKind, input: Record<string, unknown>): Promise<ConfigRecord> {
  const client = getSupabaseClient();
  const userId = await currentUserIdNumber();
  const statusId = Number(bool(input.active ?? input.status, true) ? await activeStatusId() : await inactiveStatusId());

  if (kind === 'branches') {
    const name = String(input.name ?? input.branch ?? '').trim();
    if (!name) throw new Error('O nome do ramo e obrigatorio.');
    const categories = input.categories ?? null;
    const response = await client.from('branches').insert({ users_id: userId, status_id: statusId, branches_name: name, branches_categories: categories }).select('branches_id').single();
    if (response.error) throw new Error(response.error.message);
    return (await listBranches(userId)).find((item) => item.id === String((response.data as Row).branches_id))!;
  }

  if (kind === 'templates') {
    const branchId = Number(input.branchId);
    if (!Number.isSafeInteger(branchId)) throw new Error('Selecione um ramo valido.');
    const templateChannelId = Number(input.templateChannelId);
    const templateTypeId = Number(input.templateTypeId);
    if (!Number.isSafeInteger(templateChannelId)) throw new Error('Selecione um canal de template valido.');
    if (!Number.isSafeInteger(templateTypeId)) throw new Error('Selecione um tipo de template valido.');
    const templateName = String(input.name ?? '').trim();
    if (!templateName) throw new Error('O nome do template e obrigatorio.');
    const message1 = String(input.message1 ?? '').trim();
    const message2 = String(input.message2 ?? '').trim();
    const message3 = String(input.message3 ?? '').trim();
    const message4 = String(input.message4 ?? '').trim();
    if (![message1, message2, message3, message4].every(Boolean)) throw new Error('As quatro mensagens do template sao obrigatorias.');
    const response = await client.from('templates').insert({
      users_id: userId,
      branches_id: branchId,
      status_id: statusId,
      templates_name: templateName,
      templates_message_1: message1,
      templates_message_2: message2,
      templates_message_3: message3,
      templates_message_4: message4,
      template_channels_id: templateChannelId,
      template_types_id: templateTypeId,
    }).select('templates_id').single();
    if (response.error) throw new Error(response.error.message);
    return (await listTemplates(userId)).find((item) => item.id === String((response.data as Row).templates_id))!;
  }

  if (kind === 'chips') {
    const name = String(input.name ?? '').trim();
    const phone = String(input.number ?? '').replace(/\D/g, '');
    const instanceId = Number(input.instanceId);
    const levelId = Number(input.levelId);
    if (!name || !phone) throw new Error('Nome e numero do chip sao obrigatorios.');
    if (!Number.isSafeInteger(instanceId)) throw new Error('Selecione uma instancia valida.');
    if (!Number.isSafeInteger(levelId)) throw new Error('Selecione um nivel valido.');
    const chipResponse = await client.from('chips').insert({
      users_id: userId,
      instances_id: instanceId,
      levels_id: levelId,
      status_id: statusId,
      chips_name: name,
      chips_phone: phone,
    }).select('chips_id').single();
    if (chipResponse.error) throw new Error(chipResponse.error.message);
    return (await listChips(userId)).find((item) => item.id === String((chipResponse.data as Row).chips_id))!;
  }

  const username = String(input.username ?? '').replace(/^@/, '').trim();
  const name = String(input.name ?? username).trim();
  if (!username || !name) throw new Error('Nome e usuario do Instagram sao obrigatorios.');
  const levelId = Number(input.levelId);
  if (!Number.isSafeInteger(levelId)) throw new Error('Selecione um nivel valido para o Instagram.');
  const response = await client.from('socials').insert({
    users_id: userId,
    status_id: statusId,
    levels_id: levelId,
    socials_name: name,
    socials_username: username,
  }).select('socials_id').single();
  if (response.error) throw new Error(response.error.message);
  return (await listSocials(userId)).find((item) => item.id === String((response.data as Row).socials_id))!;
}

async function updateRecord(kind: ConfigKind, id: string, input: Record<string, unknown>): Promise<ConfigRecord> {
  const client = getSupabaseClient();
  const userId = await currentUserIdNumber();
  const statusId = Number(bool(input.active ?? input.status, true) ? await activeStatusId() : await inactiveStatusId());
  const numericId = Number(id);
  if (!Number.isSafeInteger(numericId)) throw new Error('Identificador invalido.');

  if (kind === 'branches') {
    const current = (await listBranches(userId)).find((item) => item.id === id);
    if (!current) throw new Error('Ramo nao encontrado.');
    const name = String(input.name ?? current.name).trim();
    const categories = input.categories ?? current.categories ?? null;
    const response = await client.from('branches').update({ status_id: statusId, branches_name: name, branches_categories: categories, branches_updated_at: nowIso() }).eq('branches_id', numericId).eq('users_id', userId);
    if (response.error) throw new Error(response.error.message);
    return (await listBranches(userId)).find((item) => item.id === id)!;
  }

  if (kind === 'templates') {
    const current = (await listTemplates(userId)).find((item) => item.id === id);
    if (!current) throw new Error('Template nao encontrado.');
    const templateChannelId = Number(input.templateChannelId ?? current.templateChannelId);
    const templateTypeId = Number(input.templateTypeId ?? current.templateTypeId);
    if (!Number.isSafeInteger(templateChannelId)) throw new Error('Selecione um canal de template valido.');
    if (!Number.isSafeInteger(templateTypeId)) throw new Error('Selecione um tipo de template valido.');
    const response = await client.from('templates').update({
      branches_id: Number(input.branchId ?? current.branchId),
      status_id: statusId,
      templates_name: String(input.name ?? current.name).trim(),
      templates_message_1: String(input.message1 ?? current.message1),
      templates_message_2: String(input.message2 ?? current.message2),
      templates_message_3: String(input.message3 ?? current.message3),
      templates_message_4: String(input.message4 ?? current.message4),
      template_channels_id: templateChannelId,
      template_types_id: templateTypeId,
      templates_updated_at: nowIso(),
    }).eq('templates_id', numericId).eq('users_id', userId);
    if (response.error) throw new Error(response.error.message);
    return (await listTemplates(userId)).find((item) => item.id === id)!;
  }

  if (kind === 'chips') {
    const current = (await listChips(userId)).find((item) => item.id === id)!;
    const instanceId = Number(input.instanceId ?? current.instanceId);
    const levelId = Number(input.levelId ?? current.levelId);
    if (!Number.isSafeInteger(instanceId)) throw new Error('Selecione uma instancia valida.');
    if (!Number.isSafeInteger(levelId)) throw new Error('Selecione um nivel valido.');
    const chipUpdate = await client.from('chips').update({
      status_id: statusId,
      instances_id: instanceId,
      levels_id: levelId,
      chips_name: String(input.name ?? current.name),
      chips_phone: String(input.number ?? current.number).replace(/\D/g, ''),
      chips_updated_at: nowIso(),
    }).eq('chips_id', numericId).eq('users_id', userId);
    if (chipUpdate.error) throw new Error(chipUpdate.error.message);
    return (await listChips(userId)).find((item) => item.id === id)!;
  }

  const socialResponse = await client.from('socials').select('*').eq('socials_id', numericId).eq('users_id', userId).single();
  if (socialResponse.error) throw new Error(socialResponse.error.message);
  const current = (await listSocials(userId)).find((item) => item.id === id)!;
  const username = String(input.username ?? current.username).replace(/^@/, '').trim();
  const levelId = Number(input.levelId ?? current.levelId);
  if (!Number.isSafeInteger(levelId)) throw new Error('Selecione um nivel valido para o Instagram.');
  const update = await client.from('socials').update({
    status_id: statusId,
    levels_id: levelId,
    socials_name: String(input.name ?? current.name),
    socials_username: username,
    socials_updated_at: nowIso(),
  }).eq('socials_id', numericId).eq('users_id', userId);
  if (update.error) throw new Error(update.error.message);
  return (await listSocials(userId)).find((item) => item.id === id)!;
}

async function setActive(kind: ConfigKind, id: string, active: boolean) {
  const userId = await currentUserIdNumber();
  const statusId = Number(active ? await activeStatusId() : await inactiveStatusId());
  const table = kind === 'branches' ? 'branches' : kind === 'templates' ? 'templates' : kind === 'chips' ? 'chips' : 'socials';
  const pk = kind === 'branches' ? 'branches_id' : kind === 'templates' ? 'templates_id' : kind === 'chips' ? 'chips_id' : 'socials_id';
  const response = await getSupabaseClient().from(table).update({ status_id: statusId }).eq(pk, Number(id)).eq('users_id', userId);
  if (response.error) throw new Error(response.error.message);
  const records = await canonicalConfigRepository.list(kind);
  const record = records.find((item) => item.id === id);
  if (!record) throw new Error('Registro nao encontrado apos a atualizacao.');
  return record;
}

export const canonicalConfigRepository: ConfigRepository = {
  async list(kind, filters) {
    const userId = await currentUserIdNumber();
    const records = kind === 'branches'
      ? await listBranches(userId)
      : kind === 'templates'
        ? await listTemplates(userId)
        : kind === 'chips'
          ? await listChips(userId)
          : await listSocials(userId);
    return applyFilters(records, filters);
  },
  async create(kind, input) {
    return createRecord(kind, input as Record<string, unknown>);
  },
  async update(kind, id, input) {
    return updateRecord(kind, id, input as Record<string, unknown>);
  },
  async remove(kind, id) {
    await setActive(kind, id, false);
  },
  async toggleArchive(kind, id) {
    const current = (await this.list(kind)).find((item) => item.id === id);
    if (!current) throw new Error('Registro nao encontrado.');
    return setActive(kind, id, !current.active);
  },
};
