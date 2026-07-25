-- Provisiona automaticamente public.users para cada usuário autenticado.
-- Ajuste os nomes considerados ativos abaixo caso sua tabela status use outro valor.

create unique index if not exists users_auth_user_id_unique
  on public.users (auth_user_id);

create or replace function public.ensure_current_user()
returns bigint
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_auth_user_id uuid := auth.uid();
  v_users_id bigint;
  v_status_id bigint;
begin
  if v_auth_user_id is null then
    raise exception 'Usuário não autenticado';
  end if;

  select u.users_id
    into v_users_id
  from public.users u
  where u.auth_user_id = v_auth_user_id;

  if v_users_id is not null then
    return v_users_id;
  end if;

  select s.status_id
    into v_status_id
  from public.status s
  where lower(trim(s.status_name)) in ('ativo', 'active')
  order by
    case lower(trim(s.status_name)) when 'ativo' then 0 else 1 end,
    s.status_id
  limit 1;

  if v_status_id is null then
    raise exception 'Nenhum status ativo encontrado em public.status';
  end if;

  insert into public.users (auth_user_id, status_id)
  values (v_auth_user_id, v_status_id)
  on conflict (auth_user_id) do update
    set users_updated_at = now()
  returning users_id into v_users_id;

  return v_users_id;
end;
$$;

revoke all on function public.ensure_current_user() from public;
grant execute on function public.ensure_current_user() to authenticated;

alter table public.users enable row level security;

drop policy if exists users_select_own on public.users;
create policy users_select_own
on public.users
for select
to authenticated
using (auth_user_id = auth.uid());

-- A criação é feita exclusivamente pela função SECURITY DEFINER.
-- Não é necessário liberar INSERT direto na tabela para o frontend.
