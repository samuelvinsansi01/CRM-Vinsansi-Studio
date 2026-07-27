alter table public.apify_import_jobs
  add column if not exists branches_id bigint null references public.branches(branches_id),
  add column if not exists branch_name text null;

create index if not exists apify_import_jobs_branches_id_idx
  on public.apify_import_jobs(branches_id);
