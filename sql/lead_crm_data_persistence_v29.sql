-- V29 - reforço de persistência da ficha do lead
alter table if exists leads add column if not exists crm_data jsonb;
alter table if exists leads add column if not exists user_email text;
alter table if exists leads add column if not exists pipeline_status text;
alter table if exists leads add column if not exists maps_url text;

create index if not exists idx_leads_user_id_id on leads(user_id, id);
create index if not exists idx_leads_user_email on leads(user_email);
