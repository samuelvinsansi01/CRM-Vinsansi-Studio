create index if not exists idx_apify_import_jobs_branch_status_location
  on public.apify_import_jobs (branches_id, status, location_query);
