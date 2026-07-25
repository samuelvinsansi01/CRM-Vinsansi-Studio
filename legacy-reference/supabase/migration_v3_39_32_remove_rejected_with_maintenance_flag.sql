-- V3.39.32
-- Limpeza controlada dos leads recusados antigos.
-- A proteção contra DELETE físico é liberada apenas nesta transação.
begin;

-- O trigger prevent_hard_delete_leads() consulta esta configuração.
-- O terceiro argumento TRUE torna a configuração local à transação;
-- após COMMIT ou ROLLBACK, a proteção volta automaticamente.
select set_config('app.allow_hard_delete_leads', 'on', true);

create temporary table rejected_lead_ids
on commit drop
as
select id
from public.leads
where lower(trim(coalesce(status, ''))) in (
  'rejected', 'recusado', 'recusada', 'recusados', 'recusadas'
);

-- Remove primeiro as referências aos leads recusados.
delete from public.lead_imports li
where lower(trim(coalesce(li.status, ''))) in (
        'rejected', 'recusado', 'recusada', 'recusados', 'recusadas'
      )
   or li.lead_id in (select id from rejected_lead_ids);

delete from public.lead_registry lr
where lr.lead_id in (select id from rejected_lead_ids);

-- Remove somente os leads explicitamente capturados como recusados.
delete from public.leads l
where l.id in (select id from rejected_lead_ids);

-- Elimina os JSONs brutos antigos, preservando metadados leves do lote.
update public.import_batches
set raw_metadata = jsonb_build_object(
  'source', coalesce(raw_metadata ->> 'source', 'react'),
  'cleaned_at', now()
)
where coalesce(raw_metadata, '{}'::jsonb) ? 'parsed';

commit;
