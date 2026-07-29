import { eventBus } from '../../lib/events';
import { repositories } from '../../repositories';
import { platformConfigService } from '../platform-config/platformConfig.service';
import { settingsService } from '../settings';
import { assertAllTemplateMessages } from '../templates/templateContract';
import { branchSlug, normalizeBranchId } from './branchIdentity';
import {
  DEFAULT_BRANCH_MIN_RATING,
  DEFAULT_BRANCH_MIN_REVIEWS,
  DEFAULT_TEMPLATE_MESSAGE_1,
  DEFAULT_TEMPLATE_MESSAGE_2,
} from './config.seed';
import { chipLevelDefaults } from './chipOperational';
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

function normalizeTime(value: unknown, fallback: string) {
  const text = String(value ?? '').trim();
  const match = text.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return fallback;
  const hour = Math.min(23, Math.max(0, Number.parseInt(match[1], 10)));
  const minute = Math.min(59, Math.max(0, Number.parseInt(match[2], 10)));
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
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

function normalizeBranchInput(input: CreateConfigRecordInput | UpdateConfigRecordInput, existing?: BranchConfigRecord): BranchConfigRecord {
  const raw = input as Record<string, unknown>;
  const createdAt = String(existing?.createdAt ?? raw.createdAt ?? nowIso());
  const name = stringFromInput(raw, ['name', 'ramo', 'branch'], existing?.name ?? 'Novo ramo', { required: true });
  const slugInput = stringFromInput(raw, ['slug'], existing?.slug ?? '');
  const slug = slugInput || branchSlug(name);
  const sourceId = stringFromInput(raw, ['id'], existing?.id ?? '');
  const id = String(existing?.id ?? normalizeBranchId(sourceId));
  const subcategories = splitList(valueFromInput(raw, ['subcategories', 'subramos', 'keywords'], existing?.subcategories ?? []));
  const associatedCategories = splitList(valueFromInput(raw, ['associatedCategories', 'categories', 'categoria'], existing?.associatedCategories ?? []));
  const active = toBoolean(valueFromInput(raw, ['active', 'status'], existing?.active ?? true), existing?.active ?? true);
  const imageName = stringFromInput(raw, ['imageName', 'image_name', 'imagem'], existing?.imageName ?? '');

  return {
    id,
    kind: 'branches',
    slug,
    name,
    category: stringFromInput(raw, ['category', 'ramo'], existing?.category ?? name) || name,
    // A lista cadastrada pelo usuario e a fonte de verdade. Nenhuma palavra-chave
    // hardcoded e reintroduzida depois de uma exclusao intencional.
    subcategories,
    associatedCategories,
    order: toInteger(valueFromInput(raw, ['order', 'ordem'], existing?.order ?? 0), existing?.order ?? 0, 0),
    active,
    status: statusFromActive(active),
    minRating: toNumber(valueFromInput(raw, ['minRating', 'notaMinima'], existing?.minRating ?? DEFAULT_BRANCH_MIN_RATING), existing?.minRating ?? DEFAULT_BRANCH_MIN_RATING, 0),
    minReviews: toInteger(valueFromInput(raw, ['minReviews', 'reviewsMinimos'], existing?.minReviews ?? DEFAULT_BRANCH_MIN_REVIEWS), existing?.minReviews ?? DEFAULT_BRANCH_MIN_REVIEWS, 0),
    imageName,
    imageRequired: toBoolean(valueFromInput(raw, ['imageRequired', 'image_required'], existing?.imageRequired ?? Boolean(imageName)), existing?.imageRequired ?? Boolean(imageName)),
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
  const active = toBoolean(valueFromInput(raw, ['active', 'status'], existing?.active ?? true), existing?.active ?? true);
  const message1 = stringFromInput(raw, ['message1', 'msg1', 'part_1', 'mensagem1', 'mensagem'], existing?.message1 ?? DEFAULT_TEMPLATE_MESSAGE_1);
  const message2 = stringFromInput(raw, ['message2', 'msg2', 'part_2', 'mensagem2'], existing?.message2 ?? DEFAULT_TEMPLATE_MESSAGE_2);
  const message3 = stringFromInput(raw, ['message3', 'msg3', 'part_3', 'mensagem3'], existing?.message3 ?? '');
  const message4 = stringFromInput(raw, ['message4', 'msg4', 'part_4', 'mensagem4'], existing?.message4 ?? '');

  return {
    id: String(existing?.id ?? raw.id ?? fallbackId('templates')),
    kind: 'templates',
    branchId: branch?.id ?? branchId,
    branchName,
    channel: normalizeTemplateChannel(valueFromInput(raw, ['channel', 'canal'], existing?.channel ?? 'WhatsApp'), existing?.channel ?? 'WhatsApp'),
    type: normalizeTemplateType(valueFromInput(raw, ['type', 'tipo'], existing?.type ?? 'sem-site'), existing?.type ?? 'sem-site'),
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

async function normalizeChipInput(input: CreateConfigRecordInput | UpdateConfigRecordInput, existing?: ChipConfigRecord): Promise<ChipConfigRecord> {
  const raw = input as Record<string, unknown>;
  const active = toBoolean(valueFromInput(raw, ['active', 'status'], existing?.active ?? true), existing?.active ?? true);
  const createdAt = String(existing?.createdAt ?? raw.createdAt ?? nowIso());
  const level = stringFromInput(raw, ['level', 'nivel'], existing?.level ?? 'estabilizado') || 'estabilizado';
  const dispatchSettings = await settingsService.getDispatchSettings();
  const defaults = chipLevelDefaults(level, dispatchSettings.chipLevels);
  const batches = splitList(valueFromInput(raw, ['batches', 'blocks', 'lotes'], existing?.batches ?? defaults.batches))
    .map((item) => normalizeTime(item, ''))
    .filter(Boolean);

  return {
    id: String(existing?.id ?? raw.id ?? fallbackId('chips')),
    kind: 'chips',
    name: stringFromInput(raw, ['name', 'nome'], existing?.name ?? 'Novo chip', { required: true }),
    number: stringFromInput(raw, ['number', 'numero', 'phone'], existing?.number ?? ''),
    level,
    url: stringFromInput(raw, ['url', 'base_url', 'evolution_url'], existing?.url ?? ''),
    instance: stringFromInput(raw, ['instance', 'instanceName', 'instance_name'], existing?.instance ?? ''),
    apiKey: stringFromInput(raw, ['apiKey', 'api_key'], existing?.apiKey ?? ''),
    connectionStatus: stringFromInput(raw, ['connectionStatus', 'connection_status'], existing?.connectionStatus ?? existing?.status ?? ''),
    priority: toInteger(valueFromInput(raw, ['priority', 'prioridade'], existing?.priority ?? 1), existing?.priority ?? 1, 1),
    startTime: normalizeTime(valueFromInput(raw, ['startTime', 'horarioInicio'], existing?.startTime ?? defaults.startTime), existing?.startTime ?? defaults.startTime),
    endTime: normalizeTime(valueFromInput(raw, ['endTime', 'horarioFim'], existing?.endTime ?? defaults.endTime), existing?.endTime ?? defaults.endTime),
    dailyLimit: toInteger(valueFromInput(raw, ['dailyLimit', 'limiteDiario'], existing?.dailyLimit ?? defaults.dailyLimit), existing?.dailyLimit ?? defaults.dailyLimit, 1),
    intervalSeconds: toInteger(valueFromInput(raw, ['intervalSeconds', 'intervaloSegundos'], existing?.intervalSeconds ?? defaults.intervalSeconds), existing?.intervalSeconds ?? defaults.intervalSeconds, 1),
    blockSize: toInteger(valueFromInput(raw, ['blockSize', 'tamanhoBloco'], existing?.blockSize ?? defaults.blockSize), existing?.blockSize ?? defaults.blockSize, 1),
    batches,
    paused: toBoolean(valueFromInput(raw, ['paused', 'pausado'], existing?.paused ?? false), existing?.paused ?? false),
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
  const raw = input as Record<string, unknown>;
  const active = toBoolean(valueFromInput(raw, ['active', 'status'], existing?.active ?? true), existing?.active ?? true);
  const createdAt = String(existing?.createdAt ?? raw.createdAt ?? nowIso());
  const username = normalizeInstagramUsername(valueFromInput(raw, ['username', 'instagram', 'profile'], existing?.username ?? ''));
  const name = stringFromInput(raw, ['name', 'nome'], (existing?.name ?? username) || 'Novo perfil', { required: true });

  return {
    id: String(existing?.id ?? raw.id ?? fallbackId('instagram')),
    kind: 'instagram',
    name,
    username,
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

function isArchivedConfig(record: ConfigRecord) {
  // O schema real possui status generico, sem coluna dedicada a arquivamento.
  // Registros inativos representam o estado arquivado na interface.
  return !record.active || ['arquivado', 'inativo'].includes(normalizeText(record.status));
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

async function assertArchiveAllowed(record: ConfigRecord) {
  if (record.kind === 'branches') {
    const templates = (await repositories.config.list('templates')).filter(isTemplate);
    const activeTemplates = templates.filter((template) =>
      template.branchId === record.id && !isArchivedConfig(template) && !isDeletedConfig(template),
    );
    if (activeTemplates.length) {
      throw new Error(`Arquive primeiro os ${activeTemplates.length} template(s) vinculados a este ramo.`);
    }
    return;
  }

  if (record.kind === 'chips') {
    const batches = await repositories.whatsappQueue.listBatches({ chip: record.instance });
    const open = batches.flatMap((batch) => batch.leads).filter((lead) => isOpenWhatsAppStatus(lead.status));
    if (open.length) throw new Error(`Este chip possui ${open.length} item(ns) de fila ainda aberto(s).`);
    return;
  }

  if (record.kind === 'instagram') {
    const batches = await repositories.instagramQueue.listBatches({ profile: record.username });
    const open = batches.flatMap((batch) => batch.leads).filter((lead) => isOpenInstagramStatus(lead.status));
    if (open.length) throw new Error(`Este perfil possui ${open.length} item(ns) de fila ainda aberto(s).`);
    return;
  }

  const [whatsappBatches, instagramBatches] = await Promise.all([
    repositories.whatsappQueue.listBatches({}),
    repositories.instagramQueue.listBatches({}),
  ]);
  const openWhatsApp = whatsappBatches.flatMap((batch) => batch.leads)
    .filter((lead) => lead.template_id === record.id && isOpenWhatsAppStatus(lead.status));
  const openInstagram = instagramBatches.flatMap((batch) => batch.leads)
    .filter((lead) => lead.template_id === record.id && isOpenInstagramStatus(lead.status));
  if (openWhatsApp.length + openInstagram.length) {
    throw new Error(`Este template esta congelado em ${openWhatsApp.length + openInstagram.length} item(ns) de fila ainda aberto(s).`);
  }
}

async function assertTemplateContract(template: TemplateConfigRecord, editingId?: string) {
  assertAllTemplateMessages(template);
  const templates = (await repositories.config.list('templates')).filter(isTemplate);
  const activeGroupCount = templates.filter(
    (item) =>
      item.id !== editingId &&
      item.status !== 'deleted' &&
      !isArchivedConfig(item) &&
      item.branchId === template.branchId &&
      item.channel === template.channel &&
      item.type === template.type,
  ).length;

  if (activeGroupCount >= TEMPLATE_LIMIT_PER_BRANCH_CHANNEL_TYPE) {
    throw new Error(`Limite de ${TEMPLATE_LIMIT_PER_BRANCH_CHANNEL_TYPE} templates para este ramo, canal e tipo atingido.`);
  }
}

function comparableList(items: string[]) {
  return items.map((item) => normalizeText(item)).filter(Boolean);
}

function sameList(left: string[], right: string[]) {
  const a = comparableList(left);
  const b = comparableList(right);
  return a.length === b.length && a.every((item, index) => item === b[index]);
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
    if (expected.slug !== saved.slug) fail('slug', expected.slug, saved.slug);
    if (!sameList(expected.subcategories, saved.subcategories)) fail('subcategories', expected.subcategories, saved.subcategories);
    if (!sameList(expected.associatedCategories, saved.associatedCategories)) fail('associatedCategories', expected.associatedCategories, saved.associatedCategories);
    if (expected.imageName !== saved.imageName) fail('imageName', expected.imageName, saved.imageName);
    if (expected.imageRequired !== saved.imageRequired) fail('imageRequired', expected.imageRequired, saved.imageRequired);
    if (expected.active !== saved.active) fail('active', expected.active, saved.active);
    return;
  }

  if (expected.kind === 'templates' && saved.kind === 'templates') {
    if (expected.branchId !== saved.branchId) fail('branchId', expected.branchId, saved.branchId);
    if (expected.channel !== saved.channel) fail('channel', expected.channel, saved.channel);
    if (expected.type !== saved.type) fail('type', expected.type, saved.type);
    if (expected.message1 !== saved.message1) fail('message1', expected.message1, saved.message1);
    if (expected.message2 !== saved.message2) fail('message2', expected.message2, saved.message2);
    if (expected.message3 !== saved.message3) fail('message3', expected.message3, saved.message3);
    if (expected.message4 !== saved.message4) fail('message4', expected.message4, saved.message4);
    if (expected.active !== saved.active) fail('active', expected.active, saved.active);
    return;
  }

  if (expected.kind === 'chips' && saved.kind === 'chips') {
    for (const field of ['name', 'number', 'level', 'url', 'instance', 'apiKey', 'startTime', 'endTime'] as const) {
      if (expected[field] !== saved[field]) fail(field, expected[field], saved[field]);
    }
    for (const field of ['priority', 'dailyLimit', 'intervalSeconds', 'blockSize'] as const) {
      if (expected[field] !== saved[field]) fail(field, expected[field], saved[field]);
    }
    if (!sameList(expected.batches, saved.batches)) fail('batches', expected.batches, saved.batches);
    if (expected.active !== saved.active) fail('active', expected.active, saved.active);
    return;
  }

  if (expected.kind === 'instagram' && saved.kind === 'instagram') {
    if (expected.name !== saved.name) fail('name', expected.name, saved.name);
    if (expected.username !== saved.username) fail('username', expected.username, saved.username);
    if (expected.dailyLimit !== saved.dailyLimit) fail('dailyLimit', expected.dailyLimit, saved.dailyLimit);
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

    const record = await repositories.config.update(kind, id, normalized);
    assertPersisted(normalized, record);
    const persisted = await confirmPersisted(kind, normalized);
    await emitConfigChanged(kind);
    return persisted;
  },

  async remove(kind: ConfigKind, id: string) {
    const selected = await selectedRecords(kind, [id]);
    if (!selected.every(isArchivedConfig)) {
      throw new Error('Excluir exige que o registro esteja arquivado.');
    }

    await repositories.config.remove(kind, id);
    await emitConfigChanged(kind);
  },

  async toggleArchive(kind: ConfigKind, id: string) {
    const current = (await selectedRecords(kind, [id]))[0];
    if (!isArchivedConfig(current)) await assertArchiveAllowed(current);
    const record = await repositories.config.toggleArchive(kind, id);
    await emitConfigChanged(kind);
    return record;
  },

  async bulkArchive(kind: ConfigKind, ids: string[]) {
    const selected = await selectedRecords(kind, ids);
    if (!selected.every((record) => !isArchivedConfig(record) && !isDeletedConfig(record))) {
      throw new Error('Arquivar exige apenas registros ativos ou inativos.');
    }
    for (const record of selected) await assertArchiveAllowed(record);
    const updated: ConfigRecord[] = [];
    for (const record of selected) updated.push(await repositories.config.toggleArchive(kind, record.id));
    await emitConfigChanged(kind);
    return updated;
  },

  async bulkRestore(kind: ConfigKind, ids: string[]) {
    const selected = await selectedRecords(kind, ids);
    if (!selected.every(isArchivedConfig)) {
      throw new Error('Restaurar exige apenas registros arquivados.');
    }
    const updated = await Promise.all(selected.map((record) => repositories.config.toggleArchive(kind, record.id)));
    await emitConfigChanged(kind);
    return updated;
  },

  async bulkRemove(kind: ConfigKind, ids: string[]) {
    const selected = await selectedRecords(kind, ids);
    if (!selected.every(isArchivedConfig)) {
      throw new Error('Excluir exige que todos os registros selecionados estejam arquivados.');
    }
    await Promise.all(selected.map((record) => repositories.config.remove(kind, record.id)));
    await emitConfigChanged(kind);
  },
};
