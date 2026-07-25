-- V3.39.8 — salvamento minimo e compativel do perfil Instagram
-- Nao altera blocks, block_size ou interval_minutes, pois esses campos variam
-- entre bancos antigos e novos e nao fazem parte da edicao do limite por perfil.

alter table if exists public.instagram_profiles
  add column if not exists daily_limit integer not null default 60;

alter table if exists public.instagram_profiles
  add column if not exists data jsonb not null default '{}'::jsonb;

-- Remove todas as assinaturas conhecidas anteriores para evitar ambiguidade no PostgREST.
drop function if exists public.save_instagram_profile_config(text, text, text, boolean, text, integer, jsonb, integer, integer, jsonb);
drop function if exists public.save_instagram_profile_config(text, text, text, boolean, text, integer, jsonb);

create function public.save_instagram_profile_config(
  p_profile_id text,
  p_username text,
  p_display_name text,
  p_active boolean,
  p_status text,
  p_daily_limit integer,
  p_data jsonb
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

  if p_daily_limit is null or p_daily_limit < 1 then
    raise exception 'Limite diario invalido';
  end if;

  update public.instagram_profiles
     set username = p_username,
         display_name = p_display_name,
         active = p_active,
         status = p_status,
         daily_limit = p_daily_limit,
         data = coalesce(data, '{}'::jsonb)
                || coalesce(p_data, '{}'::jsonb)
                || jsonb_build_object(
                     'dailyLimit', p_daily_limit,
                     'updatedAt', now()
                   ),
         updated_at = now()
   where id::text = p_profile_id
     and user_id::text = auth.uid()::text
  returning * into v_saved;

  if not found then
    raise exception 'Perfil Instagram nao encontrado para o usuario autenticado';
  end if;

  return to_jsonb(v_saved);
end;
$$;

revoke all on function public.save_instagram_profile_config(text, text, text, boolean, text, integer, jsonb) from public;
grant execute on function public.save_instagram_profile_config(text, text, text, boolean, text, integer, jsonb) to authenticated;

notify pgrst, 'reload schema';
