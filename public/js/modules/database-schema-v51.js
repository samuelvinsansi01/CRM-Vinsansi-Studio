window.V51_DATABASE_REAL_SQL = `
create extension if not exists pgcrypto;

create table if not exists public.crm_leads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lead_id text not null,
  source text not null default 'permanent',
  status text not null default '',
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, source, lead_id)
);

create table if not exists public.crm_queue_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  queue_type text not null,
  bucket text not null default '',
  lead_id text not null,
  position integer not null default 0,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.crm_dispatch_queues (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  chip_id text not null,
  lead_id text not null,
  position integer not null default 0,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.crm_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null,
  value jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, key)
);

create table if not exists public.crm_sent_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ledger_key text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, ledger_key)
);

create table if not exists public.crm_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lead_id text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, lead_id)
);

create index if not exists crm_leads_user_source_idx on public.crm_leads(user_id, source);
create index if not exists crm_queue_items_user_type_idx on public.crm_queue_items(user_id, queue_type, position);
create index if not exists crm_dispatch_queues_user_chip_idx on public.crm_dispatch_queues(user_id, chip_id, position);
create index if not exists crm_settings_user_key_idx on public.crm_settings(user_id, key);
create index if not exists crm_sent_ledger_user_key_idx on public.crm_sent_ledger(user_id, ledger_key);
create index if not exists crm_notes_user_lead_idx on public.crm_notes(user_id, lead_id);

alter table public.crm_leads enable row level security;
alter table public.crm_queue_items enable row level security;
alter table public.crm_dispatch_queues enable row level security;
alter table public.crm_settings enable row level security;
alter table public.crm_sent_ledger enable row level security;
alter table public.crm_notes enable row level security;

create policy "crm_leads_select_own" on public.crm_leads for select using (auth.uid() = user_id);
create policy "crm_leads_insert_own" on public.crm_leads for insert with check (auth.uid() = user_id);
create policy "crm_leads_update_own" on public.crm_leads for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "crm_leads_delete_own" on public.crm_leads for delete using (auth.uid() = user_id);

create policy "crm_queue_items_select_own" on public.crm_queue_items for select using (auth.uid() = user_id);
create policy "crm_queue_items_insert_own" on public.crm_queue_items for insert with check (auth.uid() = user_id);
create policy "crm_queue_items_update_own" on public.crm_queue_items for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "crm_queue_items_delete_own" on public.crm_queue_items for delete using (auth.uid() = user_id);

create policy "crm_dispatch_queues_select_own" on public.crm_dispatch_queues for select using (auth.uid() = user_id);
create policy "crm_dispatch_queues_insert_own" on public.crm_dispatch_queues for insert with check (auth.uid() = user_id);
create policy "crm_dispatch_queues_update_own" on public.crm_dispatch_queues for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "crm_dispatch_queues_delete_own" on public.crm_dispatch_queues for delete using (auth.uid() = user_id);

create policy "crm_settings_select_own" on public.crm_settings for select using (auth.uid() = user_id);
create policy "crm_settings_insert_own" on public.crm_settings for insert with check (auth.uid() = user_id);
create policy "crm_settings_update_own" on public.crm_settings for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "crm_settings_delete_own" on public.crm_settings for delete using (auth.uid() = user_id);

create policy "crm_sent_ledger_select_own" on public.crm_sent_ledger for select using (auth.uid() = user_id);
create policy "crm_sent_ledger_insert_own" on public.crm_sent_ledger for insert with check (auth.uid() = user_id);
create policy "crm_sent_ledger_update_own" on public.crm_sent_ledger for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "crm_sent_ledger_delete_own" on public.crm_sent_ledger for delete using (auth.uid() = user_id);

create policy "crm_notes_select_own" on public.crm_notes for select using (auth.uid() = user_id);
create policy "crm_notes_insert_own" on public.crm_notes for insert with check (auth.uid() = user_id);
create policy "crm_notes_update_own" on public.crm_notes for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "crm_notes_delete_own" on public.crm_notes for delete using (auth.uid() = user_id);
`;
