-- Lead Certo V2 - padronizacao definitiva de imagem de Ramos.
-- Executar uma unica vez no Supabase SQL Editor antes da operacao.

begin;

alter table public.branches add column if not exists image_name text;

do $$
declare
  legacy_column text := 'image' || '_file';
  legacy_json_key text := 'image' || 'File';
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'branches'
      and column_name = legacy_column
  ) then
    execute format(
      'update public.branches
       set image_name = coalesce(nullif(image_name, ''''), nullif(%I, ''''), nullif(data->>''imageName'', ''''), nullif(data->>%L, ''''))
       where image_name is null or image_name = ''''',
      legacy_column,
      legacy_json_key
    );
  else
    execute format(
      'update public.branches
       set image_name = coalesce(nullif(image_name, ''''), nullif(data->>''imageName'', ''''), nullif(data->>%L, ''''))
       where image_name is null or image_name = ''''',
      legacy_json_key
    );
  end if;

  update public.branches
  set data = jsonb_set(coalesce(data, '{}'::jsonb) - legacy_json_key, '{imageName}', to_jsonb(coalesce(image_name, '')), true)
  where data is not null;

  execute format('alter table public.branches drop column if exists %I', legacy_column);
end $$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'message_templates'
      and column_name = 'image'
  ) then
    alter table public.message_templates drop column image;
  end if;
end $$;

update public.message_templates
set data = coalesce(data, '{}'::jsonb) - 'image'
where data ? 'image';

commit;

select 'branches.image_name' as check_name, count(*) as total, count(image_name) as with_image_name
from public.branches;

select 'message_templates_without_image_column' as check_name,
  not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'message_templates'
      and column_name = 'image'
  ) as ok;
