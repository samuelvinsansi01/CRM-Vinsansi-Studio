import { getSupabaseClient } from '../lib/supabase';
import { getCurrentUserId } from './supabase.helpers';

export type CatalogRow = { id: string; name: string };

export const CANONICAL_CATALOG = {
  channels: {
    WHATSAPP: 1,
    INSTAGRAM: 2,
  },
  status: {
    ACTIVE: 1,
    INACTIVE: 2,
    PENDING: 3,
    PROCESSING: 4,
    COMPLETED: 5,
    ERROR: 6,
    CANCELED: 7,
    PAUSED: 8,
  },
  leadStatus: {
    IMPORTED: 1,
    REVIEW: 2,
    NO_CONTACT: 3,
    QUEUED: 4,
    SENT: 5,
    INVALID: 6,
    DUPLICATE: 7,
  },
  contactSources: {
    NO_SITE: 1,
    OWN_DOMAIN: 2,
    AGGREGATOR: 3,
    INSTAGRAM: 4,
  },
} as const;

const EXPECTED_STATUS_NAMES = new Map<number, string>([
  [CANONICAL_CATALOG.status.ACTIVE, 'ativo'],
  [CANONICAL_CATALOG.status.INACTIVE, 'inativo'],
  [CANONICAL_CATALOG.status.PENDING, 'pendente'],
  [CANONICAL_CATALOG.status.PROCESSING, 'processando'],
  [CANONICAL_CATALOG.status.COMPLETED, 'concluido'],
  [CANONICAL_CATALOG.status.ERROR, 'erro'],
  [CANONICAL_CATALOG.status.CANCELED, 'cancelado'],
  [CANONICAL_CATALOG.status.PAUSED, 'pausado'],
]);

const EXPECTED_CHANNEL_NAMES = new Map<number, string>([
  [CANONICAL_CATALOG.channels.WHATSAPP, 'whatsapp'],
  [CANONICAL_CATALOG.channels.INSTAGRAM, 'instagram'],
]);

export function normalizeCatalogName(value: unknown) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

export async function listStatuses(): Promise<CatalogRow[]> {
  const { data, error } = await getSupabaseClient().from('status').select('status_id,status_name');
  if (error) throw new Error(`Nao foi possivel carregar o catalogo status: ${error.message}. Aplique SCHEMA_REAL_RLS.sql antes de usar o painel.`);
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.status_id),
    name: String(row.status_name ?? row.status_id),
  }));
}

export async function listChannels(): Promise<CatalogRow[]> {
  const { data, error } = await getSupabaseClient().from('channels').select('channels_id,channels_name');
  if (error) throw new Error(`Nao foi possivel carregar os canais: ${error.message}`);
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.channels_id),
    name: String(row.channels_name ?? row.channels_id),
  }));
}

function assertCatalogRow(rows: CatalogRow[], id: number, expectedName: string, catalog: string) {
  const row = rows.find((item) => Number(item.id) === id);
  if (!row) throw new Error(`${catalog} ${id} (${expectedName}) nao encontrado no banco.`);
  if (normalizeCatalogName(row.name) !== normalizeCatalogName(expectedName)) {
    throw new Error(`${catalog} ${id} deveria ser "${expectedName}", mas o banco retornou "${row.name}".`);
  }
}

export async function validateCanonicalCatalogs() {
  const [statuses, channels] = await Promise.all([listStatuses(), listChannels()]);
  for (const [id, name] of EXPECTED_STATUS_NAMES) assertCatalogRow(statuses, id, name, 'status');
  for (const [id, name] of EXPECTED_CHANNEL_NAMES) assertCatalogRow(channels, id, name, 'channels');
  return true;
}

export async function activeStatusId() {
  return String(CANONICAL_CATALOG.status.ACTIVE);
}

export async function inactiveStatusId() {
  return String(CANONICAL_CATALOG.status.INACTIVE);
}

export async function channelId(channel: 'WhatsApp' | 'Instagram' | 'Sem destino') {
  if (channel === 'WhatsApp') return String(CANONICAL_CATALOG.channels.WHATSAPP);
  if (channel === 'Instagram') return String(CANONICAL_CATALOG.channels.INSTAGRAM);
  const rows = await listChannels();
  const match = rows.find((row) => normalizeCatalogName(row.name) === 'sem destino');
  if (!match) throw new Error('Canal Sem destino não encontrado na tabela channels. O contrato R59 exige esse canal no catálogo.');
  return match.id;
}

export async function currentUserIdNumber() {
  const value = await getCurrentUserId();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error('users_id autenticado invalido.');
  return parsed;
}

export async function queueStatusId(status: string) {
  const normalized = normalizeCatalogName(status);
  const mapping: Record<string, number> = {
    queued: CANONICAL_CATALOG.status.PENDING,
    pending: CANONICAL_CATALOG.status.PENDING,
    pendente: CANONICAL_CATALOG.status.PENDING,
    sending: CANONICAL_CATALOG.status.PROCESSING,
    processing: CANONICAL_CATALOG.status.PROCESSING,
    processando: CANONICAL_CATALOG.status.PROCESSING,
    following: CANONICAL_CATALOG.status.PROCESSING,
    'dm opened': CANONICAL_CATALOG.status.PROCESSING,
    dm_opened: CANONICAL_CATALOG.status.PROCESSING,
    sent: CANONICAL_CATALOG.status.COMPLETED,
    completed: CANONICAL_CATALOG.status.COMPLETED,
    concluido: CANONICAL_CATALOG.status.COMPLETED,
    paused: CANONICAL_CATALOG.status.PAUSED,
    pausado: CANONICAL_CATALOG.status.PAUSED,
    error: CANONICAL_CATALOG.status.ERROR,
    erro: CANONICAL_CATALOG.status.ERROR,
    invalid: CANONICAL_CATALOG.status.CANCELED,
    invalido: CANONICAL_CATALOG.status.CANCELED,
    canceled: CANONICAL_CATALOG.status.CANCELED,
    cancelled: CANONICAL_CATALOG.status.CANCELED,
    cancelado: CANONICAL_CATALOG.status.CANCELED,
    active: CANONICAL_CATALOG.status.ACTIVE,
    ativo: CANONICAL_CATALOG.status.ACTIVE,
    inactive: CANONICAL_CATALOG.status.INACTIVE,
    inativo: CANONICAL_CATALOG.status.INACTIVE,
  };
  const id = mapping[normalized] ?? mapping[normalized.replace(/ /g, '_')];
  if (!id) throw new Error(`Status operacional "${status}" nao possui mapeamento canonico.`);
  return id;
}

export async function queueStatusNameMap() {
  return new Map<string, string>([
    [String(CANONICAL_CATALOG.status.ACTIVE), 'ativo'],
    [String(CANONICAL_CATALOG.status.INACTIVE), 'inativo'],
    [String(CANONICAL_CATALOG.status.PENDING), 'pendente'],
    [String(CANONICAL_CATALOG.status.PROCESSING), 'processando'],
    [String(CANONICAL_CATALOG.status.COMPLETED), 'concluido'],
    [String(CANONICAL_CATALOG.status.ERROR), 'erro'],
    [String(CANONICAL_CATALOG.status.CANCELED), 'cancelado'],
    [String(CANONICAL_CATALOG.status.PAUSED), 'pausado'],
  ]);
}

export function operationalStatusFromName(name: unknown) {
  const normalized = normalizeCatalogName(name);
  if (normalized === 'concluido' || normalized === 'completed' || normalized === 'sent') return 'sent';
  if (normalized === 'erro' || normalized === 'error' || normalized === 'failed') return 'error';
  if (normalized === 'pausado' || normalized === 'paused') return 'paused';
  if (normalized === 'processando' || normalized === 'processing' || normalized === 'sending') return 'sending';
  if (normalized === 'cancelado' || normalized === 'canceled' || normalized === 'cancelled') return 'invalid';
  return 'queued';
}
