-- Lead Certo V3.5
-- 1) Auditoria via RPC segura para não depender de INSERT direto bloqueado por RLS.
-- 2) Esta migration é idempotente e pode ser executada após a V3.1/V3.4.

begin;

alter table public.lead_events
  add column if not exists user_id uuid,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists data jsonb not null default '{}'::jsonb;

alter table public.lead_events enable row level security;

-- Mantém leitura direta limitada ao dono. O app passa a inserir via RPC abaixo.
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

-- A função roda com permissões do dono da tabela, mas exige que o user_id recebido
-- seja exatamente o usuário autenticado. Não permite gravar eventos de outro usuário.
create or replace function public.append_lead_event(p_event jsonb)
returns text
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid;
  v_id text;
begin
  if p_event is null then
    raise exception 'Evento ausente.';
  end if;

  v_user_id := nullif(p_event ->> 'user_id', '')::uuid;
  if v_user_id is null then
    raise exception 'Evento sem user_id.';
  end if;

  if auth.uid() is null or auth.uid() <> v_user_id then
    raise exception 'Sem permissão para registrar evento deste usuário.';
  end if;

  v_id := coalesce(nullif(p_event ->> 'id', ''), gen_random_uuid()::text);

  insert into public.lead_events (
    id, user_id, lead_id, company_name, normalized_phone, website, instagram_url,
    maps_url, channel, source, action, event_type, status, message_template,
    sent_at, created_at, updated_at, metadata, data, active, kind, queue_item_id
  ) values (
    v_id,
    v_user_id,
    nullif(p_event ->> 'lead_id', ''),
    nullif(p_event ->> 'company_name', ''),
    nullif(p_event ->> 'normalized_phone', ''),
    nullif(p_event ->> 'website', ''),
    nullif(p_event ->> 'instagram_url', ''),
    nullif(p_event ->> 'maps_url', ''),
    coalesce(nullif(p_event ->> 'channel', ''), 'whatsapp'),
    coalesce(nullif(p_event ->> 'source', ''), 'react'),
    coalesce(nullif(p_event ->> 'action', ''), 'event'),
    coalesce(nullif(p_event ->> 'event_type', ''), nullif(p_event ->> 'action', ''), 'event'),
    coalesce(nullif(p_event ->> 'status', ''), 'sent'),
    coalesce(nullif(p_event ->> 'message_template', ''), ''),
    coalesce(nullif(p_event ->> 'sent_at', '')::timestamptz, now()),
    coalesce(nullif(p_event ->> 'created_at', '')::timestamptz, now()),
    coalesce(nullif(p_event ->> 'updated_at', '')::timestamptz, now()),
    coalesce(p_event -> 'metadata', '{}'::jsonb),
    coalesce(p_event -> 'data', '{}'::jsonb),
    coalesce((p_event ->> 'active')::boolean, true),
    coalesce(nullif(p_event ->> 'kind', ''), 'event'),
    nullif(p_event ->> 'queue_item_id', '')
  );

  return v_id;
end;
$$;

revoke all on function public.append_lead_event(jsonb) from public;
grant execute on function public.append_lead_event(jsonb) to authenticated;

commit;
