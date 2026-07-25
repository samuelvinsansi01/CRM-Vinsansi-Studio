-- Esta migration não cria tabelas nem status. Usa somente a estrutura existente.

alter table public.leads enable row level security;

-- O usuário autenticado acessa somente os próprios leads.
drop policy if exists "leads_select_own" on public.leads;
create policy "leads_select_own"
on public.leads
for select
to authenticated
using (
  users_id = (
    select u.users_id
    from public.users u
    where u.auth_user_id = auth.uid()
  )
);

drop policy if exists "leads_insert_own" on public.leads;
create policy "leads_insert_own"
on public.leads
for insert
to authenticated
with check (
  users_id = (
    select u.users_id
    from public.users u
    where u.auth_user_id = auth.uid()
  )
);

drop policy if exists "leads_update_own" on public.leads;
create policy "leads_update_own"
on public.leads
for update
to authenticated
using (
  users_id = (
    select u.users_id
    from public.users u
    where u.auth_user_id = auth.uid()
  )
)
with check (
  users_id = (
    select u.users_id
    from public.users u
    where u.auth_user_id = auth.uid()
  )
);

-- Índices para filtros e busca mais frequentes.
create index if not exists leads_users_created_idx
  on public.leads (users_id, leads_created_at desc);

create index if not exists leads_users_status_idx
  on public.leads (users_id, lead_status_id);

create index if not exists leads_users_branch_idx
  on public.leads (users_id, branches_id);
