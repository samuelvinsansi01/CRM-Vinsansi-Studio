-- Lead Certo V2 - refatoracao final de Ramos.
-- Objetivo: separar ID tecnico (UUID), slug e nome de exibicao.
--
-- Regras:
-- - Nao apaga dados.
-- - Mantem identificadores textuais antigos em branches.legacy_id e message_templates.ramo_id.
-- - Preenche branch_id UUID nas tabelas que referenciam ramo.
-- - Cria backups locais no banco antes de alterar estrutura/dados.

begin;

create extension if not exists pgcrypto;

create table if not exists public.branches_backup_before_uuid_refactor_20260629 as
select * from public.branches;

create table if not exists public.message_templates_backup_before_branch_uuid_refactor_20260629 as
select * from public.message_templates;

create table if not exists public.leads_backup_before_branch_uuid_refactor_20260629 as
select * from public.leads;

create table if not exists public.pre_send_leads_backup_before_branch_uuid_refactor_20260629 as
select * from public.pre_send_leads;

create table if not exists public.pre_dispatch_items_backup_before_branch_uuid_refactor_20260629 as
select * from public.pre_dispatch_items;

create table if not exists public.instagram_dispatch_items_backup_before_branch_uuid_refactor_20260629 as
select * from public.instagram_dispatch_items;

create table if not exists public.base_permanente_backup_before_branch_uuid_refactor_20260629 as
select * from public.base_permanente;

create or replace function public.lead_certo_branch_slug(input text)
returns text
language sql
immutable
as $$
  select nullif(
    regexp_replace(
      regexp_replace(
        translate(
          lower(coalesce(input, '')),
          'áàãâäéèêëíìîïóòõôöúùûüçñÁÀÃÂÄÉÈÊËÍÌÎÏÓÒÕÔÖÚÙÛÜÇÑ',
          'aaaaaeeeeiiiiooooouuuucnaaaaaeeeeiiiiooooouuuucn'
        ),
        '[^a-z0-9]+',
        '-',
        'g'
      ),
      '(^-+|-+$)',
      '',
      'g'
    ),
    ''
  );
$$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'branches'
      and column_name = 'id'
      and data_type <> 'uuid'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'branches'
      and column_name = 'legacy_id'
  ) then
    alter table public.branches rename column id to legacy_id;
    alter table public.branches add column id uuid;
  end if;
end $$;

alter table public.branches add column if not exists id uuid;
alter table public.branches add column if not exists legacy_id text;
alter table public.branches add column if not exists slug text;
alter table public.branches add column if not exists name text;
alter table public.branches add column if not exists category text;
alter table public.branches add column if not exists subcategories jsonb;
alter table public.branches add column if not exists associated_categories jsonb;
alter table public.branches add column if not exists order_index integer;
alter table public.branches add column if not exists min_rating numeric;
alter table public.branches add column if not exists min_reviews integer;
alter table public.branches add column if not exists image_name text;
alter table public.branches alter column id set default gen_random_uuid();

update public.branches
set
  id = coalesce(id, gen_random_uuid()),
  legacy_id = nullif(coalesce(legacy_id, data->>'legacyId', data->>'id', slug, name, category), ''),
  name = nullif(coalesce(name, data->>'name', category, data->>'category', legacy_id), ''),
  category = nullif(coalesce(category, data->>'category', name), ''),
  slug = coalesce(nullif(slug, ''), public.lead_certo_branch_slug(coalesce(name, data->>'name', category, legacy_id))),
  subcategories = coalesce(subcategories, data->'subcategories', jsonb_build_array(coalesce(name, category, legacy_id))),
  associated_categories = coalesce(associated_categories, data->'associatedCategories', data->'associated_categories', jsonb_build_array(coalesce(category, name, legacy_id))),
  order_index = coalesce(order_index, nullif(data->>'order', '')::integer, 1),
  min_rating = coalesce(min_rating, nullif(data->>'minRating', '')::numeric, 4),
  min_reviews = coalesce(min_reviews, nullif(data->>'minReviews', '')::integer, 10),
  image_name = coalesce(image_name, data->>'imageName', ''),
  active = coalesce(active, true),
  status = coalesce(status, case when coalesce(active, true) then 'Ativo' else 'Inativo' end),
  kind = coalesce(kind, 'branches'),
  updated_at = now()
where id is null
   or legacy_id is null
   or slug is null
   or name is null
   or category is null
   or subcategories is null
   or associated_categories is null
   or order_index is null
   or min_rating is null
   or min_reviews is null
   or image_name is null;

update public.branches
set data = coalesce(data, '{}'::jsonb)
  || jsonb_build_object(
    'id', id,
    'legacyId', legacy_id,
    'slug', slug,
    'name', name,
    'category', category,
    'subcategories', subcategories,
    'associatedCategories', associated_categories,
    'order', order_index,
    'minRating', min_rating,
    'minReviews', min_reviews,
    'imageName', image_name,
    'active', active,
    'status', status,
    'kind', 'branches'
  );

alter table public.branches alter column id set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'branches_id_uuid_key'
      and conrelid = 'public.branches'::regclass
  ) then
    alter table public.branches add constraint branches_id_uuid_key unique (id);
  end if;
end $$;

alter table public.message_templates add column if not exists branch_id uuid;
alter table public.message_templates add column if not exists branch_name text;
alter table public.message_templates add column if not exists data jsonb;

update public.message_templates mt
set
  branch_id = b.id,
  branch_name = coalesce(nullif(mt.branch_name, ''), b.name),
  data = coalesce(mt.data, '{}'::jsonb)
    || jsonb_build_object('branchId', b.id, 'branchName', b.name, 'legacyRamoId', mt.ramo_id),
  updated_at = now()
from public.branches b
where mt.branch_id is null
  and (
    mt.ramo_id = b.legacy_id
    or mt.ramo_id = b.slug
    or public.lead_certo_branch_slug(mt.ramo_id) = b.slug
    or public.lead_certo_branch_slug(mt.branch_name) = b.slug
  );

alter table public.leads add column if not exists branch_id uuid;
alter table public.leads add column if not exists branch_name text;
alter table public.leads add column if not exists branch_slug text;

update public.leads l
set
  branch_id = b.id,
  branch_name = b.name,
  branch_slug = b.slug,
  raw_payload = coalesce(l.raw_payload, '{}'::jsonb) || jsonb_build_object('branch_id', b.id, 'branch_slug', b.slug, 'ramo', b.name),
  crm_data = coalesce(l.crm_data, '{}'::jsonb) || jsonb_build_object('branch_id', b.id, 'branch_slug', b.slug, 'ramo', b.name),
  updated_at = now()
from public.branches b
where l.branch_id is null
  and (
    public.lead_certo_branch_slug(l.parent_category) = b.slug
    or public.lead_certo_branch_slug(l.category) = b.slug
    or public.lead_certo_branch_slug(l.category_name) = b.slug
    or public.lead_certo_branch_slug(l.raw_payload->>'ramo') = b.slug
    or public.lead_certo_branch_slug(l.raw_payload->>'parent_category') = b.slug
  );

alter table public.pre_send_leads add column if not exists branch_id uuid;
alter table public.pre_send_leads add column if not exists branch_name text;
alter table public.pre_send_leads add column if not exists branch_slug text;

update public.pre_send_leads p
set
  branch_id = b.id,
  branch_name = b.name,
  branch_slug = b.slug,
  data = coalesce(p.data, '{}'::jsonb) || jsonb_build_object('branch_id', b.id, 'branch_slug', b.slug, 'branch', b.name),
  updated_at = now()
from public.branches b
where p.branch_id is null
  and public.lead_certo_branch_slug(p.data->>'branch') = b.slug;

alter table public.pre_dispatch_items add column if not exists branch_id uuid;
alter table public.pre_dispatch_items add column if not exists branch_name text;
alter table public.pre_dispatch_items add column if not exists branch_slug text;

update public.pre_dispatch_items p
set
  branch_id = b.id,
  branch_name = b.name,
  branch_slug = b.slug,
  raw_payload = coalesce(p.raw_payload, '{}'::jsonb) || jsonb_build_object('branch_id', b.id, 'branch_slug', b.slug, 'branch', b.name),
  updated_at = now()
from public.branches b
where p.branch_id is null
  and (
    public.lead_certo_branch_slug(p.parent_category) = b.slug
    or public.lead_certo_branch_slug(p.raw_payload->>'branch') = b.slug
  );

alter table public.instagram_dispatch_items add column if not exists branch_id uuid;
alter table public.instagram_dispatch_items add column if not exists branch_name text;
alter table public.instagram_dispatch_items add column if not exists branch_slug text;

update public.instagram_dispatch_items i
set
  branch_id = b.id,
  branch_name = b.name,
  branch_slug = b.slug,
  data = coalesce(i.data, '{}'::jsonb) || jsonb_build_object('branch_id', b.id, 'branch_slug', b.slug, 'branch', b.name),
  updated_at = now()
from public.branches b
where i.branch_id is null
  and (
    public.lead_certo_branch_slug(i.parent_category) = b.slug
    or public.lead_certo_branch_slug(i.data->>'branch') = b.slug
  );

alter table public.base_permanente add column if not exists branch_id uuid;
alter table public.base_permanente add column if not exists branch_name text;
alter table public.base_permanente add column if not exists branch_slug text;

update public.base_permanente bp
set
  branch_id = b.id,
  branch_name = b.name,
  branch_slug = b.slug,
  raw_payload = coalesce(bp.raw_payload, '{}'::jsonb) || jsonb_build_object('branch_id', b.id, 'branch_slug', b.slug, 'branch', b.name),
  updated_at = now()
from public.branches b
where bp.branch_id is null
  and (
    public.lead_certo_branch_slug(bp.category) = b.slug
    or public.lead_certo_branch_slug(bp.category_name) = b.slug
    or public.lead_certo_branch_slug(bp.raw_payload->>'branch') = b.slug
    or public.lead_certo_branch_slug(bp.raw_payload->>'ramo') = b.slug
  );

create unique index if not exists branches_slug_user_unique_idx on public.branches(user_id, slug);
create index if not exists branches_legacy_id_idx on public.branches(legacy_id);
create index if not exists message_templates_branch_id_idx on public.message_templates(branch_id);
create index if not exists leads_branch_id_idx on public.leads(branch_id);
create index if not exists pre_send_leads_branch_id_idx on public.pre_send_leads(branch_id);
create index if not exists pre_dispatch_items_branch_id_idx on public.pre_dispatch_items(branch_id);
create index if not exists instagram_dispatch_items_branch_id_idx on public.instagram_dispatch_items(branch_id);
create index if not exists base_permanente_branch_id_idx on public.base_permanente(branch_id);

commit;
