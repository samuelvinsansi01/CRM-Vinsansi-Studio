begin;

-- Recupera invalidações já realizadas pela extensão antes da V3.39.42.
-- Usa somente as colunas canônicas mínimas da Base Permanente.
insert into public.base_permanente (
  id,
  data,
  status,
  active,
  kind,
  channel,
  updated_at
)
select
  'site-invalid-' || l.id::text,
  coalesce(l.data, '{}'::jsonb) || jsonb_build_object(
    'sourceLeadId', l.id::text,
    'status', 'invalid',
    'destination', 'Com site',
    'destino', 'Com site',
    'destination_override', 'Com site',
    'send_instagram', false,
    'reason', 'Invalidado manualmente pela extensão de validação de sites.',
    'motivo', 'Invalidado manualmente pela extensão de validação de sites.',
    'invalidatedBy', 'site-leads-extension',
    'invalidatedAt', coalesce(l.updated_at, now())
  ),
  'invalid',
  true,
  'base_permanente',
  'Com site',
  now()
from public.leads l
where lower(trim(coalesce(l.status, ''))) in ('invalid', 'invalidado')
  and (
    lower(trim(coalesce(l.data->>'site_validation_action', ''))) = 'invalidate'
    or lower(trim(coalesce(l.data->>'invalidatedBy', ''))) = 'site-leads-extension'
    or lower(trim(coalesce(l.data->>'motivo', ''))) like '%extensão de validação de sites%'
  )
on conflict (id) do update
set
  data = excluded.data,
  status = excluded.status,
  active = excluded.active,
  kind = excluded.kind,
  channel = excluded.channel,
  updated_at = excluded.updated_at;

commit;
