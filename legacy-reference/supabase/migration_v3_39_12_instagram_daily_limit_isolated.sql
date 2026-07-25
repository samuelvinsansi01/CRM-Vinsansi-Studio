-- V3.39.12 — persistência isolada do limite diário do Instagram
-- Replica o UPDATE validado manualmente e não altera nenhum outro campo do perfil.

alter table if exists public.instagram_profiles
  add column if not exists daily_limit integer not null default 60;

alter table if exists public.instagram_profiles
  add column if not exists data jsonb not null default '{}'::jsonb;

drop function if exists public.set_instagram_profile_daily_limit_v4(text, integer);

create function public.set_instagram_profile_daily_limit_v4(
  p_profile_id text,
  p_daily_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_saved public.instagram_profiles%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Usuario nao autenticado';
  end if;

  if p_profile_id is null or trim(p_profile_id) = '' then
    raise exception 'Perfil Instagram nao informado';
  end if;

  if p_daily_limit is null or p_daily_limit < 1 then
    raise exception 'Limite diario invalido';
  end if;

  update public.instagram_profiles
     set daily_limit = p_daily_limit,
         data = jsonb_set(
           coalesce(data, '{}'::jsonb),
           '{dailyLimit}',
           to_jsonb(p_daily_limit),
           true
         ),
         updated_at = now()
   where id::text = p_profile_id
     and user_id::text = auth.uid()::text
  returning * into v_saved;

  if not found then
    raise exception 'Perfil Instagram nao encontrado para o usuario autenticado';
  end if;

  if v_saved.daily_limit is distinct from p_daily_limit
     or coalesce(v_saved.data->>'dailyLimit', '') <> p_daily_limit::text then
    raise exception 'O limite diario nao foi persistido corretamente';
  end if;

  return to_jsonb(v_saved);
end;
$$;

revoke all on function public.set_instagram_profile_daily_limit_v4(text, integer) from public;
grant execute on function public.set_instagram_profile_daily_limit_v4(text, integer) to authenticated;

select pg_notify('pgrst', 'reload schema');
