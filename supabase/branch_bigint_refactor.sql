-- Lead Certo V2 - refatoracao final de Ramos para ID numerico.
-- Data: 2026-06-29
--
-- Versao corrigida para Supabase SQL Editor:
-- - Nao usa TEMP TABLE.
-- - Nao usa tabela auxiliar de mapa.
-- - Nao apaga dados reais.
-- - Preserva UUID/texto antigo em colunas *_before_bigint.
-- - Mantem backups e SELECTs de pre/pos-validacao.

begin;

select 'PRE branches' as etapa, pg_typeof(id)::text as id_type, count(*) as total
from public.branches
group by pg_typeof(id)::text;

select 'PRE branch_id columns' as etapa, table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name in ('message_templates', 'leads', 'pre_send_leads', 'pre_dispatch_items', 'instagram_dispatch_items', 'base_permanente')
  and column_name = 'branch_id'
order by table_name;

create table if not exists public.branches_backup_before_bigint_refactor_20260629 as
select * from public.branches;

create table if not exists public.message_templates_backup_before_branch_bigint_refactor_20260629 as
select * from public.message_templates;

create table if not exists public.leads_backup_before_branch_bigint_refactor_20260629 as
select * from public.leads;

create table if not exists public.pre_send_leads_backup_before_branch_bigint_refactor_20260629 as
select * from public.pre_send_leads;

create table if not exists public.pre_dispatch_items_backup_before_branch_bigint_refactor_20260629 as
select * from public.pre_dispatch_items;

create table if not exists public.instagram_dispatch_items_backup_before_branch_bigint_refactor_20260629 as
select * from public.instagram_dispatch_items;

create table if not exists public.base_permanente_backup_before_branch_bigint_refactor_20260629 as
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
          'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN'
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
declare
  id_type text;
  constraint_name text;
begin
  select data_type into id_type
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'branches'
    and column_name = 'id';

  if id_type is distinct from 'bigint' then
    alter table public.branches alter column id drop default;

    if not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'branches'
        and column_name = 'uuid_before_bigint'
    ) then
      alter table public.branches rename column id to uuid_before_bigint;
    end if;

    alter table public.branches add column if not exists id bigint;

    for constraint_name in
      select conname
      from pg_constraint
      where conrelid = 'public.branches'::regclass
        and contype = 'p'
    loop
      execute format('alter table public.branches drop constraint if exists %I', constraint_name);
    end loop;

    if exists (
      select 1
      from pg_constraint
      where conrelid = 'public.branches'::regclass
        and conname = 'branches_id_uuid_key'
    ) then
      alter table public.branches drop constraint branches_id_uuid_key;
    end if;
  end if;
end $$;

alter table public.branches add column if not exists uuid_before_bigint text;
alter table public.branches alter column uuid_before_bigint drop not null;
alter table public.branches alter column uuid_before_bigint drop default;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'branches'
      and column_name = 'legacy_id'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'branches'
      and column_name = 'legacy_text_before_bigint'
  ) then
    alter table public.branches rename column legacy_id to legacy_text_before_bigint;
  end if;
end $$;

alter table public.branches add column if not exists legacy_text_before_bigint text;
alter table public.branches alter column legacy_text_before_bigint drop not null;
alter table public.branches alter column legacy_text_before_bigint drop default;
alter table public.branches add column if not exists slug text;
alter table public.branches add column if not exists name text;
alter table public.branches add column if not exists category text;
alter table public.branches add column if not exists subcategories jsonb;
alter table public.branches add column if not exists associated_categories jsonb;
alter table public.branches add column if not exists order_index integer;
alter table public.branches add column if not exists min_rating numeric;
alter table public.branches add column if not exists min_reviews integer;
alter table public.branches add column if not exists image_name text;
alter table public.branches add column if not exists data jsonb;
alter table public.branches add column if not exists active boolean;
alter table public.branches add column if not exists status text;
alter table public.branches add column if not exists kind text;
alter table public.branches add column if not exists updated_at timestamptz;

update public.branches b
set id = ranked.new_id
from (
  select
    ctid,
    row_number() over (
      order by
        case when coalesce(slug, public.lead_certo_branch_slug(name), public.lead_certo_branch_slug(category)) = 'moveis-planejados' then 0 else 1 end,
        coalesce(order_index, 999999),
        coalesce(slug, public.lead_certo_branch_slug(name), public.lead_certo_branch_slug(category), uuid_before_bigint::text, name),
        uuid_before_bigint::text
    )::bigint as new_id
  from public.branches
  where id is null
) ranked
where b.ctid = ranked.ctid;

update public.branches
set
  slug = coalesce(nullif(slug, ''), public.lead_certo_branch_slug(coalesce(name, category, data->>'name', legacy_text_before_bigint, uuid_before_bigint::text))),
  name = coalesce(nullif(name, ''), data->>'name', category, legacy_text_before_bigint, 'Novo ramo'),
  category = coalesce(nullif(category, ''), name, data->>'category', 'Novo ramo'),
  subcategories = coalesce(subcategories, data->'subcategories', jsonb_build_array(coalesce(name, category, legacy_text_before_bigint, 'Novo ramo'))),
  associated_categories = coalesce(associated_categories, data->'associatedCategories', data->'associated_categories', jsonb_build_array(coalesce(category, name, legacy_text_before_bigint, 'Novo ramo'))),
  order_index = coalesce(order_index, case when (data->>'order') ~ '^\d+$' then (data->>'order')::integer end, 1),
  min_rating = coalesce(min_rating, case when (data->>'minRating') ~ '^\d+([.,]\d+)?$' then replace(data->>'minRating', ',', '.')::numeric end, 4),
  min_reviews = coalesce(min_reviews, case when (data->>'minReviews') ~ '^\d+$' then (data->>'minReviews')::integer end, 10),
  image_name = coalesce(image_name, data->>'imageName', ''),
  active = coalesce(active, true),
  status = coalesce(nullif(status, ''), case when coalesce(active, true) then 'Ativo' else 'Inativo' end),
  kind = coalesce(nullif(kind, ''), 'branches'),
  updated_at = now();

update public.branches
set data = (coalesce(data, '{}'::jsonb) - 'legacyId')
  || jsonb_build_object(
    'id', id::text,
    'slug', slug,
    'name', name,
    'category', category,
    'subcategories', coalesce(subcategories, '[]'::jsonb),
    'associatedCategories', coalesce(associated_categories, '[]'::jsonb),
    'order', coalesce(order_index, 1),
    'minRating', coalesce(min_rating, 4),
    'minReviews', coalesce(min_reviews, 10),
    'imageName', coalesce(image_name, ''),
    'active', active,
    'status', status,
    'kind', 'branches'
  );

create sequence if not exists public.branches_id_seq as bigint;
select setval('public.branches_id_seq', greatest(coalesce((select max(id) from public.branches), 0), 1), true);
alter table public.branches alter column id set default nextval('public.branches_id_seq'::regclass);
alter sequence public.branches_id_seq owned by public.branches.id;
alter table public.branches alter column id set not null;

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select conname
    from pg_constraint
    where conrelid = 'public.branches'::regclass
      and contype = 'p'
      and pg_get_constraintdef(oid) not ilike '%(id)%'
  loop
    execute format('alter table public.branches drop constraint if exists %I', constraint_name);
  end loop;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.branches'::regclass
      and contype = 'p'
      and pg_get_constraintdef(oid) ilike '%(id)%'
  ) then
    alter table public.branches add constraint branches_pkey primary key (id);
  end if;
end $$;

create unique index if not exists branches_slug_unique_idx on public.branches(slug) where slug is not null;
create unique index if not exists branches_user_slug_unique_idx on public.branches(user_id, slug) where slug is not null;
create unique index if not exists branches_uuid_before_bigint_idx on public.branches(uuid_before_bigint) where uuid_before_bigint is not null;

create or replace function public.lead_certo_prepare_branch_bigint_column(target_table text)
returns void
language plpgsql
as $$
declare
  current_type text;
begin
  select data_type into current_type
  from information_schema.columns
  where table_schema = 'public'
    and table_name = target_table
    and column_name = 'branch_id';

  if current_type is null then
    execute format('alter table public.%I add column branch_id bigint', target_table);
  elsif current_type <> 'bigint' then
    if not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = target_table
        and column_name = 'branch_id_before_bigint'
    ) then
      execute format('alter table public.%I rename column branch_id to branch_id_before_bigint', target_table);
    else
      execute format('alter table public.%I rename column branch_id to branch_id_before_bigint_20260629', target_table);
    end if;
    execute format('alter table public.%I add column branch_id bigint', target_table);
  end if;
end;
$$;

select public.lead_certo_prepare_branch_bigint_column('message_templates');
select public.lead_certo_prepare_branch_bigint_column('leads');
select public.lead_certo_prepare_branch_bigint_column('pre_send_leads');
select public.lead_certo_prepare_branch_bigint_column('pre_dispatch_items');
select public.lead_certo_prepare_branch_bigint_column('instagram_dispatch_items');
select public.lead_certo_prepare_branch_bigint_column('base_permanente');

alter table public.message_templates add column if not exists branch_id_before_bigint text;
alter table public.leads add column if not exists branch_id_before_bigint text;
alter table public.pre_send_leads add column if not exists branch_id_before_bigint text;
alter table public.pre_dispatch_items add column if not exists branch_id_before_bigint text;
alter table public.instagram_dispatch_items add column if not exists branch_id_before_bigint text;
alter table public.base_permanente add column if not exists branch_id_before_bigint text;

alter table public.message_templates add column if not exists branch_name text;
alter table public.message_templates add column if not exists data jsonb;

update public.message_templates mt
set
  branch_id = b.id,
  branch_name = coalesce(nullif(mt.branch_name, ''), b.name),
  ramo_id = null,
  data = (coalesce(mt.data, '{}'::jsonb) - 'legacyRamoId')
    || jsonb_build_object('branchId', b.id::text, 'branchName', b.name, 'branchSlug', b.slug),
  updated_at = now()
from public.branches b
where mt.branch_id is null
  and (
    mt.branch_id_before_bigint::text = b.uuid_before_bigint::text
    or mt.data->>'branchId' = b.uuid_before_bigint::text
    or mt.data->>'branchId' = b.id::text
    or public.lead_certo_branch_slug(mt.ramo_id) = b.slug
    or public.lead_certo_branch_slug(mt.branch_name) = b.slug
    or public.lead_certo_branch_slug(mt.ramo_id) = public.lead_certo_branch_slug(b.legacy_text_before_bigint)
  );

alter table public.leads add column if not exists branch_name text;
alter table public.leads add column if not exists branch_slug text;

update public.leads l
set
  branch_id = b.id,
  branch_name = coalesce(nullif(l.branch_name, ''), b.name),
  branch_slug = coalesce(nullif(l.branch_slug, ''), b.slug),
  raw_payload = coalesce(l.raw_payload, '{}'::jsonb) || jsonb_build_object('branch_id', b.id::text, 'branch_slug', b.slug, 'ramo', b.name, 'original_category', coalesce(l.category_name, l.category, l.parent_category)),
  crm_data = coalesce(l.crm_data, '{}'::jsonb) || jsonb_build_object('branch_id', b.id::text, 'branch_slug', b.slug, 'ramo', b.name),
  data = coalesce(l.data, '{}'::jsonb) || jsonb_build_object('branch_id', b.id::text, 'branch_slug', b.slug, 'ramo', b.name),
  updated_at = now()
from public.branches b
where l.branch_id is null
  and (
    l.branch_id_before_bigint::text = b.uuid_before_bigint::text
    or l.raw_payload->>'branch_id' = b.uuid_before_bigint::text
    or l.raw_payload->>'branch_id' = b.id::text
    or l.crm_data->>'branch_id' = b.uuid_before_bigint::text
    or l.crm_data->>'branch_id' = b.id::text
    or public.lead_certo_branch_slug(l.branch_slug) = b.slug
    or public.lead_certo_branch_slug(l.branch_name) = b.slug
    or public.lead_certo_branch_slug(l.parent_category) = b.slug
    or public.lead_certo_branch_slug(l.category) = b.slug
    or public.lead_certo_branch_slug(l.category_name) = b.slug
    or public.lead_certo_branch_slug(l.raw_payload->>'ramo') = b.slug
    or public.lead_certo_branch_slug(l.raw_payload->>'parent_category') = b.slug
    or public.lead_certo_branch_slug(l.raw_payload->>'categoryName') = b.slug
  );

alter table public.pre_send_leads add column if not exists branch_name text;
alter table public.pre_send_leads add column if not exists branch_slug text;
alter table public.pre_send_leads add column if not exists data jsonb;

update public.pre_send_leads p
set
  branch_id = b.id,
  branch_name = coalesce(nullif(p.branch_name, ''), b.name),
  branch_slug = coalesce(nullif(p.branch_slug, ''), b.slug),
  data = coalesce(p.data, '{}'::jsonb) || jsonb_build_object('branch_id', b.id::text, 'branch_slug', b.slug, 'branch', b.name),
  updated_at = now()
from public.branches b
where p.branch_id is null
  and (
    p.branch_id_before_bigint::text = b.uuid_before_bigint::text
    or p.data->>'branch_id' = b.uuid_before_bigint::text
    or p.data->>'branch_id' = b.id::text
    or public.lead_certo_branch_slug(p.branch_name) = b.slug
    or public.lead_certo_branch_slug(p.data->>'branch') = b.slug
  );

alter table public.pre_dispatch_items add column if not exists branch_name text;
alter table public.pre_dispatch_items add column if not exists branch_slug text;
alter table public.pre_dispatch_items add column if not exists data jsonb;

update public.pre_dispatch_items p
set
  branch_id = b.id,
  branch_name = coalesce(nullif(p.branch_name, ''), b.name),
  branch_slug = coalesce(nullif(p.branch_slug, ''), b.slug),
  raw_payload = coalesce(p.raw_payload, '{}'::jsonb) || jsonb_build_object('branch_id', b.id::text, 'branch_slug', b.slug, 'branch', b.name),
  data = coalesce(p.data, '{}'::jsonb) || jsonb_build_object('branch_id', b.id::text, 'branch_slug', b.slug, 'branch', b.name),
  updated_at = now()
from public.branches b
where p.branch_id is null
  and (
    p.branch_id_before_bigint::text = b.uuid_before_bigint::text
    or p.raw_payload->>'branch_id' = b.uuid_before_bigint::text
    or p.raw_payload->>'branch_id' = b.id::text
    or p.data->>'branch_id' = b.uuid_before_bigint::text
    or p.data->>'branch_id' = b.id::text
    or public.lead_certo_branch_slug(p.branch_slug) = b.slug
    or public.lead_certo_branch_slug(p.branch_name) = b.slug
    or public.lead_certo_branch_slug(p.parent_category) = b.slug
    or public.lead_certo_branch_slug(p.raw_payload->>'branch') = b.slug
  );

alter table public.instagram_dispatch_items add column if not exists branch_name text;
alter table public.instagram_dispatch_items add column if not exists branch_slug text;
alter table public.instagram_dispatch_items add column if not exists data jsonb;

update public.instagram_dispatch_items i
set
  branch_id = b.id,
  branch_name = coalesce(nullif(i.branch_name, ''), b.name),
  branch_slug = coalesce(nullif(i.branch_slug, ''), b.slug),
  data = coalesce(i.data, '{}'::jsonb) || jsonb_build_object('branch_id', b.id::text, 'branch_slug', b.slug, 'branch', b.name),
  updated_at = now()
from public.branches b
where i.branch_id is null
  and (
    i.branch_id_before_bigint::text = b.uuid_before_bigint::text
    or i.data->>'branch_id' = b.uuid_before_bigint::text
    or i.data->>'branch_id' = b.id::text
    or public.lead_certo_branch_slug(i.branch_slug) = b.slug
    or public.lead_certo_branch_slug(i.branch_name) = b.slug
    or public.lead_certo_branch_slug(i.parent_category) = b.slug
    or public.lead_certo_branch_slug(i.data->>'branch') = b.slug
  );

alter table public.base_permanente add column if not exists branch_name text;
alter table public.base_permanente add column if not exists branch_slug text;
alter table public.base_permanente add column if not exists data jsonb;

update public.base_permanente bp
set
  branch_id = b.id,
  branch_name = coalesce(nullif(bp.branch_name, ''), b.name),
  branch_slug = coalesce(nullif(bp.branch_slug, ''), b.slug),
  raw_payload = coalesce(bp.raw_payload, '{}'::jsonb) || jsonb_build_object('branch_id', b.id::text, 'branch_slug', b.slug, 'branch', b.name),
  data = coalesce(bp.data, '{}'::jsonb) || jsonb_build_object('branch_id', b.id::text, 'branch_slug', b.slug, 'branch', b.name),
  updated_at = now()
from public.branches b
where bp.branch_id is null
  and (
    bp.branch_id_before_bigint::text = b.uuid_before_bigint::text
    or bp.raw_payload->>'branch_id' = b.uuid_before_bigint::text
    or bp.raw_payload->>'branch_id' = b.id::text
    or bp.data->>'branch_id' = b.uuid_before_bigint::text
    or bp.data->>'branch_id' = b.id::text
    or public.lead_certo_branch_slug(bp.branch_slug) = b.slug
    or public.lead_certo_branch_slug(bp.branch_name) = b.slug
    or public.lead_certo_branch_slug(bp.category) = b.slug
    or public.lead_certo_branch_slug(bp.category_name) = b.slug
    or public.lead_certo_branch_slug(bp.raw_payload->>'branch') = b.slug
    or public.lead_certo_branch_slug(bp.raw_payload->>'ramo') = b.slug
  );

create index if not exists message_templates_branch_id_bigint_idx on public.message_templates(branch_id);
create index if not exists leads_branch_id_bigint_idx on public.leads(branch_id);
create index if not exists pre_send_leads_branch_id_bigint_idx on public.pre_send_leads(branch_id);
create index if not exists pre_dispatch_items_branch_id_bigint_idx on public.pre_dispatch_items(branch_id);
create index if not exists instagram_dispatch_items_branch_id_bigint_idx on public.instagram_dispatch_items(branch_id);
create index if not exists base_permanente_branch_id_bigint_idx on public.base_permanente(branch_id);

drop function if exists public.lead_certo_prepare_branch_bigint_column(text);

select 'POST branches' as etapa, pg_typeof(id)::text as id_type, count(*) as total
from public.branches
group by pg_typeof(id)::text;

select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name in ('branches', 'message_templates', 'leads', 'pre_send_leads', 'pre_dispatch_items', 'instagram_dispatch_items', 'base_permanente')
  and column_name in ('id', 'branch_id', 'uuid_before_bigint', 'branch_id_before_bigint', 'legacy_text_before_bigint')
order by table_name, column_name;

select 'POST templates sem branch_id' as etapa, count(*) as total
from public.message_templates
where branch_id is null;

select 'POST leads sem branch_id' as etapa, count(*) as total
from public.leads
where branch_id is null;

select 'POST branches' as etapa, id, slug, name, status
from public.branches
order by id;

commit;
