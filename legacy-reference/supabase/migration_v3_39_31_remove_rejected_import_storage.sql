-- V3.39.31
-- Recusados de importacao nao devem ocupar a base nem bloquear reimportacoes.
begin;

-- Remove auditorias detalhadas de recusados/duplicados antigos.
delete from public.lead_imports
where lower(coalesce(status, '')) in ('rejected', 'recusado', 'recusada', 'recusados', 'recusadas')
   or lead_id in (
     select id from public.leads
     where lower(coalesce(status, '')) in ('rejected', 'recusado', 'recusada', 'recusados', 'recusadas')
   );

-- Remove identidades associadas aos recusados antigos.
delete from public.lead_registry
where lead_id in (
  select id from public.leads
  where lower(coalesce(status, '')) in ('rejected', 'recusado', 'recusada', 'recusados', 'recusadas')
);

-- Remove os recusados da tabela operacional.
delete from public.leads
where lower(coalesce(status, '')) in ('rejected', 'recusado', 'recusada', 'recusados', 'recusadas');

-- Elimina JSONs brutos já armazenados nos lotes, preservando só metadados leves.
update public.import_batches
set raw_metadata = jsonb_build_object(
  'source', coalesce(raw_metadata ->> 'source', 'react'),
  'cleaned_at', now()
)
where raw_metadata ? 'parsed';

commit;
