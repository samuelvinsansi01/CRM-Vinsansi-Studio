-- V3.39.29 - permite criar novos ramos após a conversão de branches.id para bigint.
-- A coluna legacy_text_before_bigint é apenas auxiliar de migração e não deve ser obrigatória.

begin;

alter table public.branches
  alter column legacy_text_before_bigint drop not null;

alter table public.branches
  alter column legacy_text_before_bigint drop default;

commit;

-- Verificação: is_nullable deve retornar YES.
select
  column_name,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'branches'
  and column_name = 'legacy_text_before_bigint';
