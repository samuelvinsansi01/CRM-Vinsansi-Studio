-- Patch de compatibilidade para a V30 salvar leads/chips corretamente no Supabase.
-- Rode depois do SQL principal, sem apagar sent_contacts.

alter table public.leads add column if not exists instagram text;
alter table public.leads add column if not exists status text;
alter table public.leads add column if not exists pipeline_status text;
alter table public.leads add column if not exists crm_data jsonb default '{}'::jsonb;
alter table public.leads add column if not exists maps_url text;
alter table public.leads add column if not exists user_email text;
alter table public.leads add column if not exists updated_at timestamptz default now();
alter table public.leads add column if not exists current_status text default 'new';
alter table public.leads add column if not exists current_stage text default 'imported';
alter table public.leads add column if not exists raw_payload jsonb default '{}'::jsonb;

alter table public.whatsapp_messages add column if not exists read_at timestamptz;
alter table public.whatsapp_messages add column if not exists phone_normalized text;

-- O front antigo pode salvar temporariamente chip incompleto; não pode quebrar a tela/importação.
alter table public.whatsapp_instances alter column api_key drop not null;

notify pgrst, 'reload schema';

-- Compat extra para importação direta da V30
alter table public.leads add column if not exists category text;
alter table public.leads add column if not exists rating numeric;
alter table public.leads add column if not exists reviews_count int;
alter table public.leads add column if not exists has_own_site boolean default false;
alter table public.leads add column if not exists lead_channel text default 'whatsapp';
alter table public.leads add column if not exists lead_type text default 'sem-site';
alter table public.leads add column if not exists instagram_url text;

notify pgrst, 'reload schema';


-- PATCH V30 localStorage/duplicação/importação
alter table public.leads add column if not exists instagram text;
alter table public.leads add column if not exists instagram_url text;
alter table public.leads add column if not exists status text;
alter table public.leads add column if not exists current_status text default 'new';
alter table public.leads add column if not exists current_stage text default 'validation';
alter table public.leads add column if not exists lead_channel text default 'whatsapp';
alter table public.leads add column if not exists lead_type text;
alter table public.leads add column if not exists pipeline_status text;
alter table public.leads add column if not exists crm_data jsonb default '{}'::jsonb;
alter table public.leads add column if not exists maps_url text;
alter table public.leads add column if not exists raw_payload jsonb default '{}'::jsonb;
alter table public.leads add column if not exists updated_at timestamptz default now();

alter table public.whatsapp_instances add column if not exists user_email text;
alter table public.whatsapp_instances add column if not exists chip_id text;
alter table public.whatsapp_instances add column if not exists label text;
alter table public.whatsapp_instances add column if not exists name text;
alter table public.whatsapp_instances add column if not exists base_url text default 'https://evolution.samuelvinsansi.com.br';
alter table public.whatsapp_instances add column if not exists evolution_url text default 'https://evolution.samuelvinsansi.com.br';
alter table public.whatsapp_instances add column if not exists url text default 'https://evolution.samuelvinsansi.com.br';
alter table public.whatsapp_instances add column if not exists api_key text;
alter table public.whatsapp_instances add column if not exists status text default 'saved';
alter table public.whatsapp_instances add column if not exists connection_state text default 'saved';
alter table public.whatsapp_instances add column if not exists daily_limit int default 120;
alter table public.whatsapp_instances add column if not exists block_size int default 30;
alter table public.whatsapp_instances add column if not exists interval_seconds int default 120;
alter table public.whatsapp_instances add column if not exists blocks jsonb default '["08:00","10:00","12:00","14:00"]'::jsonb;
alter table public.whatsapp_instances alter column api_key drop not null;

-- remove duplicados de chip, mantendo o mais recente por usuario+instancia
with ranked as (
  select id, row_number() over (partition by user_id, instance order by updated_at desc nulls last, created_at desc nulls last, id desc) as rn
  from public.whatsapp_instances
)
delete from public.whatsapp_instances wi
using ranked r
where wi.id = r.id and r.rn > 1;

notify pgrst, 'reload schema';
