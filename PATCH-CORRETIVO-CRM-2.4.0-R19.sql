-- CRM v2.4.0-R19
-- Base Permanente = destino final, somente consulta.
-- Resultado comercial, notas e arquivamento manual deixam de fazer parte do produto.
-- As estruturas legadas permanecem no schema por compatibilidade histórica, mas os RPCs
-- de edição não ficam expostos aos clientes autenticados.

REVOKE ALL ON FUNCTION public.update_permanent_record_metadata(bigint,text,text)
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.archive_permanent_record(bigint,bigint)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.update_permanent_record_metadata(bigint,text,text)
  IS 'LEGACY R19: Base Permanente é somente consulta; edição de resultado/notas não é exposta pelo produto.';

COMMENT ON FUNCTION public.archive_permanent_record(bigint,bigint)
  IS 'LEGACY R19: Base Permanente é destino final; arquivamento manual não é exposto pelo produto.';
