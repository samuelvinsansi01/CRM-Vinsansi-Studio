import { configSeed } from '../../services/config/config.seed';
import type { ConfigKind, ConfigListFilters, ConfigRecord, CreateConfigRecordInput, UpdateConfigRecordInput } from '../../services/config/types';
import type { ConfigRepository } from './config.repository';

const STORAGE_PREFIX = 'lead-certo:config:v2';

const memoryStore: Record<ConfigKind, ConfigRecord[]> = {
  chips: [...configSeed.chips],
  instagram: [...configSeed.instagram],
  branches: [...configSeed.branches],
  templates: [...configSeed.templates],
};

function isBrowser() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function storageKey(kind: ConfigKind) {
  return `${STORAGE_PREFIX}:${kind}`;
}

function readStore(kind: ConfigKind) {
  if (!isBrowser()) return memoryStore[kind];

  try {
    const stored = window.localStorage.getItem(storageKey(kind));
    if (!stored) return memoryStore[kind];
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? (parsed as ConfigRecord[]) : memoryStore[kind];
  } catch {
    return memoryStore[kind];
  }
}

function writeStore(kind: ConfigKind, records: ConfigRecord[]) {
  memoryStore[kind] = records;
  if (!isBrowser()) return;
  window.localStorage.setItem(storageKey(kind), JSON.stringify(records));
}

function recordText(record: ConfigRecord) {
  return Object.values(record)
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .map((value) => String(value ?? '').toLowerCase())
    .join(' ');
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

function isArchived(record: ConfigRecord) {
  return normalizeComparable(record.status) === 'arquivado';
}

function isTestConfigRecord(record: ConfigRecord) {
  const signature = normalizeComparable(JSON.stringify(record));
  return signature.includes('teste supabase') || signature.includes('supabase real') || signature.includes('codex') || signature.includes('template fake');
}

function applyFilters(records: ConfigRecord[], filters?: ConfigListFilters) {
  const query = filters?.search?.trim().toLowerCase() ?? '';
  const statusFilter = normalizeComparable(filters?.status ?? 'Todos');

  return records.filter((record) => {
    if (isTestConfigRecord(record)) return false;
    const matchesQuery = !query || recordText(record).includes(query);
    const matchesStatus =
      statusFilter === 'todos' ||
      (statusFilter === 'ativos' && record.active && !isArchived(record)) ||
      (statusFilter === 'inativos' && !record.active && !isArchived(record)) ||
      (statusFilter === 'arquivados' && isArchived(record));

    return matchesQuery && matchesStatus;
  });
}

function sortRecords(records: ConfigRecord[]) {
  return [...records].sort((a, b) => {
    const orderA = typeof a.order === 'number' ? a.order : Number.MAX_SAFE_INTEGER;
    const orderB = typeof b.order === 'number' ? b.order : Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) return orderA - orderB;
    return String(a.name ?? '').localeCompare(String(b.name ?? ''), 'pt-BR');
  });
}

function assertId(id: string) {
  if (!id) throw new Error('ID invalido.');
}

export const mockConfigRepository: ConfigRepository = {
  async list(kind, filters) {
    return applyFilters(sortRecords(readStore(kind)), filters);
  },

  async create(kind, input: CreateConfigRecordInput) {
    const record = input as ConfigRecord;
    writeStore(kind, [...readStore(kind), record]);
    return record;
  },

  async update(kind, id, input: UpdateConfigRecordInput) {
    assertId(id);
    let updated: ConfigRecord | null = null;
    const records = readStore(kind).map((record) => {
      if (record.id !== id) return record;
      updated = { ...(input as ConfigRecord), id };
      return updated;
    });

    if (!updated) throw new Error('Registro nao encontrado.');
    writeStore(kind, records);
    return updated;
  },

  async remove(kind, id) {
    assertId(id);
    if (kind === 'instagram') {
      writeStore(
        kind,
        readStore(kind).filter((record) => record.id !== id),
      );
      return;
    }

    writeStore(
      kind,
      readStore(kind).filter((record) => record.id !== id),
    );
  },

  async toggleArchive(kind, id) {
    assertId(id);
    let updated: ConfigRecord | null = null;
    const records = readStore(kind).map((record) => {
      if (record.id !== id) return record;
      const archived = isArchived(record);
      const active = archived;
      updated = {
        ...record,
        active,
        status: archived ? 'Ativo' : 'Arquivado',
        updatedAt: new Date().toISOString(),
      };
      return updated;
    });

    if (!updated) throw new Error('Registro nao encontrado.');
    writeStore(kind, records);
    return updated;
  },
};
