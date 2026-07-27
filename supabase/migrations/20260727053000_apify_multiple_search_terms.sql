begin;

alter table public.apify_import_jobs
  add column if not exists search_terms jsonb not null default '[]'::jsonb;

update public.apify_import_jobs
set search_terms = jsonb_build_array(search_query)
where search_terms = '[]'::jsonb
  and nullif(trim(search_query), '') is not null;

alter table public.apify_import_jobs
  drop constraint if exists apify_import_jobs_search_terms_array_check;

alter table public.apify_import_jobs
  add constraint apify_import_jobs_search_terms_array_check
  check (jsonb_typeof(search_terms) = 'array');

commit;
