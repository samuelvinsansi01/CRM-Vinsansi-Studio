-- V3.39.2 — limite diário por perfil Instagram, persistência ponta a ponta
-- Idempotente e segura para ambientes que ainda não receberam a coluna.

alter table if exists public.instagram_profiles
  add column if not exists daily_limit integer;

alter table if exists public.instagram_profiles
  add column if not exists data jsonb not null default '{}'::jsonb;

update public.instagram_profiles
set daily_limit = greatest(
  1,
  coalesce(
    daily_limit,
    case when coalesce(data->>'dailyLimit', '') ~ '^[0-9]+$' then (data->>'dailyLimit')::integer end,
    60
  )
)
where daily_limit is null or daily_limit < 1;

update public.instagram_profiles
set data = coalesce(data, '{}'::jsonb) || jsonb_build_object(
  'dailyLimit', greatest(1, coalesce(daily_limit, 60)),
  'updatedAt', now()
);

alter table if exists public.instagram_profiles
  alter column daily_limit set default 60;

alter table if exists public.instagram_profiles
  alter column daily_limit set not null;

alter table if exists public.instagram_profiles
  drop constraint if exists instagram_profiles_daily_limit_positive;

alter table if exists public.instagram_profiles
  add constraint instagram_profiles_daily_limit_positive check (daily_limit >= 1);

-- Recarrega o cache de schema da API do Supabase/PostgREST.
notify pgrst, 'reload schema';
