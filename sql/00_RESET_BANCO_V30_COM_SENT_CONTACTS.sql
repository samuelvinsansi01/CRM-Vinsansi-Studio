-- =========================================================
-- RESET TOTAL + BASE V30 + PROTEÇÃO DE JÁ ENVIADOS
-- CUIDADO: apaga todo o schema public.
-- =========================================================

drop schema if exists public cascade;
create schema public;

grant usage on schema public to postgres, anon, authenticated, service_role;
grant all on schema public to postgres, service_role;
alter default privileges in schema public grant all on tables to postgres, service_role;
alter default privileges in schema public grant all on sequences to postgres, service_role;
alter default privileges in schema public grant all on functions to postgres, service_role;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;

create extension if not exists pgcrypto;

create or replace function public.normalize_br_phone(input text)
returns text
language plpgsql
immutable
as $$
declare
  digits text;
begin
  digits := regexp_replace(coalesce(input, ''), '\D', '', 'g');
  if digits = '' then return null; end if;
  if length(digits) between 10 and 11 then return '55' || digits; end if;
  return digits;
end;
$$;

create table public.leads (
  id text primary key default gen_random_uuid()::text,
  user_id uuid not null references auth.users(id) on delete cascade,
  user_email text,
  company_name text,
  category text,
  parent_category text,
  rating numeric,
  reviews_count int,
  phone text,
  normalized_phone text generated always as (public.normalize_br_phone(phone)) stored,
  website text,
  has_own_site boolean default false,
  instagram text,
  instagram_url text,
  instagram_username text,
  city text,
  state text,
  maps_url text,
  status text default 'Não enviada',
  current_stage text default 'imported',
  current_status text default 'new',
  lead_channel text default 'whatsapp',
  lead_type text default 'sem-site',
  pipeline_status text,
  crm_data jsonb default '{}'::jsonb,
  raw_payload jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create unique index leads_user_normalized_phone_unique on public.leads(user_id, normalized_phone) where normalized_phone is not null;

create table public.sent_contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lead_id text null references public.leads(id) on delete set null,
  company_name text,
  phone text,
  normalized_phone text not null,
  block_type text not null default 'already_sent',
  source text not null default 'dispatch',
  reason text,
  active boolean not null default true,
  dispatched_at timestamptz,
  created_at timestamptz default now(),
  raw_payload jsonb default '{}'::jsonb
);
create unique index sent_contacts_user_phone_active_unique on public.sent_contacts(user_id, normalized_phone) where active = true;
create unique index sent_contacts_user_phone_active_state_unique on public.sent_contacts(user_id, normalized_phone, active);
create index sent_contacts_user_idx on public.sent_contacts(user_id);
create index sent_contacts_phone_idx on public.sent_contacts(normalized_phone);

create table public.whatsapp_instances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  user_email text,
  chip_id text,
  label text,
  name text,
  instance text not null,
  base_url text not null default 'https://evolution.samuelvinsansi.com.br',
  evolution_url text not null default 'https://evolution.samuelvinsansi.com.br',
  url text not null default 'https://evolution.samuelvinsansi.com.br',
  api_key text not null,
  status text default 'saved',
  connection_state text default 'saved',
  active boolean default true,
  daily_limit int default 120,
  block_size int default 30,
  interval_seconds int default 120,
  blocks jsonb default '["08:00","10:00","12:00","14:00"]'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, instance),
  unique(user_id, chip_id)
);

create table public.operational_data (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  scope text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, scope)
);

create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text default 'apify',
  source_file_name text,
  quantity_total int default 0,
  quantity_created int default 0,
  quantity_blocked int default 0,
  quantity_duplicate int default 0,
  raw_metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create table public.lead_imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  import_batch_id uuid references public.import_batches(id) on delete cascade,
  lead_id text references public.leads(id) on delete set null,
  original_payload jsonb default '{}'::jsonb,
  normalized_payload jsonb default '{}'::jsonb,
  status text,
  reason text,
  created_at timestamptz default now()
);

create table public.dispatch_message_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lead_id text references public.leads(id) on delete set null,
  chip_id uuid references public.whatsapp_instances(id) on delete set null,
  instance text,
  phone text,
  normalized_phone text,
  direction text default 'out',
  part text,
  body text,
  status text,
  response_payload jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create table public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  lead_id text references public.leads(id) on delete set null,
  instance text,
  external_id text,
  remote_jid text,
  push_name text,
  phone text,
  normalized_phone text,
  phone_normalized text,
  direction text,
  message_type text default 'text',
  body text,
  status text,
  occurred_at timestamptz default now(),
  read_at timestamptz,
  raw_payload jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create unique index whatsapp_messages_instance_external_unique on public.whatsapp_messages(instance, external_id) where external_id is not null and trim(external_id) <> '';

create table public.whatsapp_contact_map (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  instance text not null,
  lid text,
  lead_id text references public.leads(id) on delete set null,
  phone_real text,
  push_name text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, instance, lid)
);

create table public.settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null,
  value jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, key)
);

create table public.message_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text,
  template_type text default 'whatsapp',
  ramo_id text,
  part_1 text,
  part_2 text,
  active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table public.lead_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lead_id text not null references public.leads(id) on delete cascade,
  note text,
  created_at timestamptz default now()
);

create table public.lead_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lead_id text not null references public.leads(id) on delete cascade,
  event text,
  type text,
  title text,
  description text,
  payload jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create table public.lead_followups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lead_id text not null references public.leads(id) on delete cascade,
  followup_date text,
  status text default 'future',
  title text,
  description text,
  due_at timestamptz,
  done boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create or replace function public.mark_lead_as_sent(
  p_user_id uuid,
  p_lead_id text,
  p_company_name text,
  p_phone text,
  p_source text default 'dispatch',
  p_reason text default 'sent_success',
  p_raw_payload jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
as $$
declare
  v_normalized text;
  v_id uuid;
begin
  v_normalized := public.normalize_br_phone(p_phone);
  if v_normalized is null then raise exception 'Telefone inválido'; end if;

  insert into public.sent_contacts(user_id, lead_id, company_name, phone, normalized_phone, block_type, source, reason, active, dispatched_at, raw_payload)
  values (p_user_id, p_lead_id, p_company_name, p_phone, v_normalized, 'already_sent', coalesce(p_source,'dispatch'), coalesce(p_reason,'sent_success'), true, now(), coalesce(p_raw_payload,'{}'::jsonb))
  on conflict (user_id, normalized_phone) where active = true
  do update set
    lead_id = coalesce(excluded.lead_id, public.sent_contacts.lead_id),
    company_name = coalesce(excluded.company_name, public.sent_contacts.company_name),
    phone = coalesce(excluded.phone, public.sent_contacts.phone),
    dispatched_at = coalesce(public.sent_contacts.dispatched_at, now()),
    raw_payload = public.sent_contacts.raw_payload || excluded.raw_payload
  returning id into v_id;

  update public.leads
  set status = 'Enviada', current_status = 'sent', current_stage = 'archived', updated_at = now()
  where id = p_lead_id and user_id = p_user_id;

  return v_id;
end;
$$;

create or replace function public.seed_default_whatsapp_instances(target_user uuid)
returns void
language plpgsql
security definer
as $$
begin
  insert into public.whatsapp_instances(user_id, chip_id, label, name, instance, base_url, evolution_url, url, api_key, status, connection_state, active, daily_limit, block_size, interval_seconds, blocks)
  values
    (target_user, 'chip-8352', '8352', '8352', 'chip-8352', 'https://evolution.samuelvinsansi.com.br', 'https://evolution.samuelvinsansi.com.br', 'https://evolution.samuelvinsansi.com.br', 'vinsansi8352', 'open', 'connected', true, 120, 30, 120, '["08:00","10:00","12:00","14:00"]'),
    (target_user, 'chip-6846', '6846', '6846', 'chip-6846', 'https://evolution.samuelvinsansi.com.br', 'https://evolution.samuelvinsansi.com.br', 'https://evolution.samuelvinsansi.com.br', 'vinsansi6846', 'open', 'connected', true, 120, 30, 120, '["08:00","10:00","12:00","14:00"]'),
    (target_user, 'chip-8457', '8457', '8457', 'chip-8457', 'https://evolution.samuelvinsansi.com.br', 'https://evolution.samuelvinsansi.com.br', 'https://evolution.samuelvinsansi.com.br', 'vinsansi8457', 'saved', 'saved', true, 120, 30, 120, '["08:00","10:00","12:00","14:00"]')
  on conflict (user_id, instance) do nothing;
end;
$$;

create or replace function public.handle_new_user_seed()
returns trigger
language plpgsql
security definer
as $$
begin
  perform public.seed_default_whatsapp_instances(new.id);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_seed_whatsapp on auth.users;
create trigger on_auth_user_created_seed_whatsapp
after insert on auth.users
for each row execute function public.handle_new_user_seed();

do $$
declare u record;
begin
  for u in select id from auth.users loop
    perform public.seed_default_whatsapp_instances(u.id);
  end loop;
end $$;

alter table public.leads enable row level security;
alter table public.sent_contacts enable row level security;
alter table public.whatsapp_instances enable row level security;
alter table public.operational_data enable row level security;
alter table public.import_batches enable row level security;
alter table public.lead_imports enable row level security;
alter table public.dispatch_message_logs enable row level security;
alter table public.whatsapp_messages enable row level security;
alter table public.whatsapp_contact_map enable row level security;
alter table public.settings enable row level security;
alter table public.message_templates enable row level security;
alter table public.lead_notes enable row level security;
alter table public.lead_history enable row level security;
alter table public.lead_followups enable row level security;

create policy leads_own on public.leads for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy sent_contacts_own on public.sent_contacts for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy whatsapp_instances_own on public.whatsapp_instances for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy operational_data_own on public.operational_data for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy import_batches_own on public.import_batches for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy lead_imports_own on public.lead_imports for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy dispatch_message_logs_own on public.dispatch_message_logs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy whatsapp_messages_own on public.whatsapp_messages for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy whatsapp_contact_map_own on public.whatsapp_contact_map for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy settings_own on public.settings for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy message_templates_own on public.message_templates for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy lead_notes_own on public.lead_notes for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy lead_history_own on public.lead_history for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy lead_followups_own on public.lead_followups for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
