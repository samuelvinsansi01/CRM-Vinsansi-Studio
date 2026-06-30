import { eventBus } from '../../lib/events';
import { repositories } from '../../repositories';
import { branchSlug, normalizeBranchId } from './branchIdentity';
import {
  DEFAULT_BRANCH_MIN_RATING,
  DEFAULT_BRANCH_MIN_REVIEWS,
  DEFAULT_TEMPLATE_MESSAGE_1,
  DEFAULT_TEMPLATE_MESSAGE_2,
  MAX_TEMPLATES_PER_BRANCH_TYPE,
  MOVEIS_PLANEJADOS_KEYWORDS,
} from './config.seed';
import { chipLevelDefaults } from './chipOperational';
import type {
  BranchConfigRecord,
  ChipConfigRecord,
  ConfigKind,
  ConfigListFilters,
  ConfigRecord,
  ConfigStatus,
  CreateConfigRecordInput,
  InstagramConfigRecord,
  TemplateChannel,
  TemplateConfigRecord,
  TemplateType,
  UpdateConfigRecordInput,
} from './types';

function nowIso() {
  return new Date().toISOString();
}

function fallbackId(kind: ConfigKind) {
  return `${kind}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function normalizeText(value: unknown) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function firstString(source: Record<string, unknown>, keys: string[], fallback = '') {
  for (const key of keys) {
    const value = source[key];
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return fallback;
}

function toNumber(value: unknown, fallback: number, min?: number) {
  const parsed = typeof value === 'string' ? Number(value.replace(',', '.')) : Number(value);
  const nextValue = Number.isFinite(parsed) ? parsed : fallback;
  return min === undefined ? nextValue : Math.max(min, nextValue);
}

function toInteger(value: unknown, fallback: number, min?: number) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  const nextValue = Number.isFinite(parsed) ? parsed : fallback;
  return min === undefined ? nextValue : Math.max(min, nextValue);
}

function toBoolean(value: unknown, fallback = true) {
  if (typeof value === 'boolean') return value;
  const normalized = normalizeText(value);
  if (['ativo', 'active', 'true', 'sim', 'ligado', '1'].includes(normalized)) return true;
  if (['inativo', 'inactive', 'false', 'nao', 'desligado', '0', 'arquivado', 'offline'].includes(normalized)) return false;
  return fallback;
}

function statusFromActive(active: boolean): ConfigStatus {
  return active ? 'Ativo' : 'Inativo';
}

function splitList(value: unknown) {
  const rawItems = Array.isArray(value) ? value : String(value ?? '').split(/[,;\n]/);
  const seen = new Set<string>();
  const list: string[] = [];

  for (const rawItem of rawItems) {
    const item = String(rawItem ?? '').trim();
    const key = normalizeText(item);
    if (!item || seen.has(key)) continue;
    seen.add(key);
    list.push(item);
  }

  return list;
}

function isTestConfigRecord(record: ConfigRecord) {
  const source = [
    record.id,
    record.name,
    'slug' in record ? record.slug : '',
    'username' in record ? record.username : '',
    'instance' in record ? record.instance : '',
    'number' in record ? record.number : '',
    'branchName' in record ? record.branchName : '',
  ]
    .map((value) => normalizeText(value))
    .join(' ');

  return [
    'teste supabase',
    'supabase real',
    'supabase-real',
    'chip supabase',
    'template fake',
    'ramo fake',
    'perfil fake',
    'codex',
    'mock',
    'seed',
  ].some((marker) => source.includes(marker));
}

function normalizeTime(value: unknown, fallback: string) {
  const text = String(value ?? '').trim();
  const match = text.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return fallback;
  const hour = Math.min(23, Math.max(0, Number.parseInt(match[1], 10)));
  const minute = Math.min(59, Math.max(0, Number.parseInt(match[2], 10)));
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function isMoveisPlanejados(input: { id: string; name: string; keywords: string[] }) {
  const haystack = [input.id, input.name, ...input.keywords].map(normalizeText);
  return haystack.some((item) => MOVEIS_PLANEJADOS_KEYWORDS.some((keyword) => item.includes(normalizeText(keyword))));
}

function mergeKeywords(current: string[], extra: string[]) {
  return splitList([...current, ...extra]);
}

function normalizeBranchInput(input: CreateConfigRecordInput | UpdateConfigRecordInput, existing?: BranchConfigRecord): BranchConfigRecord {
  const source = { ...(existing ?? {}), ...input } as Record<string, unknown>;
  const createdAt = String(existing?.createdAt ?? source.createdAt ?? nowIso());
  const name = firstString(source, ['name', 'ramo', 'branch', 'category'], existing?.name ?? 'Novo ramo');
  const slug = firstString(source, ['slug'], existing?.slug ?? branchSlug(name));
  const sourceId = firstString(source, ['id']);
  const id = String(existing?.id ?? normalizeBranchId(sourceId));
  const subcategories = splitList(source.subcategories ?? source.subramos ?? source.keywords ?? existing?.subcategories ?? []);
  const associatedCategories = splitList(source.associatedCategories ?? source.categories ?? source.categoria ?? existing?.associatedCategories ?? []);
  const moveis = isMoveisPlanejados({ id, name, keywords: [...subcategories, ...associatedCategories] });
  const normalizedName = moveis ? 'Moveis Planejados' : name.trim();
  const normalizedSubcategories = moveis ? mergeKeywords(subcategories, MOVEIS_PLANEJADOS_KEYWORDS) : subcategories;
  const active = toBoolean(source.active ?? source.status, existing?.active ?? true);

  return {
    id,
    kind: 'branches',
    slug: moveis ? 'moveis-planejados' : slug,
    name: normalizedName,
    category: firstString(source, ['category', 'ramo'], normalizedName),
    subcategories: normalizedSubcategories.length ? normalizedSubcategories : [normalizedName],
    associatedCategories: associatedCategories.length ? associatedCategories : [normalizedName],
    order: toInteger(source.order ?? source.ordem, existing?.order ?? 0, 0),
    active,
    status: statusFromActive(active),
    minRating: toNumber(source.minRating ?? source.notaMinima, existing?.minRating ?? DEFAULT_BRANCH_MIN_RATING, 0),
    minReviews: toInteger(source.minReviews ?? source.reviewsMinimos, existing?.minReviews ?? DEFAULT_BRANCH_MIN_REVIEWS, 0),
    imageName: firstString(source, ['imageName', 'image_name', 'imagem'], existing?.imageName ?? ''),
    createdAt,
    updatedAt: nowIso(),
  };
}

function normalizeTemplateType(value: unknown, fallback: TemplateType): TemplateType {
  const normalized = normalizeText(value);
  if (['sem-site', 'sem site', 'sem_site', 'whatsapp'].includes(normalized)) return 'sem-site';
  if (['com-site', 'com site', 'com_site', 'site'].includes(normalized)) return 'com-site';
  if (['agregador', 'aggregator'].includes(normalized)) return 'com-site';
  return fallback;
}

function normalizeTemplateChannel(value: unknown, fallback: TemplateChannel): TemplateChannel {
  const normalized = normalizeText(value);
  if (normalized.includes('instagram')) return 'Instagram';
  if (normalized.includes('whatsapp')) return 'WhatsApp';
  return fallback;
}

function renderPreview(message: string) {
  const preview = message || DEFAULT_TEMPLATE_MESSAGE_1;
  return preview.replace(/\{EMPRESA\}/g, 'Empresa Exemplo').replace(/\[EMPRESA\]/g, 'Empresa Exemplo');
}

function normalizeTemplateInput(
  input: CreateConfigRecordInput | UpdateConfigRecordInput,
  existing: TemplateConfigRecord | undefined,
  branches: BranchConfigRecord[],
): TemplateConfigRecord {
  const source = { ...(existing ?? {}), ...input } as Record<string, unknown>;
  const createdAt = String(existing?.createdAt ?? source.createdAt ?? nowIso());
  const branchId = firstString(source, ['branchId', 'ramoId'], existing?.branchId ?? '');
  const branch = branches.find((item) => item.id === branchId) ?? branches.find((item) => normalizeText(item.name) === normalizeText(source.branchName ?? source.ramo));
  const branchName = branch?.name ?? firstString(source, ['branchName', 'ramo'], existing?.branchName ?? '');
  const active = toBoolean(source.active ?? source.status, existing?.active ?? true);
  const message1 = firstString(source, ['message1', 'msg1', 'part_1', 'mensagem1', 'mensagem'], existing?.message1 ?? DEFAULT_TEMPLATE_MESSAGE_1);
  const message2 = firstString(source, ['message2', 'msg2', 'part_2', 'mensagem2'], existing?.message2 ?? DEFAULT_TEMPLATE_MESSAGE_2);

  return {
    id: String(existing?.id ?? source.id ?? fallbackId('templates')),
    kind: 'templates',
    name: firstString(source, ['name', 'template'], existing?.name ?? `Template ${toInteger(source.order, existing?.order ?? 1, 1)}`),
    branchId: branch?.id ?? branchId,
    branchName,
    channel: normalizeTemplateChannel(source.channel ?? source.canal ?? source.tipo, existing?.channel ?? 'WhatsApp'),
    type: normalizeTemplateType(source.type ?? source.tipo, existing?.type ?? 'sem-site'),
    message1,
    message2,
    preview: renderPreview(message1),
    variables: splitList(source.variables ?? source.variaveis ?? existing?.variables ?? ['{EMPRESA}']),
    order: toInteger(source.order ?? source.idx ?? source.ordem, existing?.order ?? 1, 1),
    active,
    status: statusFromActive(active),
    createdAt,
    updatedAt: nowIso(),
  };
}

function normalizeChipInput(input: CreateConfigRecordInput | UpdateConfigRecordInput, existing?: ChipConfigRecord): ChipConfigRecord {
  const source = { ...(existing ?? {}), ...input } as Record<string, unknown>;
  const active = toBoolean(source.active ?? source.status, existing?.active ?? true);
  const createdAt = String(existing?.createdAt ?? source.createdAt ?? nowIso());
  const level = firstString(source, ['level', 'nivel'], existing?.level ?? 'estabilizado');
  const defaults = chipLevelDefaults(level);
  const batches = splitList(source.batches ?? source.blocks ?? source.lotes ?? existing?.batches ?? defaults.batches)
    .map((item) => normalizeTime(item, ''))
    .filter(Boolean);

  return {
    id: String(existing?.id ?? source.id ?? fallbackId('chips')),
    kind: 'chips',
    name: firstString(source, ['name', 'nome'], existing?.name ?? 'Novo chip'),
    number: firstString(source, ['number', 'numero', 'phone'], existing?.number ?? ''),
    level,
    url: firstString(source, ['url', 'base_url', 'evolution_url'], existing?.url ?? ''),
    instance: firstString(source, ['instance', 'instanceName', 'instance_name'], existing?.instance ?? ''),
    apiKey: firstString(source, ['apiKey', 'api_key'], existing?.apiKey ?? ''),
    connectionStatus: firstString(source, ['connectionStatus', 'connection_status'], existing?.connectionStatus ?? ''),
    priority: toInteger(source.priority ?? source.prioridade, existing?.priority ?? 1, 1),
    startTime: normalizeTime(source.startTime ?? source.horarioInicio, existing?.startTime ?? defaults.startTime),
    endTime: normalizeTime(source.endTime ?? source.horarioFim, existing?.endTime ?? defaults.endTime),
    dailyLimit: toInteger(source.dailyLimit ?? source.limiteDiario, existing?.dailyLimit ?? defaults.dailyLimit, 1),
    intervalSeconds: toInteger(source.intervalSeconds ?? source.intervaloSegundos, existing?.intervalSeconds ?? defaults.intervalSeconds, 1),
    blockSize: toInteger(source.blockSize ?? source.tamanhoBloco, existing?.blockSize ?? defaults.blockSize, 1),
    batches: batches.length ? batches : defaults.batches,
    paused: toBoolean(source.paused ?? source.pausado, existing?.paused ?? false),
    active,
    status: statusFromActive(active),
    createdAt,
    updatedAt: nowIso(),
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

function normalizeInstagramInput(input: CreateConfigRecordInput | UpdateConfigRecordInput, existing?: InstagramConfigRecord): InstagramConfigRecord {
  const source = { ...(existing ?? {}), ...input } as Record<string, unknown>;
  const active = toBoolean(source.active ?? source.status, existing?.active ?? true);
  const createdAt = String(existing?.createdAt ?? source.createdAt ?? nowIso());
  const username = normalizeInstagramUsername(source.username ?? source.instagram ?? source.profile ?? existing?.username);
  const name = firstString(source, ['name', 'nome'], (existing?.name ?? username) || 'Novo perfil');

  return {
    id: String(existing?.id ?? source.id ?? fallbackId('instagram')),
    kind: 'instagram',
    name,
    username,
    active,
    status: statusFromActive(active),
    createdAt,
    updatedAt: nowIso(),
  };
}

function isBranch(record: ConfigRecord): record is BranchConfigRecord {
  return record.kind === 'branches';
}

function isTemplate(record: ConfigRecord): record is TemplateConfigRecord {
  return record.kind === 'templates';
}

function isArchivedConfig(record: ConfigRecord) {
  return normalizeText(record.status) === 'arquivado';
}

function isInactiveConfig(record: ConfigRecord) {
  return !record.active && !isArchivedConfig(record);
}

async function selectedRecords(kind: ConfigKind, ids: string[]) {
  if (!ids.length) throw new Error('Selecione pelo menos um registro.');
  const uniqueIds = Array.from(new Set(ids));
  const records = await repositories.config.list(kind);
  const byId = new Map(records.map((record) => [record.id, record]));
  const selected = uniqueIds.map((id) => byId.get(id));
  if (selected.some((record) => !record)) throw new Error('Um ou mais registros nao foram encontrados.');
  return selected as ConfigRecord[];
}

async function getBranches() {
  const records = await repositories.config.list('branches');
  return records.filter(isBranch);
}

async function normalizeByKind(kind: ConfigKind, input: CreateConfigRecordInput | UpdateConfigRecordInput, existing?: ConfigRecord): Promise<ConfigRecord> {
  if (kind === 'branches') return normalizeBranchInput(input, existing && isBranch(existing) ? existing : undefined);
  if (kind === 'chips') return normalizeChipInput(input, existing && existing.kind === 'chips' ? existing : undefined);
  if (kind === 'instagram') return normalizeInstagramInput(input, existing && existing.kind === 'instagram' ? existing : undefined);
  return normalizeTemplateInput(input, existing && isTemplate(existing) ? existing : undefined, await getBranches());
}

async function assertTemplateLimit(template: TemplateConfigRecord, editingId?: string) {
  const templates = (await repositories.config.list('templates')).filter(isTemplate);
  const groupCount = templates.filter(
    (item) => item.id !== editingId && item.branchId === template.branchId && item.type === template.type,
  ).length;

  if (groupCount >= MAX_TEMPLATES_PER_BRANCH_TYPE) {
    throw new Error('O legado limita cada ramo e tipo a 10 templates.');
  }
}

async function assertCanRemoveTemplate(id: string) {
  const templates = (await repositories.config.list('templates')).filter(isTemplate);
  const selected = templates.find((item) => item.id === id);
  if (!selected) return;

  const groupCount = templates.filter((item) => item.branchId === selected.branchId && item.type === selected.type).length;
  if (groupCount <= 1) {
    throw new Error('O legado mantem pelo menos um template por ramo e tipo.');
  }
}

export const configService = {
  async list(kind: ConfigKind, filters?: ConfigListFilters) {
    return (await repositories.config.list(kind, filters)).filter((record) => !isTestConfigRecord(record));
  },

  async create(kind: ConfigKind, input: CreateConfigRecordInput) {
    const normalized = await normalizeByKind(kind, input);
    if (normalized.kind === 'templates') await assertTemplateLimit(normalized);

    const record = await repositories.config.create(kind, normalized);
    eventBus.emit('config:changed', { kind });
    if (kind === 'branches') eventBus.emit('import-settings:changed', { source: 'branches' });
    return record;
  },

  async update(kind: ConfigKind, id: string, input: UpdateConfigRecordInput) {
    const current = (await repositories.config.list(kind)).find((record) => record.id === id);
    if (!current) throw new Error('Registro nao encontrado.');

    const normalized = await normalizeByKind(kind, input, current);
    if (normalized.kind === 'templates') await assertTemplateLimit(normalized, id);

    const record = await repositories.config.update(kind, id, normalized);
    eventBus.emit('config:changed', { kind });
    if (kind === 'branches') eventBus.emit('import-settings:changed', { source: 'branches' });
    return record;
  },

  async remove(kind: ConfigKind, id: string) {
    if (kind === 'templates') await assertCanRemoveTemplate(id);

    await repositories.config.remove(kind, id);
    eventBus.emit('config:changed', { kind });
    if (kind === 'branches') eventBus.emit('import-settings:changed', { source: 'branches' });
  },

  async toggleArchive(kind: ConfigKind, id: string) {
    const record = await repositories.config.toggleArchive(kind, id);
    eventBus.emit('config:changed', { kind });
    if (kind === 'branches') eventBus.emit('import-settings:changed', { source: 'branches' });
    return record;
  },

  async bulkArchive(kind: ConfigKind, ids: string[]) {
    const selected = await selectedRecords(kind, ids);
    if (!selected.every((record) => record.active && !isArchivedConfig(record))) {
      throw new Error('Arquivar exige que todos os registros selecionados estejam ativos.');
    }
    const updated = await Promise.all(selected.map((record) => repositories.config.toggleArchive(kind, record.id)));
    eventBus.emit('config:changed', { kind });
    if (kind === 'branches') eventBus.emit('import-settings:changed', { source: 'branches' });
    return updated;
  },

  async bulkRestore(kind: ConfigKind, ids: string[]) {
    const selected = await selectedRecords(kind, ids);
    if (!selected.every((record) => isArchivedConfig(record) || isInactiveConfig(record))) {
      throw new Error('Restaurar exige apenas registros arquivados ou inativos.');
    }
    const updated = await Promise.all(selected.map((record) => repositories.config.update(kind, record.id, { ...record, active: true, status: 'Ativo' })));
    eventBus.emit('config:changed', { kind });
    if (kind === 'branches') eventBus.emit('import-settings:changed', { source: 'branches' });
    return updated;
  },

  async bulkRemove(kind: ConfigKind, ids: string[]) {
    const selected = await selectedRecords(kind, ids);
    if (!selected.every(isArchivedConfig)) {
      throw new Error('Excluir exige que todos os registros selecionados estejam arquivados.');
    }
    if (kind === 'templates') {
      await Promise.all(selected.map((record) => assertCanRemoveTemplate(record.id)));
    }
    await Promise.all(selected.map((record) => repositories.config.remove(kind, record.id)));
    eventBus.emit('config:changed', { kind });
    if (kind === 'branches') eventBus.emit('import-settings:changed', { source: 'branches' });
  },
};
