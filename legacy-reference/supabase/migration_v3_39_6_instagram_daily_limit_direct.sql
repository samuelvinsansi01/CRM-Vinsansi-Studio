-- V3.39.6 — contrato mínimo para persistência direta do limite Instagram
-- A aplicação passa a salvar diretamente na tabela configurada, sem RPC.

alter table if exists public.instagram_profiles
  add column if not exists daily_limit integer;

alter table if exists public.instagram_profiles
  add column if not exists data jsonb not null default '{}'::jsonb;

update public.instagram_profiles
set daily_limit = greatest(
  1,
  coalesce(
    daily_limit,
    case
      when coalesce(data->>'dailyLimit', '') ~ '^[0-9]+$'
        then (data->>'dailyLimit')::integer
      else null
    end,
    60
  )
)
where daily_limit is null or daily_limit < 1;

alter table if exists public.instagram_profiles
  alter column daily_limit set default 60;

alter table if exists public.instagram_profiles
  alter column daily_limit set not null;

alter table if exists public.instagram_profiles
  drop constraint if exists instagram_profiles_daily_limit_positive;

alter table if exists public.instagram_profiles
  add constraint instagram_profiles_daily_limit_positive check (daily_limit >= 1);

-- Remove a RPC antiga: ela não é mais usada e podia apontar para contrato/tipo diferente.
drop function if exists public.save_instagram_profile_daily_limit(uuid, integer);
drop function if exists public.save_instagram_profile_daily_limit(text, integer);

notify pgrst, 'reload schema';
