-- V3.39.11 — atualização do perfil Instagram pelo mesmo critério validado manualmente
-- Atualiza o registro pelo username normalizado e pelo usuário autenticado.

alter table if exists public.instagram_profiles
  add column if not exists daily_limit integer not null default 60;

alter table if exists public.instagram_profiles
  add column if not exists data jsonb not null default '{}'::jsonb;

drop function if exists public.update_instagram_profile_by_username_v3(text, text, text, boolean, text, integer);

create function public.update_instagram_profile_by_username_v3(
  p_current_username text,
  p_username text,
  p_display_name text,
  p_active boolean,
  p_status text,
  p_daily_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_saved public.instagram_profiles%rowtype;
  v_current_username text;
  v_new_username text;
begin
  if auth.uid() is null then
    raise exception 'Usuario nao autenticado';
  end if;

  if p_daily_limit is null or p_daily_limit < 1 then
    raise exception 'Limite diario invalido';
  end if;

  v_current_username := lower(regexp_replace(coalesce(p_current_username, ''), '^@', ''));
  v_new_username := regexp_replace(trim(coalesce(p_username, '')), '^@', '');

  if v_current_username = '' then
    raise exception 'Username atual nao informado';
  end if;

  if v_new_username = '' then
    raise exception 'Username do Instagram nao informado';
  end if;

  update public.instagram_profiles
     set username = v_new_username,
         display_name = coalesce(nullif(trim(p_display_name), ''), v_new_username),
         active = p_active,
         status = p_status,
         daily_limit = p_daily_limit,
         data = jsonb_set(
           coalesce(data, '{}'::jsonb),
           '{dailyLimit}',
           to_jsonb(p_daily_limit),
           true
         ) || jsonb_build_object('updatedAt', now()),
         updated_at = now()
   where lower(regexp_replace(coalesce(username, ''), '^@', '')) = v_current_username
     and user_id::text = auth.uid()::text
  returning * into v_saved;

  if not found then
    raise exception 'Perfil Instagram nao encontrado para o usuario autenticado';
  end if;

  if v_saved.daily_limit is distinct from p_daily_limit then
    raise exception 'O limite diario nao foi persistido';
  end if;

  return to_jsonb(v_saved);
end;
$$;

revoke all on function public.update_instagram_profile_by_username_v3(text, text, text, boolean, text, integer) from public;
grant execute on function public.update_instagram_profile_by_username_v3(text, text, text, boolean, text, integer) to authenticated;

select pg_notify('pgrst', 'reload schema');
