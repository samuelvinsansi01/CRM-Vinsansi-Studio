-- Alinha os jobs da Apify ao catálogo numérico de status já usado pela plataforma.

alter table public.apify_import_jobs
  add column if not exists apify_job_status_id bigint;

update public.apify_import_jobs
set apify_job_status_id = case
  when status in ('starting', 'ready') then 3
  when status = 'running' then 4
  when status = 'succeeded' then 5
  when status in ('failed', 'timed_out') then 6
  when status = 'aborted' then 7
  else 3
end
where apify_job_status_id is null;

alter table public.apify_import_jobs
  alter column apify_job_status_id set default 3;

alter table public.apify_import_jobs
  alter column apify_job_status_id set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'apify_import_jobs_apify_job_status_id_fkey'
      and conrelid = 'public.apify_import_jobs'::regclass
  ) then
    alter table public.apify_import_jobs
      add constraint apify_import_jobs_apify_job_status_id_fkey
      foreign key (apify_job_status_id)
      references public.status(status_id);
  end if;
end
$$;

create index if not exists apify_import_jobs_status_idx
  on public.apify_import_jobs (apify_job_status_id, created_at desc);
