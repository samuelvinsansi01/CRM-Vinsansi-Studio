-- Conclusão do Fluxo 2: controle idempotente da leitura e importação do dataset.
alter table public.apify_import_jobs
  add column if not exists total_imported integer not null default 0,
  add column if not exists total_duplicates integer not null default 0,
  add column if not exists total_rejected integer not null default 0,
  add column if not exists imported_at timestamptz;

alter table public.apify_import_jobs
  drop constraint if exists apify_import_jobs_total_imported_nonnegative,
  drop constraint if exists apify_import_jobs_total_duplicates_nonnegative,
  drop constraint if exists apify_import_jobs_total_rejected_nonnegative;

alter table public.apify_import_jobs
  add constraint apify_import_jobs_total_imported_nonnegative check (total_imported >= 0),
  add constraint apify_import_jobs_total_duplicates_nonnegative check (total_duplicates >= 0),
  add constraint apify_import_jobs_total_rejected_nonnegative check (total_rejected >= 0);

create index if not exists apify_import_jobs_pending_import_idx
  on public.apify_import_jobs (users_id, status, imported_at)
  where status = 'succeeded' and imported_at is null;
