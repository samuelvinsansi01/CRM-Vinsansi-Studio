-- Fluxo 2 / etapa 1: múltiplas contas Apify com seleção exclusivamente manual.
-- O token nunca é retornado pelas funções de leitura.

alter table public.apify_accounts
  add column if not exists account_name text,
  add column if not exists token_secret text,
  add column if not exists is_active boolean not null default true,
  add column if not exists connection_status text not null default 'not_verified',
  add column if not exists external_username text,
  add column if not exists last_checked_at timestamptz,
  add column if not exists last_used_at timestamptz,
  add column if not exists last_error text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

update public.apify_accounts
set account_name = coalesce(nullif(trim(account_name), ''), 'Conta Apify ' || apify_accounts_id::text)
where account_name is null or trim(account_name) = '';

alter table public.apify_accounts
  alter column account_name set not null;

alter table public.apify_accounts
  drop constraint if exists apify_accounts_connection_status_check;

alter table public.apify_accounts
  add constraint apify_accounts_connection_status_check
  check (connection_status in ('not_verified', 'connected', 'error'));

create index if not exists apify_accounts_users_active_idx
  on public.apify_accounts (users_id, is_active, apify_accounts_id);

alter table public.apify_accounts enable row level security;

drop policy if exists apify_accounts_select_own on public.apify_accounts;
create policy apify_accounts_select_own
on public.apify_accounts
for select
to authenticated
using (
  users_id = (
    select users_id from public.users where auth_user_id = auth.uid()
  )
);

-- Escrita direta fica bloqueada; o frontend usa RPCs que nunca devolvem o token.
drop policy if exists apify_accounts_insert_own on public.apify_accounts;
drop policy if exists apify_accounts_update_own on public.apify_accounts;
drop policy if exists apify_accounts_delete_own on public.apify_accounts;

create or replace function public.list_apify_accounts()
returns table (
  apify_accounts_id bigint,
  account_name text,
  is_active boolean,
  token_mask text,
  connection_status text,
  external_username text,
  last_checked_at timestamptz,
  last_used_at timestamptz,
  last_error text,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    a.apify_accounts_id,
    a.account_name,
    a.is_active,
    case
      when coalesce(a.token_secret, '') = '' then ''
      when length(a.token_secret) <= 8 then '••••••••'
      else left(a.token_secret, 10) || '••••••••' || right(a.token_secret, 4)
    end as token_mask,
    a.connection_status,
    coalesce(a.external_username, ''),
    a.last_checked_at,
    a.last_used_at,
    coalesce(a.last_error, ''),
    a.created_at,
    a.updated_at
  from public.apify_accounts a
  where a.users_id = public.ensure_current_user()
  order by a.is_active desc, a.account_name, a.apify_accounts_id;
$$;

create or replace function public.save_apify_account(
  p_apify_accounts_id bigint,
  p_account_name text,
  p_token text,
  p_is_active boolean
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_users_id bigint := public.ensure_current_user();
  v_id bigint;
begin
  if nullif(trim(p_account_name), '') is null then
    raise exception 'Informe o nome da conta Apify';
  end if;

  if p_apify_accounts_id is null then
    if nullif(trim(coalesce(p_token, '')), '') is null then
      raise exception 'Informe o token da nova conta Apify';
    end if;

    insert into public.apify_accounts (
      users_id, account_name, token_secret, is_active,
      connection_status, created_at, updated_at
    ) values (
      v_users_id, trim(p_account_name), trim(p_token), coalesce(p_is_active, true),
      'not_verified', now(), now()
    )
    returning apify_accounts_id into v_id;
  else
    update public.apify_accounts
    set
      account_name = trim(p_account_name),
      token_secret = case
        when nullif(trim(coalesce(p_token, '')), '') is null then token_secret
        else trim(p_token)
      end,
      is_active = coalesce(p_is_active, true),
      connection_status = case
        when nullif(trim(coalesce(p_token, '')), '') is null then connection_status
        else 'not_verified'
      end,
      last_error = case
        when nullif(trim(coalesce(p_token, '')), '') is null then last_error
        else null
      end,
      updated_at = now()
    where apify_accounts_id = p_apify_accounts_id
      and users_id = v_users_id
    returning apify_accounts_id into v_id;

    if v_id is null then
      raise exception 'Conta Apify não encontrada';
    end if;
  end if;

  return v_id;
end;
$$;

create or replace function public.delete_apify_account(p_apify_accounts_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_users_id bigint := public.ensure_current_user();
begin
  delete from public.apify_accounts
  where apify_accounts_id = p_apify_accounts_id
    and users_id = v_users_id;

  if not found then
    raise exception 'Conta Apify não encontrada';
  end if;
end;
$$;

revoke all on function public.list_apify_accounts() from public;
revoke all on function public.save_apify_account(bigint, text, text, boolean) from public;
revoke all on function public.delete_apify_account(bigint) from public;

grant execute on function public.list_apify_accounts() to authenticated;
grant execute on function public.save_apify_account(bigint, text, text, boolean) to authenticated;
grant execute on function public.delete_apify_account(bigint) to authenticated;
