-- V3.39.28 - corrige definitivamente a permissão da sequence de branches.
-- Executar no SQL Editor do MESMO projeto Supabase usado pelo CRM.

begin;

-- Garante acesso ao schema onde a sequence está localizada.
grant usage on schema public to anon, authenticated, service_role;

-- nextval exige USAGE ou UPDATE. Concedemos também SELECT para currval/inspeção.
grant usage, select, update
on sequence public.branches_id_seq
TO anon, authenticated, service_role;

-- Evita que futuras sequences criadas no schema public repitam o problema.
alter default privileges in schema public
grant usage, select, update on sequences
to anon, authenticated, service_role;

commit;

-- Verificação: deve retornar true nas três permissões para authenticated.
select
  has_sequence_privilege('authenticated', 'public.branches_id_seq', 'USAGE') as authenticated_usage,
  has_sequence_privilege('authenticated', 'public.branches_id_seq', 'SELECT') as authenticated_select,
  has_sequence_privilege('authenticated', 'public.branches_id_seq', 'UPDATE') as authenticated_update,
  has_sequence_privilege('anon', 'public.branches_id_seq', 'USAGE') as anon_usage;
