-- V3.39.5 — compatibilidade definitiva de tipos no salvamento do limite Instagram
-- Alguns bancos possuem instagram_profiles.user_id como UUID e outros como TEXT.
-- A comparação textual abaixo funciona nos dois contratos sem alterar os dados existentes.

alter table if exists public.instagram_profiles
  add column if not exists daily_limit integer not null default 60;

alter table if exists public.instagram_profiles
  add column if not exists data jsonb not null default '{}'::jsonb;

-- Remove todas as assinaturas conhecidas para impedir ambiguidade no PostgREST.
drop function if exists public.save_instagram_profile_daily_limit(uuid, integer);
drop function if exists public.save_instagram_profile_daily_limit(text, integer);

create function public.save_instagram_profile_daily_limit(
  p_profile_id text,
  p_daily_limit integer
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_saved integer;
  v_user_id text;
begin
  v_user_id := auth.uid()::text;

  if v_user_id is null or btrim(v_user_id) = '' then
    raise exception 'Sessão autenticada não encontrada.';
  end if;

  if p_profile_id is null or btrim(p_profile_id) = '' then
    raise exception 'ID do perfil Instagram não informado.';
  end if;

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
   where id::text = p_profile_id
     and user_id::text = v_user_id
  returning daily_limit into v_saved;

  if v_saved is null then
    raise exception 'Perfil Instagram não encontrado ou sem permissão para atualização. ID: %', p_profile_id;
  end if;

  return v_saved;
end;
$$;

grant execute on function public.save_instagram_profile_daily_limit(text, integer) to authenticated;

-- Normaliza os registros existentes sem alterar seus identificadores.
update public.instagram_profiles
set daily_limit = greatest(1, coalesce(daily_limit, 60)),
    data = coalesce(data, '{}'::jsonb) || jsonb_build_object(
      'dailyLimit', greatest(1, coalesce(daily_limit, 60)),
      'updatedAt', now()
    );

notify pgrst, 'reload schema';
