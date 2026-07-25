-- Lead Certo V2 - migration incremental segura para banco existente.
-- Baseada em C:/Users/Samuel/Desktop/estrutura.txt.
--
-- Regras desta migration:
-- - Apenas adiciona estruturas ausentes.
-- - Reaproveita tabelas reais existentes sempre que ha equivalente.
-- - Corrige a compatibilidade usando normalized_phone em sent_contacts/base/leads.

create table if not exists public.branches (
  id text primary key,
  user_id uuid,
  data jsonb not null default '{}'::jsonb,
  image_name text,
  status text,
  active boolean,
  kind text default 'branches',
  channel text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pre_send_leads (
  id text primary key,
  user_id uuid,
  data jsonb not null default '{}'::jsonb,
  status text,
  active boolean,
  kind text default 'pre_send_leads',
  channel text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.leads add column if not exists data jsonb;
alter table public.leads add column if not exists active boolean;
alter table public.leads add column if not exists kind text;
alter table public.leads add column if not exists channel text;
alter table public.leads add column if not exists original_destination text;
alter table public.leads add column if not exists destination text;
alter table public.leads add column if not exists destination_override text;
alter table public.leads add column if not exists send_instagram boolean;
alter table public.leads add column if not exists instagram_override_reason text;
alter table public.leads add column if not exists override_by text;
alter table public.leads add column if not exists override_at timestamptz;
alter table public.branches add column if not exists image_name text;

alter table public.base_permanente add column if not exists data jsonb;
alter table public.base_permanente add column if not exists active boolean;
alter table public.base_permanente add column if not exists kind text;
alter table public.base_permanente add column if not exists channel text;
alter table public.base_permanente add column if not exists sent_at timestamptz;
alter table public.base_permanente add column if not exists original_destination text;
alter table public.base_permanente add column if not exists destination text;
alter table public.base_permanente add column if not exists destination_override text;
alter table public.base_permanente add column if not exists send_instagram boolean;
alter table public.base_permanente add column if not exists instagram_override_reason text;
alter table public.base_permanente add column if not exists override_by text;
alter table public.base_permanente add column if not exists override_at timestamptz;

alter table public.sent_contacts add column if not exists data jsonb;
alter table public.sent_contacts add column if not exists site_normalized text;
alter table public.sent_contacts add column if not exists instagram_username text;
alter table public.sent_contacts add column if not exists maps_url text;
alter table public.sent_contacts add column if not exists sent_at timestamptz;
alter table public.sent_contacts add column if not exists updated_at timestamptz;

alter table public.pre_dispatch_items add column if not exists data jsonb;
alter table public.pre_dispatch_items add column if not exists active boolean;
alter table public.pre_dispatch_items add column if not exists kind text;
alter table public.pre_dispatch_items add column if not exists channel text;
alter table public.pre_dispatch_items add column if not exists batch_id text;
alter table public.pre_dispatch_items add column if not exists batch_number integer;
alter table public.pre_dispatch_items add column if not exists company_name text;
alter table public.pre_dispatch_items add column if not exists phone text;
alter table public.pre_dispatch_items add column if not exists normalized_phone text;
alter table public.pre_dispatch_items add column if not exists phone_normalized text;
alter table public.pre_dispatch_items add column if not exists parent_category text;
alter table public.pre_dispatch_items add column if not exists destination text;
alter table public.pre_dispatch_items add column if not exists original_destination text;
alter table public.pre_dispatch_items add column if not exists destination_override text;
alter table public.pre_dispatch_items add column if not exists send_instagram boolean;
alter table public.pre_dispatch_items add column if not exists instagram_url text;
alter table public.pre_dispatch_items add column if not exists instagram_username text;
alter table public.pre_dispatch_items add column if not exists instagram_override_reason text;
alter table public.pre_dispatch_items add column if not exists override_by text;
alter table public.pre_dispatch_items add column if not exists override_at timestamptz;
alter table public.pre_dispatch_items add column if not exists chip_id uuid;
alter table public.pre_dispatch_items add column if not exists template_id uuid;
alter table public.pre_dispatch_items add column if not exists message_1 text;
alter table public.pre_dispatch_items add column if not exists message_2 text;
alter table public.pre_dispatch_items add column if not exists image_url text;
alter table public.pre_dispatch_items add column if not exists image_id text;
alter table public.pre_dispatch_items add column if not exists retry_count integer;
alter table public.pre_dispatch_items add column if not exists error_message text;
alter table public.pre_dispatch_items add column if not exists sent_at timestamptz;

alter table public.instagram_dispatch_items add column if not exists data jsonb;
alter table public.instagram_dispatch_items add column if not exists active boolean;
alter table public.instagram_dispatch_items add column if not exists kind text;
alter table public.instagram_dispatch_items add column if not exists channel text;
alter table public.instagram_dispatch_items add column if not exists batch_id text;
alter table public.instagram_dispatch_items add column if not exists batch_number integer;
alter table public.instagram_dispatch_items add column if not exists destination text;
alter table public.instagram_dispatch_items add column if not exists original_destination text;
alter table public.instagram_dispatch_items add column if not exists destination_override text;
alter table public.instagram_dispatch_items add column if not exists send_instagram boolean;
alter table public.instagram_dispatch_items add column if not exists instagram_override_reason text;
alter table public.instagram_dispatch_items add column if not exists override_by text;
alter table public.instagram_dispatch_items add column if not exists override_at timestamptz;
alter table public.instagram_dispatch_items add column if not exists phone text;
alter table public.instagram_dispatch_items add column if not exists normalized_phone text;
alter table public.instagram_dispatch_items add column if not exists phone_normalized text;
alter table public.instagram_dispatch_items add column if not exists chip_id uuid;
alter table public.instagram_dispatch_items add column if not exists image_id text;
alter table public.instagram_dispatch_items add column if not exists retry_count integer;

alter table public.whatsapp_instances add column if not exists data jsonb;
alter table public.whatsapp_instances add column if not exists kind text;
alter table public.whatsapp_instances add column if not exists channel text;
alter table public.whatsapp_instances add column if not exists priority integer;
alter table public.whatsapp_instances add column if not exists start_time text;
alter table public.whatsapp_instances add column if not exists end_time text;
alter table public.whatsapp_instances add column if not exists paused boolean;

alter table public.message_templates add column if not exists data jsonb;
alter table public.message_templates add column if not exists status text;
alter table public.message_templates add column if not exists kind text;
alter table public.message_templates add column if not exists channel text;
alter table public.message_templates add column if not exists branch_name text;
alter table public.message_templates add column if not exists type text;
alter table public.message_templates add column if not exists variables jsonb;

alter table public.settings add column if not exists data jsonb;
alter table public.settings add column if not exists status text;
alter table public.settings add column if not exists active boolean;
alter table public.settings add column if not exists kind text;
alter table public.settings add column if not exists channel text;

alter table public.contact_events add column if not exists data jsonb;
alter table public.contact_events add column if not exists source text;
alter table public.contact_events add column if not exists action text;
alter table public.contact_events add column if not exists active boolean;
alter table public.contact_events add column if not exists kind text;
alter table public.contact_events add column if not exists queue_item_id text;
alter table public.contact_events add column if not exists updated_at timestamptz;

create index if not exists branches_status_idx on public.branches(status);
create index if not exists branches_active_idx on public.branches(active);
create index if not exists pre_send_leads_status_idx on public.pre_send_leads(status);
create index if not exists pre_send_leads_channel_idx on public.pre_send_leads(channel);

create index if not exists leads_status_idx on public.leads(status);
create index if not exists leads_normalized_phone_idx on public.leads(normalized_phone);
create index if not exists leads_instagram_username_idx on public.leads(instagram_username);
create index if not exists leads_maps_url_idx on public.leads(maps_url);

create index if not exists base_permanente_status_idx on public.base_permanente(status);
create index if not exists base_permanente_normalized_phone_idx on public.base_permanente(normalized_phone);
create index if not exists base_permanente_instagram_username_idx on public.base_permanente(instagram_username);
create index if not exists base_permanente_maps_url_idx on public.base_permanente(maps_url);

create index if not exists sent_contacts_normalized_phone_idx on public.sent_contacts(normalized_phone);
create index if not exists sent_contacts_instagram_username_idx on public.sent_contacts(instagram_username);
create index if not exists sent_contacts_maps_url_idx on public.sent_contacts(maps_url);

create index if not exists pre_dispatch_items_status_idx on public.pre_dispatch_items(status);
create index if not exists pre_dispatch_items_worker_idx on public.pre_dispatch_items(status, scheduled_date, position);
create index if not exists pre_dispatch_items_normalized_phone_idx on public.pre_dispatch_items(normalized_phone);
create index if not exists pre_dispatch_items_phone_normalized_idx on public.pre_dispatch_items(phone_normalized);
create index if not exists pre_dispatch_items_batch_idx on public.pre_dispatch_items(batch_id, batch_number);

create index if not exists instagram_dispatch_items_status_idx on public.instagram_dispatch_items(status);
create index if not exists instagram_dispatch_items_worker_idx on public.instagram_dispatch_items(status, scheduled_date, block_number, position);
create index if not exists instagram_dispatch_items_username_idx on public.instagram_dispatch_items(instagram_username);
create index if not exists instagram_dispatch_items_batch_idx on public.instagram_dispatch_items(batch_id, batch_number);

create index if not exists whatsapp_instances_status_idx on public.whatsapp_instances(status);
create index if not exists whatsapp_instances_active_idx on public.whatsapp_instances(active);
create index if not exists whatsapp_instances_instance_idx on public.whatsapp_instances(instance);

create index if not exists message_templates_active_idx on public.message_templates(active);
create index if not exists message_templates_type_idx on public.message_templates(template_type);
create index if not exists message_templates_ramo_idx on public.message_templates(ramo_id);

create index if not exists settings_key_idx on public.settings(key);
create index if not exists contact_events_source_idx on public.contact_events(source);
create index if not exists contact_events_channel_idx on public.contact_events(channel);
create index if not exists contact_events_status_idx on public.contact_events(status);
create index if not exists contact_events_created_at_idx on public.contact_events(created_at desc);
