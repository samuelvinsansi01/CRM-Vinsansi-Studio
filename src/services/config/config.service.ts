import { eventBus } from '../../lib/events';
import { repositories } from '../../repositories';
import { platformConfigService } from '../platform-config/platformConfig.service';
import { normalizeInstagramUsername as normalizeInstagramHandle } from '../instagram/instagram.utils';
import { assertAllTemplateMessages } from '../templates/templateContract';
import { branchSlug, normalizeBranchId } from './branchIdentity';
import {
  DEFAULT_BRANCH_MIN_RATING,
  DEFAULT_BRANCH_MIN_REVIEWS,
  DEFAULT_BRANCH_STOCK_TARGET_WHATSAPP,
  DEFAULT_BRANCH_STOCK_TARGET_INSTAGRAM,
  DEFAULT_TEMPLATE_MESSAGE_1,
  DEFAULT_TEMPLATE_MESSAGE_2,
} from './config.seed';
import { assertOperationalConfigRecord } from './operationalConfig.rules';
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

function normalizeChipNumber(value: unknown) {
  return String(value ?? '').replace(/\D/g, '');
}

const TEMPLATE_LIMIT_PER_BRANCH_CHANNEL_TYPE = 10;

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
  const displayName =
    record.kind === 'branches' || record.kind === 'chips' || record.kind === 'instagram'
      ? record.name
      : '';
  const source = [
    record.id,
    displayName,
    'slug' in record ? record.slug : '',
    'username' in record ? record.username : '',
    'instance' in record ? record.instance : '',
    'number' in record ? record.number : '',
    'branchName' in record ? record.branchName : '',
    record.kind === 'templates' ? record.channel : '',
    record.kind === 'templates' ? record.type : '',
    record.kind === 'templates' ? record.message1 : '',
    record.kind === 'templates' ? record.message2 : '',
    record.kind === 'templates' ? record.message3 : '',
    record.kind === 'templates' ? record.message4 : '',
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

function hasOwn(source: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(source, key);
}

function valueFromInput(
  input: Record<string, unknown>,
  keys: string[],
  fallback: unknown,
) {
  for (const key of keys) {
    if (hasOwn(input, key)) return input[key];
  }
  return fallback;
}

function stringFromInput(
  input: Record<string, unknown>,
  keys: string[],
  fallback = '',
  options: { required?: boolean } = {},
) {
  const raw = valueFromInput(input, keys, fallback);
  const text = String(raw ?? '').trim();
  if (options.required && !text) throw new Error(`O campo ${keys[0]} e obrigatorio.`);
  return text;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseJsonInput(value: unknown, fieldLabel: string): unknown {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${fieldLabel} deve conter JSON valido.`);
  }
}

function branchCategoriesFromInput(
  raw: Record<string, unknown>,
  existing: BranchConfigRecord | undefined,
  name: string,
) {
  if (hasOwn(raw, 'categories')) return parseJsonInput(raw.categories, 'Categorias do ramo');
  if (hasOwn(raw, 'categoriesJson')) return parseJsonInput(raw.categoriesJson, 'Categorias do ramo');

  const legacyKeys = [
    'slug', 'category', 'subcategories', 'subramos', 'keywords', 'associatedCategories',
    'categoriesList', 'categoria', 'order', 'ordem', 'minRating', 'notaMinima',
    'minReviews', 'reviewsMinimos', 'stockTargetWhatsapp', 'stock_target_whatsapp', 'stockTargetInstagram', 'stock_target_instagram', 'imageName', 'image_name', 'imagem',
    'imageRequired', 'image_required',
  ];
  if (!legacyKeys.some((key) => hasOwn(raw, key))) return existing?.categories ?? null;

  const previous = isPlainObject(existing?.categories) ? existing.categories : {};
  const imageName = stringFromInput(raw, ['imageName', 'image_name', 'imagem'], existing?.imageName ?? '');
  return {
    ...previous,
    slug: stringFromInput(raw, ['slug'], existing?.slug ?? branchSlug(name)) || branchSlug(name),
    category: stringFromInput(raw, ['category', 'ramo'], existing?.category ?? name) || name,
    subcategories: splitList(valueFromInput(raw, ['subcategories', 'subramos', 'keywords'], existing?.subcategories ?? [])),
    associatedCategories: splitList(valueFromInput(raw, ['associatedCategories', 'categoriesList', 'categoria'], existing?.associatedCategories ?? [])),
    order: toInteger(valueFromInput(raw, ['order', 'ordem'], existing?.order ?? 0), existing?.order ?? 0, 0),
    minRating: toNumber(valueFromInput(raw, ['minRating', 'notaMinima'], existing?.minRating ?? DEFAULT_BRANCH_MIN_RATING), existing?.minRating ?? DEFAULT_BRANCH_MIN_RATING, 0),
    minReviews: toInteger(valueFromInput(raw, ['minReviews', 'reviewsMinimos'], existing?.minReviews ?? DEFAULT_BRANCH_MIN_REVIEWS), existing?.minReviews ?? DEFAULT_BRANCH_MIN_REVIEWS, 0),
    stockTargetWhatsapp: toInteger(valueFromInput(raw, ['stockTargetWhatsapp', 'stock_target_whatsapp'], existing?.stockTargetWhatsapp ?? DEFAULT_BRANCH_STOCK_TARGET_WHATSAPP), existing?.stockTargetWhatsapp ?? DEFAULT_BRANCH_STOCK_TARGET_WHATSAPP, 0),
    stockTargetInstagram: toInteger(valueFromInput(raw, ['stockTargetInstagram', 'stock_target_instagram'], existing?.stockTargetInstagram ?? DEFAULT_BRANCH_STOCK_TARGET_INSTAGRAM), existing?.stockTargetInstagram ?? DEFAULT_BRANCH_STOCK_TARGET_INSTAGRAM, 0),
    imageName,
    imageRequired: toBoolean(valueFromInput(raw, ['imageRequired', 'image_required'], existing?.imageRequired ?? Boolean(imageName)), existing?.imageRequired ?? Boolean(imageName)),
  };
}

function normalizeBranchInput(input: CreateConfigRecordInput | UpdateConfigRecordInput, existing?: BranchConfigRecord): BranchConfigRecord {
  const raw = input as Record<string, unknown>;
  const createdAt = String(existing?.createdAt ?? raw.createdAt ?? nowIso());
  const name = stringFromInput(raw, ['name', 'ramo', 'branch'], existing?.name ?? 'Novo ramo', { required: true });
  const sourceId = stringFromInput(raw, ['id'], existing?.id ?? '');
  const id = String(existing?.id ?? normalizeBranchId(sourceId));
  const active = toBoolean(valueFromInput(raw, ['active', 'status'], existing?.active ?? true), existing?.active ?? true);
  const categories = branchCategoriesFromInput(raw, existing, name);
  const metadata = isPlainObject(categories) ? categories : {};
  const imageName = String(metadata.imageName ?? metadata.image_name ?? existing?.imageName ?? '');

  return {
    id,
    kind: 'branches',
    categories,
    slug: String(metadata.slug ?? existing?.slug ?? branchSlug(name)),
    name,
    category: String(metadata.category ?? existing?.category ?? name),
    subcategories: splitList(metadata.subcategories ?? (Array.isArray(categories) ? categories : existing?.subcategories ?? [])),
    associatedCategories: splitList(metadata.associatedCategories ?? metadata.associated_categories ?? existing?.associatedCategories ?? []),
    order: toInteger(metadata.order, existing?.order ?? 0, 0),
    active,
    status: statusFromActive(active),
    minRating: toNumber(metadata.minRating ?? metadata.min_rating, existing?.minRating ?? DEFAULT_BRANCH_MIN_RATING, 0),
    minReviews: toInteger(metadata.minReviews ?? metadata.min_reviews, existing?.minReviews ?? DEFAULT_BRANCH_MIN_REVIEWS, 0),
    stockTargetWhatsapp: toInteger(metadata.stockTargetWhatsapp ?? metadata.stock_target_whatsapp, existing?.stockTargetWhatsapp ?? DEFAULT_BRANCH_STOCK_TARGET_WHATSAPP, 0),
    stockTargetInstagram: toInteger(metadata.stockTargetInstagram ?? metadata.stock_target_instagram, existing?.stockTargetInstagram ?? DEFAULT_BRANCH_STOCK_TARGET_INSTAGRAM, 0),
    imageName,
    imageRequired: toBoolean(metadata.imageRequired ?? metadata.image_required, existing?.imageRequired ?? Boolean(imageName)),
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
  if (normalized.includes('geral')) return 'Geral';
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
  const raw = input as Record<string, unknown>;
  const createdAt = String(existing?.createdAt ?? raw.createdAt ?? nowIso());
  const branchId = stringFromInput(raw, ['branchId', 'ramoId'], existing?.branchId ?? '', { required: true });
  const branch = branches.find((item) => item.id === branchId) ?? branches.find((item) => normalizeText(item.name) === normalizeText(valueFromInput(raw, ['branchName', 'ramo'], existing?.branchName ?? '')));
  const branchName = branch?.name ?? stringFromInput(raw, ['branchName', 'ramo'], existing?.branchName ?? '');
  const templateChannelId = stringFromInput(raw, ['templateChannelId', 'template_channels_id'], existing?.templateChannelId ?? '', { required: true });
  const templateTypeId = stringFromInput(raw, ['templateTypeId', 'template_types_id'], existing?.templateTypeId ?? '', { required: true });
  const active = toBoolean(valueFromInput(raw, ['active', 'status'], existing?.active ?? true), existing?.active ?? true);
  const message1 = stringFromInput(raw, ['message1', 'msg1', 'part_1', 'mensagem1', 'mensagem'], existing?.message1 ?? DEFAULT_TEMPLATE_MESSAGE_1);
  const message2 = stringFromInput(raw, ['message2', 'msg2', 'part_2', 'mensagem2'], existing?.message2 ?? DEFAULT_TEMPLATE_MESSAGE_2);
  const message3 = stringFromInput(raw, ['message3', 'msg3', 'part_3', 'mensagem3'], existing?.message3 ?? '');
  const message4 = stringFromInput(raw, ['message4', 'msg4', 'part_4', 'mensagem4'], existing?.message4 ?? '');

  return {
    id: String(existing?.id ?? raw.id ?? fallbackId('templates')),
    kind: 'templates',
    name: stringFromInput(raw, ['name', 'templateName', 'templates_name'], existing?.name ?? '', { required: true }),
    branchId: branch?.id ?? branchId,
    branchName,
    templateChannelId,
    templateChannelName: stringFromInput(raw, ['templateChannelName'], existing?.templateChannelName ?? existing?.channel ?? ''),
    templateTypeId,
    templateTypeName: stringFromInput(raw, ['templateTypeName'], existing?.templateTypeName ?? existing?.type ?? ''),
    channel: normalizeTemplateChannel(valueFromInput(raw, ['templateChannelName', 'channel', 'canal'], existing?.channel ?? 'WhatsApp'), existing?.channel ?? 'WhatsApp'),
    type: normalizeTemplateType(valueFromInput(raw, ['templateTypeName', 'type', 'tipo'], existing?.type ?? 'sem-site'), existing?.type ?? 'sem-site'),
    message1,
    message2,
    message3,
    message4,
    preview: renderPreview(message1),
    active,
    status: statusFromActive(active),
    createdAt,
    updatedAt: nowIso(),
  };
}

function normalizeChipInput(input: CreateConfigRecordInput | UpdateConfigRecordInput, existing?: ChipConfigRecord): ChipConfigRecord {
  const raw = input as Record<string, unknown>;
  const active = toBoolean(valueFromInput(raw, ['active', 'status'], existing?.active ?? true), existing?.active ?? true);
  const createdAt = String(existing?.createdAt ?? raw.createdAt ?? nowIso());
  const instanceId = stringFromInput(raw, ['instanceId', 'instances_id'], existing?.instanceId ?? '', { required: true });
  const levelId = stringFromInput(raw, ['levelId', 'levels_id'], existing?.levelId ?? '', { required: true });
  const level = stringFromInput(raw, ['levelName', 'level', 'nivel'], existing?.level ?? '');
  const batches = splitList(valueFromInput(raw, ['batches', 'blocks', 'lotes'], existing?.batches ?? []));

  return {
    id: String(existing?.id ?? raw.id ?? fallbackId('chips')),
    kind: 'chips',
    name: stringFromInput(raw, ['name', 'nome'], existing?.name ?? 'Novo chip', { required: true }),
    number: normalizeChipNumber(valueFromInput(raw, ['number', 'numero', 'phone'], existing?.number ?? '')),
    instanceId,
    levelId,
    level,
    url: stringFromInput(raw, ['instanceUrl', 'url', 'base_url', 'evolution_url'], existing?.url ?? ''),
    instance: stringFromInput(raw, ['instanceName', 'instance', 'instance_name'], existing?.instance ?? ''),
    apiKey: stringFromInput(raw, ['apiKey', 'api_key'], existing?.apiKey ?? ''),
    connectionStatus: stringFromInput(raw, ['connectionStatus', 'connection_status'], existing?.connectionStatus ?? existing?.status ?? ''),
    priority: toInteger(valueFromInput(raw, ['priority', 'prioridade'], existing?.priority ?? 1), existing?.priority ?? 1, 1),
    startTime: stringFromInput(raw, ['startTime', 'horarioInicio'], existing?.startTime ?? ''),
    endTime: stringFromInput(raw, ['endTime', 'horarioFim'], existing?.endTime ?? ''),
    dailyLimit: toInteger(valueFromInput(raw, ['dailyLimit', 'limiteDiario'], existing?.dailyLimit ?? 0), existing?.dailyLimit ?? 0, 0),
    intervalSeconds: toInteger(valueFromInput(raw, ['intervalSeconds', 'intervaloSegundos'], existing?.intervalSeconds ?? 0), existing?.intervalSeconds ?? 0, 0),
    blockSize: toInteger(valueFromInput(raw, ['blockSize', 'tamanhoBloco'], existing?.blockSize ?? 0), existing?.blockSize ?? 0, 0),
    batches,
    paused: toBoolean(valueFromInput(raw, ['paused', 'pausado'], existing?.paused ?? false), existing?.paused ?? false),
    active,
    status: statusFromActive(active),
    createdAt,
    updatedAt: nowIso(),
  };
}

function normalizeInstagramUsername(value: unknown) {
  return normalizeInstagramHandle(value);
}

function normalizeInstagramInput(input: CreateConfigRecordInput | UpdateConfigRecordInput, existing?: InstagramConfigRecord): InstagramConfigRecord {
  const raw = input as Record<string, unknown>;
  const active = toBoolean(valueFromInput(raw, ['active', 'status'], existing?.active ?? true), existing?.active ?? true);
  const createdAt = String(existing?.createdAt ?? raw.createdAt ?? nowIso());
  const username = normalizeInstagramUsername(valueFromInput(raw, ['username', 'instagram', 'profile'], existing?.username ?? ''));
  const name = stringFromInput(raw, ['name', 'nome'], (existing?.name ?? username) || 'Novo perfil', { required: true });
  const levelId = stringFromInput(raw, ['levelId', 'levels_id'], existing?.levelId ?? '', { required: true });

  return {
    id: String(existing?.id ?? raw.id ?? fallbackId('instagram')),
    kind: 'instagram',
    name,
    username,
    levelId,
    levelName: stringFromInput(raw, ['levelName', 'nivel'], existing?.levelName ?? ''),
    dailyLimit: toInteger(valueFromInput(raw, ['dailyLimit', 'daily_limit', 'limiteDiario'], existing?.dailyLimit ?? 60), existing?.dailyLimit ?? 60, 1),
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

function isDeletedConfig(record: ConfigRecord) {
  const status = normalizeText(record.status);
  return status === 'deleted' || status.startsWith('excluido') || status.startsWith('deletado');
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

async function listAllConfigRecords() {
  const [branches, templates, chips, instagram] = await Promise.all([
    repositories.config.list('branches'),
    repositories.config.list('templates'),
    repositories.config.list('chips'),
    repositories.config.list('instagram'),
  ]);
  return [...branches, ...templates, ...chips, ...instagram].filter((record) => !isDeletedConfig(record));
}

async function assertRecordContract(record: ConfigRecord, editingId?: string) {
  const records = await listAllConfigRecords();
  assertOperationalConfigRecord(record, records, editingId);
  if (record.kind === 'templates') await assertTemplateContract(record, editingId);
}

function isOpenWhatsAppStatus(status: unknown) {
  return ['queued', 'sending', 'paused', 'error'].includes(normalizeText(status));
}

function isOpenInstagramStatus(status: unknown) {
  return ['queued', 'following', 'dm_opened', 'paused', 'error'].includes(normalizeText(status));
}

async function assertNoOpenQueueReferences(record: ConfigRecord) {
  const [whatsappBatches, instagramBatches] = await Promise.all([
    repositories.whatsappQueue.listBatches({}),
    repositories.instagramQueue.listBatches({}),
  ]);
  const whatsappItems = whatsappBatches.flatMap((batch) => batch.leads);
  const instagramItems = instagramBatches.flatMap((batch) => batch.leads);

  const openWhatsApp = whatsappItems.filter((lead) => {
    if (!isOpenWhatsAppStatus(lead.status)) return false;
    if (record.kind === 'branches') return lead.branch_id === record.id;
    if (record.kind === 'chips') return lead.chip_id === record.id;
    if (record.kind === 'templates') return lead.template_id === record.id;
    return false;
  });
  const openInstagram = instagramItems.filter((lead) => {
    if (!isOpenInstagramStatus(lead.status)) return false;
    if (record.kind === 'branches') return lead.branch_id === record.id;
    if (record.kind === 'instagram') return lead.profile_id === record.id;
    if (record.kind === 'templates') return lead.template_id === record.id;
    return false;
  });
  const total = openWhatsApp.length + openInstagram.length;
  if (!total) return;

  const subject = record.kind === 'branches'
    ? 'Este ramo'
    : record.kind === 'chips'
      ? 'Este chip'
      : record.kind === 'instagram'
        ? 'Este perfil'
        : 'Este template';
  throw new Error(`${subject} esta congelado em ${total} item(ns) de fila ainda aberto(s).`);
}

async function assertDeactivationAllowed(record: ConfigRecord) {
  if (record.kind === 'branches') {
    const templates = (await repositories.config.list('templates')).filter(isTemplate);
    const activeTemplates = templates.filter((template) =>
      template.branchId === record.id && template.active && !isDeletedConfig(template),
    );
    if (activeTemplates.length) {
      throw new Error(`Desative primeiro os ${activeTemplates.length} template(s) vinculados a este ramo.`);
    }
  }
  await assertNoOpenQueueReferences(record);
}

function operationalFieldsChanged(current: ConfigRecord, next: ConfigRecord) {
  if (current.kind !== next.kind) return true;
  if (current.kind === 'branches' && next.kind === 'branches') {
    return JSON.stringify(current.categories) !== JSON.stringify(next.categories);
  }
  if (current.kind === 'templates' && next.kind === 'templates') {
    return current.branchId !== next.branchId ||
      current.templateChannelId !== next.templateChannelId ||
      current.templateTypeId !== next.templateTypeId ||
      current.message1 !== next.message1 ||
      current.message2 !== next.message2 ||
      current.message3 !== next.message3 ||
      current.message4 !== next.message4;
  }
  if (current.kind === 'chips' && next.kind === 'chips') {
    return current.number !== next.number || current.instanceId !== next.instanceId || current.levelId !== next.levelId;
  }
  if (current.kind === 'instagram' && next.kind === 'instagram') {
    return current.username !== next.username || current.levelId !== next.levelId;
  }
  return true;
}

async function assertTemplateContract(template: TemplateConfigRecord, editingId?: string) {
  assertAllTemplateMessages(template);
  const templates = (await repositories.config.list('templates')).filter(isTemplate);
  const activeGroupCount = templates.filter(
    (item) =>
      item.id !== editingId &&
      item.status !== 'deleted' &&
      item.active &&
      item.branchId === template.branchId &&
      item.templateChannelId === template.templateChannelId &&
      item.templateTypeId === template.templateTypeId,
  ).length;

  if (activeGroupCount >= TEMPLATE_LIMIT_PER_BRANCH_CHANNEL_TYPE) {
    throw new Error(`Limite de ${TEMPLATE_LIMIT_PER_BRANCH_CHANNEL_TYPE} templates para este ramo, canal e tipo atingido.`);
  }
}

function assertPersisted(expected: ConfigRecord, saved: ConfigRecord) {
  if (expected.kind !== saved.kind || String(expected.id) !== String(saved.id)) {
    throw new Error('O banco retornou um registro diferente do que foi salvo.');
  }

  const fail = (field: string, expectedValue: unknown, savedValue: unknown) => {
    throw new Error(`Falha de persistencia no campo ${field}: enviado ${JSON.stringify(expectedValue)}, banco retornou ${JSON.stringify(savedValue)}.`);
  };

  if (expected.kind === 'branches' && saved.kind === 'branches') {
    if (expected.name !== saved.name) fail('name', expected.name, saved.name);
    if (JSON.stringify(expected.categories) !== JSON.stringify(saved.categories)) fail('categories', expected.categories, saved.categories);
    if (expected.active !== saved.active) fail('active', expected.active, saved.active);
    return;
  }

  if (expected.kind === 'templates' && saved.kind === 'templates') {
    if (expected.name !== saved.name) fail('name', expected.name, saved.name);
    if (expected.branchId !== saved.branchId) fail('branchId', expected.branchId, saved.branchId);
    if (expected.templateChannelId !== saved.templateChannelId) fail('templateChannelId', expected.templateChannelId, saved.templateChannelId);
    if (expected.templateTypeId !== saved.templateTypeId) fail('templateTypeId', expected.templateTypeId, saved.templateTypeId);
    if (expected.message1 !== saved.message1) fail('message1', expected.message1, saved.message1);
    if (expected.message2 !== saved.message2) fail('message2', expected.message2, saved.message2);
    if (expected.message3 !== saved.message3) fail('message3', expected.message3, saved.message3);
    if (expected.message4 !== saved.message4) fail('message4', expected.message4, saved.message4);
    if (expected.active !== saved.active) fail('active', expected.active, saved.active);
    return;
  }

  if (expected.kind === 'chips' && saved.kind === 'chips') {
    for (const field of ['name', 'instanceId', 'levelId'] as const) {
      if (expected[field] !== saved[field]) fail(field, expected[field], saved[field]);
    }
    if (normalizeChipNumber(expected.number) !== normalizeChipNumber(saved.number)) {
      fail('number', normalizeChipNumber(expected.number), normalizeChipNumber(saved.number));
    }
    if (expected.active !== saved.active) fail('active', expected.active, saved.active);
    return;
  }

  if (expected.kind === 'instagram' && saved.kind === 'instagram') {
    if (expected.name !== saved.name) fail('name', expected.name, saved.name);
    if (expected.username !== saved.username) fail('username', expected.username, saved.username);
    if (expected.levelId !== saved.levelId) fail('levelId', expected.levelId, saved.levelId);
    if (expected.active !== saved.active) fail('active', expected.active, saved.active);
  }
}

async function confirmPersisted(kind: ConfigKind, expected: ConfigRecord) {
  const persisted = (await repositories.config.list(kind)).find((record) => String(record.id) === String(expected.id));
  if (!persisted) throw new Error('O banco nao retornou o registro apos o salvamento.');
  assertPersisted(expected, persisted);
  return persisted;
}

async function emitConfigChanged(kind: ConfigKind) {
  // A publicacao para extensao e secundaria. Uma falha nessa etapa nao pode
  // transformar uma gravacao concluida no banco em falso erro de salvamento.
  try {
    await platformConfigService.publishExtensionRuntimeConfig();
  } catch (error) {
    console.warn('Falha ao publicar configuracao de runtime apos salvar:', error);
  }
  eventBus.emit('config:changed', { kind });
  if (kind === 'branches') eventBus.emit('import-settings:changed', { source: 'branches' });
}

export const configService = {
  async list(kind: ConfigKind, filters?: ConfigListFilters) {
    return (await repositories.config.list(kind, filters)).filter((record) => !isTestConfigRecord(record) && !isDeletedConfig(record));
  },

  async create(kind: ConfigKind, input: CreateConfigRecordInput) {
    const normalized = await normalizeByKind(kind, input);
    await assertRecordContract(normalized);

    const record = await repositories.config.create(kind, normalized);
    const persisted = await confirmPersisted(kind, record);
    await emitConfigChanged(kind);
    return persisted;
  },

  async update(kind: ConfigKind, id: string, input: UpdateConfigRecordInput) {
    const current = (await repositories.config.list(kind)).find((record) => record.id === id);
    if (!current) throw new Error('Registro nao encontrado.');

    const normalized = await normalizeByKind(kind, input, current);
    await assertRecordContract(normalized, id);
    if (current.active && !normalized.active) {
      await assertDeactivationAllowed(current);
    } else if (operationalFieldsChanged(current, normalized)) {
      await assertNoOpenQueueReferences(current);
    }

    const record = await repositories.config.update(kind, id, normalized);
    assertPersisted(normalized, record);
    const persisted = await confirmPersisted(kind, normalized);
    await emitConfigChanged(kind);
    return persisted;
  },

  async remove(_kind: ConfigKind, _id: string) {
    throw new Error('O contrato canonico de configuracao nao possui exclusao ou arquivamento. Use a desativacao.');
  },

  async toggleArchive(kind: ConfigKind, id: string) {
    const current = (await selectedRecords(kind, [id]))[0];
    if (current.active) await assertDeactivationAllowed(current);
    const record = await repositories.config.toggleArchive(kind, id);
    await emitConfigChanged(kind);
    return record;
  },

  async bulkArchive(kind: ConfigKind, ids: string[]) {
    const selected = await selectedRecords(kind, ids);
    if (!selected.every((record) => record.active && !isDeletedConfig(record))) {
      throw new Error('Desativar exige apenas registros ativos.');
    }
    for (const record of selected) await assertDeactivationAllowed(record);
    const updated: ConfigRecord[] = [];
    for (const record of selected) updated.push(await repositories.config.toggleArchive(kind, record.id));
    await emitConfigChanged(kind);
    return updated;
  },

  async bulkRestore(kind: ConfigKind, ids: string[]) {
    const selected = await selectedRecords(kind, ids);
    if (!selected.every((record) => !record.active && !isDeletedConfig(record))) {
      throw new Error('Ativar exige apenas registros inativos.');
    }
    const updated = await Promise.all(selected.map((record) => repositories.config.toggleArchive(kind, record.id)));
    await emitConfigChanged(kind);
    return updated;
  },

  async bulkRemove(_kind: ConfigKind, _ids: string[]) {
    throw new Error('O contrato canonico de configuracao nao possui exclusao ou arquivamento. Use a desativacao.');
  },
};
