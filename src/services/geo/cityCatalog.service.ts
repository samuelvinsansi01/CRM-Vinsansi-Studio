import { getSupabaseClient } from '../../lib/supabase';

export type CityOption = { value: string; label: string };

const cache = new Map<string, CityOption[]>();

function normalizedStateCode(value: string) {
  return value.trim().toUpperCase();
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function listCitiesByStateCode(stateCode: string): Promise<CityOption[]> {
  const code = normalizedStateCode(stateCode);
  if (!code) return [];
  const cached = cache.get(code);
  if (cached) return cached;

  const client = getSupabaseClient();
  const stateResponse = await client
    .from('states')
    .select('states_id')
    .eq('states_code', code)
    .maybeSingle();
  if (stateResponse.error) throw new Error(`Não foi possível localizar o estado: ${stateResponse.error.message}`);
  const stateId = Number(record(stateResponse.data).states_id ?? 0);
  if (!Number.isSafeInteger(stateId) || stateId <= 0) return [];

  const cityResponse = await client
    .from('cities')
    .select('cities_name')
    .eq('states_id', stateId)
    .order('cities_name', { ascending: true });
  if (cityResponse.error) throw new Error(`Não foi possível carregar as cidades: ${cityResponse.error.message}`);

  const rows: unknown[] = Array.isArray(cityResponse.data) ? cityResponse.data : [];
  const options = rows
    .map((row) => String(record(row).cities_name ?? '').trim())
    .filter(Boolean)
    .map((name) => ({ value: name, label: name }));
  cache.set(code, options);
  return options;
}

export const cityCatalogService = { listCitiesByStateCode };
