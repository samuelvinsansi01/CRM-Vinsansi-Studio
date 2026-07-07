-- Lead Certo V3.4 — hotfix de RLS para auditoria em lead_events.
-- Seguro para executar depois da migration_v3_canonical_contract_hotfix.sql.
-- Mantém RLS ligado e permite que cada usuário autenticado leia/insira somente seus próprios eventos.

begin;

alter table public.lead_events
  add column if not exists user_id uuid;

alter table public.lead_events enable row level security;

-- Preserva o isolamento dos eventos já vinculados a leads do mesmo usuário.
update public.lead_events e
set user_id = l.user_id
from public.leads l
where e.user_id is null
  and e.lead_id = l.id
  and l.user_id is not null;

-- As políticas são idempotentes. Outras políticas existentes continuam válidas;
-- estas adicionam a permissão mínima que o painel precisa.
drop policy if exists lead_events_select_own on public.lead_events;
drop policy if exists lead_events_insert_own on public.lead_events;

create policy lead_events_select_own
on public.lead_events
for select
to authenticated
using (user_id = auth.uid());

create policy lead_events_insert_own
on public.lead_events
for insert
to authenticated
with check (user_id = auth.uid());

commit;
