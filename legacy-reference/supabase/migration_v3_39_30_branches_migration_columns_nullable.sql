-- V3.39.30
-- Colunas auxiliares da migração bigint guardam referências antigas.
-- Novos ramos não possuem valores legados, portanto essas colunas devem aceitar NULL.

begin;

alter table public.branches
  alter column uuid_before_bigint drop not null,
  alter column uuid_before_bigint drop default,
  alter column legacy_text_before_bigint drop not null,
  alter column legacy_text_before_bigint drop default;

commit;

select
  column_name,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'branches'
  and column_name in ('uuid_before_bigint', 'legacy_text_before_bigint')
order by column_name;
