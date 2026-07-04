-- Lead Certo V2 - ajuste seguro do contrato de templates.
-- Objetivo: template nao depende mais de nome operacional nem de ordem.
-- Seguro para rodar no SQL Editor: nao apaga tabelas, nao remove colunas e nao altera mensagens.

select
  'PRE message_templates' as etapa,
  count(*) as total,
  count(*) filter (where name is null or btrim(name) = '') as sem_nome,
  count(*) filter (where data ?| array['name', 'order', 'templateOrder', 'messageOrder', 'variables', 'image', 'imageName', 'image_url']) as com_chaves_legadas_no_data
from public.message_templates;

alter table public.message_templates
  alter column name drop not null;

update public.message_templates
set
  data = data - 'name' - 'order' - 'templateOrder' - 'messageOrder' - 'variables' - 'image' - 'imageName' - 'image_url',
  updated_at = now()
where data ?| array['name', 'order', 'templateOrder', 'messageOrder', 'variables', 'image', 'imageName', 'image_url'];

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'message_templates'
      and column_name = 'branch_id'
  ) then
    create index if not exists message_templates_contract_idx
      on public.message_templates(user_id, branch_id, channel, template_type)
      where coalesce(status, '') not in ('deleted', 'Arquivado');
  end if;
end $$;

select
  'POST message_templates' as etapa,
  count(*) as total,
  count(*) filter (where name is null or btrim(name) = '') as sem_nome,
  count(*) filter (where data ?| array['name', 'order', 'templateOrder', 'messageOrder', 'variables', 'image', 'imageName', 'image_url']) as com_chaves_legadas_no_data
from public.message_templates;
