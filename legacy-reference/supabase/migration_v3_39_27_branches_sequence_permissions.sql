-- V3.39.27
-- Corrige a permissão da sequência usada pelo ID bigint de public.branches.
-- Idempotente e segura para ambientes onde a sequência já existe.

do $$
begin
  if to_regclass('public.branches_id_seq') is not null then
    grant usage, select on sequence public.branches_id_seq to authenticated;
    grant usage, select on sequence public.branches_id_seq to service_role;
  end if;
end
$$;
