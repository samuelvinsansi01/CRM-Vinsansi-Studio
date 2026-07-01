import { getSupabaseClient, getSupabaseConfig } from '../../lib/supabase';
import { branchIdOrNull, branchSlug, normalizeBranchId } from '../../services/config/branchIdentity';
import { chipLevelDefaults } from '../../services/config/chipOperational';
import type { BranchConfigRecord, ChipConfigRecord, ConfigKind, ConfigRecord, ConfigStatus, InstagramConfigRecord, TemplateConfigRecord, TemplateType } from '../../services/config/types';
import { defaultDispatchSettings } from '../../services/settings/settings.seed';
import { createUuid, getCurrentUserId, nowIso } from '../supabase.helpers';
import type { ConfigRepository } from './config.repository';

function tableForKind(kind: ConfigKind) {
  const tables = getSupabaseConfig().tables;
  if (kind === 'chips') return tables.chips;
  if (kind === 'instagram') return tables.instagramProfiles;
  if (kind === 'branches') return tables.branches;
  return tables.templates;
}

function statusFromActive(active: boolean): ConfigStatus {
  return active ? 'Ativo' : 'Inativo';
}

function toBoolean(value: unknown, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).toLowerCase();
  if (['ativo', 'true', '1', 'sim', 'connected', 'open'].includes(normalized)) return true;
  if (['inativo', 'arquivado', 'false', '0', 'nao', 'não', 'paused', 'closed'].includes(normalized)) return false;
  return fallback;
}

function normalizeComparable(value: unknown) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function textFrom(...values: unknown[]) {
  const found = values.find((value) => String(value ?? '').trim());
  return String(found ?? '');
}

function uuidOrNull(value: unknown) {
  const text = String(value ?? '').trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(text) ? text : null;
}

function splitList(value: unknown) {
  const rawItems = Array.isArray(value) ? value : String(value ?? '').split(/[,;\n]/);
  const seen = new Set<string>();
  const list: string[] = [];

  for (const rawItem of rawItems) {
    const item = String(rawItem ?? '').trim();
    const key = normalizeComparable(item);
    if (!item || seen.has(key)) continue;
    seen.add(key);
    list.push(item);
  }

  return list;
}

function isArchived(record: ConfigRecord) {
  return normalizeComparable(record.status) === 'arquivado';
}

function isDeletedStatus(value: unknown) {
  return normalizeComparable(value) === 'deleted' || normalizeComparable(value).startsWith('excluido') || normalizeComparable(value).startsWith('deletado');
}

function isDeleted(record: ConfigRecord) {
  return isDeletedStatus(record.status);
}

function isTestConfigRecord(record: ConfigRecord) {
  const signature = normalizeComparable(JSON.stringify(record));
  return signature.includes('teste supabase') || signature.includes('supabase real') || signature.includes('codex') || signature.includes('template fake');
}

function applyFilter(records: ConfigRecord[], search?: string, status?: string) {
  const query = search?.trim().toLowerCase() ?? '';
  const normalizedStatus = normalizeComparable(status);

  return records.filter((record) => {
    if (isTestConfigRecord(record)) return false;
    if (isDeleted(record)) return false;
    const matchesQuery = !query || JSON.stringify(record).toLowerCase().includes(query);
    const matchesStatus =
      !normalizedStatus ||
      normalizedStatus === 'todos' ||
      (normalizedStatus === 'ativos' && record.active && !isArchived(record)) ||
      (normalizedStatus === 'inativos' && !record.active && !isArchived(record)) ||
      (normalizedStatus === 'arquivados' && isArchived(record)) ||
      normalizeComparable(record.status) === normalizedStatus;
    return matchesQuery && matchesStatus;
  });
}

function normalizeBranch(input: Record<string, unknown>, fallback?: BranchConfigRecord): BranchConfigRecord {
  const timestamp = nowIso();
  const active = toBoolean(input.active ?? input.status, fallback?.active ?? true);
  const rawStatus = input.status ?? fallback?.status;
  const status = isDeletedStatus(rawStatus) ? 'deleted' : normalizeComparable(rawStatus) === 'arquivado' ? 'Arquivado' : statusFromActive(active);
  const name = textFrom(input.name, fallback?.name, 'Novo ramo');
  const slug = textFrom(input.slug, fallback?.slug, branchSlug(name));
  const sourceId = normalizeBranchId(textFrom(input.id));
  const subcategories = splitList(input.subcategories ?? fallback?.subcategories ?? []);
  const associatedCategories = splitList(input.associatedCategories ?? fallback?.associatedCategories ?? input.category ?? []);

  return {
    ...(fallback ?? {}),
    ...input,
    id: String(fallback?.id ?? sourceId),
    kind: 'branches',
    slug,
    name,
    category: String(input.category ?? fallback?.category ?? name),
    subcategories,
    associatedCategories,
    order: Number(input.order ?? fallback?.order ?? 1),
    minRating: Number(input.minRating ?? fallback?.minRating ?? 4),
    minReviews: Number(input.minReviews ?? fallback?.minReviews ?? 10),
    imageName: String(input.imageName ?? input.image_name ?? fallback?.imageName ?? ''),
    active,
    status,
    createdAt: String(fallback?.createdAt ?? input.createdAt ?? timestamp),
    updatedAt: timestamp,
  } as BranchConfigRecord;
}

function rowToBranch(row: Record<string, unknown>): BranchConfigRecord {
  const data = (row.data && typeof row.data === 'object' ? row.data : {}) as Partial<BranchConfigRecord>;
  const rawStatus = row.status ?? data.status;
  const inactiveFlatStatus = normalizeComparable(rawStatus) === 'arquivado' || isDeletedStatus(rawStatus);
  const sourceId = normalizeBranchId(textFrom(row.id, data.id)) || textFrom(row.id, data.id);
  const name = textFrom(row.name, data.name, row.category, data.category, 'Novo ramo');
  const slug = textFrom(row.slug, data.slug, branchSlug(name));
  return normalizeBranch(
    {
      ...data,
      id: sourceId,
      slug,
      name,
      category: textFrom(row.category, data.category, name),
      subcategories: row.subcategories ?? data.subcategories,
      associatedCategories: row.associated_categories ?? data.associatedCategories,
      order: row.order_index ?? data.order,
      minRating: row.min_rating ?? data.minRating,
      minReviews: row.min_reviews ?? data.minReviews,
      imageName: row.image_name ?? data.imageName,
      active: inactiveFlatStatus ? data.active ?? row.active : row.active ?? data.active,
      status: row.status ?? data.status,
      createdAt: row.created_at ?? data.createdAt,
      updatedAt: row.updated_at ?? data.updatedAt,
    },
    undefined,
  );
}

function normalizeTemplateType(value: unknown): TemplateType {
  const normalized = String(value ?? '').toLowerCase();
  if (normalized.includes('com')) return 'com-site';
  if (normalized.includes('agreg')) return 'com-site';
  return 'sem-site';
}

function resolveTemplateBranch(row: Record<string, unknown>, data: Partial<TemplateConfigRecord>, branches: BranchConfigRecord[]) {
  const branchId = textFrom(row.branch_id, data.branchId);
  const branchName = textFrom(row.branch_name, data.branchName);
  const match =
    branches.find((branch) => branch.id === branchId) ??
    branches.find((branch) => normalizeComparable(branch.name) === normalizeComparable(branchName));

  return {
    branchId: match?.id ?? branchId,
    branchName: match?.name ?? branchName,
  };
}

function rowToTemplate(row: Record<string, unknown>, branches: BranchConfigRecord[] = []): TemplateConfigRecord {
  const data = (row.data && typeof row.data === 'object' ? row.data : {}) as Partial<TemplateConfigRecord>;
  const rawStatus = row.status ?? data.status;
  const inactiveFlatStatus = normalizeComparable(rawStatus) === 'arquivado' || isDeletedStatus(rawStatus);
  const active = toBoolean(inactiveFlatStatus ? data.active ?? row.active : row.active ?? data.active, true);
  const status = isDeletedStatus(rawStatus) ? 'deleted' : normalizeComparable(rawStatus) === 'arquivado' ? 'Arquivado' : statusFromActive(active);
  const message1 = String(row.part_1 ?? row.message1 ?? data.message1 ?? '');
  const message2 = String(row.part_2 ?? row.message2 ?? data.message2 ?? '');
  const branch = resolveTemplateBranch(row, data, branches);
  return {
    id: String(row.id),
    kind: 'templates',
    name: String(row.name ?? data.name ?? 'Template'),
    branchId: branch.branchId,
    branchName: branch.branchName,
    channel: (row.channel ?? data.channel ?? 'WhatsApp') as TemplateConfigRecord['channel'],
    type: normalizeTemplateType(row.template_type ?? row.type ?? data.type),
    message1,
    message2,
    preview: String(data.preview ?? message1),
    variables: Array.isArray(row.variables) ? row.variables.map(String) : Array.isArray(data.variables) ? data.variables : ['{EMPRESA}'],
    order: Number(row.order ?? data.order ?? 1),
    archivedPreviousActive: (data as Record<string, unknown>).archivedPreviousActive,
    active,
    status: status as ConfigStatus,
    createdAt: String(row.created_at ?? data.createdAt ?? nowIso()),
    updatedAt: String(row.updated_at ?? data.updatedAt ?? nowIso()),
  };
}

function rowToChip(row: Record<string, unknown>): ChipConfigRecord {
  const data = (row.data && typeof row.data === 'object' ? row.data : {}) as Partial<ChipConfigRecord>;
  const rawStatus = data.status ?? row.status;
  const inactiveFlatStatus = normalizeComparable(rawStatus) === 'arquivado' || isDeletedStatus(rawStatus);
  const active = toBoolean(inactiveFlatStatus ? data.active ?? row.active : row.active ?? data.active, true);
  const status = isDeletedStatus(rawStatus) ? 'deleted' : normalizeComparable(rawStatus) === 'arquivado' ? 'Arquivado' : statusFromActive(active);
  const level = String(row.level ?? data.level ?? 'estabilizado');
  const levelDefaults = chipLevelDefaults(level);
  const blocks = row.blocks;
  const batches = Array.isArray(data.batches)
    ? data.batches
    : Array.isArray(blocks)
      ? blocks.map(String)
      : levelDefaults.batches;
  const instance = String(row.instance ?? data.instance ?? row.name ?? row.label ?? 'Chip');
  const connectionStatus = String(row.status ?? data.connectionStatus ?? '');
  return {
    id: String(row.id),
    kind: 'chips',
    instance,
    connectionStatus,
    name: String(row.label ?? row.name ?? row.instance ?? data.name ?? 'Chip'),
    number: String(row.phone ?? row.number ?? data.number ?? ''),
    level,
    url: String(row.url ?? row.evolution_url ?? row.base_url ?? data.url ?? ''),
    apiKey: String(row.api_key ?? data.apiKey ?? ''),
    priority: Number(row.priority ?? data.priority ?? 1),
    startTime: String(row.start_time ?? row.startTime ?? data.startTime ?? levelDefaults.startTime),
    endTime: String(row.end_time ?? row.endTime ?? data.endTime ?? levelDefaults.endTime),
    dailyLimit: Number(row.daily_limit ?? row.dailyLimit ?? data.dailyLimit ?? levelDefaults.dailyLimit),
    intervalSeconds: Number(row.interval_seconds ?? row.intervalSeconds ?? data.intervalSeconds ?? levelDefaults.intervalSeconds),
    blockSize: Number(row.block_size ?? row.blockSize ?? data.blockSize ?? levelDefaults.blockSize),
    batches,
    archivedPreviousActive: (data as Record<string, unknown>).archivedPreviousActive,
    paused: toBoolean(row.paused, data.paused ?? false),
    active,
    status: status as ConfigStatus,
    createdAt: String(row.created_at ?? data.createdAt ?? nowIso()),
    updatedAt: String(row.updated_at ?? data.updatedAt ?? nowIso()),
  };
}

function normalizeInstagramUsername(value: unknown) {
  return String(value ?? '')
    .trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
    .replace(/^@/, '')
    .split(/[/?#\s]/)[0]
    .toLowerCase();
}

function rowToInstagramProfile(row: Record<string, unknown>): InstagramConfigRecord {
  const data = (row.data && typeof row.data === 'object' ? row.data : {}) as Partial<InstagramConfigRecord>;
  const active = toBoolean(row.active ?? data.active, true);
  const archived = normalizeComparable(row.status ?? data.status) === 'arquivado';
  const deleted = isDeletedStatus(row.status ?? data.status);
  const username = normalizeInstagramUsername(row.username ?? data.username ?? row.profile_username ?? data.instagram);
  return {
    id: String(row.id),
    kind: 'instagram',
    name: String((row.display_name ?? row.name ?? data.name ?? username) || 'Perfil Instagram'),
    username,
    archivedPreviousActive: (data as Record<string, unknown>).archivedPreviousActive,
    active,
    status: (deleted ? 'deleted' : archived ? 'Arquivado' : statusFromActive(active)) as ConfigStatus,
    createdAt: String(row.created_at ?? data.createdAt ?? nowIso()),
    updatedAt: String(row.updated_at ?? data.updatedAt ?? nowIso()),
  };
}

async function listTemplates() {
  const branches = await listBranches();
  const { data, error } = await getSupabaseClient().from(tableForKind('templates')).select('*');
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => rowToTemplate(row, branches));
}

async function listBranches() {
  const { data, error } = await getSupabaseClient().from(tableForKind('branches')).select('*');
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => rowToBranch(row));
}

async function listChips() {
  const { data, error } = await getSupabaseClient().from(tableForKind('chips')).select('*');
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => rowToChip(row));
}

async function listInstagramProfiles() {
  const { data, error } = await getSupabaseClient().from(tableForKind('instagram')).select('*');
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => rowToInstagramProfile(row));
}

async function findRowById(table: string, id: unknown) {
  const text = String(id ?? '').trim();
  if (!text) return null;
  const { data, error } = await getSupabaseClient().from(table).select('*').eq('id', text).maybeSingle();
  if (error) throw new Error(error.message);
  return data as Record<string, unknown> | null;
}

async function upsertTemplate(record: TemplateConfigRecord) {
  const userId = await getCurrentUserId();
  const table = tableForKind('templates');
  const branches = await listBranches();
  const branch =
    branches.find((item) => item.id === record.branchId) ??
    branches.find((item) => normalizeComparable(item.name) === normalizeComparable(record.branchName));
  const branchId = branchIdOrNull(branch?.id ?? record.branchId);
  const existingById = await findRowById(table, record.id);
  let existingByNatural: Record<string, unknown> | null = null;

  if (record.name.trim()) {
    let query = getSupabaseClient()
      .from(table)
      .select('*')
      .eq('user_id', userId)
      .eq('name', record.name)
      .eq('template_type', record.type)
      .eq('channel', record.channel);
    query = branchId ? query.eq('branch_id', branchId) : query.eq('branch_name', branch?.name || record.branchName);
    const response = await query.maybeSingle();
    if (response.error) throw new Error(response.error.message);
    existingByNatural = response.data as Record<string, unknown> | null;
  }

  if (existingById && existingByNatural && String(existingById.id) !== String(existingByNatural.id)) {
    throw new Error('Ja existe um template com este nome, ramo, canal e tipo.');
  }

  const targetId = String(existingByNatural?.id ?? existingById?.id ?? record.id ?? createUuid());
  const payload = {
    id: targetId,
    user_id: userId,
    name: record.name,
    branch_id: branchId,
    ramo_id: null,
    branch_name: branch?.name || record.branchName,
    template_type: record.type,
    type: record.type,
    channel: record.channel,
    part_1: record.message1,
    part_2: record.message2,
    variables: record.variables,
    active: record.status !== 'Arquivado' && record.status !== 'deleted' && record.active,
    status: record.status,
    kind: 'templates',
    data: { ...record, branchId: branch?.id ?? record.branchId, branchName: branch?.name ?? record.branchName },
    updated_at: nowIso(),
  };
  const response = existingByNatural || existingById
    ? await getSupabaseClient().from(table).update(payload).eq('id', targetId).select('*').single()
    : await getSupabaseClient().from(table).insert({ ...payload, created_at: record.createdAt || nowIso() }).select('*').single();
  if (response.error) throw new Error(response.error.message);
  return rowToTemplate(response.data ?? payload, branches);
}

async function upsertChip(record: ChipConfigRecord) {
  const userId = await getCurrentUserId();
  const table = tableForKind('chips');
  const instance = String(record.instance || record.name || record.id).trim();
  const levelDefaults = chipLevelDefaults(record.level);
  const existingById = await findRowById(table, record.id);
  let existingByInstance: Record<string, unknown> | null = null;

  if (instance) {
    const response = await getSupabaseClient()
      .from(table)
      .select('*')
      .eq('user_id', userId)
      .eq('instance', instance)
      .maybeSingle();
    if (response.error) throw new Error(response.error.message);
    existingByInstance = response.data as Record<string, unknown> | null;
  }

  if (existingById && existingByInstance && String(existingById.id) !== String(existingByInstance.id)) {
    throw new Error('Ja existe um chip com esta instancia.');
  }

  const targetId = String(existingByInstance?.id ?? existingById?.id ?? record.id ?? createUuid());
  const payload = {
    id: targetId,
    user_id: userId,
    instance,
    label: record.name,
    name: record.name,
    phone: record.number,
    base_url: record.url,
    evolution_url: record.url,
    url: record.url,
    api_key: record.apiKey,
    active: record.status !== 'Arquivado' && record.status !== 'deleted' && record.active,
    status: record.connectionStatus || 'inactive',
    daily_limit: record.dailyLimit || levelDefaults.dailyLimit,
    block_size: record.blockSize || levelDefaults.blockSize,
    interval_seconds: record.intervalSeconds || levelDefaults.intervalSeconds,
    blocks: record.batches?.length ? record.batches : levelDefaults.batches,
    level: record.level,
    priority: record.priority,
    start_time: record.startTime || levelDefaults.startTime,
    end_time: record.endTime || levelDefaults.endTime,
    paused: record.paused,
    kind: 'chips',
    channel: 'whatsapp',
    data: { ...record, instance },
    updated_at: nowIso(),
  };
  const response = existingByInstance || existingById
    ? await getSupabaseClient().from(table).update(payload).eq('id', targetId).select('*').single()
    : await getSupabaseClient().from(table).insert({ ...payload, created_at: record.createdAt || nowIso() }).select('*').single();
  if (response.error) throw new Error(response.error.message);
  return rowToChip(response.data ?? payload);
}

async function upsertInstagramProfile(record: InstagramConfigRecord) {
  const userId = await getCurrentUserId();
  const table = tableForKind('instagram');
  const instagramDefaults = defaultDispatchSettings.instagram;
  const username = normalizeInstagramUsername(record.username);
  const existingById = await findRowById(table, record.id);
  let existingByUsername: Record<string, unknown> | null = null;

  if (username) {
    const response = await getSupabaseClient()
      .from(table)
      .select('*')
      .eq('user_id', userId)
      .eq('username', username)
      .maybeSingle();
    if (response.error) throw new Error(response.error.message);
    existingByUsername = response.data as Record<string, unknown> | null;
  }

  if (existingById && existingByUsername && String(existingById.id) !== String(existingByUsername.id)) {
    throw new Error('Ja existe um perfil Instagram com este usuario.');
  }

  const targetId = String(existingByUsername?.id ?? existingById?.id ?? uuidOrNull(record.id) ?? createUuid());
  const payload = {
    id: targetId,
    user_id: userId,
    username,
    display_name: record.name,
    active: record.status !== 'Arquivado' && record.status !== 'deleted' && record.active,
    status: record.status,
    daily_limit: instagramDefaults.dailyLimit,
    blocks: instagramDefaults.batches,
    block_size: instagramDefaults.perBatch,
    interval_minutes: instagramDefaults.delayMinutes,
    updated_at: nowIso(),
  };
  const response = existingByUsername || existingById
    ? await getSupabaseClient().from(table).update(payload).eq('id', targetId).select('*').single()
    : await getSupabaseClient().from(table).insert({ ...payload, created_at: record.createdAt || nowIso() }).select('*').single();
  if (response.error) throw new Error(response.error.message);
  return rowToInstagramProfile(response.data ?? { ...payload, created_at: record.createdAt });
}

async function upsertBranch(record: BranchConfigRecord) {
  const userId = await getCurrentUserId();
  const table = tableForKind('branches');
  const numericId = branchIdOrNull(record.id);
  const slug = record.slug || branchSlug(record.name);
  const existingById = numericId ? await findRowById(table, numericId) : null;
  let existingBySlug: Record<string, unknown> | null = null;

  if (slug) {
    const response = await getSupabaseClient()
      .from(table)
      .select('*')
      .eq('slug', slug)
      .maybeSingle();
    if (response.error) throw new Error(response.error.message);
    existingBySlug = response.data as Record<string, unknown> | null;
  }

  if (existingById && existingBySlug && String(existingById.id) !== String(existingBySlug.id)) {
    throw new Error('Ja existe um ramo com este slug.');
  }

  const payload = {
    user_id: userId,
    slug,
    name: record.name,
    category: record.category || record.name,
    subcategories: record.subcategories,
    associated_categories: record.associatedCategories,
    order_index: record.order,
    min_rating: record.minRating,
    min_reviews: record.minReviews,
    image_name: record.imageName,
    active: record.status !== 'Arquivado' && record.status !== 'deleted' && record.active,
    status: record.status,
    kind: 'branches',
    data: { ...record, id: String(existingBySlug?.id ?? existingById?.id ?? numericId ?? record.id), slug, imageName: record.imageName },
    updated_at: nowIso(),
  };
  const targetId = existingBySlug?.id ?? existingById?.id ?? numericId;
  const queryPayload = targetId ? { ...payload, id: targetId } : payload;
  const response = targetId
    ? await getSupabaseClient().from(table).update(queryPayload).eq('id', targetId).select('*').single()
    : await getSupabaseClient().from(table).insert({ ...queryPayload, created_at: record.createdAt || nowIso() }).select('*').single();

  if (response.error) throw new Error(response.error.message);
  return rowToBranch((response.data ?? { ...queryPayload, created_at: record.createdAt }) as Record<string, unknown>);
}

export const supabaseConfigRepository: ConfigRepository = {
  async list(kind, filters = {}) {
    if (kind === 'templates') return applyFilter(await listTemplates(), filters.search, filters.status);
    if (kind === 'chips') return applyFilter(await listChips(), filters.search, filters.status);
    if (kind === 'instagram') return applyFilter(await listInstagramProfiles(), filters.search, filters.status);
    return applyFilter(await listBranches(), filters.search, filters.status);
  },

  async create(kind, input) {
    if (kind === 'templates') return upsertTemplate(rowToTemplate({ ...input, id: createUuid(), active: input.active ?? true }));
    if (kind === 'chips') return upsertChip(rowToChip({ ...input, id: createUuid(), active: input.active ?? true }));
    if (kind === 'instagram') return upsertInstagramProfile(rowToInstagramProfile({ ...input, id: createUuid(), active: input.active ?? true }));
    const record = normalizeBranch({ ...input, active: input.active ?? true });
    return upsertBranch(record);
  },

  async update(kind, id, input) {
    const existing = (await this.list(kind, {})).find((record) => record.id === id);
    if (!existing) throw new Error('Registro nao encontrado.');
    if (kind === 'templates') return upsertTemplate(rowToTemplate({ ...existing, ...input, id }));
    if (kind === 'chips') return upsertChip(rowToChip({ ...existing, ...input, id }));
    if (kind === 'instagram') return upsertInstagramProfile(rowToInstagramProfile({ ...existing, ...input, id }));
    const record = normalizeBranch({ ...existing, ...input, id }, existing as BranchConfigRecord);
    return upsertBranch(record);
  },

  async remove(kind, id) {
    const existing = (await this.list(kind, {})).find((record) => record.id === id);
    if (!existing) throw new Error('Registro nao encontrado.');
    await this.update(kind, id, {
      ...existing,
      active: false,
      status: 'deleted',
      deletedAt: nowIso(),
    });
  },

  async toggleArchive(kind, id) {
    const existing = (await this.list(kind, {})).find((record) => record.id === id);
    if (!existing) throw new Error('Registro nao encontrado.');
    const archived = isArchived(existing);
    const metadata = existing as ConfigRecord & { archivedPreviousActive?: unknown };
    const restoredActive = typeof metadata.archivedPreviousActive === 'boolean' ? metadata.archivedPreviousActive : true;
    return this.update(kind, id, {
      ...existing,
      active: archived ? restoredActive : existing.active,
      archivedPreviousActive: archived ? undefined : existing.active,
      status: archived ? statusFromActive(restoredActive) : 'Arquivado',
    });
  },
};
