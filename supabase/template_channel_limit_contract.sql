-- Lead Certo V2 - contrato de templates por canal.
-- Objetivo: permitir ate 10 templates por ramo/canal no app.
-- Seguro para rodar no SQL Editor: nao apaga templates nem altera mensagens.

do $$
declare
  constraint_record record;
  index_record record;
begin
  if to_regclass('public.message_templates') is null then
    return;
  end if;

  for constraint_record in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.message_templates'::regclass
      and c.contype = 'u'
      and (
        select array_agg(a.attname order by u.ordinality)
        from unnest(c.conkey) with ordinality as u(attnum, ordinality)
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = u.attnum
      ) @> array['branch_id', 'channel']::text[]
  loop
    execute format('alter table public.message_templates drop constraint if exists %I', constraint_record.conname);
  end loop;

  for index_record in
    select i.relname
    from pg_index ix
    join pg_class i on i.oid = ix.indexrelid
    where ix.indrelid = 'public.message_templates'::regclass
      and ix.indisunique
      and not exists (
        select 1
        from pg_constraint c
        where c.conindid = ix.indexrelid
      )
      and (
        select array_agg(a.attname order by u.ordinality)
        from unnest(ix.indkey) with ordinality as u(attnum, ordinality)
        join pg_attribute a on a.attrelid = ix.indrelid and a.attnum = u.attnum
      ) @> array['branch_id', 'channel']::text[]
  loop
    execute format('drop index if exists public.%I', index_record.relname);
  end loop;
end $$;

create index if not exists message_templates_branch_channel_idx
  on public.message_templates(user_id, branch_id, channel)
  where coalesce(status, '') not in ('deleted', 'Arquivado');
