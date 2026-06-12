-- Conferir contatos já enviados/protegidos
select
  id,
  company_name,
  phone,
  normalized_phone,
  source,
  reason,
  active,
  dispatched_at,
  created_at
from public.sent_contacts
where active = true
order by coalesce(dispatched_at, created_at) desc;

-- Contar total de telefones protegidos
select count(*) as total_ja_enviados
from public.sent_contacts
where active = true;

-- Testar se um telefone específico está bloqueado
-- Troque o número abaixo pelo WhatsApp que quer verificar.
select *
from public.sent_contacts
where active = true
  and normalized_phone = public.normalize_br_phone('11999999999');
