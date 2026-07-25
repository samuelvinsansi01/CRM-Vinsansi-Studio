-- V3.39.3 — persistência transacional do limite diário por perfil Instagram
-- Execute no SQL Editor do Supabase. Idempotente.

alter table if exists public.instagram_profiles
  add column if not exists daily_limit integer not null default 60;

alter table if exists public.instagram_profiles
  add column if not exists data jsonb not null default '{}'::jsonb;

alter table if exists public.instagram_profiles
  drop constraint if exists instagram_profiles_daily_limit_positive;

alter table if exists public.instagram_profiles
  add constraint instagram_profiles_daily_limit_positive check (daily_limit >= 1);

-- Mantém coluna e JSON legado sincronizados mesmo quando outro cliente atualizar a tabela.
create or replace function public.sync_instagram_profile_daily_limit()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.daily_limit := greatest(
    1,
    coalesce(
      new.daily_limit,
      case
        when coalesce(new.data->>'dailyLimit', '') ~ '^[0-9]+$'
          then (new.data->>'dailyLimit')::integer
        else null
      end,
      60
    )
  );

  new.data := coalesce(new.data, '{}'::jsonb) || jsonb_build_object(
    'dailyLimit', new.daily_limit,
    'updatedAt', now()
  );

  return new;
end;
$$;

drop trigger if exists trg_sync_instagram_profile_daily_limit on public.instagram_profiles;
create trigger trg_sync_instagram_profile_daily_limit
before insert or update of daily_limit, data
on public.instagram_profiles
for each row
execute function public.sync_instagram_profile_daily_limit();

-- Operação dedicada usada pelo painel. SECURITY INVOKER preserva as políticas RLS.
create or replace function public.save_instagram_profile_daily_limit(
  p_profile_id uuid,
  p_daily_limit integer
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_saved integer;
begin
  if p_daily_limit is null or p_daily_limit < 1 then
    raise exception 'O limite diário deve ser maior ou igual a 1.';
  end if;

  update public.instagram_profiles
     set daily_limit = p_daily_limit,
         data = coalesce(data, '{}'::jsonb) || jsonb_build_object(
           'dailyLimit', p_daily_limit,
           'updatedAt', now()
         ),
         updated_at = now()
   where id = p_profile_id
     and user_id = auth.uid()
  returning daily_limit into v_saved;

  if v_saved is null then
    raise exception 'Perfil Instagram não encontrado ou sem permissão para atualização.';
  end if;

  return v_saved;
end;
$$;

grant execute on function public.save_instagram_profile_daily_limit(uuid, integer) to authenticated;

-- Corrige registros existentes e sincroniza o JSON.
update public.instagram_profiles
set daily_limit = greatest(1, coalesce(daily_limit, 60)),
    data = coalesce(data, '{}'::jsonb) || jsonb_build_object(
      'dailyLimit', greatest(1, coalesce(daily_limit, 60)),
      'updatedAt', now()
    );

notify pgrst, 'reload schema';
