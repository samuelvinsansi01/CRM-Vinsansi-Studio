import { getSupabaseClient, getSupabaseConfig } from '../../lib/supabase';
import { branchIdOrNull, branchSlug, normalizeBranchId, normalizeBranchText } from '../../services/config/branchIdentity';
import { chipLevelDefaults, inferChipLevelFromConfig } from '../../services/config/chipOperational';
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

const TEMPLATE_SELECT = [
  'id',
  'user_id',
  'branch_id',
  'ramo_id',
  'branch_name',
  'template_type',
  'type',
  'channel',
  'part_1',
  'part_2',
  'active',
  'status',
  'kind',
  'data',
  'created_at',
  'updated_at',
].join(',');

function statusFromActive(active: boolean): ConfigStatus {
  return active ? 'Ativo' : 'Inativo';
}

const TEMPLATE_LIMIT_PER_BRANCH_CHANNEL_TYPE = 10;

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
    // Compatibilidade: ramos legados que ja possuem nome de imagem mantem o comportamento
    // esperado de exigir a midia, ate que o usuario escolha explicitamente o contrario.
    imageRequired: toBoolean(input.imageRequired ?? input.image_required ?? fallback?.imageRequired, Boolean(input.imageName ?? input.image_name ?? fallback?.imageName)),
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
      imageRequired: row.image_required ?? data.imageRequired ?? data.image_required,
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

function normalizeTemplateChannel(value: unknown): TemplateConfigRecord['channel'] {
  const normalized = normalizeComparable(value);
  if (normalized.includes('instagram')) return 'Instagram';
  if (normalized.includes('geral')) return 'Geral';
  return 'WhatsApp';
}

function resolveTemplateBranch(row: Record<string, unknown>, data: Partial<TemplateConfigRecord>, branches: BranchConfigRecord[]) {
  const branchId = textFrom(row.branch_id, row.branchId, row.ramo_id, row.ramoId, data.branchId);
  const branchName = textFrom(row.branch_name, row.branchName, row.ramo, data.branchName);
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
  const channel = normalizeTemplateChannel(row.channel ?? data.channel);
  const type = normalizeTemplateType(row.template_type ?? row.type ?? data.type);
  return {
    id: String(row.id),
    kind: 'templates',
    branchId: branch.branchId,
    branchName: branch.branchName,
    channel,
    type,
    message1,
    message2,
    preview: String(data.preview ?? message1),
    archivedPreviousActive: (data as Record<string, unknown>).archivedPreviousActive,
    active,
    status: status as ConfigStatus,
    createdAt: String(row.created_at ?? data.createdAt ?? nowIso()),
    updatedAt: String(row.updated_at ?? data.updatedAt ?? nowIso()),
  };
}

function rowToChip(row: Record<string, unknown>): ChipConfigRecord {
  const data = (row.data && typeof row.data === 'object' ? row.data : {}) as Partial<ChipConfigRecord> & Record<string, unknown>;
  const rawStatus = data.status ?? row.status;
  const inactiveFlatStatus = normalizeComparable(rawStatus) === 'arquivado' || isDeletedStatus(rawStatus);
  const active = toBoolean(inactiveFlatStatus ? data.active ?? row.active : row.active ?? data.active, true);
  const status = isDeletedStatus(rawStatus) ? 'deleted' : normalizeComparable(rawStatus) === 'arquivado' ? 'Arquivado' : statusFromActive(active);
  const rawLevel = String(row.level ?? data.level ?? 'estabilizado');
  const blocks = row.blocks;
  const batches = Array.isArray(data.batches)
    ? data.batches
    : Array.isArray(blocks)
      ? blocks.map(String)
      : chipLevelDefaults(rawLevel).batches;
  const inferredLevel = inferChipLevelFromConfig({
    level: rawLevel,
    dailyLimit: Number(row.daily_limit ?? row.dailyLimit ?? data.dailyLimit ?? 0),
    batchCount: batches.length || Number((row as Record<string, unknown>).batchCount ?? data.batchCount ?? 0),
    intervalSeconds: Number(row.interval_seconds ?? row.intervalSeconds ?? data.intervalSeconds ?? 0),
    batches,
    startTime: String(row.start_time ?? row.startTime ?? data.startTime ?? ''),
    endTime: String(row.end_time ?? row.endTime ?? data.endTime ?? ''),
  });
  const level = inferredLevel || rawLevel;
  const levelDefaults = chipLevelDefaults(level);
  const instance = String(row.instance ?? data.instance ?? row.name ?? row.label ?? 'Chip');
  const connectionStatus = String(row.status ?? data.status ?? data.connectionStatus ?? row.connectionStatus ?? (active ? 'Ativo' : 'Inativo'));
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
    dailyLimit: Number(row.daily_limit ?? data.dailyLimit ?? defaultDispatchSettings.instagram.dailyLimit),
    archivedPreviousActive: (data as Record<string, unknown>).archivedPreviousActive,
    active,
    status: (deleted ? 'deleted' : archived ? 'Arquivado' : statusFromActive(active)) as ConfigStatus,
    createdAt: String(row.created_at ?? data.createdAt ?? nowIso()),
    updatedAt: String(row.updated_at ?? data.updatedAt ?? nowIso()),
  };
}

async function listTemplates() {
  const branches = await listBranches();
  const { data, error } = await getSupabaseClient().from(tableForKind('templates')).select(TEMPLATE_SELECT);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as Record<string, unknown>[]).map((row) => rowToTemplate(row, branches));
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

async function findTemplateRowById(table: string, id: unknown) {
  const text = String(id ?? '').trim();
  if (!text) return null;
  const { data, error } = await getSupabaseClient().from(table).select(TEMPLATE_SELECT).eq('id', text).maybeSingle();
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
  const existingById = await findTemplateRowById(table, record.id);
  let naturalQuery = getSupabaseClient()
    .from(table)
    .select(TEMPLATE_SELECT)
    .eq('user_id', userId)
    .eq('template_type', record.type)
    .eq('channel', record.channel)
    .limit(50);
  naturalQuery = branchId ? naturalQuery.eq('branch_id', branchId) : naturalQuery.eq('branch_name', branch?.name || record.branchName);
  const naturalResponse = await naturalQuery;
  if (naturalResponse.error) throw new Error(naturalResponse.error.message);
  const activeGroupCount = ((naturalResponse.data ?? []) as unknown as Record<string, unknown>[]).filter((row) => {
    const data = (row.data && typeof row.data === 'object' ? row.data : {}) as Record<string, unknown>;
    const status = row.status ?? data.status;
    return String(row.id) !== String(existingById?.id) && !isDeletedStatus(status) && normalizeComparable(status) !== 'arquivado';
  }).length;

  if (activeGroupCount >= TEMPLATE_LIMIT_PER_BRANCH_CHANNEL_TYPE) {
    throw new Error(`Limite de ${TEMPLATE_LIMIT_PER_BRANCH_CHANNEL_TYPE} templates para este ramo, canal e tipo atingido.`);
  }

  const targetId = String(existingById?.id ?? record.id ?? createUuid());
  const dataPayload: Record<string, unknown> = {
    id: targetId,
    kind: 'templates',
    branchId: branch?.id ?? record.branchId,
    branchName: branch?.name ?? record.branchName,
    channel: record.channel,
    type: record.type,
    message1: record.message1,
    message2: record.message2,
    preview: record.preview,
    active: record.active,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: nowIso(),
  };
  const payload = {
    id: targetId,
    user_id: userId,
    branch_id: branchId,
    ramo_id: null,
    branch_name: branch?.name || record.branchName,
    template_type: record.type,
    type: record.type,
    channel: record.channel,
    part_1: record.message1,
    part_2: record.message2,
    active: record.status !== 'Arquivado' && record.status !== 'deleted' && record.active,
    status: record.status,
    kind: 'templates',
    data: dataPayload,
    updated_at: nowIso(),
  };
  const response = existingById
    ? await getSupabaseClient().from(table).update(payload).eq('id', targetId).select(TEMPLATE_SELECT).single()
    : await getSupabaseClient().from(table).insert({ ...payload, created_at: record.createdAt || nowIso() }).select(TEMPLATE_SELECT).single();
  if (response.error) throw new Error(response.error.message);
  return rowToTemplate((response.data ?? payload) as unknown as Record<string, unknown>, branches);
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
  const existingData = existingByInstance ?? existingById ?? {};
  const persistedStatus = String(
    existingData.status ?? record.status ?? (record.active ? 'Ativo' : 'Inativo'),
  ).trim();
  const effectiveLevel = inferChipLevelFromConfig({
    level: record.level,
    dailyLimit: record.dailyLimit,
    batchCount: record.batches?.length || (record.blockSize > 0 && record.dailyLimit > 0 ? Math.max(1, Math.round(record.dailyLimit / record.blockSize)) : 0),
    intervalSeconds: record.intervalSeconds,
    batches: record.batches,
    startTime: record.startTime,
    endTime: record.endTime,
  }) || record.level || 'estabilizado';
  const effectiveDefaults = chipLevelDefaults(effectiveLevel);
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
    status: persistedStatus,
    daily_limit: record.dailyLimit || effectiveDefaults.dailyLimit,
    block_size: record.blockSize || effectiveDefaults.blockSize,
    interval_seconds: record.intervalSeconds || effectiveDefaults.intervalSeconds,
    blocks: record.batches?.length ? record.batches : effectiveDefaults.batches,
    priority: record.priority,
    start_time: record.startTime || effectiveDefaults.startTime,
    end_time: record.endTime || effectiveDefaults.endTime,
    paused: record.paused,
    kind: 'chips',
    channel: 'whatsapp',
    data: { ...record, level: effectiveLevel, instance, status: persistedStatus },
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
  const parsedDailyLimit = Number.parseInt(String(record.dailyLimit), 10);
  if (!Number.isFinite(parsedDailyLimit) || parsedDailyLimit < 1) {
    throw new Error('Informe um limite diario valido.');
  }
  const dailyLimit = parsedDailyLimit;
  const existingData = ((existingByUsername?.data ?? existingById?.data) && typeof (existingByUsername?.data ?? existingById?.data) === 'object'
    ? (existingByUsername?.data ?? existingById?.data)
    : {}) as Record<string, unknown>;
  const dataPayload = {
    ...existingData,
    id: targetId,
    kind: 'instagram',
    name: record.name,
    username,
    dailyLimit,
    active: record.status !== 'Arquivado' && record.status !== 'deleted' && record.active,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: nowIso(),
  };
  const active = record.status !== 'Arquivado' && record.status !== 'deleted' && record.active;
  const client = getSupabaseClient();

  if (existingByUsername || existingById) {
    // 1) Atualiza somente os metadados. O limite nao participa desta operacao,
    // evitando qualquer fallback/default sobrescrever o valor digitado.
    const metadataResponse = await client
      .from(table)
      .update({
        username,
        display_name: record.name,
        active,
        status: record.status,
        updated_at: nowIso(),
      })
      .eq('id', targetId)
      .eq('user_id', userId)
      .select('id')
      .single();

    if (metadataResponse.error) {
      throw new Error(`Nao foi possivel atualizar os dados do perfil Instagram: ${metadataResponse.error.message}`);
    }

    // 2) Ultima escrita: replica exatamente o UPDATE SQL validado manualmente.
    // Esta RPC altera apenas daily_limit e data.dailyLimit.
    const limitResponse = await client.rpc('set_instagram_profile_daily_limit_v4', {
      p_profile_id: targetId,
      p_daily_limit: dailyLimit,
    });

    if (limitResponse.error) {
      throw new Error(`Nao foi possivel persistir o limite diario: ${limitResponse.error.message}`);
    }
  } else {
    // Criacao sem campos operacionais legados (blocks, block_size, interval_minutes).
    const insertResponse = await client
      .from(table)
      .insert({
        id: targetId,
        user_id: userId,
        username,
        display_name: record.name,
        active,
        status: record.status,
        daily_limit: dailyLimit,
        data: dataPayload,
        created_at: record.createdAt || nowIso(),
        updated_at: nowIso(),
      })
      .select('id')
      .single();

    if (insertResponse.error) {
      throw new Error(`Nao foi possivel criar o perfil Instagram: ${insertResponse.error.message}`);
    }

    const limitResponse = await client.rpc('set_instagram_profile_daily_limit_v4', {
      p_profile_id: targetId,
      p_daily_limit: dailyLimit,
    });
    if (limitResponse.error) {
      throw new Error(`Perfil criado, mas nao foi possivel confirmar o limite diario: ${limitResponse.error.message}`);
    }
  }

  // Releitura independente da linha realmente persistida.
  const verifyResponse = await client
    .from(table)
    .select('*')
    .eq('id', targetId)
    .eq('user_id', userId)
    .single();

  if (verifyResponse.error) {
    throw new Error(`O perfil foi salvo, mas nao foi possivel confirmar a leitura: ${verifyResponse.error.message}`);
  }

  const saved = rowToInstagramProfile(verifyResponse.data as Record<string, unknown>);
  if (saved.dailyLimit !== dailyLimit) {
    throw new Error(`Falha de confirmacao: foi solicitado ${dailyLimit}, mas o banco retornou ${saved.dailyLimit}.`);
  }

  return saved;
}

function rowData(row: Record<string, unknown>) {
  return row.data && typeof row.data === 'object' && !Array.isArray(row.data) ? row.data as Record<string, unknown> : {};
}

function isOpenQueueRow(row: Record<string, unknown>) {
  const data = rowData(row);
  const status = normalizeComparable(row.status ?? data.status);
  // Itens em envio, enviados, invalidados ou finalizados mantem o snapshot
  // historico. Apenas itens ainda aguardando/reprocessaveis herdam o ramo atual.
  return !['sending', 'enviando', 'sent', 'enviado', 'invalid', 'invalidado', 'invalido', 'deleted', 'arquivado', 'archived'].includes(status);
}

function queueRowUsesBranch(row: Record<string, unknown>, branch: BranchConfigRecord) {
  const data = rowData(row);
  const rowId = normalizeBranchId(textFrom(row.branch_id, data.branch_id, data.branchId));
  const branchId = normalizeBranchId(branch.id);
  if (rowId && branchId && rowId === branchId) return true;

  const rowSlug = branchSlug(textFrom(row.branch_slug, data.branch_slug, data.branchSlug));
  if (rowSlug && rowSlug !== 'ramo' && rowSlug === branchSlug(branch.slug || branch.name)) return true;

  const rowName = normalizeComparable(textFrom(row.parent_category, row.branch_name, data.branch, data.branch_name, data.branchName));
  return Boolean(rowName) && (rowName === normalizeComparable(branch.name) || rowName === normalizeComparable(branch.category));
}

async function propagateBranchMediaToOpenQueues(branch: BranchConfigRecord) {
  const client = getSupabaseClient();
  const tables = [getSupabaseConfig().tables.whatsappQueueItems, getSupabaseConfig().tables.instagramQueueItems];
  const imageName = String(branch.imageName ?? '').trim();
  const imageRequired = Boolean(branch.imageRequired);
  const effectiveImageUrl = imageRequired ? imageName : '';

  for (const queueTable of tables) {
    const response = await client.from(queueTable).select('*');
    // A leitura dinâmica ainda garante o valor correto no painel/worker se uma
    // tabela antiga estiver temporariamente sem permissão de atualização.
    if (response.error) {
      console.warn(`[branches] nao foi possivel sincronizar ${queueTable}: ${response.error.message}`);
      continue;
    }

    const targets = (response.data ?? [])
      .filter((row) => isOpenQueueRow(row as Record<string, unknown>))
      .filter((row) => queueRowUsesBranch(row as Record<string, unknown>, branch));

    await Promise.all(targets.map(async (row) => {
      const current = row as Record<string, unknown>;
      const data = rowData(current);
      const { error } = await client
        .from(queueTable)
        .update({
          image_url: effectiveImageUrl,
          data: {
            ...data,
            imageName,
            imageRequired,
            image_url: effectiveImageUrl,
          },
          updated_at: nowIso(),
        })
        .eq('id', current.id);
      if (error) {
        console.warn(`[branches] item ${String(current.id)} nao sincronizado em ${queueTable}: ${error.message}`);
      }
    }));
  }
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
    // imageRequired permanece tambem em data para compatibilidade com o schema legado,
    // sem exigir uma nova coluna no banco atual.
    data: { ...record, id: String(existingBySlug?.id ?? existingById?.id ?? numericId ?? record.id), slug, imageName: record.imageName, imageRequired: record.imageRequired },
    updated_at: nowIso(),
  };
  const targetId = existingBySlug?.id ?? existingById?.id ?? numericId;
  const queryPayload = targetId ? { ...payload, id: targetId } : payload;
  const response = targetId
    ? await getSupabaseClient().from(table).update(queryPayload).eq('id', targetId).select('*').single()
    : await getSupabaseClient().from(table).insert({ ...queryPayload, created_at: record.createdAt || nowIso() }).select('*').single();

  if (response.error) throw new Error(response.error.message);
  const saved = rowToBranch((response.data ?? { ...queryPayload, created_at: record.createdAt }) as Record<string, unknown>);
  // O ramo é a fonte de verdade da mídia de itens ainda abertos. A persistência
  // atualiza a fila imediatamente; as leituras também resolvem o ramo em tempo
  // real para cobrir registros legados que não tenham sido atualizados.
  await propagateBranchMediaToOpenQueues(saved);
  return saved;
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
