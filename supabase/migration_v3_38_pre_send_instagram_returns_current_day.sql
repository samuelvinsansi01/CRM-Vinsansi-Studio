-- V3.38 - Mantém retornos WhatsApp inválido no dia atual do Pré-Envio Instagram
-- Objetivo: leads redirecionados para Instagram após WhatsApp inválido, ainda em revisão,
-- não devem permanecer presos em cards de dias anteriores.

create table if not exists public.pre_send_leads_backup_before_v3_38_instagram_return_day as
select * from public.pre_send_leads;

with local_clock as (
  select now() at time zone 'America/Sao_Paulo' as local_now
), target_day as (
  select case extract(dow from local_now + case when extract(hour from local_now) >= 22 then interval '1 day' else interval '0 day' end)::int
    when 0 then 'instagram-domingo'
    when 1 then 'instagram-segunda'
    when 2 then 'instagram-terca'
    when 3 then 'instagram-quarta'
    when 4 then 'instagram-quinta'
    when 5 then 'instagram-sexta'
    else 'instagram-sabado'
  end as day_id
  from local_clock
)
update public.pre_send_leads p
set
  data = jsonb_set(
    jsonb_set(
      p.data,
      '{dayId}',
      to_jsonb(target_day.day_id),
      true
    ),
    '{queueWaitReason}',
    to_jsonb(case
      when coalesce(p.data->>'instagramPendingLink', '') in ('true', '1') then 'Aguardando link do Instagram.'
      else coalesce(nullif(p.data->>'queueWaitReason', ''), 'Retorno WhatsApp inválido mantido no dia atual do Pré-Envio Instagram.')
    end),
    true
  ),
  updated_at = now()
from target_day
where coalesce(p.channel, p.data->>'channel') = 'Instagram'
  and coalesce(p.status, p.data->>'status') = 'review'
  and coalesce(p.data->>'send_instagram', '') in ('true', '1')
  and lower(coalesce(p.data->>'instagram_override_reason', '')) like '%whatsapp_invalid%'
  and coalesce(p.data->>'dayId', '') <> target_day.day_id;

select
  count(*) as retornos_whatsapp_invalid_no_dia_atual
from public.pre_send_leads p, target_day
where coalesce(p.channel, p.data->>'channel') = 'Instagram'
  and coalesce(p.status, p.data->>'status') = 'review'
  and coalesce(p.data->>'send_instagram', '') in ('true', '1')
  and lower(coalesce(p.data->>'instagram_override_reason', '')) like '%whatsapp_invalid%'
  and coalesce(p.data->>'dayId', '') = target_day.day_id;
