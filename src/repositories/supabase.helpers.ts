import { getSupabaseClient } from '../lib/supabase';
import { toLocalDateInputValue } from '../utils/date';

export type JsonRecordRow<T> = {
  id: string;
  data: T;
  status?: string | null;
  active?: boolean | null;
  kind?: string | null;
  channel?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createUuid() {
  return crypto.randomUUID();
}

export async function getCurrentUserId() {
  const { data, error } = await getSupabaseClient().auth.getUser();
  if (!error && data.user?.id) return data.user.id;

  const fallback = import.meta.env.VITE_DEFAULT_USER_ID ?? '';
  if (fallback) return fallback;

  throw new Error('Supabase user_id ausente. Defina VITE_DEFAULT_USER_ID enquanto nao houver auth real.');
}

export function nowIso() {
  return new Date().toISOString();
}

export function todayIsoDate() {
  return toLocalDateInputValue();
}

export function compactStrings(values: Array<string | undefined>) {
  return values.filter((value): value is string => Boolean(value));
}

export function rowData<T>(row: JsonRecordRow<T>): T {
  return row.data;
}

export async function selectJsonRecords<T>(table: string) {
  const { data, error } = await getSupabaseClient().from(table).select('id,data,status,active,kind,channel,created_at,updated_at');
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => rowData(row as JsonRecordRow<T>)).filter(Boolean);
}

export async function insertJsonRecord<T extends { id: string }>(table: string, record: T, extra: Record<string, unknown> = {}) {
  const timestamp = nowIso();
  const { error } = await getSupabaseClient()
    .from(table)
    .insert({
      id: record.id,
      data: record,
      created_at: timestamp,
      updated_at: timestamp,
      ...extra,
    });
  if (error) throw new Error(error.message);
  return record;
}

export async function updateJsonRecord<T extends { id: string }>(table: string, record: T, extra: Record<string, unknown> = {}) {
  const { error } = await getSupabaseClient()
    .from(table)
    .update({
      data: record,
      updated_at: nowIso(),
      ...extra,
    })
    .eq('id', record.id);
  if (error) throw new Error(error.message);
  return record;
}

export async function deleteJsonRecord(table: string, id: string) {
  const { error } = await getSupabaseClient().from(table).delete().eq('id', id);
  if (error) throw new Error(error.message);
}
