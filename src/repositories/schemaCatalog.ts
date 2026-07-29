import { getSupabaseClient } from '../lib/supabase';
import { getCurrentUserId } from './supabase.helpers';

export type CatalogRow = { id: string; name: string };

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

export function findCatalogId(rows: CatalogRow[], candidates: string[], fallback?: string) {
  const candidateSet = candidates.map(normalizeCatalogName);
  const match = rows.find((row) => candidateSet.some((candidate) => {
    const value = normalizeCatalogName(row.name);
    return value === candidate || value.includes(candidate) || candidate.includes(value);
  }));
  return match?.id ?? fallback;
}

export async function activeStatusId() {
  const rows = await listStatuses();
  return findCatalogId(rows, ['ativo', 'active', 'enabled', 'conectado', 'connected'], '1')!;
}

export async function inactiveStatusId() {
  const rows = await listStatuses();
  return findCatalogId(rows, ['inativo', 'inactive', 'disabled', 'desativado', 'arquivado', 'archived'], rows.find((row) => row.id !== '1')?.id ?? '1')!;
}

export async function channelId(channel: 'WhatsApp' | 'Instagram') {
  const rows = await listChannels();
  const id = findCatalogId(rows, [channel]);
  if (!id) throw new Error(`Canal ${channel} nao encontrado na tabela channels.`);
  return id;
}

export async function currentUserIdNumber() {
  const value = await getCurrentUserId();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error('users_id autenticado invalido.');
  return parsed;
}

export async function queueStatusId(status: string) {
  const rows = await listStatuses();
  const candidates: Record<string, string[]> = {
    queued: ['na fila', 'fila', 'queued', 'pendente', 'pending', 'ativo'],
    sending: ['enviando', 'sending', 'processando', 'processing'],
    following: ['seguindo', 'following', 'processando', 'processing'],
    dm_opened: ['dm aberta', 'dm aberto', 'dm_opened', 'processando', 'processing'],
    sent: ['enviado', 'sent', 'concluido', 'completed', 'finalizado'],
    paused: ['pausado', 'paused'],
    error: ['erro', 'error', 'falhou', 'failed'],
    invalid: ['invalido', 'invalid'],
  };
  const id = findCatalogId(rows, candidates[status] ?? [status]);
  if (!id) throw new Error(`Status operacional "${status}" nao encontrado na tabela status.`);
  return Number(id);
}

export async function queueStatusNameMap() {
  const rows = await listStatuses();
  return new Map(rows.map((row) => [String(row.id), normalizeCatalogName(row.name)]));
}

export function operationalStatusFromName(name: unknown) {
  const normalized = normalizeCatalogName(name);
  if (normalized.includes('enviad') || normalized.includes('sent') || normalized.includes('conclu') || normalized.includes('finaliz')) return 'sent';
  if (normalized.includes('erro') || normalized.includes('error') || normalized.includes('falh')) return 'error';
  if (normalized.includes('invalid') || normalized.includes('inval')) return 'invalid';
  if (normalized.includes('paus') || normalized.includes('paused')) return 'paused';
  if (normalized.includes('segu') || normalized.includes('following')) return 'following';
  if (normalized.includes('dm')) return 'dm_opened';
  if (normalized.includes('enviando') || normalized.includes('sending') || normalized.includes('process')) return 'sending';
  return 'queued';
}
