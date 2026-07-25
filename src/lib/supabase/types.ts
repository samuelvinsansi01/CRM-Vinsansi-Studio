import type { SupabaseClient } from '@supabase/supabase-js';

export type SupabaseQueryResult<T> = {
  data: T | null;
  error: Error | null;
};

export type AppSupabaseClient = SupabaseClient;
