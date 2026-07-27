-- Fluxo 2 / etapa 2: execuções manuais do Google Maps Extractor.

alter table public.apify_import_jobs
  add column if not exists users_id bigint references public.users(users_id),
  add column if not exists apify_accounts_id bigint references public.apify_accounts(apify_accounts_id),
  add column if not exists actor_id text not null default 'compass/google-maps-extractor',
  add column if not exists external_run_id text,
  add column if not exists external_dataset_id text,
  add column if not exists search_query text,
  add column if not exists location_query text,
  add column if not exists requested_limit integer,
  add column if not exists status text not null default 'starting',
  add column if not exists total_received integer not null default 0,
  add column if not exists error_message text,
  add column if not exists started_at timestamptz not null default now(),
  add column if not exists finished_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.apify_import_jobs
  drop constraint if exists apify_import_jobs_status_check;

alter table public.apify_import_jobs
  add constraint apify_import_jobs_status_check
  check (status in ('starting', 'ready', 'running', 'succeeded', 'failed', 'aborted', 'timed_out'));

create unique index if not exists apify_import_jobs_external_run_uidx
  on public.apify_import_jobs (external_run_id)
  where external_run_id is not null;

create index if not exists apify_import_jobs_user_created_idx
  on public.apify_import_jobs (users_id, created_at desc);

alter table public.apify_import_jobs enable row level security;

drop policy if exists apify_import_jobs_select_own on public.apify_import_jobs;
create policy apify_import_jobs_select_own
on public.apify_import_jobs
for select
to authenticated
using (users_id = public.ensure_current_user());

-- A criação e atualização dos jobs ocorre apenas pela Edge Function com service role.
drop policy if exists apify_import_jobs_insert_own on public.apify_import_jobs;
drop policy if exists apify_import_jobs_update_own on public.apify_import_jobs;
drop policy if exists apify_import_jobs_delete_own on public.apify_import_jobs;
